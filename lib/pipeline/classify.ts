import type { SupabaseClient } from "@supabase/supabase-js";
import { GroqRateLimitError, groqJson, REASONING_MODEL } from "../ai/groq";
import { deriveSeverity } from "../grading";
import {
  CATEGORY_DEFS,
  CATEGORY_KEYS,
  GROUP_DEFS,
  type ClauseCategory,
  type ClauseGroup,
} from "../taxonomy";
import type { Classification, ClauseStance } from "../types";

/**
 * Stage 6 — Classification (spec 3.1.6, 4.1). Only clauses whose hash
 * misses the global classifications cache (at the current taxonomy
 * version) reach the LLM.
 *
 * The model answers two separate questions per clause:
 *   1. category — what TOPIC the clause is about (the full taxonomy lives in
 *      lib/taxonomy.ts; the reference list below is generated from it so the
 *      prompt never drifts from the scoring values)
 *   2. stance — whose side it is on (imposes the practice vs. denies it)
 * Severity/points derive from (category, stance) in lib/grading.ts, never
 * from the model. This is what stops "we do NOT sell your data" from
 * being scored like "we sell your data".
 *
 * Clauses are classified in small batches (one call instead of four)
 * because Groq's free tier charges prompt + max_tokens against a tight
 * TPM budget; fewer calls also means fewer repeats of the system prompt.
 */

const CATEGORIES: ClauseCategory[] = CATEGORY_KEYS;
const STANCES: ClauseStance[] = ["hostile", "protective", "neutral"];

const BATCH_MAX_CLAUSES = 4;
const BATCH_MAX_CHARS = 6_000;
const CLAUSE_MAX_CHARS = 4_200;

/** Build the category reference for the prompt, grouped by domain, from the taxonomy. */
function categoryReference(): string {
  const byGroup = new Map<ClauseGroup, string[]>();
  for (const key of CATEGORY_KEYS) {
    if (key === "OTHER") continue;
    const def = CATEGORY_DEFS[key];
    const lines = byGroup.get(def.group) ?? [];
    lines.push(`- ${key}: ${def.definition}`);
    byGroup.set(def.group, lines);
  }
  const sections = (Object.keys(GROUP_DEFS) as ClauseGroup[])
    .filter((g) => g !== "NONE")
    .sort((a, b) => GROUP_DEFS[a].order - GROUP_DEFS[b].order)
    .map((g) => `${GROUP_DEFS[g].label}:\n${(byGroup.get(g) ?? []).join("\n")}`);
  sections.push(`Catch-all:\n- OTHER: ${CATEGORY_DEFS.OTHER.definition}`);
  return sections.join("\n\n");
}

const SYSTEM_PROMPT = `You are a legal analyst classifying clauses from Terms of Service and Privacy Policy documents. For EACH clause you answer two separate questions. Respond with JSON only.

Question 1 — category. The single TOPIC the clause is mainly about. Pick exactly ONE key from this list (use OTHER if nothing fits well):

${categoryReference()}

Question 2 — stance. Whose side the clause is on:
- "hostile": it IMPOSES the practice on users (forces arbitration, sells data, trains AI on your content, claims a broad license, terminates for any reason, makes cancelling hard, changes terms silently).
- "protective": it DENIES or LIMITS the practice, or grants users a right or control ("we do NOT sell your data", "you can opt out of AI training", "we notify you 30 days before changes", "you can delete your data", "you keep ownership of your content", "cancel anytime in one click").
- "neutral": it merely mentions or defines the topic without imposing or denying anything.

CRITICAL: a clause being ABOUT a hostile topic does not make it hostile. Negations and user rights matter. "We do not sell your personal information" is DATA_SALE / protective — GOOD for users. Classify what the clause explicitly says; never infer hostility that is not in the text. Routine disclosure to service providers/processors, affiliates, or legal authorities is ordinary operation → OTHER, not DATA_SALE.

Other rules:
- Pick the most specific applicable category. If a clause genuinely covers two topics, choose the most user-significant one.
- summary: 1–2 sentences a non-lawyer understands, stating what this clause means for the user. Neutral tone.
- confidence: integer 0–100 for how certain you are about the category AND stance together. Use below 70 when the clause only partially fits.

Examples:
- "We do not sell your personal information to third parties." → {"category":"DATA_SALE","stance":"protective","confidence":96}
- "We share personal data with the service providers that host our infrastructure, and may disclose it when required by law." → {"category":"OTHER","stance":"neutral","confidence":90}
- "Any dispute shall be resolved by binding arbitration; you waive any class action." → {"category":"FORCED_ARBITRATION","stance":"hostile","confidence":98}
- "We may use content you submit to train and improve our machine learning models." → {"category":"AI_TRAINING","stance":"hostile","confidence":95}
- "You can opt out of having your data used to train our models in Settings." → {"category":"AI_TRAINING","stance":"protective","confidence":92}
- "To cancel you must call us during business hours and speak to a retention agent." → {"category":"HARD_TO_CANCEL","stance":"hostile","confidence":88}
- "In this agreement, 'Service' refers to the website and apps." → {"category":"OTHER","stance":"neutral","confidence":99}

Input: numbered clauses. Respond with JSON:
{"results":[{"i":<clause number>,"category":"<KEY>","stance":"hostile|protective|neutral","summary":"...","confidence":0-100}, ...]}
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
  const rawCategory = String(v.category ?? "").trim().toUpperCase();
  const category = CATEGORIES.includes(rawCategory as ClauseCategory)
    ? (rawCategory as ClauseCategory)
    : "OTHER";
  const rawStance = String(v.stance ?? "").trim().toLowerCase();
  const stance = STANCES.includes(rawStance as ClauseStance)
    ? (rawStance as ClauseStance)
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

  // Cache lookup — a clause is classified once and reused globally by hash.
  const { data: cached, error } = await db
    .from("classifications")
    .select("*")
    .in("clause_hash", [...unique.keys()]);
  if (error) throw new Error(`classifications lookup failed: ${error.message}`);
  for (const row of cached ?? []) {
    byHash.set(row.clause_hash, row as Classification);
  }

  const misses = [...unique]
    .filter(([hash]) => !byHash.has(hash))
    .map(([hash, content]) => ({ hash, content }));
  if (misses.length > 0) {
    log(`Classification cache: ${byHash.size} hits, ${misses.length} misses → LLM`);
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
 * new hash so the grade is unaffected and the LLM is never called. Returns
 * the new hashes that were copied.
 */
export async function copyClassifications(
  db: SupabaseClient,
  pairs: { newHash: string; oldHash: string }[]
): Promise<Set<string>> {
  if (pairs.length === 0) return new Set();

  const { data: oldRows, error } = await db
    .from("classifications")
    .select("*")
    .in("clause_hash", pairs.map((p) => p.oldHash));
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
