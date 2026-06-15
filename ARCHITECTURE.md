# Architecture

How Fineprinted is built — the system design, the pipeline, the data model, and
the tricks that keep it running entirely on free tiers. For how grades are
*calculated*, see [GRADING.md](GRADING.md).

---

## 1. The big idea: three free tiers, each doing one job

| Tier | Does | Why it's here |
| :--- | :--- | :--- |
| **Vercel (Next.js)** | Serves the fully-static public site and the admin panel. Admin actions only *dispatch* work and return in milliseconds. | Static pages are fast and free; serverless functions are killed at ~300s. |
| **GitHub Actions** | Runs the AI pipeline and commits the results. | The pipeline deliberately **sleeps** through free-tier LLM rate limits, so a first run can take 15–30 min. A serverless function can't wait that long; an Actions runner can. |
| **Supabase (Postgres + pgvector)** | System of record: snapshots, clauses, classifications, change events, requests. | Durable storage + vector search for clause diffing. The public site never reads it. |

The public site **does not touch the database**. The pipeline exports published
data to `data/*.json`, commits it, and that commit triggers a Vercel redeploy.
Browsing the site costs zero database calls.

## 2. The execution split

The single most important design decision. Because the pipeline must sleep
through rate limits, work is split between an instant dispatch (Vercel) and a
long-running job (Actions):

```
Admin clicks "Run pipeline"  ──►  Vercel server action (~200ms)
                                    └─ inserts a pipeline_runs row
                                    └─ dispatches .github/workflows/pipeline.yml

GitHub Actions runner  (no meaningful time limit)
  └─ pnpm pipeline
       segment → embed → diff → classify (LLM)
       → change events publish automatically + grade recomputes  (no review gate)
       → progress streamed to pipeline_runs.events  (admin UI polls it live)
  └─ pnpm export:static
       writes published data to data/*.json and git-commits it

Vercel redeploys on the commit  ──►  public pages rebuild from the JSON
```

There is **no human publish gate**. The UI is upfront that the analysis is fully
automated and that AI can make mistakes. The one automatic quality filter is a
**confidence threshold**: any classification the model isn't confident about
(< 70) is excluded from the grade until an admin approves it.

In **local dev** there's no wall-clock limit, so `pnpm dev` runs the pipeline
inline after the admin action returns — no GitHub token needed.

## 3. Core user flows

1. **Lookup** — search a tracked service to see its grade, an "at a glance"
   good/bad summary, flagged clauses with plain-English explanations and the
   original text, and the change history.
2. **Watch** — save a service (no account; keyed to a FingerprintJS visitor id).
   Saved services surface their recent policy changes.
3. **Request** — ask for a service to be added. Input is sanitized to the root
   domain; duplicate requests become upvotes so admins know what to prioritize.

## 4. The pipeline (`lib/pipeline/`, composed by `run.ts`)

Documents are **admin-pasted** — there is no scraping, fetching, or discovery.
An admin pastes the raw policy text (optionally with a name and reference URL) on
the service page, and the pipeline analyzes exactly that text.

For each document:

1. **Heal partial runs** — a snapshot with no change event means an earlier run
   died mid-way; it's deleted so the re-run redoes the work (the cache makes it
   cheap).
2. **Hash** the pasted text (SHA-256). If it matches the latest snapshot, stop
   here — **$0**, nothing changed.
3. **Snapshot** — archive the markdown to `data/snapshots/<domain>/…` (committed
   by the workflow) and insert a `snapshots` row.
4. **Segment** — split the document into clauses deterministically, each carrying
   its section heading for context.
5. **Embed & diff** — embed each clause (Gemini) and match new clauses to the
   previous snapshot by vector similarity, so only *semantic* changes count
   (reworded ≠ reshuffled). Classifies clauses as added / modified / cosmetic /
   unchanged / removed.
6. **Classify (cached, batched)** — only added/modified clauses hit the LLM, ~4
   per call. Classifications are cached **globally by clause hash**, so identical
   boilerplate across services is never re-analyzed. Cosmetic changes copy the
   old classification for free.
7. **Publish** — write the `change_event` as *published*, recompute the grade
   (see [GRADING.md](GRADING.md)), and prune the superseded snapshot's clauses
   (their bulky embeddings are dead weight once they're no longer the diff
   baseline; the full markdown lives in the repo archive).

A clause is classified once and reused forever by its hash. The taxonomy itself
lives in [`lib/taxonomy.ts`](lib/taxonomy.ts); changing **point values** re-scores
live (points are computed at grade time, not stored), while changing the
**category set** only affects clauses whose text changes next — clear the
`classifications` table for a full re-analysis.

## 5. Data model (Supabase)

| Table | Holds |
| :--- | :--- |
| `services` | `name`, `root_domain`, `current_grade`, `current_score`, `status` |
| `documents` | per service: `name`, `source_url` (reference only), `pasted_content` |
| `snapshots` | one per analyzed version: `content_hash`, `storage_key` |
| `clauses` | per snapshot: `position`, `clause_hash`, `content`, `embedding` (pgvector, 1536d) |
| `classifications` | keyed by `clause_hash`: `category` (text), `stance`, `severity`, `plain_english_summary`, `confidence_score`, `admin_approved` |
| `change_events` | `previous`/`new` snapshot, `severity_score`, `ai_summary`, `diff` (jsonb), `status` |
| `service_requests` | `requested_domain`, `status`, `vote_count`, `fingerprint_id` |
| `pipeline_runs` | live run progress (`events` jsonb) the admin UI polls |

`category` is plain **text** (validated in app code against the taxonomy), not a
Postgres enum — the taxonomy grows often, and an enum would mean a migration
every time. Schema lives in [`supabase/migrations/`](supabase/migrations); run it
in the Supabase SQL Editor or via `supabase db push`.

**Storage stays lean by design:** clauses (and their bulky embeddings) are kept
only for each document's *latest* snapshot — all diffing and exporting need. The
full markdown of every version lives in the repo under
`data/snapshots/<domain>/<name>/<hash>.md`. `scripts/backfill-snapshots.ts`
repairs/migrates that archive idempotently.

## 6. The public portal (fully static)

Public pages read `data/services.json` and `data/services/<domain>.json` at
**build time** — committed by the export workflow — so they never hit the
database. Only user-specific features (requests, watchlist) call Supabase.

- `/` — searchable grid of graded services + the request form.
- `/s/[domain]` — grade hero, "at a glance" good/bad summary, grouped clause
  details with original text, and the published change history.
- `/saved` — per-browser watchlist (FingerprintJS visitor id, no account).

`scripts/export-static.ts` is idempotent: it only rewrites a file when the
meaningful content changed (ignoring timestamps), so an export with nothing new
produces no commit and no redeploy.

## 7. Admin panel

- `/admin` — request queue (sorted by votes), tracked services, and a **Sync
  site data** button that re-dispatches the export if an automatic sync fails.
- `/admin/services/[id]` — per-service control room:
  - **Documents** — paste the raw policy text for each document (name and URL
    optional, for reference). The pipeline analyzes this exact text.
  - **Run pipeline** — dispatches the Actions job; the panel polls
    `pipeline_runs` for live progress and survives refreshes.
  - **Change events** — published run results. The one manual lever left:
    approving a low-confidence classification (excluded from the grade until
    approved) recomputes the grade and re-syncs the site.

## 8. AI & embeddings

- **Embeddings:** Gemini `gemini-embedding-2` at 1536 dims (fits pgvector's HNSW
  index limit; the model auto-renormalizes reduced dims).
- **Classification:** Groq `openai/gpt-oss-120b` — clauses batched ~4 per call to
  amortize the system prompt; malformed batch output falls back to single-clause
  calls. The category reference in the prompt is **generated from
  `lib/taxonomy.ts`**, so it can never drift from the scoring values.
- **Summaries:** Google `gemini-2.5-flash` for change
  summaries (cheap, high-limit).
- **Rate limiting:** every AI call is throttled client-side to provider free-tier
  limits (sliding 60s RPM/TPM windows, `retry-after` respected, per-request abort
  timeout). Big first runs are slow but never fail on rate limits — sleeping is
  free on an Actions runner. Tune via the `GROQ_*` / `GEMINI_*` env vars.

## 9. Cost controls & key challenges

| Challenge | Mitigation |
| :--- | :--- |
| **API cost** | Admin-gated runs throttle volume. Content-hash skip stops unchanged docs at $0. Global clause-hash cache means boilerplate is never re-analyzed. |
| **Diff noise** | Normalizing to markdown + embedding-similarity matching diffs by *meaning*, so formatting churn isn't a "change". |
| **LLM mistakes** | Structured JSON outputs; stance-aware taxonomy (negations can't be misread); low-confidence findings auto-excluded; original clause text linked on every flag. |
| **Daily token caps** | If a huge first run hits a Groq daily-quota 429, just re-run later — cached classifications make the redo nearly free. |
| **Actions minutes** | A heavy first run ≈ 15–20 min; re-runs are minutes (hash skips + cache). A public repo removes the minute cap entirely. |

## 10. Setup checklist

1. **Supabase** — run the migration(s) in [`supabase/migrations/`](supabase/migrations).
2. **`.env`** — copy `.env.example`; fill Supabase keys, `GROQ_API_KEY`,
   `GEMINI_API_KEY`, and `ADMIN_PASSWORD` (gates the admin panel).
3. **Repo secrets** (Settings → Secrets and variables → Actions):
   `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`,
   `GEMINI_API_KEY`.
4. **Vercel env vars** — everything in `.env.example`, including `GITHUB_REPO`
   and `GITHUB_PAT` (a fine-grained token with **Actions read/write** on this
   repo) so admin actions can dispatch the workflow.
5. Local dev needs neither GitHub value: `pnpm dev` runs the pipeline inline.

## 11. Where things live

```
app/                       Next.js App Router (public site + admin panel)
  s/[domain]/              public service detail (static)
  admin/                   admin panel (dynamic, password-gated)
lib/
  taxonomy.ts              ← all clause categories + point values (source of truth)
  grading.ts               the scoring math (consumes taxonomy.ts)
  pipeline/                segment · diff · classify · grade · run (orchestrator)
  ai/                      Groq + Gemini clients, rate limiter
  static-data.ts           reads data/*.json for the public pages
scripts/
  run-pipeline.ts          pipeline entry point (Actions / CLI)
  export-static.ts         DB → data/*.json exporter
  backfill-snapshots.ts    repairs the snapshot archive
data/                      committed static export + snapshot markdown archive
supabase/migrations/       database schema
.github/workflows/         the pipeline runner
```

---

For the clause taxonomy and the exact scoring algorithm, see
**[GRADING.md](GRADING.md)**.
