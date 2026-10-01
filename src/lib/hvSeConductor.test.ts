// Tests for lib/hvSeConductor.ts - the HV coil conductor's insulation (AUDIT G105). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COPPER_HV_SCHEDULE_ROW, HV_SE_NOT_APPLICABLE, HV_SE_OPTIONS, HV_SE_WITH, HV_SE_WITHOUT, hvSeApplies,
  hvSeCell,
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

// ── The cell, one expression, four outcomes (AUDIT G106) ─────────────────────────────────────────────────────

test('the cell reads S.E., DPC, a dash or blank - and blank is not the dash', () => {
  assert.equal(hvSeCell('Aluminium', HV_SE_WITH), 'S.E.');
  assert.equal(hvSeCell('Aluminium', HV_SE_WITHOUT), 'DPC');
  assert.equal(hvSeCell('Copper', HV_SE_WITHOUT), HV_SE_NOT_APPLICABLE);
  assert.equal(hvSeCell('Aluminium', ''), '', 'an unanswered aluminium row is blank, never the dash');
});

test('⚠ a stored answer on copper is ignored, not shown', () => {
  // One live inspection carries WITHOUT_SE on copper, answered when the question was still asked. The cell must say
  // the question does not arise, not report an answer nobody should have been asked for.
  for (const stored of [HV_SE_WITH, HV_SE_WITHOUT, '', 'ANYTHING']) {
    assert.equal(hvSeCell('Copper', stored), HV_SE_NOT_APPLICABLE, `copper with ${stored || 'blank'} stored`);
  }
});

test('an unrecognised stored value on aluminium is blank, not guessed', () => {
  assert.equal(hvSeCell('Aluminium', 'SUPER_ENAMELLED'), '');
  assert.equal(hvSeCell('Aluminium', null), '');
  assert.equal(hvSeCell('Aluminium', undefined), '');
});

test('an unclassified winding is still asked, so its cell behaves as aluminium', () => {
  assert.equal(hvSeCell(null, HV_SE_WITH), 'S.E.');
  assert.equal(hvSeCell(null, ''), '');
});

test('⚠ the printed sheet and the Excel export call the SAME expression, not two copies', () => {
  const screen = readFileSync(new URL('../components/InternalInspection.tsx', import.meta.url), 'utf8');
  const calls = screen.split('hvSeCell(').length - 1;
  assert.ok(calls >= 2, `the printed cell and the export must both use hvSeCell - found ${calls} call(s)`);
  // And neither may re-derive the three states inline.
  assert.ok(!/hvSeConductor === HV_SE_WITH \? 'S\.E\.'/.test(screen), 'the three-state rule has been re-derived');
});

test('the Excel export carries the column at all - the gap G106 closed', () => {
  const screen = readFileSync(new URL('../components/InternalInspection.tsx', import.meta.url), 'utf8');
  const exportBlock = screen.slice(screen.indexOf('const handleExportExcel'), screen.indexOf('book_append_sheet'));
  assert.ok(exportBlock.includes("'HV S.E.'"), 'the export has no HV S.E. header');
  assert.ok(exportBlock.includes('hvSeCell('), 'the export header exists but no row value feeds it');
});

// ── The screen and the pricing must not drift apart ──────────────────────────────────────────────────────────

test('the inspection screen gates the field, its validation and its printed cell on the same rule', () => {
  const screen = readFileSync(new URL('../components/InternalInspection.tsx', import.meta.url), 'utf8');
  assert.ok(screen.includes("from '../lib/hvSeConductor'"), 'the screen uses the shared rule');
  // ⚠ TWO DIRECT CALLS, NOT THREE, SINCE G106 - and that is the improvement, not a regression. The control and the
  // required-field check ask `hvSeApplies` themselves; the printed cell and the Excel export ask `hvSeCell`, which
  // asks it for them. Requiring three direct calls would push the rule back out into the call sites.
  assert.ok(screen.split('hvSeApplies(').length - 1 >= 2,
    'the control and the required-field check must gate on hvSeApplies');
  assert.ok(screen.split('hvSeCell(').length - 1 >= 2,
    'the printed cell and the export must gate through hvSeCell');
  assert.ok(!screen.includes("'Not S.E.'"), 'the old label is still rendered somewhere');
});
