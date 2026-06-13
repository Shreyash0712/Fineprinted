import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Service } from "@/lib/types";
import { addService } from "./actions";
import { SyncButton } from "./sync-button";

export const dynamic = "force-dynamic";

const gradeColor: Record<string, string> = {
  A: "text-emerald-500 dark:text-emerald-400",
  B: "text-lime-600 dark:text-lime-400",
  C: "text-yellow-600 dark:text-yellow-400",
  D: "text-orange-700 dark:text-orange-400",
  F: "text-red-700 dark:text-red-400",
};

export default async function AdminDashboard() {
  await requireAdmin();
  const db = createAdminClient();

  const [{ count: pendingCount }, { data: services }] = await Promise.all([
    db
      .from("service_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    db.from("services").select("*").order("updated_at", { ascending: false }).limit(100),
  ]);

  const svcList = (services ?? []) as Service[];
  const activeCount = svcList.filter((s) => s.status === "active").length;
  const totalCount = svcList.length;

  return (
    <main className="space-y-10">
      {/* Dashboard Stats */}
      <section className="grid gap-4 grid-cols-1 sm:grid-cols-3 animate-fade-in-up">
        <Link href="/admin/requests" className="rounded-2xl border border-zinc-200 bg-white p-5 relative overflow-hidden dark:border-zinc-900 dark:bg-zinc-900/40 shadow-sm block group hover:border-amber-500/40 dark:hover:border-amber-500/30 transition">
          <div className="absolute top-0 right-0 h-24 w-24 rounded-full bg-amber-500/5 blur-2xl" />
          <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition font-heading">Pending Requests</dt>
          <dd className="mt-2 text-3xl font-bold tracking-tight text-amber-500 dark:text-amber-400 font-heading">{pendingCount ?? 0}</dd>
        </Link>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 relative overflow-hidden dark:border-zinc-900 dark:bg-zinc-900/40 shadow-sm">
          <div className="absolute top-0 right-0 h-24 w-24 rounded-full bg-accent/10 blur-2xl" />
          <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500 font-heading">Active Services</dt>
          <dd className="mt-2 text-3xl font-bold tracking-tight text-accent font-heading">{activeCount}</dd>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 relative overflow-hidden dark:border-zinc-900 dark:bg-zinc-900/40 shadow-sm">
          <div className="absolute top-0 right-0 h-24 w-24 rounded-full bg-emerald-500/5 blur-2xl" />
          <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500 font-heading">Total Tracked</dt>
          <dd className="mt-2 text-3xl font-bold tracking-tight text-emerald-500 dark:text-emerald-400 font-heading">{totalCount}</dd>
        </div>
      </section>

      {/* Add service */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 space-y-4 dark:border-zinc-900 dark:bg-zinc-950 shadow-sm animate-fade-in-up animation-delay-100">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-heading">
          Add service
        </h2>
        <form action={addService} className="flex flex-wrap gap-3 max-w-2xl">
          <div className="flex-1 min-w-[200px]">
            <input
              name="name"
              placeholder="Service Name (e.g. Netflix)"
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-accent focus:ring-4 focus:ring-accent/10 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-accent/60 transition"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <input
              name="domain"
              placeholder="example.com"
              required
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-accent focus:ring-4 focus:ring-accent/10 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-accent/60 transition"
            />
          </div>
          <button className="rounded-xl bg-accent hover:bg-accent-hover text-white shadow-md shadow-accent/10 px-5 py-2.5 text-sm font-semibold transition cursor-pointer shrink-0">
            Add Service
          </button>
        </form>
      </section>

      {/* Services */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 space-y-4 dark:border-zinc-900 dark:bg-zinc-950 shadow-sm animate-fade-in-up animation-delay-200">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-900 pb-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-heading">
            Services
          </h2>
          <SyncButton />
        </div>
        {totalCount === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-700">No services yet, add one above.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-zinc-50/50 dark:divide-zinc-900 dark:border-zinc-900 dark:bg-zinc-900/10">
            {svcList.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/admin/services/${s.id}`}
                  className="flex items-center gap-4 px-4 py-3.5 hover:bg-zinc-100/50 dark:hover:bg-zinc-900/40 transition group"
                >
                  <span
                    className={`w-8 text-center text-lg font-black font-heading ${
                      s.current_grade ? gradeColor[s.current_grade] : "text-zinc-400 dark:text-zinc-700"
                    }`}
                  >
                    {s.current_grade ?? "?"}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-zinc-800 dark:text-zinc-200 group-hover:text-accent transition">{s.name}</span>
                    <span className="block text-xs text-zinc-500 mt-0.5">{s.root_domain}</span>
                  </span>
                  {s.current_score !== null && (
                    <span className="text-sm font-medium tabular-nums text-zinc-500 dark:text-zinc-400 mr-2">
                      {s.current_score}/100
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide ${
                      s.status === "active"
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20"
                        : "bg-zinc-200 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 border border-zinc-200/50 dark:border-zinc-700/30"
                    }`}
                  >
                    {s.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
