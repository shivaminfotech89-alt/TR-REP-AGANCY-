// Tests for lib/orderReference.ts (AUDIT G63). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { orderReferenceFor, orderRefusalFor } from './orderReference';

const at = (fields: Record<string, unknown>): any => ({ id: 'at1', atNumber: 'ALLOTMENT NO.25903', name: '', ...fields });
const own = (fields: Record<string, unknown>): any => ({ at: at(fields), source: 'own' });

test('an AT with both parts prints them and refuses nothing', () => {
  const ref = orderReferenceFor(own({ orderNo: '  UGVCL/EE-T-1/TRANS-REP/2026-28/01/AT/1808 ', orderDate: '2026-09-07' }), 'STD-1');
  assert.equal(ref.orderNo, 'UGVCL/EE-T-1/TRANS-REP/2026-28/01/AT/1808');
  assert.equal(ref.orderDate, '2026-09-07');
  assert.equal(ref.refusal, null);
});

test('an AT with neither part prints blank and refuses, naming the AT', () => {
  const ref = orderReferenceFor(own({}), 'STD-1');
  assert.equal(ref.orderNo, '');
  assert.equal(ref.orderDate, '');
  assert.match(ref.refusal ?? '', /AT ALLOTMENT NO\.25903 has no order number or order date/);
});

test('half an order is still a refusal - the number without its date, and the date without its number', () => {
  const noDate = orderReferenceFor(own({ orderNo: 'X/1808' }), 'STD-1');
  assert.equal(noDate.orderNo, 'X/1808');
  assert.match(noDate.refusal ?? '', /has no order date\./);
  const noNumber = orderReferenceFor(own({ orderDate: '2026-09-07' }), 'STD-1');
  assert.equal(noNumber.orderNo, '');
  assert.match(noNumber.refusal ?? '', /has no order number\./);
});

test('whitespace is not an order', () => {
  const ref = orderReferenceFor(own({ orderNo: '   ', orderDate: ' ' }), 'STD-1');
  assert.equal(ref.orderNo, '');
  assert.ok(ref.refusal);
});

test('a job with no AT gets no order - never the active tender\'s', () => {
  const ref = orderReferenceFor({ at: null, source: 'no-at' } as any, 'SU-5');
  assert.deepEqual([ref.orderNo, ref.orderDate, ref.at], ['', '', null]);
  assert.match(ref.refusal ?? '', /SU-5 belongs to no tender/);
});

test('a job whose AT is gone gets no order', () => {
  const ref = orderReferenceFor({ at: null, source: 'at-missing', missingAtId: 'gone' } as any, 'SU-6');
  assert.deepEqual([ref.orderNo, ref.orderDate, ref.at], ['', '', null]);
  assert.match(ref.refusal ?? '', /SU-6 names a tender that no longer exists/);
});

test('a batch refuses once per reason, listing the jobs that share an AT', () => {
  const unset = own({});
  const refusal = orderRefusalFor([
    { jobLabel: 'STD-1', ref: orderReferenceFor(unset, 'STD-1') },
    { jobLabel: 'STD-2', ref: orderReferenceFor(unset, 'STD-2') },
    { jobLabel: 'SU-5', ref: orderReferenceFor({ at: null, source: 'no-at' } as any, 'SU-5') },
    { jobLabel: 'OK-1', ref: orderReferenceFor(own({ orderNo: 'X', orderDate: '2026-09-07' }), 'OK-1') },
  ]);
  assert.ok(refusal);
  assert.equal(refusal!.lines.length, 2);
  assert.match(refusal!.lines[0], /Jobs: STD-1, STD-2\.$/);
  assert.match(refusal!.lines[1], /^SU-5 belongs to no tender/);
  assert.equal(refusal!.at?.id, 'at1');
});

test('a batch where every estimate has its order refuses nothing', () => {
  const ok = orderReferenceFor(own({ orderNo: 'X', orderDate: '2026-09-07' }), 'OK-1');
  assert.equal(orderRefusalFor([{ jobLabel: 'OK-1', ref: ok }]), null);
  assert.equal(orderRefusalFor([]), null);
});

// ⚠ THE DEFECT ITSELF, BY SOURCE. The hardcoded reference and date must not come back into the estimate.
test('the estimate source no longer carries the hardcoded 2020-21 order or its date', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/SingleJobEstimateReport.tsx'), 'utf8');
  assert.ok(src.includes('orderRef'), 'the estimate does not read orderRef - this test would be scanning the wrong file');
  assert.equal(src.includes('2020-21/01/1102'), false);
  assert.equal(src.includes('16/04/2021'), false);
  assert.equal(/atDetails|contractAgreementNo/.test(src), false);
});
