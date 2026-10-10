// Tests for lib/replacementJob - "received against OH SU-9", and the arithmetic it explains (AUDIT G115).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allotmentOverrun, freedSlotReason, receivedAgainstLabel, replaceableJobs } from './replacementJob';
import { bookedFor, drawsOnAllotment } from './allotments';

const job = (over: Record<string, unknown> = {}) => ({
  id: String(over.jobNo ?? 'x'),
  division: 'SABARMATI',
  coreType: 'CRGO',
  repairType: 'OGP',
  agencyId: 'ag1',
  ...over,
}) as any;

const scope = { division: 'SABARMATI', coreType: 'CRGO', agencyId: 'ag1' };

// ── Why a slot was freed ────────────────────────────────────────────────────────────────────────────────────

test('a freed slot is OH or Scrap, and an ordinary job frees nothing', () => {
  assert.equal(freedSlotReason(job({ jobNo: 'SU-1' })), null);
  assert.equal(freedSlotReason(job({ jobNo: 'SU-9', repairType: 'OH' })), 'OH');
  assert.equal(freedSlotReason(job({ jobNo: 'SU-9', condition: 'OH' })), 'OH');
  assert.equal(freedSlotReason(job({ jobNo: 'SU-2', condition: 'Scrap' })), 'Scrap');
  assert.equal(freedSlotReason(job({ jobNo: 'SU-2', status: 'Scrap' })), 'Scrap');
});

test('⚠ scrap is asked first, because OH -> Scrap is permitted and Scrap is the terminal reading', () => {
  const both = job({ jobNo: 'SU-9', repairType: 'OH', condition: 'Scrap' });
  assert.equal(freedSlotReason(both), 'Scrap');
});

test('⚠ a unit scrap ONLY in its inspection still freed a slot (ASU-2, O80)', () => {
  const j = job({ jobNo: 'ASU-2', id: 'asu2', status: 'Dispatched', condition: '' });
  assert.equal(freedSlotReason(j), null, 'the job alone cannot answer it');
  assert.equal(
    freedSlotReason(j, [{ jobId: 'asu2', type: 'Internal', data: { condition: 'Scrap' } }]),
    'Scrap');
});

// ── Which units a replacement may be issued against ─────────────────────────────────────────────────────────

test('only OH and Scrap units of the same division, core type and agency are candidates', () => {
  const jobs = [
    job({ jobNo: 'SU-1' }),
    job({ jobNo: 'SU-9', repairType: 'OH' }),
    job({ jobNo: 'SU-2', condition: 'Scrap' }),
    job({ jobNo: 'KLL-4', division: 'KALOL', condition: 'Scrap' }),
    job({ jobNo: 'ASW-1', coreType: 'Amorphous', condition: 'Scrap' }),
    job({ jobNo: 'OTHER-1', agencyId: 'ag2', condition: 'Scrap' }),
  ];
  assert.deepEqual(replaceableJobs(jobs, scope).map(j => j.jobNo), ['SU-9', 'SU-2']);
});

test('⚠⚠ a unit already replaced is not offered again - two slots for one freed slot is the over-allotment', () => {
  const jobs = [
    job({ jobNo: 'SU-9', repairType: 'OH' }),
    job({ jobNo: 'SU-10', repairType: 'OH' }),
    job({ jobNo: 'SU-11', issuedAgainstJobId: 'SU-9', issuedAgainstReason: 'OH' }),
  ];
  assert.deepEqual(replaceableJobs(jobs, scope).map(j => j.jobNo), ['SU-10']);
});

test('a CANCELLED replacement releases the unit it was issued against', () => {
  const jobs = [
    job({ jobNo: 'SU-9', repairType: 'OH' }),
    job({ jobNo: 'SU-11', issuedAgainstJobId: 'SU-9', isCancelled: true }),
  ];
  assert.deepEqual(replaceableJobs(jobs, scope).map(j => j.jobNo), ['SU-9']);
});

test('a cancelled OH unit is not a candidate - it never freed a slot', () => {
  const jobs = [job({ jobNo: 'SU-9', repairType: 'OH', mrStatus: 'Cancelled' })];
  assert.deepEqual(replaceableJobs(jobs, scope), []);
});

// ── The label ───────────────────────────────────────────────────────────────────────────────────────────────

test('the label names the reason and the job it replaced', () => {
  const lookup = (id: string) => ({ j9: 'SU-9' } as any)[id];
  assert.equal(
    receivedAgainstLabel({ issuedAgainstJobId: 'j9', issuedAgainstReason: 'OH' }, lookup),
    'Received against OH SU-9');
  assert.equal(
    receivedAgainstLabel({ issuedAgainstJobId: 'j9', issuedAgainstReason: 'Scrap' }, lookup),
    'Received against Scrap SU-9');
});

test('an ordinary job has no label at all', () => {
  assert.equal(receivedAgainstLabel({}, () => undefined), null);
  assert.equal(receivedAgainstLabel({ issuedAgainstJobId: '' }, () => undefined), null);
});

test('⚠ a replacement whose target is gone still says what it was issued for', () => {
  // The reason is the part the division asks about, so it must not fall silent with the job number.
  assert.equal(
    receivedAgainstLabel({ issuedAgainstJobId: 'deleted', issuedAgainstReason: 'Scrap' }, () => undefined),
    'Received against a Scrap unit');
});

// ── ⚠⚠ THE OPERATOR'S OWN EXAMPLE, END TO END ───────────────────────────────────────────────────────────────

test('⚠⚠ SU-1..SU-13 against a 10-unit CRGO quota: ten drawing, and the quota is not exceeded', () => {
  // "IF REPAIRER AGANCIES GET 10 NO OF JOB FROM SU-1 TO SU-10 AND GOUND 2 NOS OF JO SU-9 AND SU-10 'OH' ...
  //  IN SAME WAY IF JOB NO SU-2 DECLARED SCRAP THEN ... SU-13(AGAINST SCRAP), SO TOTAL ALLOTMENT FOR CRGO JOB
  //  IS 10 NOS AND AGANCIES JOB NO UPTO 13"
  const jobs = [
    job({ jobNo: 'SU-1' }),
    job({ jobNo: 'SU-2', condition: 'Scrap' }),
    job({ jobNo: 'SU-3' }), job({ jobNo: 'SU-4' }), job({ jobNo: 'SU-5' }),
    job({ jobNo: 'SU-6' }), job({ jobNo: 'SU-7' }), job({ jobNo: 'SU-8' }),
    job({ jobNo: 'SU-9', repairType: 'OH', condition: 'OH' }),
    job({ jobNo: 'SU-10', repairType: 'OH', condition: 'OH' }),
    job({ jobNo: 'SU-11', issuedAgainstJobId: 'SU-9', issuedAgainstReason: 'OH' }),
    job({ jobNo: 'SU-12', issuedAgainstJobId: 'SU-10', issuedAgainstReason: 'OH' }),
    job({ jobNo: 'SU-13', issuedAgainstJobId: 'SU-2', issuedAgainstReason: 'Scrap' }),
  ];

  assert.equal(jobs.length, 13, 'thirteen job numbers were issued');
  assert.equal(bookedFor(jobs, scope), 10, 'and exactly ten of them drew on the allotment');

  // ⚠ The replacements draw normally. That is what closes the arithmetic.
  for (const no of ['SU-11', 'SU-12', 'SU-13']) {
    assert.equal(drawsOnAllotment(jobs.find(j => j.jobNo === no)!), true, no);
  }
  for (const no of ['SU-2', 'SU-9', 'SU-10']) {
    assert.equal(drawsOnAllotment(jobs.find(j => j.jobNo === no)!), false, no);
  }

  // Nothing further may be issued against them - every freed slot is used.
  assert.deepEqual(replaceableJobs(jobs, scope), []);

  const o = allotmentOverrun(jobs, scope);
  assert.deepEqual(o, { total: 13, drawing: 10, freedOh: 2, freedScrap: 1, replacements: 3 });
});

test('⚠ the widget line reports an unreplaced balance, which is the actionable half', () => {
  const jobs = [
    job({ jobNo: 'SU-9', repairType: 'OH', condition: 'OH' }),
    job({ jobNo: 'SU-10', repairType: 'OH', condition: 'OH' }),
    job({ jobNo: 'SU-11', issuedAgainstJobId: 'SU-9', issuedAgainstReason: 'OH' }),
  ];
  const o = allotmentOverrun(jobs, scope);
  assert.equal(o.freedOh, 2);
  assert.equal(o.replacements, 1);
  assert.equal(o.freedOh + o.freedScrap - o.replacements, 1, 'one more job is still owed');
});

test('⚠ `drawing` comes from the shared predicate, so GP rework is not mistaken for a freed slot', () => {
  // GP draws nothing and frees nothing: it is rework on a job the quota already paid for. A `total - freed`
  // subtraction would have counted it as drawing.
  const jobs = [job({ jobNo: 'SBT-31', repairType: 'GP' }), job({ jobNo: 'SU-1' })];
  const o = allotmentOverrun(jobs, scope);
  assert.equal(o.total, 2);
  assert.equal(o.drawing, 1);
  assert.equal(o.freedOh + o.freedScrap, 0, 'GP is not a freed slot');
});
