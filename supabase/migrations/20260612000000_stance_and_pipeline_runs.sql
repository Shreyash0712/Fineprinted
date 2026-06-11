-- =============================================================================
-- Stance-aware classification + pipeline run tracking
--
-- 1. classifications.stance — fixes the polarity bug where "we do NOT sell
--    your data" was scored like "we sell your data" (-30). The category is
--    the *topic*; the stance says whose side the clause is on. Severity is
--    derived from (category, stance), never from the model.
-- 2. classifications.taxonomy_version — bumping TAXONOMY_VERSION in
--    lib/grading.ts makes old cache rows count as misses, so clauses are
--    re-evaluated under the new rules on the next pipeline run.
-- 3. pipeline_runs — pipeline execution moved off Vercel (which enforces a
--    300s wall clock) to GitHub Actions. The admin UI polls this table for
--    live progress instead of holding an SSE stream open.
-- =============================================================================

create type clause_stance as enum (
  'hostile',     -- imposes the practice on users
  'protective',  -- denies/limits the practice or grants users a right
  'neutral'      -- mentions a topic without imposing or denying anything
);

alter table classifications
  add column stance clause_stance not null default 'hostile',
  add column taxonomy_version integer not null default 1;

-- Backfill stances implied by the v1 severity mapping.
update classifications set stance = 'protective' where category = 'NOTICE_OF_CHANGE';
update classifications set stance = 'neutral' where category = 'OTHER';

-- -----------------------------------------------------------------------------
-- pipeline_runs — one row per pipeline execution (GitHub Actions or local)
-- -----------------------------------------------------------------------------

create type pipeline_run_status as enum ('queued', 'running', 'succeeded', 'failed');

create table pipeline_runs (
  id          uuid primary key default gen_random_uuid(),
  service_id  uuid not null references services (id) on delete cascade,
  status      pipeline_run_status not null default 'queued',
  -- Array of {level, step, message, at} progress events, appended as the run
  -- executes. Small (a few hundred entries max) and admin-only.
  events      jsonb not null default '[]'::jsonb,
  error       text,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);

create index pipeline_runs_service_idx on pipeline_runs (service_id, created_at desc);

-- Service-role only — progress logs are admin-facing.
alter table pipeline_runs enable row level security;
