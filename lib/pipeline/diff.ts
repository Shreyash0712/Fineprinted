import { cosineSimilarity, embedTexts } from "../ai/embeddings";
import type { SegmentedClause } from "./segment";

/**
 * Stage 5 — Embedding & Diffing (spec 3.1.5). Matches old clauses to new
 * clauses so only genuinely changed text reaches the LLM:
 *
 * 1. Exact hash matches → unchanged (embedding reused, $0).
 * 2. Remaining clauses are embedded; pairs above COSMETIC_SIM are
 *    formatting-only changes (classification copied from the old hash).
 * 3. Pairs above MODIFIED_SIM are semantic edits → sent to the LLM.
 * 4. Everything else is added (new) or removed (old).
 */

export const COSMETIC_SIM = 0.99;
export const MODIFIED_SIM = 0.85;

export interface OldClause {
  clause_hash: string;
  content: string;
  embedding: number[];
}

export interface NewClause extends SegmentedClause {
  embedding: number[];
}

export interface ClauseDiff {
  /** hash-identical; embedding copied from previous snapshot */
  unchanged: NewClause[];
  /** formatting-only change; classification copied from old hash */
  cosmetic: { clause: NewClause; oldHash: string; similarity: number }[];
  /** semantic change; needs (cached) classification */
  modified: { clause: NewClause; old: OldClause; similarity: number }[];
  /** brand new; needs (cached) classification */
  added: NewClause[];
  /** present before, gone now */
  removed: OldClause[];
}

export async function diffClauses(
  newClauses: SegmentedClause[],
  oldClauses: OldClause[]
): Promise<ClauseDiff> {
  const oldByHash = new Map(oldClauses.map((c) => [c.clause_hash, c]));

  const unchanged: NewClause[] = [];
  const needEmbedding: SegmentedClause[] = [];

  for (const clause of newClauses) {
    const old = oldByHash.get(clause.hash);
    if (old) {
      unchanged.push({ ...clause, embedding: old.embedding });
      oldByHash.delete(clause.hash); // consume one old clause per match
    } else {
      needEmbedding.push(clause);
    }
  }

  const embeddings = await embedTexts(needEmbedding.map((c) => c.content));
  const candidates: NewClause[] = needEmbedding.map((c, i) => ({
    ...c,
    embedding: embeddings[i],
  }));

  // Greedy one-to-one matching of remaining new ↔ old by similarity.
  const remainingOld = [...oldByHash.values()];
  const pairs: { newIdx: number; oldIdx: number; sim: number }[] = [];
  for (let n = 0; n < candidates.length; n++) {
    for (let o = 0; o < remainingOld.length; o++) {
      const sim = cosineSimilarity(candidates[n].embedding, remainingOld[o].embedding);
      if (sim >= MODIFIED_SIM) pairs.push({ newIdx: n, oldIdx: o, sim });
    }
  }
  pairs.sort((a, b) => b.sim - a.sim);

  const matchedNew = new Set<number>();
  const matchedOld = new Set<number>();
  const cosmetic: ClauseDiff["cosmetic"] = [];
  const modified: ClauseDiff["modified"] = [];

  for (const { newIdx, oldIdx, sim } of pairs) {
    if (matchedNew.has(newIdx) || matchedOld.has(oldIdx)) continue;
    matchedNew.add(newIdx);
    matchedOld.add(oldIdx);
    const clause = candidates[newIdx];
    const old = remainingOld[oldIdx];
    if (sim >= COSMETIC_SIM) {
      cosmetic.push({ clause, oldHash: old.clause_hash, similarity: sim });
    } else {
      modified.push({ clause, old, similarity: sim });
    }
  }

  return {
    unchanged,
    cosmetic,
    modified,
    added: candidates.filter((_, i) => !matchedNew.has(i)),
    removed: remainingOld.filter((_, i) => !matchedOld.has(i)),
  };
}
