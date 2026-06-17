import Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import {
  MEMORY_TYPES,
  DEFAULT_CONFIG,
  type CreateMemoryInput,
  type UpdateMemoryInput,
  type MemoryWithTags,
  type MemoryRelation,
} from "./types.js";

export function loadTagsFor(db: Database.Database, memoryId: string): string[] {
  return db
    .prepare("SELECT tag FROM memory_tags WHERE memory_id = ? ORDER BY tag")
    .all(memoryId)
    .map((r: any) => r.tag);
}

export function loadRelationsFor(
  db: Database.Database,
  memoryId: string
): MemoryRelation[] {
  return db
    .prepare(
      "SELECT target_id, relation FROM memory_relations WHERE source_id = ?"
    )
    .all(memoryId)
    .map((r: any) => ({ target_id: r.target_id, relation: r.relation }));
}

function syncFts(
  db: Database.Database,
  memoryId: string,
  oldContent: string,
  oldSearchTags: string,
  newContent: string,
  newSearchTags: string
): void {
  db.prepare(
    "INSERT INTO memories_fts(memories_fts, rowid, content, search_tags) VALUES ('delete', (SELECT rowid FROM memories WHERE id = ?), ?, ?)"
  ).run(memoryId, oldContent, oldSearchTags);
  db.prepare(
    "INSERT INTO memories_fts(rowid, content, search_tags) VALUES ((SELECT rowid FROM memories WHERE id = ?), ?, ?)"
  ).run(memoryId, newContent, newSearchTags);
}

function hashContent(content: string): string {
  const normalized = content.trim().toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

export class MemoryStore {
  private maxContentLength: number;

  constructor(private db: Database.Database) {
    this.maxContentLength = DEFAULT_CONFIG.defaults.max_content_length;
  }

  create(input: CreateMemoryInput): MemoryWithTags {
    this.validateContent(input.content);
    this.validateType(input.type);
    this.validateScope(input.scope, input.feature);

    const contentHash = hashContent(input.content);

    const existing = this.db
      .prepare("SELECT id FROM memories WHERE content_hash = ?")
      .get(contentHash) as { id: string } | undefined;

    if (existing) {
      return this.getById(existing.id)!;
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    const insertMemory = this.db.prepare(`
      INSERT INTO memories (id, content, content_hash, type, scope, feature, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertTag = this.db.prepare(
      "INSERT INTO memory_tags (memory_id, tag) VALUES (?, ?)"
    );

    const insertRelation = this.db.prepare(
      "INSERT INTO memory_relations (source_id, target_id, relation) VALUES (?, ?, ?)"
    );

    const transaction = this.db.transaction(() => {
      insertMemory.run(
        id, input.content, contentHash, input.type,
        input.scope, input.feature, input.priority, now, now
      );

      for (const tag of input.tags) {
        insertTag.run(id, tag);
      }

      for (const targetId of input.related_to) {
        insertRelation.run(id, targetId, "related");
      }

      if (input.tags.length > 0) {
        syncFts(this.db, id, input.content, "", input.content, input.tags.join(" "));
      }
    });

    transaction();

    return this.getById(id)!;
  }

  update(id: string, input: UpdateMemoryInput): MemoryWithTags {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Memory ${id} not found`);

    if (input.content !== undefined) this.validateContent(input.content);
    if (input.type !== undefined) this.validateType(input.type);

    const now = new Date().toISOString();
    const sets: string[] = ["updated_at = ?"];
    const values: any[] = [now];

    if (input.content !== undefined) {
      sets.push("content = ?", "content_hash = ?");
      values.push(input.content, hashContent(input.content));
    }

    if (input.type !== undefined) {
      sets.push("type = ?");
      values.push(input.type);
    }

    if (input.priority !== undefined) {
      sets.push("priority = ?");
      values.push(input.priority);
    }

    values.push(id);
    this.db
      .prepare(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values);

    if (input.tags !== undefined) {
      this.db.prepare("DELETE FROM memory_tags WHERE memory_id = ?").run(id);
      const insertTag = this.db.prepare(
        "INSERT INTO memory_tags (memory_id, tag) VALUES (?, ?)"
      );
      for (const tag of input.tags) {
        insertTag.run(id, tag);
      }

      const content = input.content ?? existing.content;
      syncFts(
        this.db, id,
        existing.content, existing.tags.join(" "),
        content, input.tags.join(" ")
      );
    }

    if (input.related_to !== undefined) {
      this.db
        .prepare("DELETE FROM memory_relations WHERE source_id = ?")
        .run(id);
      const insertRelation = this.db.prepare(
        "INSERT INTO memory_relations (source_id, target_id, relation) VALUES (?, ?, ?)"
      );
      for (const targetId of input.related_to) {
        insertRelation.run(id, targetId, "related");
      }
    }

    return this.getById(id)!;
  }

  delete(id: string): void {
    const result = this.db
      .prepare("DELETE FROM memories WHERE id = ?")
      .run(id);
    if (result.changes === 0) throw new Error(`Memory ${id} not found`);
  }

  getById(id: string): MemoryWithTags | null {
    const row = this.db
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(id) as any | undefined;

    if (!row) return null;

    return {
      ...row,
      tags: loadTagsFor(this.db, id),
      relations: loadRelationsFor(this.db, id),
    };
  }

  exportMemories(scope?: string): MemoryWithTags[] {
    const rows: any[] = scope
      ? this.db
          .prepare("SELECT * FROM memories WHERE scope = ? ORDER BY created_at")
          .all(scope)
      : this.db
          .prepare("SELECT * FROM memories ORDER BY created_at")
          .all();

    return rows.map((row: any) => ({
      ...row,
      tags: loadTagsFor(this.db, row.id),
      relations: loadRelationsFor(this.db, row.id),
    }));
  }

  private validateContent(content: string): void {
    if (content.length > this.maxContentLength) {
      throw new Error(
        `Content length ${content.length} exceeds maximum of ${this.maxContentLength} characters`
      );
    }
  }

  private validateType(type: string): void {
    if (!MEMORY_TYPES.includes(type as any)) {
      throw new Error(
        `Invalid memory type "${type}". Must be one of: ${MEMORY_TYPES.join(", ")}`
      );
    }
  }

  private validateScope(scope: string, feature: string | null): void {
    if (scope === "global" && feature !== null) {
      throw new Error("feature must be null when scope is global");
    }
  }
}
