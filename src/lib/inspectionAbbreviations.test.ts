// Tests for lib/inspectionAbbreviations.ts (AUDIT G98). Run with `npm test`.
//
// These guard the one rule that matters here: a meaning shown to an operator is one the operator
// CONFIRMED. The rest is bookkeeping that keeps the legend and the screens from drifting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLUMN_ABBREVIATIONS, VALUE_ABBREVIATIONS, UNCONFIRMED_HEADERS,
  EXTERNAL_LEGEND_COLUMNS, EXTERNAL_LEGEND_VALUES, INTERNAL_LEGEND_COLUMNS, INTERNAL_LEGEND_VALUES,
  columnTitle,
} from './inspectionAbbreviations';

// Widened to string[] on purpose: `as const` narrows it to the defined short forms, and the tests
// below need to ask about values that are deliberately NOT defined ('DAM', the unconfirmed headers).
// tsx ran this happily as a narrow type; only tsc refused it.
const allShorts: string[] = [
  ...Object.values(COLUMN_ABBREVIATIONS).map(a => a.short),
  ...Object.values(VALUE_ABBREVIATIONS).map(a => a.short),
];
const norm = (s: string) => s.replace(/[\s/.]/g, '').toUpperCase();

test('⚠⚠ an UNCONFIRMED header is never given a meaning', () => {
  // ⚠ EMPTY SINCE G99, SO THIS LOOP CURRENTLY ASSERTS NOTHING - it would pass whatever the module
  // held. Kept as the guard for the next header whose meaning is unknown: list it, and giving it a
  // meaning fails here until it is removed. The five it held are pinned by the test below instead,
  // so emptying the list did not leave them unprotected.
  for (const h of UNCONFIRMED_HEADERS) {
    assert.ok(
      !allShorts.some(s => norm(s) === norm(h)),
      `${h} has a meaning but is still listed as unconfirmed`,
    );
  }
});

test('⚠ the five withheld until answered carry exactly the operator\'s meanings', () => {
  // These shipped with NO meaning until confirmed (AUDIT G99). Pinned verbatim, because the reason
  // they were withheld is that a plausible substitute is undetectable once on screen.
  assert.equal(COLUMN_ABBREVIATIONS.HV_LV_ROD.meaning, 'HV/LV side Rod');   // NOT "3 HV + 4 LV bushing rods"
  assert.equal(COLUMN_ABBREVIATIONS.OIL_AVL.meaning, 'Oil Available');
  assert.equal(COLUMN_ABBREVIATIONS.NET_SHRT.meaning, 'Net Shortage');
  assert.equal(COLUMN_ABBREVIATIONS.HV_LIMB.meaning, 'Coils per limb');
  // ⚠ HV_SE WAS EXTENDED ON A SECOND OPERATOR CONFIRMATION (AUDIT G105), not loosened: 'Super Enamelled' is still
  // the whole of what the abbreviation stands for, and the clause after the dash says what it is the insulation
  // ON. The pin is kept tight on the term itself so a future reader cannot quietly substitute a different one.
  assert.ok(COLUMN_ABBREVIATIONS.HV_SE.meaning.startsWith('Super Enamelled'), 'the term itself must lead');
  assert.equal(COLUMN_ABBREVIATIONS.HV_SE.meaning, 'Super Enamelled - the insulation on the HV coil conductor');
  assert.ok(!/bushing|3 HV|4 LV/i.test(COLUMN_ABBREVIATIONS.HV_LV_ROD.meaning), 'the rejected inference crept back in');
  assert.equal(UNCONFIRMED_HEADERS.length, 0);
});

test('⚠ DPC is a material, never "the absence of S.E." (AUDIT G105)', () => {
  // The correction this entry exists for: "Not S.E." read as something missing. The wording is the operator's.
  assert.equal(VALUE_ABBREVIATIONS.DPC.meaning,
    'Double Paper Cover - paper insulation on the HV coil conductor instead of Super Enamelled');
  assert.ok(VALUE_ABBREVIATIONS.SE.meaning.startsWith('Super Enamelled'), 'the term itself must lead');
  // Neither may describe DPC as an absence, which is the mistake being corrected.
  for (const a of [VALUE_ABBREVIATIONS.DPC, VALUE_ABBREVIATIONS.SE]) {
    assert.ok(!/(absence|missing|not done|no S\.E\.)/i.test(a.meaning), `"${a.meaning}" describes DPC as an absence`);
  }
  // Both say the choice is aluminium only - the fact that stops an operator hunting for the field on copper.
  for (const a of [VALUE_ABBREVIATIONS.DPC, VALUE_ABBREVIATIONS.SE, COLUMN_ABBREVIATIONS.HV_SE]) {
    assert.match(`${a.meaning} ${(a as any).detail ?? ''}`, /[Aa]luminium/, 'the aluminium-only limit is not stated');
  }
});

test('every key a legend lists exists', () => {
  for (const k of [...EXTERNAL_LEGEND_COLUMNS, ...INTERNAL_LEGEND_COLUMNS]) {
    assert.ok(k in COLUMN_ABBREVIATIONS, `${k} is listed but not defined`);
  }
  for (const k of [...EXTERNAL_LEGEND_VALUES, ...INTERNAL_LEGEND_VALUES]) {
    assert.ok(k in VALUE_ABBREVIATIONS, `${k} is listed but not defined`);
  }
});

test('no legend lists the same entry twice', () => {
  for (const list of [EXTERNAL_LEGEND_COLUMNS, INTERNAL_LEGEND_COLUMNS, EXTERNAL_LEGEND_VALUES, INTERNAL_LEGEND_VALUES]) {
    assert.equal(new Set(list).size, list.length);
  }
});

test('⚠ DMG is the term, and the legend says the dropdown shows it as DAM', () => {
  // DAM stays the stored value - estimates read it - so the legend must not pretend the screen
  // says DMG. An operator looking for DMG in the dropdown would find DAM and nothing explaining it.
  assert.equal(VALUE_ABBREVIATIONS.DMG.short, 'DMG');
  assert.ok(!allShorts.includes('DAM'), 'DAM must not be defined as a term of its own');
  assert.match(VALUE_ABBREVIATIONS.DMG.detail ?? '', /DAM/);
});

test('the operator-confirmed meanings that corrected the first pass', () => {
  assert.match(VALUE_ABBREVIATIONS.TBR.meaning, /^To Be Replaced/);
  assert.equal(COLUMN_ABBREVIATIONS.DC.meaning, 'Dismantling Charge');       // not "or dismantling of transformer"
  assert.match(COLUMN_ABBREVIATIONS.CC.meaning, /Cap \/ Connector/);        // both, not one or the other
  assert.match(COLUMN_ABBREVIATIONS.DAM_RAD.meaning, /fins \/ pipes/);
});

test('a column title is its meaning alone', () => {
  assert.equal(columnTitle('DAM_CT'), 'Damaged Conservator Tank');
});
