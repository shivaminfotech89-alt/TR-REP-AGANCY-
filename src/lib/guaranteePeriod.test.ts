// Tests for the guarantee period's three states (AUDIT G78). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  guaranteeState, describeGuaranteeState, guaranteeMonthsFor, hasNoGuarantee,
  GUARANTEE_DEFAULTS, DEFAULT_GUARANTEE_MONTHS, LSTC_GUARANTEE_MONTHS,
} from './guaranteePeriod';

const at = (guaranteeMonths?: Record<string, number>) => ({ guaranteeMonths } as any);

// ---------------------------------------------------------------- the three states

test('an AT storing nothing is DEFAULT - the clause applies and nobody has confirmed it', () => {
  const s = guaranteeState(at(undefined), 'CRGO');
  assert.equal(s.kind, 'default');
  assert.equal(s.months, 18);
  assert.equal(s.clauseMonths, 18);
});

test('a stored figure that differs from the clause is DIFFERS, and names both numbers', () => {
  const s = guaranteeState(at({ 'CRGO': 24 }), 'CRGO');
  assert.equal(s.kind, 'differs');
  assert.equal(s.months, 24);
  assert.equal(s.clauseMonths, 18);
  assert.match(describeGuaranteeState(s), /24 months/);
  assert.match(describeGuaranteeState(s), /clause default is 18/);
});

test('⚠ a stored figure EQUAL to the clause is RECORDED, not confirmed - the save used to write it unasked', () => {
  const s = guaranteeState(at({ 'CRGO': 18 }), 'CRGO');
  assert.equal(s.kind, 'recorded');
  assert.match(describeGuaranteeState(s), /may predate this change/);
  assert.doesNotMatch(describeGuaranteeState(s), /confirmed against/);
});

test('the DEFAULT wording says the clause applies and says it is unconfirmed', () => {
  const text = describeGuaranteeState(guaranteeState(at(undefined), 'CRGO'));
  assert.match(text, /clause 38\.2 default/);
  assert.match(text, /not confirmed/);
});

// ---------------------------------------------------------------- LSTC / PAT, the sharper case

test('LSTC / PAT carries six months, not eighteen, in every state', () => {
  assert.equal(GUARANTEE_DEFAULTS['LSTC / PAT'], LSTC_GUARANTEE_MONTHS);
  assert.equal(LSTC_GUARANTEE_MONTHS, 6);

  const unset = guaranteeState(at(undefined), 'LSTC / PAT');
  assert.equal(unset.kind, 'default');
  assert.equal(unset.months, 6);

  assert.equal(guaranteeState(at({ 'LSTC / PAT': 6 }), 'LSTC / PAT').kind, 'recorded');

  const differs = guaranteeState(at({ 'LSTC / PAT': 12 }), 'LSTC / PAT');
  assert.equal(differs.kind, 'differs');
  assert.match(describeGuaranteeState(differs), /clause default is 6/);
});

test('⚠ GUARANTEE_DEFAULTS has always included LSTC / PAT - the editor renders it', () => {
  assert.deepEqual(Object.keys(GUARANTEE_DEFAULTS), ['CRGO', 'Amorphous', 'Wound Core', 'LSTC / PAT']);
});

// ---------------------------------------------------------------- the label never disagrees with what prices

test('the months a state reports are the months guaranteeMonthsFor would apply', () => {
  for (const stored of [undefined, { 'CRGO': 18 }, { 'CRGO': 24 }]) {
    const s = guaranteeState(at(stored), 'CRGO');
    assert.equal(s.months, guaranteeMonthsFor(at(stored), 'CRGO'), JSON.stringify(stored));
  }
  for (const stored of [undefined, { 'LSTC / PAT': 6 }, { 'LSTC / PAT': 9 }]) {
    const s = guaranteeState(at(stored), 'LSTC / PAT');
    assert.equal(s.months, guaranteeMonthsFor(at(stored), 'LSTC / PAT'), JSON.stringify(stored));
  }
});

test('a zero or negative stored figure is not a setting - the clause applies', () => {
  assert.equal(guaranteeState(at({ 'CRGO': 0 }), 'CRGO').kind, 'default');
  assert.equal(guaranteeState(at({ 'CRGO': -3 }), 'CRGO').kind, 'default');
});

test('an unknown core label falls back to the clause figure rather than throwing', () => {
  const s = guaranteeState(at(undefined), 'Something Else');
  assert.equal(s.kind, 'default');
  assert.equal(s.clauseMonths, DEFAULT_GUARANTEE_MONTHS);
});

test('a null AT reads as default, never as recorded', () => {
  assert.equal(guaranteeState(null, 'CRGO').kind, 'default');
  assert.equal(guaranteeState(undefined, 'Amorphous').kind, 'default');
});

// ── ⚠ THE SECOND ARM: OVERHAULING DECLARED AT INSPECTION (AUDIT G114) ───────────────────────────────────────

test('⚠ hasNoGuarantee answers on the CORE TYPE, as it always did', () => {
  for (const core of ['OH', 'oh', 'Overhauling', 'OVERHAUL']) {
    assert.equal(hasNoGuarantee(core), true, core);
  }
  for (const core of ['CRGO', 'Amorphous', 'Wound Core', 'LSTC / PAT', '']) {
    assert.equal(hasNoGuarantee(core), false, core);
  }
});

test('⚠⚠ and on the REPAIR TYPE, which is how a declared overhaul reaches it', () => {
  // Under reading (a) the core type stays CRGO - the unit's core did not change, only what was found when it
  // was opened. The core-type arm alone would hand it eighteen months.
  assert.equal(hasNoGuarantee('CRGO', 'OH'), true);
  assert.equal(hasNoGuarantee('Amorphous', 'OH'), true);
  assert.equal(hasNoGuarantee('CRGO', 'OGP'), false);
  assert.equal(hasNoGuarantee('CRGO', 'GP'), false);
  assert.equal(hasNoGuarantee('CRGO'), false, 'omitting it must not change the old answer');
});

test('guaranteeMonthsFor returns null for a declared overhaul on a CRGO unit', () => {
  const at = { guaranteeMonths: { CRGO: 18 } } as any;
  assert.equal(guaranteeMonthsFor(at, 'CRGO'), 18, 'the ordinary repair is unchanged');
  assert.equal(guaranteeMonthsFor(at, 'CRGO', null, 'OH'), null);
});

test('⚠ the absence beats a figure already stamped on the job', () => {
  // A job booked as an ordinary repair carries `gpGuaranteeMonths`. The declaration is later, and it is the
  // truth about the work - so the stamp must not resurrect a guarantee the tender does not give.
  const at = { guaranteeMonths: { CRGO: 18 } } as any;
  assert.equal(guaranteeMonthsFor(at, 'CRGO', 18), 18);
  assert.equal(guaranteeMonthsFor(at, 'CRGO', 18, 'OH'), null);
});

test('⚠ null, not 0 - zero reads as a guarantee that has expired', () => {
  const months = guaranteeMonthsFor({ guaranteeMonths: {} } as any, 'CRGO', null, 'OH');
  assert.equal(months, null);
  assert.notEqual(months, 0);
});
