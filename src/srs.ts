// Spaced-repetition scheduling for memory cells, grounded in the SM-2 algorithm
// (SuperMemo 2, Woźniak 1990 — the scheme Anki/Mnemosyne use). It counters the
// Ebbinghaus forgetting curve by expanding the interval between reviews each time
// the learner recalls a cell, and collapsing it when they don't. Pure (no
// Obsidian/runtime imports) so it is fully unit-testable; the store persists the
// ReviewState onto each cell's frontmatter and the review modal drives it.

export type ReviewGrade = "again" | "hard" | "good" | "easy";

/** Per-cell schedule. `dueAt`/`lastReviewedAt` are ISO timestamps. */
export type ReviewState = {
  /** SM-2 ease factor (>= 1.3); higher = intervals grow faster. */
  ease: number;
  /** Current interval in days. */
  intervalDays: number;
  /** Successful repetitions in a row (resets to 0 on a lapse). */
  reps: number;
  /** Total times the cell was forgotten ("again"). */
  lapses: number;
  /** When the cell is next due for review. */
  dueAt: string;
  /** When it was last graded, if ever. */
  lastReviewedAt?: string;
};

const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;
const DAY_MS = 86_400_000;

// SM-2 grades a recall 0–5; we expose four buttons mapped to its passing band.
// "again" is a lapse (q < 3); hard/good/easy are passes that adjust the ease.
const QUALITY: Record<ReviewGrade, number> = { again: 2, hard: 3, good: 4, easy: 5 };

/** A fresh schedule for a new cell: due immediately, default ease. */
export function initReviewState(now: string): ReviewState {
  return { ease: DEFAULT_EASE, intervalDays: 0, reps: 0, lapses: 0, dueAt: now };
}

/**
 * Apply one graded review and return the next schedule (SM-2). On a pass the
 * interval steps 1d → 6d → round(interval × ease); on a lapse ("again") the
 * interval resets to 1d, the streak resets, and a lapse is counted. The ease
 * factor is nudged by the grade and floored at 1.3.
 */
export function scheduleNext(
  state: ReviewState,
  grade: ReviewGrade,
  now: string
): ReviewState {
  const q = QUALITY[grade];
  const ease = Math.max(
    MIN_EASE,
    round2(state.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))
  );

  if (q < 3) {
    return {
      ease,
      intervalDays: 1,
      reps: 0,
      lapses: state.lapses + 1,
      dueAt: addDays(now, 1),
      lastReviewedAt: now
    };
  }

  let intervalDays: number;
  if (state.reps === 0) intervalDays = 1;
  else if (state.reps === 1) intervalDays = 6;
  else intervalDays = Math.max(1, Math.round(state.intervalDays * ease));

  return {
    ease,
    intervalDays,
    reps: state.reps + 1,
    lapses: state.lapses,
    dueAt: addDays(now, intervalDays),
    lastReviewedAt: now
  };
}

/** True when the cell's next review is at or before `now`. */
export function isDue(state: ReviewState, now: string): boolean {
  return Date.parse(state.dueAt) <= Date.parse(now);
}

/** Cells due for review now (an unscheduled cell counts as due so it enters the loop). */
export function dueCells<T extends { review?: ReviewState }>(
  cells: T[],
  now: string
): T[] {
  return cells.filter((cell) => !cell.review || isDue(cell.review, now));
}

function addDays(iso: string, days: number): string {
  const base = Date.parse(iso);
  const start = Number.isFinite(base) ? base : Date.now();
  return new Date(start + days * DAY_MS).toISOString();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
