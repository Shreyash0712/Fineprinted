import { loadEnv } from "./load-env";

/**
 * `pnpm status` — one-shot view of what the system is doing right now:
 *
 * 1. GitHub Actions: recent workflow runs and, for an in-progress one,
 *    which step it is on (needs GITHUB_REPO + GITHUB_PAT in .env).
 * 2. pipeline_runs: recent runs with their latest progress events — this
 *    is the clause-level truth the admin panel polls, and the only place
 *    progress shows for workflow runs started before stdout mirroring.
 */

interface GhRun {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  html_url: string;
}

interface GhStep {
  name: string;
  status: string;
  conclusion: string | null;
}

async function github(): Promise<void> {
  const repo = process.env.GITHUB_REPO;
  const pat = process.env.GITHUB_PAT;
  if (!repo || !pat || pat.startsWith("your_")) {
    console.log("GitHub: GITHUB_REPO / GITHUB_PAT not set — skipping");
    return;
  }
  const headers = {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/runs?per_page=3`,
    { headers, signal: AbortSignal.timeout(15_000) }
  );
  if (!res.ok) {
    console.log(`GitHub: API ${res.status} — ${(await res.text()).slice(0, 200)}`);
    return;
  }
  const { workflow_runs: runs = [] } = (await res.json()) as { workflow_runs: GhRun[] };

  console.log("── GitHub Actions ──────────────────────────────");
  if (runs.length === 0) console.log("no workflow runs yet");
  for (const run of runs) {
    const state = run.conclusion ?? run.status;
    console.log(`${state.padEnd(12)} ${new Date(run.created_at).toLocaleString()}  ${run.html_url}`);

    if (run.status === "in_progress" || run.status === "queued") {
      const jobsRes = await fetch(
        `https://api.github.com/repos/${repo}/actions/runs/${run.id}/jobs`,
        { headers, signal: AbortSignal.timeout(15_000) }
      );
      if (!jobsRes.ok) continue;
      const { jobs = [] } = (await jobsRes.json()) as { jobs: { steps: GhStep[] }[] };
      for (const step of jobs.flatMap((j) => j.steps)) {
        const mark =
          step.status === "in_progress" ? "▶" : step.conclusion === "success" ? "✓" : " ";
        if (mark !== " ") console.log(`   ${mark} ${step.name}`);
      }
    }
  }
}

async function pipeline(): Promise<void> {
  const { createAdminClient } = await import("../lib/supabase/admin");
  const db = createAdminClient();

  const { data: runs, error } = await db
    .from("pipeline_runs")
    .select("id, service_id, status, events, error, created_at, started_at, finished_at")
    .order("created_at", { ascending: false })
    .limit(3);
  if (error) {
    console.log(`pipeline_runs: ${error.message}`);
    return;
  }

  const serviceIds = [...new Set((runs ?? []).map((r) => r.service_id))];
  const { data: services } = await db
    .from("services")
    .select("id, root_domain")
    .in("id", serviceIds);
  const domainById = new Map((services ?? []).map((s) => [s.id, s.root_domain]));

  console.log("\n── Pipeline runs ───────────────────────────────");
  if (!runs?.length) console.log("no pipeline runs yet");
  for (const run of runs ?? []) {
    const domain = domainById.get(run.service_id) ?? run.service_id;
    const events = (run.events ?? []) as { at: string; level: string; step: string; message: string }[];
    console.log(
      `${run.status.padEnd(10)} ${domain}  started ${new Date(run.created_at).toLocaleString()}  (${events.length} events)`
    );
    if (run.error) console.log(`   error: ${run.error.slice(0, 200)}`);
    // Latest activity for active runs; one-line outcome for finished ones.
    const tail = run.status === "running" || run.status === "queued" ? 4 : 1;
    for (const e of events.slice(-tail)) {
      console.log(`   ${new Date(e.at).toLocaleTimeString()} [${e.step}] ${e.message}`);
    }
  }
}

async function main(): Promise<void> {
  loadEnv();
  await github();
  await pipeline();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
