# Thinker — Project Rules

## Design Principles

Apply these before every task and edit.

### Three Pillars

- **Clean code** — readable, well-structured, minimal complexity.
- **Reusability** — extract shared logic; avoid duplication.
- **Security best practices** — validate inputs, sanitize outputs, least privilege.

### KISS

Simplest solution that works. If it feels complex, it is.

### Refactoring Rule

When in doubt, refactor it out. If code is unclear or growing unwieldy, restructure before adding more.

## Hard Rules

These are non-negotiable constraints. Violating any of them means the code is not ready to ship.

### File size

No source file may exceed 300 lines. If an edit would push a file past 300, extract modules or helpers first. Plan extraction when approaching 250.

### Duplication — grep before you write

Before defining any constant, type, utility function, or pattern, grep the codebase for existing copies. If one exists:

- Import it from its shared location, or
- Extract both copies into a shared module first, then use that.

Never create a second copy of anything. This is non-negotiable.

### Shared code locations

| What | Where |
|------|-------|
| Shared types, enums, interfaces, config defaults | `src/types.ts` |
| Database operations | `src/db.ts` |
| CRUD, validation, tag/relation loading helpers | `src/store.ts` |
| Search and token budgeting | `src/search.ts` |
| MCP tool zod schemas and registration | `src/tools.ts` |
| Tool handler implementations | `src/handlers.ts` |
| Project/feature detection | `src/project.ts` |
| Configuration loading | `src/config.ts` |
| Shared test utilities | `tests/helpers.ts` |

No inline re-definitions. No "local copies for convenience."

### Dead code

If a file has zero imports across the entire codebase, delete it. Don't leave dead exports "in case we need them later."

### Consistency check

Before implementing a pattern (error handling, validation, SQL queries, test setup), check how existing code solves the same problem. Use the same approach. If the existing approach is duplicated in multiple places, extract it to shared first.

### Error visibility

Every tool handler must surface failures clearly in the MCP response — not just throw silently. Errors should include actionable context (what failed and why).

## Tech Stack

- Node.js / TypeScript (ESM)
- `@modelcontextprotocol/sdk` — MCP server protocol
- `better-sqlite3` — SQLite with WAL mode
- `vitest` — testing
- stdio transport (child process of Claude Code)

## Build & Test

```bash
npm run build    # tsc
npm test         # vitest run
npm run test:watch  # vitest (watch mode)
```
