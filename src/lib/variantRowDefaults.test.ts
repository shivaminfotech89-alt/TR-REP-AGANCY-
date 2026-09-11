// Tests for the shipped CRGO defaults on rows priced against two tender rows (AUDIT O66). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultEstimateData } from './estimateData';
import { SCHEDULE_ITEM_MAP } from './scheduleItemMap';

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
