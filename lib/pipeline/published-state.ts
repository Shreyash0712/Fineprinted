import type { SupabaseClient } from "@supabase/supabase-js";
import type { Classification, Document } from "../types";

/**
 * Loads the *published* state of a service: for each document, the
 * snapshot referenced by its most recent published change event, plus the
 * clauses and classifications of that snapshot.
 *
 * Both the grade recompute (admin publish) and the static exporter read
 * through this, so the public site can never see draft pipeline output —
 * grading from the raw "latest snapshot" would leak unreviewed runs.
 */

export interface PublishedClause {
  hash: string;
  content: string;
  position: number;
}

export interface PublishedDocumentState {
  document: Document;
  snapshot_id: string | null;
  published_at: string | null;
  clauses: PublishedClause[];
  classifications: Map<string, Classification>;
}

export async function loadPublishedState(
  db: SupabaseClient,
  serviceId: string
): Promise<PublishedDocumentState[]> {
  const { data: docs, error } = await db
    .from("documents")
    .select("*")
    .eq("service_id", serviceId);
  if (error) throw new Error(`documents lookup failed: ${error.message}`);

  const out: PublishedDocumentState[] = [];
  for (const doc of (docs ?? []) as Document[]) {
    const { data: event, error: eventError } = await db
      .from("change_events")
      .select("new_snapshot_id, published_at")
      .eq("document_id", doc.id)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (eventError) throw new Error(`change_events lookup failed: ${eventError.message}`);

    if (!event) {
      out.push({
        document: doc,
        snapshot_id: null,
        published_at: null,
        clauses: [],
        classifications: new Map(),
      });
      continue;
    }

    const { data: clauseRows, error: clauseError } = await db
      .from("clauses")
      .select("clause_hash, content, position")
      .eq("snapshot_id", event.new_snapshot_id)
      .order("position");
    if (clauseError) throw new Error(`clauses lookup failed: ${clauseError.message}`);

    const clauses: PublishedClause[] = (clauseRows ?? []).map((c) => ({
      hash: c.clause_hash,
      content: c.content,
      position: c.position,
    }));

    const classifications = new Map<string, Classification>();
    const hashes = [...new Set(clauses.map((c) => c.hash))];
    for (let i = 0; i < hashes.length; i += 200) {
      const { data: rows, error: clsError } = await db
        .from("classifications")
        .select("*")
        .in("clause_hash", hashes.slice(i, i + 200));
      if (clsError) throw new Error(`classifications lookup failed: ${clsError.message}`);
      for (const row of rows ?? []) {
        classifications.set(row.clause_hash, row as Classification);
      }
    }

    out.push({
      document: doc,
      snapshot_id: event.new_snapshot_id,
      published_at: event.published_at,
      clauses,
      classifications,
    });
  }
  return out;
}
