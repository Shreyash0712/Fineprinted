<div align="center">

# 📜 Fineprinted

### Nobody reads the Terms of Service. So we built something that does.

Fineprinted reads the legal fine print of the apps and sites you use, flags the
clauses that quietly work against you, grades each service **A–F**, and tells you
— in plain English — when the rules change.

[![Live site](https://img.shields.io/badge/live-fineprinted-8b6e44?style=flat-square)](https://github.com/Shreyash0712/Fineprinted)
[![Built with Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-postgres%20%2B%20pgvector-3ecf8e?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)
[![Stars](https://img.shields.io/github/stars/Shreyash0712/Fineprinted?style=flat-square&color=8b6e44)](https://github.com/Shreyash0712/Fineprinted/stargazers)

</div>

---

## The problem

> *"I have read and agree to the Terms and Conditions."*

It's the biggest lie on the internet. Fewer than **1%** of people read terms of
service, and the ones who try would need ~76 working days a year to get through
them all. Companies know this — so the clauses that matter most (giving up your
right to sue, licensing away everything you create, agreeing to rules you'll
never see) hide in documents designed not to be read.

## What Fineprinted does

Think of it as a **nutrition label for legal documents**.

1. 🧷 **It watches the documents.** Each tracked service's Terms of Service and
   Privacy Policy is collected, normalized, and compared against the last
   version — down to the individual clause.
2. 🤖 **AI reads the fine print.** Every clause is classified against a strict
   taxonomy of ~45 user-hostile (and user-friendly) patterns — forced
   arbitration, data sales, AI training on your data, biometric collection,
   dark-pattern cancellations, and more — and explained in plain English.
3. 🅰️ **You get a grade.** Each service earns a letter grade from **A** to **F**,
   with a good/bad "at a glance" summary. Every flag links back to the original
   clause, so you can always check the receipts yourself.

And because terms change quietly, you can **save** a service and see exactly
what changed, when, and what it means for you.

> ⚠️ It's a fully automated AI analysis and can make mistakes — that's why every
> finding shows the original clause text. It's informational, not legal advice.

## How the grades work

Every service starts at **100**. Hostile clauses cost points, genuine
protections earn some back, and a few of the worst practices (forced
arbitration, selling your data) cap the best grade a service can get no matter
what else it does.

| Grade | Score | Meaning |
| :---: | :---: | :--- |
| 🟢 **A** | 90–100 | Respectful terms. Rare. |
| 🟢 **B** | 75–89 | Minor concerns, nothing alarming. |
| 🟡 **C** | 50–74 | Several hostile clauses worth knowing about. |
| 🟠 **D** | 25–49 | The fine print works against you. |
| 🔴 **F** | 0–24 | Read nothing, agree to everything. |

Typical Big-Tech terms land around a **D**; surveillance-heavy services with dark
patterns land in **F**; only genuinely privacy-respecting services reach **A/B**.
👉 The exact categories, point values, and worked examples are in
**[GRADING.md](GRADING.md)**.

## Star history

If this is useful to you, a ⭐ helps a lot!

[![Star History Chart](https://api.star-history.com/svg?repos=Shreyash0712/Fineprinted&type=Date)](https://star-history.com/#Shreyash0712/Fineprinted&Date)

## Built with

Free tiers, all the way down — the whole thing runs at **$0**.

- **[Next.js](https://nextjs.org)** (App Router) on **Vercel** — public site is
  fully static; the admin panel just dispatches work.
- **[Supabase](https://supabase.com)** (Postgres + pgvector) — system of record.
- **GitHub Actions** — runs the AI pipeline (it sleeps through free-tier rate
  limits, which no serverless function could survive) and commits the results.
- **Groq** (`gpt-oss-120b`) for clause classification, **Gemini** for embeddings.

Curious how it all fits together? See **[ARCHITECTURE.md](ARCHITECTURE.md)**.

## Run it locally

```bash
pnpm install
cp .env.example .env   # fill in Supabase + Groq + Gemini keys, and ADMIN_PASSWORD
pnpm dev               # http://localhost:3000  (runs the pipeline inline in dev)
```

Database: run the SQL in [`supabase/migrations/`](supabase/migrations) in the
Supabase SQL Editor (or `supabase db push`). Full setup notes are in
[ARCHITECTURE.md](ARCHITECTURE.md).

## Documentation

- 📐 **[ARCHITECTURE.md](ARCHITECTURE.md)** — how the system is built: the
  three-tier free-tier design, the pipeline stages, the database, and the
  cost-control tricks.
- 🅰️ **[GRADING.md](GRADING.md)** — the full clause taxonomy, every point value,
  and exactly how a score is calculated (with worked examples).

---

<div align="center">
<sub>Built to make the fine print readable. Not affiliated with any graded service.</sub>
</div>
