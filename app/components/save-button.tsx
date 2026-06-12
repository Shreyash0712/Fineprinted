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
          ? "bg-accent-light text-accent ring-1 ring-accent/30 hover:bg-accent/20"
          : "bg-zinc-100 text-zinc-900 hover:bg-white dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-850"
      }`}
    >
      <BookmarkIcon className="h-4 w-4" filled={!!saved} />
      {saved === null ? "…" : saved ? "Saved" : "Save"}
    </button>
  );
}
