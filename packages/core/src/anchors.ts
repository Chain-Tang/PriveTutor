import type { AnnotationAnchor } from "@annotation-tutor/domain";

export type AnchorResolution = {
  strategy: "block-id" | "exact-text" | "context" | "fuzzy" | "not-found";
  line?: number;
  startOffset?: number;
  endOffset?: number;
  confidence: number;
  requiresConfirmation: boolean;
};

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? 0;
}

function similarity(left: string, right: string): number {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  const length = Math.max(normalizedLeft.length, normalizedRight.length);
  if (length === 0) return 1;
  return 1 - levenshtein(normalizedLeft, normalizedRight) / length;
}

export function resolveAnchor(
  markdown: string,
  anchor: AnnotationAnchor
): AnchorResolution {
  const lines = markdown.split(/\r?\n/);
  const blockPattern = new RegExp(`(?:^|\\s)\\^${escapeRegExp(anchor.blockId)}\\s*$`);
  const blockLine = lines.findIndex((line) => blockPattern.test(line));
  if (blockLine >= 0) {
    const lineStart = lines.slice(0, blockLine).reduce((sum, line) => sum + line.length + 1, 0);
    const selectedStart = lines[blockLine]?.indexOf(anchor.selectedText) ?? -1;
    return {
      strategy: "block-id",
      line: blockLine,
      startOffset: selectedStart >= 0 ? lineStart + selectedStart : lineStart,
      endOffset:
        selectedStart >= 0
          ? lineStart + selectedStart + anchor.selectedText.length
          : lineStart + (lines[blockLine]?.length ?? 0),
      confidence: 1,
      requiresConfirmation: false
    };
  }

  const exactOffset = anchor.selectedText
    ? markdown.indexOf(anchor.selectedText)
    : -1;
  if (exactOffset >= 0) {
    return {
      strategy: "exact-text",
      line: markdown.slice(0, exactOffset).split(/\r?\n/).length - 1,
      startOffset: exactOffset,
      endOffset: exactOffset + anchor.selectedText.length,
      confidence: 0.95,
      requiresConfirmation: false
    };
  }

  const contextualText = `${anchor.contextBefore}${anchor.selectedText}${anchor.contextAfter}`;
  const contextualOffset = contextualText ? markdown.indexOf(contextualText) : -1;
  if (contextualOffset >= 0) {
    const startOffset = contextualOffset + anchor.contextBefore.length;
    return {
      strategy: "context",
      line: markdown.slice(0, startOffset).split(/\r?\n/).length - 1,
      startOffset,
      endOffset: startOffset + anchor.selectedText.length,
      confidence: 0.9,
      requiresConfirmation: false
    };
  }

  let bestLine = -1;
  let bestScore = 0;
  for (const [index, line] of lines.entries()) {
    const score = similarity(anchor.selectedText, line.replace(/\s+\^[\w-]+\s*$/, ""));
    if (score > bestScore) {
      bestScore = score;
      bestLine = index;
    }
  }
  if (bestLine >= 0 && bestScore >= 0.45) {
    return {
      strategy: "fuzzy",
      line: bestLine,
      confidence: bestScore,
      requiresConfirmation: true
    };
  }

  return {
    strategy: "not-found",
    confidence: 0,
    requiresConfirmation: false
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

