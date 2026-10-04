// Tests for lib/jobNumbering.ts - which number to offer next (AUDIT G107). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jobNumberTail, nextFreeJobNumber, nextJobNoFor, takenJobNumbers } from './jobNumbering';

const job = (jobNo: string, extra: Record<string, unknown> = {}) => ({ jobNo, ...extra });

// ── Reading a trailing number ────────────────────────────────────────────────────────────────────────────────

test('the tail is the number after the prefix, and only under that prefix', () => {
  assert.equal(jobNumberTail('MSBT-24', 'MSBT'), 24);
  assert.equal(jobNumberTail('msbt-24', 'MSBT'), 24, 'case does not matter');
  assert.equal(jobNumberTail('MWSBT-2', 'MSBT'), 0, 'a longer prefix is a different series');
  assert.equal(jobNumberTail('MSBT-abc', 'MSBT'), 0);
  assert.equal(jobNumberTail('', 'MSBT'), 0);
  assert.equal(jobNumberTail(null, 'MSBT'), 0);
});

test('a job number with more than one dash keeps its trailing number', () => {
  assert.equal(jobNumberTail('21PS-AP-7', '21PS-AP'), 7);
});

// ── What is spoken for ───────────────────────────────────────────────────────────────────────────────────────

test('cancelled jobs do not hold their numbers - they are freed for reuse', () => {
  const jobs = [job('A-1'), job('A-2', { status: 'Cancelled' }), job('A-3', { isCancelled: true }),
    job('A-4', { mrStatus: 'Cancelled' }), job('A-5')];
  assert.deepEqual([...takenJobNumbers(jobs, 'A')].sort((a, b) => a - b), [1, 5]);
});

test('GP jobs do not reserve a number - they reuse one from a previous repair', () => {
  const jobs = [job('A-1'), job('A-2', { repairType: 'GP' }), job('A-3', { isGp: true })];
  assert.deepEqual([...takenJobNumbers(jobs, 'A')], [1]);
});

test('no prefix means nothing is taken, rather than everything', () => {
  assert.equal(takenJobNumbers([job('A-1')], '').size, 0);
});

// ── ⚠ The tender boundary: start from the counter, skip what is taken ────────────────────────────────────────

test('on an established tender the counter is the answer and nothing is skipped', () => {
  // ADMIN's old AT: counter 24, SU-1..SU-24 on record.
  const taken = new Set(Array.from({ length: 24 }, (_, i) => i + 1));
  assert.equal(nextFreeJobNumber(24, taken), 25);
});

test('⚠ a new tender starts at its own number where the prefix leaves room - O89s rule', () => {
  // MEGHA/KALOL: the new AT uses a fresh prefix, so nothing is taken under it.
  assert.equal(nextJobNoFor('ASD', 0, new Set()), 'ASD-1');
});

test('⚠ and it never offers a number already in use, even when the counter points at one', () => {
  // ADMIN's new AT: counter 0 would point at SU-1, which exists. The old offer was SU-1; the guard refused it.
  const taken = new Set(Array.from({ length: 24 }, (_, i) => i + 1));
  assert.equal(nextJobNoFor('SU', 0, taken), 'SU-25');
});

test('⚠ MEGHA/SABARMATI: MSBT-1 is on two challans, so it is skipped and the series lands at the maximum', () => {
  // The honest result of (a): O89's rule is honoured only where the prefix differs. Recorded, not hidden.
  const taken = takenJobNumbers(
    [...Array.from({ length: 23 }, (_, i) => job(`MSBT-${i + 1}`)), job('MSBT-112')],
    'MSBT',
  );
  assert.equal(nextJobNoFor('MSBT', 0, taken), 'MSBT-24');
  assert.ok(taken.has(1), 'MSBT-1 is taken, which is why 1 cannot be offered');
});

test('a gap in the middle is filled before the end', () => {
  // Cancelled numbers are freed, so the next offer should reuse the gap rather than run past it.
  const taken = new Set([1, 2, 4, 5]);
  assert.equal(nextFreeJobNumber(0, taken), 3);
});

// ── Allocating down the rows of one intake ───────────────────────────────────────────────────────────────────

test('each row of a batch takes the next free number, skipping the taken ones', () => {
  const taken = new Set([1, 3]);
  assert.deepEqual([0, 1, 2, 3].map(skip => nextFreeJobNumber(0, taken, skip)), [2, 4, 5, 6]);
});

test('a batch on an established tender simply counts on', () => {
  const taken = new Set([1, 2, 3]);
  assert.deepEqual([0, 1, 2].map(skip => nextFreeJobNumber(3, taken, skip)), [4, 5, 6]);
});

// ── It must always answer, and never hang the form ───────────────────────────────────────────────────────────

test('it returns a number even when the taken set is absurd', () => {
  const taken = new Set(Array.from({ length: 5000 }, (_, i) => i + 1));
  const n = nextFreeJobNumber(0, taken);
  assert.ok(Number.isFinite(n) && n > 0, 'a suggestion that is wrong beats an intake form that freezes');
});

test('a nonsense counter does not produce a nonsense number', () => {
  for (const bad of [NaN, -5, undefined as unknown as number, null as unknown as number]) {
    assert.equal(nextFreeJobNumber(bad, new Set()), 1);
  }
});

test('nextJobNoFor returns empty with no prefix, rather than a bare number', () => {
  assert.equal(nextJobNoFor(null, 0, new Set()), '');
  assert.equal(nextJobNoFor('', 5, new Set()), '');
});

// ── The two call sites must share this ───────────────────────────────────────────────────────────────────────

test('⚠ the prefill and the clash offer both go through this module', () => {
  const src = readFileSync(new URL('../components/NewJob.tsx', import.meta.url), 'utf8');
  assert.ok(src.split('nextJobNoFor(').length - 1 >= 2,
    'the prefill and the clash offer must both use nextJobNoFor');
  assert.ok(src.includes('takenJobNumbers('), 'neither may offer a number without consulting what is taken');
  // The old agency-maximum derivation must be gone, not merely bypassed.
  assert.ok(!src.includes('activeSavedMax'), 'the prefill still derives its own maximum');
});
