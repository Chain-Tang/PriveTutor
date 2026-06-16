import { describe, expect, it } from "vitest";
import { classifyCells, isStrength, isWeakness } from "../src/learning.js";
import type { MemoryCell } from "../src/model.js";
import type { ReviewState } from "../src/srs.js";

function cell(overrides: Partial<MemoryCell> = {}): MemoryCell {
  return {
    id: "MEM-1",
    type: "understanding",
    concept: "C",
    status: "new",
    summary: "s",
    sourceAnnotations: ["ANN-1"],
    tags: [],
    confidence: 0.6,
    createdAt: "2026-06-15T10:00:00.000Z",
    updatedAt: "2026-06-15T10:00:00.000Z",
    ...overrides
  };
}

function review(overrides: Partial<ReviewState> = {}): ReviewState {
  return { ease: 2.5, intervalDays: 1, reps: 0, lapses: 0, dueAt: "2026-06-15T10:00:00.000Z", ...overrides };
}

describe("classifyCells", () => {
  it("routes misconceptions/low-confidence to weaknesses, understanding to strengths", () => {
    const cells = [
      cell({ id: "MEM-1", type: "understanding", confidence: 0.9 }),
      cell({ id: "MEM-2", type: "misconception", confidence: 0.4 }),
      cell({ id: "MEM-3", type: "understanding", confidence: 0.3 }) // low conf → weakness
    ];
    const { strengths, weaknesses } = classifyCells(cells);
    expect(strengths.map((c) => c.id)).toEqual(["MEM-1"]);
    expect(weaknesses.map((c) => c.id)).toEqual(["MEM-3", "MEM-2"]); // weakest first
  });

  it("collects strategy cells as problem-solving methods", () => {
    const { methods } = classifyCells([
      cell({ id: "MEM-1", type: "strategy", confidence: 0.7 }),
      cell({ id: "MEM-2", type: "understanding" })
    ]);
    expect(methods.map((c) => c.id)).toEqual(["MEM-1"]);
  });

  it("treats stable/high-confidence as strengths and needs_review as weakness", () => {
    expect(isStrength(cell({ status: "stable", confidence: 0.2 }))).toBe(true);
    expect(isWeakness(cell({ status: "needs_review", confidence: 0.9, type: "goal" }))).toBe(true);
  });

  it("lets measured review performance override the LLM confidence guess", () => {
    const cells = [
      // High-confidence "understanding" the learner just failed in review → weakness.
      cell({ id: "MEM-1", type: "understanding", confidence: 0.95, review: review({ reps: 0, lapses: 1 }) }),
      // A "misconception" now recalled 3× running with no current lapse → strength.
      cell({ id: "MEM-2", type: "misconception", confidence: 0.3, review: review({ reps: 3, lapses: 1 }) })
    ];
    const { strengths, weaknesses } = classifyCells(cells);
    expect(weaknesses.map((c) => c.id)).toEqual(["MEM-1"]);
    expect(strengths.map((c) => c.id)).toEqual(["MEM-2"]);
  });

  it("orders weaknesses by lapses and strengths by reps (most-relevant first)", () => {
    const { strengths, weaknesses } = classifyCells([
      cell({ id: "W1", confidence: 0.4, review: review({ reps: 0, lapses: 1 }) }),
      cell({ id: "W2", confidence: 0.4, review: review({ reps: 0, lapses: 3 }) }),
      cell({ id: "S1", type: "understanding", review: review({ reps: 3, lapses: 0 }) }),
      cell({ id: "S2", type: "understanding", review: review({ reps: 5, lapses: 0 }) })
    ]);
    expect(weaknesses.map((c) => c.id)).toEqual(["W2", "W1"]); // 3 lapses before 1
    expect(strengths.map((c) => c.id)).toEqual(["S2", "S1"]); // 5 reps before 3
  });

  it("treats a brand-new schedule (reps 0, no lapses) as no signal — falls back to heuristics", () => {
    const { strengths } = classifyCells([
      cell({ id: "N", type: "understanding", confidence: 0.9, review: review({ reps: 0, lapses: 0 }) })
    ]);
    expect(strengths.map((c) => c.id)).toEqual(["N"]);
  });
});
