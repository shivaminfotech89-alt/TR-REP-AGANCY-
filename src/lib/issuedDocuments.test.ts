// Tests for lib/issuedDocuments.js (AUDIT G3, G87). Run with `npm test`.
//
// `hasIssuedDocument` guards a DELETE and is deliberately broad. `hasPricedDocument` feeds a
// COUNT shown to an operator - "N documents would reprint differently" - and a count is a claim.
// These exist to keep the second from drifting into the first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ISSUED_FIELDS,
  PRICED_DOCUMENT_FIELDS,
  hasIssuedDocument,
  hasPricedDocument,
} from './issuedDocuments.js';

test('⚠ the priced subset is a real subset - every name is in ISSUED_FIELDS', () => {
  const known = new Set(ISSUED_FIELDS.map(([field]: any) => field));
  for (const field of PRICED_DOCUMENT_FIELDS) {
    assert.ok(known.has(field), `${field} is not in ISSUED_FIELDS - the two have drifted`);
  }
});

test('⚠ a dispatched job with only a challan carries NO priced document', () => {
  // This is the overcount the narrower test exists to prevent: a challan has no prices on it,
  // so a percentage change cannot make it reprint differently.
  const job = { challanNo: 'CH/1', challanDate: '2026-09-01', dispatchDate: '2026-09-01', issuedByAgencyId: 'ag1' };
  assert.equal(hasIssuedDocument(job), true, 'it IS issued - the delete guard must still stop on it');
  assert.equal(hasPricedDocument(job), false, 'but nothing on it carries a price');
});

test('an estimate that has been sent is a priced document', () => {
  assert.equal(hasPricedDocument({ estimateSentDate: '2026-09-10' }), true);
  assert.equal(hasPricedDocument({ estimateAmount: 12500 }), true);
  assert.equal(hasPricedDocument({ estimateNo: 'EST/7' }), true);
});

test('a bill that has been raised is a priced document', () => {
  assert.equal(hasPricedDocument({ billNo: 'BILL/1' }), true);
  assert.equal(hasPricedDocument({ billSentDate: '2026-08-15' }), true);
  assert.equal(hasPricedDocument({ billAmount: 26285 }), true);
  assert.equal(hasPricedDocument({ billStatus: 'Sent' }), true);
});

test('a job with nothing issued carries no priced document', () => {
  assert.equal(hasPricedDocument({ jobNo: 'MSBT-3', status: 'Received' }), false);
  assert.equal(hasPricedDocument({}), false);
  assert.equal(hasPricedDocument(null), false);
});

test("the form defaults 'Unpaid' and 'Pending' are not evidence of anything", () => {
  // Inherited from isPresent, and asserted here because this test feeds a COUNT: every job in
  // an agency carries these defaults, so counting them would report the whole tender.
  assert.equal(hasPricedDocument({ billStatus: 'Pending' }), false);
  assert.equal(hasPricedDocument({ paymentStatus: 'Unpaid' }), false);
});

test('zero and blank are not figures', () => {
  assert.equal(hasPricedDocument({ billAmount: 0 }), false);
  assert.equal(hasPricedDocument({ estimateNo: '   ' }), false);
  assert.equal(hasPricedDocument({ billNo: '-' }), false);
});

test('MSBT-12 as live data holds it - estimated, billed and paid - is a priced document', () => {
  const msbt12 = {
    jobNo: 'MSBT-12',
    estimateSentDate: '2026-08-15',
    estimateAmount: 26285,
    billNo: 'BILL/1',
    billStatus: 'Sent',
    paymentStatus: 'Paid',
    challanNo: 'CH/9',
  };
  assert.equal(hasPricedDocument(msbt12), true);
});
