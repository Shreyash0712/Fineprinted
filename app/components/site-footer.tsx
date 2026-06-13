import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-zinc-200/50 bg-[#FAF9F5] dark:border-zinc-900/50 dark:bg-[#0B0B0C]">
      <div className="mx-auto grid max-w-5xl gap-10 px-6 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <Link href="/" className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
            <span>Fine<span className="text-accent">printed</span></span>
          </Link>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-zinc-600 dark:text-zinc-400 font-medium">
            The terms you never read, read for you. We monitor Terms of Service
            and Privacy Policies, flag user-hostile clauses in plain English,
            and grade every service from A to F.
          </p>
        </div>
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-heading">Explore</h3>
          <ul className="mt-3 space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
            <li><FooterLink href="/browse">Browse services</FooterLink></li>
            <li><FooterLink href="/saved">Your watchlist</FooterLink></li>
            <li><FooterLink href="/request">Request a service</FooterLink></li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-heading">Project</h3>
          <ul className="mt-3 space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
            <li><FooterLink href="/about">About Fineprinted</FooterLink></li>
            <li><FooterLink href="/about#grading">How grading works</FooterLink></li>
            <li><FooterLink href="/sitemap">Sitemap</FooterLink></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-zinc-200/50 py-5 text-center text-xs text-zinc-500 dark:border-zinc-900/50 dark:text-zinc-700">
        Grades are automated AI analyses, informational only, and not legal advice. AI can make mistakes.
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="transition hover:text-zinc-900 dark:hover:text-zinc-100">
      {children}
    </Link>
  );
}
