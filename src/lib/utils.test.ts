// Tests for lib/utils.ts (AUDIT G94). Run with `npm test`.
//
// ⚠ EVERY ONE OF THE SEVENTEEN LIVE `atNumber` VALUES IS ASSERTED HERE, not a sample. The
// rule `shortAtNumber` implements - shorten a recognised tender reference, return anything
// else untouched - is only worth anything if the "anything else" cases are the real ones,
// and two of the seventeen are not tender references at all. A sample would have contained
// the easy dozen and none of the hard two.
//
// Read out of Firestore on 2026-09-16 with a read-only script. If a new format appears in
// live data, add it here FIRST and let the test fail, rather than adjusting the regex until
// a screen looks right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortAtNumber } from './utils';

test('⚠ a full UGVCL reference shortens to period and serial', () => {
  assert.equal(shortAtNumber('UGVCL/EE-T-1/TRANS-REP/2026-28/01/AT/1819'), '26-28/1819');
  assert.equal(shortAtNumber('UGVCL/2026-28/01/AT/1819'), '26-28/1819');
  assert.equal(shortAtNumber('UGVCL/EE-T-1/TRANS-REP/2026-28/01/AT/1808 ,07/09/2026'), '26-28/1808');
});

test('⚠ a serial with no /AT/ label before it is still found', () => {
  // The last long digit run after the period. `01` is rejected as too short to identify
  // anything - every tender has one.
  assert.equal(shortAtNumber('UGVCL/EE-T-1/TRANS-REP/2020-21/1087'), '20-21/1087');
  assert.equal(shortAtNumber('2020-21/01/1049'), '20-21/1049');
});

test('a partial reference with no discom prefix shortens the same way', () => {
  assert.equal(shortAtNumber('2026-28/AT/1819'), '26-28/1819');
});

test('⚠ values that are ALREADY short come back as a bare period, not mangled', () => {
  assert.equal(shortAtNumber('2026-27'), '26-27');
  assert.equal(shortAtNumber('2026-28'), '26-28');
  assert.equal(shortAtNumber('2020-2021'), '20-21');
  assert.equal(shortAtNumber('26-27'), '26-27');
  assert.equal(shortAtNumber('24-25'), '24-25');
  assert.equal(shortAtNumber('AT-2026-28'), '26-28');
  assert.equal(shortAtNumber('AT2026-27'), '26-27');
  assert.equal(shortAtNumber('AT 26-27'), '26-27');
  assert.equal(shortAtNumber('2026_27'), '26-27');
});

test('⚠⚠ A VALUE THAT IS NOT A TENDER REFERENCE IS RETURNED UNTOUCHED', () => {
  // This is the case the whole design turns on. An allotment number reduced to something
  // that LOOKS like a tender period would read as deliberate and be wrong; left long it
  // only reads as untidy. If this test ever starts failing, the regex has grown too greedy.
  const notATender = 'ALLOTMENT NO.25903,DT.10/09/26';
  assert.equal(shortAtNumber(notATender), notATender);
});

test('empty, blank and absent are empty - never the string "undefined"', () => {
  assert.equal(shortAtNumber(''), '');
  assert.equal(shortAtNumber('   '), '');
  assert.equal(shortAtNumber(null), '');
  assert.equal(shortAtNumber(undefined), '');
});

test('⚠ a name that is not a number at all is left alone', () => {
  // `name` is rendered through the same `atNumber || name` fallback on several surfaces.
  assert.equal(shortAtNumber('ANNUAL'), 'ANNUAL');
  assert.equal(shortAtNumber('ANNUAL '), 'ANNUAL');
  assert.equal(shortAtNumber('PRIVIOUS YEAR'), 'PRIVIOUS YEAR');
  assert.equal(shortAtNumber('11101'), '11101');
  assert.equal(shortAtNumber('1011'), '1011');
});

test('⚠ the output is never longer than the input', () => {
  // A shortener that lengthens anything has misread it. Cheap, and it covers formats nobody
  // has thought of yet.
  const live = [
    'UGVCL/2026-28/01/AT/1819', 'AT-2026-28', '2020-2021', '2026-28', '2026-27',
    'UGVCL/EE-T-1/TRANS-REP/2026-28/01/AT/1819', '2026_27',
    'UGVCL/EE-T-1/TRANS-REP/2020-21/1087', '24-25', '2026-28/AT/1819',
    '2020-21/01/1049', 'AT2026-27', 'ALLOTMENT NO.25903,DT.10/09/26', 'AT 26-27',
    'UGVCL/EE-T-1/TRANS-REP/2026-28/01/AT/1808 ,07/09/2026',
  ];
  for (const v of live) {
    assert.ok(
      shortAtNumber(v).length <= v.trim().length,
      `shortAtNumber(${JSON.stringify(v)}) = ${JSON.stringify(shortAtNumber(v))} is longer than its input`,
    );
  }
});
