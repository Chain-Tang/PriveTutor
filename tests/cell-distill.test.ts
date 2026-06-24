import { describe, expect, it } from "vitest";
import {
  asCellType,
  asConfidence,
  asText,
  cellTypeForCorrectness,
  confidenceForCorrectness,
  normalizeConcept,
  parseJsonObject
} from "../src/cell-distill.js";

describe("parseJsonObject", () => {
  it("extracts the first JSON object even with surrounding prose", () => {
    expect(parseJsonObject('Sure! {"a": 1} done')).toEqual({ a: 1 });
  });
  it("returns null for arrays, non-JSON, and malformed input", () => {
    expect(parseJsonObject("[1,2,3]")).toBeNull();
    expect(parseJsonObject("no json here")).toBeNull();
    expect(parseJsonObject("{not valid}")).toBeNull();
  });
});

describe("field coercion", () => {
  it("asText trims strings and rejects non-strings", () => {
    expect(asText("  hi ")).toBe("hi");
    expect(asText(42)).toBe("");
  });
  it("asCellType accepts known types, else falls back to understanding", () => {
    expect(asCellType("misconception")).toBe("misconception");
    expect(asCellType("nonsense")).toBe("understanding");
  });
  it("asConfidence clamps to [0,1] with a 0.6 default", () => {
    expect(asConfidence(0.42)).toBe(0.42);
    expect(asConfidence(5)).toBe(1);
    expect(asConfidence(-1)).toBe(0);
    expect(asConfidence("x")).toBe(0.6);
  });
});

describe("normalizeConcept", () => {
  it("keeps a clean short noun phrase unchanged", () => {
    expect(normalizeConcept("Projection")).toBe("Projection");
    expect(normalizeConcept("防御机制")).toBe("防御机制");
  });
  it("reduces a run-on sentence to its first clause", () => {
    expect(normalizeConcept("我随后的解释集中在这种变化的原因：我提出，当我做出解释")).toBe(
      "我随后的解释集中在这种变化的原因"
    );
  });
  it("strips leading bullet/heading markers and wrapping quotes", () => {
    expect(normalizeConcept('- "Attention"')).toBe("Attention");
    expect(normalizeConcept("# Working memory")).toBe("Working memory");
  });
  it("caps latin phrases to six words and long space-free strings to 18 chars", () => {
    expect(normalizeConcept("one two three four five six seven eight")).toBe(
      "one two three four five six"
    );
    expect([...normalizeConcept("一二三四五六七八九十一二三四五六七八九二十")].length).toBe(18);
  });
  it("returns empty for blank or non-string input", () => {
    expect(normalizeConcept("   ")).toBe("");
    expect(normalizeConcept(undefined)).toBe("");
    expect(normalizeConcept(42)).toBe("");
  });
});

describe("correctness mapping", () => {
  it("maps correctness to cell type", () => {
    expect(cellTypeForCorrectness("incorrect")).toBe("misconception");
    expect(cellTypeForCorrectness("uncertain")).toBe("difficulty");
    expect(cellTypeForCorrectness("correct")).toBe("understanding");
    expect(cellTypeForCorrectness(undefined)).toBe("understanding");
  });
  it("maps correctness to a starting confidence", () => {
    expect(confidenceForCorrectness("correct")).toBe(0.85);
    expect(confidenceForCorrectness("partially_correct")).toBe(0.5);
    expect(confidenceForCorrectness("incorrect")).toBe(0.3);
    expect(confidenceForCorrectness("uncertain")).toBe(0.4);
    expect(confidenceForCorrectness(undefined)).toBe(0.6);
  });
});
