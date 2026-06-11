# Fineprint

AI-powered Terms of Service monitoring. See [PROJECT_DEFINITION.md](./PROJECT_DEFINITION.md) for the full spec.

## Database setup

Tables live in Supabase (PostgreSQL + pgvector). Run the migrations in
[`supabase/migrations/`](./supabase/migrations) **in filename order** in the
Supabase SQL Editor (or `supabase db push` with the CLI linked).

Copy `.env.example` to `.env` and fill in the keys. `ADMIN_PASSWORD` gates
the admin panel; `GROQ_API_KEY` and `GEMINI_API_KEY` are required by the
pipeline; R2 keys are optional (snapshot markdown archival is skipped with a
warning when unset).

## Public portal

- `/` — searchable grid of tracked services with letter grades, plus the
  request-a-service form (root-domain sanitized; duplicate requests become
  votes, deduped per FingerprintJS visitor id).
- `/s/[domain]` — service detail: grade, flagged clauses in plain English
  with original clause text, tracked documents, and the published change
  history timeline.
- `/saved` — per-browser watchlist (FingerprintJS visitor id, no account):
  saved services with their recent policy changes. Stored in `watches` with
  `channel='web'`.

## Admin panel & pipeline

- `/admin` — request queue (sorted by votes) and tracked services; add a
  service by name + domain.
- `/admin/services/[id]` — per-service control room:
  - **Documents**: leave empty for automatic discovery, or paste URLs
    manually (one per line; multiple URLs merge into one document) when a
    site's structure breaks discovery.
  - **Run pipeline**: discovery → extraction → hash check (unchanged docs
    stop at $0) → segmentation → embedding diff → cached LLM classification.
    Progress streams live over SSE.
  - **Awaiting review**: each run that finds changes creates a *draft*
    change event. Approve low-confidence classifications, then **Publish**
    to update the public grade (or **Dismiss**).

The classification cache (`classifications`, keyed by clause hash) is global:
identical boilerplate across services or versions is never re-classified.

## Architecture notes

- Pipeline stages are plain TypeScript modules in `lib/pipeline/` composed by
  `run.ts` (no LangGraph — the "review pause" is a `draft` row in
  `change_events`, which survives serverless restarts).
- Clause embeddings are Gemini (`gemini-embedding-2`) at 1536 dims to fit
  pgvector's HNSW index limit (the model auto-renormalizes reduced dims).
- LLM calls go to Groq: `openai/gpt-oss-120b` for taxonomy classification
  (low reasoning effort, small max_tokens), `meta-llama/llama-4-scout-17b-16e-instruct`
  for change summaries.
- All AI calls are throttled client-side to provider free-tier limits
  (sliding 60s RPM/TPM windows, 429 retry-after respected), so big first
  runs are slow but never fail on rate limits. Tune via the `GROQ_*`/
  `GEMINI_*` env vars in `.env.example` if you upgrade tiers.

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
