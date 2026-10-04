// Tests for the one-prefix-per-tender rule in lib/prefixValidation.ts (AUDIT G108). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  configuredPrefixes, prefixHasBookedWork, prefixOfJobNo, prefixesUnavailableTo, validatePrefixesAcrossAgency,
} from './prefixValidation';
import { nextFreeJobNumber, takenJobNumbers } from './jobNumbering';

const div = (name: string, crgo: string, rest: Record<string, string> = {}) =>
  ({ name, prefixCRGO: crgo, prefixAmorphous: '', prefixWoundCore: '', prefixLSTC: '', prefixOH: '', ...rest });
const at = (id: string, label: string, prefixes: any = undefined) => ({ id, atNumber: label, prefixes });
const job = (jobNo: string, atId: string, extra: Record<string, unknown> = {}) => ({ jobNo, atId, ...extra });

// ── Reading prefixes ─────────────────────────────────────────────────────────────────────────────────────────

test('a prefix is read from either shape an AT stores it in', () => {
  assert.deepEqual(configuredPrefixes(at('a', 'A', { SABARMATI: 'MSBT' })), ['MSBT']);
  assert.deepEqual(configuredPrefixes(at('a', 'A', { SABARMATI: { CRGO: 'MSBT', Amorphous: 'AMSBT' } })).sort(),
    ['AMSBT', 'MSBT']);
  assert.deepEqual(configuredPrefixes(at('a', 'A')), [], 'an AT configuring nothing contributes nothing');
  assert.deepEqual(configuredPrefixes(null), []);
});

test('a job number yields the text before its last dash', () => {
  assert.equal(prefixOfJobNo('MSBT-24'), 'MSBT');
  assert.equal(prefixOfJobNo('21PS-AP-7'), '21PS-AP');
  assert.equal(prefixOfJobNo('nodash'), '');
  assert.equal(prefixOfJobNo(null), '');
});

// ── ⚠ A prefix a sibling uses is unavailable ─────────────────────────────────────────────────────────────────

test('a prefix another tender configures is refused, and the refusal names that tender', () => {
  const r = validatePrefixesAcrossAgency([div('SABARMATI', 'MSBT')], {
    atId: 'new', siblingAts: [at('old', 'AT 26-27', { SABARMATI: 'MSBT' })], jobs: [],
  });
  assert.equal(r.isValid, false);
  assert.match(r.errors[0], /MSBT/);
  assert.match(r.errors[0], /AT 26-27/);
  assert.match(r.errors[0], /Every tender has its own prefix/);
});

test('a prefix nothing else uses is accepted', () => {
  const r = validatePrefixesAcrossAgency([div('SABARMATI', 'MSB2')], {
    atId: 'new', siblingAts: [at('old', 'AT 26-27', { SABARMATI: 'MSBT' })], jobs: [],
  });
  assert.equal(r.isValid, true);
  assert.deepEqual(r.errors, []);
});

test('this AT re-submitting its OWN saved prefix is not a conflict with itself', () => {
  const r = validatePrefixesAcrossAgency([div('SABARMATI', 'MSBT')], {
    atId: 'me', siblingAts: [at('me', 'Mine', { SABARMATI: 'MSBT' })], jobs: [], ownPrefixes: ['MSBT'],
  });
  assert.equal(r.isValid, true, 'editing a division name must not refuse the prefix already there');
});

// ── ⚠ The deleted-AT hole: job numbers are checked too (F78) ─────────────────────────────────────────────────

test('⚠ a prefix carried by job numbers is refused even when no AT configures it', () => {
  // F78: an AT can be deleted and its jobs keep their numbers. Checking siblings alone leaves it reusable.
  const r = validatePrefixesAcrossAgency([div('DEESA', 'SU')], {
    atId: 'new', siblingAts: [], jobs: [job('SU-1', 'deleted-at'), job('SU-2', 'deleted-at')],
  });
  assert.equal(r.isValid, false);
  assert.match(r.errors[0], /2 job number\(s\) already issued/);
});

test('cancelled jobs do not reserve a prefix', () => {
  const r = validatePrefixesAcrossAgency([div('DEESA', 'SU')], {
    atId: 'new', siblingAts: [], jobs: [job('SU-1', 'x', { status: 'Cancelled' })],
  });
  assert.equal(r.isValid, true);
});

test("this tender's own jobs do not block its own prefix", () => {
  const r = validatePrefixesAcrossAgency([div('DEESA', 'SU')], {
    atId: 'me', siblingAts: [], jobs: [job('SU-1', 'me')], ownPrefixes: ['SU'],
  });
  assert.equal(r.isValid, true);
});

// ── ⚠ The fallback: an AT with no prefixes resolves to the agency map ────────────────────────────────────────

test('⚠ a sibling configuring NOTHING still resolves to the agency map, and that counts', () => {
  // Three of the five live sharing groups are this: SAMOR's AT-2026-28 and UPENDRA's 1819 configure nothing.
  const unavailable = prefixesUnavailableTo(
    'new',
    [at('bare', 'AT-2026-28')],            // no prefixes of its own
    [],
    { prefixes: { 'DAEESA-1': 'STD' } },   // the agency map it falls back to
  );
  assert.ok(unavailable.has('STD'), 'the fallback prefix must be unavailable');
  assert.match(unavailable.get('STD')!.atLabel!, /via the agency's prefixes/);
});

test('a sibling with its own prefixes does NOT also claim the agency map', () => {
  const unavailable = prefixesUnavailableTo(
    'new',
    [at('own', 'AT X', { KALOL: 'KLL' })],
    [],
    { prefixes: { KALOL: 'ASD' } },
  );
  assert.ok(unavailable.has('KLL'));
  assert.ok(!unavailable.has('ASD'), 'its own map replaces the fallback, it does not add to it');
});

// ── ⚠ Not counterMoved: does any live job of THIS tender carry the prefix ────────────────────────────────────

test('⚠ SAMOR proves counterMoved is the wrong test - four booked jobs against a counter of zero', () => {
  const jobs = [job('STD-1', 'samorAt'), job('STD-2', 'samorAt'), job('STD-3', 'samorAt'), job('STD-4', 'samorAt')];
  const counterMoved = Number(({ lastJobNumbers: {} } as any).lastJobNumbers['DAEESA-1_CRGO'] || 0) > 0;
  assert.equal(counterMoved, false, 'the counter says nothing has been issued');
  assert.equal(prefixHasBookedWork('samorAt', 'STD', jobs), true, 'but four jobs carry the prefix');
});

test('booked work is this tender own, not another tender under the same prefix', () => {
  const jobs = [job('MSBT-1', 'otherAt')];
  assert.equal(prefixHasBookedWork('me', 'MSBT', jobs), false);
  assert.equal(prefixHasBookedWork('otherAt', 'MSBT', jobs), true);
});

test('a cancelled job does not hold a prefix against a rename', () => {
  assert.equal(prefixHasBookedWork('me', 'MSBT', [job('MSBT-1', 'me', { isCancelled: true })]), false);
});

test('an empty prefix is never "booked"', () => {
  assert.equal(prefixHasBookedWork('me', '', [job('MSBT-1', 'me')]), false);
});

// ── ⚠⚠ The point of the whole change: with a unique prefix, the skip never fires ──────────────────────────────

test('⚠⚠ a new tender with its own prefix offers -1, so nextFreeJobNumber never skips', () => {
  // The agency's whole job history, all under the previous tender's prefix.
  const history = Array.from({ length: 23 }, (_, i) => job(`MSBT-${i + 1}`, 'old'));
  const takenUnderNew = takenJobNumbers(history, 'MSB2');
  assert.equal(takenUnderNew.size, 0, 'nothing is taken under a prefix no job has carried');
  assert.equal(nextFreeJobNumber(0, takenUnderNew), 1, 'so the first number is 1 - O89s rule, delivered');

  // And the contrast, which is what the prefix rule removes: the same history under a REUSED prefix.
  const takenUnderSame = takenJobNumbers(history, 'MSBT');
  assert.equal(takenUnderSame.size, 23);
  assert.equal(nextFreeJobNumber(0, takenUnderSame), 24, 'a reused prefix forces the skip all the way to 24');
});

test("O89's seeded starting number survives a unique prefix too", () => {
  assert.equal(nextFreeJobNumber(46, new Set()), 47, 'a tender seeded to start at 47 starts at 47');
});

// ── Wired where prefixes are saved ───────────────────────────────────────────────────────────────────────────

test('the division editor runs the agency-wide check and refuses a booked rename', () => {
  const src = readFileSync(new URL('../components/AtDivisions.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('validatePrefixesAcrossAgency('), 'the agency-wide check is not wired in');
  assert.ok(src.includes('prefixHasBookedWork('), 'a booked prefix can still be renamed');
  assert.ok(src.includes('agency: activeAgency'), 'the fallback map is not passed, so a bare sibling is missed');
  // counterMoved must still exist for the starting-number field, and must NOT be the prefix guard.
  assert.ok(src.includes('counterMoved'), 'the starting-number guard was removed by accident');
  assert.ok(!/counterMoved\([^)]*\)\s*&&\s*prefix/i.test(src), 'counterMoved is being used to guard a prefix');
});
