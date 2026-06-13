import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Sitemap : Fineprinted",
  description: "Complete list of tracked services and pages on Fineprinted.",
};

export default async function SitemapPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-14">
        <div className="animate-fade-in-up">
          <h1 className="text-3xl font-bold tracking-tight font-heading">Sitemap</h1>
          <p className="mt-3 leading-relaxed text-zinc-700 dark:text-zinc-400">
            A directory of all pages, features, and tracked service analysis dashboards on Fineprinted.
          </p>

          <div className="mt-12 grid gap-10 sm:grid-cols-2">
            {/* Core Pages */}
            <section className="space-y-4">
              <h2 className="text-lg font-bold font-heading text-accent">Core Pages</h2>
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50 space-y-4">
                <SitemapLink href="/" title="Home" desc="The homepage showcasing terms analysis features, live translation, and your saved services." />
                <SitemapLink href="/browse" title="Browse services" desc="A clean place to search and view all tracked services on Fineprinted." />
                <SitemapLink href="/request" title="Request a service" desc="Submit a root domain for tracking or upvote an existing request." />
                <SitemapLink href="/about" title="About Fineprinted" desc="How the automated AI pipeline analyzes clauses, grades them, and keeps results verifiable." />
                <SitemapLink href="/saved" title="Your Watchlist (Saved)" desc="Access your saved services to keep track of critical legal changes." />
              </div>
            </section>

            {/* General Info */}
            <section className="space-y-4">
              <h2 className="text-lg font-bold font-heading text-accent">AI & Data Disclosures</h2>
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50 space-y-4">
                <div className="text-xs text-zinc-500 space-y-3 leading-relaxed">
                  <p>
                    <strong>Fully Automated Pipeline:</strong> Fineprinted operates using an automated AI extraction and classification system. No human checks or publishes changed documents.
                  </p>
                  <p>
                    <strong>Disclaimers:</strong> All analyses are informational and do not constitute legal advice. AI can make mistakes. Always check the original clause text linked on each dashboard.
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function SitemapLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <div className="group">
      <Link href={href} className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 group-hover:text-accent dark:group-hover:text-accent transition flex items-center gap-1">
        {title} <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
      </Link>
      <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{desc}</p>
    </div>
  );
}
