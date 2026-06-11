import { loadEnv } from "./load-env";

/**
 * Static data exporter. Reads the *published* state of every active
 * service from Supabase and writes it to data/services.json plus one
 * data/services/<domain>.json per service. The GitHub Actions workflow
 * commits the result; the commit triggers a Vercel deploy; the public
 * pages read these files at build time. Browsing the site therefore
 * costs zero database calls.
 *
 * Idempotent: running it twice with the same database state produces
 * byte-identical files (generated_at only changes when content changes).
 */
async function main(): Promise<void> {
  loadEnv();
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");
  const { createAdminClient } = await import("../lib/supabase/admin");
  const { loadPublishedState } = await import("../lib/pipeline/published-state");
  const {
    affectsGrade,
    classificationLabel,
    computeScore,
    HOSTILE_SUMMARY_LINES,
    isFlagged,
    PROTECTIVE_SUMMARY_LINES,
    scoreToGrade,
    SEVERITY_POINTS,
    signedPoints,
  } = await import("../lib/grading");
  type ServiceDetail = import("../lib/static-data").ServiceDetail;
  type ServiceIndexEntry = import("../lib/static-data").ServiceIndexEntry;
  type StaticClause = import("../lib/static-data").StaticClause;
  type StaticHistoryEvent = import("../lib/static-data").StaticHistoryEvent;
  type SummaryLine = import("../lib/static-data").SummaryLine;
  type Classification = import("../lib/types").Classification;
  type ChangeEvent = import("../lib/types").ChangeEvent;
  type Service = import("../lib/types").Service;

  const EXCERPT_CHARS = 600;
  const db = createAdminClient();
  const dataDir = path.join(process.cwd(), "data");
  const servicesDir = path.join(dataDir, "services");
  await fs.mkdir(servicesDir, { recursive: true });

  const { data: serviceRows, error } = await db
    .from("services")
    .select("*")
    .eq("status", "active")
    .order("name");
  if (error) throw new Error(`services lookup failed: ${error.message}`);
  const services = (serviceRows ?? []) as Service[];

  const indexEntries: ServiceIndexEntry[] = [];
  let totalFlagged = 0;
  let totalChanges = 0;
  const keepFiles = new Set<string>();

  for (const service of services) {
    const states = await loadPublishedState(db, service.id);
    const published = states.filter((s) => s.snapshot_id !== null);
    if (published.length === 0) {
      console.log(`- ${service.root_domain}: no published documents, skipped`);
      continue;
    }

    // Score from published classifications only — same rule as the
    // publish-time recompute.
    const allClassifications = published.flatMap((s) =>
      s.clauses
        .map((c) => s.classifications.get(c.hash))
        .filter((c): c is Classification => !!c)
    );
    const score = computeScore(allClassifications);
    const grade = scoreToGrade(score);

    // Flagged clause cards (deduped per document by hash).
    const clauses: StaticClause[] = [];
    for (const state of published) {
      const seen = new Set<string>();
      for (const clause of state.clauses) {
        if (seen.has(clause.hash)) continue;
        seen.add(clause.hash);
        const c = state.classifications.get(clause.hash);
        if (!c || !isFlagged(c) || !affectsGrade(c)) continue;
        clauses.push({
          document_type: state.document.type,
          category: c.category,
          stance: c.stance,
          severity: c.severity,
          points: SEVERITY_POINTS[c.severity],
          label: classificationLabel(c),
          summary: c.plain_english_summary,
          excerpt: clause.content.slice(0, EXCERPT_CHARS),
          confidence: c.confidence_score,
        });
      }
    }
    clauses.sort((a, b) => a.points - b.points);
    totalFlagged += clauses.length;

    // At-a-glance lines: one per distinct (category, severity).
    const good: SummaryLine[] = [];
    const bad: SummaryLine[] = [];
    const seenLines = new Set<string>();
    for (const clause of clauses) {
      const key = `${clause.category}:${clause.severity}`;
      if (seenLines.has(key)) continue;
      seenLines.add(key);
      if (clause.points > 0) {
        good.push({
          text: PROTECTIVE_SUMMARY_LINES[clause.category] ?? clause.label,
          points: clause.points,
        });
      } else if (clause.points < 0) {
        bad.push({
          text: HOSTILE_SUMMARY_LINES[clause.category] ?? clause.label,
          points: clause.points,
        });
      }
    }

    // Published change history with points recomputed from the *current*
    // classifications — so a taxonomy fix retroactively corrects the
    // displayed deltas instead of showing stale scores.
    const docIds = published.map((s) => s.document.id);
    const docTypeById = new Map(published.map((s) => [s.document.id, s.document.type]));
    const { data: eventRows, error: eventsError } = await db
      .from("change_events")
      .select("*")
      .in("document_id", docIds)
      .eq("status", "published")
      .order("published_at", { ascending: false });
    if (eventsError) throw new Error(`change_events lookup failed: ${eventsError.message}`);
    const events = (eventRows ?? []) as ChangeEvent[];
    totalChanges += events.length;

    const history: StaticHistoryEvent[] = [];
    for (const event of events.slice(0, 30)) {
      const hashes = [
        ...new Set([
          ...(event.diff?.added ?? []).map((c) => c.hash),
          ...(event.diff?.modified ?? []).map((c) => c.hash),
        ]),
      ];
      const involved: Classification[] = [];
      for (let i = 0; i < hashes.length; i += 200) {
        const { data: rows } = await db
          .from("classifications")
          .select("*")
          .in("clause_hash", hashes.slice(i, i + 200));
        involved.push(...((rows ?? []) as Classification[]));
      }
      history.push({
        id: event.id,
        date: event.published_at ?? event.created_at,
        document_type: docTypeById.get(event.document_id) ?? "other",
        points: signedPoints(involved),
        summary: event.ai_summary,
        added: event.diff?.added.length ?? 0,
        modified: event.diff?.modified.length ?? 0,
        removed: event.diff?.removed.length ?? 0,
      });
    }

    const lastPublishedAt =
      events.length > 0 ? (events[0].published_at ?? events[0].created_at) : null;

    const detail: ServiceDetail = {
      id: service.id,
      name: service.name,
      root_domain: service.root_domain,
      grade,
      score,
      generated_at: new Date().toISOString(),
      last_published_at: lastPublishedAt,
      summary: { good, bad },
      documents: published.map((s) => ({
        type: s.document.type,
        urls: s.document.source_urls,
      })),
      clauses,
      history,
    };

    const fileName = `${service.root_domain}.json`;
    keepFiles.add(fileName);
    await writeIfChanged(fs, path.join(servicesDir, fileName), detail);

    indexEntries.push({
      id: service.id,
      name: service.name,
      root_domain: service.root_domain,
      status: "active",
      current_score: score,
      current_grade: grade,
      created_at: service.created_at,
      updated_at: lastPublishedAt ?? service.updated_at,
    });
    console.log(
      `- ${service.root_domain}: grade ${grade} (${score}), ${clauses.length} flagged, ${history.length} events`
    );
  }

  // Prune files for services that are no longer active/published.
  for (const file of await fs.readdir(servicesDir)) {
    if (file.endsWith(".json") && !keepFiles.has(file)) {
      await fs.rm(path.join(servicesDir, file));
      console.log(`- pruned stale ${file}`);
    }
  }

  await writeIfChanged(fs, path.join(dataDir, "services.json"), {
    generated_at: new Date().toISOString(),
    stats: {
      services: indexEntries.length,
      flagged_clauses: totalFlagged,
      changes_published: totalChanges,
    },
    services: indexEntries,
  });

  console.log(`Exported ${indexEntries.length} service(s) to ${dataDir}`);
}

/**
 * Write JSON only when meaningful content changed, ignoring generated_at —
 * otherwise every export would create a commit (and a Vercel deploy) even
 * when nothing was published.
 */
async function writeIfChanged(
  fs: typeof import("node:fs").promises,
  filePath: string,
  value: unknown
): Promise<void> {
  const next = JSON.stringify(value, null, 2) + "\n";
  try {
    const prev = await fs.readFile(filePath, "utf8");
    const strip = (s: string) => s.replace(/"generated_at": "[^"]*"/, '"generated_at": ""');
    if (strip(prev) === strip(next)) return;
  } catch {
    // missing file — fall through to write
  }
  await fs.writeFile(filePath, next, "utf8");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
