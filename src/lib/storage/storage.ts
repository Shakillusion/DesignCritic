import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { del, get, list, put } from "@vercel/blob";
import { env } from "@/lib/env";
import { getFileStoragePath, insertFile, newId, type FileInsert } from "@/lib/database/repo";
import type { StoredFile } from "@/types/domain";
import { logger } from "@/lib/logger";

/**
 * File storage. Locally: DATA_DIR/storage. Hosted: private Vercel Blob objects
 * (when BLOB_READ_WRITE_TOKEN is set). Storage paths are generated here, never
 * from user input, and are the same relative key in both backends.
 */

interface Backend {
  write(rel: string, buffer: Buffer, mime: string): Promise<void>;
  read(rel: string): Promise<Buffer>;
  /** A stream of the stored bytes, for serving large files without buffering. */
  stream(rel: string): Promise<ReadableStream<Uint8Array>>;
  remove(rel: string): Promise<void>;
  removePrefix(prefix: string): Promise<void>;
}

const root = () => path.join(env.dataDir, "storage");

function resolveInside(rel: string): string {
  const base = path.resolve(root());
  const abs = path.resolve(base, rel);
  if (!abs.startsWith(base + path.sep)) throw new Error("Invalid storage path");
  return abs;
}

const disk: Backend = {
  async write(rel, buffer) {
    const abs = resolveInside(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buffer, { flag: "wx" }); // never overwrite: stored originals are immutable
  },
  read: (rel) => fs.readFile(resolveInside(rel)),
  async stream(rel) {
    const buffer = await fs.readFile(resolveInside(rel));
    return new Blob([new Uint8Array(buffer)]).stream();
  },
  remove: (rel) => fs.rm(resolveInside(rel), { force: true }),
  removePrefix: (prefix) => fs.rm(resolveInside(prefix), { recursive: true, force: true }),
};

const blob: Backend = {
  async write(rel, buffer, mime) {
    await put(rel, buffer, { access: "private", contentType: mime, addRandomSuffix: false, allowOverwrite: false });
  },
  async read(rel) {
    return Buffer.from(await new Response(await blob.stream(rel)).arrayBuffer());
  },
  async stream(rel) {
    const res = await get(rel, { access: "private" });
    if (!res?.stream) throw new Error("Stored file is missing.");
    return res.stream;
  },
  async remove(rel) {
    await del(rel);
  },
  async removePrefix(prefix) {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: `${prefix}/`, cursor, limit: 1000 });
      if (page.blobs.length) await del(page.blobs.map((b) => b.url));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  },
};

function backend(): Backend {
  if (env.blobToken) return blob;
  if (env.onVercel) throw new Error("No file storage configured. Connect a Vercel Blob store to the project (see docs/DEPLOY-VERCEL.md).");
  return disk;
}

const EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "text/html": ".html",
  "application/json": ".json",
};

export async function saveFile(
  userId: string,
  buffer: Buffer,
  meta: Omit<FileInsert, "storagePath" | "sha256" | "size">,
): Promise<StoredFile> {
  const id = newId("fil");
  const scope = meta.projectId ? `projects/${meta.projectId}` : meta.brandId ? `brands/${meta.brandId}` : "misc";
  const rel = `${userId}/${scope}/${meta.kind}/${id}${EXT[meta.mime] ?? ".bin"}`;
  await backend().write(rel, buffer, meta.mime);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  return insertFile(userId, { ...meta, size: buffer.length, storagePath: rel, sha256 }, id);
}

export async function readFile(userId: string, fileId: string): Promise<{ file: StoredFile; buffer: Buffer }> {
  const { file, storagePath } = await getFileStoragePath(userId, fileId);
  return { file, buffer: await backend().read(storagePath) };
}

/** Like readFile, but streams the bytes (no size limit when served from a serverless function). */
export async function streamFile(userId: string, fileId: string): Promise<{ file: StoredFile; stream: ReadableStream<Uint8Array> }> {
  const { file, storagePath } = await getFileStoragePath(userId, fileId);
  return { file, stream: await backend().stream(storagePath) };
}

export async function removeStoredPaths(paths: string[]) {
  for (const p of paths) {
    try {
      await backend().remove(p);
    } catch (err) {
      logger.warn("storage.remove_failed", { path: p, error: String(err) });
    }
  }
}

/** Remove a deleted project's or brand's whole folder (its rows are already gone). */
export async function removeScopeDir(userId: string, scope: { projectId: string } | { brandId: string }) {
  const rel = "projectId" in scope ? `${userId}/projects/${scope.projectId}` : `${userId}/brands/${scope.brandId}`;
  try {
    await backend().removePrefix(rel);
  } catch (err) {
    logger.warn("storage.remove_dir_failed", { rel, error: String(err) });
  }
}

export async function fileAsDataUri(userId: string, fileId: string): Promise<string> {
  const { file, buffer } = await readFile(userId, fileId);
  return `data:${file.mime};base64,${buffer.toString("base64")}`;
}

/** Wrap bytes in a stream so large responses aren't subject to serverless payload limits. */
export function toStream(body: Uint8Array | string): ReadableStream<Uint8Array> {
  return new Blob([typeof body === "string" ? body : new Uint8Array(body)]).stream();
}
