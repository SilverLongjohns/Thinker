import { MemoryStore } from "./store.js";
import { MemorySearch } from "./search.js";
import {
  getCurrentBranch,
  detectFeature,
  detectProjectId,
  detectProjectName,
} from "./project.js";
import { withDb } from "./db.js";
import type { MemoryType, Priority } from "./types.js";

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface ToolHandlers {
  memory_store: (args: any) => Promise<ToolResult>;
  memory_query: (args: any) => Promise<ToolResult>;
  memory_context: (args: any) => Promise<ToolResult>;
  memory_update: (args: any) => Promise<ToolResult>;
  memory_delete: (args: any) => Promise<ToolResult>;
  memory_export: (args: any) => Promise<ToolResult>;
}

function textResult(data: any): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function errorResult(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function ensureProject(dbPath: string, cwd: string, projectId: string): void {
  withDb(dbPath, (db) => {
    const existing = db
      .prepare("SELECT paths FROM projects WHERE id = ?")
      .get(projectId) as { paths: string } | undefined;

    if (existing) {
      const paths: string[] = JSON.parse(existing.paths);
      if (!paths.includes(cwd)) {
        paths.push(cwd);
        db.prepare("UPDATE projects SET paths = ? WHERE id = ?").run(
          JSON.stringify(paths),
          projectId
        );
      }
    } else {
      db.prepare(
        "INSERT INTO projects (id, name, paths, created_at) VALUES (?, ?, ?, ?)"
      ).run(projectId, detectProjectName(cwd), JSON.stringify([cwd]), new Date().toISOString());
    }
  });
}

export function createToolHandlers(
  dbPath: string,
  cwd: string
): ToolHandlers {
  let cachedProjectId: string | undefined;

  function getProjectId(): string {
    if (!cachedProjectId) {
      cachedProjectId = detectProjectId(cwd);
      ensureProject(dbPath, cwd, cachedProjectId);
    }
    return cachedProjectId;
  }

  function getCurrentFeature(): string | null {
    try {
      const branch = getCurrentBranch(cwd);
      return branch ? detectFeature(branch) : null;
    } catch {
      return null;
    }
  }

  return {
    async memory_store(args) {
      try {
        const result = withDb(dbPath, (db) =>
          new MemoryStore(db).create({
            content: args.content,
            type: args.type as MemoryType,
            scope: args.scope ?? getProjectId(),
            feature: args.feature ?? getCurrentFeature(),
            priority: (args.priority ?? 2) as Priority,
            tags: args.tags ?? [],
            related_to: args.related_to ?? [],
          })
        );
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },

    async memory_query(args) {
      try {
        const result = withDb(dbPath, (db) =>
          new MemorySearch(db).query({
            query: args.query,
            projectId: getProjectId(),
            feature: getCurrentFeature(),
            tags: args.tags,
            type: args.type as MemoryType | undefined,
            scope: args.scope,
            limit: args.limit,
            token_budget: args.token_budget,
          })
        );
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },

    async memory_context(args) {
      try {
        const result = withDb(dbPath, (db) =>
          new MemorySearch(db).context({
            projectId: getProjectId(),
            feature: getCurrentFeature(),
            token_budget: args.token_budget,
          })
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result) },
            {
              type: "text" as const,
              text: "REMINDER: (1) Call memory_query before planning AND before implementing. (2) Call memory_store after completing work — ask yourself what a future session would need to know that isn't obvious from the code. These apply even when a skill or workflow is driving the process.",
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    },

    async memory_update(args) {
      try {
        const result = withDb(dbPath, (db) =>
          new MemoryStore(db).update(args.id, {
            content: args.content,
            type: args.type as MemoryType | undefined,
            tags: args.tags,
            priority: args.priority as Priority | undefined,
            related_to: args.related_to,
          })
        );
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },

    async memory_delete(args) {
      try {
        withDb(dbPath, (db) => new MemoryStore(db).delete(args.id));
        return textResult({ deleted: true, id: args.id });
      } catch (err) {
        return errorResult(err);
      }
    },

    async memory_export(args) {
      try {
        const memories = withDb(dbPath, (db) =>
          new MemoryStore(db).exportMemories(args.scope)
        );
        return textResult({ memories });
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}
