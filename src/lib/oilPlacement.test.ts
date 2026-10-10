// Tests for lib/oilPlacement - which MR row an oil receipt belongs on (AUDIT G124).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeOilTransaction, OIL_UNPLACED_TEXT } from './oilPlacement';

const JOBS = [
  { id: 'j1', mrNo: '1052' },
  { id: 'j2', mrNo: '2089' },
];
const scope = (over: Record<string, unknown> = {}) => ({
  scopedJobs: JOBS,
  atId: 'AT_LIVE',
  viewingAllTenders: false,
  knownAtIds: new Set(['AT_LIVE', 'AT_OTHER']),
  ...over,
}) as any;

// ── Rule 1: jobId ───────────────────────────────────────────────────────────────────────────────────────────

test('a receipt naming a job in scope lands on that JOB\'s MR, whatever its own mrNo says', () => {
  // ⚠ The point of the strongest rule: the receipt's own mrNo is not consulted at all.
  const p = placeOilTransaction({ jobId: 'j1', mrNo: 'A-DIFFERENT-NUMBER' }, scope());
  assert.deepEqual(p, { placed: true, mrNo: '1052', by: 'jobId', mrHasNoJobs: false });
});

test('⚠ a receipt naming a job NOT in scope is unplaced, never demoted to its mrNo', () => {
  // Falling back to the number here would reintroduce the cross-tender leak the jobId prevents.
  const p = placeOilTransaction({ jobId: 'OUT_OF_SCOPE', mrNo: '1052', atId: 'AT_LIVE' }, scope());
  assert.deepEqual(p, { placed: false, reason: 'job-out-of-scope' });
});

// ── Rule 2: atId + mrNo ─────────────────────────────────────────────────────────────────────────────────────

test('a receipt on this tender lands on its mrNo', () => {
  // ⚠ An MR that HAS jobs, deliberately - this test is about placement, and 8989 would also trip the
  // no-jobs marker, which is a different question tested on its own below.
  const p = placeOilTransaction({ atId: 'AT_LIVE', mrNo: '2089' }, scope());
  assert.deepEqual(p, { placed: true, mrNo: '2089', by: 'atId+mrNo', mrHasNoJobs: false });
});

test('⚠ a receipt on ANOTHER tender is unplaced - this is the leak that was measured', () => {
  // MEGHA's 420 L on AT 26-27 appeared on the 1819 statement too, because the oil side was never
  // tender-scoped while the job side was.
  const p = placeOilTransaction({ atId: 'AT_OTHER', mrNo: '8989' }, scope());
  assert.deepEqual(p, { placed: false, reason: 'other-tender' });
});

test('viewing all tenders admits a receipt from any KNOWN tender', () => {
  const p = placeOilTransaction({ atId: 'AT_OTHER', mrNo: '2089' },
    scope({ viewingAllTenders: true, atId: '' }));
  assert.deepEqual(p, { placed: true, mrNo: '2089', by: 'atId+mrNo', mrHasNoJobs: false });
});

// ── ⚠⚠ A BROKEN REFERENCE IS NOT DEMOTED TO A WEAKER JOIN ───────────────────────────────────────────────────

test('⚠⚠ an atId resolving to no tender is `at-missing`, NOT mrNo-only and NOT other-tender', () => {
  // ADMIN's MR 5585 is in exactly this state: atId NpJKH9fZpMoijypO1GZr, no such document, 2,110 L.
  //
  // Demoting it to the mrNo path would be the sentinel-disables-a-check pattern in a new hat: the strong
  // identifier is PRESENT and BROKEN, and treating "present but unresolvable" as "absent" lets a dangling
  // reference buy a weaker join and then pass as an ordinary string match.
  const p = placeOilTransaction({ atId: 'DELETED_AT', mrNo: '5585' }, scope());
  assert.deepEqual(p, { placed: false, reason: 'at-missing' });
});

test('and it stays at-missing even when all tenders are being viewed', () => {
  // "All tenders" widens the scope; it does not make a non-existent tender exist.
  const p = placeOilTransaction({ atId: 'DELETED_AT', mrNo: '5585' },
    scope({ viewingAllTenders: true, atId: '' }));
  assert.deepEqual(p, { placed: false, reason: 'at-missing' });
});

// ── ⚠⚠ RULE 3: THE PATH NO LIVE RECEIPT TAKES ───────────────────────────────────────────────────────────────

test('⚠⚠ a receipt with NEITHER jobId NOR atId is placed by mrNo alone, and marked', () => {
  // ⚠ UNREACHABLE ON CURRENT DATA, AND VERIFIED ANYWAY. All ten live oil transactions carry an `atId` and
  // seven carry a `jobId`, so nothing exercises this branch - which is exactly why it needs a fixture. The
  // marker it sets is what prints "matched by MR number only" on the statement, and an untested marker is a
  // claim nobody has checked.
  const p = placeOilTransaction({ mrNo: '5585' }, scope());
  assert.deepEqual(p, { placed: true, mrNo: '5585', by: 'mrNo-only', mrHasNoJobs: true });
  assert.equal(p.placed && p.by === 'mrNo-only', true,
    'the caller keys the printed marker off exactly this value');
});

test('an mrNo-only receipt is admitted regardless of which tender is being viewed', () => {
  // It carries no tender, so no tender test can apply to it. That is the whole reason it must be marked.
  for (const s of [scope(), scope({ viewingAllTenders: true, atId: '' }), scope({ atId: 'SOMETHING_ELSE' })]) {
    assert.deepEqual(placeOilTransaction({ mrNo: '5585' }, s),
      { placed: true, mrNo: '5585', by: 'mrNo-only', mrHasNoJobs: true });
  }
});

// ── Rule 4: nothing to go on ────────────────────────────────────────────────────────────────────────────────

test('a receipt with no identifiers at all is unplaced', () => {
  assert.deepEqual(placeOilTransaction({}, scope()), { placed: false, reason: 'no-identifiers' });
  assert.deepEqual(placeOilTransaction({ mrNo: '   ' }, scope()), { placed: false, reason: 'no-identifiers' });
});

test('a tender-scoped receipt with no mrNo is unplaced rather than landing on a blank row', () => {
  assert.deepEqual(placeOilTransaction({ atId: 'AT_LIVE' }, scope()), { placed: false, reason: 'no-identifiers' });
});

// ── The printed phrases ─────────────────────────────────────────────────────────────────────────────────────

test('⚠ every unplaced reason has its own printed phrase, and they are all distinct', () => {
  // Each phrase is printed verbatim on a statement the division reconciles, so each must be true of its own
  // case - "belongs to another tender" about a tender that does not exist would be a false statement on paper.
  const texts = Object.values(OIL_UNPLACED_TEXT);
  assert.equal(texts.length, 4);
  assert.equal(new Set(texts).size, 4, 'two reasons sharing a phrase would make one of them a lie');
  assert.match(OIL_UNPLACED_TEXT['at-missing'], /no longer exists/);
  assert.match(OIL_UNPLACED_TEXT['other-tender'], /another tender/);
  assert.doesNotMatch(OIL_UNPLACED_TEXT['at-missing'], /another tender/);
});

test('values are trimmed, as everywhere else', () => {
  assert.deepEqual(placeOilTransaction({ jobId: ' j1 ' }, scope()),
    { placed: true, mrNo: '1052', by: 'jobId', mrHasNoJobs: false });
  assert.deepEqual(placeOilTransaction({ atId: ' AT_LIVE ', mrNo: ' 2089 ' }, scope()),
    { placed: true, mrNo: '2089', by: 'atId+mrNo', mrHasNoJobs: false });
});

// ── ⚠ THE FIFTH SIGNAL: PLACED SOUNDLY, ONTO AN MR WITH NO TRANSFORMERS (AUDIT G124) ────────────────────────

test('⚠ a tender-scoped receipt on an MR with no jobs is PLACED and marked, not excluded', () => {
  // ADMIN's MR 5585: 2,110 L of fresh oil, tender reference sound once repaired, and no transformer was ever
  // entered under that MR. The oil arrived and the division issued it - what is open is which work for.
  const p = placeOilTransaction({ atId: 'AT_LIVE', mrNo: '5585' }, scope());
  assert.deepEqual(p, { placed: true, mrNo: '5585', by: 'atId+mrNo', mrHasNoJobs: true });
});

test('the same receipt on an MR that DOES have jobs is not marked', () => {
  const p = placeOilTransaction({ atId: 'AT_LIVE', mrNo: '1052' }, scope());
  assert.deepEqual(p, { placed: true, mrNo: '1052', by: 'atId+mrNo', mrHasNoJobs: false });
});

test('⚠ a jobId placement can never be marked - the job IS the evidence', () => {
  const p = placeOilTransaction({ jobId: 'j1' }, scope());
  assert.equal(p.placed && p.mrHasNoJobs, false);
});

test('an mrNo-only receipt carries the no-jobs marker too, so the two doubts stack', () => {
  // Both signals can be true at once: matched by a string, onto an MR with nothing behind it.
  const p = placeOilTransaction({ mrNo: '5585' }, scope());
  assert.deepEqual(p, { placed: true, mrNo: '5585', by: 'mrNo-only', mrHasNoJobs: true });
});
