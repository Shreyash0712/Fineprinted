# ToS Watchdog — Project Specification

*An always-fresh, AI-powered Terms of Service monitoring and analysis platform*

---

## 1. Executive Summary

ToS Watchdog continuously monitors the Terms of Service, Privacy Policies, and other legal documents of online services and applications. It detects when these documents change, analyzes *what* changed at the clause level using LLMs, flags dangerous or user-hostile clauses, assigns each service a readable grade, and alerts subscribers when a service they rely on silently changes its terms.

**The gap it fills:** ToS;DR, the best-known project in this space, is human-curated and perpetually outdated. Open Terms Archive tracks document versions but does not analyze or grade them for end users. No product today combines automated discovery, change detection, clause-level AI analysis, and proactive alerting. Legal documents change constantly and almost nobody reads them — an automated watchdog is both genuinely useful and genuinely missing.

**Target users:** privacy-conscious consumers, journalists and researchers, small businesses evaluating vendors, developers choosing APIs/platforms, and compliance-adjacent teams that cannot afford enterprise legal-monitoring tools.

---

## 2. Product Description

### 2.1 Core user flows

1. **Lookup:** A user searches for a service (e.g., "Dropbox") and sees its current legal documents, a letter grade (A–F), a list of flagged clauses with plain-English explanations, and a full version history with diffs.
2. **Watch:** A user subscribes to services they use. When a watched service changes its terms, they receive an alert (email/Telegram) summarizing what changed and how severe it is.
3. **Submit:** A user requests a service that is not yet tracked by entering its domain or app-store name. The discovery engine attempts to find and ingest its legal documents automatically.
4. **Clip (later phase):** Via a browser extension, a user captures any ToS they encounter — including clickwrap agreements shown only during signup — and adds it to the corpus.

### 2.2 Feature set

- **Automated document discovery** from a bare domain (no sitemap required)
- **Multi-page document assembly** (ToS split across several URLs treated as one canonical document)
- **Mobile app coverage** via official app-store listings (privacy policy URLs are mandatory on both stores)
- **App-store privacy label diffing** (Apple privacy "nutrition labels", Google Data Safety section)
- **Version history** — every snapshot of every document, permanently archived
- **Clause-level semantic diffing** — what actually changed in meaning, not just formatting noise
- **Dangerous-clause classification** with severity scores
- **Service letter grades** (ToS;DR-style, but always current)
- **Alerts**: instant for severe changes, daily/weekly digests for minor ones
- **Public service pages** (SEO surface area: "did X change its terms?" queries)
- **Public API** for researchers and developers
- **Crowdsourced channels**: browser extension clips and forward-an-email ingestion

### 2.3 The clause taxonomy (what gets flagged)

| Category | Examples | Default severity |
|---|---|---|
| Dispute resolution | Forced arbitration, class-action waiver, jury trial waiver | High |
| Unilateral control | Right to change terms without notice, terminate accounts at will | High |
| Data practices | Selling/sharing data, indefinite retention, biometric collection | High |
| AI training rights | License to train models on user content | High |
| Content licensing | Broad/perpetual/transferable license to user content | Medium–High |
| Financial traps | Auto-renewal, no-refund clauses, hidden fees | Medium |
| Jurisdiction & liability | Inconvenient governing law, broad liability waivers | Medium |
| Account & portability | No data export, account deletion restrictions | Medium |
| Positive signals | Clear deletion rights, notice periods for changes, data portability | (improves grade) |

Each detected clause carries: category, severity, the verbatim clause text, a plain-English explanation, and a confidence score. Grades roll up from the weighted set of detected clauses.

---

## 3. System Architecture

### 3.1 High-level pipeline

```
[Scheduler (tiered cron)]
        │
        ▼
[Discovery Engine] ──► finds/refreshes document URLs per service
        │
        ▼
[Fetcher] ──► polite crawling, multi-page assembly, JS-render fallback
        │
        ▼
[Extractor + Normalizer] ──► main-content extraction → canonical Markdown
        │
        ▼
[Change Detector] ──► hash compare vs. last snapshot in object storage
        │  (no change → stop; ~95% of runs end here, costing ~$0)
        ▼
[Clause Segmenter] ──► split into clauses, embed each clause
        │
        ▼
[Semantic Differ] ──► match old↔new clauses by embedding similarity;
        │              output: added / removed / meaning-shifted clauses
        ▼
[LLM Classifier] ──► classify ONLY changed clauses against taxonomy
        │              (results cached by clause hash)
        ▼
[Grader + Rules Engine] ──► recompute grade; severity gates alert type
        │
        ▼
[Notification Fan-out] ──► instant alerts / digests via email & Telegram
```

### 3.2 The Discovery Engine (waterfall of cheap → expensive)

1. **Heuristic URL probing.** HEAD requests against ~15 conventional paths: `/terms`, `/tos`, `/terms-of-service`, `/legal`, `/privacy`, `/privacy-policy`, `/eula`, `/cookie-policy`, `/aup`, `/dpa`, etc. Resolves a large fraction of sites in milliseconds at near-zero cost.
2. **Homepage link extraction.** Fetch the homepage, score all anchors by legal keywords in anchor text and href, and by footer position. Catches unconventional URLs and legal subdomains.
3. **Legal hub crawling.** If a `/legal` or `/policies` index page is found, crawl one level deeper (same-domain, legal-looking links only). This step also detects multi-page documents via table-of-contents / next-page navigation and assembles them into one canonical document.
4. **LLM-assisted link selection.** When candidates are ambiguous (especially non-English sites), a single cheap LLM call picks the legal documents from the link list.
5. **Search-engine fallback.** Brave Search API query (`site:example.com terms`) for the stubborn remainder.

**Content verification gate:** before storing, every page is verified to actually be a legal document (legal-keyword density check, escalating to a cheap LLM check). This prevents diffing marketing pages or 404 pages and is critical for data quality.

**Seed dataset:** Open Terms Archive's public declarations repository (per-service document URLs + CSS selectors, community-maintained) seeds the top several hundred services for free. The discovery engine then only needs to handle the long tail and user submissions.

### 3.3 Mobile and desktop application coverage

- **iOS:** iTunes Search/Lookup API (free, official, keyless) returns each app's mandatory privacy policy URL → feeds the standard website pipeline. Apple privacy nutrition labels are additionally scraped and diffed as structured data.
- **Android:** Google Play public listing pages expose the developer's privacy policy URL and the Data Safety section → same treatment.
- **Desktop software:** (a) most vendors host terms on their website — standard pipeline; (b) browser-extension clipping for installer-only EULAs and clickwrap flows; (c) forward-an-email ingestion — users forward "we've updated our terms" emails, which doubles as a free change-detection signal.

### 3.4 Scheduling tiers

| Tier | Services | Frequency |
|---|---|---|
| Hot | Top ~500 popular services | Daily |
| Warm | Watched by at least one user | Every 2–3 days |
| Cold | Long tail | Monthly |
| On-demand | New user submissions | Immediately |

---

## 4. Technology Stack (all free tiers)

| Layer | Choice | Free-tier rationale |
|---|---|---|
| Web app & dashboard | **Next.js on Vercel** | Generous hobby tier; SSR for SEO-critical public service pages |
| Background jobs & workflows | **Inngest** (or Trigger.dev) | Durable multi-step workflows, cron, retries, fan-out — the backbone — without self-managing queues |
| Database + auth + vectors | **Supabase** (Postgres + pgvector + Auth) | One free service covers relational data, user auth, and clause-embedding similarity search |
| Document snapshots | **Cloudflare R2** | 10 GB free, zero egress fees; legal docs are tiny text files — 10 GB stores millions of versions |
| Embeddings | **Gemini embedding API** (fallback: Cloudflare Workers AI) | Very generous free tier; used for clause matching in semantic diff |
| LLM classification & summaries | **Gemini Flash** (fallback: Groq) | Fast, free at low volume; only changed clauses are ever sent, and results are cached by clause hash |
| JS rendering (last resort) | **Cloudflare Browser Rendering** / self-hosted Playwright | Only triggered when plain fetch returns a near-empty DOM (~10% of legal pages) |
| Search fallback | **Brave Search API** | ~2,000 free queries/month — ample for a last-resort step |
| Email alerts | **Resend** | 3,000 emails/month free; digests batch many changes into one email |
| Chat alerts | **Telegram Bot API** | Entirely free, unlimited |
| Rate limiting & caching | **Upstash Redis** | Free tier suits per-domain politeness limits and hot caches |
| Observability | **Sentry** + **Axiom**/Better Stack | Free error tracking and log retention |
| Analytics | **PostHog** | Free tier far exceeds early-stage needs |

### Why the cost model holds at scale

The pipeline is designed so that the expensive steps run rarely:

- ~95% of crawl runs end at the hash comparison — pure compute, effectively free.
- When a document *does* change, typically only a handful of clauses changed — only those reach the LLM.
- Classifications are cached by clause hash, so identical boilerplate clauses across thousands of services are classified exactly once, ever.
- Storage is text: even full version history is trivially small.

The dominant "cost" is therefore crawl bandwidth and scheduler invocations, both comfortably inside free tiers until the service is large enough to justify monetization (pro alerts, API access, team features).

---

## 5. Data Model (core entities)

- **Service** — name, domain, category, grade, app-store IDs, tier
- **Document** — service_id, type (ToS / privacy / EULA / cookie / DPA / privacy-label), canonical URL(s), discovery method, selector hints
- **Snapshot** — document_id, fetched_at, content hash, R2 object key, render method used
- **Clause** — snapshot_id, position, text, embedding, clause hash
- **Classification** — clause hash (cache key), category, severity, explanation, confidence, model version
- **Change Event** — document_id, from/to snapshot, added/removed/shifted clause sets, computed severity, summary
- **User / Watch / Notification** — subscriptions, channels, digest preferences, delivery log
- **Submission** — user-requested services, discovery status

---

## 6. Key Challenges & Mitigations

| # | Challenge | Mitigation |
|---|---|---|
| 1 | **Discovery accuracy** — finding the right documents from a bare domain | Five-step waterfall (Section 3.2); content-verification gate; Open Terms Archive seed data; user submissions as feedback loop |
| 2 | **Multi-page documents** | Legal-hub crawling + ToC/next-page nav detection; concatenate into one canonical document before hashing |
| 3 | **Diff noise** — sites reformat HTML constantly without changing meaning | Normalize to Markdown; clause-level *semantic* matching via embeddings, not raw text diff; only meaning-level changes surface |
| 4 | **LLM misclassification** — false alarms erode trust | Confidence thresholds; verbatim clause shown alongside every flag; "report incorrect flag" feedback loop; cache invalidation on model/prompt upgrades |
| 5 | **JS-only pages** | Plain fetch first (works ~90% of the time — lawyers like static pages); headless rendering only on near-empty DOM |
| 6 | **Anti-bot measures / blocking** | Polite crawling: low frequency, per-domain rate limits (Upstash), honest user agent, robots.txt respect; email-forward and extension channels as human-sourced fallback |
| 7 | **Legal exposure of the product itself** | Storing/quoting legal documents for analysis is well-trodden ground (ToS;DR, Open Terms Archive precedents); publish methodology; frame analysis as informational, not legal advice; clear disclaimer |
| 8 | **Localization** — non-English documents, region-specific terms | LLM-assisted link selection handles non-English discovery; classification prompts are language-agnostic; store document language; later: per-region document variants |
| 9 | **Clickwrap / login-walled terms** | Browser extension clipping (the only honest solution); email-forward channel |
| 10 | **Free-tier ceilings** | Tiered scheduling caps crawl volume; classification cache caps LLM volume; Telegram (unlimited, free) absorbs alert volume from email; every provider has a drop-in paid upgrade path with no rearchitecting |
| 11 | **Cold-start / content credibility** | Launch with the seeded top ~500 services fully analyzed so day-one visitors see a complete, useful product |

---

## 7. Roadmap

### Phase 1 — MVP (first few weekends)
- Seed 200–500 services from Open Terms Archive declarations
- Discovery steps 1–2 only; no JS rendering
- Weekly crawl tier for everything
- Hash-based change detection + full-document LLM summary of changes (clause-level diffing deferred)
- Email alerts via Resend; simple per-service public pages
- Supabase auth, watch lists

**Ship criterion:** a user can watch Spotify, and when Spotify changes its privacy policy, they get a useful email before any news outlet covers it.

### Phase 2 — The moat
- Clause segmentation, embeddings, semantic diffing
- Full clause taxonomy classification + caching
- Letter grades and flagged-clause UI
- Telegram alerts, daily/weekly digests
- Tiered scheduling; discovery steps 3–5
- App-store ingestion (iOS + Android) and privacy-label diffing

### Phase 3 — Network effects
- Browser extension (clipping + "grade badge" on any site you visit)
- Forward-an-email ingestion
- Public API + RSS feeds per service
- SEO buildout: programmatic pages per service/change event
- Historical analytics: "how has Big Tech's terms hostility trended since 2020?"

### Phase 4 — Sustainability (optional)
- Pro tier: more watches, instant alerts, API quota, team workspaces
- Vendor-evaluation reports for small businesses
- Researcher/journalist data exports

---

## 8. Success Metrics

- **Coverage:** % of user-submitted domains successfully auto-discovered (target: >85%)
- **Freshness:** median time from a real-world ToS change to alert delivery (target: <48h for hot tier)
- **Precision:** % of flagged clauses confirmed correct via user feedback (target: >90%)
- **Engagement:** watches per active user; alert open rate
- **Cost discipline:** $0 infrastructure spend until >5,000 tracked services or >2,000 users

---

## 9. Summary

ToS Watchdog combines a deep, logic-heavy pipeline (discovery waterfall, semantic clause diffing, cached LLM classification, severity-gated alerting) with a real, underserved user need and a cost model engineered to stay at zero on free tiers. The hard problems — discovery without sitemaps, multi-page assembly, diff noise, and app coverage — all have concrete, layered mitigations, and the MVP is shippable in weeks while every later phase stacks on without rework.