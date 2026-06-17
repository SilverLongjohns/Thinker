## Thinker — Persistent Project Memory

Thinker is a local MCP memory server. It gives you persistent, queryable memory across sessions for this project. Memories survive context compaction and session restarts.

### Setup

If the `memory_context` tool is not available, Thinker is not registered yet. Register it by ensuring `.mcp.json` in the project root contains:

```json
{
  "mcpServers": {
    "thinker": {
      "command": "node",
      "args": ["/absolute/path/to/thinker/dist/index.js"]
    }
  }
}
```

If `.mcp.json` already exists with other servers, merge the `thinker` key into the existing `mcpServers` object. After creating or updating the file, tell the user to restart the session so Claude Code picks up the new MCP server.

### Session Start

Call `memory_context` at the beginning of every session. This returns high-priority memories scoped to the current project and branch — conventions, decisions, and context from previous sessions. Use these to orient yourself before doing any work.

### When to Store Memories

Before wrapping up, ask yourself: "What did this work produce that a future session would need to know but couldn't derive from the code?" Call `memory_store` for each such insight at these moments:
- After completing a feature or task (before moving to review or the next task)
- After resolving a non-obvious bug or design problem
- After making a convention or architectural choice that isn't self-evident from the code
- Before ending a session that involved significant work

This applies even when a skill or workflow is driving the process — do not skip this because a skill doesn't prompt for it.

Use `memory_store` with the appropriate type:

| Type | When to use | Example |
|------|------------|---------|
| `convention` | Coding patterns, style rules, library choices | "We use Zustand for state, not Redux" |
| `decision` | Architectural choices with rationale | "Chose SSR for SEO pages — CSR was too slow for Googlebot" |
| `context` | Temporary project state, ongoing work | "Billing module rewrite in progress — don't modify legacy billing code" |
| `rule` | Hard constraints, non-negotiable requirements | "All API responses must include request_id for tracing" |
| `note` | Anything else worth remembering | "Jake prefers terse PR descriptions" |

**What makes a good memory:**
- It would be useful in a future session where you have zero context
- It's not obvious from reading the code alone (don't store what `git log` or the code itself tells you)
- It includes the *why*, not just the *what*

**Don't store:**
- File paths, function names, or code structure (read the code instead)
- Temporary debugging state or fix attempts
- Anything already in CLAUDE.md or other rule files

### Tags and Priority

- **Tags**: Add 1-3 short tags for discoverability. Use lowercase, e.g. `["auth", "api"]`
- **Priority**: 1 = critical (always loaded in context), 2 = normal (default), 3 = low (only surfaces in search)

Use priority 1 sparingly — only for things that should appear in every single session for this project.

### When to Query

**Before planning or design** — call `memory_query` with keywords relevant to the feature, component, or area you are about to plan. Stored decisions, conventions, and context should inform the plan — not be discovered after the plan is already written. This includes brainstorming, writing specs, creating implementation plans, and any design discussion.

**Before implementation** — call `memory_query` with keywords relevant to the code you are about to touch, before any of these actions:
- Writing or editing code directly
- Creating or modifying files
- Dispatching a subagent or agent to implement changes
- Transitioning from a completed plan to execution

This applies even when a skill or workflow is driving the process. Skills do not override this rule. Query first, then act.

### When to Update or Delete

- `memory_update` when a convention or decision changes — update the existing memory rather than creating a contradictory one
- `memory_delete` when a memory is no longer true (e.g. a rewrite is complete, a temporary constraint is lifted)

### Feature Branch Scoping

Memories are automatically scoped to the current git branch. Feature-branch memories (e.g. conventions specific to an auth refactor) only surface when on that branch. Global and project-level memories surface everywhere.

When storing a memory, consider: is this specific to the current feature branch, or does it apply project-wide? Project-wide memories use the default scope. Set `scope: "global"` only for things that apply across all projects.
