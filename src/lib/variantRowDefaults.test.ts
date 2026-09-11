// Tests for the shipped CRGO defaults on rows priced against two tender rows (AUDIT O66). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultEstimateData } from './estimateData';
import { SCHEDULE_ITEM_MAP, NOT_FROM_SCHEDULE_A } from './scheduleItemMap';

// A shipped figure on a row priced from Schedule-A is a copy of one tender's rate: ignored by pricing, shown by the
// Estimate Master grid as though it were the AT's own tender's, and written into every agency and AT by seeding
// (AUDIT O70). Only a row the tender does not price may ship a figure.
test('no default CRGO row priced from Schedule-A carries a rate - only the rows the tender does not price may', () => {
  const fromSchedule = new Set(SCHEDULE_ITEM_MAP.map(m => m.masterCode.toLowerCase()));
  const carrying = defaultEstimateData.filter(r => Object.values(r.rates).some(v => v !== null));
  for (const r of carrying) {
    assert.equal(fromSchedule.has(String(r.itemCode).toLowerCase()), false, `default row ${r.itemCode} is priced from Schedule-A and carries a rate`);
    assert.ok(String(r.itemCode) in NOT_FROM_SCHEDULE_A, `default row ${r.itemCode} carries a rate and is not recorded as priced outside Schedule-A`);
  }
  assert.deepEqual(carrying.map(r => r.itemCode), ['22'], 'the scrap row is the one that keeps its figure');
});

// A master row whose tender row is chosen by the JOB - kV class or winding material - can hold only one tender row's
// figure, and the copy test honours it as an override of the other. So the shipped default for such a row holds none.
test('a default CRGO row priced against two tender rows chosen by the job carries no rate', () => {
  const variantCodes = SCHEDULE_ITEM_MAP
    .filter(m => m.variants && (m.variants.axis === 'kv-class' || m.variants.axis === 'winding-material'))
    .map(m => m.masterCode.toLowerCase());
  const rows = defaultEstimateData.filter(r => variantCodes.includes(String(r.itemCode).toLowerCase()));
  assert.deepEqual(rows.map(r => r.itemCode).sort(), ['12C', '13C', '8'], 'the rows this guards - a change here changes what it sees');
  for (const r of rows) {
    assert.deepEqual(Object.entries(r.rates).filter(([, v]) => v !== null), [], `default row ${r.itemCode} carries no rate`);
  }
});
