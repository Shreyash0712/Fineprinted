import type { SupabaseClient } from "@supabase/supabase-js";
import { BULK_MODEL, groqText } from "../ai/groq";
import { isFlagged, signedPoints, TAXONOMY_VERSION } from "../grading";
import { sha256 } from "../hash";
import { snapshotKey, writeSnapshot } from "../snapshots";
import { createAdminClient } from "../supabase/admin";
import type { Classification, Document, Service } from "../types";
import { classifyClauses, copyClassifications } from "./classify";
import { diffClauses, type ClauseDiff, type OldClause } from "./diff";
import { discoverDocuments } from "./discovery";
import { extractDocument } from "./extract";
import { recomputeServiceGrade } from "./grade";
import { segmentMarkdown } from "./segment";

/**
 * Pipeline orchestrator (spec 3.1). Runs every stage for each document of
 * a service, emitting progress events for the admin run log. Change events
 * publish automatically — there is no review gate — and the run ends by
 * recomputing the service's grade. The static exporter (run right after in
 * the same workflow) then pushes the results to the public site. The
 * remaining quality gate is the confidence threshold: low-confidence
 * classifications never affect grades unless an admin approves them.
 */

export interface PipelineEvent {
  level: "info" | "success" | "warn" | "error";
  step: string;
  message: string;
}

/** Minimal shape read back from change_events.diff (jsonb). */
interface ChangeEventLikeDiff {
  added?: { hash: string }[];
  modified?: { hash: string }[];
}

type Emit = (event: PipelineEvent) => void;

const EXCERPT_CHARS = 500;
const excerpt = (text: string) => text.slice(0, EXCERPT_CHARS);

async function loadPreviousClauses(
  db: SupabaseClient,
  snapshotId: string
): Promise<OldClause[]> {
  const { data, error } = await db
    .from("clauses")
    .select("clause_hash, content, embedding")
    .eq("snapshot_id", snapshotId)
    .order("position");
  if (error) throw new Error(`loading previous clauses failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    clause_hash: row.clause_hash,
    content: row.content,
    // pgvector columns come back as a JSON-style string
    embedding:
      typeof row.embedding === "string" ? JSON.parse(row.embedding) : row.embedding,
  }));
}

function severityScore(
  diff: ClauseDiff,
  classifications: Map<string, Classification>
): number {
  const involved = [...diff.added, ...diff.modified.map((m) => m.clause)]
    .map((clause) => classifications.get(clause.hash))
    .filter((c): c is Classification => !!c);
  return signedPoints(involved);
}

async function summarizeChanges(
  documentType: string,
  isFirstSnapshot: boolean,
  diff: ClauseDiff,
  classifications: Map<string, Classification>
): Promise<string> {
  const flagged = [...diff.added, ...diff.modified.map((m) => m.clause)]
    .map((cl) => ({ cl, c: classifications.get(cl.hash) }))
    .filter((x) => x.c && isFlagged(x.c))
    .slice(0, 15);

  const lines = [
    `Document: ${documentType}`,
    isFirstSnapshot
      ? `First analysis. ${diff.added.length} clauses extracted.`
      : `Changes: ${diff.added.length} added, ${diff.modified.length} modified, ${diff.removed.length} removed clauses.`,
    "",
    "Flagged clauses (stance says whether the clause works against users or protects them):",
    ...flagged.map(
      (x) => `- [${x.c!.category} / ${x.c!.stance}] ${x.c!.plain_english_summary}`
    ),
  ];

  try {
    return await groqText({
      model: BULK_MODEL,
      system:
        "You summarize changes to legal documents for end users. Write 2-4 plain-English sentences describing what changed and what it means for users. No preamble, no markdown, neutral tone. If nothing user-hostile was found, say so.",
      user: lines.join("\n"),
      maxTokens: 300,
      temperature: 0.3,
    });
  } catch {
    // Summary is nice-to-have; never fail the pipeline over it.
    return isFirstSnapshot
      ? `Initial analysis: ${diff.added.length} clauses, ${flagged.length} flagged.`
      : `${diff.added.length} added, ${diff.modified.length} modified, ${diff.removed.length} removed; ${flagged.length} flagged.`;
  }
}

/**
 * Document text is unchanged, but if any of its clauses were classified
 * under an older taxonomy version, re-evaluate them and draft a
 * "taxonomy update" change event so the admin can review and publish the
 * corrected grade. Hashes referenced by published change events are swept
 * too (even if the clause has since left the document) so historical
 * point deltas shown on the public site get corrected as well. With no
 * stale rows this stays the $0 skip.
 */
async function reclassifyIfStale(
  db: SupabaseClient,
  document: Document,
  snapshotId: string,
  emit: Emit
): Promise<void> {
  const step = document.type;

  const { data: clauses, error } = await db
    .from("clauses")
    .select("clause_hash, content")
    .eq("snapshot_id", snapshotId)
    .order("position");
  if (error) throw new Error(`clauses lookup failed: ${error.message}`);

  const unique = new Map((clauses ?? []).map((c) => [c.clause_hash, c.content]));
  const currentHashes = new Set(unique.keys());

  // Historical hashes from published events of this document.
  const { data: pastEvents, error: pastError } = await db
    .from("change_events")
    .select("diff")
    .eq("document_id", document.id)
    .eq("status", "published");
  if (pastError) throw new Error(`change_events lookup failed: ${pastError.message}`);
  const historical = new Set<string>();
  for (const event of pastEvents ?? []) {
    const diff = event.diff as ChangeEventLikeDiff | null;
    for (const c of diff?.added ?? []) historical.add(c.hash);
    for (const c of diff?.modified ?? []) historical.add(c.hash);
  }
  for (const hash of unique.keys()) historical.delete(hash);

  const hashes = [...unique.keys(), ...historical];
  const stale = new Set<string>();
  for (let i = 0; i < hashes.length; i += 200) {
    const { data: rows, error: clsError } = await db
      .from("classifications")
      .select("clause_hash, taxonomy_version")
      .in("clause_hash", hashes.slice(i, i + 200));
    if (clsError) throw new Error(`classifications lookup failed: ${clsError.message}`);
    for (const row of rows ?? []) {
      if ((row.taxonomy_version ?? 1) < TAXONOMY_VERSION) stale.add(row.clause_hash);
    }
  }

  if (stale.size === 0) {
    emit({ level: "success", step, message: "Content hash unchanged — skipping ($0)" });
    return;
  }

  // Clause hashes are content-addressed, so any clauses row with the hash
  // (from any snapshot) carries the text for historical ones.
  const missingContent = [...stale].filter((h) => !unique.has(h));
  for (let i = 0; i < missingContent.length; i += 100) {
    const { data: rows, error: contentError } = await db
      .from("clauses")
      .select("clause_hash, content")
      .in("clause_hash", missingContent.slice(i, i + 100));
    if (contentError) throw new Error(`historical clause lookup failed: ${contentError.message}`);
    for (const row of rows ?? []) {
      if (!unique.has(row.clause_hash)) unique.set(row.clause_hash, row.content);
    }
  }
  // Hashes whose text is gone entirely can't be re-evaluated — leave them.
  for (const hash of [...stale]) {
    if (!unique.has(hash)) stale.delete(hash);
  }
  if (stale.size === 0) {
    emit({ level: "success", step, message: "Content hash unchanged — skipping ($0)" });
    return;
  }

  emit({
    level: "info",
    step,
    message: `Content unchanged, but ${stale.size} clause(s) were classified under an older taxonomy — re-evaluating`,
  });

  const toClassify = [...stale].map((hash) => ({ hash, content: unique.get(hash) ?? "" }));
  const { byHash, llmCalls } = await classifyClauses(db, toClassify, (message) =>
    emit({ level: "info", step, message })
  );

  const reclassified = [...byHash.values()];
  const { error: eventError } = await db.from("change_events").insert({
    document_id: document.id,
    previous_snapshot_id: snapshotId,
    new_snapshot_id: snapshotId,
    severity_score: signedPoints(reclassified),
    ai_summary: `Taxonomy update: ${stale.size} clause(s) re-evaluated under the current scoring rules. The document text did not change.`,
    status: "published",
    published_at: new Date().toISOString(),
    diff: {
      added: [],
      modified: toClassify.map((c) => ({
        hash: c.hash,
        old_hash: c.hash,
        excerpt: excerpt(c.content),
        old_excerpt: excerpt(c.content),
        similarity: 1,
      })),
      removed: [],
      cosmetic_count: 0,
      unchanged_count: [...currentHashes].filter((h) => !stale.has(h)).length,
      llm_calls: llmCalls,
    },
  });
  if (eventError) throw new Error(`change_event insert failed: ${eventError.message}`);

  emit({
    level: "success",
    step,
    message: `Taxonomy-update event published (${stale.size} clauses re-scored)`,
  });
}

async function processDocument(
  db: SupabaseClient,
  service: Service,
  document: Document,
  emit: Emit
): Promise<void> {
  const step = document.type;

  // --- Heal partial runs ---
  // A snapshot with no change_event means an earlier run died mid-way (rate
  // limit, crash) after inserting the snapshot. Without this cleanup a
  // re-run would see a matching content hash and skip as "unchanged" even
  // though nothing was ever classified or reviewed. Deleting it (clauses
  // cascade) lets the re-run redo the work — the classification cache makes
  // the redo nearly free.
  const { data: allSnapshots, error: orphanError } = await db
    .from("snapshots")
    .select("id, change_events!new_snapshot_id(id)")
    .eq("document_id", document.id);
  if (orphanError) throw new Error(`orphan snapshot lookup failed: ${orphanError.message}`);
  const orphanIds = (allSnapshots ?? [])
    .filter((s) => !s.change_events || s.change_events.length === 0)
    .map((s) => s.id);
  if (orphanIds.length > 0) {
    const { error: deleteError } = await db.from("snapshots").delete().in("id", orphanIds);
    if (deleteError) throw new Error(`orphan snapshot cleanup failed: ${deleteError.message}`);
    emit({
      level: "warn",
      step,
      message: `Cleaned up ${orphanIds.length} snapshot(s) from interrupted run(s)`,
    });
  }

  // --- Extraction ---
  emit({ level: "info", step, message: `Extracting ${document.source_urls.join(", ")}` });
  const markdown = await extractDocument(document.source_urls);
  const contentHash = sha256(markdown);
  emit({
    level: "info",
    step,
    message: `Extracted ${markdown.length.toLocaleString()} chars (sha256 ${contentHash.slice(0, 12)}…)`,
  });

  // --- Hash comparison: terminate at $0 if unchanged ---
  const { data: prevSnapshot, error: prevError } = await db
    .from("snapshots")
    .select("id, content_hash")
    .eq("document_id", document.id)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (prevError) throw new Error(`previous snapshot lookup failed: ${prevError.message}`);

  if (prevSnapshot && prevSnapshot.content_hash === contentHash) {
    await reclassifyIfStale(db, document, prevSnapshot.id, emit);
    return;
  }

  // --- Archive snapshot (repo file + DB row) ---
  // The file is committed by the workflow's "commit & push" step alongside
  // the static export, so every fetched version stays retrievable even
  // after its clauses are pruned from the database.
  const storageKey = snapshotKey(service.root_domain, document.type, contentHash);
  await writeSnapshot(storageKey, markdown);
  emit({ level: "info", step, message: `Archived markdown to ${storageKey}` });

  const { data: snapshot, error: snapError } = await db
    .from("snapshots")
    .insert({
      document_id: document.id,
      content_hash: contentHash,
      storage_key: storageKey,
    })
    .select("id")
    .single();
  if (snapError) throw new Error(`snapshot insert failed: ${snapError.message}`);

  // --- Segmentation ---
  const segments = segmentMarkdown(markdown);
  emit({ level: "info", step, message: `Segmented into ${segments.length} clauses` });
  if (segments.length === 0) throw new Error("Segmentation produced zero clauses");

  // --- Embedding & diffing ---
  const oldClauses = prevSnapshot ? await loadPreviousClauses(db, prevSnapshot.id) : [];
  const diff = await diffClauses(segments, oldClauses);
  emit({
    level: "info",
    step,
    message: prevSnapshot
      ? `Diff: ${diff.unchanged.length} unchanged, ${diff.cosmetic.length} cosmetic, ${diff.modified.length} modified, ${diff.added.length} added, ${diff.removed.length} removed`
      : `First snapshot: ${diff.added.length} new clauses embedded`,
  });

  // --- Persist clauses for the new snapshot ---
  const allNew = [...diff.unchanged, ...diff.cosmetic.map((c) => c.clause), ...diff.modified.map((m) => m.clause), ...diff.added];
  allNew.sort((a, b) => a.position - b.position);
  for (let i = 0; i < allNew.length; i += 100) {
    const batch = allNew.slice(i, i + 100).map((c) => ({
      snapshot_id: snapshot.id,
      position: c.position,
      clause_hash: c.hash,
      content: c.content,
      embedding: JSON.stringify(c.embedding),
    }));
    const { error: clauseError } = await db.from("clauses").insert(batch);
    if (clauseError) throw new Error(`clause insert failed: ${clauseError.message}`);
  }

  // --- Classification (cached) ---
  const copied = await copyClassifications(
    db,
    diff.cosmetic.map((c) => ({ newHash: c.clause.hash, oldHash: c.oldHash }))
  );
  if (copied.size > 0) {
    emit({ level: "info", step, message: `Copied ${copied.size} classifications for cosmetic changes ($0)` });
  }

  // Cosmetic clauses whose old classification was stale (older taxonomy)
  // are not copied — classify them fresh alongside the real changes.
  const uncopiedCosmetic = diff.cosmetic
    .filter((c) => !copied.has(c.clause.hash))
    .map((c) => c.clause);
  const toClassify = [
    ...diff.added,
    ...diff.modified.map((m) => m.clause),
    ...uncopiedCosmetic,
  ].map((c) => ({
    hash: c.hash,
    content: c.content,
  }));
  const { byHash, llmCalls } = await classifyClauses(db, toClassify, (message) =>
    emit({ level: "info", step, message })
  );

  const flaggedCount = [...byHash.values()].filter(isFlagged).length;
  emit({
    level: "info",
    step,
    message: `Classification done: ${flaggedCount} flagged clauses, ${llmCalls} LLM calls`,
  });

  // --- Change event (published immediately — no review gate) ---
  const aiSummary = await summarizeChanges(document.type, !prevSnapshot, diff, byHash);
  const { data: event, error: eventError } = await db
    .from("change_events")
    .insert({
      document_id: document.id,
      previous_snapshot_id: prevSnapshot?.id ?? null,
      new_snapshot_id: snapshot.id,
      severity_score: severityScore(diff, byHash),
      ai_summary: aiSummary,
      status: "published",
      published_at: new Date().toISOString(),
      diff: {
        added: diff.added.map((c) => ({ hash: c.hash, excerpt: excerpt(c.content) })),
        modified: diff.modified.map((m) => ({
          hash: m.clause.hash,
          old_hash: m.old.clause_hash,
          excerpt: excerpt(m.clause.content),
          old_excerpt: excerpt(m.old.content),
          similarity: Math.round(m.similarity * 1000) / 1000,
        })),
        removed: diff.removed.map((c) => ({
          hash: c.clause_hash,
          excerpt: excerpt(c.content),
        })),
        cosmetic_count: diff.cosmetic.length,
        unchanged_count: diff.unchanged.length,
        llm_calls: llmCalls,
      },
    })
    .select("id")
    .single();
  if (eventError) throw new Error(`change_event insert failed: ${eventError.message}`);

  emit({
    level: "success",
    step,
    message: `Change event published (${event.id})`,
  });

  // --- Prune superseded clauses ---
  // The new snapshot is now the diff baseline; older snapshots' clauses
  // (with their bulky embeddings) are dead weight in Postgres. Their full
  // markdown lives in the repo archive, and change events carry their own
  // excerpt copies, so nothing user-visible references them.
  const { data: oldSnapshots, error: oldSnapError } = await db
    .from("snapshots")
    .select("id")
    .eq("document_id", document.id)
    .neq("id", snapshot.id);
  if (oldSnapError) throw new Error(`old snapshot lookup failed: ${oldSnapError.message}`);
  const oldIds = (oldSnapshots ?? []).map((s) => s.id);
  if (oldIds.length > 0) {
    const { error: pruneError, count } = await db
      .from("clauses")
      .delete({ count: "exact" })
      .in("snapshot_id", oldIds);
    if (pruneError) throw new Error(`clause pruning failed: ${pruneError.message}`);
    if ((count ?? 0) > 0) {
      emit({
        level: "info",
        step,
        message: `Pruned ${count} clauses from ${oldIds.length} superseded snapshot(s)`,
      });
    }
  }
}

export async function runServicePipeline(serviceId: string, emit: Emit): Promise<void> {
  const db = createAdminClient();

  const { data: service, error: serviceError } = await db
    .from("services")
    .select("*")
    .eq("id", serviceId)
    .single();
  if (serviceError || !service) throw new Error(`Service not found: ${serviceId}`);

  emit({ level: "info", step: "start", message: `Pipeline started for ${service.root_domain}` });

  // --- Discovery (only for document types without manual/known URLs) ---
  const { data: documents, error: docsError } = await db
    .from("documents")
    .select("*")
    .eq("service_id", serviceId);
  if (docsError) throw new Error(`documents lookup failed: ${docsError.message}`);

  let docs = (documents ?? []) as Document[];
  const needsDiscovery = docs.length === 0 || docs.every((d) => d.source_urls.length === 0);

  if (needsDiscovery) {
    emit({ level: "info", step: "discovery", message: `Probing ${service.root_domain} for legal documents…` });
    const discovered = await discoverDocuments(service.root_domain, (message) =>
      emit({ level: "info", step: "discovery", message })
    );
    if (discovered.length === 0) {
      throw new Error(
        "Discovery found no legal documents. Add document URLs manually on the service page."
      );
    }
    for (const { type, url } of discovered) {
      const { error: upsertError } = await db
        .from("documents")
        .upsert(
          { service_id: serviceId, type, source_urls: [url] },
          { onConflict: "service_id,type" }
        );
      if (upsertError) throw new Error(`document upsert failed: ${upsertError.message}`);
    }
    emit({
      level: "success",
      step: "discovery",
      message: `Discovered: ${discovered.map((d) => `${d.type} (${d.url})`).join("; ")}`,
    });
    const { data: refreshed } = await db
      .from("documents")
      .select("*")
      .eq("service_id", serviceId);
    docs = (refreshed ?? []) as Document[];
  }

  // --- Per-document pipeline; one failure doesn't kill the others ---
  let failures = 0;
  for (const document of docs) {
    if (document.source_urls.length === 0) {
      emit({ level: "warn", step: document.type, message: "No source URLs — skipping" });
      continue;
    }
    try {
      await processDocument(db, service, document, emit);
    } catch (err) {
      failures++;
      emit({
        level: "error",
        step: document.type,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (failures === docs.length && docs.length > 0) {
    throw new Error("All documents failed to process");
  }

  // --- Grade update (automatic — there is no manual publish) ---
  const result = await recomputeServiceGrade(db, serviceId);
  if (result) {
    emit({
      level: "success",
      step: "grade",
      message: `Grade updated: ${result.grade} (${result.score}/100)`,
    });
  } else {
    emit({
      level: "warn",
      step: "grade",
      message: "No published documents yet — grade unchanged",
    });
  }

  emit({ level: "success", step: "done", message: "Pipeline finished" });
}
