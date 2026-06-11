import { loadEnv } from "./load-env";

/**
 * Pipeline runner — the entry point GitHub Actions executes (also usable
 * locally). Runs may sleep for many minutes waiting out free-tier LLM
 * rate limits, which is exactly why they live here and not in a Vercel
 * function.
 *
 * Usage:
 *   PIPELINE_RUN_ID=<uuid> pnpm pipeline       # run an existing queued run
 *   pnpm pipeline --service <service-uuid>     # create a run and execute it
 */
async function main(): Promise<void> {
  loadEnv();
  // Imported after loadEnv so module-level env reads see .env values.
  const { createAdminClient } = await import("../lib/supabase/admin");
  const { createRun, executePipelineRun, failRun } = await import("../lib/pipeline/runs");

  let runId = process.env.PIPELINE_RUN_ID?.trim() || "";
  const serviceFlag = process.argv.indexOf("--service");
  if (!runId && serviceFlag !== -1) {
    const serviceId = process.argv[serviceFlag + 1];
    if (!serviceId) throw new Error("--service requires a service id");
    const run = await createRun(createAdminClient(), serviceId);
    runId = run.id;
    console.log(`Created pipeline run ${runId}`);
  }
  if (!runId) {
    throw new Error("Provide PIPELINE_RUN_ID or --service <service-uuid>");
  }

  try {
    await executePipelineRun(runId);
    console.log(`Run ${runId} succeeded`);
  } catch (err) {
    // executePipelineRun marks failures it reaches; this also covers
    // errors before the run row was loaded (bad id, connectivity).
    await failRun(createAdminClient(), runId, err instanceof Error ? err.message : String(err)).catch(
      () => {}
    );
    throw err;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
