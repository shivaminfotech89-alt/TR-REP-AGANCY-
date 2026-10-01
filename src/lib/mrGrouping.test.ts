// Tests for lib/mrGrouping.ts - an MR's jobs, grouped and ordered (AUDIT G104). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byJobNo, groupJobsByMr, sortJobsByNo } from './mrGrouping';

const job = (jobNo: string, mrNo = '1') => ({ jobNo, mrNo });
const nos = (js: readonly { jobNo?: string | null }[]) => js.map(j => j.jobNo);

// ── The bug: the order the read returns, which with no orderBy is unspecified ────────────────────────────────

test('SU-6 to SU-10 come out in sequence, not alphabetically', () => {
  // The reported case. As strings, SU-10 sorts before SU-6; numerically it does not.
  const scrambled = ['SU-10', 'SU-7', 'SU-6', 'SU-9', 'SU-8'].map(n => job(n));
  assert.deepEqual(nos(sortJobsByNo(scrambled)), ['SU-6', 'SU-7', 'SU-8', 'SU-9', 'SU-10']);
  // And plain alphabetic really would get it wrong, so the test is testing something.
  assert.deepEqual([...scrambled].sort((a, b) => a.jobNo.localeCompare(b.jobNo)).map(j => j.jobNo),
    ['SU-10', 'SU-6', 'SU-7', 'SU-8', 'SU-9']);
});

test('MR 2555 in the order the live read returns it becomes job-number order', () => {
  // The exact live case print-check prints. Read back 2026-10-01: MSBT-1(IP4acepD), MSBT-3(hivHkvhF),
  // MSBT-4(SRQfQP3e), MSBT-2(Uwz2VbZA) - which is not ascending document id, and not job number.
  const asStored = ['MSBT-1', 'MSBT-3', 'MSBT-4', 'MSBT-2'].map(n => job(n, '2555'));
  assert.deepEqual(nos(groupJobsByMr(asStored)['2555']), ['MSBT-1', 'MSBT-2', 'MSBT-3', 'MSBT-4']);
});

test('MR 1051 in the order the live read returns it: fifteen jobs, ZB-1 to ZB-15 out', () => {
  // As read 2026-10-01.
  const asStored = ['ZB-1', 'ZB-10', 'ZB-14', 'ZB-9', 'ZB-5', 'ZB-3', 'ZB-7', 'ZB-11', 'ZB-15', 'ZB-13', 'ZB-8', 'ZB-4', 'ZB-6', 'ZB-12', 'ZB-2']
    .map(n => job(n, '1051'));
  assert.deepEqual(nos(groupJobsByMr(asStored)['1051']),
    ['ZB-1', 'ZB-2', 'ZB-3', 'ZB-4', 'ZB-5', 'ZB-6', 'ZB-7', 'ZB-8', 'ZB-9', 'ZB-10', 'ZB-11', 'ZB-12', 'ZB-13', 'ZB-14', 'ZB-15']);
});

// ── ⚠ The collisions that disqualify jobNoSequence ───────────────────────────────────────────────────────────

/** jobNoSequence, copied from lib/AgencyContext - the parser this module deliberately does NOT use. */
const jobNoSequence = (jobNo: string): number | null => {
  const raw = String(jobNo ?? '').trim();
  if (!raw) return null;
  const dash = raw.lastIndexOf('-');
  const n = parseInt(dash >= 0 ? raw.slice(dash + 1) : raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

test('⚠ jobNoSequence collides on three live MRs, and this comparator separates them', () => {
  // Every pair below is two real jobs of ONE MR that jobNoSequence maps to the same number, because it discards
  // the prefix. Sorting by it would leave these columns arbitrary - the same bug in better clothes.
  const collisions: [string, string][] = [
    ['AMSBT-1', 'MWSBT-1'],   // MR 85558
    ['AMSBT-2', 'MWSBT-2'],   // MR 85558
    ['ASU-3', 'SU-3'],        // MR 1234
    ['OH21 IS-1', 'WSU-1'],   // MR 1234
    ['ZKAP-1', 'ZK-1'],       // MR 3929
    ['ZKAP-2', 'ZK-2'],       // MR 3929
  ];
  for (const [a, b] of collisions) {
    assert.equal(jobNoSequence(a), jobNoSequence(b), `${a} and ${b} share a jobNoSequence`);
    assert.notEqual(byJobNo(job(a), job(b)), 0, `${a} vs ${b} must still have a defined order`);
  }
});

test('MR 85558 as it really is on disk: mixed prefixes ordered by prefix, then number', () => {
  const asStored = ['MSBT-20', 'MSBT-16', 'AMSBT-2', 'AMSBT-3', 'MSBT-10', 'MSBT-12', 'AMSBT-1', 'MSBT-18', 'MSBT-13',
    'MSBT-19', 'MSBT-8', 'MWSBT-2', 'MSBT-17', 'MSBT-9', 'MSBT-15', 'MSBT-14', 'MWSBT-1', 'MSBT-11'].map(n => job(n, '85558'));
  assert.deepEqual(nos(groupJobsByMr(asStored)['85558']), [
    'AMSBT-1', 'AMSBT-2', 'AMSBT-3',
    'MSBT-8', 'MSBT-9', 'MSBT-10', 'MSBT-11', 'MSBT-12', 'MSBT-13', 'MSBT-14', 'MSBT-15', 'MSBT-16', 'MSBT-17',
    'MSBT-18', 'MSBT-19', 'MSBT-20',
    'MWSBT-1', 'MWSBT-2',
  ]);
});

// ── The live job-number shapes, all 160 of which exist ───────────────────────────────────────────────────────

test('job numbers with digits in the prefix sort on the prefix first, not the digits', () => {
  // 11 live numbers carry digits before the dash.
  assert.deepEqual(nos(sortJobsByNo(['21GETS-45', '21GETBO-16', '21GETS-44'].map(n => job(n)))),
    ['21GETBO-16', '21GETS-44', '21GETS-45']);
});

test('more than one dash: the trailing number still orders them', () => {
  // 5 live numbers look like 21PS-AP-n.
  assert.deepEqual(nos(sortJobsByNo(['21PS-AP-10', '21PS-AP-2', '21PS-AP-1'].map(n => job(n)))),
    ['21PS-AP-1', '21PS-AP-2', '21PS-AP-10']);
});

test('whitespace in a job number does not break the order', () => {
  assert.deepEqual(nos(sortJobsByNo(['OH21 IS-2', 'OH21 IS-1'].map(n => job(n)))), ['OH21 IS-1', 'OH21 IS-2']);
});

test('shapes with no dash and bare numbers order sensibly - none live today, both reachable', () => {
  assert.deepEqual(nos(sortJobsByNo(['SU10', 'SU2', 'SU1'].map(n => job(n)))), ['SU1', 'SU2', 'SU10']);
  assert.deepEqual(nos(sortJobsByNo(['10', '2', '1'].map(n => job(n)))), ['1', '2', '10']);
});

// ── Grouping behaviour the callers relied on ────────────────────────────────────────────────────────────────

test('jobs with no mrNo are left out, as both inline loops did', () => {
  const groups = groupJobsByMr([job('A-1', '5'), { jobNo: 'A-2', mrNo: '' }, { jobNo: 'A-3', mrNo: null }]);
  assert.deepEqual(Object.keys(groups), ['5']);
  assert.deepEqual(nos(groups['5']), ['A-1']);
});

test('⚠ the GROUPS come out in numeric MR order, NOT insertion order - and that is unchanged', () => {
  // An MR number is a numeric string, and a JS object orders integer-like keys numerically ascending whatever the
  // insertion order. MR 77 is inserted first and still comes second. The inline loops this replaced keyed a plain
  // object the same way, so group order is not something the extraction changed - only order WITHIN a group is.
  const groups = groupJobsByMr([job('B-2', '77'), job('A-1', '12'), job('B-1', '77')]);
  assert.deepEqual(Object.keys(groups), ['12', '77']);
  assert.deepEqual(nos(groups['77']), ['B-1', 'B-2'], 'and within MR 77 the jobs are ordered');
});

test('a non-numeric MR key does fall after the numeric ones, which is the same rule', () => {
  const groups = groupJobsByMr([job('A-1', 'OIL-ONLY'), job('A-1', '9'), job('A-1', '3')]);
  assert.deepEqual(Object.keys(groups), ['3', '9', 'OIL-ONLY']);
});

test('sortJobsByNo does not mutate its input', () => {
  const input = ['C-2', 'C-1'].map(n => job(n));
  const out = sortJobsByNo(input);
  assert.deepEqual(nos(input), ['C-2', 'C-1'], 'the caller still has its own order');
  assert.deepEqual(nos(out), ['C-1', 'C-2']);
});

test('a missing or null jobNo sorts without throwing', () => {
  const out = sortJobsByNo([{ jobNo: 'A-1' }, { jobNo: null }, {}, { jobNo: 'A-2' }]);
  assert.equal(out.length, 4);
  assert.deepEqual(out.slice(2).map(j => j.jobNo), ['A-1', 'A-2'], 'the blanks sort first, the real ones in order');
});

test('an empty list is an empty object, not a throw', () => {
  assert.deepEqual(groupJobsByMr([]), {});
  assert.deepEqual(sortJobsByNo([]), []);
});
