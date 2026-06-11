"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { PipelineEvent } from "@/lib/pipeline/run";

const levelColor: Record<PipelineEvent["level"], string> = {
  info: "text-zinc-400",
  success: "text-emerald-400",
  warn: "text-yellow-400",
  error: "text-red-400",
};

export function RunPipeline({ serviceId }: { serviceId: string }) {
  const [lines, setLines] = useState<PipelineEvent[]>([]);
  const [running, setRunning] = useState(false);
  const router = useRouter();
  const sourceRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  useEffect(() => () => sourceRef.current?.close(), []);

  function start() {
    setLines([]);
    setRunning(true);
    const source = new EventSource(
      `/api/admin/pipeline?serviceId=${encodeURIComponent(serviceId)}`
    );
    sourceRef.current = source;

    source.onmessage = (e) => {
      setLines((prev) => [...prev, JSON.parse(e.data) as PipelineEvent]);
    };
    const finish = () => {
      source.close();
      setRunning(false);
      router.refresh();
    };
    source.addEventListener("end", finish);
    source.onerror = () => {
      // Close instead of letting EventSource auto-reconnect, which would
      // re-run the whole pipeline.
      setLines((prev) => [
        ...prev,
        { level: "error", step: "stream", message: "Stream disconnected" },
      ]);
      finish();
    };
  }

  return (
    <div className="space-y-3">
      <button
        onClick={start}
        disabled={running}
        className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
      >
        {running ? "Running…" : "Run pipeline"}
      </button>
      {lines.length > 0 && (
        <div
          ref={logRef}
          className="max-h-72 overflow-y-auto rounded-lg border border-zinc-800 bg-black p-3 font-mono text-xs leading-relaxed"
        >
          {lines.map((line, i) => (
            <div key={i} className={levelColor[line.level]}>
              <span className="text-zinc-600">[{line.step}]</span> {line.message}
            </div>
          ))}
          {running && <div className="animate-pulse text-zinc-500">▍</div>}
        </div>
      )}
    </div>
  );
}
