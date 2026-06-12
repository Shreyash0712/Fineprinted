# Fineprint — Comprehensive Project Specification

*An always-fresh, AI-powered Terms of Service monitoring platform (Admin-Curated Model)*

---

## 1. Executive Summary

Fineprint monitors the Terms of Service, Privacy Policies, and other legal documents of online services. It detects changes, uses LLMs to analyze clause-level shifts, flags user-hostile terms, and assigns readable grades. 

To maintain strict cost-efficiency, the platform operates on an **Admin-Triggered Model**: the ecosystem is driven by user requests, which are queued, rate-limited, and manually approved by an admin before the AI pipeline *runs*. This is purely a cost throttle. Once a run starts, results publish themselves — analysis, grade update, and site sync are fully automatic, with the UI openly disclosing that the analysis is AI-generated and can make mistakes (every flag links to the original clause text; low-confidence findings are excluded from grades automatically).

---

## 2. Core User Flows

1. **Lookup:** Users search for a tracked service to view its current legal documents, a letter grade (A–F), a list of flagged clauses with plain-English explanations, and version history diffs.
2. **Watch:** Users subscribe to specific services. When a pipeline run publishes a change event, subscribers receive an alert (email/Telegram) summarizing the legal shifts.
3. **Request (Anti-Abuse Gated):** Users request a service to be added or refreshed. The input is strictly sanitized to the root domain. The request enters an admin queue, and duplicate requests act as "upvotes" to help admins prioritize the queue.

---

## 3. System Architecture & Infrastructure

The system is split across three free tiers, each doing the only thing it is good at:

* **Vercel (Next.js):** serves the public site (fully static) and the admin panel; admin actions only *dispatch* work and finish in milliseconds.
* **GitHub Actions:** executes the pipeline. Free-tier LLM rate limits force the pipeline to sleep between calls (a first run can take 15–30 minutes), which no serverless wall clock can absorb — an Actions runner sleeps for free. The same job exports published data to `data/*.json` and commits it.
* **Supabase:** system of record (snapshots, clauses, classification cache, change events, requests). The public site does **not** read from it — committed static JSON serves all lookups; the commit itself triggers the Vercel redeploy.

### 3.1 The Pipeline
Executed by `scripts/run-pipeline.ts` on a GitHub Actions runner (dispatched by the admin panel via the GitHub API; run inline only in local dev):
1. **Discovery:** Heuristic probing of the root domain to locate legal assets.
2. **Extraction & Normalization:** Converts HTML to canonical Markdown.
3. **Hash Comparison:** Generates a SHA-256 hash. If it matches the previous snapshot (and no cached classifications are from an older taxonomy), the workflow terminates ($0 cost).
4. **Segmentation:** Splits the new document into distinct clauses.
5. **Embedding & Diffing:** Embeds clauses and matches old to new using vector similarity.
6. **Classification (Cached, Batched):** Sends *only* modified or new clauses to the LLM, ~4 per call. Global caching via `clause_hash` + `taxonomy_version` prevents redundant API calls.
7. **Auto-Publish:** The `change_event` row is written as *published*, the service grade recomputes, and the static export commits the results — no review step. Progress events stream to `pipeline_runs`, which the admin dashboard polls live.

---

## 4. The LLM Analysis & Grading Engine

### 4.1 Clause Taxonomy, Stance & Severity Mapping
The LLM does not generate freeform judgments; per clause it answers two separate questions against a strict taxonomy:

1. **Category** — the *topic* of the clause.
2. **Stance** — whose side the clause is on: `hostile` (imposes the practice), `protective` (denies/limits it or grants the user a right), or `neutral` (mentions the topic without doing either).

Severity is derived in code from `(category, stance)` — never taken from the model. A hostile clause applies the deduction below; a **protective** clause on the same topic earns **+5** (e.g. *"we do **not** sell your personal information"* is `DATA_SALE / protective` = +5, not −30); neutral/OTHER clauses score 0.

| Category Tag | Definition (hostile form) | Hostile Impact |
| :--- | :--- | :--- |
| `FORCED_ARBITRATION` | User waives the right to a trial by jury or class action. | **Critical** (-30 pts) |
| `UNILATERAL_CHANGE` | Service can change terms without notifying the user. | **Critical** (-30 pts) |
| `DATA_SALE` | Explicitly sells user data or shares it with brokers. | **Critical** (-30 pts) |
| `CONTENT_LICENSE_BROAD` | Claims a perpetual license to user-generated content. | **Major** (-15 pts) |
| `ACCOUNT_TERMINATION` | Service can terminate the account for any reason. | **Major** (-15 pts) |
| `TRACKING_THIRD_PARTY` | Extensive tracking for targeted advertising. | **Minor** (-5 pts) |
| `NOTICE_OF_CHANGE` | Guarantees a 30+ day notice before terms change. | **Positive** (+5 pts) |

Cached classifications carry a `taxonomy_version`; bumping the version in `lib/grading.ts` invalidates the cache row-by-row so the next pipeline run re-evaluates affected clauses (and publishes a "taxonomy update" event even when the document text is unchanged).

### 4.2 Grading Algorithm
1. **Base Score:** Every service starts at **100 points**.
2. **Adjustments:** Each distinct `(category, severity)` among active clauses counts **once** (five arbitration clauses ≠ five deductions); the result is clamped to 0–100.
3. **Conversion:** A (90–100), B (75–89), C (50–74), D (25–49), F (< 25).
*(Safety valve: any clause with an LLM `confidence_score` < 70 is excluded from the grade automatically; an admin can opt it back in by approving it.)*

---

## 5. Technology Stack

* **Frontend, Backend & API:** Next.js (App Router, Server Actions, API Routes) deployed on Vercel; public pages are statically generated from repo-committed JSON (`data/`)
* **Pipeline Execution:** GitHub Actions (`.github/workflows/pipeline.yml`) — dispatched by the admin panel, free of serverless time limits, commits the static data export
* **Database & Auth:** PostgreSQL + pgvector (via Supabase)
* **Document Storage:** the repo itself (`data/snapshots/<domain>/<type>/<hash>.md`) — every fetched version is committed by the pipeline workflow; git delta-compresses near-identical revisions, so the archive stays tiny and versioned for free
* **Embeddings:** `google-embedding-2` (for vectorizing segmented document clauses)
* **LLM (Deep Thinking & Classification):** `openai/gpt-oss-120b` (dedicated strictly to complex clause taxonomy classification, severity grading, and high-reasoning tasks)
* **LLM (Bulk Processing & Extraction):** `meta-llama/llama-4-scout-17b-16e-instruct` (leveraged for high-limit, cheap tasks such as initial markdown cleanup, plain-english summarization, and text formatting)
* **Alerting:** Resend (Emails) + Telegram Bot API
* **Client Anti-Abuse:** FingerprintJS

---

## 6. Database Schema

* **`services`**: `id`, `name`, `root_domain`, `current_grade`, `current_score`.
* **`documents`**: `id`, `service_id`, `type` (ToS, Privacy).
* **`snapshots`**: `id`, `document_id`, `fetched_at`, `content_hash`, `storage_key`.
* **`clauses`**: `id`, `snapshot_id`, `position`, `clause_hash`, `embedding`.
* **`classifications`**: `clause_hash` *(PK)*, `category`, `severity`, `plain_english_summary`, `confidence_score`.
* **`change_events`**: `id`, `document_id`, `previous_snapshot_id`, `new_snapshot_id`, `severity_score`, `ai_summary`.
* **`service_requests`**: `id`, `requested_domain`, `status`, `vote_count`, `fingerprint_id`.

---

## 7. Admin Panel Capabilities

The protected dashboard serves as the operational command center:
* **Queue Management:** Sorts incoming `service_requests` by `vote_count` so admins know what to review next.
* **Manual Override:** Allows admins to manually paste multi-page URLs and force a merge, bypassing automated discovery if a site's structure is broken.
* **Execution & Progress:** Triggers the AI pipeline by dispatching the GitHub Actions workflow; the runner appends progress events to `pipeline_runs` and the UI polls them live. The panel survives page refreshes and browser closes — the run continues regardless, then publishes results, recomputes the grade, and syncs the public site on its own.
* **Confidence Overrides:** The one manual lever: low-confidence classifications (excluded from grades automatically) can be approved to count, which recomputes the grade and re-syncs the site. A "Sync site data" button re-dispatches the export if an automatic sync ever fails.

---

## 8. Key Challenges & Mitigations

| Challenge | Mitigation |
| :--- | :--- |
| **API Cost Overruns** | The Admin-Gated request model acts as a physical throttle. Clause hashing ensures the LLM never analyzes the same boilerplate text twice. |
| **Diff Noise (Formatting changes)** | Normalizing to Markdown + embedding similarity matching guarantees we only diff *semantic* changes, not HTML restructuring. |
| **LLM Misclassification** | Structured JSON outputs; stance-aware taxonomy; low-confidence findings auto-excluded from grades; "AI can make mistakes" disclosure with original clause text linked on every flag. |
| **Request Spam** | FingerprintJS prevents ballot-stuffing. Strict domain sanitization prevents users from forcing scans of random subdirectories. |

---

## 9. Roadmap

### Phase 1 — Core Core Architecture & Pipelines
* Deploy the single-server backend and PostgreSQL schema.
* Build the LangGraph discovery, markdown extraction, and clause segmentation pipeline.
* Implement the global `clause_hash` caching layer to skip redundant LLM calls.
* Implement the admin dashboard with SSE progress streaming.

### Phase 2 — Public Portal & Requests
* Launch the public lookup UI showing grades and interactive diff histories.
* Build the request-a-service form secured by FingerprintJS and root-domain sanitization.
* Seed the database with an initial set of highly requested services via manual admin execution.

### Phase 3 — Ecosystem Expansion
* Add email alerts via Resend and real-time chat alerts via the Telegram Bot API.
* Build a browser extension to display the service's grade badge when a user visits a tracked domain.
* Open up public API access for external researchers and developers.

---

## 10. Success Metrics

* **Coverage:** % of requested domains successfully discovered and extracted by the pipeline (Target: >85%).
* **Precision:** % of published AI-flagged clauses that hold up under spot checks (no correction needed after the fact) (Target: >90%).
* **Efficiency:** Average API cost to process a new service request (Target: < $0.05).
* **Engagement:** Number of active email/Telegram watches per active user.