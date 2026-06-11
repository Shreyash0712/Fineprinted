-- =============================================================================
-- Fineprint — initial schema
-- Run this in the Supabase SQL Editor (or via `supabase db push`).
-- =============================================================================

-- pgvector for clause embeddings
create extension if not exists vector;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

create type document_type as enum (
  'terms_of_service',
  'privacy_policy',
  'cookie_policy',
  'acceptable_use',
  'other'
);

-- Clause taxonomy (section 4.1 of the project spec).
-- OTHER captures benign/unmatched clauses so the classification cache also
-- prevents re-sending boilerplate the LLM already deemed harmless.
create type clause_category as enum (
  'FORCED_ARBITRATION',
  'UNILATERAL_CHANGE',
  'DATA_SALE',
  'CONTENT_LICENSE_BROAD',
  'ACCOUNT_TERMINATION',
  'TRACKING_THIRD_PARTY',
  'NOTICE_OF_CHANGE',
  'OTHER'
);

create type clause_severity as enum (
  'critical',   -- -30 pts
  'major',      -- -15 pts
  'minor',      --  -5 pts
  'positive',   --  +5 pts
  'neutral'     --   0 pts
);

create type service_status as enum (
  'pending',    -- created from an approved request, pipeline not yet published
  'active',     -- publicly visible
  'archived'
);

create type request_status as enum (
  'pending',    -- waiting in the admin queue
  'approved',   -- admin accepted, pipeline queued
  'in_progress',
  'completed',
  'rejected'
);

create type change_event_status as enum (
  'draft',      -- pipeline output awaiting admin review (graph paused)
  'published',  -- admin signed off; grades updated, alerts dispatched
  'dismissed'
);

create type watch_channel as enum ('email', 'telegram');

-- -----------------------------------------------------------------------------
-- updated_at helper
-- -----------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- services
-- -----------------------------------------------------------------------------

create table services (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  root_domain   text not null unique,
  status        service_status not null default 'pending',
  current_score integer check (current_score between 0 and 100),
  current_grade text check (current_grade in ('A', 'B', 'C', 'D', 'F')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger services_updated_at
  before update on services
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- documents — one row per legal document tracked for a service
-- -----------------------------------------------------------------------------

create table documents (
  id          uuid primary key default gen_random_uuid(),
  service_id  uuid not null references services (id) on delete cascade,
  type        document_type not null,
  -- All URLs merged into this document. Usually one; admins can force-merge
  -- multi-page documents (spec section 7, Manual Override).
  source_urls text[] not null default '{}',
  created_at  timestamptz not null default now(),
  unique (service_id, type)
);

create index documents_service_id_idx on documents (service_id);

-- -----------------------------------------------------------------------------
-- snapshots — immutable fetched versions; markdown body lives in R2
-- -----------------------------------------------------------------------------

create table snapshots (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents (id) on delete cascade,
  fetched_at   timestamptz not null default now(),
  content_hash text not null,           -- sha-256 hex of normalized markdown
  storage_key  text not null,           -- Cloudflare R2 object key
  created_at   timestamptz not null default now()
);

create index snapshots_document_id_fetched_at_idx
  on snapshots (document_id, fetched_at desc);
create index snapshots_content_hash_idx on snapshots (content_hash);

-- -----------------------------------------------------------------------------
-- clauses — segmented clauses of a snapshot, embedded for semantic diffing
-- -----------------------------------------------------------------------------

create table clauses (
  id          uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references snapshots (id) on delete cascade,
  position    integer not null,         -- order within the document
  clause_hash text not null,            -- sha-256 hex of normalized clause text
  content     text not null,            -- the clause text itself
  -- gemini-embedding-001 truncated to 1536 dims (Matryoshka) so the column
  -- stays under pgvector's 2000-dim HNSW index limit.
  embedding   vector(1536),
  created_at  timestamptz not null default now(),
  unique (snapshot_id, position)
);

create index clauses_snapshot_id_idx on clauses (snapshot_id);
create index clauses_clause_hash_idx on clauses (clause_hash);
create index clauses_embedding_idx
  on clauses using hnsw (embedding vector_cosine_ops);

-- -----------------------------------------------------------------------------
-- classifications — global LLM-result cache keyed by clause_hash.
-- The same boilerplate clause across services/versions is classified once.
-- -----------------------------------------------------------------------------

create table classifications (
  clause_hash           text primary key,
  category              clause_category not null,
  severity              clause_severity not null,
  plain_english_summary text not null,
  confidence_score      integer not null check (confidence_score between 0 and 100),
  model                 text,            -- which LLM produced this result
  -- confidence < 70 requires manual admin approval before impacting the grade
  -- (spec section 4.2 fallback)
  admin_approved        boolean not null default false,
  created_at            timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- change_events — a detected + analyzed diff between two snapshots
-- -----------------------------------------------------------------------------

create table change_events (
  id                   uuid primary key default gen_random_uuid(),
  document_id          uuid not null references documents (id) on delete cascade,
  -- null for the very first snapshot of a document (initial publish)
  previous_snapshot_id uuid references snapshots (id) on delete set null,
  new_snapshot_id      uuid not null references snapshots (id) on delete cascade,
  severity_score       integer,
  ai_summary           text,
  status               change_event_status not null default 'draft',
  created_at           timestamptz not null default now(),
  published_at         timestamptz
);

create index change_events_document_id_idx on change_events (document_id);
create index change_events_status_idx on change_events (status);

-- -----------------------------------------------------------------------------
-- service_requests — admin-gated queue of user-requested domains
-- -----------------------------------------------------------------------------

create table service_requests (
  id               uuid primary key default gen_random_uuid(),
  requested_domain text not null,       -- sanitized to root domain server-side
  status           request_status not null default 'pending',
  vote_count       integer not null default 0,
  fingerprint_id   text,                -- FingerprintJS visitor id of first requester
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- One open request per domain; once completed/rejected the domain may be
-- requested again (refresh requests).
create unique index service_requests_open_domain_idx
  on service_requests (requested_domain)
  where status in ('pending', 'approved', 'in_progress');
create index service_requests_queue_idx
  on service_requests (status, vote_count desc);

create trigger service_requests_updated_at
  before update on service_requests
  for each row execute function set_updated_at();

-- request_votes — one vote per fingerprint per request (anti-ballot-stuffing)
create table request_votes (
  request_id     uuid not null references service_requests (id) on delete cascade,
  fingerprint_id text not null,
  created_at     timestamptz not null default now(),
  primary key (request_id, fingerprint_id)
);

-- Keep service_requests.vote_count in sync
create or replace function bump_vote_count()
returns trigger
language plpgsql
as $$
begin
  update service_requests
     set vote_count = vote_count + 1
   where id = new.request_id;
  return new;
end;
$$;

create trigger request_votes_bump_count
  after insert on request_votes
  for each row execute function bump_vote_count();

-- -----------------------------------------------------------------------------
-- watches — subscriptions to a service's change events (email / telegram)
-- -----------------------------------------------------------------------------

create table watches (
  id         uuid primary key default gen_random_uuid(),
  service_id uuid not null references services (id) on delete cascade,
  channel    watch_channel not null,
  -- email address or telegram chat id, depending on channel
  target     text not null,
  verified   boolean not null default false,
  created_at timestamptz not null default now(),
  unique (service_id, channel, target)
);

create index watches_service_id_idx on watches (service_id);

-- -----------------------------------------------------------------------------
-- Row Level Security
--
-- All writes (and reads of private tables) go through the Next.js backend
-- using the service-role key, which bypasses RLS. The anon key only gets
-- read access to the published, public-facing tables.
-- -----------------------------------------------------------------------------

alter table services        enable row level security;
alter table documents       enable row level security;
alter table snapshots       enable row level security;
alter table clauses         enable row level security;
alter table classifications enable row level security;
alter table change_events   enable row level security;
alter table service_requests enable row level security;
alter table request_votes   enable row level security;
alter table watches         enable row level security;

create policy "public read active services"
  on services for select
  using (status = 'active');

create policy "public read documents"
  on documents for select
  using (true);

create policy "public read snapshots"
  on snapshots for select
  using (true);

create policy "public read clauses"
  on clauses for select
  using (true);

create policy "public read classifications"
  on classifications for select
  using (true);

create policy "public read published change events"
  on change_events for select
  using (status = 'published');

-- service_requests / request_votes / watches: no anon policies.
-- They contain fingerprints, emails, and chat ids — service-role only.
