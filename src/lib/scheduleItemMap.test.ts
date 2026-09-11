// Tests for the coil rows in lib/scheduleItemMap.ts (AUDIT G64). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineForMasterRow, scheduleSrForMasterCode, SCHEDULE_ITEM_MAP } from './scheduleItemMap';
import { defaultEstimateData } from './estimateData';

const line = (itemCode: string, scheduleSr: string | undefined, desc = '') => ({ itemCode, scheduleSr, desc });
const HV_ROWS = ['12A(a)', '12A(a1)', '12A(b)', '12A(b1)'];

const alSe = [line('12A', '12A-b1', 'HV Coil(Aluminium SE)-N'), line('13A', '13A-b'), line('12C', undefined, 'Labour HV Coil(Aluminium)')];
const alPlain = [line('12A', '12A-b', 'HV Coil(Aluminium)-N'), line('13A', '13A-b')];
const cuSe = [line('12A', '12A-a1', 'HV Coil(Copper SE)-N'), line('13A', '13A-a')];

test('an S.E. job\'s HV coil lands on 12A(b1) - not on 12A(b), the row the estimate does not name', () => {
  assert.equal(lineForMasterRow('12A(b1)', alSe, 'Aluminium'), alSe[0]);
  assert.equal(lineForMasterRow('12A(b)', alSe, 'Aluminium'), undefined);
});

test('a without-S.E. job\'s HV coil lands on 12A(b), not on 12A(b1)', () => {
  assert.equal(lineForMasterRow('12A(b)', alPlain, 'Aluminium'), alPlain[0]);
  assert.equal(lineForMasterRow('12A(b1)', alPlain, 'Aluminium'), undefined);
});

test('copper S.E. lands on 12A(a1) and on no aluminium row', () => {
  assert.equal(lineForMasterRow('12A(a1)', cuSe, 'Copper'), cuSe[0]);
  for (const row of ['12A(a)', '12A(b)', '12A(b1)']) assert.equal(lineForMasterRow(row, cuSe, 'Copper'), undefined, row);
});

test('every HV coil line lands on exactly one of the four HV rows', () => {
  for (const [job, material] of [[alSe, 'Aluminium'], [alPlain, 'Aluminium'], [cuSe, 'Copper']] as const) {
    const hits = HV_ROWS.filter(r => lineForMasterRow(r, job as any, material));
    assert.equal(hits.length, 1, JSON.stringify(hits));
  }
});

test('an unknown winding material lands the charge on no coil row', () => {
  for (const row of [...HV_ROWS, '13A(a)', '13b(b)']) assert.equal(lineForMasterRow(row, alSe, null), undefined, row);
});

test('rows that are not coil rows still match on item code, the Labour Charge line excepted', () => {
  assert.equal(lineForMasterRow('12C', alSe, 'Aluminium'), alSe[2]);
  const withLabour = [line('1a', undefined, 'Labour Charge'), line('1a', undefined, 'Something else')];
  assert.equal(lineForMasterRow('1a', withLabour, 'Aluminium'), withLabour[1]);
});

test('the HV S.E. pair is paired with its Schedule-A rows', () => {
  assert.equal(scheduleSrForMasterCode('12A(a1)'), '12A-a1');
  assert.equal(scheduleSrForMasterCode('12A(b1)'), '12A-b1');
});

test('the default S.E. rows sit directly under their without-S.E. siblings, named to be told apart', () => {
  const codes = defaultEstimateData.map(r => r.itemCode);
  assert.equal(codes[codes.indexOf('12A(a)') + 1], '12A(a1)');
  assert.equal(codes[codes.indexOf('12A(b)') + 1], '12A(b1)');
  assert.equal(defaultEstimateData.find(r => r.itemCode === '12A(b1)')?.itemName, 'HV Wdg. (Not Miss) -AL S.E.');
  assert.equal(defaultEstimateData.find(r => r.itemCode === '12A(a1)')?.itemName, 'HV Wdg. (Not Miss) -CU S.E.');
});

// ⚠ BY DECISION (G64): a row nothing reads would silently discard a rate typed into it.
test('no LV S.E. row and no originals-missing row, in the map or in the default master', () => {
  const codes = new Set([...SCHEDULE_ITEM_MAP.map(m => m.masterCode), ...defaultEstimateData.map(r => r.itemCode)].map(c => c.toLowerCase()));
  for (const c of ['13a(a1)', '13a(b1)', '13b(b1)', '12b(a)', '12b(b)', '12b(a1)', '12b(b1)']) assert.equal(codes.has(c), false, c);
});
