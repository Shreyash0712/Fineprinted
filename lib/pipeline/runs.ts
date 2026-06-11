import { createAdminClient } from "../supabase/admin";
import type { PipelineRunEvent } from "../types";
import { runServicePipeline } from "./run";

export { createRun, failRun, isRunActive, RUN_STALE_MS } from "./run-store";

/**
 * Pipeline run executor. Runs execute on GitHub Actions (or inline during
 * local dev) — never inside a Vercel request, whose 300s wall clock cannot
 * absorb free-tier rate-limit sleeps. Progress is appended to
 * pipeline_runs.events, which the admin UI polls.
 */

/**
 * Execute a queued run end-to-end, streaming events into the row. Event
 * writes are serialized on a promise chain so the synchronous emit()
 * callback never races itself; each write replaces the whole (small)
 * events array, which keeps the logic idempotent.
 */
export async function executePipelineRun(runId: string): Promise<void> {
  const db = createAdminClient();

  const { data: run, error } = await db
    .from("pipeline_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (error || !run) throw new Error(`Pipeline run not found: ${runId}`);
  if (run.status === "succeeded" || run.status === "failed") {
    throw new Error(`Pipeline run ${runId} already finished (${run.status})`);
  }

  await db
    .from("pipeline_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", runId);

  const events: PipelineRunEvent[] = [];
  let chain: Promise<void> = Promise.resolve();
  const emit = (event: { level: PipelineRunEvent["level"]; step: string; message: string }) => {
    events.push({ ...event, at: new Date().toISOString() });
    // Mirror to stdout so the GitHub Actions log (and the dev console)
    // shows live progress — the DB events exist for the admin panel.
    console.log(`[${event.level}][${event.step}] ${event.message}`);
    const snapshot = [...events];
    chain = chain
      .then(async () => {
        await db.from("pipeline_runs").update({ events: snapshot }).eq("id", runId);
      })
      .catch(() => {}); // progress writes are best-effort; the run itself decides success
  };

  try {
    await runServicePipeline(run.service_id, emit);
    await chain;
    await db
      .from("pipeline_runs")
      .update({ status: "succeeded", finished_at: new Date().toISOString(), events })
      .eq("id", runId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await chain.catch(() => {});
    await db
      .from("pipeline_runs")
      .update({
        status: "failed",
        error: message,
        finished_at: new Date().toISOString(),
        events,
      })
      .eq("id", runId);
    throw err;
  }
}
