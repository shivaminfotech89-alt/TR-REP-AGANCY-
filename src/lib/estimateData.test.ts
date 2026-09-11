// Tests for withMissingDefaultsInPlace in lib/estimateData.ts (AUDIT G64). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withMissingDefaults, withMissingDefaultsInPlace, defaultEstimateData, type EstimateItem } from './estimateData';

const row = (itemCode: string, name = itemCode): EstimateItem => ({ itemCode, itemName: name, unit: 'QTY', rates: { '63': 1 } as any });
const codes = (rows: EstimateItem[]) => rows.map(r => r.itemCode);

test('a missing row goes directly after its nearest earlier sibling', () => {
  const out = withMissingDefaultsInPlace([row('a'), row('b'), row('c')], [row('a'), row('b'), row('b1'), row('c')]);
  assert.deepEqual(codes(out), ['a', 'b', 'b1', 'c']);
});

test('a missing first row goes before the nearest later one', () => {
  const out = withMissingDefaultsInPlace([row('a'), row('b')], [row('x'), row('a'), row('b')]);
  assert.deepEqual(codes(out), ['x', 'a', 'b']);
});

test('rows the defaults do not know keep their places', () => {
  const out = withMissingDefaultsInPlace([row('a'), row('custom'), row('b')], [row('a'), row('a1'), row('b')]);
  assert.deepEqual(codes(out), ['a', 'a1', 'custom', 'b']);
});

test('codes match case-insensitively, so 12a(b) is 12A(b)', () => {
  const out = withMissingDefaultsInPlace([row('12a(b)')], [row('12A(b)'), row('12A(b1)')]);
  assert.deepEqual(codes(out), ['12a(b)', '12A(b1)']);
});

test('nothing missing returns the saved list itself', () => {
  const saved = [row('a'), row('b')];
  assert.equal(withMissingDefaultsInPlace(saved, [row('a'), row('b')]), saved);
});

test('an inserted row is a copy - editing it does not reach the defaults', () => {
  const defaults = [row('a'), row('a1')];
  const out = withMissingDefaultsInPlace([row('a')], defaults);
  (out[1].rates as any)['63'] = 999;
  assert.equal((defaults[1].rates as any)['63'], 1);
});

test('the same rows as withMissingDefaults, only placed differently - on the real CRGO defaults', () => {
  const stored = defaultEstimateData.filter(r => !['12A(a1)', '12A(b1)'].includes(r.itemCode));
  const inPlace = withMissingDefaultsInPlace(stored, defaultEstimateData);
  const appended = withMissingDefaults(stored, defaultEstimateData);
  assert.deepEqual([...codes(inPlace)].sort(), [...codes(appended)].sort());
  assert.deepEqual(codes(appended).slice(-2), ['12A(a1)', '12A(b1)']);
  assert.deepEqual(codes(inPlace), codes(defaultEstimateData));
});
