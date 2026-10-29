import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

// Each test file gets its own data directory; nothing touches ./data.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "designcritic-test-"));
process.env.DESIGNCRITIC_DATA_DIR = dir;
delete process.env.ANTHROPIC_API_KEY;

afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows may still hold the SQLite file open; the OS temp cleaner will get it */
  }
});
