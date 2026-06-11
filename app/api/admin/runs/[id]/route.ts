import { isAdmin } from "@/lib/admin/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Pipeline run status for the admin panel, polled every few seconds while
 * a run is active. Replaces the old SSE stream: the pipeline now executes
 * on GitHub Actions, so there is no in-process stream to subscribe to —
 * just a row that the runner keeps appending progress events to.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (!(await isAdmin())) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { id } = await params;

  const db = createAdminClient();
  const { data: run, error } = await db
    .from("pipeline_runs")
    .select("id, service_id, status, events, error, created_at, started_at, finished_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return new Response(error.message, { status: 500 });
  if (!run) return new Response("Not found", { status: 404 });

  return Response.json(run, {
    headers: { "Cache-Control": "no-store" },
  });
}
