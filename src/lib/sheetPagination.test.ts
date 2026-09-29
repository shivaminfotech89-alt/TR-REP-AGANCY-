// Tests for lib/sheetPagination.ts - height-derived pagination (AUDIT O64 step 2). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packRows, rowBudgetOf, rowOffsets, seedChunks, SEED_ROWS_PER_SHEET, type RowLayout } from './sheetPagination';

/**
 * O58's SHEET, RECONSTRUCTED FROM THE FIGURES IT RECORDED - not invented numbers.
 *
 * O58 measured the internal inspection sheet on MEGHA's letterhead (64mm header, 25mm footer) in headless Chrome:
 *   - nine ONE-LINE rows leave 130.1px spare under the table, and the signature block is visible;
 *   - nine TWO-LINE rows cut the signature block off by 43.8px, and O64 records the block as 43.8px deep.
 *
 * The cut equals the block exactly, so nine two-line rows fill the body to its edge: chrome + 9*r2 = body. That
 * fixes the arithmetic - body less chrome is 9*r2, and the 130.1px spare is 9*(r2 - r1), so a second line on a row
 * costs 14.46px. A row's own height is `h-6`, 1.5rem, which printed at the 10pt root font is 20px.
 *
 * ⚠ THESE ARE DERIVED FROM TWO MEASUREMENTS, NOT MEASURED DIRECTLY. They fix the RELATIONSHIPS O58 recorded, which
 * is what the packing has to get right. The absolute body height is measured for real by measureRowLayout, and by
 * print-check against paper.
 */
const ONE_LINE = 20;
const TWO_LINE = 20 + 130.1 / 9;        // 34.46px - a wrapped make or serial
const SIGN_OFF = 43.8;                  // the block O58 lost, with its margin
const BODY_LESS_CHROME = 9 * TWO_LINE;  // 310.1px - nine two-line rows filled it exactly

const megha = (rowHeights: number[], lastSheetExtraHeight = SIGN_OFF): RowLayout => ({
  rowHeights,
  bodyHeight: BODY_LESS_CHROME + 100,   // any chrome; only the difference is spent on rows
  chromeHeight: 100,
  lastSheetExtraHeight,
});
const rows = (n: number, h: number) => Array.from({ length: n }, () => h);

test('the budget a sheet spends on rows is the body less its chrome, and the last sheet less the sign-off', () => {
  const b = rowBudgetOf(megha(rows(9, ONE_LINE)));
  assert.equal(Math.round(b.rowBudget), 310);
  assert.equal(Math.round(b.finalRowBudget), 266);
});

// -- The complaint: it spilled when it need not -----------------------------------------------------------------

test('thirteen one-line rows fit ONE sheet, where the constant sent ten to a second', () => {
  assert.deepEqual(packRows(megha(rows(13, ONE_LINE))).map(s => s.length), [13]);
});

test('ten to thirteen ordinary jobs all print on one sheet - the constant spilled every one of them', () => {
  for (const n of [10, 11, 12, 13]) {
    assert.deepEqual(packRows(megha(rows(n, ONE_LINE))).map(s => s.length), [n], `${n} rows`);
    assert.ok(n > SEED_ROWS_PER_SHEET, 'and the constant would have cut it');
  }
});

test('fourteen one-line rows genuinely do not fit, and spill', () => {
  const sheets = packRows(megha(rows(14, ONE_LINE)));
  assert.equal(sheets.length, 2);
  assert.equal(sheets.flat().length, 14, 'every row is on exactly one sheet');
});

// -- O58: it held when it must not ------------------------------------------------------------------------------

test('O58: nine TWO-LINE rows no longer keep one sheet and lose the signature block', () => {
  const layout = megha(rows(9, TWO_LINE));
  const sheets = packRows(layout);
  assert.equal(sheets.length, 2, 'nine wrapped rows plus the sign-off do not fit one sheet');
  const { rowBudget, finalRowBudget } = rowBudgetOf(layout);
  const last = sheets[sheets.length - 1];
  assert.ok(last.length * TWO_LINE <= finalRowBudget, 'the last sheet has room for the sign-off');
  for (const sheet of sheets.slice(0, -1)) {
    assert.ok(sheet.length * TWO_LINE <= rowBudget, 'no earlier sheet is overfilled');
  }
});

// -- The circularity - the part that reproduces O58 from principled-looking code --------------------------------

test('a deck that fits the body but NOT beside the sign-off is never emitted as one sheet', () => {
  // Exactly the trap: these rows fit rowBudget with room to spare, so a paginator that fills to the body's edge
  // and only then notices it is the final sheet prints O58 again.
  const layout = megha(rows(9, TWO_LINE));
  const { rowBudget, finalRowBudget } = rowBudgetOf(layout);
  const deck = 9 * TWO_LINE;
  assert.ok(deck <= rowBudget && deck > finalRowBudget, 'the deck is in the trap window');
  assert.notDeepEqual(packRows(layout).map(s => s.length), [9]);
});

test('a non-final sheet always leaves a row behind, so it cannot become the final sheet after all', () => {
  // Decks that genuinely spill - 14 one-line rows is the first. Ten to thirteen now fit one sheet, which is the fix.
  for (const n of [14, 15, 23, 40]) {
    const sheets = packRows(megha(rows(n, ONE_LINE)));
    assert.ok(sheets.length >= 2, `${n} rows spill`);
    assert.ok(sheets[0].length < n, `${n} rows: the first sheet left something behind`);
  }
});

test('the last sheet always has room for the sign-off and the scrap note together', () => {
  const scrapNote = 18;
  for (const n of [1, 5, 9, 13, 14, 20, 37]) {
    for (const h of [ONE_LINE, TWO_LINE]) {
      const layout = megha(rows(n, h), SIGN_OFF + scrapNote);
      const sheets = packRows(layout);
      const last = sheets[sheets.length - 1];
      assert.ok(
        last.length * h <= rowBudgetOf(layout).finalRowBudget,
        `${n} rows of ${h}px: the last sheet fits its sign-off and scrap note`,
      );
    }
  }
});

// -- It must terminate, and never emit nothing -----------------------------------------------------------------

test('no sheet is ever empty, at any deck size or row height', () => {
  for (let n = 1; n <= 60; n++) {
    for (const h of [ONE_LINE, TWO_LINE, 7, 120]) {
      const sheets = packRows(megha(rows(n, h)));
      assert.ok(sheets.every(s => s.length > 0), `${n} rows of ${h}px`);
      assert.deepEqual(sheets.flat(), Array.from({ length: n }, (_, k) => k), 'every row once, in order');
    }
  }
});

test('a single row taller than the whole budget is emitted rather than refused (G66: warn, never refuse)', () => {
  const sheets = packRows(megha(rows(3, 400)));   // each row alone overflows the body
  assert.deepEqual(sheets.map(s => s.length), [1, 1, 1]);
});

test('an empty deck is one empty sheet, as the constant produced', () => {
  assert.deepEqual(packRows(megha([])), [[]]);
});

test('a body too short for even one row plus the sign-off still terminates', () => {
  const sheets = packRows({ rowHeights: rows(4, 30), bodyHeight: 120, chromeHeight: 100, lastSheetExtraHeight: 44 });
  assert.equal(sheets.flat().length, 4);
  assert.ok(sheets.every(s => s.length > 0));
});

// -- The serial number ----------------------------------------------------------------------------------------

test('the running offset numbers rows correctly where pageIdx * CHUNK_SIZE does not', () => {
  const sheets = [[0, 1, 2, 3, 4, 5, 6], [7, 8]];       // what measured packing produces for O58's wrapped rows
  assert.deepEqual(rowOffsets(sheets), [0, 7]);
  // The old expression, with the constant it was written for: sheet 2's first row would print as Sr 10, not Sr 8.
  assert.equal(1 * SEED_ROWS_PER_SHEET + 0, 9);
  assert.equal(rowOffsets(sheets)[1] + 0, 7);
});

test('the offset holds across many sheets of differing sizes', () => {
  const sheets = [[0, 1, 2], [3, 4, 5, 6, 7, 8, 9], [10], [11, 12]];
  assert.deepEqual(rowOffsets(sheets), [0, 3, 10, 11]);
  sheets.forEach((sheet, i) => assert.equal(rowOffsets(sheets)[i], sheet[0], 'the offset is the first row of the sheet'));
});

// -- The range, on the bodies print-check actually measured ----------------------------------------------------

/**
 * THE THREE BODIES print-check MEASURED on 2026-09-29, in headless Chrome, in print media at 1123px - not derived.
 * MR 85558, 18 jobs. A row measured 20px unwrapped and 32.8px with a make or serial that wraps.
 *
 * The point of the pair: the SAME code gives an agency on a 64mm/25mm letterhead a different row count from an
 * agency with none, because the count comes from the body each one leaves. A constant raised to suit one is wrong
 * for the other - which is the answer to "why not just raise 9 to 14".
 */
const MEASURED = {
  letterhead: { bodyHeight: 414.9, chromeHeight: 92, lastSheetExtraHeight: 103.6 },   // sign-off and a scrap note
  letterheadNoScrapNote: { bodyHeight: 414.9, chromeHeight: 92, lastSheetExtraHeight: 71.4 },
  noLetterhead: { bodyHeight: 618.3, chromeHeight: 92, lastSheetExtraHeight: 103.6 },
};
const ROW_UNWRAPPED = 20;
const ROW_WRAPPED = 32.8;

test('the measured budgets are what print-check reported, to a tenth of a pixel', () => {
  assert.equal(Math.round(rowBudgetOf({ ...MEASURED.letterhead, rowHeights: [] }).rowBudget * 10) / 10, 322.9);
  assert.equal(Math.round(rowBudgetOf({ ...MEASURED.letterhead, rowHeights: [] }).finalRowBudget * 10) / 10, 219.3);
  assert.equal(Math.round(rowBudgetOf({ ...MEASURED.noLetterhead, rowHeights: [] }).rowBudget * 10) / 10, 526.3);
});

test('MEGHA letterhead: a lone sheet holds 10 unwrapped rows, against the constant 9', () => {
  const fits = (n: number) => packRows({ ...MEASURED.letterhead, rowHeights: rows(n, ROW_UNWRAPPED) }).length === 1;
  assert.ok(fits(10), '10 fit one sheet');
  assert.ok(!fits(11), '11 do not');
  assert.ok(fits(SEED_ROWS_PER_SHEET), 'and the old constant still fits, so nothing regressed');
});

test('MEGHA letterhead: the deck print-check printed is cut 15 + 3, and nothing is cut off', () => {
  // MR 85558 as it really is - a mix, 20px to 32.8px. The measured run printed 2 sheets, 0 mm lost.
  const real = [...rows(15, ROW_UNWRAPPED), ...rows(3, ROW_WRAPPED)];
  const sheets = packRows({ ...MEASURED.letterhead, rowHeights: real });
  assert.equal(sheets.length, 2);
  assert.deepEqual(sheets.map(s => s.length), [15, 3]);
});

test('MEGHA letterhead, every row wrapped - O58 exactly - is 3 sheets, and print-check lost nothing', () => {
  const sheets = packRows({ ...MEASURED.letterheadNoScrapNote, rowHeights: rows(18, ROW_WRAPPED) });
  assert.deepEqual(sheets.map(s => s.length), [9, 8, 1], 'the deck print-check printed');
  // And the nine the constant put on one sheet no longer sit with a sign-off that does not fit.
  assert.ok(9 * ROW_WRAPPED > rowBudgetOf({ ...MEASURED.letterheadNoScrapNote, rowHeights: [] }).finalRowBudget);
});

test('no letterhead: the same 18 jobs fit ONE sheet, where the constant made two', () => {
  const real = [...rows(15, ROW_UNWRAPPED), ...rows(3, ROW_WRAPPED)];
  assert.deepEqual(packRows({ ...MEASURED.noLetterhead, rowHeights: real }).map(s => s.length), [18]);
});

test('no letterhead: a lone sheet holds 21 unwrapped rows - the other end of the range', () => {
  const fits = (n: number) => packRows({ ...MEASURED.noLetterhead, rowHeights: rows(n, ROW_UNWRAPPED) }).length === 1;
  assert.ok(fits(21), '21 fit');
  assert.ok(!fits(22), '22 do not');
});

test('the range across the two letterheads is more than twice, which no single constant covers', () => {
  const lone = (m: typeof MEASURED.letterhead) => {
    let n = 1;
    while (packRows({ ...m, rowHeights: rows(n + 1, ROW_UNWRAPPED) }).length === 1) n++;
    return n;
  };
  assert.equal(lone(MEASURED.letterhead), 10);
  assert.equal(lone(MEASURED.noLetterhead), 21);
});

// -- The seed, for the first render and for a measurement that could not be taken ------------------------------

test('the seed cuts at the constant these sheets used to use, and never returns no sheets', () => {
  assert.deepEqual(seedChunks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).map(c => c.length), [9, 1]);
  assert.deepEqual(seedChunks([]), [[]]);
  assert.deepEqual(seedChunks([1, 2, 3], 8).map(c => c.length), [3]);
});
