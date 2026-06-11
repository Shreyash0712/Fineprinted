import Link from "next/link";
import { LogoIcon } from "./site-header";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-zinc-200 bg-white dark:border-zinc-800/80 dark:bg-zinc-950">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <LogoIcon className="h-6 w-6 text-indigo-500" />
            Fine<span className="text-indigo-500">print</span>
          </Link>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            The terms you never read, read for you. We monitor Terms of Service
            and Privacy Policies, flag user-hostile clauses in plain English,
            and grade every service from A to F.
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Explore</h3>
          <ul className="mt-3 space-y-2 text-sm text-zinc-500 dark:text-zinc-400">
            <li><FooterLink href="/">Browse services</FooterLink></li>
            <li><FooterLink href="/saved">Your watchlist</FooterLink></li>
            <li><FooterLink href="/request">Request a service</FooterLink></li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Project</h3>
          <ul className="mt-3 space-y-2 text-sm text-zinc-500 dark:text-zinc-400">
            <li><FooterLink href="/about">About Fineprint</FooterLink></li>
            <li><FooterLink href="/about#grading">How grading works</FooterLink></li>
            <li><FooterLink href="/admin">Admin</FooterLink></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-zinc-200 py-5 text-center text-xs text-zinc-400 dark:border-zinc-800/80 dark:text-zinc-600">
        Grades are automated analyses reviewed by humans — informational only, not legal advice.
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
