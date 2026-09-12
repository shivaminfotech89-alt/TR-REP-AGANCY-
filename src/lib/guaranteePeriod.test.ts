// Tests for the guarantee period's three states (AUDIT G78). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  guaranteeState, describeGuaranteeState, guaranteeMonthsFor,
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
