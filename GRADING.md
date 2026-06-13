# How Fineprint grades a service

This document explains exactly how a service's letter grade (A–F) is computed
from its legal documents. Every number here is defined in
[`lib/taxonomy.ts`](lib/taxonomy.ts) — the single source of truth — and the
algorithm lives in [`lib/grading.ts`](lib/grading.ts). If you change a value in
`lib/taxonomy.ts`, update this file too.

> **Philosophy: honest and strict.** A perfectly fair service starts at 100.
> Points come off for user-hostile terms and go on for genuine protections.
> A typical ad-supported "Big Tech" ToS (forced arbitration, broad data
> sharing, AI training, terminate-anytime) lands around a **D**; surveillance-
> heavy services that also sell data and use dark patterns land in **F**; only
> genuinely privacy-respecting services (no arbitration, no data sale, you own
> your content, you can delete your data) reach **A/B**.

---

## 1. What the AI decides (and what it doesn't)

For every clause, the LLM answers only two questions:

1. **Category** — the single topic the clause is about (e.g. `DATA_SALE`).
2. **Stance** — whose side it's on:
   - **hostile** — it *imposes* the practice ("we sell your data").
   - **protective** — it *denies/limits* it or grants you a right ("we do **not**
     sell your data", "you can opt out of AI training", "cancel in one click").
   - **neutral** — it merely mentions/defines the topic.

It also returns a plain-English summary and a **confidence** (0–100).

**The model never assigns points or severity.** Those are derived in code from
`(category, stance)`, so a negation like *"we do not sell your data"* can never
be scored as if it were a data sale. A clause only affects the grade if its
confidence is **≥ 70** (or an admin approves it); lower-confidence findings are
still shown, just excluded from the score until reviewed.

---

## 2. The taxonomy (categories, points, severity)

Categories are organised into eight **groups** (thematic domains). Each category
has a **hostile** point value (applied when the stance is hostile, ≤ 0) and a
**protective** value (applied when protective, ≥ 0). Severity is a display
bucket and, for *critical* categories, drives the extra rules in §3.

Magnitude guide: `critical ≈ −12…−15`, `major ≈ −7…−11`, `minor ≈ −3…−6`.

### Legal & Dispute Resolution — group cap −18 / +10
| Category | Severity | Hostile | Protective |
| :-- | :-- | --: | --: |
| `FORCED_ARBITRATION` | **critical** | −12 | +8 |
| `CLASS_ACTION_WAIVER` | major | −8 | +5 |
| `JURY_TRIAL_WAIVER` | minor | −5 | +3 |
| `LIABILITY_LIMITATION` | minor | −6 | +3 |
| `WARRANTY_DISCLAIMER` | minor | −3 | +2 |
| `INDEMNIFICATION` | minor | −6 | +2 |
| `UNFAVORABLE_JURISDICTION` | minor | −5 | +2 |
| `SHORTENED_CLAIM_WINDOW` | minor | −5 | +2 |

### Changes & Notice — group cap −14 / +8
| Category | Severity | Hostile | Protective |
| :-- | :-- | --: | --: |
| `UNILATERAL_CHANGE` | major | −10 | +5 |
| `NOTICE_OF_CHANGE` | minor | 0 | +6 |
| `RETROACTIVE_CHANGES` | minor | −6 | +3 |

### Data Collection & Privacy — group cap −26 / +16
| Category | Severity | Hostile | Protective |
| :-- | :-- | --: | --: |
| `DATA_SALE` | **critical** | −15 | +8 |
| `DATA_SHARING_THIRD_PARTY` | major | −8 | +4 |
| `BIOMETRIC_DATA` | major | −10 | +4 |
| `SENSITIVE_DATA_COLLECTION` | major | −8 | +4 |
| `DATA_DELETION` | major | −8 | +6 |
| `CHILDREN_DATA` | major | −8 | +4 |
| `TRACKING_THIRD_PARTY` | minor | −6 | +3 |
| `DEVICE_FINGERPRINTING` | minor | −6 | +3 |
| `LOCATION_TRACKING` | minor | −6 | +3 |
| `PROFILING` | minor | −6 | +3 |
| `DATA_RETENTION` | minor | −6 | +3 |
| `BREACH_NOTIFICATION` | minor | −5 | +3 |
| `SECURITY_COMMITMENT` | minor | −4 | +4 |
| `DATA_PORTABILITY` | minor | 0 | +4 |

### AI & Automation — group cap −14 / +10
| Category | Severity | Hostile | Protective |
| :-- | :-- | --: | --: |
| `AI_TRAINING` | major | −8 | +8 |
| `AUTOMATED_DECISION_MAKING` | minor | −6 | +3 |
| `AI_MODERATION_NO_APPEAL` | minor | −4 | +2 |

### Content & Intellectual Property — group cap −16 / +8
| Category | Severity | Hostile | Protective |
| :-- | :-- | --: | --: |
| `CONTENT_OWNERSHIP` | major | −10 | +5 |
| `CONTENT_LICENSE_BROAD` | major | −8 | +5 |
| `NAME_LIKENESS_USE` | minor | −5 | +2 |
| `MORAL_RIGHTS_WAIVER` | minor | −4 | +2 |

### Account & Service — group cap −14 / +8
| Category | Severity | Hostile | Protective |
| :-- | :-- | --: | --: |
| `ACCOUNT_TERMINATION` | major | −8 | +5 |
| `CONTENT_LOSS_ON_TERMINATION` | minor | −6 | +3 |
| `SERVICE_DISCONTINUATION` | minor | −4 | +2 |

### Billing & Cancellation — group cap −14 / +6
| Category | Severity | Hostile | Protective |
| :-- | :-- | --: | --: |
| `HARD_TO_CANCEL` | major | −8 | +5 |
| `AUTO_RENEWAL` | minor | −5 | +2 |
| `NO_REFUNDS` | minor | −5 | +2 |
| `UNILATERAL_PRICE_CHANGE` | minor | −5 | +2 |
| `HIDDEN_FEES` | minor | −5 | +2 |

### Transparency & User Rights — group cap −6 / +12
| Category | Severity | Hostile | Protective |
| :-- | :-- | --: | --: |
| `STATUTORY_RIGHTS` | minor | 0 | +5 |
| `GOV_REQUEST_NOTICE` | minor | 0 | +4 |
| `TRANSPARENCY_REPORT` | minor | 0 | +3 |
| `PLAIN_LANGUAGE` | minor | 0 | +2 |

### Catch-all
| Category | Severity | Hostile | Protective |
| :-- | :-- | --: | --: |
| `OTHER` | neutral | 0 | 0 |

> Categories with a `0` hostile value (e.g. `NOTICE_OF_CHANGE`, `DATA_PORTABILITY`,
> and the Transparency group) are inherently protective — they only ever add
> points.

---

## 3. The scoring algorithm

Given every published, in-scope classification for a service:

1. **Start at 100.**
2. **Keep only what counts.** Drop clauses below the confidence threshold
   (unless admin-approved), `OTHER`, and neutral clauses.
3. **One entry per category.** Repeating the same category many times is still
   *one* problem. Among clauses on the same topic, the most impactful wins
   (a hostile clause outweighs a protective one on the same topic).
4. **Combine within each group** to a net contribution:
   - **Critical hostile clauses count in full and bypass the cap.** The worst
     practices (forced arbitration, data sale) are never discounted.
   - **Everything else gets diminishing returns.** Sort the remaining clauses in
     the group by impact and weight them
     **× `[1, 0.6, 0.4, 0.25, 0.15]`** (the 6th+ clause stays at 0.15). The
     single worst issue in a domain counts fully; piling on more of the same
     kind matters less. This weighted sum is then clamped to the group's
     `[negCap, posCap]`.
   - Group contribution = `criticals (full) + clamp(weighted rest)`.
5. **Sum the groups** and add to 100.
6. **Critical grade ceilings.** Count the distinct *critical* hostile categories
   present and cap the maximum score — protections can't buy back an A while you
   strip fundamental rights:

   | Distinct criticals | Max score | Best possible grade |
   | :-- | --: | :-- |
   | 1 | 89 | B |
   | 2 | 74 | C |
   | 3+ | 49 | D |

7. **Clamp to 0–100 and round.**

### Score → grade
| Grade | Score |
| :-- | :-- |
| **A** | 90–100 |
| **B** | 75–89 |
| **C** | 50–74 |
| **D** | 25–49 |
| **F** | 0–24 |

> **Change-event deltas** (the `±N pts` chip on each published change) use a
> simpler measure: the deduped per-category point sum, *without* group weights,
> caps, or ceilings. It's a local indicator of what a change introduced, not the
> absolute score.

---

## 4. Worked examples

### Moderate SaaS → C (50)
Clauses: forced arbitration, class-action waiver, unilateral change, broad data
sharing, third-party tracking, broad content license.

| Group | Working | Net |
| :-- | :-- | --: |
| Legal | arbitration −12 (critical, full) + class waiver −8 | **−20** |
| Changes | unilateral change −10 | **−10** |
| Data | sharing −8 + tracking (−6 × 0.6 = −3.6) | **−12** |
| Content | broad license −8 | **−8** |

Total −50 → **50**. One critical (arbitration) ⇒ ceiling 89 (not binding). **Grade C.**

### Data broker → C (71)
Clauses: sells data, broad sharing, tracking, profiling — but nothing else hostile.

| Group | Working | Net |
| :-- | :-- | --: |
| Data | **data sale −15 (critical, full, bypasses cap)** + clamp(sharing −8 + tracking −6×0.6 + profiling −6×0.4) = −15 + −14 | **−29** |

Total −29 → **71**. Because the data sale bypasses the group cap, selling data
keeps the score out of A/B even when every other term is clean. **Grade C.**

### Typical Big Tech → D (32)
Forced arbitration, class waiver, unilateral change, broad data sharing,
tracking, profiling, AI training, broad license, terminate-anytime (no data sale).
Groups net to roughly Legal −20, Changes −10, Data −14, AI −8, Content −8,
Account −8 ⇒ total −68 → **32**. **Grade D.**

### Surveillance + dark patterns → F (0)
Everything above **plus** data sale, biometrics, no deletion, fingerprinting,
content ownership grab, hard-to-cancel, no refunds, retroactive changes.
Two criticals (arbitration + data sale) ⇒ ceiling 74, but the raw points already
floor it. **Grade F.**

### Privacy-first → A (100)
No arbitration (right to court +8), no data sale (+8), right to delete (+6), no
AI training (+8), you keep your content (+5), statutory rights for all (+5).
All-positive, no criticals ⇒ **100. Grade A.**

| Profile | Grade | Score |
| :-- | :-- | --: |
| Privacy-first | A | 100 |
| Good, minor tracking | A | 96 |
| Middling (arbitration + protections) | B | 84 |
| Data broker | C | 71 |
| Moderate SaaS | C | 50 |
| Typical Big Tech | D | 32 |
| Heavy / kitchen-sink | F | 19 |
| Surveillance + dark patterns | F | 0 |

---

## 5. Tuning

- **Add or reweight a category:** edit `CATEGORY_DEFS` in
  [`lib/taxonomy.ts`](lib/taxonomy.ts). New category keys are plain strings — no
  database migration needed (the `category` column is `text`).
- **Change how harsh grades are:** adjust group `negCap`/`posCap`, the
  `GROUP_WEIGHT_LADDER`, the `CRITICAL_GRADE_CEILINGS`, or the `GRADE_SCALE` —
  all in `lib/taxonomy.ts`.
- **Re-scoring:** point values are applied at grade time, not stored, so
  changing them takes effect on the next pipeline run or static export without
  re-calling the LLM. Changing the **category set** (adding/removing categories,
  or rewording what the model should detect) only affects clauses whose text
  changes next — clear the `classifications` table to force a full re-analysis.
