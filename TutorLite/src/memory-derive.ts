// Derive higher-level memory structures from cells. Pure (no Obsidian), so it is
// unit-testable; the store writes the resulting scene files.

import type { MemoryCell, Scene } from "./model.js";

/**
 * Group memory cells into scenes by shared concept: a scene per concept that has
 * two or more cells (a single cell needs no grouping). Deterministic given the
 * cells + timestamp. Generated scenes carry the `auto` tag so the store can tell
 * them apart from any hand-authored scene.
 */
export function deriveScenes(cells: MemoryCell[], generatedAt: string): Scene[] {
  const byConcept = new Map<string, MemoryCell[]>();
  for (const cell of cells) {
    const concept = cell.concept.trim();
    if (!concept) continue;
    const list = byConcept.get(concept);
    if (list) list.push(cell);
    else byConcept.set(concept, [cell]);
  }
  return [...byConcept.entries()]
    .filter(([, group]) => group.length >= 2)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([concept, group]) => ({
      id: `SCENE-${slug(concept)}`,
      type: "topic" as const,
      title: concept,
      status: "active" as const,
      summary: `Auto-grouped from ${group.length} memory cells about ${concept}.`,
      cells: group.map((cell) => cell.id).sort(),
      tags: ["auto"],
      createdAt: generatedAt,
      updatedAt: generatedAt
    }));
}

/** A scene-id-safe slug (matches the schema's ^SCENE-[A-Za-z0-9_-]+$). */
function slug(value: string): string {
  const out = value
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return out || "topic";
}
