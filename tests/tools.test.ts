import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createToolHandlers, type ToolHandlers } from "../src/handlers.js";
import { detectProjectId } from "../src/project.js";
import { createTestDb, teardownTestDb } from "./helpers.js";
import Database from "better-sqlite3";

describe("Tool Handlers", () => {
  let db: Database.Database;
  let handlers: ToolHandlers;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = createTestDb());
    handlers = createToolHandlers(dbPath, process.cwd());
  });

  afterEach(() => {
    teardownTestDb(db, dbPath);
  });

  describe("memory_store", () => {
    it("stores a memory and returns it", async () => {
      const result = await handlers.memory_store({
        content: "Use strict mode",
        type: "convention",
        tags: ["typescript"],
      });

      expect(result.content[0].type).toBe("text");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.content).toBe("Use strict mode");
      expect(parsed.tags).toEqual(["typescript"]);
    });

    it("uses current project as default scope", async () => {
      const result = await handlers.memory_store({
        content: "project-scoped",
        type: "note",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.scope).toBe(detectProjectId(process.cwd()));
    });
  });

  describe("memory_query", () => {
    it("returns matching memories", async () => {
      await handlers.memory_store({
        content: "Always use TypeScript strict mode",
        type: "convention",
      });

      const result = await handlers.memory_query({ query: "TypeScript" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.memories.length).toBeGreaterThan(0);
    });
  });

  describe("memory_context", () => {
    it("returns high-priority memories", async () => {
      await handlers.memory_store({
        content: "Critical convention",
        type: "convention",
        priority: 1,
      });

      const result = await handlers.memory_context({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.memories.length).toBeGreaterThan(0);
    });
  });

  describe("memory_update", () => {
    it("updates an existing memory", async () => {
      const storeResult = await handlers.memory_store({
        content: "original content",
        type: "note",
      });
      const id = JSON.parse(storeResult.content[0].text).id;

      const result = await handlers.memory_update({
        id,
        content: "updated content",
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.content).toBe("updated content");
    });
  });

  describe("memory_delete", () => {
    it("deletes an existing memory", async () => {
      const storeResult = await handlers.memory_store({
        content: "to be deleted",
        type: "note",
      });
      const id = JSON.parse(storeResult.content[0].text).id;

      const result = await handlers.memory_delete({ id });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.deleted).toBe(true);
    });
  });

  describe("memory_export", () => {
    it("exports all memories", async () => {
      await handlers.memory_store({ content: "memory one", type: "note" });
      await handlers.memory_store({
        content: "memory two",
        type: "decision",
      });

      const result = await handlers.memory_export({});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.memories.length).toBe(2);
    });
  });

  describe("embedding integration", () => {
    it("stores embedding when embedFn is provided", async () => {
      const fakeEmbed = async (_text: string) => {
        const vec = new Float32Array(384);
        for (let i = 0; i < 384; i++) vec[i] = 0.5;
        return vec;
      };

      const embeddingHandlers = createToolHandlers(dbPath, process.cwd(), fakeEmbed);
      const result = await embeddingHandlers.memory_store({
        content: "test with embedding",
        type: "note",
      });

      const parsed = JSON.parse(result.content[0].text);
      const row = db
        .prepare("SELECT embedding FROM memories WHERE id = ?")
        .get(parsed.id) as { embedding: Buffer | null };

      expect(row.embedding).not.toBeNull();
      expect(row.embedding!.length).toBe(384 * 4);
    });

    it("updates embedding when content changes", async () => {
      const fakeEmbed = async (text: string) => {
        const vec = new Float32Array(384);
        vec[0] = text.length;
        return vec;
      };

      const embeddingHandlers = createToolHandlers(dbPath, process.cwd(), fakeEmbed);
      const storeResult = await embeddingHandlers.memory_store({
        content: "original",
        type: "note",
      });
      const id = JSON.parse(storeResult.content[0].text).id;

      await embeddingHandlers.memory_update({
        id,
        content: "updated content that is longer",
      });

      const row = db
        .prepare("SELECT embedding FROM memories WHERE id = ?")
        .get(id) as { embedding: Buffer };

      const vec = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.length / 4
      );
      expect(vec[0]).toBe("updated content that is longer".length);
    });

    it("passes queryVec to context when query provided", async () => {
      let embeddedTexts: string[] = [];
      const fakeEmbed = async (text: string) => {
        embeddedTexts.push(text);
        const vec = new Float32Array(384);
        vec[0] = 1;
        return vec;
      };

      const embeddingHandlers = createToolHandlers(dbPath, process.cwd(), fakeEmbed);
      await embeddingHandlers.memory_store({
        content: "test memory",
        type: "convention",
        priority: 1,
      });

      embeddedTexts = [];
      await embeddingHandlers.memory_context({ query: "find relevant stuff" });

      expect(embeddedTexts).toContain("find relevant stuff");
    });

    it("does not embed when no embedFn provided", async () => {
      const result = await handlers.memory_store({
        content: "no embedding handler",
        type: "note",
      });

      const parsed = JSON.parse(result.content[0].text);
      const row = db
        .prepare("SELECT embedding FROM memories WHERE id = ?")
        .get(parsed.id) as { embedding: Buffer | null };

      expect(row.embedding).toBeNull();
    });
  });

  describe("error handling", () => {
    it("returns isError for invalid content", async () => {
      const result = await handlers.memory_store({
        content: "x".repeat(2001),
        type: "note",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("exceeds maximum");
    });

    it("returns isError for nonexistent delete", async () => {
      const result = await handlers.memory_delete({ id: "nonexistent" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });
  });
});
