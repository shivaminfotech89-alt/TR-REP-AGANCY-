// Tests for lib/scrapState.ts (AUDIT O80). Run with `npm test`.
//
// The load-bearing cases are the two that live data proved: a scrapped job whose status has
// moved on to 'Dispatched', and a job that is scrap ONLY in its inspection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  scrapEvidence, isScrapJob, scrapCounts, SCRAP_STATUS_VARIANT,
  challanDisposition, scrapCategoryLabel,
  CHALLAN_SCRAP_DISPOSITION, CHALLAN_REPAIRED_DISPOSITION, CATEGORY_SCRAP, CATEGORY_REPAIRABLE,
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

// ── ⚠⚠ THE TWO PRINTED LABELS, BOTH BRANCHES (AUDIT G121) ───────────────────────────────────────────────────

// ⚠ THE NON-SCRAP BRANCH IS THE POINT OF THESE TESTS. The defect they exist to catch is a bare `isScrapJob`
// identifier in the JSX - the imported FUNCTION, truthy always - which prints the scrap word on every document.
// A test that only asserts the scrap case passes against it. tsc cannot see it either: a function reference is
// a valid truthy expression in a conditional.

const repaired = { id: 'r1', jobNo: 'ZB-5', status: 'Dispatched', condition: 'Repairable' };
const scrapped = { id: 's1', jobNo: 'ZB-12', status: 'Scrap', condition: 'Scrap' };
// ASU-2's exact live shape: the declaration reached the inspection and never the job (O80).
const asu2 = { id: 'asu2', jobNo: 'ASU-2', status: 'Dispatched', condition: undefined };
const asu2Insp = [{ jobId: 'asu2', type: 'Internal', data: { condition: 'Scrap' } }];

test('⚠ the delivery challan prints "Tested OK" for a repaired unit', () => {
  assert.equal(challanDisposition(repaired), 'Tested OK');
  assert.equal(challanDisposition(repaired), CHALLAN_REPAIRED_DISPOSITION);
});

test('the delivery challan prints "Scrap - Returned" for a scrapped unit', () => {
  assert.equal(challanDisposition(scrapped), 'Scrap - Returned');
  assert.equal(challanDisposition(scrapped), CHALLAN_SCRAP_DISPOSITION);
});

test('⚠ the forwarding letter prints REPAIRABLE for a non-scrap job', () => {
  assert.equal(scrapCategoryLabel(repaired), 'REPAIRABLE');
  assert.equal(scrapCategoryLabel(repaired), CATEGORY_REPAIRABLE);
});

test('the forwarding letter prints SCRAP for a scrapped job', () => {
  assert.equal(scrapCategoryLabel(scrapped), 'SCRAP');
  assert.equal(scrapCategoryLabel(scrapped), CATEGORY_SCRAP);
});

test('⚠⚠ ASU-2: both documents follow the inspection, which is the whole change', () => {
  // Without the inspection list both labels read the job alone and get it wrong - which is exactly what the
  // two inline sites did while they printed.
  assert.equal(challanDisposition(asu2), 'Tested OK', 'the job document alone cannot answer it');
  assert.equal(scrapCategoryLabel(asu2), 'REPAIRABLE', 'ditto');
  assert.equal(challanDisposition(asu2, asu2Insp), 'Scrap - Returned');
  assert.equal(scrapCategoryLabel(asu2, asu2Insp), 'SCRAP');
});

test('the labels are two vocabularies for one fact, and never the same string', () => {
  // Merging them would force one document to use the other's wording. They must stay distinct.
  assert.notEqual(CHALLAN_SCRAP_DISPOSITION, CATEGORY_SCRAP);
  assert.notEqual(CHALLAN_REPAIRED_DISPOSITION, CATEGORY_REPAIRABLE);
});

test('an omitted inspection list is treated as none, not as an error', () => {
  // Both printed sites pass `agencyInspections`, which is `[]` while the agency data is still loading.
  assert.equal(challanDisposition(repaired, []), 'Tested OK');
  assert.equal(scrapCategoryLabel(repaired, []), 'REPAIRABLE');
  assert.equal(challanDisposition(scrapped, []), 'Scrap - Returned', 'the job-level arms still work');
});

// ── The printed sites must call the label, never hold a boolean ─────────────────────────────────────────────

test('⚠⚠ neither printed site declares a local boolean the JSX could shadow', () => {
  const challan = readFileSync(new URL('../components/DispatchChallan.tsx', import.meta.url), 'utf8');
  const letter = readFileSync(new URL('../components/EstimateGenerate.tsx', import.meta.url), 'utf8');
  for (const [name, src] of [['DispatchChallan', challan], ['EstimateGenerate', letter]]) {
    // A bare `isScrapJob` used as a value - the silent failure. Only calls and the import may mention it.
    const bare = src.split('\n').filter(l =>
      /\bisScrapJob\b/.test(l) && !/isScrapJob\s*\(/.test(l) && !/^import/.test(l.trim()));
    assert.deepEqual(bare, [], `${name} has a bare isScrapJob reference: ${bare.join(' | ')}`);
  }
  assert.ok(challan.includes('challanDisposition(job, agencyInspections)'));
  assert.ok(letter.includes('scrapCategoryLabel(job, agencyInspections)'));
});
