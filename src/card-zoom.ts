// Pure zoom math for the margin annotation cards. Lives apart from margin-card.ts
// (which imports `obsidian` and so can't be unit-tested) so the clamp/step logic
// can be exercised in isolation. CTRL+scroll over a card nudges its text scale by
// one step; the result drives the `--atl-card-scale` CSS variable.

/** Smallest text scale a card can shrink to (60%). */
export const MIN_CARD_SCALE = 0.6;
/** Largest text scale a card can grow to (250%). */
export const MAX_CARD_SCALE = 2.5;
/** How much one wheel notch changes the scale. */
export const CARD_SCALE_STEP = 0.1;

/**
 * The card text scale after one CTRL+scroll notch. Scrolling up (`deltaY < 0`)
 * zooms in, down zooms out, by one `CARD_SCALE_STEP`, clamped to
 * `[MIN_CARD_SCALE, MAX_CARD_SCALE]` and rounded to 2 decimals (so repeated steps
 * don't drift into long floats). Returns `current` unchanged at a bound or when
 * `deltaY` is 0.
 */
export function nextCardScale(current: number, deltaY: number): number {
  if (deltaY === 0) return current;
  const direction = deltaY < 0 ? 1 : -1;
  const raw = current + direction * CARD_SCALE_STEP;
  const clamped = Math.min(MAX_CARD_SCALE, Math.max(MIN_CARD_SCALE, raw));
  return Math.round(clamped * 100) / 100;
}
