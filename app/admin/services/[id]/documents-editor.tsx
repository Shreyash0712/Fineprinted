"use client";

import { useState } from "react";
import type { SuggestResult } from "@/lib/admin/suggest-urls";
import type { UrlCheck } from "@/lib/pipeline/extract";
import { DOCUMENT_TYPE_LABELS, type DocumentType } from "@/lib/types";
import {
  saveDocumentUrls,
  suggestServiceUrls,
  verifyDocumentUrls,
} from "../../actions";

/**
 * Per-document URL editor. URLs saved here are the only thing the pipeline
 * ever fetches — there is no automatic discovery. "Test fetch" dry-runs the
 * exact pipeline extraction so the admin can confirm a URL scrapes cleanly
 * before dispatching a run; "Suggest" scans the homepage for candidates but
 * only pre-fills the boxes for review.
 */

const DOCUMENT_TYPES: DocumentType[] = [
  "terms_of_service",
  "privacy_policy",
  "cookie_policy",
  "acceptable_use",
  "other",
];

interface DocState {
  text: string;
  dirty: boolean;
  busy: "save" | "test" | null;
  error: string | null;
  saved: boolean;
  checks: UrlCheck[] | null;
}

const inputClass =
  "w-full rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-900 dark:text-zinc-150 placeholder:text-zinc-400 dark:placeholder:text-zinc-650 outline-none focus:border-accent transition";

const smallButtonClass =
  "rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer disabled:opacity-50 disabled:cursor-default";

export function DocumentsEditor({
  serviceId,
  initialUrls,
}: {
  serviceId: string;
  initialUrls: Partial<Record<DocumentType, string[]>>;
}) {
  const [docs, setDocs] = useState<Record<DocumentType, DocState>>(() => {
    const entries = DOCUMENT_TYPES.map((type) => [
      type,
      {
        text: (initialUrls[type] ?? []).join("\n"),
        dirty: false,
        busy: null,
        error: null,
        saved: (initialUrls[type] ?? []).length > 0,
        checks: null,
      } satisfies DocState,
    ]);
    return Object.fromEntries(entries) as Record<DocumentType, DocState>;
  });
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestResult | null>(null);

  function patch(type: DocumentType, partial: Partial<DocState>) {
    setDocs((prev) => ({ ...prev, [type]: { ...prev[type], ...partial } }));
  }

  async function save(type: DocumentType) {
    const { text, saved } = docs[type];
    if (
      text.trim() === "" &&
      saved &&
      !window.confirm(
        `Remove the ${DOCUMENT_TYPE_LABELS[type]} document? Its snapshots and change history are deleted with it.`
      )
    ) {
      return;
    }
    patch(type, { busy: "save", error: null });
    try {
      const result = await saveDocumentUrls(serviceId, type, text);
      if (result.error) {
        patch(type, { busy: null, error: result.error });
      } else {
        patch(type, {
          busy: null,
          text: result.urls.join("\n"),
          dirty: false,
          saved: result.urls.length > 0,
          error: null,
        });
      }
    } catch (err) {
      patch(type, { busy: null, error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function test(type: DocumentType) {
    patch(type, { busy: "test", error: null, checks: null });
    try {
      const result = await verifyDocumentUrls(docs[type].text);
      patch(type, { busy: null, error: result.error, checks: result.checks });
    } catch (err) {
      patch(type, { busy: null, error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function suggest() {
    setSuggesting(true);
    setSuggestError(null);
    try {
      const { error, result } = await suggestServiceUrls(serviceId);
      setSuggestError(error);
      setSuggestions(result);
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : String(err));
    } finally {
      setSuggesting(false);
    }
  }

  function applySuggestion(type: DocumentType, url: string) {
    const current = docs[type].text;
    if (current.split(/\r?\n/).some((line) => line.trim() === url)) return;
    patch(type, {
      text: current.trim() === "" ? url : `${current.trimEnd()}\n${url}`,
      dirty: true,
      saved: false,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={suggest}
          disabled={suggesting}
          className={`${smallButtonClass} bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-350 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200/50 dark:border-zinc-700/50`}
        >
          {suggesting ? "Scanning homepage…" : "Suggest URLs"}
        </button>
        <span className="text-xs text-zinc-500">
          Scans the site for candidates — review the title of each before saving.
        </span>
      </div>

      {suggestError && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">
          {suggestError}
        </p>
      )}

      {suggestions && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-850 bg-zinc-50/50 dark:bg-zinc-900/10 p-4 space-y-2">
          {suggestions.suggestions.length === 0 ? (
            <p className="text-xs text-zinc-500">No candidates found.</p>
          ) : (
            <ul className="space-y-2">
              {suggestions.suggestions.map((s) => (
                <li key={s.url} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-bold text-zinc-600 dark:text-zinc-400">
                    {DOCUMENT_TYPE_LABELS[s.type]}
                  </span>
                  <span className="font-mono text-zinc-700 dark:text-zinc-300 break-all">{s.url}</span>
                  <span className="text-zinc-500">
                    {s.title ? `“${s.title}”, ` : ""}
                    {s.chars.toLocaleString()} chars
                  </span>
                  {s.source === "path-probe" && (
                    <span className="rounded-full bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 text-yellow-700 dark:text-yellow-300 font-semibold">
                      path guess — verify
                    </span>
                  )}
                  <button
                    onClick={() => applySuggestion(s.type, s.url)}
                    className={`${smallButtonClass} bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20`}
                  >
                    Use
                  </button>
                </li>
              ))}
            </ul>
          )}
          {suggestions.notes.map((note) => (
            <p key={note} className="text-xs text-zinc-500 leading-relaxed">
              {note}
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {DOCUMENT_TYPES.map((type) => {
          const doc = docs[type];
          return (
            <div
              key={type}
              className="rounded-xl border border-zinc-200 bg-zinc-50/50 dark:border-zinc-850 dark:bg-zinc-900/10 p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-450 font-heading">
                  {DOCUMENT_TYPE_LABELS[type]}
                </span>
                <div className="flex items-center gap-2">
                  {doc.saved && !doc.dirty && !doc.busy && (
                    <span className="text-xs font-semibold text-emerald-650 dark:text-emerald-400">
                      saved
                    </span>
                  )}
                  <button
                    onClick={() => test(type)}
                    disabled={!!doc.busy || doc.text.trim() === ""}
                    className={`${smallButtonClass} bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-350 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200/50 dark:border-zinc-700/50`}
                  >
                    {doc.busy === "test" ? "Fetching…" : "Test fetch"}
                  </button>
                  <button
                    onClick={() => save(type)}
                    disabled={!!doc.busy}
                    className={`${smallButtonClass} bg-accent hover:bg-accent-hover text-white shadow-sm`}
                  >
                    {doc.busy === "save" ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
              <textarea
                rows={2}
                value={doc.text}
                onChange={(e) =>
                  patch(type, { text: e.target.value, dirty: true, checks: null, error: null })
                }
                placeholder="https://…"
                className={inputClass}
              />
              {doc.dirty && (
                <p className="text-xs text-yellow-600 dark:text-yellow-400">
                  Unsaved changes — the pipeline uses the last saved URLs.
                </p>
              )}
              {doc.error && (
                <p className="text-xs text-red-600 dark:text-red-400 break-all">{doc.error}</p>
              )}
              {doc.checks?.map((check) => (
                <UrlCheckLine key={check.url} check={check} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UrlCheckLine({ check }: { check: UrlCheck }) {
  if (check.status === "ok") {
    return (
      <p className="text-xs text-emerald-700 dark:text-emerald-400 break-all leading-relaxed">
        ✓ {check.url} — {check.chars?.toLocaleString()} chars
        {check.via === "browser" ? " (needed the headless-browser fallback)" : ""}
        {check.title ? `, “${check.title}”` : ""}
      </p>
    );
  }
  if (check.status === "unverified") {
    return (
      <p className="text-xs text-yellow-600 dark:text-yellow-400 break-all leading-relaxed">
        ? {check.url} — {check.detail}
      </p>
    );
  }
  return (
    <p className="text-xs text-red-600 dark:text-red-400 break-all leading-relaxed">
      ✗ {check.url} — {check.detail}
    </p>
  );
}
