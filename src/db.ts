import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export function openDatabase(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  migrate(db);
  return db;
}

export function closeDatabase(db: Database.Database): void {
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
}

export function withDb<T>(dbPath: string, fn: (db: Database.Database) => T): T {
  const db = openDatabase(dbPath);
  try {
    return fn(db);
  } finally {
    closeDatabase(db);
  }
}

function migrate(db: Database.Database): void {
  const currentVersion = getSchemaVersion(db);

  if (currentVersion < 1) {
    migrateToV1(db);
  }
}

function getSchemaVersion(db: Database.Database): number {
  const tableExists = db
    .prepare(
      "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='schema_version'"
    )
    .get() as { cnt: number };

  if (tableExists.cnt === 0) return 0;

  const row = db.prepare("SELECT version FROM schema_version").get() as
    | { version: number }
    | undefined;
  return row?.version ?? 0;
}

function migrateToV1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE schema_version (
      version INTEGER NOT NULL
    );

    INSERT INTO schema_version (version) VALUES (1);

    CREATE TABLE projects (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      paths      TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE memories (
      id           TEXT PRIMARY KEY,
      content      TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      type         TEXT NOT NULL,
      scope        TEXT NOT NULL,
      feature      TEXT,
      priority     INTEGER NOT NULL DEFAULT 2,
      embedding    BLOB,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    CREATE INDEX idx_memories_scope ON memories(scope);
    CREATE INDEX idx_memories_type ON memories(type);
    CREATE INDEX idx_memories_content_hash ON memories(content_hash);
    CREATE INDEX idx_memories_priority ON memories(priority);

    CREATE TABLE memory_tags (
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      tag       TEXT NOT NULL,
      UNIQUE(memory_id, tag)
    );

    CREATE INDEX idx_memory_tags_tag ON memory_tags(tag);

    CREATE TABLE memory_relations (
      source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      relation  TEXT NOT NULL
    );

    -- unicode61 with underscore as separator handles snake_case terms.
    -- camelCase splitting would require a custom C tokenizer; deferred to future RAG upgrade.
    CREATE VIRTUAL TABLE memories_fts USING fts5(
      content,
      search_tags,
      content='memories',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2 separators _'
    );

    CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, search_tags)
      VALUES (new.rowid, new.content, '');
    END;

    CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, search_tags)
      VALUES ('delete', old.rowid, old.content, '');
    END;

    CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, search_tags)
      VALUES ('delete', old.rowid, old.content, '');
      INSERT INTO memories_fts(rowid, content, search_tags)
      VALUES (new.rowid, new.content, '');
    END;
  `);
}
