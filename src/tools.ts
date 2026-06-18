import { z } from "zod";
import { MEMORY_TYPES } from "./types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolHandlers } from "./handlers.js";

const memoryTypeEnum = z.enum(MEMORY_TYPES);

export function registerTools(
  server: McpServer,
  handlers: ToolHandlers
): void {
  server.tool(
    "memory_store",
    "Save a new memory",
    {
      content: z.string(),
      type: memoryTypeEnum,
      tags: z.array(z.string()).optional(),
      priority: z.number().optional(),
      scope: z.string().optional(),
      feature: z.string().optional(),
      related_to: z.array(z.string()).optional(),
    },
    async (args) => handlers.memory_store(args)
  );

  server.tool(
    "memory_query",
    "Search memories by relevance",
    {
      query: z.string(),
      tags: z.array(z.string()).optional(),
      type: memoryTypeEnum.optional(),
      scope: z.string().optional(),
      limit: z.number().optional(),
      token_budget: z.number().optional(),
    },
    async (args) => handlers.memory_query(args)
  );

  server.tool(
    "memory_context",
    "Session bootstrap — returns high-priority memories for current project. Optional query ranks P2/P3 memories by relevance to the current task.",
    {
      query: z.string().optional().describe("Current task description — used to semantically rank lower-priority memories"),
      token_budget: z.number().optional(),
    },
    async (args) => handlers.memory_context(args)
  );

  server.tool(
    "memory_update",
    "Modify an existing memory",
    {
      id: z.string(),
      content: z.string().optional(),
      type: memoryTypeEnum.optional(),
      tags: z.array(z.string()).optional(),
      priority: z.number().optional(),
      related_to: z.array(z.string()).optional(),
    },
    async (args) => handlers.memory_update(args)
  );

  server.tool(
    "memory_delete",
    "Remove a memory",
    {
      id: z.string(),
    },
    async (args) => handlers.memory_delete(args)
  );

  server.tool(
    "memory_export",
    "Dump memories to JSON for backup",
    {
      scope: z.string().optional(),
    },
    async (args) => handlers.memory_export(args)
  );
}
