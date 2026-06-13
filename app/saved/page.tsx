"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getVisitorId } from "@/lib/fingerprint";
import { getWatchlist, toggleWatch, type WatchlistEntry } from "../actions";
import { GradeBadge } from "../components/grade";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";


// Removed TYPE_LABELS

export default function SavedPage() {
  const [entries, setEntries] = useState<WatchlistEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVisitorId()
      .then(getWatchlist)
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function remove(serviceId: string) {
    setEntries((prev) => prev?.filter((e) => e.service.id !== serviceId) ?? null);
    try {
      const fp = await getVisitorId();
      await toggleWatch(serviceId, fp);
    } catch {
      // refetch to recover from a failed delete
      try {
        setEntries(await getWatchlist(await getVisitorId()));
      } catch {}
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <div className="max-w-3xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold font-heading">Saved services</h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Your watchlist, tied to this browser, no account needed. Policy changes
              are monitored and explained automatically by AI. AI can make mistakes.
            </p>
          </div>

          {entries === null ? (
            <p className="py-16 text-center text-sm text-zinc-500">Loading your watchlist…</p>
          ) : entries.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 py-16 text-center bg-white dark:bg-zinc-900/10">
              <p className="text-sm text-zinc-400">Nothing saved yet.</p>
              <Link
                href="/browse"
                className="mt-3 inline-block rounded-lg bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-semibold text-white shadow-md transition"
              >
                Browse services
              </Link>
            </div>
          ) : (
            <ul className="space-y-4">
              {entries.map(({ service, events }) => (
                <li
                  key={service.id}
                  className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40 p-5 shadow-sm"
                >
                  <div className="flex items-center gap-4">
                    <GradeBadge grade={service.current_grade} size="md" />
                    <Link href={`/s/${service.root_domain}`} className="min-w-0 flex-1 group">
                      <span className="block truncate font-semibold text-zinc-900 dark:text-zinc-100 group-hover:text-accent dark:group-hover:text-accent transition">
                        {service.name}
                      </span>
                      <span className="block truncate text-xs text-zinc-500">
                        {service.root_domain}
                      </span>
                    </Link>
                    {service.current_score !== null && (
                      <span className="text-sm tabular-nums text-zinc-500 dark:text-zinc-400 font-medium mr-2">
                        {service.current_score}/100
                      </span>
                    )}
                    <button
                      onClick={() => remove(service.id)}
                      className="rounded-md px-2.5 py-1 text-xs text-zinc-500 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                      title="Remove from saved"
                    >
                      Remove
                    </button>
                  </div>

                  {events.length > 0 && (
                    <ul className="mt-4 space-y-2.5 border-t border-zinc-100/80 dark:border-zinc-800/60 pt-3.5">
                      {events.map((e) => (
                        <li key={e.id} className="text-sm">
                          <span className="text-xs text-zinc-500">
                            {e.published_at &&
                              new Date(e.published_at).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}{" "}
                            · {e.document_name}
                            {e.severity_score !== null && e.severity_score !== 0 && (
                              <span
                                className={`ml-1.5 rounded px-1.5 py-0.5 tabular-nums text-xs font-semibold ${
                                  e.severity_score < 0
                                    ? "bg-red-500/10 text-red-800 dark:bg-red-500/15 dark:text-red-300"
                                    : "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                }`}
                              >
                                {e.severity_score > 0 ? "+" : ""}
                                {e.severity_score} pts
                              </span>
                            )}
                          </span>
                          {e.ai_summary && (
                            <p className="mt-0.5 leading-relaxed text-zinc-700 dark:text-zinc-300">{e.ai_summary}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

