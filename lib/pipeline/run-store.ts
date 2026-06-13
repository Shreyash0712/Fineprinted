import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineRun } from "../types";

/**
 * Lightweight pipeline_runs helpers — safe to import from server actions
 * without dragging the whole pipeline (embeddings, LLM clients, …) into
 * the bundle. The executor lives in ./runs.ts.
 */

/** A queued/running run younger than this blocks a new trigger. */
export const RUN_STALE_MS = 2 * 60 * 60 * 1000;

export function isRunActive(run: Pick<PipelineRun, "status" | "created_at">): boolean {
  return (
    (run.status === "queued" || run.status === "running") &&
    Date.now() - new Date(run.created_at).getTime() < RUN_STALE_MS
  );
}

export async function createRun(
  db: SupabaseClient,
  serviceId: string
): Promise<PipelineRun> {
  const { data, error } = await db
    .from("pipeline_runs")
    .insert({ service_id: serviceId })
    .select("*")
    .single();
  if (error) throw new Error(`pipeline run insert failed: ${error.message}`);
  return data as PipelineRun;
}

export async function failRun(
  db: SupabaseClient,
  runId: string,
  message: string
): Promise<void> {
  await db
    .from("pipeline_runs")
    .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
    .eq("id", runId)
    .in("status", ["queued", "running"]);
}

/** Progress logs are debugging aids, not history — keep only recent ones. */
const RUN_RETENTION_DAYS = 30;

export async function pruneOldRuns(db: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { error, count } = await db
    .from("pipeline_runs")
    .delete({ count: "exact" })
    .in("status", ["succeeded", "failed"])
    .lt("created_at", cutoff.toISOString());
  if (error) throw new Error(`pipeline run pruning failed: ${error.message}`);
  return count ?? 0;
}
