// Tests for lib/discoms.ts (AUDIT G88). Run with `npm test`.
//
// The defect this guards is a filter that hides tenders: an agency whose board does not match
// sees an empty list, which looks identical to "none published yet". Live data already holds two
// spellings of one board, so the normalisation is the load-bearing part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISCOMS,
  DISCOM_CODES,
  discomFor,
  codeFromDiscomName,
  tenderListState,
} from './discoms';

test('the five boards are distinct, coded and named', () => {
  assert.equal(DISCOMS.length, 5);
  assert.deepEqual(DISCOM_CODES, ['UGVCL', 'MGVCL', 'PGVCL', 'DGVCL', 'GETCO']);
  assert.equal(new Set(DISCOM_CODES).size, 5, 'two boards share a code');
  for (const d of DISCOMS) {
    assert.ok(d.name.length > 0, `${d.code} has no legal name`);
    assert.ok(d.label.includes(d.code), `${d.code}'s label does not name it`);
  }
});

// ---------------------------------------------------------------- the live inconsistency

test('⚠ both live spellings of UGVCL resolve to ONE code', () => {
  // These are the exact strings in the database: 8 agencies hold the first, 1 holds the second.
  // A string filter reads them as two boards, which is the whole reason this file exists.
  assert.equal(codeFromDiscomName('Uttar Gujarat Vij Company Ltd.'), 'UGVCL');
  assert.equal(codeFromDiscomName('UTTAR GUJARAT VIJ CO LTD.'), 'UGVCL');
});

test('the live MGVCL agency resolves', () => {
  assert.equal(codeFromDiscomName('Madhya Gujarat Vij Company Ltd.'), 'MGVCL');
});

test('case, spacing and punctuation cannot make one board into two', () => {
  for (const v of ['ugvcl', 'U.G.V.C.L.', ' UGVCL ', 'UGVCL Ltd', 'uttar gujarat vij company limited']) {
    assert.equal(codeFromDiscomName(v), 'UGVCL', `${v} did not resolve`);
  }
});

test('the remaining boards resolve from their names and their codes', () => {
  assert.equal(codeFromDiscomName('Paschim Gujarat Vij Company Ltd.'), 'PGVCL');
  assert.equal(codeFromDiscomName('DGVCL'), 'DGVCL');
  assert.equal(codeFromDiscomName('Gujarat Energy Transmission Corporation Ltd.'), 'GETCO');
});

test('⚠ nothing recognisable returns null - never a default board', () => {
  // Blank, absent and unknown must all be "not recorded". Defaulting to UGVCL because it is the
  // common case would put an agency on a board it may never have tendered with.
  assert.equal(codeFromDiscomName(''), null);
  assert.equal(codeFromDiscomName('   '), null);
  assert.equal(codeFromDiscomName(undefined), null);
  assert.equal(codeFromDiscomName(null), null);
  assert.equal(codeFromDiscomName('Torrent Power'), null);
  assert.equal(codeFromDiscomName('Some Other Board'), null);
});

test('⚠ a division prefix is NOT a board', () => {
  // Four unset agencies carry only a prefix - DEESA, SABARMATI. Nothing ties a division to a
  // board, and SABARMATI is both a UGVCL division and Torrent Power's Ahmedabad territory.
  assert.equal(codeFromDiscomName('SABARMATI'), null);
  assert.equal(codeFromDiscomName('DEESA'), null);
});

// ---------------------------------------------------------------- lookup

test('discomFor resolves a code, tolerates case, and refuses everything else', () => {
  assert.equal(discomFor('UGVCL')?.name, 'Uttar Gujarat Vij Company Ltd.');
  assert.equal(discomFor('ugvcl')?.code, 'UGVCL');
  assert.equal(discomFor(''), null);
  assert.equal(discomFor(undefined), null);
  assert.equal(discomFor('TORRENT'), null);
});

// ---------------------------------------------------------------- the three states

test('⚠ "no board set" and "none published" are different states, not one empty list', () => {
  assert.equal(tenderListState(null, 0), 'no-discom');
  assert.equal(tenderListState('', 5), 'no-discom', 'no board wins even when templates exist');
  assert.equal(tenderListState('UGVCL', 0), 'none-published');
  assert.equal(tenderListState('UGVCL', 2), 'ready');
});

test('an unrecognised code reads as no board rather than as a board with no tenders', () => {
  // Otherwise a typo in the stored code would tell the operator their board has no tenders,
  // sending them to wait for a publication instead of to Agency Settings.
  assert.equal(tenderListState('TORRENT', 3), 'no-discom');
});
