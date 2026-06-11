import type { SupabaseClient } from "@supabase/supabase-js";
import { GroqRateLimitError, groqJson, REASONING_MODEL } from "../ai/groq";
import { deriveSeverity, TAXONOMY_VERSION } from "../grading";
import type { Classification, ClauseCategory, ClauseStance } from "../types";

/**
 * Stage 6 — Classification (spec 3.1.6, 4.1). Only clauses whose hash
 * misses the global classifications cache (at the current taxonomy
 * version) reach the LLM.
 *
 * The model answers two separate questions per clause:
 *   1. category — what TOPIC the clause is about
 *   2. stance — whose side it is on (imposes the practice vs. denies it)
 * Severity/points derive from (category, stance) in lib/grading.ts, never
 * from the model. This is what stops "we do NOT sell your data" from
 * being scored like "we sell your data".
 *
 * Clauses are classified in small batches (one call instead of four)
 * because Groq's free tier charges prompt + max_tokens against a tight
 * TPM budget; fewer calls also means fewer repeats of the system prompt.
 */

const CATEGORIES: ClauseCategory[] = [
  "FORCED_ARBITRATION",
  "UNILATERAL_CHANGE",
  "DATA_SALE",
  "CONTENT_LICENSE_BROAD",
  "ACCOUNT_TERMINATION",
  "TRACKING_THIRD_PARTY",
  "NOTICE_OF_CHANGE",
  "OTHER",
];

const STANCES: ClauseStance[] = ["hostile", "protective", "neutral"];

const BATCH_MAX_CLAUSES = 4;
const BATCH_MAX_CHARS = 6_000;
const CLAUSE_MAX_CHARS = 4_200;

const SYSTEM_PROMPT = `You are a legal analyst classifying clauses from Terms of Service and Privacy Policy documents. For EACH clause you answer two separate questions. Respond with JSON only.

Question 1 — category. The TOPIC the clause is about (pick exactly one):
- FORCED_ARBITRATION: arbitration, jury trial waiver, class-action waiver.
- UNILATERAL_CHANGE: how/whether the terms themselves can change.
- DATA_SALE: selling or sharing personal data with third parties/brokers.
- CONTENT_LICENSE_BROAD: licenses to user-generated content.
- ACCOUNT_TERMINATION: account suspension or termination.
- TRACKING_THIRD_PARTY: tracking, profiling, targeted advertising.
- NOTICE_OF_CHANGE: advance notice before terms change.
- OTHER: anything else, including benign boilerplate. When in doubt, OTHER.

Question 2 — stance. Whose side the clause is on:
- "hostile": it IMPOSES the practice on users (forces arbitration, sells data, claims a perpetual license, allows termination for any reason, changes terms silently).
- "protective": it DENIES or LIMITS the practice, or grants users a right or control ("we do NOT sell your data", "we will notify you 30 days before changes", "you can delete your data", "you keep ownership of your content").
- "neutral": it merely mentions or defines the topic without imposing or denying anything.

CRITICAL: a clause being ABOUT a hostile topic does not make it hostile. Negations matter. "We do not sell your personal information" is category DATA_SALE with stance "protective" — it is GOOD for users. Classify what the clause explicitly says; do not infer hostility that is not in the text.

Other rules:
- summary: 1–2 sentences a non-lawyer understands, stating what this clause means for the user. Neutral tone.
- confidence: integer 0–100 for how certain you are about the category AND stance. Use below 70 when the clause only partially fits.

Examples:
- "We do not sell your personal information to third parties. You can manage your privacy choices in settings." → {"category":"DATA_SALE","stance":"protective","confidence":95}
- "Any dispute shall be resolved by binding arbitration. You waive your right to participate in a class action." → {"category":"FORCED_ARBITRATION","stance":"hostile","confidence":98}
- "We may revise these Terms at any time without notice to you." → {"category":"UNILATERAL_CHANGE","stance":"hostile","confidence":95}
- "In this agreement, 'Service' refers to the website and apps." → {"category":"OTHER","stance":"neutral","confidence":99}

Input: numbered clauses. Respond with JSON:
{"results":[{"i":<clause number>,"category":"...","stance":"...","summary":"...","confidence":0-100}, ...]}
Return exactly one result per clause, in order.`;

interface LlmVerdict {
  i?: number;
  category?: string;
  stance?: string;
  summary?: string;
  confidence?: number;
}

interface ClassifiedClause {
  category: ClauseCategory;
  stance: ClauseStance;
  plain_english_summary: string;
  confidence_score: number;
}

function sanitizeVerdict(v: LlmVerdict): ClassifiedClause {
  const category = CATEGORIES.includes(v.category as ClauseCategory)
    ? (v.category as ClauseCategory)
    : "OTHER";
  const stance = STANCES.includes(v.stance as ClauseStance)
    ? (v.stance as ClauseStance)
    : "neutral";
  return {
    category,
    stance: category === "OTHER" ? "neutral" : stance,
    plain_english_summary:
      String(v.summary ?? "").slice(0, 1000) || "No summary available.",
    confidence_score: Math.max(0, Math.min(100, Math.round(Number(v.confidence) || 0))),
  };
}

async function classifyBatchWithLlm(
  batch: { hash: string; content: string }[],
  log: (message: string) => void
): Promise<ClassifiedClause[]> {
  const user = batch
    .map((c, i) => `Clause ${i}:\n${c.content.slice(0, CLAUSE_MAX_CHARS)}`)
    .join("\n\n---\n\n");

  const data = await groqJson<{ results?: LlmVerdict[] }>({
    model: REASONING_MODEL,
    system: SYSTEM_PROMPT,
    user,
    // Roomy: gpt-oss spends part of the budget on (low-effort) reasoning
    // before the JSON; a truncated batch costs a full retry in singles.
    maxTokens: 250 + 250 * batch.length,
    reasoningEffort: "low",
    onWait: log,
  });

  const results = Array.isArray(data.results) ? data.results : [];
  if (results.length !== batch.length) {
    throw new Error(`expected ${batch.length} results, got ${results.length}`);
  }
  // Trust explicit indices when present and coherent; else assume order.
  const byIndex = new Map<number, LlmVerdict>();
  for (let i = 0; i < results.length; i++) {
    const idx = Number.isInteger(results[i].i) ? Number(results[i].i) : i;
    byIndex.set(idx, results[i]);
  }
  return batch.map((_, i) => {
    const verdict = byIndex.get(i);
    if (!verdict) throw new Error(`missing result for clause ${i}`);
    return sanitizeVerdict(verdict);
  });
}

/** Group cache misses into batches bounded by clause count and total chars. */
function buildBatches(
  misses: { hash: string; content: string }[]
): { hash: string; content: string }[][] {
  const batches: { hash: string; content: string }[][] = [];
  let current: { hash: string; content: string }[] = [];
  let chars = 0;
  for (const miss of misses) {
    const size = Math.min(miss.content.length, CLAUSE_MAX_CHARS);
    if (current.length > 0 && (current.length >= BATCH_MAX_CLAUSES || chars + size > BATCH_MAX_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(miss);
    chars += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function toRow(hash: string, verdict: ClassifiedClause): Classification {
  return {
    clause_hash: hash,
    category: verdict.category,
    stance: verdict.stance,
    severity: deriveSeverity(verdict.category, verdict.stance),
    plain_english_summary: verdict.plain_english_summary,
    confidence_score: verdict.confidence_score,
    taxonomy_version: TAXONOMY_VERSION,
    model: REASONING_MODEL,
    admin_approved: false,
    created_at: new Date().toISOString(),
  };
}

/**
 * Ensure a current-taxonomy classification row exists for every given
 * clause. Returns the classifications keyed by hash and how many LLM
 * calls were made.
 */
export async function classifyClauses(
  db: SupabaseClient,
  clauses: { hash: string; content: string }[],
  log: (message: string) => void
): Promise<{ byHash: Map<string, Classification>; llmCalls: number }> {
  const byHash = new Map<string, Classification>();
  const unique = new Map<string, string>(); // hash -> content
  for (const c of clauses) {
    if (!unique.has(c.hash)) unique.set(c.hash, c.content);
  }
  if (unique.size === 0) return { byHash, llmCalls: 0 };

  // Cache lookup — rows from an older taxonomy version count as misses.
  const { data: cached, error } = await db
    .from("classifications")
    .select("*")
    .in("clause_hash", [...unique.keys()]);
  if (error) throw new Error(`classifications lookup failed: ${error.message}`);
  let stale = 0;
  for (const row of cached ?? []) {
    if ((row.taxonomy_version ?? 1) >= TAXONOMY_VERSION) {
      byHash.set(row.clause_hash, row as Classification);
    } else {
      stale++;
    }
  }

  const misses = [...unique]
    .filter(([hash]) => !byHash.has(hash))
    .map(([hash, content]) => ({ hash, content }));
  if (misses.length > 0) {
    log(
      `Classification cache: ${byHash.size} hits, ${misses.length} misses → LLM` +
        (stale > 0 ? ` (${stale} from an older taxonomy)` : "")
    );
  } else {
    log(`Classification cache: all ${byHash.size} clauses already classified ($0)`);
  }

  let llmCalls = 0;
  let done = 0;
  const upsert = async (rows: Classification[]) => {
    const { error: upsertError } = await db
      .from("classifications")
      .upsert(rows, { onConflict: "clause_hash" });
    if (upsertError) throw new Error(`classification upsert failed: ${upsertError.message}`);
    for (const row of rows) byHash.set(row.clause_hash, row);
    done += rows.length;
    if (done % 10 < rows.length) log(`Classified ${done}/${misses.length} clauses…`);
  };

  for (const batch of buildBatches(misses)) {
    try {
      llmCalls++;
      const verdicts = await classifyBatchWithLlm(batch, log);
      await upsert(batch.map((c, i) => toRow(c.hash, verdicts[i])));
    } catch (err) {
      // Out of quota: single calls would burn the same empty budget —
      // surface it so the run fails fast with a clear "re-run later".
      if (err instanceof GroqRateLimitError) throw err;
      // Malformed batch output → classify that batch clause-by-clause.
      if (batch.length > 1) {
        log(
          `Batch of ${batch.length} fell back to single calls (${err instanceof Error ? err.message : err})`
        );
        for (const clause of batch) {
          llmCalls++;
          const [verdict] = await classifyBatchWithLlm([clause], log);
          await upsert([toRow(clause.hash, verdict)]);
        }
      } else {
        throw err;
      }
    }
  }

  return { byHash, llmCalls };
}

/**
 * Formatting-only changes: carry the old hash's classification over to the
 * new hash so the grade is unaffected and the LLM is never called. Stale
 * taxonomy versions are not copied — the caller should send those clauses
 * through classifyClauses instead. Returns the new hashes that were copied.
 */
export async function copyClassifications(
  db: SupabaseClient,
  pairs: { newHash: string; oldHash: string }[]
): Promise<Set<string>> {
  if (pairs.length === 0) return new Set();

  const { data: oldRows, error } = await db
    .from("classifications")
    .select("*")
    .in("clause_hash", pairs.map((p) => p.oldHash))
    .gte("taxonomy_version", TAXONOMY_VERSION);
  if (error) throw new Error(`classification copy lookup failed: ${error.message}`);

  const oldByHash = new Map((oldRows ?? []).map((r) => [r.clause_hash, r]));
  const inserts = pairs
    .map(({ newHash, oldHash }) => {
      const old = oldByHash.get(oldHash);
      if (!old) return null;
      return { ...old, clause_hash: newHash, created_at: new Date().toISOString() };
    })
    .filter((r) => r !== null);

  if (inserts.length > 0) {
    const { error: upsertError } = await db
      .from("classifications")
      .upsert(inserts, { onConflict: "clause_hash", ignoreDuplicates: true });
    if (upsertError) {
      throw new Error(`classification copy failed: ${upsertError.message}`);
    }
  }
  return new Set(inserts.map((r) => r!.clause_hash));
}
