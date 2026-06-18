import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore, backfillEmbeddings } from "../src/store.js";
import { createTestDb, teardownTestDb } from "./helpers.js";
import Database from "better-sqlite3";

describe("Embeddings storage", () => {
  let db: Database.Database;
  let store: MemoryStore;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = createTestDb());
    store = new MemoryStore(db);
  });

  afterEach(() => {
    teardownTestDb(db, dbPath);
  });

  function fakeEmbedding(): Buffer {
    const vec = new Float32Array(384);
    for (let i = 0; i < 384; i++) vec[i] = i / 384;
    return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
  }

  describe("store create/update", () => {
    it("stores embedding blob when provided in create", () => {
      const embedding = fakeEmbedding();
      const result = store.create({
        content: "memory with embedding",
        type: "convention",
        scope: "project-123",
        feature: null,
        priority: 2,
        tags: [],
        related_to: [],
        embedding,
      });

      const row = db
        .prepare("SELECT embedding FROM memories WHERE id = ?")
        .get(result.id) as { embedding: Buffer | null };

      expect(row.embedding).not.toBeNull();
      expect(row.embedding!.length).toBe(384 * 4);
    });

    it("stores null embedding when not provided in create", () => {
      const result = store.create({
        content: "memory without embedding",
        type: "note",
        scope: "global",
        feature: null,
        priority: 2,
        tags: [],
        related_to: [],
      });

      const row = db
        .prepare("SELECT embedding FROM memories WHERE id = ?")
        .get(result.id) as { embedding: Buffer | null };

      expect(row.embedding).toBeNull();
    });

    it("stores embedding blob when provided in update", () => {
      const created = store.create({
        content: "original content",
        type: "note",
        scope: "global",
        feature: null,
        priority: 2,
        tags: [],
        related_to: [],
      });

      const embedding = fakeEmbedding();
      store.update(created.id, { content: "updated content", embedding });

      const row = db
        .prepare("SELECT embedding FROM memories WHERE id = ?")
        .get(created.id) as { embedding: Buffer | null };

      expect(row.embedding).not.toBeNull();
      expect(row.embedding!.length).toBe(384 * 4);
    });

    it("reads back stored embedding correctly", () => {
      const embedding = fakeEmbedding();
      const result = store.create({
        content: "roundtrip test",
        type: "note",
        scope: "global",
        feature: null,
        priority: 2,
        tags: [],
        related_to: [],
        embedding,
      });

      const row = db
        .prepare("SELECT embedding FROM memories WHERE id = ?")
        .get(result.id) as { embedding: Buffer };

      const restored = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.length / 4
      );

      expect(restored[0]).toBeCloseTo(0 / 384);
      expect(restored[1]).toBeCloseTo(1 / 384);
      expect(restored[383]).toBeCloseTo(383 / 384);
    });
  });

  describe("backfillEmbeddings", () => {
    function fakeEmbedder(text: string): Promise<Float32Array> {
      const vec = new Float32Array(384);
      for (let i = 0; i < 384; i++) vec[i] = text.length / 1000 + i / 384;
      return Promise.resolve(vec);
    }

    it("fills null embeddings for existing memories", async () => {
      store.create({
        content: "no embedding yet",
        type: "note",
        scope: "global",
        feature: null,
        priority: 2,
        tags: [],
        related_to: [],
      });

      store.create({
        content: "also no embedding",
        type: "convention",
        scope: "global",
        feature: null,
        priority: 2,
        tags: [],
        related_to: [],
      });

      const count = await backfillEmbeddings(db, fakeEmbedder);
      expect(count).toBe(2);

      const nullCount = db
        .prepare("SELECT COUNT(*) as cnt FROM memories WHERE embedding IS NULL")
        .get() as { cnt: number };
      expect(nullCount.cnt).toBe(0);
    });

    it("skips memories that already have embeddings", async () => {
      const embedding = Buffer.alloc(384 * 4);
      store.create({
        content: "has embedding",
        type: "note",
        scope: "global",
        feature: null,
        priority: 2,
        tags: [],
        related_to: [],
        embedding,
      });

      store.create({
        content: "no embedding",
        type: "note",
        scope: "global",
        feature: null,
        priority: 2,
        tags: [],
        related_to: [],
      });

      const count = await backfillEmbeddings(db, fakeEmbedder);
      expect(count).toBe(1);
    });

    it("returns 0 when all memories have embeddings", async () => {
      const embedding = Buffer.alloc(384 * 4);
      store.create({
        content: "already embedded",
        type: "note",
        scope: "global",
        feature: null,
        priority: 2,
        tags: [],
        related_to: [],
        embedding,
      });

      const count = await backfillEmbeddings(db, fakeEmbedder);
      expect(count).toBe(0);
    });
  });
});
