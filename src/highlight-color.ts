// Pure helpers for the configurable annotation highlight color. Free of any
// runtime imports (no Obsidian, no DOM) so it can be unit-tested directly.
//
// The stored `highlightColor` is either "" (follow the theme accent — the CSS
// falls back to `var(--text-accent)`) or a hex color the learner picked. These
// helpers validate it and turn it into the CSS custom properties that drive the
// underline/bold tint and the translucent background-tint fill.

/** A 3- or 6-digit hex color with a leading `#`, case-insensitive. */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Opacity of the background-tint style when a custom color is set. */
const BG_TINT_ALPHA = 0.25;

/** Whether `value` is a hex color we accept for the annotation highlight. */
export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value.trim());
}

/**
 * Normalize a stored highlight color to a canonical form: a valid hex becomes
 * lower-cased (with its `#`), and anything else — including the empty "follow
 * the theme accent" sentinel and any invalid input — becomes "".
 */
export function normalizeHighlightColor(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return isHexColor(trimmed) ? trimmed.toLowerCase() : "";
}

/** Expand a `#rgb`/`#rrggbb` color to its 6-digit body (no `#`). */
function expandHex(hex: string): string {
  const body = hex.trim().slice(1);
  return body.length === 3
    ? body
        .split("")
        .map((char) => char + char)
        .join("")
    : body;
}

/** Parse a hex color to its r/g/b channels (0–255), or null when invalid. */
export function hexToRgb(
  hex: string
): { r: number; g: number; b: number } | null {
  if (!isHexColor(hex)) return null;
  const body = expandHex(hex);
  return {
    r: Number.parseInt(body.slice(0, 2), 16),
    g: Number.parseInt(body.slice(2, 4), 16),
    b: Number.parseInt(body.slice(4, 6), 16)
  };
}

/** The CSS custom properties that tint the annotation highlight. */
export type HighlightColorVars = {
  "--atl-hl-color": string;
  "--atl-hl-bg-color": string;
};

/**
 * The CSS custom properties for a custom highlight color, or null when following
 * the theme accent (color is ""/invalid). `--atl-hl-color` tints the
 * dotted/wavy underline and bold text; `--atl-hl-bg-color` is a translucent fill
 * for the background-tint style so a solid accent never overwhelms the text.
 */
export function highlightColorVars(color: string): HighlightColorVars | null {
  const rgb = hexToRgb(color);
  if (!rgb) return null;
  return {
    "--atl-hl-color": color.trim().toLowerCase(),
    "--atl-hl-bg-color": `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${BG_TINT_ALPHA})`
  };
}
