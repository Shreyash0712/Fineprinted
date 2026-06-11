import Link from "next/link";
import { loadServicesIndex } from "@/lib/static-data";
import { ServiceExplorer } from "./components/service-explorer";
import { SiteFooter } from "./components/site-footer";
import { SiteHeader } from "./components/site-header";

// Fully static: service data is committed to the repo (data/services.json)
// by the export workflow, and each commit triggers a redeploy. Browsing
// the site costs zero database calls.
export const dynamic = "force-static";

export default async function Home() {
  const { services, stats } = await loadServicesIndex();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-24">
        {/* Hero */}
        <section className="relative py-20 text-center sm:py-28">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-80 max-w-3xl rounded-full bg-indigo-500/10 blur-3xl dark:bg-indigo-500/15"
          />
          <p className="mb-4 inline-block rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">
            The terms you never read, read for you
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-extrabold tracking-tight sm:text-6xl">
            Know what you&apos;re{" "}
            <span className="bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 bg-clip-text text-transparent">
              agreeing to
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
            &ldquo;I have read and agree to the Terms&rdquo; is the biggest lie on
            the internet. Fineprint reads the legal fine print of the services
            you use, flags the clauses that work against you, and tells you —
            in plain English — when the rules quietly change.
          </p>

          {/* Stats */}
          <dl className="mx-auto mt-12 grid max-w-2xl grid-cols-3 gap-4">
            <Stat value={stats.services} label="services graded" />
            <Stat value={stats.flagged_clauses} label="clauses flagged" />
            <Stat value={stats.changes_published} label="changes caught" />
          </dl>
        </section>

        {/* Search + grid */}
        <section id="browse" className="scroll-mt-24">
          <ServiceExplorer services={services} />
        </section>

        {/* How it works */}
        <section className="mt-28">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            How it works
          </h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            <Step
              n={1}
              title="We watch the documents"
              body="Every tracked service's Terms of Service and Privacy Policy is fetched, normalized, and compared against the last version — down to the individual clause."
            />
            <Step
              n={2}
              title="AI reads the fine print"
              body="Changed clauses are classified against a strict taxonomy of user-hostile patterns — forced arbitration, data sales, silent rule changes — and explained in plain English."
            />
            <Step
              n={3}
              title="Grades update automatically"
              body="Results publish as soon as analysis finishes. AI can make mistakes — that's why every flag links to the original clause text, and shaky low-confidence findings are left out of the grade."
            />
          </div>
          <p className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Curious about the grading scale and clause taxonomy?{" "}
            <Link href="/about" className="font-medium text-indigo-500 hover:underline dark:text-indigo-400">
              Read how Fineprint works →
            </Link>
          </p>
        </section>

        {/* CTA */}
        <section className="mt-24 overflow-hidden rounded-3xl border border-indigo-200/60 bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-10 text-center dark:border-indigo-500/20 dark:from-indigo-500/10 dark:via-zinc-950 dark:to-violet-500/10">
          <h2 className="text-2xl font-bold tracking-tight">Missing a service you use?</h2>
          <p className="mx-auto mt-2 max-w-xl text-zinc-600 dark:text-zinc-400">
            Tell us what to track. Requests are voted on by other users and the
            most-wanted services get analyzed first.
          </p>
          <Link
            href="/request"
            className="mt-6 inline-block rounded-xl bg-indigo-500 px-6 py-3 text-sm font-medium text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400"
          >
            Request a service
          </Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
      <dd className="text-3xl font-extrabold tabular-nums tracking-tight">{value}</dd>
      <dt className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-sm font-bold text-indigo-600 dark:text-indigo-300">
        {n}
      </span>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{body}</p>
    </div>
  );
}
