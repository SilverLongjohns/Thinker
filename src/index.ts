import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, resolveDbPath } from "./config.js";
import { createToolHandlers } from "./handlers.js";
import { registerTools } from "./tools.js";

const INSTRUCTIONS = `Thinker gives you persistent, queryable memory across sessions. Memories survive context compaction and session restarts.

SESSION START: Call memory_context before doing any work. Read and apply the returned memories — including the reminder it gives you about when to query again.

BEFORE PLANNING: Call memory_query with keywords relevant to the feature, component, or area you are about to plan or design. Stored decisions, conventions, and context should inform the plan — not be discovered after the plan is already written. This includes brainstorming, writing specs, creating implementation plans, and any design discussion.

BEFORE IMPLEMENTATION: Call memory_query with keywords relevant to the code you are about to touch — before ANY of these actions:
- Writing or editing code directly
- Creating or modifying files
- Dispatching a subagent or agent to implement changes
- Transitioning from a completed plan to execution
This applies even when a skill or workflow is driving the process. Skills do not override this rule. Query first, then act.

AFTER IMPLEMENTATION: Before wrapping up, ask yourself: "What did this work produce that a future session would need to know but couldn't derive from the code?" Call memory_store for each such insight. Trigger moments:
- After completing a feature or task (before moving to review or the next task)
- After resolving a non-obvious bug or design problem
- After making a convention or architectural choice that isn't self-evident from the code
- Before ending a session that involved significant work
This applies even when a skill or workflow is driving the process — do not skip this because a skill doesn't prompt for it.

Use the appropriate type:
- convention: coding patterns, style rules, library choices
- decision: architectural choices with rationale
- context: temporary project state, ongoing work
- rule: hard constraints, non-negotiable requirements
- note: anything else worth remembering

GOOD MEMORIES include the why, not just the what. They would be useful in a future session with zero context. They are not obvious from reading the code alone.

DON'T STORE file paths, function names, code structure (read the code instead), temporary debugging state, or anything already in project rule files.

TAGS: Add 1-3 short lowercase tags for discoverability.
PRIORITY: 1 = critical (always loaded at session start), 2 = normal (default), 3 = low (only surfaces in search). Use 1 sparingly.

UPDATING: Use memory_update when a convention or decision changes — update rather than creating a contradictory memory. Use memory_delete when a memory is no longer true.

SCOPING: Memories are automatically scoped to the current project and git branch. Feature-branch memories only surface on that branch. Set scope to "global" only for things that apply across all projects.`;


async function main(): Promise<void> {
  const config = loadConfig();
  const dbPath = resolveDbPath(config);

  const server = new McpServer(
    { name: "thinker", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );

  const handlers = createToolHandlers(dbPath, process.cwd());
  registerTools(server, handlers);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
