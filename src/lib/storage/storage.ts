import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { getFileStoragePath, insertFile, newId, type FileInsert } from "@/lib/database/repo";
import type { StoredFile } from "@/types/domain";
import { logger } from "@/lib/logger";

/**
 * Local file storage under DATA_DIR/storage. Storage paths are generated here
 * (never from user input) and always resolved inside the storage root.
 * A Supabase Storage adapter would implement the same functions.
 */

const root = () => path.join(env.dataDir, "storage");

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

function resolveInside(rel: string): string {
  const base = path.resolve(root());
  const abs = path.resolve(base, rel);
  if (!abs.startsWith(base + path.sep)) throw new Error("Invalid storage path");
  return abs;
}

export async function saveFile(
  userId: string,
  buffer: Buffer,
  meta: Omit<FileInsert, "storagePath" | "sha256" | "size">,
): Promise<StoredFile> {
  const id = newId("fil");
  const scope = meta.projectId ? `projects/${meta.projectId}` : meta.brandId ? `brands/${meta.brandId}` : "misc";
  const rel = `${userId}/${scope}/${meta.kind}/${id}${EXT[meta.mime] ?? ".bin"}`;
  const abs = resolveInside(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer, { flag: "wx" }); // never overwrite: stored originals are immutable
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  return insertFile(userId, { ...meta, size: buffer.length, storagePath: rel, sha256 }, id);
}

export async function readFile(userId: string, fileId: string): Promise<{ file: StoredFile; buffer: Buffer }> {
  const { file, storagePath } = getFileStoragePath(userId, fileId);
  return { file, buffer: await fs.readFile(resolveInside(storagePath)) };
}

export async function removeStoredPaths(paths: string[]) {
  for (const p of paths) {
    try {
      await fs.rm(resolveInside(p), { force: true });
    } catch (err) {
      logger.warn("storage.remove_failed", { path: p, error: String(err) });
    }
  }
}

/** Remove a deleted project's or brand's whole folder (its rows are already gone). */
export async function removeScopeDir(userId: string, scope: { projectId: string } | { brandId: string }) {
  const rel = "projectId" in scope ? `${userId}/projects/${scope.projectId}` : `${userId}/brands/${scope.brandId}`;
  try {
    await fs.rm(resolveInside(rel), { recursive: true, force: true });
  } catch (err) {
    logger.warn("storage.remove_dir_failed", { rel, error: String(err) });
  }
}

export async function fileAsDataUri(userId: string, fileId: string): Promise<string> {
  const { file, buffer } = await readFile(userId, fileId);
  return `data:${file.mime};base64,${buffer.toString("base64")}`;
}
