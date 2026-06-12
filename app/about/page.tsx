import type { Metadata } from "next";
import Link from "next/link";
import { GradeBadge } from "../components/grade";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";

export const metadata: Metadata = {
  title: "About : Fineprinted",
  description:
    "Why Fineprinted exists, how the AI pipeline works, and how services earn their grades.",
};

const TAXONOMY: { tag: string; label: string; points: string; tone: string; desc: string }[] = [
  {
    tag: "FORCED_ARBITRATION",
    label: "Forced arbitration",
    points: "−30",
    tone: "text-red-600 dark:text-red-400",
    desc: "You waive your right to a trial by jury or to join a class action. Disputes go to an arbitrator, who is often one the company picks.",
  },
  {
    tag: "UNILATERAL_CHANGE",
    label: "Silent rule changes",
    points: "−30",
    tone: "text-red-600 dark:text-red-400",
    desc: "The service can rewrite the terms at any time without telling you. Continued use means automatic agreement.",
  },
  {
    tag: "DATA_SALE",
    label: "Data sale",
    points: "−30",
    tone: "text-red-600 dark:text-red-400",
    desc: "Your personal data is explicitly sold or shared with data brokers.",
  },
  {
    tag: "CONTENT_LICENSE_BROAD",
    label: "Broad content license",
    points: "−15",
    tone: "text-orange-600 dark:text-orange-400",
    desc: "The service claims a perpetual, often irrevocable license to everything you upload or create.",
  },
  {
    tag: "ACCOUNT_TERMINATION",
    label: "Arbitrary termination",
    points: "−15",
    tone: "text-orange-600 dark:text-orange-400",
    desc: "Your account, and everything in it, can be terminated at any time, for any reason or none.",
  },
  {
    tag: "TRACKING_THIRD_PARTY",
    label: "Third-party tracking",
    points: "−5",
    tone: "text-yellow-600 dark:text-yellow-400",
    desc: "Extensive tracking and sharing with third parties for targeted advertising.",
  },
  {
    tag: "NOTICE_OF_CHANGE",
    label: "Advance notice promise",
    points: "+5",
    tone: "text-emerald-600 dark:text-emerald-400",
    desc: "A pro-user clause: the service guarantees 30+ days notice before terms change.",
  },
];

const GRADES = [
  { grade: "A" as const, range: "90–100", desc: "Respectful terms. Rare." },
  { grade: "B" as const, range: "75–89", desc: "Minor concerns, nothing alarming." },
  { grade: "C" as const, range: "50–74", desc: "Several hostile clauses worth knowing about." },
  { grade: "D" as const, range: "25–49", desc: "The fine print works against you." },
  { grade: "F" as const, range: "< 25", desc: "Read nothing, agree to everything? Not here." },
];

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-14">
        <div className="max-w-3xl space-y-12">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl font-heading">
              Nobody reads the terms.
              <br />
              <span className="text-accent dark:text-[#D7B88F]">So we built something that does.</span>
            </h1>

            <div className="mt-8 space-y-5 leading-relaxed text-zinc-650 dark:text-zinc-350">
              <p>
                Studies consistently show that fewer than 1% of users read terms of
                service agreements, and the ones who try would need weeks per year
                to get through them all. Companies know this. Some of the most
                consequential clauses on the internet, such as giving up your right to
                sue, licensing away your creations, or agreeing to future rules you
                haven&apos;t seen, hide in documents designed not to be read.
              </p>
              <p>
                <strong>Fineprinted reads them for you.</strong> We continuously
                monitor the Terms of Service, Privacy Policies, and related legal
                documents of tracked services. Every document is split into
                individual clauses, and an AI classifies each one against a strict
                taxonomy of known user-hostile patterns, and results publish
                automatically, with the original clause text attached so you can
                always verify a finding yourself. AI can make mistakes: that&apos;s
                exactly why the receipts are part of the product.
              </p>
              <p>
                And because terms change quietly,{" "}
                <Link href="/saved" className="font-semibold text-accent hover:underline dark:text-accent-hover">
                  saving a service
                </Link>{" "}
                means you&apos;ll see what changed, when, and what it means, in
                plain English, not legalese.
              </p>
            </div>
          </div>

          {/* Grading */}
          <section id="grading" className="scroll-mt-24">
            <h2 className="text-2xl font-bold tracking-tight font-heading">How grading works</h2>
            <p className="mt-3 leading-relaxed text-zinc-655 dark:text-zinc-400">
              Every service starts with <strong className="text-zinc-900 dark:text-zinc-100">100 points</strong>.
              Each distinct hostile pattern found in its active documents deducts
              points; genuinely pro-user clauses earn some back. The final score
              maps to a letter grade:
            </p>
            <ul className="mt-6 space-y-3">
              {GRADES.map(({ grade, range, desc }) => (
                <li
                  key={grade}
                  className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50"
                >
                  <GradeBadge grade={grade} size="sm" />
                  <span className="w-16 text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
                    {range}
                  </span>
                  <span className="text-sm">{desc}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Taxonomy */}
          <section>
            <h2 className="text-2xl font-bold tracking-tight font-heading">What we look for</h2>
            <p className="mt-3 leading-relaxed text-zinc-655 dark:text-zinc-400">
              The AI doesn&apos;t free-style its judgments. Every clause is
              classified against a fixed taxonomy with fixed point values, so
              grades are consistent and comparable across services:
            </p>
            <ul className="mt-6 divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white shadow-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/50">
              {TAXONOMY.map((t) => (
                <li key={t.tag} className="flex gap-4 p-4">
                  <span className={`w-12 shrink-0 text-right font-mono text-sm font-bold tabular-nums ${t.tone}`}>
                    {t.points}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold font-heading">{t.label}</span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-zinc-650 dark:text-zinc-400">
                      {t.desc}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm leading-relaxed text-zinc-650 dark:text-zinc-405">
              Direction matters: deductions only apply when a clause{" "}
              <em>imposes</em> a practice. A clause that explicitly rules one out,
              like &ldquo;we do <strong>not</strong> sell your personal
              data&rdquo;, counts <span className="font-mono text-emerald-600 dark:text-emerald-400">+5</span>{" "}
              in the service&apos;s favor instead. Each pattern counts once per
              service, no matter how many clauses repeat it.
            </p>
          </section>

          {/* Trust */}
          <section>
            <h2 className="text-2xl font-bold tracking-tight font-heading">How we keep grades honest</h2>
            <ul className="mt-5 space-y-4 text-zinc-700 dark:text-zinc-300">
              <TrustItem title="Fully automated, and upfront about it.">
                Analysis publishes without human editing, so what you see is
                exactly what the AI found. AI can make mistakes, which is why
                everything below exists.
              </TrustItem>
              <TrustItem title="Confidence thresholds.">
                When the AI isn&apos;t sure a clause fits a category, the finding
                is automatically excluded from the grade.
              </TrustItem>
              <TrustItem title="Semantic change detection.">
                We diff documents by meaning, not formatting: a reworded
                sentence is a change; a reshuffled page layout is not.
              </TrustItem>
              <TrustItem title="Receipts included.">
                Every flag links to the original clause text, so you can read
                exactly what the document says and judge for yourself.
              </TrustItem>
            </ul>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm leading-relaxed text-zinc-505 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
            <strong className="text-zinc-700 dark:text-zinc-305">A note on limits:</strong>{" "}
            Fineprinted is a fully automated AI analysis, which can make mistakes,
            and it is informational, not legal advice. Grades reflect the
            patterns detected in public documents at the time of analysis, and a
            good grade is not an endorsement. When something matters to you,
            read the linked clause yourself.
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function TrustItem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <CheckIcon className="mt-1 h-4 w-4 shrink-0 text-emerald-500" />
      <p className="text-sm leading-relaxed">
        <strong>{title}</strong> {children}
      </p>
    </li>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
