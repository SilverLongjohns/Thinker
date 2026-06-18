# Thinker

Persistent, queryable memory server for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) via the [Model Context Protocol](https://modelcontextprotocol.io/).

## The problem

Claude Code is stateless. Every session starts from scratch — no memory of past decisions, conventions, or context. You end up re-explaining the same things, and the model re-discovers patterns it already learned last week. Context compaction makes this worse: even within a long session, earlier decisions can be lost.

## What Thinker does

Thinker gives Claude Code a long-term memory layer backed by SQLite. It stores decisions, conventions, context, rules, and notes scoped to your project and git branch — then surfaces relevant memories automatically at session start and on demand.

Memories are token-budgeted, so session-start context loads stay small (2,000 tokens by default). High-priority memories surface first; the rest are available via search.

### How it teaches Claude Code to use it

Thinker uses two global Claude Code hooks to ensure `memory_context` is called at the start of every session:

1. **Bootstrap hook** (`UserPromptSubmit`) — detects Thinker in the project's `.mcp.json` and injects a context message telling Claude to call `memory_context` before doing any work. Fires on the first prompt, before Claude starts thinking.
2. **Backstop hook** (`PreToolUse` on Edit/Write/NotebookEdit) — hard-blocks file writes if `memory_context` hasn't been called yet. Last line of defense.

Both hooks are safe globally — they check for a `thinker` entry in the project's `.mcp.json` and silently exit in projects without Thinker.

A project rule file (`docs/thinker-project-rule.md`) provides ongoing guidance for when to query, store, and update memories. Copy it into each project's `.claude/rules/` directory.

### MCP tools

| Tool | Description |
|------|-------------|
| `memory_store` | Save a new memory (with type, tags, priority) |
| `memory_query` | Search memories by relevance (hybrid FTS + semantic) |
| `memory_context` | Load relevant memories for current project/branch. Optional `query` param ranks P2/P3 memories semantically |
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

### Install hooks

```bash
node /absolute/path/to/thinker/hooks/setup.cjs
```

This installs both hooks into `~/.claude/settings.json` and copies the hook scripts to `~/.claude/hooks/`. Safe to run multiple times — it updates existing entries rather than duplicating them. Restart Claude Code after running.

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

### Semantic search

Every memory is embedded at write time using all-MiniLM-L6-v2 (384 dimensions, runs locally — no API calls). The model downloads once and caches under `~/.thinker/models/`.

`memory_query` uses **hybrid retrieval**: full-text search (FTS5) and semantic vector search run in parallel, then results are merged via Reciprocal Rank Fusion (RRF). This means exact keyword matches and semantically similar content both surface — each arm catches what the other misses.

`memory_context` accepts an optional `query` parameter. When provided, P1 memories still load unconditionally, but P2/P3 memories are ranked by semantic similarity to the query rather than by recency alone.

Vectors are stored as raw Float32 BLOBs alongside each memory row (1,536 bytes each). Existing memories without embeddings are backfilled on startup.

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
- [`@xenova/transformers`](https://github.com/xenova/transformers.js) — local embeddings (all-MiniLM-L6-v2, 384-dim)
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
