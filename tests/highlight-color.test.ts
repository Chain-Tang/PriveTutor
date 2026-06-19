import { describe, expect, it } from "vitest";
import {
  hexToRgb,
  highlightColorVars,
  isHexColor,
  normalizeHighlightColor
} from "../src/highlight-color.js";

describe("isHexColor", () => {
  it("accepts 3- and 6-digit hex, case-insensitive, ignoring surrounding space", () => {
    expect(isHexColor("#abc")).toBe(true);
    expect(isHexColor("#AABBCC")).toBe(true);
    expect(isHexColor("  #7c3aed  ")).toBe(true);
  });

  it("rejects non-hex, wrong lengths, and missing #", () => {
    expect(isHexColor("7c3aed")).toBe(false);
    expect(isHexColor("#12")).toBe(false);
    expect(isHexColor("#12345")).toBe(false);
    expect(isHexColor("#1234567")).toBe(false);
    expect(isHexColor("rgb(0,0,0)")).toBe(false);
    expect(isHexColor("")).toBe(false);
  });
});

describe("normalizeHighlightColor", () => {
  it("canonicalizes a valid hex to lower-case and trims it", () => {
    expect(normalizeHighlightColor("  #7C3AED ")).toBe("#7c3aed");
    expect(normalizeHighlightColor("#ABC")).toBe("#abc");
  });

  it("maps the empty sentinel, invalid strings, and non-strings to ''", () => {
    expect(normalizeHighlightColor("")).toBe("");
    expect(normalizeHighlightColor("not-a-color")).toBe("");
    expect(normalizeHighlightColor(42)).toBe("");
    expect(normalizeHighlightColor(null)).toBe("");
    expect(normalizeHighlightColor(undefined)).toBe("");
  });
});

describe("hexToRgb", () => {
  it("parses 6-digit hex", () => {
    expect(hexToRgb("#7c3aed")).toEqual({ r: 124, g: 58, b: 237 });
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb("#FFFFFF")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("expands 3-digit hex by doubling each nibble", () => {
    expect(hexToRgb("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
    expect(hexToRgb("#0f8")).toEqual({ r: 0, g: 255, b: 136 });
  });

  it("returns null for an invalid color", () => {
    expect(hexToRgb("teal")).toBeNull();
    expect(hexToRgb("#xyz")).toBeNull();
  });
});

describe("highlightColorVars", () => {
  it("produces the tint + translucent fill custom properties for a hex", () => {
    expect(highlightColorVars("#7c3aed")).toEqual({
      "--atl-hl-color": "#7c3aed",
      "--atl-hl-bg-color": "rgba(124, 58, 237, 0.25)"
    });
  });

  it("canonicalizes the stored color and expands shorthand for the fill", () => {
    expect(highlightColorVars("  #ABC ")).toEqual({
      "--atl-hl-color": "#abc",
      "--atl-hl-bg-color": "rgba(170, 187, 204, 0.25)"
    });
  });

  it("returns null when following the theme accent (empty/invalid)", () => {
    expect(highlightColorVars("")).toBeNull();
    expect(highlightColorVars("nope")).toBeNull();
  });
});
