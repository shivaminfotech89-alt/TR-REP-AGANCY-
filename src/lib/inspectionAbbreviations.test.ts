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
  // HV/LV Rod was guessed from a default of 7 and the owner asked for it to be asked again rather
  // than shipped. Giving any of these a meaning requires removing it from UNCONFIRMED_HEADERS first.
  for (const h of UNCONFIRMED_HEADERS) {
    assert.ok(
      !allShorts.some(s => norm(s) === norm(h)),
      `${h} has a meaning but is still listed as unconfirmed`,
    );
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
