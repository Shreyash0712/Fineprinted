"use client";

import { useState } from "react";
import { type Document } from "@/lib/types";
import { saveDocument, deleteDocument } from "../../actions";

const inputClass =
  "w-full rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-900 dark:text-zinc-150 placeholder:text-zinc-400 dark:placeholder:text-zinc-650 outline-none focus:border-accent transition";
const smallButtonClass =
  "rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer disabled:opacity-50 disabled:cursor-default";

export function DocumentsEditor({
  serviceId,
  initialDocuments,
}: {
  serviceId: string;
  initialDocuments: Document[];
}) {
  const [docs, setDocs] = useState<(Partial<Document> & { localId: string; busy: "save" | "delete" | null; error: string | null; saved: boolean })[]>(() => {
    return initialDocuments.map((d) => ({
      ...d,
      localId: d.id,
      busy: null,
      error: null,
      saved: true,
    }));
  });

  function patch(localId: string, partial: any) {
    setDocs((prev) => prev.map((d) => (d.localId === localId ? { ...d, ...partial } : d)));
  }

  function addDoc() {
    setDocs([
      ...docs,
      {
        localId: Math.random().toString(),
        name: "",
        source_url: "",
        pasted_content: "",
        busy: null,
        error: null,
        saved: false,
      },
    ]);
  }

  async function handleSave(localId: string) {
    const doc = docs.find((d) => d.localId === localId);
    if (!doc) return;

    if (!doc.pasted_content?.trim()) {
      patch(localId, { error: "Pasted content is required" });
      return;
    }

    patch(localId, { busy: "save", error: null });
    try {
      const result = await saveDocument(
        serviceId,
        doc.id || null,
        doc.name || "",
        doc.source_url || "",
        doc.pasted_content
      );
      if (result.error) {
        patch(localId, { busy: null, error: result.error });
      } else {
        patch(localId, {
          busy: null,
          id: result.documentId,
          saved: true,
          error: null,
        });
      }
    } catch (err) {
      patch(localId, { busy: null, error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleDelete(localId: string) {
    const doc = docs.find((d) => d.localId === localId);
    if (!doc) return;
    
    if (!doc.id) {
      setDocs((prev) => prev.filter((d) => d.localId !== localId));
      return;
    }

    if (!window.confirm("Delete this document? Its snapshots and history will be lost.")) return;
    
    patch(localId, { busy: "delete", error: null });
    try {
      const result = await deleteDocument(serviceId, doc.id);
      if (result.error) {
        patch(localId, { busy: null, error: result.error });
      } else {
        setDocs((prev) => prev.filter((d) => d.localId !== localId));
      }
    } catch (err) {
      patch(localId, { busy: null, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {docs.map((doc) => (
          <div
            key={doc.localId}
            className="rounded-xl border border-zinc-200 bg-zinc-50/50 dark:border-zinc-850 dark:bg-zinc-900/10 p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-450 font-heading">
                Document {doc.name ? `- ${doc.name}` : ""}
              </span>
              <div className="flex items-center gap-2">
                {doc.saved && !doc.busy && (
                  <span className="text-xs font-semibold text-emerald-650 dark:text-emerald-400">
                    saved
                  </span>
                )}
                <button
                  onClick={() => handleDelete(doc.localId)}
                  disabled={!!doc.busy}
                  className={`${smallButtonClass} bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50`}
                >
                  {doc.busy === "delete" ? "..." : "Delete"}
                </button>
                <button
                  onClick={() => handleSave(doc.localId)}
                  disabled={!!doc.busy}
                  className={`${smallButtonClass} bg-accent hover:bg-accent-hover text-white shadow-sm`}
                >
                  {doc.busy === "save" ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Document Name (Optional)"
                value={doc.name || ""}
                onChange={(e) => patch(doc.localId, { name: e.target.value, saved: false })}
                className={inputClass}
              />
              <input
                type="text"
                placeholder="Source URL (Optional)"
                value={doc.source_url || ""}
                onChange={(e) => patch(doc.localId, { source_url: e.target.value, saved: false })}
                className={inputClass}
              />
              <textarea
                rows={4}
                value={doc.pasted_content || ""}
                onChange={(e) => patch(doc.localId, { pasted_content: e.target.value, saved: false, error: null })}
                placeholder="Paste the document text here..."
                className={inputClass}
              />
            </div>
            {!doc.saved && (
              <p className="text-xs text-yellow-600 dark:text-yellow-400">
                Unsaved changes.
              </p>
            )}
            {doc.error && (
              <p className="text-xs text-red-600 dark:text-red-400 break-all">{doc.error}</p>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={addDoc}
        className="w-full rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-4 text-sm font-semibold text-zinc-500 hover:border-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition cursor-pointer"
      >
        + Add Document
      </button>
    </div>
  );
}
