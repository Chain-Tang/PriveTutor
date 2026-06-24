import { describe, expect, it } from "vitest";
import {
  CARD_SCALE_STEP,
  MAX_CARD_SCALE,
  MIN_CARD_SCALE,
  nextCardScale
} from "../src/card-zoom.js";

describe("nextCardScale", () => {
  it("zooms in when scrolling up (deltaY < 0) and out when scrolling down", () => {
    expect(nextCardScale(1, -1)).toBe(1 + CARD_SCALE_STEP);
    expect(nextCardScale(1, 1)).toBe(1 - CARD_SCALE_STEP);
  });

  it("leaves the scale unchanged for a zero delta", () => {
    expect(nextCardScale(1.3, 0)).toBe(1.3);
  });

  it("clamps to the max and min and stays put at a bound", () => {
    expect(nextCardScale(MAX_CARD_SCALE, -100)).toBe(MAX_CARD_SCALE);
    expect(nextCardScale(MIN_CARD_SCALE, 100)).toBe(MIN_CARD_SCALE);
    expect(nextCardScale(MAX_CARD_SCALE - 0.05, -1)).toBe(MAX_CARD_SCALE);
    expect(nextCardScale(MIN_CARD_SCALE + 0.05, 1)).toBe(MIN_CARD_SCALE);
  });

  it("rounds to 2 decimals so repeated steps don't drift", () => {
    // 0.7 - 0.1 in floating point is 0.5999999999999999 without rounding.
    expect(nextCardScale(0.7, 1)).toBe(0.6);
    expect(nextCardScale(1.1, -1)).toBe(1.2);
  });
});
