import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import {
  classificationLabel,
  CONFIDENCE_REVIEW_THRESHOLD,
  pointsFor,
} from "@/lib/grading";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  type ChangeEvent,
  type Classification,
  type Document,
  type PipelineRun,
  type Service,
} from "@/lib/types";
import { approveClassification, updateServiceName } from "../../actions";
import { DocumentsEditor } from "./documents-editor";
import { RunPipeline } from "./run-pipeline";

export const dynamic = "force-dynamic";

const severityBadge: Record<string, string> = {
  critical: "bg-red-700/10 text-red-700 dark:bg-red-600/20 dark:text-red-300",
  major: "bg-orange-500/10 text-orange-700 dark:bg-orange-600/20 dark:text-orange-300",
  minor: "bg-yellow-500/10 text-yellow-700 dark:bg-yellow-600/20 dark:text-yellow-300",
  positive: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-600/20 dark:text-emerald-300",
  neutral: "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400",
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
            <button className="rounded-xl bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition cursor-pointer border border-zinc-200/50 dark:border-zinc-700/50">
              Rename
            </button>
          </form>
          <p className="text-sm text-zinc-500 dark:text-zinc-600 mt-1">{svc.root_domain}</p>
        </div>
        {svc.current_grade && (
          <div className="text-right">
            <div className="text-3xl font-black text-accent font-heading">{svc.current_grade}</div>
            <div className="text-xs text-zinc-500 font-semibold">{svc.current_score}/100</div>
          </div>
        )}
        <span className="rounded-full bg-zinc-100 dark:bg-zinc-900 px-3 py-1 text-xs font-semibold border border-zinc-200 dark:border-zinc-800/80 text-zinc-700 dark:text-zinc-400">
          {svc.status}
        </span>
      </section>

      {/* Run */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 space-y-4 dark:border-zinc-900 dark:bg-zinc-950 shadow-sm">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 font-heading">
          Pipeline
        </h2>
        <RunPipeline
          serviceId={svc.id}
          initialRun={(latestRun as PipelineRun) ?? null}
          hasContent={documents.some((d) => !!d.pasted_content && d.pasted_content.trim().length > 0)}
        />
        <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
          Dispatches a GitHub Actions job that segments the pasted documents,
          diffs them against the last version, classifies the changed clauses,
          and then{" "}
          <strong className="text-zinc-800 dark:text-zinc-300">
            publishes the results and updates the public site automatically
          </strong>
          , without a manual review step. Low-confidence findings are excluded from
          the grade unless approved below. Long waits are normal, as the job sleeps
          through free-tier LLM rate limits.
        </p>
      </section>

      {/* Documents (Manual pasting) */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 space-y-4 dark:border-zinc-900 dark:bg-zinc-950 shadow-sm">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 font-heading">
            Documents
          </h2>
          <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
            Paste the raw text or markdown of the documents here. The pipeline uses this exact text for analysis.
            Optionally provide a name and URL for reference.
          </p>
        </div>
        <DocumentsEditor
          serviceId={svc.id}
          initialDocuments={documents}
        />
      </section>

      {/* Published change events */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 space-y-4 dark:border-zinc-900 dark:bg-zinc-950 shadow-sm">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 font-heading">
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
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 dark:border-zinc-900 pb-3">
        <span className="text-sm font-bold font-heading text-zinc-800 dark:text-zinc-200">
          {document ? document.name || "Unknown document" : "Unknown document"}
        </span>
        <span className="text-xs text-zinc-500 font-medium ml-1">
          {new Date(event.created_at).toLocaleString()}
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide ${
            event.status === "draft"
              ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 border border-yellow-500/20"
              : event.status === "published"
                ? "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-600/15 dark:text-emerald-300 border border-emerald-500/20"
                : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
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
            <li key={c.clause_hash} className="rounded-xl bg-white border border-zinc-200 dark:bg-zinc-950 dark:border-zinc-900 p-4 space-y-3 shadow-2xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${severityBadge[c.severity]}`}>
                  {classificationLabel(c)}
                </span>
                <span className="text-xs tabular-nums text-zinc-500 font-medium">
                  {pointsFor(c) > 0 ? "+" : ""}
                  {pointsFor(c)} pts, confidence {c.confidence_score}
                </span>
                {c.confidence_score < CONFIDENCE_REVIEW_THRESHOLD &&
                  (c.admin_approved ? (
                    <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">approved</span>
                  ) : (
                    <div className="flex items-center gap-2 ml-1">
                      <span className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">
                        low confidence, not counted until approved
                      </span>
                      <form
                        action={approveClassification.bind(null, c.clause_hash, serviceId)}
                      >
                        <button className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 transition cursor-pointer">
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
                <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-zinc-600 dark:text-zinc-500 border-l border-zinc-200 dark:border-zinc-800 pl-3 leading-relaxed bg-zinc-100/50 dark:bg-zinc-900/30 p-2.5 rounded-lg">
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
              <div key={r.hash} className="rounded-lg bg-white border border-zinc-200 p-4 dark:bg-zinc-950 dark:border-zinc-900">
                <div className="text-[10px] uppercase font-bold text-red-700 dark:text-red-500 mb-1">Removed Excerpt</div>
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
