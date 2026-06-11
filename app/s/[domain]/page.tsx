import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GradeBadge, ScoreBar } from "@/app/components/grade";
import { SaveButton } from "@/app/components/save-button";
import { SiteFooter } from "@/app/components/site-footer";
import { SiteHeader } from "@/app/components/site-header";
import { affectsGrade, CATEGORY_LABELS, SEVERITY_POINTS } from "@/lib/grading";
import { createPublicClient } from "@/lib/supabase/public";
import type {
  ChangeEvent,
  Classification,
  Document,
  DocumentType,
  Service,
} from "@/lib/types";

export const revalidate = 60;

const TYPE_LABELS: Record<DocumentType, string> = {
  terms_of_service: "Terms of Service",
  privacy_policy: "Privacy Policy",
  cookie_policy: "Cookie Policy",
  acceptable_use: "Acceptable Use",
  other: "Other",
};

const severityBadge: Record<string, string> = {
  critical:
    "bg-red-500/10 text-red-700 ring-red-600/25 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30",
  major:
    "bg-orange-500/10 text-orange-700 ring-orange-600/25 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30",
  minor:
    "bg-yellow-500/10 text-yellow-700 ring-yellow-600/25 dark:bg-yellow-500/15 dark:text-yellow-300 dark:ring-yellow-500/30",
  positive:
    "bg-emerald-500/10 text-emerald-700 ring-emerald-600/25 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
};

interface FlaggedClause {
  documentType: DocumentType;
  excerpt: string;
  classification: Classification;
}

async function loadFlaggedClauses(
  db: ReturnType<typeof createPublicClient>,
  documents: Document[]
): Promise<FlaggedClause[]> {
  const flagged: FlaggedClause[] = [];
  for (const doc of documents) {
    const { data: snap } = await db
      .from("snapshots")
      .select("id")
      .eq("document_id", doc.id)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!snap) continue;

    const { data: clauses } = await db
      .from("clauses")
      .select("clause_hash, content")
      .eq("snapshot_id", snap.id)
      .order("position");
    const byHash = new Map((clauses ?? []).map((c) => [c.clause_hash, c.content]));
    if (byHash.size === 0) continue;

    const hashes = [...byHash.keys()];
    for (let i = 0; i < hashes.length; i += 200) {
      const { data: rows } = await db
        .from("classifications")
        .select("*")
        .in("clause_hash", hashes.slice(i, i + 200))
        .neq("category", "OTHER");
      for (const row of rows ?? []) {
        const c = row as Classification;
        if (!affectsGrade(c)) continue;
        flagged.push({
          documentType: doc.type,
          excerpt: (byHash.get(c.clause_hash) ?? "").slice(0, 600),
          classification: c,
        });
      }
    }
  }
  // Worst first (critical = -30 points sorts before positive = +5)
  return flagged.sort(
    (a, b) =>
      SEVERITY_POINTS[a.classification.severity] - SEVERITY_POINTS[b.classification.severity]
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ domain: string }>;
}): Promise<Metadata> {
  const { domain } = await params;
  return { title: `${decodeURIComponent(domain)} — Fineprint` };
}

export default async function ServicePage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain: rawDomain } = await params;
  const domain = decodeURIComponent(rawDomain).toLowerCase();
  const db = createPublicClient();

  const { data: serviceRow } = await db
    .from("services")
    .select("*")
    .eq("root_domain", domain)
    .eq("status", "active")
    .maybeSingle();
  if (!serviceRow) notFound();
  const service = serviceRow as Service;

  const { data: documentRows } = await db
    .from("documents")
    .select("*")
    .eq("service_id", service.id);
  const documents = (documentRows ?? []) as Document[];
  const docById = new Map(documents.map((d) => [d.id, d]));

  const [flagged, { data: eventRows }] = await Promise.all([
    loadFlaggedClauses(db, documents),
    documents.length > 0
      ? db
          .from("change_events")
          .select("*")
          .in("document_id", documents.map((d) => d.id))
          .eq("status", "published")
          .order("published_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] as ChangeEvent[] }),
  ]);
  const events = (eventRows ?? []) as ChangeEvent[];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-12 px-6 py-12">
        {/* Header */}
        <section className="flex flex-wrap items-center gap-6 rounded-3xl border border-zinc-200 bg-white p-7 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
          <GradeBadge grade={service.current_grade} size="xl" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold sm:text-3xl">{service.name}</h1>
            <a
              href={`https://${service.root_domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              {service.root_domain} ↗
            </a>
            <div className="mt-3 max-w-xs">
              <ScoreBar score={service.current_score} grade={service.current_grade} />
            </div>
          </div>
          <SaveButton serviceId={service.id} />
        </section>

        {/* Documents tracked */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Documents tracked
          </h2>
          <ul className="flex flex-wrap gap-2">
            {documents.map((d) => (
              <li key={d.id}>
                <a
                  href={d.source_urls[0]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm shadow-sm transition hover:border-indigo-300 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-indigo-500/40"
                >
                  {TYPE_LABELS[d.type]} ↗
                </a>
              </li>
            ))}
          </ul>
        </section>

        {/* Flagged clauses */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            What we flagged {flagged.length > 0 && `(${flagged.length})`}
          </h2>
          {flagged.length === 0 ? (
            <p className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
              No hostile clauses flagged. 🎉
            </p>
          ) : (
            <ul className="space-y-4">
              {flagged.map(({ documentType, excerpt, classification: c }, i) => (
                <li
                  key={`${c.clause_hash}-${i}`}
                  className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50"
                >
                  <div className="mb-2.5 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ${severityBadge[c.severity]}`}
                    >
                      {CATEGORY_LABELS[c.category]}
                    </span>
                    <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {SEVERITY_POINTS[c.severity] > 0 ? "+" : ""}
                      {SEVERITY_POINTS[c.severity]} pts
                    </span>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">
                      · {TYPE_LABELS[documentType]}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                    {c.plain_english_summary}
                  </p>
                  <details className="mt-2.5">
                    <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                      Show original clause
                    </summary>
                    <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-indigo-300 pl-3 text-xs leading-relaxed text-zinc-600 dark:border-indigo-500/40 dark:text-zinc-400">
                      {excerpt}
                    </blockquote>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* History */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Change history
          </h2>
          {events.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No published changes yet.</p>
          ) : (
            <ol className="relative space-y-6 border-l border-zinc-200 pl-6 dark:border-zinc-800">
              {events.map((e) => {
                const doc = docById.get(e.document_id);
                return (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full bg-indigo-500 ring-4 ring-zinc-50 dark:ring-zinc-950" />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <time>
                        {new Date(e.published_at ?? e.created_at).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </time>
                      {doc && <span>· {TYPE_LABELS[doc.type]}</span>}
                      {e.severity_score !== null && e.severity_score !== 0 && (
                        <span
                          className={`rounded-md px-1.5 py-0.5 tabular-nums ${
                            e.severity_score < 0
                              ? "bg-red-500/10 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                              : "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                          }`}
                        >
                          {e.severity_score > 0 ? "+" : ""}
                          {e.severity_score} pts
                        </span>
                      )}
                    </div>
                    {e.ai_summary && (
                      <p className="mt-1.5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                        {e.ai_summary}
                      </p>
                    )}
                    {e.diff && (
                      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                        {e.diff.added.length} added · {e.diff.modified.length} modified ·{" "}
                        {e.diff.removed.length} removed
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
