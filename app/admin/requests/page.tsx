import { requireAdmin } from "@/lib/admin/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ServiceRequest } from "@/lib/types";
import { approveRequest, rejectRequest } from "../actions";

export const dynamic = "force-dynamic";

export default async function RequestQueuePage() {
  await requireAdmin();
  const db = createAdminClient();

  const { data: requests } = await db
    .from("service_requests")
    .select("*")
    .eq("status", "pending")
    .order("vote_count", { ascending: false })
    .limit(100);

  const reqList = (requests ?? []) as ServiceRequest[];
  const pendingCount = reqList.length;

  return (
    <main className="space-y-6">
      <div className="flex items-center justify-between border-b border-zinc-150 dark:border-zinc-900 pb-3 animate-fade-in-up">
        <div>
          <h1 className="text-2xl font-bold font-heading">Requests Queue</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 font-medium">
            Tracked website requests submitted by users, ranked by upvote count.
          </p>
        </div>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 space-y-4 dark:border-zinc-900 dark:bg-zinc-950 shadow-sm animate-fade-in-up animation-delay-100">
        {pendingCount === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-650 py-10 text-center">No pending requests in the queue.</p>
        ) : (
          <ul className="divide-y divide-zinc-150 rounded-xl border border-zinc-200 bg-zinc-50/50 dark:divide-zinc-900 dark:border-zinc-900 dark:bg-zinc-900/10">
            {reqList.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-4 px-4 py-3.5 sm:flex-nowrap">
                <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                  ▲ {r.vote_count}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="block truncate text-sm font-medium text-zinc-805 dark:text-zinc-150">
                    {r.requested_domain}
                  </span>
                  {r.suggested_name && (
                    <span className="block text-xs text-zinc-500 mt-0.5">
                      suggested: &ldquo;{r.suggested_name}&rdquo;
                    </span>
                  )}
                </div>
                <span className="text-xs text-zinc-500 font-medium">
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
                <div className="flex gap-2 w-full sm:w-auto">
                  <form action={approveRequest.bind(null, r.id)} className="flex-1 sm:flex-none">
                    <button className="w-full rounded-lg bg-emerald-600/10 dark:bg-emerald-600/20 px-3 py-1.5 text-xs font-medium text-emerald-650 dark:text-emerald-400 border border-emerald-500/10 hover:bg-emerald-600/20 dark:hover:bg-emerald-600/30 transition cursor-pointer">
                      Approve
                    </button>
                  </form>
                  <form action={rejectRequest.bind(null, r.id)} className="flex-1 sm:flex-none">
                    <button className="w-full rounded-lg bg-red-650/10 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 border border-red-500/10 hover:bg-red-650/20 transition cursor-pointer">
                      Reject
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
