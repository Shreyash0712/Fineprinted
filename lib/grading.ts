import {
  BASE_SCORE,
  categoryLabel,
  categoryPoints,
  categorySummary,
  CONFIDENCE_REVIEW_THRESHOLD,
  CRITICAL_GRADE_CEILINGS,
  deriveSeverity,
  getCategoryDef,
  GRADE_SCALE,
  GROUP_DEFS,
  GROUP_WEIGHT_LADDER,
  isCriticalCategory,
  type ClauseGroup,
  type ClauseStance,
} from "./taxonomy";
import type { Classification, Grade } from "./types";

/**
 * Grading engine (spec section 4). All the *values* live in lib/taxonomy.ts;
 * this file is the *math* that combines them. GRADING.md explains it in prose.
 *
 * Pipeline, per service:
 *   1. Start from BASE_SCORE (100).
 *   2. Keep only classifications that affect the grade (confident or approved)
 *      and actually take a side (category ≠ OTHER, stance ≠ neutral).
 *   3. Dedupe by category — five arbitration clauses are one arbitration
 *      problem; a category's most impactful clause wins (hostile beats
 *      protective on the same topic).
 *   4. Combine within each thematic GROUP with diminishing returns (the worst
 *      issue in a domain counts full, extras count for less) and clamp the
 *      group to its cap.
 *   5. Sum the groups → adjust the score.
 *   6. Critical practices (forced arbitration, data sale) cap the *best*
 *      grade achievable, regardless of how many protections offset the points.
 *   7. Clamp to 0–100; convert to a letter.
 *
 * Re-exported from taxonomy for convenience so callers import one module.
 */
export {
  CONFIDENCE_REVIEW_THRESHOLD,
  deriveSeverity,
  getCategoryDef,
  categoryPoints,
  GROUP_DEFS,
};

type Scoreable = Pick<
  Classification,
  "category" | "stance" | "severity" | "confidence_score" | "admin_approved"
>;

/** A classification only affects the grade if confident or admin-approved. */
export function affectsGrade(
  c: Pick<Classification, "confidence_score" | "admin_approved">
): boolean {
  return c.confidence_score >= CONFIDENCE_REVIEW_THRESHOLD || c.admin_approved;
}

/** True for clauses worth showing to users (not OTHER/neutral noise). */
export function isFlagged(c: Pick<Classification, "category" | "severity">): boolean {
  return c.category !== "OTHER" && c.severity !== "neutral";
}

/** Stance of a classification, tolerating older rows that predate the field. */
function stanceOf(c: Pick<Classification, "stance" | "severity">): ClauseStance {
  if (c.stance) return c.stance;
  return c.severity === "positive" ? "protective" : "hostile";
}

/** Card/group title for a classification. */
export function classificationLabel(
  c: Pick<Classification, "category" | "stance" | "severity">
): string {
  return categoryLabel(c.category, stanceOf(c));
}

/** One-line "at a glance" takeaway for a classification. */
export function classificationSummary(
  c: Pick<Classification, "category" | "stance" | "severity">
): string {
  return categorySummary(c.category, stanceOf(c));
}

/** Signed points a single classification is worth (before dedupe/weights). */
export function pointsFor(c: Pick<Classification, "category" | "stance" | "severity">): number {
  return categoryPoints(c.category, stanceOf(c));
}

// ---------------------------------------------------------------------------
// Core combination
// ---------------------------------------------------------------------------

interface CategoryEntry {
  category: string;
  group: ClauseGroup;
  points: number;
}

/**
 * One entry per category, keeping its most impactful clause: among clauses on
 * the same topic, a hostile one outweighs a protective one; ties break to the
 * larger magnitude.
 */
function dedupeByCategory(classifications: Scoreable[]): CategoryEntry[] {
  const best = new Map<string, CategoryEntry>();
  for (const c of classifications) {
    if (!affectsGrade(c)) continue;
    if (c.category === "OTHER" || c.stance === "neutral") continue;
    const points = categoryPoints(c.category, stanceOf(c));
    if (points === 0) continue;
    const prev = best.get(c.category);
    if (!prev || moreImpactful(points, prev.points)) {
      best.set(c.category, {
        category: c.category,
        group: getCategoryDef(c.category).group,
        points,
      });
    }
  }
  return [...best.values()];
}

/** Hostile (negative) beats protective; otherwise the larger magnitude wins. */
function moreImpactful(candidate: number, current: number): boolean {
  if (candidate < 0 || current < 0) return candidate < current; // most negative
  return candidate > current; // both positive → most positive
}

/**
 * Combine a group's clauses into a net contribution:
 *   • Critical hostile clauses (forced arbitration, data sale) count in FULL
 *     and bypass the cap — the worst practices are never discounted, no matter
 *     what else is in the domain.
 *   • Everything else gets diminishing returns (biggest impact at full weight,
 *     each extra clause in the same domain weighted less) and is clamped to the
 *     group's [negCap, posCap].
 */
function groupContribution(entries: CategoryEntry[], group: ClauseGroup): number {
  let criticalSum = 0;
  const rest: number[] = [];
  for (const e of entries) {
    if (e.points < 0 && isCriticalCategory(e.category)) criticalSum += e.points;
    else rest.push(e.points);
  }

  rest.sort((a, b) => Math.abs(b) - Math.abs(a));
  let restSum = 0;
  for (let i = 0; i < rest.length; i++) {
    const weight = GROUP_WEIGHT_LADDER[Math.min(i, GROUP_WEIGHT_LADDER.length - 1)];
    restSum += rest[i] * weight;
  }

  const def = GROUP_DEFS[group];
  const cappedRest = Math.max(def.negCap, Math.min(def.posCap, restSum));
  return criticalSum + cappedRest;
}

export interface ScoreBreakdown {
  score: number;
  grade: Grade;
  /** Net contribution of each group that had any scored clause. */
  groups: { group: ClauseGroup; label: string; points: number }[];
  /** Distinct critical-severity hostile categories present. */
  criticalCount: number;
  /** Grade ceiling those criticals imposed, or 100 if none. */
  ceiling: number;
}

/** Full, inspectable breakdown — used by computeScore and for diagnostics/docs. */
export function scoreBreakdown(classifications: Scoreable[]): ScoreBreakdown {
  const entries = dedupeByCategory(classifications);

  const byGroup = new Map<ClauseGroup, CategoryEntry[]>();
  for (const e of entries) {
    const arr = byGroup.get(e.group) ?? [];
    arr.push(e);
    byGroup.set(e.group, arr);
  }

  const groups: ScoreBreakdown["groups"] = [];
  let delta = 0;
  for (const [group, groupEntries] of byGroup) {
    const contribution = groupContribution(groupEntries, group);
    delta += contribution;
    groups.push({ group, label: GROUP_DEFS[group].label, points: round(contribution) });
  }
  groups.sort((a, b) => GROUP_DEFS[a.group].order - GROUP_DEFS[b.group].order);

  const criticalCount = new Set(
    entries.filter((e) => e.points < 0 && isCriticalCategory(e.category)).map((e) => e.category)
  ).size;

  let ceiling = 100;
  for (const rule of CRITICAL_GRADE_CEILINGS) {
    if (criticalCount >= rule.atLeast) {
      ceiling = rule.maxScore;
      break;
    }
  }

  const score = clamp(Math.min(BASE_SCORE + delta, ceiling));
  return { score, grade: scoreToGrade(score), groups, criticalCount, ceiling };
}

/**
 * The 0–100 score for a set of active clause classifications.
 */
export function computeScore(classifications: Scoreable[]): number {
  return scoreBreakdown(classifications).score;
}

/**
 * Signed point total with dedupe-by-category but WITHOUT group weighting,
 * caps, or ceilings — a local indicator used for change-event deltas, where
 * the ± chip just needs to agree in sign/rough size with the categories a
 * change introduced.
 */
export function signedPoints(classifications: Scoreable[]): number {
  let total = 0;
  for (const entry of dedupeByCategory(classifications)) total += entry.points;
  return Math.round(total);
}

export function scoreToGrade(score: number): Grade {
  for (const band of GRADE_SCALE) {
    if (score >= band.min) return band.grade as Grade;
  }
  return "F";
}

const round = (n: number): number => Math.round(n);
const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
