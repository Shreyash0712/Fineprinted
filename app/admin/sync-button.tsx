"use client";

import { useState } from "react";
import { syncStaticData } from "./actions";

/**
 * Manual escape hatch: re-dispatches the export workflow in case a
 * publish-time dispatch failed (the public site reads committed static
 * data, so a missed export means a stale site until the next one).
 */
export function SyncButton() {
  const [state, setState] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function sync() {
    setState("pending");
    setMessage(null);
    const { error } = await syncStaticData();
    if (error) {
      setState("error");
      setMessage(error);
    } else {
      setState("done");
      setMessage("Export dispatched — the site redeploys once data changes are committed.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={sync}
        disabled={state === "pending"}
        className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
      >
        {state === "pending" ? "Dispatching…" : "Sync site data"}
      </button>
      {message && (
        <span className={`text-xs ${state === "error" ? "text-red-400" : "text-emerald-400"}`}>
          {message}
        </span>
      )}
    </div>
  );
}
