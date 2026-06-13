import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GradeBadge, ScoreBar } from "@/app/components/grade";
import { SaveButton } from "@/app/components/save-button";
import { SiteFooter } from "@/app/components/site-footer";
import { SiteHeader } from "@/app/components/site-header";
import {
  loadServiceDetail,
  loadServicesIndex,
  type ServiceDetail,
  type StaticClause,
} from "@/lib/static-data";

/**
 * Public service page. Fully static: everything comes from the
 * data/services/<domain>.json committed by the export workflow, so
 * rendering this page costs zero database calls. Unknown domains 404
 * (dynamicParams=false) without touching any backend.
 */

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams(): Promise<{ domain: string }[]> {
  const { services } = await loadServicesIndex();
  return services.map((s) => ({ domain: s.root_domain }));
}

const severityBadge: Record<string, string> = {
  critical:
    "bg-red-500/10 text-red-800 ring-red-700/25 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30",
  major:
    "bg-orange-500/10 text-orange-800 ring-orange-700/25 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30",
  minor:
    "bg-yellow-500/10 text-yellow-800 ring-yellow-700/25 dark:bg-yellow-500/15 dark:text-yellow-300 dark:ring-yellow-500/30",
  positive:
    "bg-emerald-500/10 text-emerald-800 ring-emerald-700/25 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function pointsChip(points: number): string {
  return `${points > 0 ? "+" : ""}${points}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ domain: string }>;
}): Promise<Metadata> {
  const { domain } = await params;
  const detail = await loadServiceDetail(decodeURIComponent(domain).toLowerCase());
  return {
    title: `${detail?.name ?? decodeURIComponent(domain)} : Fineprinted`,
    description: detail
      ? `${detail.name} scores ${detail.score}/100 (grade ${detail.grade}) on Fineprinted's Terms of Service analysis.`
      : undefined,
  };
}

export default async function ServicePage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain: rawDomain } = await params;
  const domain = decodeURIComponent(rawDomain).toLowerCase();
  const detail = await loadServiceDetail(domain);
  if (!detail) notFound();

  const lastChecked = formatDate(detail.last_published_at);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3 items-start">
          {/* Main column (2/3 width) */}
          <div className="lg:col-span-2 space-y-10 order-2 lg:order-1">
            {/* At a glance */}
            <section>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-heading">
                At a glance
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <GlanceCard
                  tone="good"
                  title="The good"
                  lines={detail.summary.good}
                  emptyText="Nothing notably user-friendly stood out."
                />
                <GlanceCard
                  tone="bad"
                  title="Watch out for"
                  lines={detail.summary.bad}
                  emptyText="No user-hostile clauses found. 🎉"
                />
              </div>
              <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
                This analysis is generated automatically by AI and can make
                mistakes, since every flag includes the original clause below, you can
                check for yourself.
              </p>
            </section>

            {/* Details */}
            {detail.clauses.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-heading">
                  The details ({detail.clauses.length} clauses)
                </h2>
                <div className="space-y-3">
                  {groupClauses(detail).map((group) => (
                    <details
                      key={group.key}
                      className="group rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50"
                    >
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-4 [&::-webkit-details-marker]:hidden">
                        <span
                          className={`rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ${severityBadge[group.severity]}`}
                        >
                          {group.label}
                        </span>
                        <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                          {pointsChip(group.points)} pts
                        </span>
                        <span className="text-xs text-zinc-400 dark:text-zinc-500">
                          · {group.clauses.length} clause{group.clauses.length === 1 ? "" : "s"}
                        </span>
                        <span className="ml-auto text-xs text-zinc-400 transition group-open:rotate-180 dark:text-zinc-500">
                          ▾
                        </span>
                      </summary>
                      <ul className="space-y-4 border-t border-zinc-100 p-4 dark:border-zinc-800">
                        {group.clauses.map((clause, i) => (
                          <li key={i}>
                            <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                              {clause.summary}
                            </p>
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                                Show original clause · {clause.document_name}
                              </summary>
                              <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-accent/30 pl-3 text-xs leading-relaxed text-zinc-700 dark:border-accent/20 dark:text-zinc-400">
                                {clause.excerpt}
                              </blockquote>
                            </details>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
                <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
                  Each category counts once toward the score, and extra issues of the
                  same kind have diminishing impact — the grade reflects the breadth of
                  problems, not repetition.
                </p>
              </section>
            )}

            {/* History */}
            {detail.history.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-heading">
                  Change history
                </h2>
                <ol className="relative space-y-6 border-l border-zinc-200 pl-6 dark:border-zinc-800">
                  {detail.history.map((e) => (
                    <li key={e.id} className="relative">
                      <span className="absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent ring-4 ring-zinc-50 dark:ring-zinc-950" />
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <time>{formatDate(e.date)}</time>
                        <span>· {e.document_name}</span>
                        {e.points !== 0 && (
                          <span
                            className={`rounded-md px-1.5 py-0.5 tabular-nums ${
                              e.points < 0
                                ? "bg-red-500/10 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                                : "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                            }`}
                          >
                            {pointsChip(e.points)} pts
                          </span>
                        )}
                      </div>
                      {e.summary && (
                        <p className="mt-1.5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                          {e.summary}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                        {e.added} added · {e.modified} modified · {e.removed} removed
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>

          {/* Sidebar (1/3 width) */}
          <div className="lg:col-span-1 space-y-6 lg:sticky lg:top-20 order-1 lg:order-2">
            {/* Main info card */}
            <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50 space-y-6">
              <div className="flex items-center gap-4">
                <GradeBadge grade={detail.grade} size="lg" />
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-xl font-bold font-heading">{detail.name}</h1>
                  <a
                    href={`https://${detail.root_domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-accent hover:text-accent-hover hover:underline dark:text-accent dark:hover:text-accent-hover"
                  >
                    {detail.root_domain} ↗
                  </a>
                </div>
              </div>

              <div className="border-t border-zinc-100 pt-4 dark:border-zinc-800/80">
                <ScoreBar score={detail.score} grade={detail.grade} />
              </div>

              <div className="flex flex-col gap-2.5">
                <SaveButton serviceId={detail.id} />
              </div>

              {lastChecked && (
                <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">
                  Last verified {lastChecked}
                </p>
              )}
            </div>

            {/* Documents tracked card */}
            <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-heading">
                Documents tracked
              </h3>
              <ul className="flex flex-col gap-2">
                {detail.documents.map((d, idx) => (
                  <li key={idx}>
                    <a
                      href={d.url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50/50 px-3.5 py-2 text-xs font-medium text-zinc-700 shadow-sm transition hover:border-accent/40 hover:bg-white dark:border-zinc-800 dark:bg-zinc-950/20 dark:text-zinc-300 dark:hover:border-accent/30 dark:hover:bg-zinc-900/40"
                    >
                      <span>{d.name || "Document"}</span>
                      <span className="text-zinc-400 font-normal">↗</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function GlanceCard({
  tone,
  title,
  lines,
  emptyText,
}: {
  tone: "good" | "bad";
  title: string;
  lines: { text: string; points: number }[];
  emptyText: string;
}) {
  const toneClasses =
    tone === "good"
      ? "border-emerald-200/70 dark:border-emerald-500/20"
      : "border-red-200/70 dark:border-red-500/20";
  const markClasses =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";

  return (
    <div
      className={`rounded-2xl border bg-white p-5 shadow-sm dark:bg-zinc-900/50 ${toneClasses}`}
    >
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {lines.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{emptyText}</p>
      ) : (
        <ul className="space-y-2.5">
          {lines.map((line, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm leading-snug">
              <span className={`mt-0.5 font-bold ${markClasses}`} aria-hidden>
                {tone === "good" ? "✓" : "✕"}
              </span>
              <span className="flex-1 text-zinc-700 dark:text-zinc-300">{line.text}</span>
              <span className="shrink-0 text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
                {pointsChip(line.points)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ClauseGroup {
  key: string;
  label: string;
  severity: string;
  points: number;
  clauses: StaticClause[];
}

/** Group flagged clauses by (label, severity), worst first. */
function groupClauses(detail: ServiceDetail): ClauseGroup[] {
  const groups = new Map<string, ClauseGroup>();
  for (const clause of detail.clauses) {
    const key = `${clause.label}:${clause.severity}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: clause.label,
        severity: clause.severity,
        points: clause.points,
        clauses: [],
      };
      groups.set(key, group);
    }
    group.clauses.push(clause);
  }
  return [...groups.values()].sort((a, b) => a.points - b.points);
}
