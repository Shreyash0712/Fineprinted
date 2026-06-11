import { isAdmin } from "@/lib/admin/auth";
import { runServicePipeline, type PipelineEvent } from "@/lib/pipeline/run";

/**
 * SSE endpoint streaming live pipeline progress to the admin dashboard
 * (spec section 7 — Execution & Streaming). GET because EventSource can't
 * POST; auth via the admin session cookie.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request): Promise<Response> {
  if (!(await isAdmin())) {
    return new Response("Unauthorized", { status: 401 });
  }
  const serviceId = new URL(req.url).searchParams.get("serviceId");
  if (!serviceId) {
    return new Response("serviceId is required", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PipelineEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        await runServicePipeline(serviceId, send);
      } catch (err) {
        send({
          level: "error",
          step: "fatal",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        // Named "end" event tells the client to close — otherwise
        // EventSource would auto-reconnect and re-run the pipeline.
        controller.enqueue(encoder.encode("event: end\ndata: {}\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
