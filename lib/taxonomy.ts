/**
 * ============================================================================
 * Fineprint — Clause Taxonomy & Scoring Values  (single source of truth)
 * ============================================================================
 *
 * Every number the grade depends on lives in THIS file so it is easy to read,
 * audit, and tune. The math that consumes these values is in lib/grading.ts;
 * the human-readable explanation of how they combine is in GRADING.md (keep
 * all three in sync when you change anything here).
 *
 * The model answers two questions per clause (see lib/pipeline/classify.ts):
 *   • category — the TOPIC (e.g. DATA_SALE)
 *   • stance   — whose side it is on: hostile / protective / neutral
 *
 * Points and severity are derived HERE from (category, stance) — never taken
 * from the model. "We sell your data" (DATA_SALE, hostile) deducts; "we do
 * NOT sell your data" (DATA_SALE, protective) adds. See `categoryPoints`.
 *
 * Changing point VALUES re-scores live (points are computed at grade time, not
 * stored). Changing the CATEGORY SET means already-classified clauses won't be
 * re-examined for the new categories until their text changes — clear the
 * `classifications` table if you want a full re-analysis.
 */

// ----------------------------------------------------------------------------
// Primitive vocabularies (kept here so taxonomy has no imports → no cycles)
// ----------------------------------------------------------------------------

/** Whose side a clause is on. Stance decides the SIGN of the points. */
export type ClauseStance = "hostile" | "protective" | "neutral";

/** Display bucket (colour + badge). Points are per-category, not per-bucket. */
export type ClauseSeverity = "critical" | "major" | "minor" | "positive" | "neutral";

/** Thematic domain a category belongs to. Points combine WITHIN a group. */
export type ClauseGroup =
  | "LEGAL"
  | "CHANGES"
  | "DATA"
  | "AI"
  | "CONTENT"
  | "ACCOUNT"
  | "BILLING"
  | "TRANSPARENCY"
  | "NONE";

/** Base score every service starts from before adjustments. */
export const BASE_SCORE = 100;

/** Below this LLM confidence a classification needs admin approval to count. */
export const CONFIDENCE_REVIEW_THRESHOLD = 70;

// ----------------------------------------------------------------------------
// Score → letter grade
// ----------------------------------------------------------------------------

export const GRADE_SCALE = [
  { grade: "A", min: 90 }, // exemplary — minimal hostile terms, real protections
  { grade: "B", min: 75 }, // good — a few minor issues
  { grade: "C", min: 50 }, // mixed — several issues, some offset by protections
  { grade: "D", min: 25 }, // poor — many hostile terms (typical ad-supported giant)
  { grade: "F", min: 0 }, // egregious — stacks critical, user-hostile practices
] as const;

// ----------------------------------------------------------------------------
// How points combine (see lib/grading.ts for the algorithm)
// ----------------------------------------------------------------------------

/**
 * Diminishing-returns ladder applied WITHIN a group. The single most impactful
 * clause in a domain counts in full; each additional one in the same domain
 * counts for less. (Catching a fifth tracking clause shouldn't sink a score
 * five times over — but a data *sale* on top of tracking still hurts more than
 * tracking alone, because it sorts to the front at full weight.)
 * Indices past the end use the last value.
 */
export const GROUP_WEIGHT_LADDER = [1, 0.6, 0.4, 0.25, 0.15] as const;

export interface GroupDef {
  label: string;
  blurb: string;
  /** Most NEGATIVE a single group can contribute (hard backstop, ≤ 0). */
  negCap: number;
  /** Most POSITIVE a single group can contribute (≥ 0). */
  posCap: number;
  order: number;
}

export const GROUP_DEFS: Record<ClauseGroup, GroupDef> = {
  LEGAL: {
    label: "Legal & Dispute Resolution",
    blurb: "Your right to sue, who bears risk, and where disputes are heard.",
    negCap: -18,
    posCap: 10,
    order: 1,
  },
  CHANGES: {
    label: "Changes & Notice",
    blurb: "Whether the rules can shift under you, and if you're told first.",
    negCap: -14,
    posCap: 8,
    order: 2,
  },
  DATA: {
    label: "Data Collection & Privacy",
    blurb: "What they collect, sell, share, retain — and what you can delete.",
    negCap: -26,
    posCap: 16,
    order: 3,
  },
  AI: {
    label: "AI & Automation",
    blurb: "Training AI on your data and decisions made about you by machines.",
    negCap: -14,
    posCap: 10,
    order: 4,
  },
  CONTENT: {
    label: "Content & Intellectual Property",
    blurb: "What rights they take over the things you create and upload.",
    negCap: -16,
    posCap: 8,
    order: 5,
  },
  ACCOUNT: {
    label: "Account & Service",
    blurb: "How and when they can suspend you, and what happens to your stuff.",
    negCap: -14,
    posCap: 8,
    order: 6,
  },
  BILLING: {
    label: "Billing & Cancellation",
    blurb: "Renewals, refunds, price changes, and how hard it is to leave.",
    negCap: -14,
    posCap: 6,
    order: 7,
  },
  TRANSPARENCY: {
    label: "Transparency & User Rights",
    blurb: "Statutory rights, plain language, and openness about requests.",
    negCap: -6,
    posCap: 12,
    order: 8,
  },
  NONE: {
    label: "Other",
    blurb: "Boilerplate with no user-rights impact.",
    negCap: 0,
    posCap: 0,
    order: 99,
  },
};

/**
 * Distinct CRITICAL-severity hostile categories cap the BEST achievable grade,
 * no matter how many protections offset the points. You cannot earn a top
 * grade while doing fundamentally rights-stripping things.
 *   1 critical  → at most 89 (no A)
 *   2 criticals → at most 74 (no B)
 *   3+          → at most 49 (no C; D at best)
 */
export const CRITICAL_GRADE_CEILINGS = [
  { atLeast: 3, maxScore: 49 },
  { atLeast: 2, maxScore: 74 },
  { atLeast: 1, maxScore: 89 },
] as const;

// ----------------------------------------------------------------------------
// The taxonomy
// ----------------------------------------------------------------------------

export interface CategoryDef {
  group: ClauseGroup;
  /** Display bucket for the HOSTILE form (protective always shows positive). */
  severity: "critical" | "major" | "minor";
  /** Points when the clause IMPOSES the practice (hostile). ≤ 0. */
  hostile: number;
  /** Points when the clause DENIES/LIMITS it or grants a right (protective). ≥ 0. */
  protective: number;
  /** Card title when hostile. */
  hostileLabel: string;
  /** Card title when protective. */
  protectiveLabel: string;
  /** One-line "watch out for" takeaway. */
  hostileSummary: string;
  /** One-line "the good" takeaway. */
  protectiveSummary: string;
  /** Definition shown to the LLM (kept to one tight line). */
  definition: string;
}

/**
 * Severity is editorial, set per category (it drives colour and the critical
 * grade-ceiling), and is broadly consistent with the point magnitude:
 *   critical ≈ −12 to −15   major ≈ −7 to −11   minor ≈ −3 to −6
 *
 * `as const satisfies …` keeps the literal keys (for ClauseCategory) while
 * type-checking every row against CategoryDef.
 */
export const CATEGORY_DEFS = {
  // ── LEGAL & DISPUTE RESOLUTION ────────────────────────────────────────────
  FORCED_ARBITRATION: {
    group: "LEGAL", severity: "critical", hostile: -12, protective: 8,
    hostileLabel: "Forced Arbitration",
    protectiveLabel: "Right to Go to Court",
    hostileSummary: "You give up your right to sue in court over disputes.",
    protectiveSummary: "You keep your right to take disputes to court.",
    definition: "Binding/mandatory arbitration of disputes (waiving courts).",
  },
  CLASS_ACTION_WAIVER: {
    group: "LEGAL", severity: "major", hostile: -8, protective: 5,
    hostileLabel: "Class-Action Waiver",
    protectiveLabel: "Class Actions Allowed",
    hostileSummary: "You can't band together with others in a class action.",
    protectiveSummary: "You may join class actions with other users.",
    definition: "Waiver of the right to bring or join class/collective actions.",
  },
  JURY_TRIAL_WAIVER: {
    group: "LEGAL", severity: "minor", hostile: -5, protective: 3,
    hostileLabel: "Jury-Trial Waiver",
    protectiveLabel: "Jury Trial Preserved",
    hostileSummary: "You waive your right to a jury trial.",
    protectiveSummary: "Your right to a jury trial is preserved.",
    definition: "Waiver of the right to a trial by jury (distinct from arbitration).",
  },
  LIABILITY_LIMITATION: {
    group: "LEGAL", severity: "minor", hostile: -6, protective: 3,
    hostileLabel: "Liability Capped",
    protectiveLabel: "Meaningful Liability",
    hostileSummary: "Their liability to you is capped at almost nothing.",
    protectiveSummary: "They accept meaningful responsibility if they harm you.",
    definition: "Caps damages to a token sum or disclaims liability for harms caused.",
  },
  WARRANTY_DISCLAIMER: {
    group: "LEGAL", severity: "minor", hostile: -3, protective: 2,
    hostileLabel: "No Warranties",
    protectiveLabel: "Service Warranties",
    hostileSummary: "The service is provided 'as is' with no guarantees.",
    protectiveSummary: "They offer real warranties about the service.",
    definition: "Disclaims all warranties; service provided 'as is'/'as available'.",
  },
  INDEMNIFICATION: {
    group: "LEGAL", severity: "minor", hostile: -6, protective: 2,
    hostileLabel: "You Indemnify Them",
    protectiveLabel: "No Broad Indemnity",
    hostileSummary: "You must cover their legal costs if claims arise from your use.",
    protectiveSummary: "You're not forced to cover their legal costs.",
    definition: "User must indemnify/defend the company against third-party claims.",
  },
  UNFAVORABLE_JURISDICTION: {
    group: "LEGAL", severity: "minor", hostile: -5, protective: 2,
    hostileLabel: "Inconvenient Venue",
    protectiveLabel: "Reasonable Venue",
    hostileSummary: "Any lawsuit must happen in their distant home court.",
    protectiveSummary: "Disputes can be heard somewhere reasonable for you.",
    definition: "Mandatory venue/governing law in the company's forum, inconvenient to users.",
  },
  SHORTENED_CLAIM_WINDOW: {
    group: "LEGAL", severity: "minor", hostile: -5, protective: 2,
    hostileLabel: "Short Deadline to Sue",
    protectiveLabel: "Normal Claim Window",
    hostileSummary: "You must bring any claim within a short window or lose it.",
    protectiveSummary: "You get the normal legal time to bring a claim.",
    definition: "Contractually shortens the time to file a claim (e.g. 6–12 months).",
  },

  // ── CHANGES & NOTICE ──────────────────────────────────────────────────────
  UNILATERAL_CHANGE: {
    group: "CHANGES", severity: "major", hostile: -10, protective: 5,
    hostileLabel: "Silent Term Changes",
    protectiveLabel: "Changes Need Consent",
    hostileSummary: "They can change the terms at any time without telling you.",
    protectiveSummary: "Material changes require your agreement, not just continued use.",
    definition: "Company may modify terms at will; continued use = acceptance, often without notice.",
  },
  NOTICE_OF_CHANGE: {
    group: "CHANGES", severity: "minor", hostile: 0, protective: 6,
    hostileLabel: "Changes",
    protectiveLabel: "Advance Notice of Changes",
    hostileSummary: "Terms can change with little warning.",
    protectiveSummary: "They promise advance notice before terms change.",
    definition: "Promises meaningful advance notice (e.g. 30 days) before terms change. Protective by nature.",
  },
  RETROACTIVE_CHANGES: {
    group: "CHANGES", severity: "minor", hostile: -6, protective: 3,
    hostileLabel: "Retroactive Changes",
    protectiveLabel: "No Retroactive Changes",
    hostileSummary: "New terms can apply to things that already happened.",
    protectiveSummary: "Changes only apply going forward, not retroactively.",
    definition: "New terms apply retroactively to prior activity/disputes.",
  },

  // ── DATA COLLECTION & PRIVACY ─────────────────────────────────────────────
  DATA_SALE: {
    group: "DATA", severity: "critical", hostile: -15, protective: 8,
    hostileLabel: "Sells Your Data",
    protectiveLabel: "No Data Sale",
    hostileSummary: "Your personal data can be sold or handed to data brokers.",
    protectiveSummary: "They state they do not sell your personal data.",
    definition: "SELLS personal data, or shares it with brokers/third parties for THEIR own commercial use. NOT routine processor/affiliate/legal disclosure.",
  },
  DATA_SHARING_THIRD_PARTY: {
    group: "DATA", severity: "major", hostile: -8, protective: 4,
    hostileLabel: "Broad Data Sharing",
    protectiveLabel: "Limited Data Sharing",
    hostileSummary: "Your data is shared widely with third parties.",
    protectiveSummary: "Data sharing with third parties is limited or opt-in.",
    definition: "Extensive sharing/disclosure of personal data with third parties beyond core processors (but not an outright sale).",
  },
  TRACKING_THIRD_PARTY: {
    group: "DATA", severity: "minor", hostile: -6, protective: 3,
    hostileLabel: "Third-Party Tracking",
    protectiveLabel: "Limited Tracking",
    hostileSummary: "You're tracked across the web for targeted advertising.",
    protectiveSummary: "Third-party ad tracking is limited or can be turned off.",
    definition: "Third-party cookies/SDKs/pixels for targeted advertising and ad measurement.",
  },
  DEVICE_FINGERPRINTING: {
    group: "DATA", severity: "minor", hostile: -6, protective: 3,
    hostileLabel: "Device Fingerprinting",
    protectiveLabel: "No Fingerprinting",
    hostileSummary: "They fingerprint your device to track you without cookies.",
    protectiveSummary: "They avoid covert device fingerprinting.",
    definition: "Device/browser fingerprinting or persistent cross-site identifiers.",
  },
  LOCATION_TRACKING: {
    group: "DATA", severity: "minor", hostile: -6, protective: 3,
    hostileLabel: "Precise Location",
    protectiveLabel: "Location Controls",
    hostileSummary: "They collect your precise location, sometimes in the background.",
    protectiveSummary: "Precise location is opt-in or not collected.",
    definition: "Collection of precise/continuous geolocation data.",
  },
  BIOMETRIC_DATA: {
    group: "DATA", severity: "major", hostile: -10, protective: 4,
    hostileLabel: "Biometric Collection",
    protectiveLabel: "Biometric Safeguards",
    hostileSummary: "They collect biometric data like your face, voice or fingerprints.",
    protectiveSummary: "Biometric data is opt-in or protected with safeguards.",
    definition: "Collects/derives biometric identifiers (faceprints, voiceprints, fingerprints).",
  },
  SENSITIVE_DATA_COLLECTION: {
    group: "DATA", severity: "major", hostile: -8, protective: 4,
    hostileLabel: "Sensitive Data",
    protectiveLabel: "Sensitive Data Protected",
    hostileSummary: "They collect sensitive data (health, beliefs, sexuality, etc.).",
    protectiveSummary: "Sensitive categories are minimized or require explicit consent.",
    definition: "Collects special-category data: health, race, religion, politics, sexual orientation, etc.",
  },
  PROFILING: {
    group: "DATA", severity: "minor", hostile: -6, protective: 3,
    hostileLabel: "Profiling & Inferences",
    protectiveLabel: "No Hidden Profiling",
    hostileSummary: "They build a profile of inferences and predictions about you.",
    protectiveSummary: "They don't build hidden behavioural profiles about you.",
    definition: "Builds behavioural/interest profiles or inferences for targeting or scoring.",
  },
  DATA_RETENTION: {
    group: "DATA", severity: "minor", hostile: -6, protective: 3,
    hostileLabel: "Indefinite Retention",
    protectiveLabel: "Limited Retention",
    hostileSummary: "They keep your data indefinitely, even after you stop using it.",
    protectiveSummary: "Data is kept only as long as needed, then deleted.",
    definition: "Retains personal data indefinitely / for an unspecified or excessive period.",
  },
  DATA_DELETION: {
    group: "DATA", severity: "major", hostile: -8, protective: 6,
    hostileLabel: "No Way to Delete Data",
    protectiveLabel: "Right to Delete Data",
    hostileSummary: "There's no real way to delete your personal data.",
    protectiveSummary: "You can request deletion of your personal data.",
    definition: "Hostile: no/withheld deletion. Protective: clear right to delete your data on request.",
  },
  DATA_PORTABILITY: {
    group: "DATA", severity: "minor", hostile: 0, protective: 4,
    hostileLabel: "Data Locked In",
    protectiveLabel: "Data Export",
    hostileSummary: "You can't easily get your data out.",
    protectiveSummary: "You can export or download your data.",
    definition: "Right to export/download your data in a portable form. Protective by nature.",
  },
  BREACH_NOTIFICATION: {
    group: "DATA", severity: "minor", hostile: -5, protective: 3,
    hostileLabel: "No Breach Notice",
    protectiveLabel: "Breach Notification",
    hostileSummary: "They don't commit to telling you if your data is breached.",
    protectiveSummary: "They commit to notifying you of data breaches.",
    definition: "Hostile: disclaims/omits breach notice. Protective: commits to notify users of breaches.",
  },
  CHILDREN_DATA: {
    group: "DATA", severity: "major", hostile: -8, protective: 4,
    hostileLabel: "Children's Data",
    protectiveLabel: "Children Protected",
    hostileSummary: "They collect data from children with weak safeguards.",
    protectiveSummary: "Children's data gets extra protection or isn't collected.",
    definition: "Hostile: collects minors' data with weak/again-targeting safeguards. Protective: strong child-data protections.",
  },
  SECURITY_COMMITMENT: {
    group: "DATA", severity: "minor", hostile: -4, protective: 4,
    hostileLabel: "Weak Security Stance",
    protectiveLabel: "Strong Security",
    hostileSummary: "They disclaim responsibility for securing your data.",
    protectiveSummary: "They commit to strong security like encryption.",
    definition: "Hostile: disclaims security duty. Protective: concrete security commitments (encryption, audits).",
  },

  // ── AI & AUTOMATION ───────────────────────────────────────────────────────
  AI_TRAINING: {
    group: "AI", severity: "major", hostile: -8, protective: 8,
    hostileLabel: "Trains AI on Your Data",
    protectiveLabel: "No AI Training / Opt-Out",
    hostileSummary: "Your content and data are used to train their AI models.",
    protectiveSummary: "They don't train AI on your data, or let you opt out.",
    definition: "Hostile: uses your content/personal data to train ML/AI models. Protective: excludes your data or offers an opt-out.",
  },
  AUTOMATED_DECISION_MAKING: {
    group: "AI", severity: "minor", hostile: -6, protective: 3,
    hostileLabel: "Automated Decisions",
    protectiveLabel: "Human Review",
    hostileSummary: "Significant decisions about you are made by algorithms alone.",
    protectiveSummary: "You can get a human to review automated decisions.",
    definition: "Hostile: solely-automated decisions with legal/significant effect, no human review. Protective: right to human review.",
  },
  AI_MODERATION_NO_APPEAL: {
    group: "AI", severity: "minor", hostile: -4, protective: 2,
    hostileLabel: "Automated Moderation",
    protectiveLabel: "Moderation Appeals",
    hostileSummary: "Automated systems can action your account with no appeal.",
    protectiveSummary: "You can appeal automated moderation to a human.",
    definition: "Hostile: AI moderation/enforcement without an appeal path. Protective: appeals to a human.",
  },

  // ── CONTENT & INTELLECTUAL PROPERTY ───────────────────────────────────────
  CONTENT_LICENSE_BROAD: {
    group: "CONTENT", severity: "major", hostile: -8, protective: 5,
    hostileLabel: "Broad Content License",
    protectiveLabel: "Narrow Content License",
    hostileSummary: "They take a broad, perpetual, sublicensable license to your content.",
    protectiveSummary: "Any license to your content is narrow and just to run the service.",
    definition: "Hostile: perpetual/irrevocable/worldwide/sublicensable license to user content. Protective: limited license only to operate the service.",
  },
  CONTENT_OWNERSHIP: {
    group: "CONTENT", severity: "major", hostile: -10, protective: 5,
    hostileLabel: "They Claim Ownership",
    protectiveLabel: "You Keep Ownership",
    hostileSummary: "They claim ownership of the content you create.",
    protectiveSummary: "You keep full ownership of the content you create.",
    definition: "Hostile: assigns ownership/IP of user content to the company. Protective: user explicitly retains ownership.",
  },
  MORAL_RIGHTS_WAIVER: {
    group: "CONTENT", severity: "minor", hostile: -4, protective: 2,
    hostileLabel: "Moral-Rights Waiver",
    protectiveLabel: "Moral Rights Kept",
    hostileSummary: "You waive moral rights, so your work can be altered or used uncredited.",
    protectiveSummary: "You keep moral rights over how your work is used.",
    definition: "Waiver of moral rights (attribution/integrity) in user content.",
  },
  NAME_LIKENESS_USE: {
    group: "CONTENT", severity: "minor", hostile: -5, protective: 2,
    hostileLabel: "Name & Likeness Use",
    protectiveLabel: "Likeness Protected",
    hostileSummary: "They can use your name, likeness or content to promote themselves.",
    protectiveSummary: "They won't use your name or likeness in marketing without consent.",
    definition: "Right to use the user's name/likeness/handle/content in advertising or promotion.",
  },

  // ── ACCOUNT & SERVICE ─────────────────────────────────────────────────────
  ACCOUNT_TERMINATION: {
    group: "ACCOUNT", severity: "major", hostile: -8, protective: 5,
    hostileLabel: "Termination Any Time",
    protectiveLabel: "Fair Termination",
    hostileSummary: "They can suspend or close your account at any time, for any reason.",
    protectiveSummary: "Termination requires cause, notice, or an appeal.",
    definition: "Hostile: terminate/suspend for any or no reason, often without notice. Protective: cause + notice/appeal required.",
  },
  CONTENT_LOSS_ON_TERMINATION: {
    group: "ACCOUNT", severity: "minor", hostile: -6, protective: 3,
    hostileLabel: "Lose Content on Exit",
    protectiveLabel: "Content Recoverable",
    hostileSummary: "Your content or balance can be erased when an account ends.",
    protectiveSummary: "You get a grace period or export when an account ends.",
    definition: "Hostile: content/credits forfeited or deleted on termination with no export. Protective: grace period/export.",
  },
  SERVICE_DISCONTINUATION: {
    group: "ACCOUNT", severity: "minor", hostile: -4, protective: 2,
    hostileLabel: "Can Shut Down Anytime",
    protectiveLabel: "Wind-Down Protections",
    hostileSummary: "They can discontinue the service anytime with no responsibility.",
    protectiveSummary: "They commit to notice or data export if the service shuts down.",
    definition: "Hostile: may discontinue features/service at will, no liability. Protective: notice/export on shutdown.",
  },

  // ── BILLING & CANCELLATION ────────────────────────────────────────────────
  AUTO_RENEWAL: {
    group: "BILLING", severity: "minor", hostile: -5, protective: 2,
    hostileLabel: "Auto-Renewal",
    protectiveLabel: "Renewal Controls",
    hostileSummary: "Subscriptions auto-renew and keep charging you.",
    protectiveSummary: "Auto-renewal is clearly disclosed and easy to turn off.",
    definition: "Hostile: silent auto-renewing charges. Protective: clear reminders / easy opt-out of renewal.",
  },
  HARD_TO_CANCEL: {
    group: "BILLING", severity: "major", hostile: -8, protective: 5,
    hostileLabel: "Hard to Cancel",
    protectiveLabel: "Easy to Cancel",
    hostileSummary: "Cancelling is deliberately difficult (calls, forms, retention loops).",
    protectiveSummary: "You can cancel easily, the same way you signed up.",
    definition: "Hostile: cancellation is obstructed (phone-only, retention hoops). Protective: one-click/symmetric cancellation.",
  },
  NO_REFUNDS: {
    group: "BILLING", severity: "minor", hostile: -5, protective: 2,
    hostileLabel: "No Refunds",
    protectiveLabel: "Refunds Available",
    hostileSummary: "All payments are non-refundable, even unused time.",
    protectiveSummary: "Reasonable refunds are available.",
    definition: "Hostile: blanket no-refund / forfeits prepaid balances. Protective: clear refund rights.",
  },
  UNILATERAL_PRICE_CHANGE: {
    group: "BILLING", severity: "minor", hostile: -5, protective: 2,
    hostileLabel: "Price Changes Anytime",
    protectiveLabel: "Price-Change Notice",
    hostileSummary: "They can raise prices at any time, sometimes without notice.",
    protectiveSummary: "Price changes come with notice and a chance to cancel.",
    definition: "Hostile: change prices/fees at will. Protective: advance notice + cancel option before increases.",
  },
  HIDDEN_FEES: {
    group: "BILLING", severity: "minor", hostile: -5, protective: 2,
    hostileLabel: "Hidden Fees",
    protectiveLabel: "Transparent Pricing",
    hostileSummary: "There are undisclosed or surprise fees and penalties.",
    protectiveSummary: "Fees are disclosed up front with no surprises.",
    definition: "Hostile: undisclosed/penalty/processing fees. Protective: all-in transparent pricing.",
  },

  // ── TRANSPARENCY & USER RIGHTS (mostly positive) ──────────────────────────
  STATUTORY_RIGHTS: {
    group: "TRANSPARENCY", severity: "minor", hostile: 0, protective: 5,
    hostileLabel: "Rights Limited by Region",
    protectiveLabel: "Privacy Rights for All",
    hostileSummary: "Strong privacy rights are limited to certain regions only.",
    protectiveSummary: "They extend GDPR/CCPA-style rights to all users.",
    definition: "Protective: grants statutory privacy rights (access/delete/object) to all users, not just where legally required.",
  },
  TRANSPARENCY_REPORT: {
    group: "TRANSPARENCY", severity: "minor", hostile: 0, protective: 3,
    hostileLabel: "No Transparency",
    protectiveLabel: "Transparency Reports",
    hostileSummary: "No transparency about government or legal data requests.",
    protectiveSummary: "They publish transparency reports on data requests.",
    definition: "Protective: commits to publishing transparency reports on government/legal requests.",
  },
  GOV_REQUEST_NOTICE: {
    group: "TRANSPARENCY", severity: "minor", hostile: 0, protective: 4,
    hostileLabel: "Silent on Gov Requests",
    protectiveLabel: "Notifies on Gov Requests",
    hostileSummary: "They can hand data to authorities without telling you.",
    protectiveSummary: "They notify you of government data requests where allowed.",
    definition: "Protective: commits to notifying users of government/legal data requests when permitted.",
  },
  PLAIN_LANGUAGE: {
    group: "TRANSPARENCY", severity: "minor", hostile: 0, protective: 2,
    hostileLabel: "Dense Legalese",
    protectiveLabel: "Plain-Language Terms",
    hostileSummary: "The terms are dense and hard to understand.",
    protectiveSummary: "The terms are written in clear, plain language with summaries.",
    definition: "Protective: plain-language drafting, summaries, or layered notices that aid understanding.",
  },

  // ── CATCH-ALL ─────────────────────────────────────────────────────────────
  OTHER: {
    group: "NONE", severity: "minor", hostile: 0, protective: 0,
    hostileLabel: "Other",
    protectiveLabel: "Other",
    hostileSummary: "",
    protectiveSummary: "",
    definition: "Anything else, including benign boilerplate/definitions. When in doubt, OTHER.",
  },
} as const satisfies Record<string, CategoryDef>;

/** Every category key the model may return (validated in classify.ts). */
export type ClauseCategory = keyof typeof CATEGORY_DEFS;

export const CATEGORY_KEYS = Object.keys(CATEGORY_DEFS) as ClauseCategory[];

// ----------------------------------------------------------------------------
// Derivations (the only place points/severity come from)
// ----------------------------------------------------------------------------

/** Look up a category, tolerating unknown/legacy values (→ OTHER). */
export function getCategoryDef(category: string): CategoryDef {
  return CATEGORY_DEFS[category as ClauseCategory] ?? CATEGORY_DEFS.OTHER;
}

/** Signed points a single classification contributes (before dedupe/weights). */
export function categoryPoints(category: string, stance: ClauseStance): number {
  if (stance === "neutral") return 0;
  const def = getCategoryDef(category);
  return stance === "protective" ? def.protective : def.hostile;
}

/** Display bucket derived from (category, stance). Never trusted from the model. */
export function deriveSeverity(category: string, stance: ClauseStance): ClauseSeverity {
  if (category === "OTHER" || stance === "neutral") return "neutral";
  if (stance === "protective") return "positive";
  return getCategoryDef(category).severity;
}

/** Critical-severity hostile categories cap the best achievable grade. */
export function isCriticalCategory(category: string): boolean {
  return getCategoryDef(category).severity === "critical";
}

/** Title for a clause card / group. */
export function categoryLabel(category: string, stance: ClauseStance): string {
  const def = getCategoryDef(category);
  return stance === "protective" ? def.protectiveLabel : def.hostileLabel;
}

/** One-line takeaway for the "at a glance" summary. */
export function categorySummary(category: string, stance: ClauseStance): string {
  const def = getCategoryDef(category);
  return stance === "protective" ? def.protectiveSummary : def.hostileSummary;
}
