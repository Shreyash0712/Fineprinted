import type { SupabaseClient } from "@supabase/supabase-js";
import { BULK_MODEL, groqText } from "../ai/groq";
import { SEVERITY_POINTS } from "../grading";
import { sha256 } from "../hash";
import { putSnapshot, r2Configured } from "../r2";
import { createAdminClient } from "../supabase/admin";
import type { Classification, Document, Service } from "../types";
import { classifyClauses, copyClassifications } from "./classify";
import { diffClauses, type ClauseDiff, type OldClause } from "./diff";
import { discoverDocuments } from "./discovery";
import { extractDocument } from "./extract";
import { segmentMarkdown } from "./segment";

/**
 * Pipeline orchestrator (spec 3.1). Runs every stage for each document of a
 * service, emitting progress events for the admin SSE stream. Ends by
 * writing a *draft* change_event per changed document — the "review pause".
 * Publishing (grade update + service activation) is a separate admin action.
 */

export interface PipelineEvent {
  level: "info" | "success" | "warn" | "error";
  step: string;
  message: string;
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
  let score = 0;
  for (const clause of [...diff.added, ...diff.modified.map((m) => m.clause)]) {
    const c = classifications.get(clause.hash);
    if (c && c.category !== "OTHER") score += SEVERITY_POINTS[c.severity];
  }
  return score;
}

async function summarizeChanges(
  documentType: string,
  isFirstSnapshot: boolean,
  diff: ClauseDiff,
  classifications: Map<string, Classification>
): Promise<string> {
  const flagged = [...diff.added, ...diff.modified.map((m) => m.clause)]
    .map((cl) => ({ cl, c: classifications.get(cl.hash) }))
    .filter((x) => x.c && x.c.category !== "OTHER")
    .slice(0, 15);

  const lines = [
    `Document: ${documentType}`,
    isFirstSnapshot
      ? `First analysis. ${diff.added.length} clauses extracted.`
      : `Changes: ${diff.added.length} added, ${diff.modified.length} modified, ${diff.removed.length} removed clauses.`,
    "",
    "Flagged clauses:",
    ...flagged.map(
      (x) => `- [${x.c!.category}] ${x.c!.plain_english_summary}`
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
    emit({ level: "success", step, message: "Content hash unchanged — skipping ($0)" });
    return;
  }

  // --- Store snapshot (R2 + DB) ---
  const storageKey = `snapshots/${service.id}/${document.id}/${contentHash}.md`;
  if (r2Configured()) {
    await putSnapshot(storageKey, markdown);
    emit({ level: "info", step, message: `Archived markdown to R2 (${storageKey})` });
  } else {
    emit({
      level: "warn",
      step,
      message: "R2 not configured — snapshot markdown not archived (clause text is still stored in DB)",
    });
  }

  const { data: snapshot, error: snapError } = await db
    .from("snapshots")
    .insert({
      document_id: document.id,
      content_hash: contentHash,
      storage_key: r2Configured() ? storageKey : `unstored/${contentHash}`,
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
  if (copied > 0) {
    emit({ level: "info", step, message: `Copied ${copied} classifications for cosmetic changes ($0)` });
  }

  const toClassify = [...diff.added, ...diff.modified.map((m) => m.clause)].map((c) => ({
    hash: c.hash,
    content: c.content,
  }));
  const { byHash, llmCalls } = await classifyClauses(db, toClassify, (message) =>
    emit({ level: "info", step, message })
  );

  const flaggedCount = [...byHash.values()].filter((c) => c.category !== "OTHER").length;
  emit({
    level: "info",
    step,
    message: `Classification done: ${flaggedCount} flagged clauses, ${llmCalls} LLM calls`,
  });

  // --- Draft change event (the review pause) ---
  const aiSummary = await summarizeChanges(document.type, !prevSnapshot, diff, byHash);
  const { data: event, error: eventError } = await db
    .from("change_events")
    .insert({
      document_id: document.id,
      previous_snapshot_id: prevSnapshot?.id ?? null,
      new_snapshot_id: snapshot.id,
      severity_score: severityScore(diff, byHash),
      ai_summary: aiSummary,
      status: "draft",
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
    message: `Draft change event created (${event.id}) — awaiting review`,
  });
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
  emit({ level: "success", step: "done", message: "Pipeline finished" });
}
