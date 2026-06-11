import type { Classification, ClauseCategory, ClauseSeverity, Grade } from "./types";

/**
 * Grading engine (spec section 4): every service starts at 100 points,
 * flagged clauses apply deductions, positive clauses add points (capped
 * at 100), and the final score converts to a letter grade.
 */

export const SEVERITY_POINTS: Record<ClauseSeverity, number> = {
  critical: -30,
  major: -15,
  minor: -5,
  positive: 5,
  neutral: 0,
};

export const CATEGORY_SEVERITY: Record<ClauseCategory, ClauseSeverity> = {
  FORCED_ARBITRATION: "critical",
  UNILATERAL_CHANGE: "critical",
  DATA_SALE: "critical",
  CONTENT_LICENSE_BROAD: "major",
  ACCOUNT_TERMINATION: "major",
  TRACKING_THIRD_PARTY: "minor",
  NOTICE_OF_CHANGE: "positive",
  OTHER: "neutral",
};

export const CATEGORY_LABELS: Record<ClauseCategory, string> = {
  FORCED_ARBITRATION: "Forced Arbitration",
  UNILATERAL_CHANGE: "Unilateral Changes",
  DATA_SALE: "Data Sale",
  CONTENT_LICENSE_BROAD: "Broad Content License",
  ACCOUNT_TERMINATION: "Arbitrary Account Termination",
  TRACKING_THIRD_PARTY: "Third-Party Tracking",
  NOTICE_OF_CHANGE: "Notice Before Changes",
  OTHER: "Other",
};

/** Below this confidence, a classification needs admin approval to count. */
export const CONFIDENCE_REVIEW_THRESHOLD = 70;

/** A classification only affects the grade if confident or admin-approved. */
export function affectsGrade(
  c: Pick<Classification, "confidence_score" | "admin_approved">
): boolean {
  return c.confidence_score >= CONFIDENCE_REVIEW_THRESHOLD || c.admin_approved;
}

/**
 * Compute the 0–100 score for a set of active clause classifications.
 * Each distinct flagged category counts once — five arbitration clauses
 * are not five times worse than one.
 */
export function computeScore(
  classifications: Pick<
    Classification,
    "category" | "severity" | "confidence_score" | "admin_approved"
  >[]
): number {
  const seen = new Set<ClauseCategory>();
  let score = 100;

  for (const c of classifications) {
    if (!affectsGrade(c)) continue;
    if (c.category === "OTHER" || seen.has(c.category)) continue;
    seen.add(c.category);
    score += SEVERITY_POINTS[c.severity];
  }

  return Math.max(0, Math.min(100, score));
}

export function scoreToGrade(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 50) return "C";
  if (score >= 25) return "D";
  return "F";
}
