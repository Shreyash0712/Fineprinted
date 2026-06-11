# Fineprint — Comprehensive Project Specification

*An always-fresh, AI-powered Terms of Service monitoring platform (Admin-Curated Model)*

---

## 1. Executive Summary

Fineprint monitors the Terms of Service, Privacy Policies, and other legal documents of online services. It detects changes, uses LLMs to analyze clause-level shifts, flags user-hostile terms, and assigns readable grades. 

To maintain strict cost-efficiency and high data quality, the platform operates entirely on an **Admin-Gated Model**. The ecosystem is driven exclusively by user requests, which are queued, rate-limited, and manually approved by an admin before triggering the AI pipeline. This layout prevents runaway API costs, eliminates false-positive diff noise, and ensures every published update is human-verified before reaching users.

---

## 2. Core User Flows

1. **Lookup:** Users search for a tracked service to view its current legal documents, a letter grade (A–F), a list of flagged clauses with plain-English explanations, and version history diffs.
2. **Watch:** Users subscribe to specific services. When an admin approves and publishes a change event, subscribers receive an alert (email/Telegram) summarizing the legal shifts.
3. **Request (Anti-Abuse Gated):** Users request a service to be added or refreshed. The input is strictly sanitized to the root domain. The request enters an admin queue, and duplicate requests act as "upvotes" to help admins prioritize the queue.

---

## 3. System Architecture & Infrastructure

To optimize infrastructure efficiency and keep things lean, the core application operates as a single-server, stateful architecture deployed on a single EC2 instance.

### 3.1 The Pipeline (LangGraph Workflow)
The extraction and analysis pipeline is modeled as a stateful LangGraph workflow executed within the backend handler when an admin clicks "Run":
1. **Discovery:** Heuristic probing of the root domain to locate legal assets.
2. **Extraction & Normalization:** Converts HTML to canonical Markdown.
3. **Hash Comparison:** Generates a SHA-256 hash. If it matches the previous snapshot, the workflow terminates ($0 cost).
4. **Segmentation:** Splits the new document into distinct clauses.
5. **Embedding & Diffing:** Embeds clauses and matches old to new using vector similarity.
6. **Classification (Cached):** Sends *only* modified or new clauses to the LLM. Global caching via `clause_hash` prevents redundant API calls.
7. **Review Pause:** Graph pauses and streams results to the admin dashboard for human sign-off.

---

## 4. The LLM Analysis & Grading Engine

### 4.1 Clause Taxonomy & Severity Mapping
The LLM does not generate freeform text; it classifies clauses against a strict taxonomy.

| Category Tag | Definition | Severity / Impact |
| :--- | :--- | :--- |
| `FORCED_ARBITRATION` | User waives the right to a trial by jury or class action. | **Critical** (-30 pts) |
| `UNILATERAL_CHANGE` | Service can change terms without notifying the user. | **Critical** (-30 pts) |
| `DATA_SALE` | Explicitly sells user data or shares it with brokers. | **Critical** (-30 pts) |
| `CONTENT_LICENSE_BROAD` | Claims a perpetual license to user-generated content. | **Major** (-15 pts) |
| `ACCOUNT_TERMINATION` | Service can terminate the account for any reason. | **Major** (-15 pts) |
| `TRACKING_THIRD_PARTY` | Extensive tracking for targeted advertising. | **Minor** (-5 pts) |
| `NOTICE_OF_CHANGE` | Guarantees a 30+ day notice before terms change. | **Positive** (+5 pts) |

### 4.2 Grading Algorithm
1. **Base Score:** Every service starts at **100 points**.
2. **Deductions:** Apply deductions based on flagged active clauses (capped so positive clauses do not exceed 100).
3. **Conversion:** A (90–100), B (75–89), C (50–74), D (25–49), F (< 25).
*(Fallback: Any clause with an LLM `confidence_score` < 70 requires manual admin approval before impacting the grade).*

---

## 5. Technology Stack

* **Frontend, Backend & API:** Next.js (App Router, Server Actions, API Routes) deployed on Vercel
* **AI Orchestration:** LangGraph (managing the stateful pipeline and LLM tool routing)
* **Database & Auth:** PostgreSQL + pgvector (via Supabase)
* **Document Storage:** Cloudflare R2 (for permanent, cheap Markdown snapshot storage)
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
* **Execution & Streaming:** Triggers the AI pipeline, utilizing Server-Sent Events (SSE) to stream live progress from the backend directly to the UI, preventing browser timeouts during long processing jobs.
* **Publishing Gate:** Final approval step to update public grades, commit snapshots, and dispatch alerts to subscribers.

---

## 8. Key Challenges & Mitigations

| Challenge | Mitigation |
| :--- | :--- |
| **API Cost Overruns** | The Admin-Gated request model acts as a physical throttle. Clause hashing ensures the LLM never analyzes the same boilerplate text twice. |
| **Diff Noise (Formatting changes)** | Normalizing to Markdown + embedding similarity matching guarantees we only diff *semantic* changes, not HTML restructuring. |
| **LLM Misclassification** | Structured JSON outputs; required confidence scores; manual admin review gate before any alerts are sent. |
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
* **Precision:** % of AI-flagged clauses that require zero manual editing by the admin before publishing (Target: >90%).
* **Efficiency:** Average API cost to process a new service request (Target: < $0.05).
* **Engagement:** Number of active email/Telegram watches per active user.