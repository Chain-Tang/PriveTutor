// Classify memory cells into the learner's strengths, weaknesses, and
// problem-solving methods. Measured spaced-repetition performance (SM-2
// reps/lapses, see srs.ts) is the primary signal — what the learner actually
// recalled outranks the LLM's one-shot confidence guess — and a cell's
// type/status/confidence are the fallback only when it has no review history yet.
// Pure (only a type import) so it is unit-testable and reused by the notebook's
// learner summary and the opt-in weakness-training command.

import type { MemoryCell } from "./model.js";

export type LearningClassification = {
  strengths: MemoryCell[];
  weaknesses: MemoryCell[];
  methods: MemoryCell[];
};

// `reps` counts consecutive successful recalls and resets to 0 on a lapse, so a
// streak is current, demonstrated retention; reps 0 with a past lapse is a
// currently-active gap (a brand-new cell — reps 0, no lapse — is neither).
const MASTERED_REPS = 3;

/** Recalled several times running in spaced review — current, measured retention. */
function recalledReliably(cell: MemoryCell): boolean {
  return reps(cell) >= MASTERED_REPS;
}

/** Forgotten in spaced review and not yet re-learned — a current, measured gap. */
function recentlyLapsed(cell: MemoryCell): boolean {
  return reps(cell) === 0 && lapses(cell) > 0;
}

/** A cell that signals solid understanding (fallback when there's no review history). */
export function isStrength(cell: MemoryCell): boolean {
  return (
    cell.type === "understanding" ||
    cell.type === "strategy" ||
    cell.status === "stable" ||
    cell.confidence >= 0.8
  );
}

/** A cell that signals a gap to revisit (fallback when there's no review history). */
export function isWeakness(cell: MemoryCell): boolean {
  return (
    cell.type === "misconception" ||
    cell.type === "difficulty" ||
    cell.status === "needs_review" ||
    cell.confidence < 0.5
  );
}

/**
 * Split cells into strengths / weaknesses / methods. Spaced-repetition history
 * decides first — a reliably-recalled cell is a strength and a freshly-lapsed one
 * a weakness, however the LLM rated it — and cells with no review yet fall back to
 * the type/status/confidence heuristic (where weakness wins ties, since gaps
 * deserve attention first). `methods` cross-cuts (every `strategy` cell). Each
 * list is deterministically sorted: most-forgotten weaknesses and best-recalled
 * strengths first.
 */
export function classifyCells(cells: MemoryCell[]): LearningClassification {
  const strengths: MemoryCell[] = [];
  const weaknesses: MemoryCell[] = [];
  const methods: MemoryCell[] = [];
  for (const cell of cells) {
    if (cell.type === "strategy") methods.push(cell);
    if (recentlyLapsed(cell)) weaknesses.push(cell);
    else if (recalledReliably(cell)) strengths.push(cell);
    else if (isWeakness(cell)) weaknesses.push(cell);
    else if (isStrength(cell)) strengths.push(cell);
  }
  // Most-forgotten weaknesses first; best-recalled, most-confident strengths
  // first; newest methods first. `id` is the deterministic final tiebreak.
  weaknesses.sort(
    (a, b) => lapses(b) - lapses(a) || a.confidence - b.confidence || a.id.localeCompare(b.id)
  );
  strengths.sort(
    (a, b) => reps(b) - reps(a) || b.confidence - a.confidence || a.id.localeCompare(b.id)
  );
  methods.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  return { strengths, weaknesses, methods };
}

function reps(cell: MemoryCell): number {
  return cell.review?.reps ?? 0;
}

function lapses(cell: MemoryCell): number {
  return cell.review?.lapses ?? 0;
}
