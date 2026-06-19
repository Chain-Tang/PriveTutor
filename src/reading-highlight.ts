// Highlighting the annotated span in Obsidian Reading view. The editor uses
// CodeMirror decorations (decorations.ts); rendered preview has only the DOM, so
// we find the selected text inside a rendered block and wrap it in styled span(s)
// that double as the comment toggle. Rendered text differs from the source — a
// soft line break collapses to a space (or nothing, e.g. CJK) and inline markup
// (**bold**, links) splits a run across several text nodes — so the match must
// tolerate whitespace and span node boundaries. The locating maths is pure and
// unit-tested here; only `highlightFirst`/`wrapRange` touch the DOM.

/** Where a match sits in the concatenated raw text of a block's text nodes. */
export type RawSpan = { start: number; end: number };

/**
 * Find `text` inside `raw` (the concatenated text-node contents of a block),
 * tolerating whitespace differences via `joiner`: " " collapses every whitespace
 * run to a single space (a soft break rendered as a space), "" drops whitespace
 * entirely (a soft break rendered as nothing, as between CJK lines). Returns the
 * raw [start, end) offsets of the match, or null when it is not present.
 */
export function locateNormalized(
  raw: string,
  text: string,
  joiner: "" | " "
): RawSpan | null {
  const norm: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  while (i < raw.length) {
    const ch = raw.charAt(i);
    if (/\s/.test(ch)) {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw.charAt(j))) j += 1;
      if (joiner) {
        norm.push(joiner);
        starts.push(i);
        ends.push(j);
      }
      i = j;
    } else {
      norm.push(ch);
      starts.push(i);
      ends.push(i + 1);
      i += 1;
    }
  }
  const needle = joiner ? text.replace(/\s+/g, " ").trim() : text.replace(/\s+/g, "");
  if (!needle) return null;
  const at = norm.join("").indexOf(needle);
  if (at < 0) return null;
  const start = starts[at];
  const end = ends[at + needle.length - 1];
  if (start === undefined || end === undefined) return null;
  return { start, end };
}

/** Locate `text` in `raw`, first as space-collapsed then as whitespace-removed. */
export function locateInRaw(raw: string, text: string): RawSpan | null {
  return locateNormalized(raw, text, " ") ?? locateNormalized(raw, text, "");
}

/**
 * Wrap the first occurrence of `text` within `el` in styled span(s), tagged with
 * the annotation id and clickable so the highlight itself toggles the comment.
 * The match may cross inline markup and soft line breaks, so each text-node
 * segment of it is wrapped separately. Returns whether anything was highlighted,
 * so the caller can fall back to a glyph marker.
 */
export function highlightFirst(
  el: HTMLElement,
  text: string,
  cls: string,
  id: string,
  onClick: (id: string, anchor: HTMLElement) => void
): boolean {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  if (nodes.length === 0) return false;
  const raw = nodes.map((node) => node.nodeValue ?? "").join("");
  const span = locateInRaw(raw, text);
  if (!span) return false;
  return wrapRange(nodes, span.start, span.end, cls, id, onClick);
}

/** Wrap every text-node segment overlapping [start, end) in its own styled span. */
function wrapRange(
  nodes: Text[],
  start: number,
  end: number,
  cls: string,
  id: string,
  onClick: (id: string, anchor: HTMLElement) => void
): boolean {
  let pos = 0;
  let any = false;
  for (const node of nodes) {
    const nodeStart = pos;
    pos += (node.nodeValue ?? "").length;
    const from = Math.max(start, nodeStart);
    const to = Math.min(end, pos);
    if (from >= to) continue;
    const range = document.createRange();
    range.setStart(node, from - nodeStart);
    range.setEnd(node, to - nodeStart);
    const span = document.createElement("span");
    span.className = cls;
    span.dataset["atlId"] = id;
    span.addEventListener("click", (event) => {
      event.preventDefault();
      onClick(id, span);
    });
    try {
      // Each segment is within one text node, so surroundContents never splits a
      // non-text node and so never throws here.
      range.surroundContents(span);
      any = true;
    } catch {
      // Defensive: skip a segment that unexpectedly resists wrapping.
    }
  }
  return any;
}
