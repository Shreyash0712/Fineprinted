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
import type { DocumentType } from "@/lib/types";

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
    title: `${detail?.name ?? decodeURIComponent(domain)} — Fineprint`,
    description: detail
      ? `${detail.name} scores ${detail.score}/100 (grade ${detail.grade}) on Fineprint's Terms of Service analysis.`
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
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-10 px-6 py-12">
        {/* Hero */}
        <section className="flex flex-wrap items-center gap-6 rounded-3xl border border-zinc-200 bg-white p-7 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
          <GradeBadge grade={detail.grade} size="xl" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold sm:text-3xl">{detail.name}</h1>
            <a
              href={`https://${detail.root_domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              {detail.root_domain} ↗
            </a>
            <div className="mt-3 max-w-xs">
              <ScoreBar score={detail.score} grade={detail.grade} />
            </div>
            {lastChecked && (
              <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
                Last verified {lastChecked}
              </p>
            )}
          </div>
          <SaveButton serviceId={detail.id} />
        </section>

        {/* At a glance */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
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
            mistakes — every flag includes the original clause below so you can
            check for yourself.
          </p>
        </section>

        {/* Details */}
        {detail.clauses.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
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
                            Show original clause · {TYPE_LABELS[clause.document_type]}
                          </summary>
                          <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-indigo-300 pl-3 text-xs leading-relaxed text-zinc-600 dark:border-indigo-500/40 dark:text-zinc-400">
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
              Each category counts once toward the score, no matter how many clauses
              repeat it.
            </p>
          </section>
        )}

        {/* History */}
        {detail.history.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Change history
            </h2>
            <ol className="relative space-y-6 border-l border-zinc-200 pl-6 dark:border-zinc-800">
              {detail.history.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full bg-indigo-500 ring-4 ring-zinc-50 dark:ring-zinc-950" />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <time>{formatDate(e.date)}</time>
                    <span>· {TYPE_LABELS[e.document_type]}</span>
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

        {/* Documents */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Documents tracked
          </h2>
          <ul className="flex flex-wrap gap-2">
            {detail.documents.map((d) => (
              <li key={d.type}>
                <a
                  href={d.urls[0]}
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
