/**
 * HOW MUCH OF A PRINTED SHEET WILL BE CUT OFF - IN MILLIMETRES, BEFORE ANYTHING IS PRINTED (AUDIT O64, G66).
 *
 * PrintableA4Page's body sits between the letterhead's header and footer reservations, and hides overflow. Content
 * past it is cut off on the preview and on paper, and nothing said so: an inspection sheet lost its whole signature
 * block (O58), the multi-job sheet its sign-off (O63). This measures the loss so the sheet, and the print window
 * before its dialog, can say the number.
 *
 * ⚠ IT WARNS; IT NEVER REFUSES, by decision. A document that prints short can be seen to be short. A refused one
 * cannot be seen at all, and these are documents someone needs today.
 *
 * No DOM or React import: the arithmetic and the wording are testable under `npm test`.
 */

/** Below this, a measured overflow is sub-pixel rounding or font-loading jitter, not lost content (G23's floor). */
export const CUTOFF_FLOOR_MM = 1;

export interface Box { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface Cutoff { bottomMm: number; rightMm: number }

/**
 * The cut-off of a clipping body, from the boxes of everything inside it.
 *
 * ⚠ THE FURTHEST DESCENDANT EDGE, NOT THE BODY'S scrollHeight. The body is a flex column: its children can be sized
 * to it while their own content runs past, and then the body itself reports nothing wrong (G23). What print loses is
 * whatever extends past the body's box.
 *
 * `mmPerPx` comes from the page's own rendered width against its paper width, so a scaled or zoomed preview measures
 * the same millimetres as an unscaled one. Rounded UP: "4 mm" means at least that much is lost.
 */
export function cutoffOf(body: Box, inner: Box[], mmPerPx: number): Cutoff {
  let bottomPx = 0;
  let rightPx = 0;
  for (const b of inner) {
    if (b.width === 0 && b.height === 0) continue;
    bottomPx = Math.max(bottomPx, b.bottom - body.bottom);
    rightPx = Math.max(rightPx, b.right - body.right);
  }
  const mm = (px: number) => {
    const v = px * mmPerPx;
    return v >= CUTOFF_FLOOR_MM ? Math.ceil(v - 1e-9) : 0;
  };
  return { bottomMm: mm(bottomPx), rightMm: mm(rightPx) };
}

export const hasCutoff = (c: Cutoff | null | undefined): boolean => !!c && (c.bottomMm > 0 || c.rightMm > 0);

/** What will be lost from one sheet, as a clause - always a number, never "may overflow". Null when nothing is. */
export function describeCutoff(c: Cutoff): string | null {
  const parts: string[] = [];
  if (c.bottomMm > 0) parts.push(`${c.bottomMm} mm at the bottom`);
  if (c.rightMm > 0) parts.push(`${c.rightMm} mm at the right edge`);
  return parts.length ? `${parts.join(' and ')} will be cut off when printed` : null;
}

/** One line per sheet that loses anything, numbered as the reader counts sheets: "Sheet 2 of 3: 4 mm at the bottom ...". */
export function summariseSheets(sheets: Cutoff[]): string[] {
  return sheets
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => hasCutoff(c))
    .map(({ c, i }) => `Sheet ${i + 1} of ${sheets.length}: ${describeCutoff(c)}`);
}

/**
 * Whether one query of a media list holds WHEN PRINTED - the question the screen cannot answer for itself (G66).
 * Print and all match; screen and every other media type do not. `featureMatches` answers the rest of the query -
 * width and every other feature - in a window as wide as the paper.
 */
export function printMediumMatches(medium: string, featureMatches: (query: string) => boolean): boolean {
  const m = medium.trim().match(/^(only\s+)?(not\s+)?([a-z-]+)?\s*(?:\band\b\s*)?(.*)$/i);
  if (!m) return false;
  const [, , not, type, rest] = m;
  const features = rest.trim();
  const holds = (!type || /^(all|print)$/i.test(type)) && (features === '' || featureMatches(features));
  return not ? !holds : holds;
}

/** The attributes PrintableA4Page writes its measurement to, and the print window reads it from. */
export const CUTOFF_ATTR = { bottom: 'data-cutoff-bottom-mm', right: 'data-cutoff-right-mm' } as const;

/** Marks an element as belonging to the screen only: the Word export drops it, print hides it. */
export const SCREEN_ONLY_ATTR = 'data-screen-only';
