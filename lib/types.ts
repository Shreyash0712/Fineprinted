/**
 * Domain types mirroring the database schema
 * (supabase/migrations/20260611000000_init.sql).
 *
 * Once the Supabase CLI is linked, these can be replaced with generated
 * types: `supabase gen types typescript --linked > lib/database.types.ts`
 */

export type DocumentType =
  | "terms_of_service"
  | "privacy_policy"
  | "cookie_policy"
  | "acceptable_use"
  | "other";

export type ClauseCategory =
  | "FORCED_ARBITRATION"
  | "UNILATERAL_CHANGE"
  | "DATA_SALE"
  | "CONTENT_LICENSE_BROAD"
  | "ACCOUNT_TERMINATION"
  | "TRACKING_THIRD_PARTY"
  | "NOTICE_OF_CHANGE"
  | "OTHER";

export type ClauseSeverity =
  | "critical"
  | "major"
  | "minor"
  | "positive"
  | "neutral";

/**
 * Whose side a clause is on. The category is the *topic* (e.g. DATA_SALE);
 * the stance decides the sign: "we sell your data" is hostile, "we do NOT
 * sell your data" is protective. Severity derives from (category, stance).
 */
export type ClauseStance = "hostile" | "protective" | "neutral";

export type ServiceStatus = "pending" | "active" | "archived";

export type RequestStatus =
  | "pending"
  | "approved"
  | "in_progress"
  | "completed"
  | "rejected";

export type ChangeEventStatus = "draft" | "published" | "dismissed";

export type WatchChannel = "email" | "telegram" | "web";

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface Service {
  id: string;
  name: string;
  root_domain: string;
  status: ServiceStatus;
  current_score: number | null;
  current_grade: Grade | null;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  service_id: string;
  type: DocumentType;
  source_urls: string[];
  created_at: string;
}

export interface Snapshot {
  id: string;
  document_id: string;
  fetched_at: string;
  content_hash: string;
  storage_key: string;
  created_at: string;
}

export interface Clause {
  id: string;
  snapshot_id: string;
  position: number;
  clause_hash: string;
  content: string;
  embedding: number[] | null;
  created_at: string;
}

export interface Classification {
  clause_hash: string;
  category: ClauseCategory;
  stance: ClauseStance;
  severity: ClauseSeverity;
  plain_english_summary: string;
  confidence_score: number;
  /** Rows below grading.TAXONOMY_VERSION are treated as cache misses. */
  taxonomy_version: number;
  model: string | null;
  admin_approved: boolean;
  created_at: string;
}

export interface ChangeEventDiff {
  added: { hash: string; excerpt: string }[];
  modified: {
    hash: string;
    old_hash: string;
    excerpt: string;
    old_excerpt: string;
    similarity: number;
  }[];
  removed: { hash: string; excerpt: string }[];
  cosmetic_count: number;
  unchanged_count: number;
  llm_calls: number;
}

export interface ChangeEvent {
  id: string;
  document_id: string;
  previous_snapshot_id: string | null;
  new_snapshot_id: string;
  severity_score: number | null;
  ai_summary: string | null;
  status: ChangeEventStatus;
  diff: ChangeEventDiff | null;
  created_at: string;
  published_at: string | null;
}

export interface ServiceRequest {
  id: string;
  requested_domain: string;
  suggested_name: string | null;
  status: RequestStatus;
  vote_count: number;
  fingerprint_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Watch {
  id: string;
  service_id: string;
  channel: WatchChannel;
  target: string;
  verified: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Pipeline runs (executed on GitHub Actions, polled by the admin UI)
// ---------------------------------------------------------------------------

export type PipelineRunStatus = "queued" | "running" | "succeeded" | "failed";

export interface PipelineRunEvent {
  level: "info" | "success" | "warn" | "error";
  step: string;
  message: string;
  at: string;
}

export interface PipelineRun {
  id: string;
  service_id: string;
  status: PipelineRunStatus;
  events: PipelineRunEvent[];
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}
