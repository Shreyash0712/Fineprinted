"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getVisitorId } from "@/lib/fingerprint";
import type { Service } from "@/lib/types";
import { getWatchedIds, toggleWatch } from "../actions";
import { GradeBadge, ScoreBar } from "./grade";
import { BookmarkIcon } from "./site-header";

export function ServiceExplorer({ services }: { services: Service[] }) {
  const [query, setQuery] = useState("");
  const [watched, setWatched] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    getVisitorId()
      .then(getWatchedIds)
      .then((ids) => {
        if (!cancelled) setWatched(new Set(ids));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return services;
    return services.filter(
      (s) => s.name.toLowerCase().includes(q) || s.root_domain.toLowerCase().includes(q)
    );
  }, [services, query]);

  async function onToggle(serviceId: string) {
    // optimistic flip, reverted on failure
    const flip = () =>
      setWatched((prev) => {
        const next = new Set(prev);
        if (next.has(serviceId)) next.delete(serviceId);
        else next.add(serviceId);
        return next;
      });
    flip();
    try {
      const fp = await getVisitorId();
      const { saved } = await toggleWatch(serviceId, fp);
      setWatched((prev) => {
        const next = new Set(prev);
        if (saved) next.add(serviceId);
        else next.delete(serviceId);
        return next;
      });
    } catch {
      flip();
    }
  }

  return (
    <div className="space-y-8">
      <div className="relative mx-auto max-w-2xl">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search services… (e.g. spotify.com)"
          className="w-full rounded-2xl border border-zinc-200 bg-white py-4 pl-12 pr-4 text-base shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 dark:border-zinc-800 dark:bg-zinc-900/60 dark:placeholder:text-zinc-600 dark:focus:border-indigo-500/60 dark:focus:bg-zinc-900"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-zinc-500 dark:text-zinc-400">
            {services.length === 0
              ? "No services tracked yet."
              : `Nothing matches "${query}".`}
          </p>
          <Link
            href="/request"
            className="mt-4 inline-block rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-400"
          >
            Request it →
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <li key={s.id} className="group relative">
              <Link
                href={`/s/${s.root_domain}`}
                className="block rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900/50 dark:shadow-none dark:hover:border-indigo-500/40 dark:hover:bg-zinc-900"
              >
                <div className="flex items-start gap-4">
                  <GradeBadge grade={s.current_grade} size="lg" />
                  <div className="min-w-0 flex-1 pt-0.5">
                    <span className="block truncate text-lg font-semibold">{s.name}</span>
                    <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">
                      {s.root_domain}
                    </span>
                  </div>
                </div>
                <div className="mt-5">
                  <ScoreBar score={s.current_score} grade={s.current_grade} />
                </div>
                <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
                  Updated{" "}
                  {new Date(s.updated_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </Link>
              <button
                onClick={() => onToggle(s.id)}
                title={watched.has(s.id) ? "Remove from saved" : "Save to watchlist"}
                className={`absolute right-4 top-4 rounded-lg p-2 transition ${
                  watched.has(s.id)
                    ? "text-indigo-500 hover:text-indigo-400 dark:text-indigo-400"
                    : "text-zinc-300 opacity-0 hover:text-zinc-500 group-hover:opacity-100 dark:text-zinc-600 dark:hover:text-zinc-300"
                }`}
              >
                <BookmarkIcon className="h-5 w-5" filled={watched.has(s.id)} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
