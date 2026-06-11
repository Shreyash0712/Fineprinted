"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ADMIN_COOKIE,
  createSessionToken,
  requireAdmin,
  verifyPassword,
} from "@/lib/admin/auth";
import { sanitizeToRootDomain } from "@/lib/domain";
import { computeScore, scoreToGrade } from "@/lib/grading";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Classification, DocumentType } from "@/lib/types";

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
}

// ---------------------------------------------------------------------------
// Documents (manual override — spec section 7)
// ---------------------------------------------------------------------------

const DOCUMENT_TYPES: DocumentType[] = [
  "terms_of_service",
  "privacy_policy",
  "cookie_policy",
  "acceptable_use",
  "other",
];

export async function saveDocumentUrls(formData: FormData): Promise<void> {
  await requireAdmin();
  const serviceId = String(formData.get("serviceId") ?? "");
  const type = String(formData.get("type") ?? "") as DocumentType;
  if (!serviceId || !DOCUMENT_TYPES.includes(type)) throw new Error("Invalid input");

  const urls = String(formData.get("urls") ?? "")
    .split(/\r?\n/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));

  const db = createAdminClient();
  if (urls.length === 0) {
    const { error } = await db
      .from("documents")
      .delete()
      .eq("service_id", serviceId)
      .eq("type", type);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await db
      .from("documents")
      .upsert(
        { service_id: serviceId, type, source_urls: urls },
        { onConflict: "service_id,type" }
      );
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/admin/services/${serviceId}`);
}

// ---------------------------------------------------------------------------
// Review & publishing gate
// ---------------------------------------------------------------------------

export async function approveClassification(
  clauseHash: string,
  servicePath: string
): Promise<void> {
  await requireAdmin();
  const db = createAdminClient();
  const { error } = await db
    .from("classifications")
    .update({ admin_approved: true })
    .eq("clause_hash", clauseHash);
  if (error) throw new Error(error.message);
  revalidatePath(servicePath);
}

/** Recompute a service's score from the latest snapshot of every document. */
async function recomputeServiceGrade(serviceId: string): Promise<{ score: number }> {
  const db = createAdminClient();
  const { data: docs, error } = await db
    .from("documents")
    .select("id")
    .eq("service_id", serviceId);
  if (error) throw new Error(error.message);

  const all: Pick<
    Classification,
    "category" | "severity" | "confidence_score" | "admin_approved"
  >[] = [];

  for (const doc of docs ?? []) {
    const { data: snap } = await db
      .from("snapshots")
      .select("id")
      .eq("document_id", doc.id)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!snap) continue;

    const { data: clauses } = await db
      .from("clauses")
      .select("clause_hash")
      .eq("snapshot_id", snap.id);
    const hashes = [...new Set((clauses ?? []).map((c) => c.clause_hash))];

    for (let i = 0; i < hashes.length; i += 200) {
      const { data: cls, error: clsError } = await db
        .from("classifications")
        .select("category, severity, confidence_score, admin_approved")
        .in("clause_hash", hashes.slice(i, i + 200));
      if (clsError) throw new Error(clsError.message);
      all.push(...(cls ?? []));
    }
  }

  const score = computeScore(all);
  const { error: updateError } = await db
    .from("services")
    .update({ current_score: score, current_grade: scoreToGrade(score), status: "active" })
    .eq("id", serviceId);
  if (updateError) throw new Error(updateError.message);
  return { score };
}

export async function publishEvent(eventId: string): Promise<void> {
  await requireAdmin();
  const db = createAdminClient();

  const { data: event, error } = await db
    .from("change_events")
    .select("id, status, document_id, documents(service_id)")
    .eq("id", eventId)
    .single();
  if (error || !event) throw new Error("Change event not found");
  if (event.status !== "draft") throw new Error("Only draft events can be published");

  const { error: pubError } = await db
    .from("change_events")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", eventId);
  if (pubError) throw new Error(pubError.message);

  const serviceId = (event.documents as unknown as { service_id: string }).service_id;
  await recomputeServiceGrade(serviceId);

  // Alert dispatch (email/Telegram) is a later phase.
  revalidatePath(`/admin/services/${serviceId}`);
  revalidatePath("/admin");
}

export async function dismissEvent(eventId: string): Promise<void> {
  await requireAdmin();
  const db = createAdminClient();

  const { data: event, error } = await db
    .from("change_events")
    .select("id, document_id, documents(service_id)")
    .eq("id", eventId)
    .single();
  if (error || !event) throw new Error("Change event not found");

  const { error: updateError } = await db
    .from("change_events")
    .update({ status: "dismissed" })
    .eq("id", eventId);
  if (updateError) throw new Error(updateError.message);

  const serviceId = (event.documents as unknown as { service_id: string }).service_id;
  revalidatePath(`/admin/services/${serviceId}`);
}
