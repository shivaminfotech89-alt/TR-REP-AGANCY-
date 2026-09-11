// Tests for the shipped overhauling defaults (AUDIT O66). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultOverhaulingEstimateData } from './estimateData';

test("overhauling row 7 ships no rate, so the job's own tender's Schedule-A Sr 21 prices it", () => {
  const row = defaultOverhaulingEstimateData.find(r => String(r.itemCode) === '7');
  assert.ok(row, 'row 7 must stay - a default row a stored section lacks is re-added from these defaults');
  assert.deepEqual(Object.entries(row!.rates).filter(([, v]) => v !== null), [], 'every capacity cell is null');
  assert.equal(row!.fixedRate, null);
});

test('every capacity key is present, as null - an absent key is refilled from the defaults, a null is kept', () => {
  const row = defaultOverhaulingEstimateData.find(r => String(r.itemCode) === '7')!;
  for (const kva of ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500']) {
    assert.ok(kva in row.rates, `${kva} kVA key present`);
  }
});
