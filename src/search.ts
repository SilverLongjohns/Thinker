import Database from "better-sqlite3";
import { loadTagsFor, loadRelationsFor } from "./store.js";
import { blobToVector } from "./embeddings.js";
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
  queryVec?: Float32Array;
}

interface ContextInput {
  projectId: string;
  feature: string | null;
  token_budget?: number;
  queryVec?: Float32Array;
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

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export class MemorySearch {
  constructor(private db: Database.Database) {}

  query(input: QueryInput): SearchResult {
    const budget =
      input.token_budget ?? DEFAULT_CONFIG.defaults.query_token_budget;

    if (input.queryVec) {
      return this.hybridQuery(input, budget);
    }

    return this.ftsQuery(input, budget);
  }

  private scopeFilters(input: QueryInput): { clauses: string[]; params: any[]; scopeSql: string } {
    const scopes = input.scope ? [input.scope] : [input.projectId, "global"];
    const scopeSql = `m.scope IN (${scopes.map(() => "?").join(", ")})`;
    const clauses: string[] = [];
    const params: any[] = [...scopes];

    if (input.feature) {
      clauses.push("(m.feature = ? OR m.feature IS NULL)");
      params.push(input.feature);
    }
    if (input.type) {
      clauses.push("m.type = ?");
      params.push(input.type);
    }
    if (input.tags && input.tags.length > 0) {
      clauses.push(`m.id IN (SELECT memory_id FROM memory_tags WHERE tag IN (${input.tags.map(() => "?").join(", ")}))`);
      params.push(...input.tags);
    }

    return { clauses, params, scopeSql };
  }

  private ftsQuery(input: QueryInput, budget: number): SearchResult {
    const { clauses, params, scopeSql } = this.scopeFilters(input);
    const where = [`memories_fts MATCH ?`, scopeSql, ...clauses].join(" AND ");
    const allParams: any[] = [input.query, ...params];

    let sql = `SELECT m.*, memories_fts.rank FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid WHERE ${where} ORDER BY m.priority ASC, rank`;

    if (input.limit) {
      sql += " LIMIT ?";
      allParams.push(input.limit);
    }

    return this.applyTokenBudget(this.db.prepare(sql).all(...allParams) as any[], budget);
  }

  private hybridQuery(input: QueryInput, budget: number): SearchResult {
    const queryVec = input.queryVec!;
    const K = 60;
    const { clauses, params, scopeSql } = this.scopeFilters(input);
    const filterSql = clauses.length ? " AND " + clauses.join(" AND ") : "";

    // FTS arm
    const ftsSql = `SELECT m.id FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid WHERE memories_fts MATCH ? AND ${scopeSql}${filterSql} ORDER BY rank`;
    const ftsIds = this.db.prepare(ftsSql).all(input.query, ...params).map((r: any) => r.id as string);

    // Semantic arm: scoped candidates with embeddings
    const semSql = `SELECT m.* FROM memories m WHERE ${scopeSql} AND m.embedding IS NOT NULL${filterSql}`;
    const candidates = this.db.prepare(semSql).all(...params) as any[];

    const SEM_THRESHOLD = 0.3;
    const semRanked = candidates
      .map((c: any) => ({ id: c.id as string, score: dot(queryVec, blobToVector(c.embedding)) }))
      .filter((r) => r.score >= SEM_THRESHOLD)
      .sort((a, b) => b.score - a.score);
    const semIds = semRanked.map((r) => r.id);

    // RRF fusion
    const fused = new Map<string, number>();
    const addRanks = (ids: string[]) => {
      ids.forEach((id, i) => { fused.set(id, (fused.get(id) ?? 0) + 1 / (K + i + 1)); });
    };
    addRanks(ftsIds);
    addRanks(semIds);

    // Build row lookup — FTS may find rows without embeddings
    const rowById = new Map<string, any>();
    for (const c of candidates) rowById.set(c.id, c);
    for (const ftsId of ftsIds) {
      if (!rowById.has(ftsId)) {
        const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(ftsId);
        if (row) rowById.set(ftsId, row);
      }
    }

    const rows = [...fused.entries()]
      .map(([id, score]) => ({ row: rowById.get(id), score }))
      .filter((r) => r.row)
      .sort((a, b) => b.score - a.score)
      .map((r) => ({ ...r.row, rank: -r.score }));

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

    if (!input.queryVec) {
      return this.applyTokenBudget(rows, budget);
    }

    const p1 = rows.filter((r: any) => r.priority === 1);
    const rest = rows.filter((r: any) => r.priority !== 1);

    const ranked = rest
      .map((r: any) => {
        const sim = r.embedding ? dot(input.queryVec!, blobToVector(r.embedding)) : -1;
        return { ...r, _sim: sim };
      })
      .sort((a: any, b: any) => b._sim - a._sim);

    return this.applyTokenBudget([...p1, ...ranked], budget);
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
