"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  ADMIN_COOKIE,
  createSessionToken,
  requireAdmin,
  verifyPassword,
} from "@/lib/admin/auth";
import { sanitizeToRootDomain } from "@/lib/domain";
import { dispatchWorkflow, githubConfigured } from "@/lib/github";
import { recomputeServiceGrade } from "@/lib/pipeline/grade";
import { createRun, failRun, isRunActive } from "@/lib/pipeline/run-store";
import { createAdminClient } from "@/lib/supabase/admin";
// Removed DocumentType import

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function login(
  _prev: string | null,
  formData: FormData
): Promise<string | null> {
  const password = String(formData.get("password") ?? "");
  if (!process.env.ADMIN_PASSWORD) {
    return "ADMIN_PASSWORD is not set in .env — add it and restart the server.";
  }
  if (!verifyPassword(password)) {
    return "Wrong password.";
  }
  const store = await cookies();
  store.set(ADMIN_COOKIE, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  redirect("/admin");
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  redirect("/admin/login");
}

// ---------------------------------------------------------------------------
// Services & request queue
// ---------------------------------------------------------------------------

export async function addService(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const domain = sanitizeToRootDomain(String(formData.get("domain") ?? ""));
  if (!domain) throw new Error("Invalid domain");

  const db = createAdminClient();
  const { data, error } = await db
    .from("services")
    .insert({ name: name || domain, root_domain: domain })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error(`${domain} is already tracked`);
    throw new Error(error.message);
  }
  redirect(`/admin/services/${data.id}`);
}

export async function updateServiceName(formData: FormData): Promise<void> {
  await requireAdmin();
  const serviceId = String(formData.get("serviceId") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (!serviceId || !name) throw new Error("Name is required");

  const db = createAdminClient();
  const { error } = await db.from("services").update({ name }).eq("id", serviceId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/services/${serviceId}`);
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function approveRequest(requestId: string): Promise<void> {
  await requireAdmin();
  const db = createAdminClient();

  const { data: request, error } = await db
    .from("service_requests")
    .select("id, requested_domain, suggested_name, status")
    .eq("id", requestId)
    .single();
  if (error || !request) throw new Error("Request not found");

  // Create the service if it doesn't exist yet (refresh requests reuse it)
  const { data: existing } = await db
    .from("services")
    .select("id")
    .eq("root_domain", request.requested_domain)
    .maybeSingle();

  let serviceId = existing?.id;
  if (!serviceId) {
    const { data: created, error: createError } = await db
      .from("services")
      .insert({
        name: request.suggested_name?.trim() || request.requested_domain,
        root_domain: request.requested_domain,
      })
      .select("id")
      .single();
    if (createError) throw new Error(createError.message);
    serviceId = created.id;
  }

  await db.from("service_requests").update({ status: "approved" }).eq("id", requestId);
  revalidatePath("/admin");
  revalidatePath("/admin/requests");
  redirect(`/admin/services/${serviceId}`);
}

export async function rejectRequest(requestId: string): Promise<void> {
  await requireAdmin();
  const db = createAdminClient();
  const { error } = await db
    .from("service_requests")
    .update({ status: "rejected" })
    .eq("id", requestId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  revalidatePath("/admin/requests");
}

// ---------------------------------------------------------------------------
// Documents (Manual pasting)
// ---------------------------------------------------------------------------

export async function saveDocument(
  serviceId: string,
  docId: string | null,
  name: string,
  url: string,
  pastedContent: string
): Promise<{ error: string | null; documentId: string | null }> {
  await requireAdmin();
  const db = createAdminClient();
  
  if (!serviceId) return { error: "Missing service ID", documentId: null };
  if (!pastedContent.trim()) return { error: "Pasted content is required", documentId: null };

  const payload = {
    service_id: serviceId,
    name: name.trim() || null,
    source_url: url.trim() || null,
    pasted_content: pastedContent.trim(),
  };

  if (docId) {
    const { error } = await db.from("documents").update(payload).eq("id", docId);
    if (error) return { error: error.message, documentId: null };
    revalidatePath(`/admin/services/${serviceId}`);
    return { error: null, documentId: docId };
  } else {
    const { data, error } = await db.from("documents").insert(payload).select("id").single();
    if (error) return { error: error.message, documentId: null };
    revalidatePath(`/admin/services/${serviceId}`);
    return { error: null, documentId: data.id };
  }
}

export async function deleteDocument(serviceId: string, docId: string): Promise<{ error: string | null }> {
  await requireAdmin();
  const db = createAdminClient();
  const { error } = await db.from("documents").delete().eq("id", docId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/services/${serviceId}`);
  return { error: null };
}

// ---------------------------------------------------------------------------
// Pipeline execution (GitHub Actions; inline fallback for local dev)
// ---------------------------------------------------------------------------

export interface TriggerPipelineResult {
  runId: string | null;
  /** True when an already-active run was returned instead of a new one. */
  resumed: boolean;
  error: string | null;
}

/**
 * Kicks off a pipeline run. On Vercel this only inserts a pipeline_runs
 * row and dispatches the GitHub Actions workflow (~200ms) — the run
 * itself can then sleep through free-tier rate limits for as long as it
 * needs. The admin UI polls the run row for progress.
 */
export async function triggerPipeline(serviceId: string): Promise<TriggerPipelineResult> {
  await requireAdmin();
  const db = createAdminClient();

  // Re-attach to an in-flight run instead of stacking a second one (which
  // would fight over the same rate-limit budget).
  const { data: lastRun } = await db
    .from("pipeline_runs")
    .select("*")
    .eq("service_id", serviceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastRun && isRunActive(lastRun)) {
    return { runId: lastRun.id, resumed: true, error: null };
  }

  const run = await createRun(db, serviceId);

  if (githubConfigured()) {
    try {
      await dispatchWorkflow({ mode: "pipeline", run_id: run.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await failRun(db, run.id, message);
      return { runId: null, resumed: false, error: message };
    }
    return { runId: run.id, resumed: false, error: null };
  }

  if (process.env.NODE_ENV !== "production") {
    // Local dev: no wall-clock limit, so run inline after the response.
    // The pipeline module is imported lazily to keep it out of the
    // serverless bundle for this actions file.
    after(async () => {
      const { executePipelineRun } = await import("@/lib/pipeline/runs");
      await executePipelineRun(run.id).catch(() => {
        // executePipelineRun already recorded the failure on the run row
      });
    });
    return { runId: run.id, resumed: false, error: null };
  }

  const message =
    "GITHUB_REPO / GITHUB_PAT are not configured. In production the pipeline must run on " +
    "GitHub Actions — a Vercel function times out long before free-tier rate limits allow " +
    "a run to finish. See README → “Pipeline execution”.";
  await failRun(db, run.id, message);
  return { runId: null, resumed: false, error: message };
}

export async function cancelPipelineRun(runId: string): Promise<{ error: string | null }> {
  await requireAdmin();
  const db = createAdminClient();
  const { error } = await db
    .from("pipeline_runs")
    .update({ status: "failed", error: "Cancelled manually by admin" })
    .eq("id", runId)
    .in("status", ["queued", "running"]);
  if (error) return { error: error.message };
  return { error: null };
}

/** Manually re-dispatch the static-data export (e.g. after a failed sync). */
export async function syncStaticData(): Promise<{ error: string | null }> {
  await requireAdmin();
  if (!githubConfigured()) {
    return { error: "GITHUB_REPO / GITHUB_PAT are not configured." };
  }
  try {
    await dispatchWorkflow({ mode: "export" });
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Classification overrides
//
// There is no publish gate anymore — the pipeline publishes and grades
// automatically. The one manual lever left: low-confidence classifications
// are excluded from grades until an admin approves them, so approving one
// recomputes the grade and re-syncs the public site.
// ---------------------------------------------------------------------------

export async function approveClassification(
  clauseHash: string,
  serviceId: string
): Promise<void> {
  await requireAdmin();
  const db = createAdminClient();
  const { error } = await db
    .from("classifications")
    .update({ admin_approved: true })
    .eq("clause_hash", clauseHash);
  if (error) throw new Error(error.message);

  await recomputeServiceGrade(db, serviceId);

  // Best-effort site sync; the next export catches up if this one fails.
  if (githubConfigured()) {
    try {
      await dispatchWorkflow({ mode: "export" });
    } catch (err) {
      console.error("static data export dispatch failed:", err);
    }
  }

  revalidatePath(`/admin/services/${serviceId}`);
  revalidatePath("/admin");
}
