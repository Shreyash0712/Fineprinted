# Fineprint

AI-powered Terms of Service monitoring. See [PROJECT_DEFINITION.md](./PROJECT_DEFINITION.md) for the full spec.

## How it runs in production (free-tier architecture)

The AI pipeline deliberately **sleeps** to stay inside Groq/Gemini free-tier
rate limits, so a first analysis can take 15–30 minutes — far past Vercel's
300s function ceiling. Execution is therefore split:

```
Admin clicks "Run pipeline" (Vercel, ~200ms)
  └─ inserts a pipeline_runs row + dispatches .github/workflows/pipeline.yml
GitHub Actions runner (no meaningful time limit)
  └─ pnpm pipeline → extraction → diff → classification
     → change events publish automatically + grade recomputes (no review step)
     progress is appended to pipeline_runs.events (admin UI polls it)
  └─ pnpm export:static — writes published data to data/*.json and commits it
Vercel redeploys on the commit
  └─ public pages are fully static — browsing costs zero DB calls
```

There is no human publish gate: the UI discloses that the analysis is fully
automated and that AI can make mistakes. The automatic quality filter is the
confidence threshold — low-confidence findings never affect a grade unless an
admin explicitly approves them.

Setup:

1. **Repo secrets** (Settings → Secrets and variables → Actions):
   `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`,
   `GEMINI_API_KEY`.
2. **Vercel env vars**: everything in `.env.example`, including
   `GITHUB_REPO` and `GITHUB_PAT` (fine-grained token with **Actions
   read/write** on this repo) so admin actions can dispatch workflows.
3. Local dev needs neither: without `GITHUB_PAT`, `pnpm dev` runs the
   pipeline inline (the dev server has no wall-clock limit). You can also run
   `pnpm pipeline --service <uuid>` or `pnpm export:static` from a terminal.

Free-tier budget: GitHub Actions gives private repos 2,000 runner-minutes per
month (a heavy first run ≈ 15–20 min; re-runs are minutes thanks to hash
skips and the classification cache). Making the repo public removes the cap
entirely. Groq's free tier also has *daily* token caps — if a huge first run
dies with a quota 429, just re-run later: cached classifications make the
redo nearly free.

## Database setup

Tables live in Supabase (PostgreSQL + pgvector). Run the migrations in
[`supabase/migrations/`](./supabase/migrations) **in filename order** in the
Supabase SQL Editor (or `supabase db push` with the CLI linked).

Copy `.env.example` to `.env` and fill in the keys. `ADMIN_PASSWORD` gates
the admin panel; `GROQ_API_KEY` and `GEMINI_API_KEY` are required by the
pipeline.

The database stays lean by design: clauses (with their embeddings — the bulk
of storage) are kept only for each document's **latest** snapshot, which is
all diffing and exporting need. The full markdown of every version lives in
the repo under `data/snapshots/<domain>/<type>/<hash>.md`, written and
committed by the pipeline. `scripts/backfill-snapshots.ts` migrates/repairs
old data into that layout (idempotent).

## Public portal (fully static)

Public pages read `data/services.json` and `data/services/<domain>.json` at
build time — committed by the export workflow — so they never touch the
database. Only user-specific features (requests, watchlist) hit Supabase.

- `/` — searchable grid of tracked services with letter grades, plus the
  request-a-service form (root-domain sanitized; duplicate requests become
  votes, deduped per FingerprintJS visitor id).
- `/s/[domain]` — service detail: grade hero, an **"At a glance"** good/bad
  summary (one tiny sentence per finding, with its point impact), grouped
  clause details with original text, and the published change history.
- `/saved` — per-browser watchlist (FingerprintJS visitor id, no account):
  saved services with their recent policy changes. Stored in `watches` with
  `channel='web'`.

## Admin panel & pipeline

- `/admin` — request queue (sorted by votes), tracked services, and a
  **Sync site data** button (re-dispatches the static export if an
  automatic one ever fails).
- `/admin/services/[id]` — per-service control room:
  - **Documents**: paste the exact policy URLs — **required**, the pipeline
    never guesses pages on its own (heuristic discovery was removed after it
    scraped look-alikes, e.g. the GitHub *user profile* `/cookie-policy`).
    One per line; multiple URLs merge into one document, in order, for
    policies split across pages. **Suggest URLs** scans the homepage for
    candidates (with page title + extracted size, for review only) and
    **Test fetch** dry-runs the pipeline's exact extraction so you can
    confirm a URL scrapes cleanly before dispatching a run.
  - **Run pipeline**: dispatches the GitHub Actions job — extraction →
    hash check (unchanged docs stop at $0) → segmentation →
    embedding diff → cached LLM classification → **automatic publish,
    grade update, and site sync**. The panel polls `pipeline_runs` for
    live progress and survives page refreshes.
  - **Change events**: published run results. The one manual control left
    is approving a low-confidence classification (excluded from the grade
    until approved); approving recomputes the grade and re-syncs the site.

## Scoring model (stance-aware)

The LLM answers two questions per clause: the **category** (topic — e.g.
DATA_SALE) and the **stance** — whether the clause *imposes* the practice
(hostile), *denies/limits* it or grants a user right (protective), or merely
mentions it (neutral). Points derive from `(category, stance)` in
`lib/grading.ts`, never from the model:

- hostile → the category's deduction (−30 / −15 / −5)
- protective → **+5** ("we do NOT sell your data" is a plus, not a −30)
- neutral / OTHER → 0, not shown

Each distinct `(category, severity)` counts once per service. Classifications
are cached globally by clause hash (`classifications` table) and stamped with
`taxonomy_version` — bumping `TAXONOMY_VERSION` in `lib/grading.ts` makes old
rows count as cache misses, and the next pipeline run re-evaluates them and
publishes a "taxonomy update" change event even if the document didn't change.

## Architecture notes

- Pipeline stages are plain TypeScript modules in `lib/pipeline/` composed by
  `run.ts` (no LangGraph; runs publish their own change events and recompute
  the grade at the end). Entry points: `scripts/run-pipeline.ts` (GitHub
  Actions / CLI) and the dev-only inline fallback in the `triggerPipeline`
  server action.
- Document fetching (`lib/pipeline/extract.ts`) sends realistic
  desktop-Chrome headers (bot UAs get blanket 403s even for public legal
  pages) and retries transient failures. If a site is bot-walled
  (Cloudflare interstitials etc.) or renders only with JavaScript, it
  falls back to real headless Chrome via `playwright-core` — no browser
  download: it launches the system Chrome/Edge, preinstalled on GitHub
  Actions runners and most dev machines (override with
  `FINEPRINT_CHROME_PATH`). On Vercel there is no browser; the admin
  "Test fetch" reports such URLs as unverified instead of failing.
  - The browser path does **not** block image/font/media requests:
    aborting them is a bot signal that bot-walls (e.g. Reddit's "network
    security") use to fail verification and serve a block page instead of
    the document. It then **waits for the page to settle** — bot-check
    interstitials ("Please wait for verification") navigate to the real
    document a second or two later — so it captures the policy, not the
    waiting room. Blocks/interstitials are detected from the page's
    *visible* title and text (never background scripts, which ride along
    on normal pages too).
- Clause embeddings are Gemini (`gemini-embedding-2`) at 1536 dims to fit
  pgvector's HNSW index limit (the model auto-renormalizes reduced dims).
- LLM calls go to Groq: `openai/gpt-oss-120b` for taxonomy classification
  (clauses are batched ~4 per call to halve token overhead; malformed batch
  output falls back to single-clause calls),
  `meta-llama/llama-4-scout-17b-16e-instruct` for change summaries.
- All AI calls are throttled client-side to provider free-tier limits
  (sliding 60s RPM/TPM windows, 429 retry-after respected, 120s per-request
  abort timeout), so big first runs are slow but never fail on rate limits.
  Tune via the `GROQ_*`/`GEMINI_*` env vars in `.env.example` if you upgrade
  tiers — sleeping is harmless on an Actions runner.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
