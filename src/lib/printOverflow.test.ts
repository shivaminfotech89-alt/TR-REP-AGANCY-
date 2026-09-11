// Tests for lib/printOverflow.ts (AUDIT G66). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutoffOf, describeCutoff, summariseSheets, hasCutoff, printMediumMatches, CUTOFF_FLOOR_MM } from './printOverflow';

const MM_PER_PX = 25.4 / 96;   // an unscaled page: 1 CSS px is 1/96 inch
const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
const body = box(0, 0, 700, 800);

test('content inside the body is not cut off', () => {
  assert.deepEqual(cutoffOf(body, [box(0, 0, 700, 800), box(10, 700, 690, 790)], MM_PER_PX), { bottomMm: 0, rightMm: 0 });
});

test('content past the bottom is reported in whole millimetres, rounded up', () => {
  // 15px past the body is 3.97mm - at least 4mm is lost.
  assert.deepEqual(cutoffOf(body, [box(10, 780, 690, 815)], MM_PER_PX), { bottomMm: 4, rightMm: 0 });
});

test('the furthest descendant decides, not the first or the last', () => {
  const inner = [box(0, 0, 700, 805), box(0, 0, 700, 876), box(0, 0, 700, 810)];
  assert.equal(cutoffOf(body, inner, MM_PER_PX).bottomMm, Math.ceil(76 * MM_PER_PX));
});

test('content past the right edge is reported separately', () => {
  assert.deepEqual(cutoffOf(body, [box(0, 0, 738, 100)], MM_PER_PX), { bottomMm: 0, rightMm: Math.ceil(38 * MM_PER_PX) });
});

test(`under ${CUTOFF_FLOOR_MM} mm is rounding, not lost content`, () => {
  assert.deepEqual(cutoffOf(body, [box(0, 0, 700, 803)], MM_PER_PX), { bottomMm: 0, rightMm: 0 });   // 0.79mm
});

test('a zero-size element is ignored, wherever it sits', () => {
  assert.deepEqual(cutoffOf(body, [{ left: 0, top: 2000, right: 0, bottom: 2000, width: 0, height: 0 }], MM_PER_PX), { bottomMm: 0, rightMm: 0 });
});

test('a scaled preview measures the same millimetres', () => {
  const half = MM_PER_PX * 2;   // the page drawn at half size: each px is twice the millimetres
  const scaledBody = box(0, 0, 350, 400);
  assert.equal(cutoffOf(scaledBody, [box(0, 390, 350, 407.5)], half).bottomMm, cutoffOf(body, [box(0, 780, 700, 815)], MM_PER_PX).bottomMm);
});

test('the wording always says the number', () => {
  assert.equal(describeCutoff({ bottomMm: 4, rightMm: 0 }), '4 mm at the bottom will be cut off when printed');
  assert.equal(describeCutoff({ bottomMm: 12, rightMm: 3 }), '12 mm at the bottom and 3 mm at the right edge will be cut off when printed');
  assert.equal(describeCutoff({ bottomMm: 0, rightMm: 0 }), null);
});

test('a sheet is named as the operator knows it, not by its position', () => {
  const lines = summariseSheets([
    { name: 'Bill forwarding letter', bottomMm: 0, rightMm: 0 },
    { name: 'Guarantee certificate', bottomMm: 0, rightMm: 0 },
    { name: 'Tax invoice', bottomMm: 12, rightMm: 0 },
    { name: 'Oil account sheet', bottomMm: 0, rightMm: 0 },
  ]);
  assert.deepEqual(lines, ['Tax invoice: 12 mm at the bottom will be cut off when printed']);
});

test('a name several sheets share is counted among those sheets only', () => {
  const lines = summariseSheets([
    { name: 'Estimate forwarding letter', bottomMm: 0, rightMm: 0 },
    { name: 'Estimate for job KLL-7', bottomMm: 0, rightMm: 0 },
    { name: 'Estimate for job KLL-7', bottomMm: 3, rightMm: 0 },
    { name: 'Estimate for job KLL-8', bottomMm: 6, rightMm: 0 },
  ]);
  assert.deepEqual(lines, [
    'Estimate for job KLL-7, sheet 2 of 2: 3 mm at the bottom will be cut off when printed',
    'Estimate for job KLL-8: 6 mm at the bottom will be cut off when printed',
  ]);
});

test('a sheet with no name, or a blank one, falls back to its position among all sheets', () => {
  const lines = summariseSheets([{ name: 'Tax invoice', bottomMm: 0, rightMm: 0 }, { name: '  ', bottomMm: 4, rightMm: 0 }, { bottomMm: 0, rightMm: 2 }]);
  assert.deepEqual(lines, ['Sheet 2 of 3: 4 mm at the bottom will be cut off when printed', 'Sheet 3 of 3: 2 mm at the right edge will be cut off when printed']);
});

test('a document names only the sheets that lose anything, counted as a reader counts them', () => {
  const lines = summariseSheets([{ bottomMm: 0, rightMm: 0 }, { bottomMm: 4, rightMm: 0 }, { bottomMm: 0, rightMm: 0 }]);
  assert.deepEqual(lines, ['Sheet 2 of 3: 4 mm at the bottom will be cut off when printed']);
  assert.deepEqual(summariseSheets([{ bottomMm: 0, rightMm: 0 }]), []);
  assert.equal(hasCutoff(null), false);
});

test('printed, print rules hold and screen rules do not', () => {
  const never = () => { throw new Error('no feature to ask about'); };
  assert.equal(printMediumMatches('print', never), true);
  assert.equal(printMediumMatches('all', never), true);
  assert.equal(printMediumMatches('screen', never), false);
  assert.equal(printMediumMatches('only screen', never), false);
  assert.equal(printMediumMatches('not print', never), false);
  assert.equal(printMediumMatches('not screen', never), true);
});

test('printed, width and the other features are asked of the paper, exactly as written', () => {
  const asked: string[] = [];
  const paper = (answer: boolean) => (q: string) => { asked.push(q); return answer; };
  assert.equal(printMediumMatches('(width >= 40rem)', paper(true)), true);
  assert.equal(printMediumMatches('print and (min-width: 1024px)', paper(false)), false);
  assert.equal(printMediumMatches('screen and (min-width: 1px)', paper(true)), false);
  assert.deepEqual(asked, ['(width >= 40rem)', '(min-width: 1024px)']);
});

test('a rule already rewritten reads the same again', () => {
  assert.equal(printMediumMatches('all', () => false), true);
  assert.equal(printMediumMatches('not all', () => true), false);
});
