"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getVisitorId } from "@/lib/fingerprint";
import { getWatchlist, toggleWatch, type WatchlistEntry } from "../actions";
import { GradeBadge } from "./grade";

export function HomeSavedServices() {
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
    // Optimistically remove the item from local state
    setEntries((prev) => prev?.filter((e) => e.service.id !== serviceId) ?? null);
    try {
      const fp = await getVisitorId();
      await toggleWatch(serviceId, fp);
    } catch {
      // Re-fetch to recover from a failed delete
      try {
        const fp = await getVisitorId();
        const list = await getWatchlist(fp);
        setEntries(list);
      } catch {}
    }
  }

  if (entries === null || entries.length === 0) {
    return null;
  }

  return (
    <section className="mb-8 mt-4 animate-fade-in-up border-b border-zinc-200/20 pb-8 dark:border-zinc-900/20">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight font-heading sm:text-2xl">
            Your Watchlist
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Quick access to the terms you are tracking
          </p>
        </div>
        <Link
          href="/saved"
          className="text-xs font-semibold text-accent hover:underline dark:text-accent-hover flex items-center gap-1 transition-all"
        >
          Manage Watchlist <span className="text-sm">→</span>
        </Link>
      </div>

      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(({ service, events }) => (
          <li key={service.id} className="group relative">
            <Link
              href={`/s/${service.root_domain}`}
              className="block rounded-2xl border border-zinc-200 bg-white/70 backdrop-blur-md p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900/40 dark:shadow-none dark:hover:border-accent/30 dark:hover:bg-zinc-900"
            >
              <div className="flex items-start gap-4">
                <GradeBadge grade={service.current_grade} size="md" />
                <div className="min-w-0 flex-1 pt-0.5">
                  <span className="block truncate font-semibold text-sm group-hover:text-accent dark:group-hover:text-accent transition duration-200">
                    {service.name}
                  </span>
                  <span className="block truncate text-xs text-zinc-500 dark:text-zinc-450 mt-0.5">
                    {service.root_domain}
                  </span>
                </div>
              </div>

              {service.current_score !== null && (
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-zinc-450 dark:text-zinc-500">Grade Score:</span>
                  <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
                    {service.current_score}/100
                  </span>
                </div>
              )}

              {events.length > 0 && events[0].ai_summary && (
                <div className="mt-3 border-t border-zinc-150/40 pt-2.5 dark:border-zinc-800/60">
                  <p className="text-[10px] font-bold text-accent dark:text-[#D7B88F] uppercase tracking-wider">
                    Latest Update
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-655 dark:text-zinc-350 line-clamp-2">
                    {events[0].ai_summary}
                  </p>
                </div>
              )}
            </Link>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                remove(service.id);
              }}
              title="Remove from watchlist"
              className="absolute right-3.5 top-3.5 rounded-full p-1.5 text-zinc-450 hover:bg-red-500/10 hover:text-red-600 dark:text-zinc-500 dark:hover:bg-red-500/20 dark:hover:text-red-400 transition-all duration-250 z-10 cursor-pointer"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
