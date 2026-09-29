/**
 * THE TWO PASSES THAT TURN A ROW COUNT INTO A MEASURED ONE (AUDIT O64 step 2).
 *
 * O64 step 2 asks for two passes, "render, measure each row, then lay out", because these rows WRAP and a wrapped
 * row is what O58 lost a signature block to. A row's height cannot be assumed the way the estimate's `ROW_MM`
 * assumes one, so:
 *
 *   1. render at the seed count - the constant the sheet used to be cut at;
 *   2. measure every row AS PRINTED, in a hidden frame at the paper's width (`measureRowLayout`);
 *   3. pack by measured height (`packRows`) and re-render.
 *
 * It settles after step 3: a row's height does not depend on which sheet it lands on, because every sheet's body is
 * the same width. The re-measure that follows the re-render computes the same sizes and changes nothing.
 *
 * ⚠ IT FALLS BACK RATHER THAN FAILS. No frame, no marks, a measurement that throws - the sheet keeps the seed count
 * and prints as it did before this change, and G66's warning still says what is lost. A document that will not
 * measure must still print.
 */
import { useEffect, useMemo, useState } from 'react';
import { measureRowLayout } from './printUtils';
import { packRows, rowBudgetOf, rowOffsets, seedChunks, SEED_ROWS_PER_SHEET, type RowLayout } from './sheetPagination';

/** What the sheet needs to render: the rows of each sheet, and where each sheet starts in the whole deck. */
export interface MeasuredChunks<T> {
  chunks: T[][];
  /** Each sheet's first row index in the whole deck - the running offset a serial number needs, never pageIdx * N. */
  offsets: number[];
  /** What the measurement found, for a report or a console line. Null until a measurement has succeeded. */
  layout: RowLayout | null;
}

/** How long after the sheets settle to measure - the interval G66's on-screen bars already use. */
const SETTLE_MS = 400;

/**
 * WHAT THE MEASUREMENT DECIDED, ON THE CONTAINER - so a check, a console or a report can read the budget rather than
 * infer it from the sheet count. Attributes only; nothing is styled from them and no layout moves.
 *
 * `rows-per-sheet` is how many of THESE rows the body holds beside the sign-off - the figure that replaces the
 * constant, and the one that differs between an agency with a tall letterhead and one with none.
 */
function publishBudget(container: Element, layout: RowLayout, packed: number[][]): void {
  const { rowBudget, finalRowBudget } = rowBudgetOf(layout);
  const set = (name: string, value: number) => container.setAttribute(name, String(Math.round(value * 10) / 10));
  set('data-row-budget-px', rowBudget);
  set('data-final-row-budget-px', finalRowBudget);
  set('data-body-height-px', layout.bodyHeight);
  set('data-chrome-height-px', layout.chromeHeight);
  set('data-last-extra-px', layout.lastSheetExtraHeight);
  set('data-rows-per-sheet', packed[0]?.length ?? 0);
  // The measured row heights themselves, so a report states what a row costs instead of dividing the budget by the
  // rows that happened to fit - and so the spread between a short row and a wrapped one is visible.
  if (layout.rowHeights.length) {
    set('data-row-min-px', Math.min(...layout.rowHeights));
    set('data-row-max-px', Math.max(...layout.rowHeights));
    // How many rows a SINGLE sheet holds - the figure "an MR fits one page" actually turns on, which is smaller than
    // a continuation sheet's because the single sheet is also the last one and carries the sign-off.
    set('data-rows-on-a-lone-sheet', Math.floor(finalRowBudget / Math.max(...layout.rowHeights)));
  }
  container.setAttribute('data-sheet-sizes', packed.map(s => s.length).join(','));
}

export function useMeasuredRowChunks<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  containerId: string,
  options: { seed?: number; enabled?: boolean } = {},
): MeasuredChunks<T> {
  const { seed = SEED_ROWS_PER_SHEET, enabled = true } = options;

  /**
   * WHAT WAS MEASURED, AND WHICH DECK IT WAS MEASURED FOR - held together, and read as derived state.
   *
   * The sheet sizes are kept rather than the rows: the row objects change identity whenever the screen reloads its
   * data, and holding them here would paginate a deck that is no longer on screen.
   *
   * ⚠ THE SIGNATURE IS STORED BESIDE THE SIZES, NOT COMPARED AGAINST A REF DURING RENDER. Resetting state in the
   * render pass - `if (ref.current !== signature) setSizes(null)` - mutates the ref even on a render React then
   * throws away, and the reset can be lost while the ref says it happened. Stale sizes against a new deck would cut
   * the deck at another deck's sizes. Derived, a measurement simply does not apply to a deck it was not taken for.
   */
  const [measured, setMeasured] = useState<{ signature: string; sizes: number[]; layout: RowLayout } | null>(null);

  const signature = JSON.stringify(rows.map(keyOf));
  const applies = measured?.signature === signature ? measured : null;
  const sizes = applies?.sizes ?? null;
  const layout = applies?.layout ?? null;

  const chunks = useMemo(() => {
    if (!sizes) return seedChunks(rows, seed);
    const out: T[][] = [];
    let at = 0;
    for (const size of sizes) { out.push(rows.slice(at, at + size) as T[]); at += size; }
    // Anything the sizes did not account for still has to print. It cannot happen while the signature guard holds;
    // a row that vanished from a sheet would be worse than an unbalanced one.
    if (at < rows.length) out.push(rows.slice(at) as T[]);
    if (out.length === 0) out.push([]);
    return out;
  }, [rows, sizes, seed]);

  useEffect(() => {
    if (!enabled || sizes || rows.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => { void measure(); }, SETTLE_MS);

    async function measure() {
      try {
        const container = document.getElementById(containerId);
        if (!container) return;
        const found = await measureRowLayout(container);
        if (cancelled || !found) return;
        const packed = packRows(found.layout);
        if (cancelled) return;
        publishBudget(container, found.layout, packed);
        setMeasured({ signature, sizes: packed.map(s => s.length), layout: found.layout });
      } catch (err) {
        // The seed count stands, and G66's warning still reports whatever that loses.
        console.warn('Could not measure the rows to paginate by height; keeping the seed count.', err);
      }
    }

    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [enabled, sizes, containerId, signature, rows.length]);

  return { chunks, offsets: rowOffsets(chunks), layout };
}
