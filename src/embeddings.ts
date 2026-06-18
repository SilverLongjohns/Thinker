// embeddings.ts
// Local, in-process semantic search for Thinker.
// No network at query time, no external services. Model downloads once and caches.

import { pipeline, env } from '@xenova/transformers';

// Cache the model under ~/.thinker so it lives with the rest of Thinker's data
// and survives across sessions. Set this before the pipeline is created.
import os from 'node:os';
import path from 'node:path';
env.cacheDir = path.join(os.homedir(), '.thinker', 'models');
env.allowRemoteModels = true; // allow the one-time download; cached thereafter

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const DIM = 384;

type FeatureExtractor = (
  text: string,
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array }>;

let _extractor: FeatureExtractor | null = null;
let _loading: Promise<FeatureExtractor> | null = null;

// Lazy singleton. First call pays the ~1-2s warmup; every call after is hot.
async function getExtractor(): Promise<FeatureExtractor> {
  if (_extractor) return _extractor;
  if (!_loading) {
    _loading = pipeline('feature-extraction', MODEL).then((p) => {
      _extractor = p as unknown as FeatureExtractor;
      return _extractor;
    });
  }
  return _loading;
}

/**
 * Embed a single string into a normalized 384-dim vector.
 * Normalized means cosine similarity reduces to a plain dot product.
 */
export async function embed(text: string): Promise<Float32Array> {
  const extractor = await getExtractor();
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return out.data as Float32Array;
}

// ---- SQLite storage helpers -------------------------------------------------
// Vectors are stored as raw little-endian Float32 BLOBs alongside each memory.
// 384 floats * 4 bytes = 1536 bytes per memory. Trivial at the scale of a
// local memory store (hundreds to low-thousands per scope).

export function vectorToBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function blobToVector(blob: Buffer): Float32Array {
  // Copy out so we own the memory and aren't aliasing SQLite's buffer.
  const copy = Buffer.from(blob);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.length / 4);
}

// ---- Ranking ----------------------------------------------------------------

// Both vectors are pre-normalized, so cosine == dot product.
function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export interface Candidate {
  id: number;
  text: string;
  vector: Float32Array;
  priority?: number; // optional P1/P2/P3 weighting hook
}

export interface RankedHit {
  id: number;
  text: string;
  score: number;
}

export interface RankOptions {
  // exact-substring boost. Set to 0 for pure-semantic behavior.
  keywordBoost?: number;
  limit?: number;
}

/**
 * Hybrid ranker: semantic cosine as the base score, plus a small additive
 * boost when the query appears as a literal (case-insensitive) substring.
 * The boost rescues exact-token lookups (identifiers, flags, error codes)
 * that pure embeddings can rank too low. Set keywordBoost to 0 for pure
 * semantic.
 */
export async function rank(
  query: string,
  candidates: Candidate[],
  opts: RankOptions = {},
): Promise<RankedHit[]> {
  const keywordBoost = opts.keywordBoost ?? 0.15;
  const limit = opts.limit ?? 10;
  const qVec = await embed(query);
  const qLower = query.toLowerCase();

  const scored = candidates.map((c) => {
    let score = dot(qVec, c.vector); // ~[-1, 1], realistically [0, 1]
    if (keywordBoost > 0 && c.text.toLowerCase().includes(qLower)) {
      score += keywordBoost;
    }
    return { id: c.id, text: c.text, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// ---- True hybrid retrieval (Reciprocal Rank Fusion) -------------------------
// rank() above ranks a single candidate set. hybridSearch() merges TWO ranked
// lists — one from FTS, one from semantic — so each retriever catches what the
// other misses. RRF fuses by RANK POSITION, sidestepping the problem that
// BM25 scores and cosine scores live on incompatible scales.

export interface ScopedMemory {
  id: number;
  text: string;
  vector: Float32Array;
  priority?: number; // 1 = P1, 2 = P2, 3 = P3
}

export interface HybridOptions {
  limit?: number;
  // RRF damping constant. 60 is the standard value from the original paper;
  // larger = flatter weighting across ranks, smaller = top ranks dominate more.
  k?: number;
  // P1 memories load unconditionally regardless of score. Set false to let
  // ranking govern everything.
  pinP1?: boolean;
}

// Run FTS yourself (it needs your SQLite handle), pass its ordered id list in.
// `ftsIds` must be ordered best-first; `semantic` is the candidate pool that
// hybridSearch will rank internally.
export async function hybridSearch(
  query: string,
  ftsIds: number[],
  semantic: ScopedMemory[],
  opts: HybridOptions = {},
): Promise<RankedHit[]> {
  const limit = opts.limit ?? 10;
  const k = opts.k ?? 60;
  const pinP1 = opts.pinP1 ?? true;

  // Semantic ranking → ordered id list (no keyword boost here; FTS is the
  // keyword arm, so boosting again would double-count exact matches).
  const semRanked = await rank(query, semantic, { keywordBoost: 0, limit: semantic.length });
  const semIds = semRanked.map((h) => h.id);

  const textById = new Map<number, string>();
  for (const m of semantic) textById.set(m.id, m.text);

  // RRF: each list contributes 1/(k + rank) to a memory's fused score.
  const fused = new Map<number, number>();
  const addRanks = (ids: number[]) => {
    ids.forEach((id, i) => {
      fused.set(id, (fused.get(id) ?? 0) + 1 / (k + i + 1));
    });
  };
  addRanks(ftsIds);
  addRanks(semIds);

  let ordered = [...fused.entries()]
    .map(([id, score]) => ({ id, text: textById.get(id) ?? '', score }))
    .sort((a, b) => b.score - a.score);

  // Pin P1 memories to the front, preserving their relative fused order.
  if (pinP1) {
    const pri = new Map<number, number>();
    for (const m of semantic) if (m.priority != null) pri.set(m.id, m.priority);
    const isP1 = (id: number) => pri.get(id) === 1;
    ordered = [
      ...ordered.filter((h) => isP1(h.id)),
      ...ordered.filter((h) => !isP1(h.id)),
    ];
  }

  return ordered.slice(0, limit);
}
