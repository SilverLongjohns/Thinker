import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../src/store.js";
import { MemorySearch } from "../src/search.js";
import { vectorToBlob } from "../src/embeddings.js";
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

  describe("hybrid query", () => {
    function makeVec(direction: number[]): Float32Array {
      const vec = new Float32Array(384);
      let norm = 0;
      for (let i = 0; i < direction.length; i++) {
        vec[i] = direction[i];
        norm += direction[i] * direction[i];
      }
      norm = Math.sqrt(norm);
      for (let i = 0; i < direction.length; i++) vec[i] /= norm;
      return vec;
    }

    it("finds both meaning-only and exact-token matches", () => {
      const db2 = db;
      const store2 = new MemoryStore(db2);
      const search2 = new MemorySearch(db2);

      // Exact-token match: FTS finds "quality" and "code"
      store2.create({
        content: "write high quality code with clear naming",
        type: "convention",
        scope: "test-proj",
        feature: null,
        priority: 2,
        tags: [],
        related_to: [],
        embedding: vectorToBlob(makeVec([0.6, 0.8])),
      });

      // Meaning-only match: no keyword overlap with "code quality"
      // but semantically similar (about software standards)
      store2.create({
        content: "follow team conventions for clean maintainable software",
        type: "convention",
        scope: "test-proj",
        feature: null,
        priority: 2,
        tags: [],
        related_to: [],
        embedding: vectorToBlob(makeVec([0.95, 0.31])),
      });

      // Unrelated: neither keyword nor semantic match
      store2.create({
        content: "database backup schedule runs at midnight",
        type: "note",
        scope: "test-proj",
        feature: null,
        priority: 3,
        tags: [],
        related_to: [],
        embedding: vectorToBlob(makeVec([0, 0, 1])),
      });

      const queryVec = makeVec([1, 0]);

      const results = search2.query({
        query: "code quality",
        projectId: "test-proj",
        feature: null,
        queryVec,
      });

      const contents = results.memories.map((m) => m.content);

      // FTS match survives
      expect(contents).toContain(
        "write high quality code with clear naming"
      );
      // Meaning-only match survives
      expect(contents).toContain(
        "follow team conventions for clean maintainable software"
      );
      // Unrelated does NOT appear
      expect(contents).not.toContain(
        "database backup schedule runs at midnight"
      );
    });

    it("falls back to pure FTS when no queryVec provided", () => {
      const results = search.query({
        query: "TypeScript",
        projectId: "proj-1",
        feature: null,
      });

      expect(results.memories.length).toBeGreaterThan(0);
      expect(results.memories[0].content).toContain("TypeScript");
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

    describe("semantic ranking with queryVec", () => {
      function makeVec(direction: number[]): Float32Array {
        const vec = new Float32Array(384);
        let norm = 0;
        for (let i = 0; i < direction.length; i++) {
          vec[i] = direction[i];
          norm += direction[i] * direction[i];
        }
        norm = Math.sqrt(norm);
        for (let i = 0; i < direction.length; i++) vec[i] /= norm;
        return vec;
      }

      it("P1 memories always appear first regardless of query", () => {
        const semDb = db;
        const semStore = new MemoryStore(semDb);
        const semSearch = new MemorySearch(semDb);

        // P1: unrelated to query but must appear
        semStore.create({
          content: "critical: never delete production data",
          type: "convention",
          scope: "sem-proj",
          feature: null,
          priority: 1,
          tags: [],
          related_to: [],
          embedding: vectorToBlob(makeVec([0, 0, 1])),
        });

        // P2: highly relevant to query
        semStore.create({
          content: "use React hooks for state management",
          type: "convention",
          scope: "sem-proj",
          feature: null,
          priority: 2,
          tags: [],
          related_to: [],
          embedding: vectorToBlob(makeVec([1, 0])),
        });

        const results = semSearch.context({
          projectId: "sem-proj",
          feature: null,
          token_budget: 4000,
          queryVec: makeVec([1, 0]),
        });

        expect(results.memories.length).toBeGreaterThanOrEqual(2);
        expect(results.memories[0].priority).toBe(1);
        expect(results.memories[0].content).toContain("never delete production data");
      });

      it("reranks P2/P3 memories by semantic similarity", () => {
        const semDb = db;
        const semStore = new MemoryStore(semDb);
        const semSearch = new MemorySearch(semDb);

        // P2: low semantic relevance
        semStore.create({
          content: "database backups run nightly",
          type: "note",
          scope: "rank-proj",
          feature: null,
          priority: 2,
          tags: [],
          related_to: [],
          embedding: vectorToBlob(makeVec([0, 0, 1])),
        });

        // P2: high semantic relevance
        semStore.create({
          content: "prefer functional components over class components",
          type: "convention",
          scope: "rank-proj",
          feature: null,
          priority: 2,
          tags: [],
          related_to: [],
          embedding: vectorToBlob(makeVec([0.95, 0.31])),
        });

        // P3: medium semantic relevance
        semStore.create({
          content: "review UI patterns before building new screens",
          type: "note",
          scope: "rank-proj",
          feature: null,
          priority: 3,
          tags: [],
          related_to: [],
          embedding: vectorToBlob(makeVec([0.7, 0.7])),
        });

        const queryVec = makeVec([1, 0]);

        const results = semSearch.context({
          projectId: "rank-proj",
          feature: null,
          token_budget: 4000,
          queryVec,
        });

        const contents = results.memories.map((m) => m.content);
        const funcIdx = contents.indexOf("prefer functional components over class components");
        const reviewIdx = contents.indexOf("review UI patterns before building new screens");
        const dbIdx = contents.indexOf("database backups run nightly");

        // Higher similarity ranks earlier among P2/P3
        expect(funcIdx).toBeLessThan(dbIdx);
        expect(reviewIdx).toBeLessThan(dbIdx);
      });

      it("handles memories without embeddings gracefully", () => {
        const semDb = db;
        const semStore = new MemoryStore(semDb);
        const semSearch = new MemorySearch(semDb);

        // No embedding — should still appear
        semStore.create({
          content: "legacy memory without vector",
          type: "note",
          scope: "null-proj",
          feature: null,
          priority: 2,
          tags: [],
          related_to: [],
        });

        // With embedding
        semStore.create({
          content: "modern memory with vector",
          type: "note",
          scope: "null-proj",
          feature: null,
          priority: 2,
          tags: [],
          related_to: [],
          embedding: vectorToBlob(makeVec([1, 0])),
        });

        const results = semSearch.context({
          projectId: "null-proj",
          feature: null,
          token_budget: 4000,
          queryVec: makeVec([1, 0]),
        });

        const contents = results.memories.map((m) => m.content);
        expect(contents).toContain("legacy memory without vector");
        expect(contents).toContain("modern memory with vector");
      });
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
