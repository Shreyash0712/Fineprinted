import type {
  Classification,
  ClauseCategory,
  ClauseSeverity,
  ClauseStance,
  Grade,
} from "./types";

/**
 * Grading engine (spec section 4): every service starts at 100 points,
 * flagged clauses apply deductions, positive clauses add points (capped
 * at 100), and the final score converts to a letter grade.
 *
 * The category is the clause's *topic*; the stance decides the sign.
 * "We sell your data" (DATA_SALE, hostile) deducts points; "we do NOT
 * sell your data" (DATA_SALE, protective) adds them. Severity is always
 * derived here from (category, stance) — never trusted from the model.
 */

/**
 * Bump when the taxonomy/prompt changes in a way that invalidates cached
 * classifications. Rows with an older version are treated as cache misses
 * and re-evaluated on the next pipeline run.
 *
 * v2: added stance (polarity) — v1 scored protective clauses like
 * "we do not sell your data" as if they imposed the practice.
 */
export const TAXONOMY_VERSION = 2;

export const SEVERITY_POINTS: Record<ClauseSeverity, number> = {
  critical: -30,
  major: -15,
  minor: -5,
  positive: 5,
  neutral: 0,
};

/** Severity when the clause *imposes* the practice (hostile stance). */
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

export function deriveSeverity(
  category: ClauseCategory,
  stance: ClauseStance
): ClauseSeverity {
  if (category === "OTHER" || stance === "neutral") return "neutral";
  // NOTICE_OF_CHANGE is inherently a user protection regardless of phrasing.
  if (stance === "protective" || category === "NOTICE_OF_CHANGE") return "positive";
  return CATEGORY_SEVERITY[category];
}

/** Labels when the clause imposes the practice. */
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

/** Labels when the clause denies the practice or protects the user. */
export const PROTECTIVE_LABELS: Record<ClauseCategory, string> = {
  FORCED_ARBITRATION: "No Forced Arbitration",
  UNILATERAL_CHANGE: "No Silent Rule Changes",
  DATA_SALE: "No Data Sale",
  CONTENT_LICENSE_BROAD: "You Keep Your Content",
  ACCOUNT_TERMINATION: "Fair Account Termination",
  TRACKING_THIRD_PARTY: "Limited Tracking",
  NOTICE_OF_CHANGE: "Notice Before Changes",
  OTHER: "Other",
};

export function classificationLabel(
  c: Pick<Classification, "category" | "severity">
): string {
  return c.severity === "positive"
    ? PROTECTIVE_LABELS[c.category]
    : CATEGORY_LABELS[c.category];
}

/** One-line plain-English takeaways for the "at a glance" summary. */
export const HOSTILE_SUMMARY_LINES: Partial<Record<ClauseCategory, string>> = {
  FORCED_ARBITRATION: "You give up your right to sue or join a class action.",
  UNILATERAL_CHANGE: "The rules can change without telling you.",
  DATA_SALE: "Your personal data can be sold or shared with brokers.",
  CONTENT_LICENSE_BROAD: "They keep a broad license to content you create.",
  ACCOUNT_TERMINATION: "Your account can be closed at any time, for any reason.",
  TRACKING_THIRD_PARTY: "You are tracked for third-party advertising.",
};

export const PROTECTIVE_SUMMARY_LINES: Partial<Record<ClauseCategory, string>> = {
  FORCED_ARBITRATION: "You keep your right to go to court.",
  UNILATERAL_CHANGE: "Terms won't change behind your back.",
  DATA_SALE: "Says it does not sell your personal data.",
  CONTENT_LICENSE_BROAD: "You keep ownership and control of your content.",
  ACCOUNT_TERMINATION: "Fair process before your account is closed.",
  TRACKING_THIRD_PARTY: "Tracking is limited or can be opted out of.",
  NOTICE_OF_CHANGE: "Promises advance notice before terms change.",
};

/** Below this confidence, a classification needs admin approval to count. */
export const CONFIDENCE_REVIEW_THRESHOLD = 70;

/** A classification only affects the grade if confident or admin-approved. */
export function affectsGrade(
  c: Pick<Classification, "confidence_score" | "admin_approved">
): boolean {
  return c.confidence_score >= CONFIDENCE_REVIEW_THRESHOLD || c.admin_approved;
}

/** True for clauses worth showing to users (not OTHER/neutral noise). */
export function isFlagged(
  c: Pick<Classification, "category" | "severity">
): boolean {
  return c.category !== "OTHER" && c.severity !== "neutral";
}

/**
 * Compute the 0–100 score for a set of active clause classifications.
 * Each distinct (category, severity) counts once — five arbitration
 * clauses are not five times worse than one, and a hostile clause and a
 * protective clause on the same topic each count.
 */
export function computeScore(
  classifications: Pick<
    Classification,
    "category" | "severity" | "confidence_score" | "admin_approved"
  >[]
): number {
  let score = 100;
  for (const points of dedupedPoints(classifications)) score += points;
  return Math.max(0, Math.min(100, score));
}

/**
 * Signed point total for a set of classifications with the same
 * (category, severity) dedupe rule as computeScore — used for change-event
 * deltas, where +5/−30 chips must agree with how the grade moves.
 */
export function signedPoints(
  classifications: Pick<
    Classification,
    "category" | "severity" | "confidence_score" | "admin_approved"
  >[]
): number {
  let total = 0;
  for (const points of dedupedPoints(classifications)) total += points;
  return total;
}

function dedupedPoints(
  classifications: Pick<
    Classification,
    "category" | "severity" | "confidence_score" | "admin_approved"
  >[]
): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  for (const c of classifications) {
    if (!affectsGrade(c)) continue;
    if (c.category === "OTHER" || c.severity === "neutral") continue;
    const key = `${c.category}:${c.severity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(SEVERITY_POINTS[c.severity]);
  }
  return out;
}

export function scoreToGrade(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 50) return "C";
  if (score >= 25) return "D";
  return "F";
}
