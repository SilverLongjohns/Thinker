import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../src/store.js";
import { createTestDb, teardownTestDb } from "./helpers.js";
import Database from "better-sqlite3";

describe("MemoryStore", () => {
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

  describe("create", () => {
    it("creates a memory and returns it with tags", () => {
      const result = store.create({
        content: "Use vitest for all tests",
        type: "convention",
        scope: "project-123",
        feature: null,
        priority: 2,
        tags: ["testing"],
        related_to: [],
      });

      expect(result.id).toBeTruthy();
      expect(result.content).toBe("Use vitest for all tests");
      expect(result.type).toBe("convention");
      expect(result.tags).toEqual(["testing"]);
    });

    it("rejects content over max length", () => {
      expect(() =>
        store.create({
          content: "x".repeat(2001),
          type: "note",
          scope: "global",
          feature: null,
          priority: 2,
          tags: [],
          related_to: [],
        })
      ).toThrow("exceeds maximum");
    });

    it("rejects invalid type", () => {
      expect(() =>
        store.create({
          content: "test",
          type: "invalid" as any,
          scope: "global",
          feature: null,
          priority: 2,
          tags: [],
          related_to: [],
        })
      ).toThrow("Invalid memory type");
    });

    it("rejects feature on global scope", () => {
      expect(() =>
        store.create({
          content: "test",
          type: "note",
          scope: "global",
          feature: "some-feature",
          priority: 2,
          tags: [],
          related_to: [],
        })
      ).toThrow("feature must be null");
    });

    it("returns existing memory on duplicate content", () => {
      const first = store.create({
        content: "unique content",
        type: "note",
        scope: "global",
        feature: null,
        priority: 2,
        tags: [],
        related_to: [],
      });

      const second = store.create({
        content: "unique content",
        type: "note",
        scope: "global",
        feature: null,
        priority: 2,
        tags: [],
        related_to: [],
      });

      expect(second.id).toBe(first.id);
    });
  });

  describe("update", () => {
    it("updates content and recalculates hash", () => {
      const created = store.create({
        content: "original",
        type: "note",
        scope: "global",
        feature: null,
        priority: 2,
        tags: [],
        related_to: [],
      });

      const updated = store.update(created.id, { content: "updated" });
      expect(updated.content).toBe("updated");
      expect(updated.content_hash).not.toBe(created.content_hash);
    });

    it("updates tags", () => {
      const created = store.create({
        content: "test",
        type: "note",
        scope: "global",
        feature: null,
        priority: 2,
        tags: ["old"],
        related_to: [],
      });

      const updated = store.update(created.id, { tags: ["new", "tags"] });
      expect(updated.tags).toEqual(["new", "tags"]);
    });

    it("throws on nonexistent id", () => {
      expect(() => store.update("nonexistent", { content: "x" })).toThrow(
        "not found"
      );
    });
  });

  describe("delete", () => {
    it("removes a memory", () => {
      const created = store.create({
        content: "to delete",
        type: "note",
        scope: "global",
        feature: null,
        priority: 2,
        tags: ["tag1"],
        related_to: [],
      });

      store.delete(created.id);

      expect(() => store.update(created.id, { content: "x" })).toThrow(
        "not found"
      );
    });

    it("throws on nonexistent id", () => {
      expect(() => store.delete("nonexistent")).toThrow("not found");
    });
  });

  describe("getById", () => {
    it("returns a memory with its tags and relations", () => {
      const created = store.create({
        content: "findable",
        type: "decision",
        scope: "proj-1",
        feature: null,
        priority: 1,
        tags: ["arch", "api"],
        related_to: [],
      });

      const found = store.getById(created.id);
      expect(found).not.toBeNull();
      expect(found!.content).toBe("findable");
      expect(found!.tags).toEqual(["api", "arch"]);
      expect(found!.relations).toEqual([]);
    });

    it("returns null for nonexistent id", () => {
      expect(store.getById("nonexistent")).toBeNull();
    });
  });

  describe("exportMemories", () => {
    it("exports all memories with tags and relations", () => {
      store.create({
        content: "memory one",
        type: "note",
        scope: "global",
        feature: null,
        priority: 2,
        tags: ["a"],
        related_to: [],
      });

      store.create({
        content: "memory two",
        type: "decision",
        scope: "proj-1",
        feature: null,
        priority: 1,
        tags: ["b"],
        related_to: [],
      });

      const all = store.exportMemories();
      expect(all.length).toBe(2);
      expect(all[0].relations).toEqual([]);

      const scoped = store.exportMemories("proj-1");
      expect(scoped.length).toBe(1);
      expect(scoped[0].content).toBe("memory two");
    });
  });
});
