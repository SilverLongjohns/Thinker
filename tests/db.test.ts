import { describe, it, expect, afterEach } from "vitest";
import { openDatabase } from "../src/db.js";
import { createTestDb, teardownTestDb, tmpDbPath } from "./helpers.js";
import Database from "better-sqlite3";

describe("openDatabase", () => {
  let db: Database.Database;
  let dbPath: string;

  afterEach(() => {
    if (db) teardownTestDb(db, dbPath);
  });

  it("creates a database with WAL mode enabled", () => {
    ({ db, dbPath } = createTestDb());
    const mode = db.pragma("journal_mode", { simple: true });
    expect(mode).toBe("wal");
  });

  it("creates all required tables", () => {
    ({ db, dbPath } = createTestDb());
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(tables).toContain("schema_version");
    expect(tables).toContain("projects");
    expect(tables).toContain("memories");
    expect(tables).toContain("memory_tags");
    expect(tables).toContain("memory_relations");
  });

  it("creates the FTS5 virtual table", () => {
    ({ db, dbPath } = createTestDb());
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(tables).toContain("memories_fts");
  });

  it("sets schema_version to 1", () => {
    ({ db, dbPath } = createTestDb());
    const row: any = db.prepare("SELECT version FROM schema_version").get();
    expect(row.version).toBe(1);
  });

  it("is idempotent on second open", () => {
    dbPath = tmpDbPath();
    const db1 = openDatabase(dbPath);
    db1.close();
    db = openDatabase(dbPath);
    const row: any = db.prepare("SELECT version FROM schema_version").get();
    expect(row.version).toBe(1);
  });
});
