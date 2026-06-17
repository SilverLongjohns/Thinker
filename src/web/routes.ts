import Database from "better-sqlite3";
import { MemorySearch } from "../search.js";
import { loadTagsFor, loadRelationsFor } from "../store.js";
import type { MemoryWithTags } from "../types.js";

interface MemoriesResponse {
  memories: MemoryWithTags[];
  total: number;
  limit: number;
  offset: number;
}

interface StatsResponse {
  total: number;
  by_type: Record<string, number>;
  by_scope: Record<string, number>;
  by_feature: Record<string, number>;
  projects: Record<string, string>;
  top_tags: Array<{ tag: string; count: number }>;
}

const SORT_CLAUSES: Record<string, string> = {
  created_at_desc: "m.created_at DESC",
  created_at_asc: "m.created_at ASC",
  priority_asc: "m.priority ASC, m.created_at DESC",
};

export function getMemories(db: Database.Database, params: URLSearchParams): MemoriesResponse {
  const q = params.get("q") ?? "";
  const type = params.get("type") ?? "";
  const tag = params.get("tag") ?? "";
  const scope = params.get("scope") ?? "";
  const feature = params.get("feature") ?? "";
  const priority = params.get("priority") ?? "";
  const sort = params.get("sort") ?? "created_at_desc";
  const limit = Math.min(parseInt(params.get("limit") ?? "50", 10) || 50, 200);
  const offset = parseInt(params.get("offset") ?? "0", 10) || 0;

  if (q) {
    return new MemorySearch(db).webQuery({
      query: q,
      scope: scope || undefined,
      type: (type || undefined) as any,
      tag: tag || undefined,
      feature: feature || undefined,
      limit,
      offset,
    });
  }

  const conditions: string[] = [];
  const values: any[] = [];

  if (type) { conditions.push("m.type = ?"); values.push(type); }
  if (scope) { conditions.push("m.scope = ?"); values.push(scope); }
  if (feature) { conditions.push("m.feature = ?"); values.push(feature); }
  if (priority) { conditions.push("m.priority = ?"); values.push(parseInt(priority, 10)); }
  if (tag) {
    conditions.push("m.id IN (SELECT memory_id FROM memory_tags WHERE tag = ?)");
    values.push(tag);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = SORT_CLAUSES[sort] ?? SORT_CLAUSES.created_at_desc;

  const countRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM memories m ${where}`)
    .get(...values) as { cnt: number };

  const rows = db
    .prepare(`SELECT m.* FROM memories m ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...values, limit, offset) as any[];

  const memories: MemoryWithTags[] = rows.map((row) => ({
    ...row,
    tags: loadTagsFor(db, row.id),
    relations: loadRelationsFor(db, row.id),
  }));

  return { memories, total: countRow.cnt, limit, offset };
}

export function getStats(db: Database.Database): StatsResponse {
  const total = (db.prepare("SELECT COUNT(*) as cnt FROM memories").get() as { cnt: number }).cnt;

  const typeRows = db
    .prepare("SELECT type, COUNT(*) as count FROM memories GROUP BY type")
    .all() as Array<{ type: string; count: number }>;
  const by_type: Record<string, number> = {};
  for (const row of typeRows) by_type[row.type] = row.count;

  const scopeRows = db
    .prepare("SELECT scope, COUNT(*) as count FROM memories GROUP BY scope")
    .all() as Array<{ scope: string; count: number }>;
  const by_scope: Record<string, number> = {};
  for (const row of scopeRows) by_scope[row.scope] = row.count;

  const featureRows = db
    .prepare("SELECT feature, COUNT(*) as count FROM memories WHERE feature IS NOT NULL GROUP BY feature")
    .all() as Array<{ feature: string; count: number }>;
  const by_feature: Record<string, number> = {};
  for (const row of featureRows) by_feature[row.feature] = row.count;

  const projectRows = db
    .prepare("SELECT id, name FROM projects")
    .all() as Array<{ id: string; name: string }>;
  const projects: Record<string, string> = {};
  for (const row of projectRows) projects[row.id] = row.name;

  const top_tags = db
    .prepare("SELECT tag, COUNT(*) as count FROM memory_tags GROUP BY tag ORDER BY count DESC LIMIT 10")
    .all() as Array<{ tag: string; count: number }>;

  return { total, by_type, by_scope, by_feature, projects, top_tags };
}
