import { describe, expect, it } from "vitest";
import { locateInRaw, locateNormalized } from "../src/reading-highlight.js";

// `raw` is the concatenated text-node content of a rendered block; the helper
// finds the (whitespace-tolerant) span of a stored selection within it.
describe("locateInRaw", () => {
  it("finds a single-word selection in one run", () => {
    const raw = "alpha beta gamma";
    const span = locateInRaw(raw, "beta");
    expect(span).toEqual({ start: 6, end: 10 });
    expect(raw.slice(span!.start, span!.end)).toBe("beta");
  });

  it("matches a multi-line selection where the soft break renders as a space", () => {
    // Source had "alpha beta\ngamma"; Reading view renders the newline as a space.
    const raw = "alpha beta gamma";
    const span = locateInRaw(raw, "beta\ngamma");
    expect(raw.slice(span!.start, span!.end)).toBe("beta gamma");
  });

  it("matches text broken across inline markup (concatenated text nodes)", () => {
    // "the **bold** word" renders as nodes "the ", "bold", " word" -> contiguous raw.
    const raw = "the bold word here";
    const span = locateInRaw(raw, "bold word");
    expect(raw.slice(span!.start, span!.end)).toBe("bold word");
  });

  it("matches a CJK selection whose soft break renders as nothing", () => {
    const raw = "你好世界朋友";
    const span = locateInRaw(raw, "你好\n世界");
    expect(span).toEqual({ start: 0, end: 4 });
    expect(raw.slice(span!.start, span!.end)).toBe("你好世界");
  });

  it("spans the original run of whitespace when the source had several spaces", () => {
    const raw = "alpha   beta";
    const span = locateInRaw(raw, "alpha beta");
    expect(raw.slice(span!.start, span!.end)).toBe("alpha   beta");
  });

  it("tolerates leading/trailing whitespace in the stored selection", () => {
    const raw = "alpha beta gamma";
    const span = locateInRaw(raw, "  beta  ");
    expect(raw.slice(span!.start, span!.end)).toBe("beta");
  });

  it("returns null when the text is not present", () => {
    expect(locateInRaw("alpha beta", "zzz")).toBeNull();
    expect(locateInRaw("alpha beta", "")).toBeNull();
  });
});

describe("locateNormalized", () => {
  it("with a space joiner does not match a break that rendered as nothing", () => {
    // The space-collapsing pass alone fails for CJK; locateInRaw's "" pass covers it.
    expect(locateNormalized("你好世界", "你好\n世界", " ")).toBeNull();
    expect(locateNormalized("你好世界", "你好\n世界", "")).toEqual({ start: 0, end: 4 });
  });
});
