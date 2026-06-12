import Link from "next/link";
import { SiteHeader } from "./components/site-header";
import { SiteFooter } from "./components/site-footer";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-24 flex flex-col items-center justify-center text-center animate-fade-in-up">
        <span className="text-sm font-bold uppercase tracking-wider text-accent">404 Error</span>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl font-heading">Page not found</h1>
        <p className="mt-4 max-w-md text-base text-zinc-650 dark:text-zinc-400 leading-relaxed">
          Sorry, we couldn&apos;t find the page you&apos;re looking for. The service might not be tracked yet, or the link has changed.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link
            href="/"
            className="rounded-xl bg-accent hover:bg-accent-hover text-white shadow-md shadow-accent/10 px-5 py-3 text-sm font-semibold transition cursor-pointer"
          >
            Go back home
          </Link>
          <Link
            href="/request"
            className="rounded-xl border border-zinc-200 hover:border-accent/30 bg-white dark:border-zinc-800 dark:bg-zinc-900/50 px-5 py-3 text-sm font-semibold transition cursor-pointer"
          >
            Request a service
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
