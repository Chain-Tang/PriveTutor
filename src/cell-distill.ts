// Pure helpers for turning a model reply (or a review's correctness) into the
// fields of a memory cell. Extracted from main.ts so they can be unit-tested
// without an Obsidian runtime.

import type { MemoryCell } from "./model.js";

const CELL_TYPES: readonly MemoryCell["type"][] = [
  "understanding",
  "misconception",
  "goal",
  "difficulty",
  "strategy",
  "progress"
];

/** Pull the first JSON object out of a model reply (tolerant of surrounding prose). */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const value: unknown = JSON.parse(match[0]);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Reduce a raw concept — a model's answer or a fallback slice of source text — to a
 * short, canonical topic label: strip list/quote markers, keep the first clause,
 * and cap the length. A run-on sentence becomes a brief phrase, so cells about the
 * same topic group into a scene (deriveScenes) and every feature reads cleanly.
 * Returns "" when nothing usable remains.
 */
export function normalizeConcept(value: unknown): string {
  let text = asText(value);
  if (!text) return "";
  // Drop a leading list bullet / heading hash and any wrapping quotes.
  text = text
    .replace(/^[#>\-*\s]+/, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
  // Keep only the first clause (split on ASCII + CJK sentence/clause punctuation).
  const clause = text.split(/[.!?;:,。．！？；：，、\n\r]/u)[0]?.trim();
  text = clause || text;
  // Cap length: ~6 space-separated words, else ~18 code points for scripts without
  // spaces (CJK), counting by code point so multi-byte glyphs aren't split.
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 6) {
    text = words.slice(0, 6).join(" ");
  } else if (words.length <= 1) {
    const chars = [...text];
    if (chars.length > 18) text = chars.slice(0, 18).join("");
  }
  return text.trim();
}

export function asCellType(value: unknown): MemoryCell["type"] {
  return CELL_TYPES.includes(value as MemoryCell["type"])
    ? (value as MemoryCell["type"])
    : "understanding";
}

export function asConfidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0.6;
}

/** Map a review's correctness to the kind of memory cell it implies. */
export function cellTypeForCorrectness(correctness: string | undefined): MemoryCell["type"] {
  if (correctness === "incorrect") return "misconception";
  if (correctness === "uncertain") return "difficulty";
  return "understanding";
}

/** A starting confidence for an auto cell, from the review's correctness. */
export function confidenceForCorrectness(correctness: string | undefined): number {
  switch (correctness) {
    case "correct":
      return 0.85;
    case "partially_correct":
      return 0.5;
    case "incorrect":
      return 0.3;
    case "uncertain":
      return 0.4;
    default:
      return 0.6;
  }
}
