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
  critical: "bg-red-650/10 text-red-700 dark:bg-red-600/20 dark:text-red-300",
  major: "bg-orange-500/10 text-orange-700 dark:bg-orange-600/20 dark:text-orange-300",
  minor: "bg-yellow-500/10 text-yellow-700 dark:bg-yellow-600/20 dark:text-yellow-300",
  positive: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-600/20 dark:text-emerald-300",
  neutral: "bg-zinc-150 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400",
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
      <section className="flex flex-wrap items-center gap-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-900 dark:bg-zinc-950">
        <div className="flex-1 min-w-[200px]">
          <form action={updateServiceName} className="flex items-center gap-3">
            <input type="hidden" name="serviceId" value={svc.id} />
            <input
              name="name"
              defaultValue={svc.name}
              required
              className="rounded-xl border border-zinc-200 bg-zinc-50/50 px-3 py-1.5 text-xl font-bold text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 outline-none transition focus:border-accent font-heading"
            />
            <button className="rounded-xl bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-600 dark:text-zinc-350 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition cursor-pointer border border-zinc-200/50 dark:border-zinc-700/50">
              Rename
            </button>
          </form>
          <p className="text-sm text-zinc-500 dark:text-zinc-550 mt-1">{svc.root_domain}</p>
        </div>
        {svc.current_grade && (
          <div className="text-right">
            <div className="text-3xl font-black text-accent font-heading">{svc.current_grade}</div>
            <div className="text-xs text-zinc-500 font-semibold">{svc.current_score}/100</div>
          </div>
        )}
        <span className="rounded-full bg-zinc-100 dark:bg-zinc-850 px-3 py-1 text-xs font-semibold border border-zinc-200 dark:border-zinc-800/80 text-zinc-650 dark:text-zinc-355">
          {svc.status}
        </span>
      </section>

      {/* Run */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 space-y-4 dark:border-zinc-900 dark:bg-zinc-955 shadow-sm">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-550 dark:text-zinc-400 font-heading">
          Pipeline
        </h2>
        <RunPipeline serviceId={svc.id} initialRun={(latestRun as PipelineRun) ?? null} />
        <p className="text-xs leading-relaxed text-zinc-550">
          Dispatches a GitHub Actions job that runs discovery (if no URLs are set
          below), extraction, hashing, diffing and classification, and then{" "}
          <strong className="text-zinc-800 dark:text-zinc-300">
            publishes the results and updates the public site automatically
          </strong>,
          without a manual review step. Low-confidence findings are excluded from the
          grade unless approved below. Long waits are normal, as the job sleeps
          through free-tier LLM rate limits.
        </p>
      </section>

      {/* Documents / manual override */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 space-y-4 dark:border-zinc-900 dark:bg-zinc-955 shadow-sm">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-550 dark:text-zinc-400 font-heading">
            Documents
          </h2>
          <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
            One URL per line; multiple URLs are merged into one document in order
            (for multi-page terms). Save an empty box to remove a document. Leave
            everything empty to let discovery find them automatically.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {DOCUMENT_TYPES.map((type) => {
            const doc = docByType.get(type);
            return (
              <form
                key={type}
                action={saveDocumentUrls}
                className="rounded-xl border border-zinc-200 bg-zinc-50/50 dark:border-zinc-850 dark:bg-zinc-900/10 p-4 space-y-3"
              >
                <input type="hidden" name="serviceId" value={svc.id} />
                <input type="hidden" name="type" value={type} />
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-450 font-heading">{TYPE_LABELS[type]}</span>
                  <button className="rounded-lg bg-accent hover:bg-accent-hover text-white shadow-sm px-2.5 py-1 text-xs font-semibold transition cursor-pointer">
                    Save Urls
                  </button>
                </div>
                <textarea
                  name="urls"
                  rows={2}
                  defaultValue={doc?.source_urls.join("\n") ?? ""}
                  placeholder="https://…"
                  className="w-full rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-900 dark:text-zinc-150 placeholder:text-zinc-400 dark:placeholder:text-zinc-650 outline-none focus:border-accent transition"
                />
              </form>
            );
          })}
        </div>
      </section>

      {/* Published change events */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 space-y-4 dark:border-zinc-900 dark:bg-zinc-955 shadow-sm">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-555 dark:text-zinc-400 font-heading">
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
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/30 dark:border-zinc-900 dark:bg-zinc-900/10 p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-150 dark:border-zinc-900 pb-3">
        <span className="text-sm font-bold font-heading text-zinc-800 dark:text-zinc-200">
          {document ? TYPE_LABELS[document.type] : "Unknown document"}
        </span>
        <span className="text-xs text-zinc-500 font-medium ml-1">
          {new Date(event.created_at).toLocaleString()}
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide ${
            event.status === "draft"
              ? "bg-yellow-500/10 text-yellow-705 dark:text-yellow-300 border border-yellow-500/20"
              : event.status === "published"
                ? "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-600/15 dark:text-emerald-300 border border-emerald-500/20"
                : "bg-zinc-150 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
        >
          {event.status}
        </span>
        {event.severity_score !== null && event.severity_score !== 0 && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums border ${
              event.severity_score < 0
                ? "bg-red-500/10 text-red-700 border-red-500/20"
                : "bg-emerald-500/10 text-emerald-700 border-emerald-500/20"
            }`}
          >
            {event.severity_score > 0 ? "+" : ""}
            {event.severity_score} pts
          </span>
        )}
      </div>

      {event.ai_summary && <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{event.ai_summary}</p>}

      {diff && (
        <p className="text-xs text-zinc-500 font-mono">
          {diff.added.length} added · {diff.modified.length} modified ·{" "}
          {diff.removed.length} removed · {diff.cosmetic_count} cosmetic ·{" "}
          {diff.unchanged_count} unchanged · {diff.llm_calls} LLM calls
        </p>
      )}

      {flagged.length > 0 && (
        <ul className="space-y-3">
          {flagged.map(({ excerpt, classification: c }) => (
            <li key={c.clause_hash} className="rounded-xl bg-white border border-zinc-200 dark:bg-zinc-955 dark:border-zinc-900 p-4 space-y-3 shadow-2xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${severityBadge[c.severity]}`}>
                  {classificationLabel(c)}
                </span>
                <span className="text-xs tabular-nums text-zinc-500 font-medium">
                  {SEVERITY_POINTS[c.severity] > 0 ? "+" : ""}
                  {SEVERITY_POINTS[c.severity]} pts, confidence {c.confidence_score}
                </span>
                {c.confidence_score < CONFIDENCE_REVIEW_THRESHOLD &&
                  (c.admin_approved ? (
                    <span className="text-xs text-emerald-650 dark:text-emerald-400 font-semibold">approved</span>
                  ) : (
                    <div className="flex items-center gap-2 ml-1">
                      <span className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">
                        low confidence, not counted until approved
                      </span>
                      <form
                        action={approveClassification.bind(null, c.clause_hash, serviceId)}
                      >
                        <button className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-350 hover:bg-emerald-500/20 transition cursor-pointer">
                          Approve
                        </button>
                      </form>
                    </div>
                  ))}
              </div>
              <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 font-medium">{c.plain_english_summary}</p>
              <details className="group mt-1">
                <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 select-none font-semibold">
                  Show Clause text
                </summary>
                <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-600 dark:text-zinc-455 border-l border-zinc-200 dark:border-zinc-800 pl-3 leading-relaxed bg-zinc-100/50 dark:bg-zinc-900/30 p-2.5 rounded-lg">
                  {excerpt}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}

      {diff && (diff.modified.length > 0 || diff.removed.length > 0) && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 select-none font-semibold">Full diff detail</summary>
          <div className="mt-3 space-y-3">
            {diff.modified.map((m) => (
              <div key={m.hash} className="grid gap-3 rounded-lg bg-white border border-zinc-200 p-4 sm:grid-cols-2 dark:bg-zinc-950 dark:border-zinc-900">
                <div>
                  <div className="text-[10px] uppercase font-bold text-red-600 dark:text-red-500 mb-1">Old Excerpt</div>
                  <pre className="whitespace-pre-wrap font-mono text-xs text-red-700 dark:text-red-400/80 leading-relaxed">
                    {m.old_excerpt}
                  </pre>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-500 mb-1">New Excerpt</div>
                  <pre className="whitespace-pre-wrap font-mono text-xs text-emerald-700 dark:text-emerald-400/80 leading-relaxed">
                    {m.excerpt}
                  </pre>
                </div>
              </div>
            ))}
            {diff.removed.map((r) => (
              <div key={r.hash} className="rounded-lg bg-white border border-zinc-200 p-4 dark:bg-zinc-955 dark:border-zinc-900">
                <div className="text-[10px] uppercase font-bold text-red-650 dark:text-red-500 mb-1">Removed Excerpt</div>
                <pre className="whitespace-pre-wrap font-mono text-xs text-red-700 dark:text-red-400/70 line-through leading-relaxed">
                  {r.excerpt}
                </pre>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
