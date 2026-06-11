import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import {
  classificationLabel,
  CONFIDENCE_REVIEW_THRESHOLD,
  SEVERITY_POINTS,
} from "@/lib/grading";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  ChangeEvent,
  Classification,
  Document,
  DocumentType,
  PipelineRun,
  Service,
} from "@/lib/types";
import {
  approveClassification,
  saveDocumentUrls,
  updateServiceName,
} from "../../actions";
import { RunPipeline } from "./run-pipeline";

export const dynamic = "force-dynamic";

const DOCUMENT_TYPES: DocumentType[] = [
  "terms_of_service",
  "privacy_policy",
  "cookie_policy",
  "acceptable_use",
  "other",
];

const TYPE_LABELS: Record<DocumentType, string> = {
  terms_of_service: "Terms of Service",
  privacy_policy: "Privacy Policy",
  cookie_policy: "Cookie Policy",
  acceptable_use: "Acceptable Use",
  other: "Other",
};

const severityBadge: Record<string, string> = {
  critical: "bg-red-600/20 text-red-300",
  major: "bg-orange-600/20 text-orange-300",
  minor: "bg-yellow-600/20 text-yellow-300",
  positive: "bg-emerald-600/20 text-emerald-300",
  neutral: "bg-zinc-800 text-zinc-400",
};

export default async function ServicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const db = createAdminClient();

  const { data: service } = await db
    .from("services")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!service) notFound();
  const svc = service as Service;

  const { data: documentRows } = await db
    .from("documents")
    .select("*")
    .eq("service_id", id);
  const documents = (documentRows ?? []) as Document[];
  const docByType = new Map(documents.map((d) => [d.type, d]));
  const docById = new Map(documents.map((d) => [d.id, d]));

  let events: ChangeEvent[] = [];
  if (documents.length > 0) {
    const { data: eventRows } = await db
      .from("change_events")
      .select("*")
      .in("document_id", documents.map((d) => d.id))
      .order("created_at", { ascending: false })
      .limit(20);
    events = (eventRows ?? []) as ChangeEvent[];
  }

  // Latest pipeline run — the panel resumes polling if it's still active.
  const { data: latestRun } = await db
    .from("pipeline_runs")
    .select("*")
    .eq("service_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Classifications for every changed clause referenced by the events
  const changedHashes = [
    ...new Set(
      events.flatMap((e) => [
        ...(e.diff?.added ?? []).map((c) => c.hash),
        ...(e.diff?.modified ?? []).map((c) => c.hash),
      ])
    ),
  ];
  const classByHash = new Map<string, Classification>();
  for (let i = 0; i < changedHashes.length; i += 200) {
    const { data: rows } = await db
      .from("classifications")
      .select("*")
      .in("clause_hash", changedHashes.slice(i, i + 200));
    for (const row of rows ?? []) classByHash.set(row.clause_hash, row as Classification);
  }

  // No review gate: runs publish themselves, so every event is history.
  const history = events;

  return (
    <main className="space-y-10">
      {/* Header */}
      <section className="flex items-center gap-4">
        <div className="flex-1">
          <form action={updateServiceName} className="flex items-center gap-2">
            <input type="hidden" name="serviceId" value={svc.id} />
            <input
              name="name"
              defaultValue={svc.name}
              required
              className="rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xl font-semibold outline-none transition hover:border-zinc-700 focus:border-zinc-500 focus:bg-zinc-900"
            />
            <button className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700">
              Rename
            </button>
          </form>
          <p className="text-sm text-zinc-500">{svc.root_domain}</p>
        </div>
        {svc.current_grade && (
          <div className="text-right">
            <div className="text-3xl font-bold">{svc.current_grade}</div>
            <div className="text-xs text-zinc-500">{svc.current_score}/100</div>
          </div>
        )}
        <span className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300">
          {svc.status}
        </span>
      </section>

      {/* Run */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Pipeline
        </h2>
        <RunPipeline serviceId={svc.id} initialRun={(latestRun as PipelineRun) ?? null} />
        <p className="mt-2 text-xs text-zinc-500">
          Dispatches a GitHub Actions job that runs discovery (if no URLs are set
          below), extraction, hashing, diffing and classification, then{" "}
          <strong className="text-zinc-400">
            publishes the results and updates the public site automatically
          </strong>{" "}
          — there is no review step. Low-confidence findings are excluded from the
          grade unless approved below. Long waits are normal — the job sleeps
          through free-tier LLM rate limits.
        </p>
      </section>

      {/* Documents / manual override */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Documents
        </h2>
        <p className="mb-3 text-xs text-zinc-500">
          One URL per line; multiple URLs are merged into one document in order
          (for multi-page terms). Save an empty box to remove a document. Leave
          everything empty to let discovery find them automatically.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {DOCUMENT_TYPES.map((type) => {
            const doc = docByType.get(type);
            return (
              <form
                key={type}
                action={saveDocumentUrls}
                className="rounded-lg border border-zinc-800 p-3"
              >
                <input type="hidden" name="serviceId" value={svc.id} />
                <input type="hidden" name="type" value={type} />
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">{TYPE_LABELS[type]}</span>
                  <button className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700">
                    Save
                  </button>
                </div>
                <textarea
                  name="urls"
                  rows={2}
                  defaultValue={doc?.source_urls.join("\n") ?? ""}
                  placeholder="https://…"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs outline-none focus:border-zinc-500"
                />
              </form>
            );
          })}
        </div>
      </section>

      {/* Published change events */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Change events {history.length > 0 && `(${history.length})`}
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-zinc-500">No runs have produced changes yet.</p>
        ) : (
          <div className="space-y-4">
            {history.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                document={docById.get(event.document_id)}
                classByHash={classByHash}
                serviceId={svc.id}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function EventCard({
  event,
  document,
  classByHash,
  serviceId,
}: {
  event: ChangeEvent;
  document: Document | undefined;
  classByHash: Map<string, Classification>;
  serviceId: string;
}) {
  const diff = event.diff;
  const changed = [...(diff?.added ?? []), ...(diff?.modified ?? [])];
  const flagged = changed
    .map((c) => ({ excerpt: c.excerpt, classification: classByHash.get(c.hash) }))
    .filter(
      (x): x is { excerpt: string; classification: Classification } =>
        !!x.classification &&
        x.classification.category !== "OTHER" &&
        x.classification.severity !== "neutral"
    );

  return (
    <div className="rounded-lg border border-zinc-800 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {document ? TYPE_LABELS[document.type] : "Unknown document"}
        </span>
        <span className="text-xs text-zinc-500">
          {new Date(event.created_at).toLocaleString()}
        </span>
        <span
          className={`rounded px-2 py-0.5 text-xs ${
            event.status === "draft"
              ? "bg-yellow-600/20 text-yellow-300"
              : event.status === "published"
                ? "bg-emerald-600/15 text-emerald-300"
                : "bg-zinc-800 text-zinc-400"
          }`}
        >
          {event.status}
        </span>
        {event.severity_score !== null && event.severity_score !== 0 && (
          <span
            className={`rounded px-2 py-0.5 text-xs tabular-nums ${
              event.severity_score < 0
                ? "bg-red-600/20 text-red-300"
                : "bg-emerald-600/15 text-emerald-300"
            }`}
          >
            {event.severity_score > 0 ? "+" : ""}
            {event.severity_score} pts
          </span>
        )}
      </div>

      {event.ai_summary && <p className="mb-3 text-sm text-zinc-300">{event.ai_summary}</p>}

      {diff && (
        <p className="mb-3 text-xs text-zinc-500">
          {diff.added.length} added · {diff.modified.length} modified ·{" "}
          {diff.removed.length} removed · {diff.cosmetic_count} cosmetic ·{" "}
          {diff.unchanged_count} unchanged · {diff.llm_calls} LLM calls
        </p>
      )}

      {flagged.length > 0 && (
        <ul className="mb-3 space-y-2">
          {flagged.map(({ excerpt, classification: c }) => (
            <li key={c.clause_hash} className="rounded-md bg-zinc-900 p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs ${severityBadge[c.severity]}`}>
                  {classificationLabel(c)}
                </span>
                <span className="text-xs tabular-nums text-zinc-500">
                  {SEVERITY_POINTS[c.severity] > 0 ? "+" : ""}
                  {SEVERITY_POINTS[c.severity]} pts · confidence {c.confidence_score}
                </span>
                {c.confidence_score < CONFIDENCE_REVIEW_THRESHOLD &&
                  (c.admin_approved ? (
                    <span className="text-xs text-emerald-400">approved</span>
                  ) : (
                    <>
                      <span className="text-xs text-yellow-400">
                        low confidence — not counted until approved
                      </span>
                      <form
                        action={approveClassification.bind(null, c.clause_hash, serviceId)}
                      >
                        <button className="rounded bg-emerald-600/20 px-2 py-0.5 text-xs text-emerald-300 hover:bg-emerald-600/30">
                          Approve
                        </button>
                      </form>
                    </>
                  ))}
              </div>
              <p className="text-sm text-zinc-300">{c.plain_english_summary}</p>
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-zinc-500">
                  Clause text
                </summary>
                <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-zinc-400">
                  {excerpt}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}

      {diff && (diff.modified.length > 0 || diff.removed.length > 0) && (
        <details>
          <summary className="cursor-pointer text-xs text-zinc-500">Full diff detail</summary>
          <div className="mt-2 space-y-2">
            {diff.modified.map((m) => (
              <div key={m.hash} className="grid gap-2 rounded-md bg-zinc-900 p-3 sm:grid-cols-2">
                <pre className="whitespace-pre-wrap font-mono text-xs text-red-300/80">
                  {m.old_excerpt}
                </pre>
                <pre className="whitespace-pre-wrap font-mono text-xs text-emerald-300/80">
                  {m.excerpt}
                </pre>
              </div>
            ))}
            {diff.removed.map((r) => (
              <pre
                key={r.hash}
                className="whitespace-pre-wrap rounded-md bg-zinc-900 p-3 font-mono text-xs text-red-300/80 line-through"
              >
                {r.excerpt}
              </pre>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
