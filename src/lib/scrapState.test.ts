// Tests for lib/scrapState.ts (AUDIT O80). Run with `npm test`.
//
// The load-bearing cases are the two that live data proved: a scrapped job whose status has
// moved on to 'Dispatched', and a job that is scrap ONLY in its inspection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scrapEvidence, isScrapJob, scrapCounts, SCRAP_STATUS_VARIANT,
  isScrapAdjustment, inwardOnly, scrapAdjustmentsOnly, SCRAP_OIL_TYPE,
} from './scrapState';

const insp = (jobId: string, condition = 'Scrap', type = 'Internal') =>
  ({ id: `i-${jobId}`, jobId, type, data: { condition } });

test('a repairable job with no scrap evidence is not scrap', () => {
  const e = scrapEvidence({ id: 'j1', status: 'Received', condition: 'Repairable' }, [insp('j1', 'Repairable')]);
  assert.equal(e.isScrap, false);
  assert.deepEqual(e.matched, []);
});

test('each test alone is enough, and the evidence says which', () => {
  assert.deepEqual(scrapEvidence({ id: 'a', status: 'Scrap' }).matched, ['status']);
  assert.deepEqual(scrapEvidence({ id: 'b', condition: 'Scrap' }).matched, ['condition']);
  assert.deepEqual(scrapEvidence({ id: 'c' }, [insp('c')]).matched, ['inspection']);
});

test('⚠ A SCRAPPED JOB THAT HAS BEEN DELIVERED BACK IS STILL SCRAP (the six Dispatched ones)', () => {
  // `status` is a workflow stage and moves on; `condition` is an assessment and persists.
  // Six of twelve live scrap jobs read 'Dispatched', so a status-only test finds 5 of 12.
  const job = { id: 'KLL-6', status: 'Dispatched', condition: 'Scrap' };
  const e = scrapEvidence(job, [insp('KLL-6')]);
  assert.equal(e.isScrap, true);
  assert.equal(e.byStatus, false, 'status has moved on');
  assert.deepEqual(e.matched, ['condition', 'inspection']);
});

test('⚠ ASU-2: SCRAP ONLY IN ITS INSPECTION - the job document cannot answer alone', () => {
  // status 'Dispatched', condition EMPTY, inspection says Scrap. The census that used
  // `condition` missed it and reported 609.00 where the figure is 699.00.
  const job = { id: 'ASU-2', status: 'Dispatched', condition: '' };
  assert.equal(isScrapJob(job), false, 'without inspections it is invisible');
  assert.equal(isScrapJob(job, [insp('ASU-2')]), true, 'with them it is found');
});

test('⚠ THE STATUS VARIANT THE UI OFFERS IS ACCEPTED, THOUGH NOTHING CARRIES IT YET', () => {
  // MrLedger's JOB_STATUSES offers 'Scrap / Unrepairable'. Every test in the app compared
  // against 'Scrap', so a job saved with it would have been invisible to all of them.
  assert.equal(isScrapJob({ id: 'x', status: SCRAP_STATUS_VARIANT }), true);
});

test('an External inspection recording Scrap does not count - only Internal declares it', () => {
  assert.equal(isScrapJob({ id: 'e1' }, [insp('e1', 'Scrap', 'External')]), false);
});

test("another job's inspection never makes this one scrap", () => {
  assert.equal(isScrapJob({ id: 'j1' }, [insp('j2')]), false);
});

test('a job with no id is not matched by any inspection', () => {
  assert.equal(isScrapJob({ status: 'Received' }, [insp('')]), false);
});

test('whitespace and case around the marker do not hide it', () => {
  assert.equal(isScrapJob({ id: 'w', condition: '  Scrap  ' }), true);
});

test('⚠ THE COUNTS REPRODUCE THE LIVE SPLIT: 5 by status, 11 by condition, 12 by any', () => {
  // The shape measured across live data - the reason this module exists.
  const jobs = [
    { id: 'a', status: 'Scrap', condition: 'Scrap' },
    { id: 'b', status: 'Scrap', condition: 'Scrap' },
    { id: 'c', status: 'Scrap', condition: 'Scrap' },
    { id: 'd', status: 'Scrap', condition: 'Scrap' },
    { id: 'e', status: 'Scrap', condition: 'Scrap' },
    { id: 'f', status: 'Dispatched', condition: 'Scrap' },
    { id: 'g', status: 'Dispatched', condition: 'Scrap' },
    { id: 'h', status: 'Dispatched', condition: 'Scrap' },
    { id: 'i', status: 'Dispatched', condition: 'Scrap' },
    { id: 'j', status: 'Dispatched', condition: 'Scrap' },
    { id: 'k', status: 'Dispatched', condition: 'Scrap' },
    { id: 'ASU-2', status: 'Dispatched', condition: '' },
  ];
  const inspections = jobs.map(j => insp(j.id));
  const c = scrapCounts(jobs, inspections);
  assert.equal(c.byStatus, 5);
  assert.equal(c.byCondition, 11);
  assert.equal(c.byInspection, 12);
  assert.equal(c.any, 12, 'the widest test finds all of them');
  assert.equal(c.total, 12);
});

test('scrapCounts on an empty list is zeroes, not a crash', () => {
  assert.deepEqual(scrapCounts([], []), { byStatus: 0, byCondition: 0, byInspection: 0, any: 0, total: 0 });
});

// ---------------------------------------------------------------- the adjustment marker

test('a scrap adjustment is marked by its oilType, and ordinary receipts are not', () => {
  assert.equal(isScrapAdjustment({ oilType: SCRAP_OIL_TYPE }), true);
  assert.equal(isScrapAdjustment({ oilType: 'Fresh' }), false);
  assert.equal(isScrapAdjustment({ oilType: 'Used' }), false);
  assert.equal(isScrapAdjustment({}), false, 'an absent oilType is a receipt, as it always was');
});

test('⚠ `Used` IS NOT AN ADJUSTMENT - it is a legitimate inward type', () => {
  // Used oil is oil the DIVISION issued. Marking adjustments with it would classify nothing,
  // and it forces a 5% filtration loss that a scrapped unit never incurs.
  assert.equal(isScrapAdjustment({ oilType: 'Used', jobId: 'j1' }), false);
});

test('⚠ A jobId ALONE DOES NOT MAKE A ROW AN ADJUSTMENT', () => {
  // The marker is explicit on purpose: an implicit one means anything that ever writes a job
  // reference for another reason silently becomes a deduction against the division.
  assert.equal(isScrapAdjustment({ jobId: 'j1' }), false);
});

test('the split is exhaustive - every row is inward or an adjustment, never both', () => {
  const rows = [
    { id: 'a', oilType: 'Fresh' },
    { id: 'b', oilType: 'Used' },
    { id: 'c', oilType: SCRAP_OIL_TYPE },
    { id: 'd' },
  ];
  assert.deepEqual(inwardOnly(rows).map((r: any) => r.id), ['a', 'b', 'd']);
  assert.deepEqual(scrapAdjustmentsOnly(rows).map((r: any) => r.id), ['c']);
  assert.equal(inwardOnly(rows).length + scrapAdjustmentsOnly(rows).length, rows.length);
});

test('whitespace around the marker does not hide it', () => {
  assert.equal(isScrapAdjustment({ oilType: '  Scrap  ' }), true);
});

test('the split handles an empty list', () => {
  assert.deepEqual(inwardOnly([]), []);
  assert.deepEqual(scrapAdjustmentsOnly([]), []);
});
