/**
 * Dispatches the GitHub Actions workflow that executes the pipeline and
 * exports static data. This is all Vercel ever does — one ~200ms API
 * call — so admin actions finish instantly regardless of how long the
 * actual run takes.
 *
 * Required env (Vercel → Project Settings → Environment Variables):
 * - GITHUB_REPO  e.g. "Shreyash0712/FinePrint"
 * - GITHUB_PAT   fine-grained token with Actions read+write on that repo
 * - GITHUB_BRANCH optional, defaults to "main"
 */

const WORKFLOW_FILE = "pipeline.yml";

export function githubConfigured(): boolean {
  const repo = process.env.GITHUB_REPO;
  const pat = process.env.GITHUB_PAT;
  return !!repo && !!pat && !pat.startsWith("your_");
}

export type WorkflowMode = "pipeline" | "export";

export async function dispatchWorkflow(inputs: {
  mode: WorkflowMode;
  run_id?: string;
}): Promise<void> {
  const repo = process.env.GITHUB_REPO;
  const pat = process.env.GITHUB_PAT;
  if (!repo || !pat) throw new Error("GITHUB_REPO / GITHUB_PAT are not configured");

  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: process.env.GITHUB_BRANCH || "main",
        inputs: { mode: inputs.mode, ...(inputs.run_id ? { run_id: inputs.run_id } : {}) },
      }),
      signal: AbortSignal.timeout(15_000),
    }
  );

  // Success is 204 No Content.
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub workflow dispatch failed (${res.status}): ${body.slice(0, 300)}`);
  }
}
