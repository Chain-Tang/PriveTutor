import { describe, expect, it } from "vitest";
import {
  parseMemoryCellFile,
  serializeMemoryCell
} from "../src/markdown/memory-cell-file.js";
import type { MemoryCell } from "../src/model.js";

function cell(overrides: Partial<MemoryCell> = {}): MemoryCell {
  return {
    id: "MEM-ann-20260615-001",
    type: "understanding",
    concept: "Attention",
    status: "new",
    summary: "Attention weights several positions at once.",
    sourceAnnotations: ["ANN-20260615-001"],
    tags: ["ml"],
    confidence: 0.6,
    createdAt: "2026-06-15T10:00:00.000Z",
    updatedAt: "2026-06-15T10:00:00.000Z",
    ...overrides
  };
}

describe("memory cell file", () => {
  it("round-trips a cell with an SM-2 review schedule", () => {
    const withReview = cell({
      review: {
        ease: 2.36,
        intervalDays: 6,
        reps: 2,
        lapses: 1,
        dueAt: "2026-06-21T10:00:00.000Z",
        lastReviewedAt: "2026-06-15T10:00:00.000Z"
      }
    });
    const serialized = serializeMemoryCell(withReview);
    expect(serialized).toContain("srs_due: 2026-06-21T10:00:00.000Z");
    expect(serialized).toContain("srs_ease: 2.36");

    const parsed = parseMemoryCellFile(serialized);
    expect(parsed?.review).toEqual(withReview.review);
    // Idempotent.
    expect(serializeMemoryCell(parsed!)).toBe(serialized);
  });

  it("parses a cell with no schedule (review undefined)", () => {
    const parsed = parseMemoryCellFile(serializeMemoryCell(cell()));
    expect(parsed).not.toBeNull();
    expect(parsed?.review).toBeUndefined();
  });
});
