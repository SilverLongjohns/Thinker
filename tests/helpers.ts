import { openDatabase, closeDatabase } from "../src/db.js";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function tmpDbPath(): string {
  return path.join(
    os.tmpdir(),
    `thinker-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
}

export function cleanup(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {}
  }
}

export function createTestDb(): { db: Database.Database; dbPath: string } {
  const dbPath = tmpDbPath();
  const db = openDatabase(dbPath);
  return { db, dbPath };
}

export function teardownTestDb(db: Database.Database, dbPath: string): void {
  closeDatabase(db);
  cleanup(dbPath);
}
