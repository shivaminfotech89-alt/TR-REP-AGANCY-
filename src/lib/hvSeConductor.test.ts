// Tests for lib/hvSeConductor.ts - the HV coil conductor's insulation (AUDIT G105). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COPPER_HV_SCHEDULE_ROW, HV_SE_NOT_APPLICABLE, HV_SE_OPTIONS, HV_SE_WITH, HV_SE_WITHOUT, hvSeApplies,
} from './hvSeConductor';

// ── The question arises for aluminium only ───────────────────────────────────────────────────────────────────

test('the S.E./DPC question does not arise for copper', () => {
  assert.equal(hvSeApplies('Copper'), false);
});

test('it does arise for aluminium', () => {
  assert.equal(hvSeApplies('Aluminium'), true);
});

test('⚠ an unclassified winding still gets the question - suppressed only where copper is positively known', () => {
  // The narrower claim, and the safer direction: it can ask a question that turns out not to apply, never silently
  // withhold one that does. A job whose material cannot be classified is blocked by the estimate on that ground.
  assert.equal(hvSeApplies(null), true);
});

// ── ⚠ The pricing decision: copper never selects 12A-a1 ──────────────────────────────────────────────────────

test('⚠ copper HV prices at 12A-a, and 12A-a1 is not the row', () => {
  assert.equal(COPPER_HV_SCHEDULE_ROW, '12A-a');
  assert.notEqual(COPPER_HV_SCHEDULE_ROW, '12A-a1');
});

/**
 * ⚠ ASSERTED AGAINST THE SOURCE, BECAUSE THE RULE IS A PROPERTY OF THE PRICING CODE, NOT OF THIS MODULE.
 *
 * `buildSingleJobEstimateData` lives in a .tsx component and pulls in React, so this suite cannot call it (the
 * estimate's figures are checked by print-check instead, which prices from live data). What CAN be checked here is
 * that no code path in it selects the copper S.E. row - the thing the decision forbids. The copper arm was removed
 * rather than left unreachable precisely so this is checkable: dead code naming a row reads as a reachable path.
 */
const estimateSource = readFileSync(new URL('../components/SingleJobEstimateReport.tsx', import.meta.url), 'utf8');
const codeLines = estimateSource
  .split(/\r?\n/)
  .filter(l => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); });

test('⚠ no code line in the estimate selects the copper S.E. row', () => {
  const offenders = codeLines.filter(l => l.includes('12A-a1') || l.includes('12A(a1)'));
  assert.deepEqual(offenders, [], `a code path names the copper S.E. row:\n${offenders.join('\n')}`);
});

test('the estimate still selects both aluminium rows and the copper without-S.E. row', () => {
  // The check above must not pass merely because the whole block was deleted.
  const joined = codeLines.join('\n');
  assert.ok(joined.includes("'12A(b1)'"), 'aluminium with S.E. is still priced');
  assert.ok(joined.includes("'12A(b)'"), 'aluminium without S.E. is still priced');
  assert.ok(joined.includes('COPPER_HV_SCHEDULE_ROW'), 'copper is priced from the named row');
});

test('the estimate gates the S.E. axis on the shared rule, not on its own test', () => {
  const joined = codeLines.join('\n');
  assert.ok(joined.includes('hvSeApplies('), 'the estimate imports the one definition');
  assert.ok(joined.includes('seAxisApplies'), 'and gates on it');
});

// ── The label changed; the stored value did not ──────────────────────────────────────────────────────────────

test('⚠ the stored values are unchanged - WITH_SE and WITHOUT_SE', () => {
  // Renaming these to match the label would make every consumer's comparison miss, silently. Same trap as DAM/DMG.
  assert.equal(HV_SE_WITH, 'WITH_SE');
  assert.equal(HV_SE_WITHOUT, 'WITHOUT_SE');
  assert.deepEqual(HV_SE_OPTIONS.map(o => o.value), ['WITH_SE', 'WITHOUT_SE']);
});

test('⚠ the label names the material, never an absence', () => {
  const withoutSe = HV_SE_OPTIONS.find(o => o.value === HV_SE_WITHOUT);
  assert.equal(withoutSe?.label, 'DPC (not S.E.)');
  assert.ok(!/^Not S\.E\.$/.test(withoutSe?.label ?? ''), 'the label this change exists to correct is back');
  assert.equal(HV_SE_OPTIONS.find(o => o.value === HV_SE_WITH)?.label, 'S.E.');
});

test('the not-applicable mark is the dash the legend already defines, not blank', () => {
  // Blank already means "not recorded" on the inspection sheet and must not come to mean two things.
  assert.equal(HV_SE_NOT_APPLICABLE, '-');
  assert.notEqual(HV_SE_NOT_APPLICABLE, '');
});

// ── The screen and the pricing must not drift apart ──────────────────────────────────────────────────────────

test('the inspection screen gates the field, its validation and its printed cell on the same rule', () => {
  const screen = readFileSync(new URL('../components/InternalInspection.tsx', import.meta.url), 'utf8');
  assert.ok(screen.includes("from '../lib/hvSeConductor'"), 'the screen uses the shared rule');
  // Three places: the control, the required-field check, and the printed cell.
  assert.ok(screen.split('hvSeApplies(').length - 1 >= 3,
    'the control, the validation and the printed cell must all gate on hvSeApplies');
  assert.ok(!screen.includes("'Not S.E.'"), 'the old label is still rendered somewhere');
});
