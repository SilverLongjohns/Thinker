# Thinker

Persistent, queryable memory server for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) via the [Model Context Protocol](https://modelcontextprotocol.io/).

## The problem

Claude Code is stateless. Every session starts from scratch — no memory of past decisions, conventions, or context. You end up re-explaining the same things, and the model re-discovers patterns it already learned last week. Context compaction makes this worse: even within a long session, earlier decisions can be lost.

## What Thinker does

Thinker gives Claude Code a long-term memory layer backed by SQLite. It stores decisions, conventions, context, rules, and notes scoped to your project and git branch — then surfaces relevant memories automatically at session start and on demand.

Memories are token-budgeted, so session-start context loads stay small (2,000 tokens by default). High-priority memories surface first; the rest are available via search.

### How it teaches Claude Code to use it

Thinker uses the MCP protocol's built-in `instructions` field to tell Claude Code when and how to call its tools. These instructions are injected into every session automatically — no project rule files or manual configuration needed beyond registration.

The instructions follow a four-phase workflow:

1. **Session start** — call `memory_context` to load high-priority memories for the current project/branch
2. **Before planning** — call `memory_query` with keywords relevant to the feature or area being designed. Stored decisions and conventions should inform the plan, not be discovered after the plan is written
3. **Before implementation** — call `memory_query` again with keywords relevant to the code being touched, before writing code, dispatching agents, or transitioning from a plan to execution
4. **After implementation** — call `memory_store` when the work produced knowledge a future session would need

The `memory_context` response includes a reminder about both the planning and implementation query steps, reinforcing the habit at the point where it matters most.

### MCP tools

| Tool | Description |
|------|-------------|
| `memory_store` | Save a new memory (with type, tags, priority) |
| `memory_query` | Search memories by relevance (full-text search) |
| `memory_context` | Load relevant memories for current project/branch |
| `memory_update` | Update an existing memory |
| `memory_delete` | Delete a memory |
| `memory_export` | Export all memories (optionally filtered by scope) |

## Setup

```bash
npm install
npm run build
```

### Register with Claude Code

Add to your project's `.mcp.json`:

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

Restart your Claude Code session. The `memory_*` tools will be available immediately.

## How memories work

### Scoping

Memories are automatically scoped to the current project (detected from `package.json` name or git remote) and git branch. This means:

- **Project memories** surface in every session for that project
- **Feature branch memories** only surface when you're on that branch — useful for ticket-specific context that shouldn't pollute the main branch
- **Global memories** (`scope: "global"`) surface everywhere, across all projects

### Types

| Type | Use for | Example |
|------|---------|---------|
| `convention` | Coding patterns, style rules, library choices | "We use Zustand for state, not Redux" |
| `decision` | Architectural choices with rationale | "Chose SSR for SEO — CSR was too slow for Googlebot" |
| `context` | Temporary project state, ongoing work | "Billing rewrite in progress — don't touch legacy billing" |
| `rule` | Hard constraints, non-negotiable requirements | "All API responses must include request_id" |
| `note` | Anything else worth remembering | "Jake prefers terse PR descriptions" |

### Priority

- **1** — Critical. Always loaded at session start. Use sparingly.
- **2** — Normal (default). Surfaces in queries and context when relevant.
- **3** — Low. Only surfaces in direct search.

### Token budgeting

Both `memory_context` and `memory_query` are token-budgeted. Results are returned in priority order until the budget is reached, then truncated. Defaults:

- Context (session start): 2,000 tokens
- Query (search): 4,000 tokens

These are configurable per-call or globally via `~/.thinker/config.json`.

## Web Dashboard

A read-only browser UI for browsing and filtering memories across all projects.

```bash
npm run web          # http://localhost:3000
PORT=8080 npm run web  # custom port
```

Features:
- Memory cards with type badges, priority indicators, and relative timestamps
- Sidebar with filterable stats by type, project, branch, and tags
- Full-text search with debounce
- Sort by newest, oldest, or priority
- Pagination (50 per page)

## Development

```bash
npm run build        # tsc
npm test             # vitest run
npm run test:watch   # vitest (watch mode)
```

## Tech stack

- Node.js / TypeScript (ESM)
- [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) — MCP server protocol
- [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) — SQLite with WAL mode
- [Preact](https://preactjs.com/) + [HTM](https://github.com/developit/htm) — web dashboard (CDN, no build step)
- [vitest](https://vitest.dev/) — testing

## Data storage

Memories are stored in `~/.thinker/memories.db` (SQLite with WAL mode). Configure via `~/.thinker/config.json`:

```json
{
  "db_path": "~/.thinker/memories.db",
  "defaults": {
    "query_token_budget": 4000,
    "context_token_budget": 2000,
    "max_content_length": 2000
  }
}
```
