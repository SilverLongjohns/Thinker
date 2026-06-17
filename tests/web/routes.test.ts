import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../src/store.js";
import { createTestDb, teardownTestDb } from "../helpers.js";
import { getMemories, getStats } from "../../src/web/routes.js";
import Database from "better-sqlite3";

describe("Web Routes", () => {
  let db: Database.Database;
  let store: MemoryStore;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = createTestDb());
    store = new MemoryStore(db);

    store.create({ content: "Use TypeScript strict mode", type: "convention", scope: "proj-1", feature: null, priority: 1, tags: ["typescript", "config"], related_to: [] });
    store.create({ content: "JWT for authentication", type: "decision", scope: "proj-1", feature: "auth", priority: 2, tags: ["auth", "security"], related_to: [] });
    store.create({ content: "Global logging standard", type: "rule", scope: "global", feature: null, priority: 2, tags: ["logging"], related_to: [] });
    store.create({ content: "Use vitest for tests", type: "convention", scope: "proj-1", feature: null, priority: 3, tags: ["testing"], related_to: [] });
  });

  afterEach(() => {
    teardownTestDb(db, dbPath);
  });

  describe("getMemories", () => {
    it("returns all memories with default pagination", () => {
      const result = getMemories(db, new URLSearchParams());
      expect(result.memories.length).toBe(4);
      expect(result.total).toBe(4);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });

    it("sorts by created_at desc by default", () => {
      const result = getMemories(db, new URLSearchParams());
      const times = result.memories.map((m) => m.created_at);
      for (let i = 1; i < times.length; i++) {
        expect(times[i - 1] >= times[i]).toBe(true);
      }
    });

    it("sorts by created_at asc", () => {
      const result = getMemories(db, new URLSearchParams({ sort: "created_at_asc" }));
      const times = result.memories.map((m) => m.created_at);
      for (let i = 1; i < times.length; i++) {
        expect(times[i - 1] <= times[i]).toBe(true);
      }
    });

    it("sorts by priority ascending", () => {
      const result = getMemories(db, new URLSearchParams({ sort: "priority_asc" }));
      expect(result.memories[0].priority).toBe(1);
    });

    it("filters by type", () => {
      const result = getMemories(db, new URLSearchParams({ type: "decision" }));
      expect(result.memories.length).toBe(1);
      expect(result.memories[0].type).toBe("decision");
      expect(result.total).toBe(1);
    });

    it("filters by scope", () => {
      const result = getMemories(db, new URLSearchParams({ scope: "global" }));
      expect(result.memories.length).toBe(1);
      expect(result.memories[0].scope).toBe("global");
    });

    it("filters by tag", () => {
      const result = getMemories(db, new URLSearchParams({ tag: "typescript" }));
      expect(result.memories.length).toBe(1);
      expect(result.memories[0].tags).toContain("typescript");
    });

    it("filters by priority", () => {
      const result = getMemories(db, new URLSearchParams({ priority: "1" }));
      expect(result.memories.length).toBe(1);
      expect(result.memories[0].priority).toBe(1);
    });

    it("paginates with limit and offset", () => {
      const page1 = getMemories(db, new URLSearchParams({ limit: "2", offset: "0" }));
      expect(page1.memories.length).toBe(2);
      expect(page1.total).toBe(4);

      const page2 = getMemories(db, new URLSearchParams({ limit: "2", offset: "2" }));
      expect(page2.memories.length).toBe(2);
      expect(page2.memories[0].id).not.toBe(page1.memories[0].id);
    });

    it("clamps limit to 200", () => {
      const result = getMemories(db, new URLSearchParams({ limit: "999" }));
      expect(result.limit).toBe(200);
    });

    it("searches with FTS when q is provided", () => {
      const result = getMemories(db, new URLSearchParams({ q: "TypeScript" }));
      expect(result.memories.length).toBeGreaterThan(0);
      expect(result.memories[0].content).toContain("TypeScript");
    });

    it("combines FTS search with type filter", () => {
      const result = getMemories(db, new URLSearchParams({ q: "convention", type: "convention" }));
      expect(result.memories.every((m) => m.type === "convention")).toBe(true);
    });

    it("includes tags and relations in results", () => {
      const result = getMemories(db, new URLSearchParams());
      const memory = result.memories.find((m) => m.content.includes("TypeScript"));
      expect(memory?.tags).toContain("typescript");
      expect(memory?.tags).toContain("config");
      expect(memory?.relations).toBeDefined();
    });
  });

  describe("getStats", () => {
    it("returns total count", () => {
      const stats = getStats(db);
      expect(stats.total).toBe(4);
    });

    it("returns counts by type", () => {
      const stats = getStats(db);
      expect(stats.by_type.convention).toBe(2);
      expect(stats.by_type.decision).toBe(1);
      expect(stats.by_type.rule).toBe(1);
    });

    it("returns counts by scope", () => {
      const stats = getStats(db);
      expect(stats.by_scope["proj-1"]).toBe(3);
      expect(stats.by_scope.global).toBe(1);
    });

    it("returns project name map", () => {
      db.prepare("INSERT INTO projects (id, name, paths, created_at) VALUES (?, ?, ?, ?)").run("proj-1", "My Project", '["./"]', "2024-01-01T00:00:00.000Z");
      const stats = getStats(db);
      expect(stats.projects["proj-1"]).toBe("My Project");
    });

    it("returns top tags sorted by count desc", () => {
      const stats = getStats(db);
      expect(stats.top_tags.length).toBeGreaterThan(0);
      for (let i = 1; i < stats.top_tags.length; i++) {
        expect(stats.top_tags[i - 1].count).toBeGreaterThanOrEqual(stats.top_tags[i].count);
      }
    });

    it("returns empty stats for empty database", () => {
      db.prepare("DELETE FROM memories").run();
      const stats = getStats(db);
      expect(stats.total).toBe(0);
      expect(stats.by_type).toEqual({});
      expect(stats.by_scope).toEqual({});
      expect(stats.projects).toEqual({});
      expect(stats.top_tags).toEqual([]);
    });
  });
});
