import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the Vercel Blob API, so the hosted storage path is exercised without a network.
const store = new Map<string, { body: Buffer; type: string }>();
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string, body: Buffer, opts: { access: string; contentType: string }) => {
    expect(opts.access).toBe("private");
    if (store.has(pathname)) throw new Error("exists");
    store.set(pathname, { body: Buffer.from(body), type: opts.contentType });
    return { url: `https://blob.test/${pathname}`, pathname };
  }),
  get: vi.fn(async (pathname: string) => {
    const hit = store.get(pathname);
    return hit ? { stream: new Blob([new Uint8Array(hit.body)]).stream() } : null;
  }),
  del: vi.fn(async (urls: string | string[]) => {
    for (const u of [urls].flat()) store.delete(u.replace("https://blob.test/", ""));
  }),
  list: vi.fn(async ({ prefix }: { prefix: string }) => ({
    blobs: [...store.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ url: `https://blob.test/${k}`, pathname: k })),
    hasMore: false,
  })),
}));

const { createProject, deleteProject } = await import("@/lib/database/repo");
const { LOCAL_USER_ID } = await import("@/lib/database/db");
const { readFile, removeScopeDir, saveFile, streamFile } = await import("@/lib/storage/storage");
const { useTestDb } = await import("./fixtures");

describe("Vercel Blob storage backend", () => {
  beforeEach(async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    store.clear();
    await useTestDb();
  });
  afterEach(() => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });

  it("writes private blobs, reads and streams them back, and removes a project's folder", async () => {
    const p = await createProject(LOCAL_USER_ID, { name: "Hosted" });
    const bytes = Buffer.from("hello blob");
    const f = await saveFile(LOCAL_USER_ID, bytes, { projectId: p.id, brandId: null, kind: "upload", originalName: "a.txt", mime: "application/json", width: null, height: null });
    expect([...store.keys()]).toEqual([expect.stringMatching(new RegExp(`^${LOCAL_USER_ID}/projects/${p.id}/upload/fil_\\w+\\.json$`))]);
    expect((await readFile(LOCAL_USER_ID, f.id)).buffer.equals(bytes)).toBe(true);
    const { stream } = await streamFile(LOCAL_USER_ID, f.id);
    expect(Buffer.from(await new Response(stream).arrayBuffer()).toString()).toBe("hello blob");
    // Nothing touched the local disk.
    expect(fs.existsSync(path.join(process.env.DESIGNCRITIC_DATA_DIR!, "storage"))).toBe(false);
    await deleteProject(LOCAL_USER_ID, p.id);
    await removeScopeDir(LOCAL_USER_ID, { projectId: p.id });
    expect(store.size).toBe(0);
  });
});

describe("database migrations", () => {
  it("adopts a database created by the old node:sqlite build (PRAGMA user_version) without re-running migrations", async () => {
    const { MIGRATIONS } = await import("@/lib/database/migrations");
    const { openDatabase } = await import("@/lib/database/db");
    const file = path.join(process.env.DESIGNCRITIC_DATA_DIR!, `legacy-${Date.now()}.sqlite`);
    const old = createClient({ url: `file:${file}` });
    await old.executeMultiple(MIGRATIONS.join(";\n"));
    await old.execute(`PRAGMA user_version = ${MIGRATIONS.length}`);
    await old.execute({ sql: "INSERT INTO users (id, name, created_at) VALUES ('u1', 'Old', '2026-01-01')", args: [] });
    old.close();

    const db = openDatabase(`file:${file}`);
    await db.ready; // would throw "table already exists" if it re-ran migration 1
    const v = await db.client.execute("SELECT version FROM schema_version");
    expect(Number(v.rows[0].version)).toBe(MIGRATIONS.length);
    expect((await db.client.execute("SELECT COUNT(*) AS n FROM users WHERE id = 'u1'")).rows[0].n).toBe(1);
    db.client.close();
  });

  it("migrates a fresh database once even when two instances start together", async () => {
    const { openDatabase } = await import("@/lib/database/db");
    const file = path.join(process.env.DESIGNCRITIC_DATA_DIR!, `race-${Date.now()}.sqlite`);
    const [a, b] = [openDatabase(`file:${file}`), openDatabase(`file:${file}`)];
    await Promise.all([a.ready, b.ready]);
    expect((await a.client.execute("SELECT COUNT(*) AS n FROM schema_version")).rows[0].n).toBe(1);
    a.client.close();
    b.client.close();
  });
});

describe("job time budget", () => {
  it("reports remaining time and lets work skip steps it can't finish", async () => {
    await useTestDb();
    const { startJob } = await import("@/lib/jobs");
    const { getJob } = await import("@/lib/database/repo");
    let left = 0;
    const job = await startJob(LOCAL_USER_ID, { type: "critique", projectId: null, steps: [{ key: "a", label: "A" }, { key: "b", label: "B" }] }, async (ctx) => {
      left = ctx.timeLeft();
      await ctx.step("a", async (detail) => {
        detail("working");
        return 1;
      });
      ctx.skip("b", "Skipped to stay within the server time limit.");
      return { ok: true };
    });
    await vi.waitFor(async () => expect((await getJob(LOCAL_USER_ID, job.id)).status).toBe("succeeded"), { timeout: 5000 });
    const done = await getJob(LOCAL_USER_ID, job.id);
    expect(left).toBe(Number.POSITIVE_INFINITY); // no platform limit locally
    expect(done.steps.map((s) => s.status)).toEqual(["done", "skipped"]);
    expect(done.steps[0].detail).toBe("working");
  });
});
