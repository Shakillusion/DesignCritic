import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { env } from "@/lib/env";
import { MIGRATIONS } from "./migrations";

/**
 * Local persistence: SQLite through Node's built-in `node:sqlite`.
 * All access goes through lib/database/repo.ts, which is the seam a future
 * Supabase/Postgres adapter replaces.
 */

/** Single-user local mode. Every query is still scoped by this id. */
export const LOCAL_USER_ID = "local-user";

const globalForDb = globalThis as unknown as { __designcriticDb?: DatabaseSync };

export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync) {
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  db.prepare("INSERT OR IGNORE INTO users (id, name, created_at) VALUES (?, ?, ?)").run(
    LOCAL_USER_ID,
    "Local designer",
    new Date().toISOString(),
  );
}

export function getDb(): DatabaseSync {
  if (!globalForDb.__designcriticDb) {
    globalForDb.__designcriticDb = openDatabase(path.join(env.dataDir, "designcritic.sqlite"));
  }
  return globalForDb.__designcriticDb;
}

/** For tests: swap in an isolated database. */
export function setDbForTesting(db: DatabaseSync | undefined) {
  globalForDb.__designcriticDb = db;
}

export function transaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
