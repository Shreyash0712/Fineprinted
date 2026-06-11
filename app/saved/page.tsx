"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getVisitorId } from "@/lib/fingerprint";
import { getWatchlist, toggleWatch, type WatchlistEntry } from "../actions";
import { GradeBadge } from "../components/grade";
import { SiteHeader } from "../components/site-header";

const TYPE_LABELS: Record<string, string> = {
  terms_of_service: "Terms of Service",
  privacy_policy: "Privacy Policy",
  cookie_policy: "Cookie Policy",
  acceptable_use: "Acceptable Use",
  other: "Other",
};

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
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <div>
          <h1 className="text-2xl font-bold">Saved services</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Your watchlist — tied to this browser, no account needed. Recent
            policy changes for each service show up here.
          </p>
        </div>

        {entries === null ? (
          <p className="py-16 text-center text-sm text-zinc-500">Loading your watchlist…</p>
        ) : entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 py-16 text-center">
            <p className="text-sm text-zinc-400">Nothing saved yet.</p>
            <Link
              href="/"
              className="mt-3 inline-block rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
            >
              Browse services
            </Link>
          </div>
        ) : (
          <ul className="space-y-4">
            {entries.map(({ service, events }) => (
              <li
                key={service.id}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5"
              >
                <div className="flex items-center gap-4">
                  <GradeBadge grade={service.current_grade} size="md" />
                  <Link href={`/s/${service.root_domain}`} className="min-w-0 flex-1 group">
                    <span className="block truncate font-medium group-hover:text-indigo-300">
                      {service.name}
                    </span>
                    <span className="block truncate text-sm text-zinc-500">
                      {service.root_domain}
                    </span>
                  </Link>
                  {service.current_score !== null && (
                    <span className="text-sm tabular-nums text-zinc-400">
                      {service.current_score}/100
                    </span>
                  )}
                  <button
                    onClick={() => remove(service.id)}
                    className="rounded-md px-2 py-1 text-xs text-zinc-500 transition hover:bg-zinc-800 hover:text-red-300"
                    title="Remove from saved"
                  >
                    Remove
                  </button>
                </div>

                {events.length > 0 && (
                  <ul className="mt-4 space-y-2 border-t border-zinc-800/60 pt-3">
                    {events.map((e) => (
                      <li key={e.id} className="text-sm">
                        <span className="text-xs text-zinc-500">
                          {e.published_at &&
                            new Date(e.published_at).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}{" "}
                          · {TYPE_LABELS[e.document_type] ?? e.document_type}
                          {e.severity_score !== null && e.severity_score !== 0 && (
                            <span
                              className={`ml-1.5 rounded px-1.5 py-0.5 tabular-nums ${
                                e.severity_score < 0
                                  ? "bg-red-500/15 text-red-300"
                                  : "bg-emerald-500/15 text-emerald-300"
                              }`}
                            >
                              {e.severity_score > 0 ? "+" : ""}
                              {e.severity_score} pts
                            </span>
                          )}
                        </span>
                        {e.ai_summary && (
                          <p className="mt-0.5 leading-relaxed text-zinc-300">{e.ai_summary}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
