import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../src/store.js";
import { MemorySearch } from "../src/search.js";
import { createTestDb, teardownTestDb } from "./helpers.js";
import Database from "better-sqlite3";

describe("MemorySearch", () => {
  let db: Database.Database;
  let store: MemoryStore;
  let search: MemorySearch;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = createTestDb());
    store = new MemoryStore(db);
    search = new MemorySearch(db);

    store.create({ content: "Always use TypeScript strict mode", type: "convention", scope: "proj-1", feature: null, priority: 1, tags: ["typescript"], related_to: [] });
    store.create({ content: "Use vitest for all unit tests", type: "convention", scope: "proj-1", feature: null, priority: 2, tags: ["testing"], related_to: [] });
    store.create({ content: "Global logging convention", type: "convention", scope: "global", feature: null, priority: 2, tags: ["logging"], related_to: [] });
    store.create({ content: "Auth feature uses JWT tokens", type: "decision", scope: "proj-1", feature: "auth-refactor", priority: 1, tags: ["auth"], related_to: [] });
  });

  afterEach(() => {
    teardownTestDb(db, dbPath);
  });

  describe("query", () => {
    it("finds memories by FTS match", () => {
      const results = search.query({
        query: "TypeScript",
        projectId: "proj-1",
        feature: null,
      });

      expect(results.memories.length).toBeGreaterThan(0);
      expect(results.memories[0].content).toContain("TypeScript");
    });

    it("filters by type", () => {
      const results = search.query({
        query: "convention",
        projectId: "proj-1",
        feature: null,
        type: "decision",
      });

      const types = results.memories.map((m) => m.type);
      expect(types.every((t) => t === "decision")).toBe(true);
    });

    it("filters by tags", () => {
      const results = search.query({
        query: "tests testing",
        projectId: "proj-1",
        feature: null,
        tags: ["testing"],
      });

      expect(results.memories.length).toBeGreaterThan(0);
      expect(results.memories[0].tags).toContain("testing");
    });

    it("respects token budget", () => {
      const results = search.query({
        query: "convention",
        projectId: "proj-1",
        feature: null,
        token_budget: 20,
      });

      const totalTokens = results.memories.reduce(
        (sum, m) => sum + m.estimated_tokens,
        0
      );
      expect(totalTokens).toBeLessThanOrEqual(20);
      expect(results.remaining_count).toBeGreaterThanOrEqual(0);
    });

    it("includes global memories in project queries", () => {
      const results = search.query({
        query: "logging",
        projectId: "proj-1",
        feature: null,
      });

      expect(results.memories.length).toBeGreaterThan(0);
      expect(results.memories.some((m) => m.scope === "global")).toBe(true);
    });
  });

  describe("context", () => {
    it("returns high-priority memories first", () => {
      const results = search.context({
        projectId: "proj-1",
        feature: null,
        token_budget: 4000,
      });

      expect(results.memories.length).toBeGreaterThan(0);
      expect(results.memories[0].priority).toBe(1);
    });

    it("respects token budget", () => {
      const results = search.context({
        projectId: "proj-1",
        feature: null,
        token_budget: 30,
      });

      const totalTokens = results.memories.reduce(
        (sum, m) => sum + m.estimated_tokens,
        0
      );
      expect(totalTokens).toBeLessThanOrEqual(30);
    });

    it("includes feature memories when feature is set", () => {
      const results = search.context({
        projectId: "proj-1",
        feature: "auth-refactor",
        token_budget: 4000,
      });

      expect(
        results.memories.some((m) => m.feature === "auth-refactor")
      ).toBe(true);
    });
  });

  describe("webQuery", () => {
    it("searches across all scopes without projectId", () => {
      const results = search.webQuery({
        query: "TypeScript",
        limit: 50,
        offset: 0,
      });

      expect(results.memories.length).toBeGreaterThan(0);
      expect(results.memories[0].content).toContain("TypeScript");
      expect(results.total).toBeGreaterThan(0);
    });

    it("filters by scope when provided", () => {
      const results = search.webQuery({
        query: "convention",
        scope: "global",
        limit: 50,
        offset: 0,
      });

      expect(results.memories.every((m) => m.scope === "global")).toBe(true);
    });

    it("filters by type", () => {
      const results = search.webQuery({
        query: "JWT tokens auth",
        type: "decision",
        limit: 50,
        offset: 0,
      });

      expect(results.memories.every((m) => m.type === "decision")).toBe(true);
    });

    it("filters by tag", () => {
      const results = search.webQuery({
        query: "TypeScript strict",
        tag: "typescript",
        limit: 50,
        offset: 0,
      });

      expect(results.memories.length).toBeGreaterThan(0);
      expect(results.memories[0].tags).toContain("typescript");
    });

    it("paginates with limit and offset", () => {
      const all = search.webQuery({ query: "convention", limit: 50, offset: 0 });
      const page = search.webQuery({ query: "convention", limit: 1, offset: 0 });

      expect(page.memories.length).toBe(1);
      expect(page.total).toBe(all.total);
    });

    it("returns memories with tags and relations", () => {
      const results = search.webQuery({ query: "TypeScript", limit: 50, offset: 0 });

      expect(results.memories[0].tags).toContain("typescript");
      expect(results.memories[0].relations).toBeDefined();
    });

    it("returns limit and offset in result", () => {
      const results = search.webQuery({ query: "TypeScript", limit: 10, offset: 5 });

      expect(results.limit).toBe(10);
      expect(results.offset).toBe(5);
    });
  });
});
