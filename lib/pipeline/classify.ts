import type { SupabaseClient } from "@supabase/supabase-js";
import { groqJson, REASONING_MODEL } from "../ai/groq";
import { CATEGORY_SEVERITY } from "../grading";
import type { Classification, ClauseCategory } from "../types";

/**
 * Stage 6 — Classification (spec 3.1.6, 4.1). Only clauses whose hash
 * misses the global classifications cache reach the LLM. The LLM picks a
 * category; severity derives from the fixed taxonomy table, never from
 * the model.
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

const SYSTEM_PROMPT = `You are a legal analyst classifying clauses from Terms of Service and Privacy Policy documents against a strict taxonomy. Respond with JSON only.

Taxonomy (pick exactly one category):
- FORCED_ARBITRATION: user waives the right to a trial by jury or class action (mandatory arbitration, class-action waiver).
- UNILATERAL_CHANGE: the service can change the terms WITHOUT notifying the user.
- DATA_SALE: explicitly sells user data or shares it with data brokers.
- CONTENT_LICENSE_BROAD: claims a perpetual and/or irrevocable license to user-generated content.
- ACCOUNT_TERMINATION: the service can terminate or suspend the account at any time, for any reason or no reason.
- TRACKING_THIRD_PARTY: extensive tracking or sharing with third parties for targeted advertising.
- NOTICE_OF_CHANGE: GUARANTEES advance notice (30+ days) before terms change. This is a pro-user clause.
- OTHER: anything else, including benign boilerplate. When in doubt, use OTHER.

Rules:
- Classify only what the clause explicitly says. Do not infer hostility that is not in the text.
- plain_english_summary: one or two sentences a non-lawyer understands, stating what this clause means for the user. Neutral tone.
- confidence: integer 0-100. How certain you are the category applies. Use below 70 when the clause only partially fits.

Respond with JSON: {"category": "...", "plain_english_summary": "...", "confidence": 0-100}`;

interface LlmVerdict {
  category: string;
  plain_english_summary: string;
  confidence: number;
}

async function classifyWithLlm(
  content: string,
  log: (message: string) => void
): Promise<{
  category: ClauseCategory;
  plain_english_summary: string;
  confidence_score: number;
}> {
  // Keep the per-call token budget small: Groq's free tier allows only
  // 8k TPM for the reasoning model, and prompt + max_tokens are charged
  // up front. Clauses are hard-capped at ~4k chars by segmentation.
  const verdict = await groqJson<LlmVerdict>({
    model: REASONING_MODEL,
    system: SYSTEM_PROMPT,
    user: `Classify this clause:\n\n${content.slice(0, 4200)}`,
    maxTokens: 600,
    reasoningEffort: "low",
    onWait: log,
  });

  const category = CATEGORIES.includes(verdict.category as ClauseCategory)
    ? (verdict.category as ClauseCategory)
    : "OTHER";
  const confidence = Math.max(0, Math.min(100, Math.round(Number(verdict.confidence) || 0)));

  return {
    category,
    plain_english_summary:
      String(verdict.plain_english_summary ?? "").slice(0, 1000) ||
      "No summary available.",
    confidence_score: confidence,
  };
}

/**
 * Ensure a classification row exists for every given clause. Returns the
 * classifications keyed by hash and how many required a fresh LLM call.
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

  // Cache lookup
  const { data: cached, error } = await db
    .from("classifications")
    .select("*")
    .in("clause_hash", [...unique.keys()]);
  if (error) throw new Error(`classifications lookup failed: ${error.message}`);
  for (const row of cached ?? []) {
    byHash.set(row.clause_hash, row as Classification);
  }

  const misses = [...unique].filter(([hash]) => !byHash.has(hash));
  if (misses.length > 0) {
    log(`Classification cache: ${byHash.size} hits, ${misses.length} misses → LLM`);
  } else {
    log(`Classification cache: all ${byHash.size} clauses already classified ($0)`);
  }

  let done = 0;
  for (const [hash, content] of misses) {
    const verdict = await classifyWithLlm(content, log);
    const row: Classification = {
      clause_hash: hash,
      category: verdict.category,
      severity: CATEGORY_SEVERITY[verdict.category],
      plain_english_summary: verdict.plain_english_summary,
      confidence_score: verdict.confidence_score,
      model: REASONING_MODEL,
      admin_approved: false,
      created_at: new Date().toISOString(),
    };
    const { error: upsertError } = await db
      .from("classifications")
      .upsert(row, { onConflict: "clause_hash" });
    if (upsertError) {
      throw new Error(`classification upsert failed: ${upsertError.message}`);
    }
    byHash.set(hash, row);
    done++;
    if (done % 10 === 0) log(`Classified ${done}/${misses.length} clauses…`);
  }

  return { byHash, llmCalls: misses.length };
}

/**
 * Formatting-only changes: carry the old hash's classification over to the
 * new hash so the grade is unaffected and the LLM is never called.
 */
export async function copyClassifications(
  db: SupabaseClient,
  pairs: { newHash: string; oldHash: string }[]
): Promise<number> {
  if (pairs.length === 0) return 0;

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
  return inserts.length;
}
