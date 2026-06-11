import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Service, ServiceRequest } from "@/lib/types";
import { addService, approveRequest, rejectRequest } from "./actions";

export const dynamic = "force-dynamic";

const gradeColor: Record<string, string> = {
  A: "text-emerald-400",
  B: "text-lime-400",
  C: "text-yellow-400",
  D: "text-orange-400",
  F: "text-red-400",
};

export default async function AdminDashboard() {
  await requireAdmin();
  const db = createAdminClient();

  const [{ data: requests }, { data: services }] = await Promise.all([
    db
      .from("service_requests")
      .select("*")
      .eq("status", "pending")
      .order("vote_count", { ascending: false })
      .limit(50),
    db.from("services").select("*").order("updated_at", { ascending: false }).limit(100),
  ]);

  return (
    <main className="space-y-10">
      {/* Request queue */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Request queue
        </h2>
        {!requests?.length ? (
          <p className="text-sm text-zinc-500">No pending requests.</p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
            {(requests as ServiceRequest[]).map((r) => (
              <li key={r.id} className="flex items-center gap-4 px-4 py-3">
                <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs tabular-nums text-zinc-300">
                  ▲ {r.vote_count}
                </span>
                <span className="flex-1 text-sm">
                  {r.requested_domain}
                  {r.suggested_name && (
                    <span className="ml-2 text-xs text-zinc-500">
                      suggested: &ldquo;{r.suggested_name}&rdquo;
                    </span>
                  )}
                </span>
                <span className="text-xs text-zinc-500">
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
                <form action={approveRequest.bind(null, r.id)}>
                  <button className="rounded-md bg-emerald-600/20 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-600/30">
                    Approve
                  </button>
                </form>
                <form action={rejectRequest.bind(null, r.id)}>
                  <button className="rounded-md bg-red-600/10 px-3 py-1 text-xs text-red-300 hover:bg-red-600/20">
                    Reject
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Add service */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Add service
        </h2>
        <form action={addService} className="flex flex-wrap gap-2">
          <input
            name="name"
            placeholder="Name (optional)"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-zinc-500"
          />
          <input
            name="domain"
            placeholder="example.com"
            required
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-zinc-500"
          />
          <button className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white">
            Add
          </button>
        </form>
      </section>

      {/* Services */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Services
        </h2>
        {!services?.length ? (
          <p className="text-sm text-zinc-500">No services yet — add one above.</p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
            {(services as Service[]).map((s) => (
              <li key={s.id}>
                <Link
                  href={`/admin/services/${s.id}`}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-900"
                >
                  <span
                    className={`w-8 text-center text-lg font-bold ${
                      s.current_grade ? gradeColor[s.current_grade] : "text-zinc-600"
                    }`}
                  >
                    {s.current_grade ?? "–"}
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm">{s.name}</span>
                    <span className="block text-xs text-zinc-500">{s.root_domain}</span>
                  </span>
                  {s.current_score !== null && (
                    <span className="text-xs tabular-nums text-zinc-400">
                      {s.current_score}/100
                    </span>
                  )}
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      s.status === "active"
                        ? "bg-emerald-600/15 text-emerald-300"
                        : "bg-zinc-800 text-zinc-400"
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
