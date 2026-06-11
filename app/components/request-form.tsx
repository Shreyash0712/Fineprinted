"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { getVisitorId } from "@/lib/fingerprint";
import { requestService, type RequestResult } from "../actions";

export function RequestForm() {
  const [domain, setDomain] = useState("");
  const [name, setName] = useState("");
  const [result, setResult] = useState<RequestResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      try {
        const fp = await getVisitorId();
        const res = await requestService(domain, name, fp);
        setResult(res);
        if (res.ok) {
          setDomain("");
          setName("");
        }
      } catch {
        setResult({ ok: false, message: "Something went wrong. Try again later." });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="req-domain" className="mb-1.5 block text-sm font-medium">
          Website domain <span className="text-red-500">*</span>
        </label>
        <input
          id="req-domain"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="netflix.com"
          required
          className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 dark:border-zinc-800 dark:bg-zinc-900/60 dark:placeholder:text-zinc-600 dark:focus:border-indigo-500/60"
        />
        <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          Paste anything — a full URL works. We reduce it to the root domain.
        </p>
      </div>
      <div>
        <label htmlFor="req-name" className="mb-1.5 block text-sm font-medium">
          Service name <span className="text-zinc-400 dark:text-zinc-500">(optional)</span>
        </label>
        <input
          id="req-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Netflix"
          maxLength={80}
          className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 dark:border-zinc-800 dark:bg-zinc-900/60 dark:placeholder:text-zinc-600 dark:focus:border-indigo-500/60"
        />
        <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          How the service should be displayed once it&apos;s tracked.
        </p>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-indigo-500 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-400 disabled:opacity-50"
      >
        {pending ? "Submitting…" : "Submit request"}
      </button>
      {result && (
        <p
          className={`text-sm ${result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
        >
          {result.message}
          {result.href && (
            <>
              {" "}
              <Link href={result.href} className="underline">
                View it →
              </Link>
            </>
          )}
        </p>
      )}
    </form>
  );
}
