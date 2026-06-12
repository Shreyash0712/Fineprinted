import type { Metadata } from "next";
import { RequestForm } from "../components/request-form";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";

export const metadata: Metadata = {
  title: "Request a service : Fineprinted",
  description: "Ask Fineprinted to track the Terms of Service of a website you use.",
};

export default function RequestPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-14">
        <div className="mx-auto max-w-xl">
          <h1 className="text-3xl font-bold tracking-tight font-heading">Request a service</h1>
          <p className="mt-3 leading-relaxed text-zinc-650 dark:text-zinc-400">
            Want to know what a service&apos;s fine print really says? Submit it
            here. If someone already requested it, your submission counts as a
            vote, and the most-wanted services get queued and analyzed first.
          </p>

          <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50 sm:p-8">
            <RequestForm />
          </div>

          <div className="mt-8 space-y-3 text-sm text-zinc-550 dark:text-zinc-400">
            <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 font-heading">
              What happens next?
            </h2>
            <ol className="list-decimal space-y-2 pl-5">
              <li>Your request lands in a processing queue, ranked by votes.</li>
              <li>
                Our automated pipeline locates, extracts, and
                analyzes the service&apos;s legal documents.
              </li>
              <li>
                The service appears on Fineprinted with its grade automatically, usually within
                a few days, depending on the queue.
              </li>
            </ol>
            <p className="pt-2 text-xs text-zinc-400 dark:text-zinc-500">
              Note: Fineprinted relies fully on automated AI classification to identify patterns. AI can make mistakes, and findings should be verified against the original text.
            </p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              One vote per request per browser. Requests are reduced to the root
              domain, and subpages or tracking links are stripped automatically.
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
