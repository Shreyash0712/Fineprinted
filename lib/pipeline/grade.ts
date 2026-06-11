import type { SupabaseClient } from "@supabase/supabase-js";
import { computeScore, scoreToGrade } from "../grading";
import type { Classification, Grade } from "../types";
import { loadPublishedState } from "./published-state";

/**
 * Recompute a service's score from the *published* snapshot of every
 * document and store it (activating the service). Called by the pipeline
 * at the end of every run — there is no manual publish step — and by the
 * admin action that approves a low-confidence classification.
 *
 * Returns null (and changes nothing) while the service has no published
 * documents yet: an empty clause set would otherwise score a perfect 100.
 */
export async function recomputeServiceGrade(
  db: SupabaseClient,
  serviceId: string
): Promise<{ score: number; grade: Grade } | null> {
  const states = await loadPublishedState(db, serviceId);
  if (states.every((s) => s.snapshot_id === null)) return null;

  const all: Classification[] = states.flatMap((state) =>
    state.clauses
      .map((c) => state.classifications.get(c.hash))
      .filter((c): c is Classification => !!c)
  );

  const score = computeScore(all);
  const grade = scoreToGrade(score);
  const { error } = await db
    .from("services")
    .update({ current_score: score, current_grade: grade, status: "active" })
    .eq("id", serviceId);
  if (error) throw new Error(`grade update failed: ${error.message}`);
  return { score, grade };
}
