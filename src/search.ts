import Database from "better-sqlite3";
import { loadTagsFor, loadRelationsFor } from "./store.js";
import { DEFAULT_CONFIG, type MemoryResult, type MemoryType, type MemoryWithTags } from "./types.js";

interface QueryInput {
  query: string;
  projectId: string;
  feature: string | null;
  tags?: string[];
  type?: MemoryType;
  scope?: string;
  limit?: number;
  token_budget?: number;
}

interface ContextInput {
  projectId: string;
  feature: string | null;
  token_budget?: number;
}

interface SearchResult {
  memories: MemoryResult[];
  remaining_count: number;
}

export interface WebQueryInput {
  query: string;
  scope?: string;
  type?: MemoryType;
  tag?: string;
  feature?: string;
  limit: number;
  offset: number;
}

export interface WebQueryResult {
  memories: MemoryWithTags[];
  total: number;
  limit: number;
  offset: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class MemorySearch {
  constructor(private db: Database.Database) {}

  query(input: QueryInput): SearchResult {
    const budget =
      input.token_budget ?? DEFAULT_CONFIG.defaults.query_token_budget;

    const scopes = input.scope ? [input.scope] : [input.projectId, "global"];
    const scopePlaceholders = scopes.map(() => "?").join(", ");
    const params: any[] = [];

    let sql = `
      SELECT m.*, memories_fts.rank
      FROM memories_fts
      JOIN memories m ON m.rowid = memories_fts.rowid
      WHERE memories_fts MATCH ?
        AND m.scope IN (${scopePlaceholders})
    `;
    params.push(input.query);
    params.push(...scopes);

    if (input.feature) {
      sql += " AND (m.feature = ? OR m.feature IS NULL)";
      params.push(input.feature);
    }

    if (input.type) {
      sql += " AND m.type = ?";
      params.push(input.type);
    }

    if (input.tags && input.tags.length > 0) {
      sql += ` AND m.id IN (
        SELECT memory_id FROM memory_tags WHERE tag IN (${input.tags.map(() => "?").join(", ")})
      )`;
      params.push(...input.tags);
    }

    sql += " ORDER BY m.priority ASC, rank";

    if (input.limit) {
      sql += " LIMIT ?";
      params.push(input.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];

    return this.applyTokenBudget(rows, budget);
  }

  context(input: ContextInput): SearchResult {
    const budget =
      input.token_budget ?? DEFAULT_CONFIG.defaults.context_token_budget;

    const scopes: string[] = ["global", input.projectId];
    const scopePlaceholders = scopes.map(() => "?").join(", ");
    const params: any[] = [...scopes];

    let featureClause = "";
    if (input.feature) {
      featureClause = "AND (m.feature = ? OR m.feature IS NULL)";
      params.push(input.feature);
    } else {
      featureClause = "AND m.feature IS NULL";
    }

    const sql = `
      SELECT m.*
      FROM memories m
      WHERE m.scope IN (${scopePlaceholders})
        ${featureClause}
      ORDER BY m.priority ASC,
        CASE
          WHEN m.feature IS NOT NULL THEN 0
          WHEN m.scope = ? THEN 1
          WHEN m.scope = 'global' THEN 2
          ELSE 3
        END,
        m.created_at DESC
    `;
    params.push(input.projectId);

    const rows = this.db.prepare(sql).all(...params) as any[];

    return this.applyTokenBudget(rows, budget);
  }

  webQuery(input: WebQueryInput): WebQueryResult {
    const conditions: string[] = ["memories_fts MATCH ?"];
    const params: any[] = [input.query];

    if (input.scope) {
      conditions.push("m.scope = ?");
      params.push(input.scope);
    }

    if (input.type) {
      conditions.push("m.type = ?");
      params.push(input.type);
    }

    if (input.tag) {
      conditions.push("m.id IN (SELECT memory_id FROM memory_tags WHERE tag = ?)");
      params.push(input.tag);
    }

    if (input.feature) {
      conditions.push("m.feature = ?");
      params.push(input.feature);
    }

    const where = conditions.join(" AND ");

    const countRow = this.db.prepare(`
      SELECT COUNT(*) as cnt
      FROM memories_fts
      JOIN memories m ON m.rowid = memories_fts.rowid
      WHERE ${where}
    `).get(...params) as { cnt: number };

    const rows = this.db.prepare(`
      SELECT m.*
      FROM memories_fts
      JOIN memories m ON m.rowid = memories_fts.rowid
      WHERE ${where}
      ORDER BY rank
      LIMIT ? OFFSET ?
    `).all(...params, input.limit, input.offset) as any[];

    const memories: MemoryWithTags[] = rows.map((row: any) => ({
      ...row,
      tags: loadTagsFor(this.db, row.id),
      relations: loadRelationsFor(this.db, row.id),
    }));

    return { memories, total: countRow.cnt, limit: input.limit, offset: input.offset };
  }

  private applyTokenBudget(rows: any[], budget: number): SearchResult {
    const results: MemoryResult[] = [];
    let tokensUsed = 0;
    let remaining = 0;

    for (const row of rows) {
      const tokens = estimateTokens(row.content);

      if (tokensUsed + tokens > budget && results.length > 0) {
        remaining = rows.length - results.length;
        break;
      }

      results.push({
        id: row.id,
        content: row.content,
        content_hash: row.content_hash,
        type: row.type,
        scope: row.scope,
        feature: row.feature,
        priority: row.priority,
        created_at: row.created_at,
        updated_at: row.updated_at,
        tags: loadTagsFor(this.db, row.id),
        relations: [],
        relevance_score: row.rank != null ? Math.abs(row.rank) : 0,
        estimated_tokens: tokens,
      });
      tokensUsed += tokens;
    }

    return { memories: results, remaining_count: remaining };
  }
}
