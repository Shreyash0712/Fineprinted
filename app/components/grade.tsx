import type { Grade } from "@/lib/types";

const GRADE_STYLES: Record<Grade, string> = {
  A: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/25 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
  B: "bg-lime-500/10 text-lime-700 ring-lime-600/25 dark:bg-lime-500/15 dark:text-lime-300 dark:ring-lime-500/30",
  C: "bg-yellow-500/10 text-yellow-700 ring-yellow-600/25 dark:bg-yellow-500/15 dark:text-yellow-300 dark:ring-yellow-500/30",
  D: "bg-orange-500/10 text-orange-700 ring-orange-600/25 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30",
  F: "bg-red-500/10 text-red-700 ring-red-600/25 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30",
};

export const GRADE_BAR_COLORS: Record<Grade, string> = {
  A: "bg-emerald-500",
  B: "bg-lime-500",
  C: "bg-yellow-500",
  D: "bg-orange-500",
  F: "bg-red-500",
};

const SIZES = {
  sm: "h-9 w-9 rounded-lg text-base",
  md: "h-12 w-12 rounded-xl text-xl",
  lg: "h-16 w-16 rounded-xl text-3xl",
  xl: "h-20 w-20 rounded-2xl text-4xl",
} as const;

export function GradeBadge({
  grade,
  size = "md",
}: {
  grade: Grade | null;
  size?: keyof typeof SIZES;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center font-bold ring-1 ${SIZES[size]} ${
        grade
          ? GRADE_STYLES[grade]
          : "bg-zinc-200/60 text-zinc-400 ring-zinc-300 dark:bg-zinc-800/60 dark:text-zinc-500 dark:ring-zinc-700"
      }`}
      title={grade ? `Grade ${grade}` : "Not graded yet"}
    >
      {grade ?? "?"}
    </span>
  );
}

/** Horizontal 0–100 score bar tinted by grade. */
export function ScoreBar({ score, grade }: { score: number | null; grade: Grade | null }) {
  if (score === null) return null;
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all ${grade ? GRADE_BAR_COLORS[grade] : "bg-zinc-400"}`}
          style={{ width: `${Math.max(2, Math.min(100, score))}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{score}/100</span>
    </div>
  );
}
