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
