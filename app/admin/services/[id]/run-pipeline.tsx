"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PipelineRun, PipelineRunEvent } from "@/lib/types";
import { triggerPipeline, cancelPipelineRun } from "../../actions";

/**
 * Pipeline control panel. Triggering only dispatches a GitHub Actions
 * workflow; this panel then polls the pipeline_runs row for progress.
 * Surviving a page refresh is free — the server passes the latest run in
 * as initialRun and polling resumes if it is still active.
 */

const POLL_MS = 3_000;
const QUEUED_HINT_MS = 5 * 60 * 1000;

const levelColor: Record<PipelineRunEvent["level"], string> = {
  info: "text-zinc-400",
  success: "text-emerald-400",
  warn: "text-yellow-400",
  error: "text-red-400",
};

const STATUS_BADGE: Record<PipelineRun["status"], string> = {
  queued: "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded-full px-2 py-0.5 text-xs font-semibold",
  running: "bg-accent/10 text-accent border border-accent/20 rounded-full px-2 py-0.5 text-xs font-semibold animate-pulse",
  succeeded: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full px-2 py-0.5 text-xs font-semibold",
  failed: "bg-red-500/10 text-red-400 border border-red-500/20 rounded-full px-2 py-0.5 text-xs font-semibold",
};

function isActive(run: PipelineRun | null): boolean {
  return !!run && (run.status === "queued" || run.status === "running");
}

export function RunPipeline({
  serviceId,
  initialRun,
  hasContent,
}: {
  serviceId: string;
  initialRun: PipelineRun | null;
  /** Runs are pointless without pasted document text — the button stays off. */
  hasContent: boolean;
}) {
  const [run, setRun] = useState<PipelineRun | null>(initialRun);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [queuedLong, setQueuedLong] = useState(false);
  const router = useRouter();
  const logRef = useRef<HTMLDivElement | null>(null);
  const wasActiveRef = useRef(isActive(initialRun));

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [run?.events.length]);

  const poll = useCallback(async () => {
    if (!run) return;
    try {
      const res = await fetch(`/api/admin/runs/${run.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as PipelineRun;
      setRun(next);
      setQueuedLong(
        next.status === "queued" &&
          Date.now() - new Date(next.created_at).getTime() > QUEUED_HINT_MS
      );
      if (wasActiveRef.current && !isActive(next)) {
        wasActiveRef.current = false;
        router.refresh(); // pull in the new draft change events
      }
    } catch {
      // transient network error — next tick retries
    }
  }, [run?.id, router]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isActive(run)) return;
    wasActiveRef.current = true;
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [run?.id, run?.status, poll]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setPending(true);
    setActionError(null);
    setQueuedLong(false);
    try {
      const result = await triggerPipeline(serviceId);
      if (result.error) {
        setActionError(result.error);
      } else if (result.runId) {
        if (result.resumed) {
          setActionError("A run is already in progress, re-attached to it.");
        }
        setRun({
          id: result.runId,
          service_id: serviceId,
          status: "queued",
          events: [],
          error: null,
          created_at: new Date().toISOString(),
          started_at: null,
          finished_at: null,
        });
        wasActiveRef.current = true;
      }
    } finally {
      setPending(false);
    }
  }

  async function cancelRun() {
    if (!run) return;
    setPending(true);
    setActionError(null);
    try {
      const result = await cancelPipelineRun(run.id);
      if (result.error) {
        setActionError(result.error);
      } else {
        setRun({ ...run, status: "failed", error: "Cancelled manually by admin" });
        wasActiveRef.current = false;
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={start}
          disabled={pending || isActive(run) || !hasContent}
          className="rounded-xl bg-accent hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/10 px-5 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 cursor-pointer"
        >
          {isActive(run) ? "Running…" : pending ? "Starting…" : "Run pipeline"}
        </button>
        {isActive(run) && (
          <button
            onClick={cancelRun}
            disabled={pending}
            className="rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 cursor-pointer"
          >
            Force Cancel
          </button>
        )}
        {!hasContent && !isActive(run) && (
          <span className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">
            Paste at least one document&apos;s text below first — the pipeline
            analyzes the pasted text.
          </span>
        )}
        {run && (
          <span className={STATUS_BADGE[run.status]}>
            {run.status}
          </span>
        )}
        {run && (
          <span className="text-xs text-zinc-500 font-medium">
            started {new Date(run.created_at).toLocaleString()}
          </span>
        )}
      </div>

      {actionError && (
        <p className="rounded-xl border border-yellow-600/30 bg-yellow-600/10 px-4 py-3 text-xs text-yellow-300">
          {actionError}
        </p>
      )}

      {run?.status === "queued" && (
        <p className="text-xs text-zinc-500">
          Waiting for a GitHub Actions runner to pick the job up…
          {queuedLong && (
            <span className="text-yellow-400">
              {" "}
              This is taking long, check the repository&apos;s Actions tab and that the
              workflow secrets are configured.
            </span>
          )}
        </p>
      )}

      {run && run.events.length > 0 && (
        <div
          ref={logRef}
          className="max-h-72 overflow-y-auto rounded-xl border border-zinc-900 bg-black p-4 font-mono text-xs leading-relaxed text-zinc-300"
        >
          {run.events.map((line, i) => (
            <div key={i} className={levelColor[line.level]}>
              <span className="text-zinc-700">[{line.step}]</span> {line.message}
            </div>
          ))}
          {isActive(run) && <div className="animate-pulse text-zinc-500 inline-block">▍</div>}
        </div>
      )}

      {run?.status === "failed" && run.error && (
        <p className="rounded-xl border border-red-700/30 bg-red-700/10 px-4 py-3 text-xs text-red-300">
          {run.error}
        </p>
      )}
    </div>
  );
}
