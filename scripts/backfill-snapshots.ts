import { loadEnv } from "./load-env";

/**
 * Snapshot archive backfill + clause pruning. Idempotent maintenance —
 * normally needed exactly once (when switching the archive from R2 to
 * repo files), and safe to re-run to catch snapshots created by runners
 * still on the old code.
 *
 * For every snapshot, oldest data first:
 * 1. If its markdown isn't archived under data/snapshots/ yet, reconstruct
 *    it from the snapshot's clauses and write the file. Reconstructions
 *    are clearly marked: the original full markdown was never stored, so
 *    the file won't hash back to content_hash. New pipeline runs archive
 *    the exact fetched markdown instead.
 * 2. Point snapshots.storage_key at the repo file.
 * 3. Delete clauses of every non-latest snapshot per document (the diff
 *    baseline only needs the latest; embeddings are the bulk of DB usage).
 *
 * Run with: pnpm exec tsx scripts/backfill-snapshots.ts
 * Then commit the new files under data/snapshots/.
 */
async function main(): Promise<void> {
  loadEnv();
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");
  const { createAdminClient } = await import("../lib/supabase/admin");
  const { snapshotKey, writeSnapshot } = await import("../lib/snapshots");
  // Removed DocumentType

  const db = createAdminClient();

  const { data: services, error: svcError } = await db
    .from("services")
    .select("id, root_domain");
  if (svcError) throw new Error(svcError.message);

  let archived = 0;
  let skippedNoClauses = 0;
  let prunedClauses = 0;

  for (const service of services ?? []) {
    const { data: documents, error: docError } = await db
      .from("documents")
      .select("id, name")
      .eq("service_id", service.id);
    if (docError) throw new Error(docError.message);

    for (const doc of documents ?? []) {
      const { data: snapshots, error: snapError } = await db
        .from("snapshots")
        .select("id, content_hash, storage_key, fetched_at")
        .eq("document_id", doc.id)
        .order("fetched_at", { ascending: false });
      if (snapError) throw new Error(snapError.message);
      if (!snapshots?.length) continue;

      // Never prune the newest snapshot (diff baseline) NOR the snapshot
      // the latest published change event points at (what the public
      // export reads) — they differ when a run died between inserting a
      // snapshot and publishing its event.
      const { data: pub, error: pubError } = await db
        .from("change_events")
        .select("new_snapshot_id")
        .eq("document_id", doc.id)
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pubError) throw new Error(pubError.message);
      const keep = new Set([snapshots[0].id, pub?.new_snapshot_id].filter(Boolean));

      for (const snapshot of snapshots) {
        const key = snapshotKey(
          service.root_domain,
          doc.name || "Document",
          snapshot.content_hash
        );
        const filePath = path.join(process.cwd(), key);

        let exists = false;
        try {
          await fs.access(filePath);
          exists = true;
        } catch {
          /* not archived yet */
        }

        if (!exists) {
          const { data: clauses, error: clauseError } = await db
            .from("clauses")
            .select("content")
            .eq("snapshot_id", snapshot.id)
            .order("position");
          if (clauseError) throw new Error(clauseError.message);

          if (!clauses?.length) {
            // Clauses already gone and no file — nothing left to archive.
            skippedNoClauses++;
            console.log(`- ${key}: no clauses to reconstruct from, skipped`);
            continue;
          }

          const markdown =
            `<!--\n  Reconstructed from segmented clauses; the original full markdown was\n` +
            `  not archived. Original fetch content_hash: ${snapshot.content_hash}\n  (this file will not hash back to it).\n-->\n\n` +
            clauses.map((c) => c.content).join("\n\n");
          await writeSnapshot(key, markdown);
          archived++;
          console.log(`- archived ${key} (${clauses.length} clauses)`);
        }

        if (snapshot.storage_key !== key) {
          const { error: keyError } = await db
            .from("snapshots")
            .update({ storage_key: key })
            .eq("id", snapshot.id);
          if (keyError) throw new Error(keyError.message);
        }
      }

      // Prune clauses of superseded snapshots — only where the markdown is
      // safely archived (or there was nothing to archive anyway).
      const pruneIds = snapshots
        .filter((s) => !keep.has(s.id))
        .map((s) => s.id);
      if (pruneIds.length > 0) {
        const { error: pruneError, count } = await db
          .from("clauses")
          .delete({ count: "exact" })
          .in("snapshot_id", pruneIds);
        if (pruneError) throw new Error(pruneError.message);
        prunedClauses += count ?? 0;
      }
    }
  }

  console.log(
    `\nDone: ${archived} snapshot(s) archived, ${prunedClauses} superseded clauses pruned` +
      (skippedNoClauses > 0 ? `, ${skippedNoClauses} unreconstructable (already pruned earlier)` : "")
  );
  console.log("Commit the files under data/snapshots/ to finish.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
