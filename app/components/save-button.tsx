"use client";

import { useEffect, useState } from "react";
import { getVisitorId } from "@/lib/fingerprint";
import { getWatchedIds, toggleWatch } from "../actions";
import { BookmarkIcon } from "./site-header";

/** Save/unsave a service to the fingerprint-keyed watchlist. */
export function SaveButton({ serviceId }: { serviceId: string }) {
  const [saved, setSaved] = useState<boolean | null>(null); // null = loading
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getVisitorId()
      .then(getWatchedIds)
      .then((ids) => {
        if (!cancelled) setSaved(ids.includes(serviceId));
      })
      .catch(() => {
        if (!cancelled) setSaved(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  async function onClick() {
    if (saved === null || busy) return;
    setBusy(true);
    setSaved(!saved);
    try {
      const fp = await getVisitorId();
      const res = await toggleWatch(serviceId, fp);
      setSaved(res.saved);
    } catch {
      setSaved(saved);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={saved === null || busy}
      className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-60 ${
        saved
          ? "bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/40 hover:bg-indigo-500/25"
          : "bg-zinc-100 text-zinc-900 hover:bg-white"
      }`}
    >
      <BookmarkIcon className="h-4 w-4" filled={!!saved} />
      {saved === null ? "…" : saved ? "Saved" : "Save"}
    </button>
  );
}
