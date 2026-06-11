"use server";

import { sanitizeToRootDomain } from "@/lib/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChangeEvent, DocumentType, Service } from "@/lib/types";

/**
 * Public server actions. No auth — identity is the FingerprintJS visitor id,
 * validated by shape. Writes use the service-role client because RLS locks
 * service_requests/request_votes/watches away from the anon key entirely.
 */

const FINGERPRINT_RE = /^[a-z0-9]{10,64}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RequestResult {
  ok: boolean;
  message: string;
  href?: string;
}

export async function requestService(
  rawDomain: string,
  rawName: string,
  fingerprint: string
): Promise<RequestResult> {
  const domain = sanitizeToRootDomain(rawDomain);
  if (!domain) {
    return { ok: false, message: "That doesn't look like a valid domain." };
  }
  if (!FINGERPRINT_RE.test(fingerprint)) {
    return { ok: false, message: "Could not verify your browser. Try reloading." };
  }
  const suggestedName =
    rawName
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 80) || null;

  const db = createAdminClient();

  const { data: service } = await db
    .from("services")
    .select("id, status")
    .eq("root_domain", domain)
    .maybeSingle();
  if (service?.status === "active") {
    return { ok: true, message: `${domain} is already tracked.`, href: `/s/${domain}` };
  }

  // Find or create the open request for this domain
  const { data: existing } = await db
    .from("service_requests")
    .select("id")
    .eq("requested_domain", domain)
    .in("status", ["pending", "approved", "in_progress"])
    .maybeSingle();

  let requestId = existing?.id;
  let created = false;
  if (!requestId) {
    const { data: inserted, error } = await db
      .from("service_requests")
      .insert({
        requested_domain: domain,
        suggested_name: suggestedName,
        fingerprint_id: fingerprint,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code !== "23505") {
        return { ok: false, message: "Something went wrong. Try again later." };
      }
      // Lost a race with another submitter — use their request
      const { data: raced } = await db
        .from("service_requests")
        .select("id")
        .eq("requested_domain", domain)
        .in("status", ["pending", "approved", "in_progress"])
        .maybeSingle();
      requestId = raced?.id;
    } else {
      requestId = inserted.id;
      created = true;
    }
  }
  if (!requestId) {
    return { ok: false, message: "Something went wrong. Try again later." };
  }

  // One vote per fingerprint per request (the vote_count trigger handles +1)
  const { error: voteError } = await db
    .from("request_votes")
    .insert({ request_id: requestId, fingerprint_id: fingerprint });
  if (voteError) {
    if (voteError.code === "23505") {
      return {
        ok: true,
        message: `You've already requested ${domain} — it's waiting in the review queue.`,
      };
    }
    return { ok: false, message: "Something went wrong. Try again later." };
  }

  return {
    ok: true,
    message: created
      ? `Request for ${domain} submitted! It'll appear once an admin reviews it.`
      : `Vote added — ${domain} moved up the review queue.`,
  };
}

// ---------------------------------------------------------------------------
// Watchlist ("save" — fingerprint-keyed, channel 'web')
// ---------------------------------------------------------------------------

export async function toggleWatch(
  serviceId: string,
  fingerprint: string
): Promise<{ saved: boolean }> {
  if (!UUID_RE.test(serviceId) || !FINGERPRINT_RE.test(fingerprint)) {
    throw new Error("Invalid input");
  }
  const db = createAdminClient();

  const { data: existing } = await db
    .from("watches")
    .select("id")
    .eq("service_id", serviceId)
    .eq("channel", "web")
    .eq("target", fingerprint)
    .maybeSingle();

  if (existing) {
    await db.from("watches").delete().eq("id", existing.id);
    return { saved: false };
  }

  // Only active services can be saved (also guards junk serviceIds)
  const { data: service } = await db
    .from("services")
    .select("id")
    .eq("id", serviceId)
    .eq("status", "active")
    .maybeSingle();
  if (!service) throw new Error("Service not found");

  const { error } = await db
    .from("watches")
    .insert({ service_id: serviceId, channel: "web", target: fingerprint, verified: true });
  if (error && error.code !== "23505") throw new Error(error.message);
  return { saved: true };
}

export async function getWatchedIds(fingerprint: string): Promise<string[]> {
  if (!FINGERPRINT_RE.test(fingerprint)) return [];
  const db = createAdminClient();
  const { data } = await db
    .from("watches")
    .select("service_id")
    .eq("channel", "web")
    .eq("target", fingerprint);
  return (data ?? []).map((w) => w.service_id);
}

export interface WatchlistEntry {
  service: Service;
  events: (Pick<ChangeEvent, "id" | "ai_summary" | "severity_score" | "published_at"> & {
    document_type: DocumentType;
  })[];
}

export async function getWatchlist(fingerprint: string): Promise<WatchlistEntry[]> {
  if (!FINGERPRINT_RE.test(fingerprint)) return [];
  const db = createAdminClient();

  const { data: watches } = await db
    .from("watches")
    .select("service_id, created_at")
    .eq("channel", "web")
    .eq("target", fingerprint)
    .order("created_at", { ascending: false });
  const serviceIds = (watches ?? []).map((w) => w.service_id);
  if (serviceIds.length === 0) return [];

  const [{ data: services }, { data: events }] = await Promise.all([
    db.from("services").select("*").in("id", serviceIds).eq("status", "active"),
    db
      .from("change_events")
      .select("id, ai_summary, severity_score, published_at, documents!inner(service_id, type)")
      .in("documents.service_id", serviceIds)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(60),
  ]);

  const eventsByService = new Map<string, WatchlistEntry["events"]>();
  for (const row of events ?? []) {
    const doc = row.documents as unknown as { service_id: string; type: DocumentType };
    const list = eventsByService.get(doc.service_id) ?? [];
    if (list.length < 3) {
      list.push({
        id: row.id,
        ai_summary: row.ai_summary,
        severity_score: row.severity_score,
        published_at: row.published_at,
        document_type: doc.type,
      });
    }
    eventsByService.set(doc.service_id, list);
  }

  const serviceById = new Map((services ?? []).map((s) => [s.id, s as Service]));
  return serviceIds
    .filter((id) => serviceById.has(id))
    .map((id) => ({
      service: serviceById.get(id)!,
      events: eventsByService.get(id) ?? [],
    }));
}
