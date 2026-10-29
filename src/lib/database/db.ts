import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { createClient, type Client, type InValue, type Transaction } from "@libsql/client";
import { env } from "@/lib/env";
import { MIGRATIONS } from "./migrations";

/**
 * Persistence: SQLite through libSQL. Locally that's a file under DATA_DIR;
 * hosted it's a Turso database (TURSO_DATABASE_URL). Same SQL either way.
 * All access goes through lib/database/repo.ts and research-repo.ts.
 */

/** Single-user mode. Every query is still scoped by this id. */
export const LOCAL_USER_ID = "local-user";

export type Row = Record<string, unknown>;
type Arg = string | number | bigint | boolean | null | Uint8Array;

export interface Statement {
  get(...args: Arg[]): Promise<Row | undefined>;
  all(...args: Arg[]): Promise<Row[]>;
  run(...args: Arg[]): Promise<{ changes: number }>;
}

export interface Db {
  prepare(sql: string): Statement;
}

const globalForDb = globalThis as unknown as { __designcriticDb?: { client: Client; ready: Promise<void> } };
// Statements issued inside transaction() run on its connection, found through async context.
const currentTx = new AsyncLocalStorage<Transaction>();

/** Open (and migrate) a database. `url` is a libSQL URL: file:…, libsql://… or :memory:. */
export function openDatabase(url: string, authToken?: string): { client: Client; ready: Promise<void> } {
  if (url.startsWith("file:")) fs.mkdirSync(path.dirname(url.slice(5)), { recursive: true });
  const client = createClient({ url, authToken, timeout: 5 });
  return { client, ready: migrate(client) };
}

async function schemaVersion(client: Client): Promise<number> {
  await client.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = (await client.execute("SELECT version FROM schema_version LIMIT 1")).rows[0];
  if (row) return Number(row.version);
  // Databases created before schema_version tracked their version in PRAGMA user_version.
  let legacy = 0;
  try {
    legacy = Number((await client.execute("PRAGMA user_version")).rows[0]?.user_version ?? 0);
  } catch {
    /* not supported remotely; a fresh database starts at 0 */
  }
  await client.execute({ sql: "INSERT INTO schema_version (version) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM schema_version)", args: [legacy] });
  return Number((await client.execute("SELECT version FROM schema_version LIMIT 1")).rows[0].version);
}

async function migrate(client: Client) {
  for (let i = await schemaVersion(client); i < MIGRATIONS.length; i++) {
    try {
      await client.executeMultiple(`BEGIN;\n${MIGRATIONS[i]};\nUPDATE schema_version SET version = ${i + 1};\nCOMMIT;`);
    } catch (err) {
      await client.execute("ROLLBACK").catch(() => undefined);
      // Another server instance may have applied it at the same moment.
      if ((await schemaVersion(client)) > i) continue;
      throw err;
    }
  }
  await client.execute({ sql: "INSERT OR IGNORE INTO users (id, name, created_at) VALUES (?, ?, ?)", args: [LOCAL_USER_ID, "Local designer", new Date().toISOString()] });
}

function connection() {
  if (!globalForDb.__designcriticDb) {
    if (env.onVercel && !env.databaseUrl) throw new Error("No database configured. Add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the Vercel project settings (see docs/DEPLOY-VERCEL.md).");
    globalForDb.__designcriticDb = env.databaseUrl
      ? openDatabase(env.databaseUrl, env.databaseAuthToken ?? undefined)
      : openDatabase(`file:${path.join(env.dataDir, "designcritic.sqlite")}`);
  }
  return globalForDb.__designcriticDb;
}

async function execute(sql: string, args: Arg[]) {
  const tx = currentTx.getStore();
  if (tx) return tx.execute({ sql, args: args as InValue[] });
  const { client, ready } = connection();
  await ready;
  return client.execute({ sql, args: args as InValue[] });
}

const db: Db = {
  prepare: (sql) => ({
    get: async (...args) => (await execute(sql, args)).rows[0] as Row | undefined,
    all: async (...args) => (await execute(sql, args)).rows as unknown as Row[],
    run: async (...args) => ({ changes: (await execute(sql, args)).rowsAffected }),
  }),
};

export function getDb(): Db {
  return db;
}

/** For tests: swap in an isolated database (or reset to the default). */
export function setDbForTesting(conn: { client: Client; ready: Promise<void> } | undefined) {
  globalForDb.__designcriticDb = conn;
}

/** Run `fn` atomically. Nested calls join the outer transaction. */
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (currentTx.getStore()) return fn();
  const { client, ready } = connection();
  await ready;
  const tx = await client.transaction("write");
  try {
    const out = await currentTx.run(tx, fn);
    await tx.commit();
    return out;
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  } finally {
    tx.close();
  }
}
