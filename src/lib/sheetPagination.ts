/**
 * HEIGHT-DERIVED PAGINATION FOR THE FIXED-COUNT SHEETS (AUDIT O64 step 2).
 *
 * The sheets that print a table of jobs cut their deck at a constant - `CHUNK_SIZE = 9` on the inspection
 * sheets, 8 on the testing report. A constant is wrong in BOTH directions, and one number cannot do both jobs
 * because a row's height depends on its data:
 *
 *   - IT SPILLS WHEN IT NEED NOT. On MEGHA's letterhead, nine ONE-LINE rows leave ~34mm spare (O58), so an MR
 *     of ten to fourteen ordinary jobs prints a second landscape sheet carrying one row and the sign-off.
 *   - IT HOLDS WHEN IT MUST NOT. Nine rows that WRAP to two lines overflow by ~12mm and take the whole
 *     signature block with them - Inspected By, Executive Engineer and the agency's signatory (O58).
 *
 * So the row count is derived from the measured body instead. This module is the decision; the measuring is
 * `measureRowLayout` in printUtils, and it measures AS PRINTED - see the warning there.
 *
 * ⚠ THE LAST SHEET'S FIT IS CIRCULAR, AND THIS IS THE PART THAT REPRODUCES O58 IF IT IS GOT WRONG.
 * The signature block and the scrap note render ONLY on the last sheet. So "does this row fit?" has no answer
 * until it is known whether this sheet is the last - and packing that row on is what MAKES it the last, which
 * adds the sign-off, which is what overflows. A paginator that fills each sheet to the body's edge and then
 * discovers it was the final one prints O58's defect again, from principled-looking code.
 *
 * `packRows` answers it in the only order that terminates: a sheet is the last one exactly when it takes every
 * remaining row, so the FIRST question asked of each sheet is whether all the rest fit BESIDE THE SIGN-OFF. If
 * they do, that is the last sheet and it is whole. If they do not, this sheet is not the last, it is filled
 * against the budget WITHOUT the sign-off, and it must leave at least one row behind - otherwise it would
 * consume the deck and become the last sheet after all, which is the bug.
 */

/** Everything measured from one printed layout that decides where the deck is cut. All heights in CSS pixels. */
export interface RowLayout {
  /** Each row's printed height, in the order the rows print. */
  rowHeights: number[];
  /** The clipping body's content height - what a sheet has to spend (PrintableA4Page's `flex-1 overflow-hidden`). */
  bodyHeight: number;
  /** What every sheet spends before a single row: the MR header line and its margin, the table's own header and borders. */
  chromeHeight: number;
  /** What ONLY THE LAST SHEET spends: the signature block with its margin, and the scrap note when there is one. */
  lastSheetExtraHeight: number;
}

/** How many rows a sheet holds, and what it would have held without the last sheet's sign-off - for reporting. */
export interface RowBudget {
  /** Height a sheet that is NOT the last may spend on rows. */
  rowBudget: number;
  /** Height the LAST sheet may spend on rows - `rowBudget` less the sign-off and scrap note. */
  finalRowBudget: number;
}

export function rowBudgetOf(layout: RowLayout): RowBudget {
  const rowBudget = layout.bodyHeight - layout.chromeHeight;
  return { rowBudget, finalRowBudget: rowBudget - layout.lastSheetExtraHeight };
}

/**
 * The deck cut into sheets, as arrays of row indices. Fewest sheets the measured heights allow.
 *
 * Greedy-maximal on every sheet but the last, which is what "fit one page where they can" asks for: filling each
 * sheet as far as it goes minimises the number of sheets AND leaves the fewest rows for the final sheet, which is
 * the best case for the sign-off fitting there. Balancing the rows evenly across sheets is deliberately NOT done -
 * it would look tidier and cost a sheet.
 *
 * ⚠ IT NEVER EMITS A SHEET WITH NO ROWS, and it never loops. A single row taller than the whole budget - a body
 * shortened by an extreme letterhead - is emitted on its own sheet and prints short; the operator is told how many
 * millimetres by G66's warning. That is the standing decision: warn, never refuse (G66).
 */
export function packRows(layout: RowLayout): number[][] {
  const { rowHeights } = layout;
  const n = rowHeights.length;
  if (n === 0) return [[]];

  const { rowBudget, finalRowBudget } = rowBudgetOf(layout);
  const sheets: number[][] = [];
  const indices = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => from + k);
  const heightOf = (from: number, to: number) => rowHeights.slice(from, to).reduce((a, b) => a + b, 0);

  let i = 0;
  while (i < n) {
    // THE LAST-SHEET QUESTION, ASKED FIRST. Every remaining row, beside the sign-off?
    if (heightOf(i, n) <= finalRowBudget) { sheets.push(indices(i, n)); return sheets; }

    // Not the last sheet. Fill it - but leave a row behind, or it becomes the last sheet and the sign-off is cut.
    const mustLeaveFor = n - i - 1;
    let take = 0;
    let used = 0;
    while (take < mustLeaveFor) {
      const h = rowHeights[i + take];
      if (take > 0 && used + h > rowBudget) break;
      used += h;
      take += 1;
    }
    if (take === 0) take = 1;   // one row that cannot fit even alone: emit it, and the warning reports the cut
    sheets.push(indices(i, i + take));
    i += take;
  }
  return sheets;
}

/** Where each sheet's first row sits in the whole deck - the running offset a serial number needs (O64). */
export function rowOffsets(sheets: readonly (readonly unknown[])[]): number[] {
  const offsets: number[] = [];
  let at = 0;
  for (const sheet of sheets) { offsets.push(at); at += sheet.length; }
  return offsets;
}

/**
 * ⚠ THE SERIAL NUMBER CANNOT BE `pageIdx * CHUNK_SIZE + cIdx` ANY MORE, and that expression passes review because
 * it looks arithmetically innocent (O64). With a constant chunk it is right; with measured chunks every row after
 * the first sheet is mis-numbered, silently, on a signed document. Use `rowOffsets`.
 */

/** A count to render with before anything has been measured - the constant these sheets used to be cut at. */
export const SEED_ROWS_PER_SHEET = 9;

/** The deck cut at a constant, for the first render and for a measurement that could not be taken. */
export function seedChunks<T>(rows: readonly T[], perSheet: number = SEED_ROWS_PER_SHEET): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += perSheet) chunks.push(rows.slice(i, i + perSheet) as T[]);
  if (chunks.length === 0) chunks.push([]);
  return chunks;
}
