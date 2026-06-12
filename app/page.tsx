import Link from "next/link";
import { loadServicesIndex } from "@/lib/static-data";
import { HomeSavedServices } from "./components/home-saved-services";
import { SiteFooter } from "./components/site-footer";
import { SiteHeader } from "./components/site-header";

// Fully static: service data is committed to the repo (data/services.json)
// by the export workflow, and each commit triggers a redeploy. Browsing
// the site costs zero database calls.
export const dynamic = "force-static";

export default async function Home() {
  const { stats } = await loadServicesIndex();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 pb-24">
        <HomeSavedServices />
        {/* Hero */}
        <section className="relative py-8 text-center sm:py-12 animate-fade-in-up">
          <p className="mb-4 inline-block rounded-full border border-accent/20 bg-accent-light px-3.5 py-1 text-xs font-semibold tracking-wide text-accent dark:border-accent/30 dark:bg-[#201B14] dark:text-[#E2C7A2]">
            The terms you never read, read for you
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-extrabold tracking-tight sm:text-6xl font-heading leading-tight">
            Know what you&apos;re{" "}
            <span className="text-accent dark:text-[#D7B88F]">
              agreeing to
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-zinc-650 dark:text-zinc-400 leading-relaxed font-medium">
            &ldquo;I have read and agree to the Terms&rdquo; is the biggest lie on
            the internet. Fineprinted reads the legal fine print of the services
            you use, flags the clauses that work against you, and tells you,
            in plain English, when the rules quietly change.{" "}
            <span className="text-zinc-550 dark:text-zinc-500 font-normal block mt-2">
              Note: This is a fully automated AI analysis. AI can make mistakes.
            </span>
          </p>

          {/* Stats */}
          <dl className="mx-auto mt-12 grid max-w-2xl grid-cols-3 gap-4">
            <Stat value={stats.services} label="services graded" />
            <Stat value={stats.flagged_clauses} label="clauses flagged" />
            <Stat value={stats.changes_published} label="changes caught" />
          </dl>

          {/* Live Translation Mockup UI */}
          <div className="mt-8 md:mt-10 flex flex-col md:flex-row items-stretch justify-center gap-6 md:gap-8 text-left max-w-4xl mx-auto opacity-95 animate-fade-in-up animation-delay-100">
            {/* Left Mockup Document */}
            <div className="flex-1 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 border-b border-zinc-150 pb-3 dark:border-zinc-800">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                  <div className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
                  <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
                  <span className="ml-2 text-xs font-mono text-zinc-400 dark:text-zinc-550">terms_of_service.md</span>
                </div>
                <div className="mt-4 space-y-3 font-mono text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
                  <p>1.1 OVERVIEW. This Agreement governs your use of the Service...</p>
                  <p className="bg-red-500/10 border-l-2 border-red-500 p-2 text-zinc-700 dark:text-zinc-300 rounded-r-md">
                    1.2 UNILATERAL CHANGES. We reserve the right, at our sole discretion, to modify or replace these Terms at any time without prior notice to the user...
                  </p>
                  <p>1.3 TERMINATION. We may terminate or suspend access to our Service immediately...</p>
                </div>
              </div>
            </div>

            {/* Connection Arrow */}
            <div className="flex items-center justify-center text-accent py-2 md:py-0">
              <svg className="h-6 w-6 animate-pulse rotate-90 md:rotate-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </div>

            {/* Right Plain English Card */}
            <div className="flex-1 rounded-2xl border border-accent/20 bg-accent-light p-6 shadow-md dark:border-accent/30 dark:bg-[#1E1A14] flex flex-col justify-between">
              <div>
                <div className="inline-block rounded-full bg-red-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-650 dark:text-red-400">
                  Critical deduction
                </div>
                <h4 className="mt-3 text-base font-bold font-heading">Silent rule changes</h4>
                <p className="mt-2 text-xs leading-relaxed text-zinc-650 dark:text-zinc-400">
                  The service can rewrite the terms at any time without telling you. Continued use means automatic agreement.
                </p>
              </div>
              <div className="mt-4 border-t border-accent/10 pt-3 flex items-center justify-between text-[10px] text-accent">
                <span>Category: UNILATERAL_CHANGE</span>
                <span className="font-bold">-30 Points</span>
              </div>
            </div>
          </div>
        </section>


        {/* How it works */}
        <section className="mt-10 sm:mt-14 border-t border-zinc-200/40 pt-8 sm:pt-10 dark:border-zinc-900/40">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl font-heading">
            How it works
          </h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            <Step
              n={1}
              title="We watch the documents"
              body="Every tracked service's Terms of Service and Privacy Policy is fetched, normalized, and compared against the last version, down to the individual clause."
            />
            <Step
              n={2}
              title="AI reads the fine print"
              body="Changed clauses are classified against a strict taxonomy of user-hostile patterns: forced arbitration, data sales, silent rule changes, and explained in plain English."
            />
            <Step
              n={3}
              title="Grades update automatically"
              body="Results publish as soon as analysis finishes. AI can make mistakes, that's why every flag links to the original clause text, and shaky low-confidence findings are left out of the grade."
            />
          </div>
          <p className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Curious about the grading scale and clause taxonomy?{" "}
            <Link href="/about" className="font-semibold text-accent hover:underline dark:text-accent-hover">
              Read how Fineprinted works →
            </Link>
          </p>
        </section>

        {/* Facts & Oddities Section */}
        <section className="mt-10 sm:mt-14 border-t border-zinc-200/40 pt-8 sm:pt-10 dark:border-zinc-900/40">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent dark:text-[#D7B88F]">Did you know?</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-4xl font-heading">
              Terms of service oddities
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-zinc-500 dark:text-zinc-400">
              The digital agreements we sign in seconds are full of surprising details, massive reading requirements, and unusual disclosures.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <FactCard
              stat="76 Days"
              title="Reading time debt"
              description="The average internet user would need to spend 76 working days every year just to read the policies and terms of the sites they visit."
            />
            <FactCard
              stat="1.5 Hours"
              title="Longer than Hamlet"
              description="Many terms of service take over 90 minutes to read, making them longer than Shakespearean plays, yet we agree in less than a second."
            />
            <FactCard
              stat="7,500+"
              title="Souls claimed"
              description="In 2010, an online game retailer added a clause claiming ownership of users' immortal souls. Thousands agreed without reading."
              highlight
            />
            <FactCard
              stat="Background"
              title="Shadow tracking"
              description="Many modern services reserve the right to track your precise locations even while the app is closed, then share it with advertising networks."
            />
          </div>
        </section>

        {/* CTA */}
        <section className="mt-10 sm:mt-14 overflow-hidden rounded-3xl border border-accent/10 bg-gradient-to-br from-accent-light/40 via-[#FAF9F5]/40 to-accent-light/10 p-10 text-center dark:border-accent/15 dark:from-[#1C1813]/20 dark:via-[#0B0B0C] dark:to-accent-light/5">
          <h2 className="text-2xl font-bold tracking-tight font-heading">Missing a service you use?</h2>
          <p className="mx-auto mt-2 max-w-xl text-zinc-550 dark:text-zinc-400">
            Tell us what to track. Requests are voted on by other users and the
            most-wanted services get analyzed first.
          </p>
          <Link
            href="/request"
            className="mt-6 inline-block rounded-xl bg-gradient-to-br from-accent to-[#5c492e] hover:from-accent-hover hover:to-[#4e3c23] border border-accent/20 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-accent/10 transition cursor-pointer"
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
      <dd className="text-3xl font-extrabold tabular-nums tracking-tight font-heading">{value}</dd>
      <dt className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-sm font-bold text-accent">
        {n}
      </span>
      <h3 className="mt-4 font-semibold font-heading">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-655 dark:text-zinc-400">{body}</p>
    </div>
  );
}

function FactCard({
  stat,
  title,
  description,
  highlight = false,
}: {
  stat: string;
  title: string;
  description: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-6 border transition-all ${
        highlight
          ? "bg-gradient-to-br from-accent to-[#5c492e] border-accent text-white shadow-md shadow-accent/10 dark:from-accent dark:to-[#4e3c23]"
          : "bg-white border-zinc-200 dark:bg-zinc-900/50 dark:border-zinc-800"
      }`}
    >
      <div
        className={`font-mono text-xs font-bold uppercase tracking-wider ${
          highlight ? "text-[#f7f3eb]" : "text-accent"
        }`}
      >
        {stat}
      </div>
      <h3 className="mt-2 font-semibold text-base font-heading">{title}</h3>
      <p
        className={`mt-2 text-xs leading-relaxed ${
          highlight ? "text-zinc-150" : "text-zinc-500 dark:text-zinc-400"
        }`}
      >
        {description}
      </p>
    </div>
  );
}
