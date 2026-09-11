// Tests for lib/gridInheritance.ts and lib/overhaulingRows.ts (AUDIT G68). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inheritedForCell, type GridSection } from './gridInheritance';
import { overhaulingRowKind } from './overhaulingRows';
import { SCHEDULES } from './ugvclSchedules';
import { SCHEDULE_ITEM_MAP } from './scheduleItemMap';

const S26 = SCHEDULES['UGVCL-2026'];
const S20 = SCHEDULES['UGVCL-2020'];
const CAPS = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'];

test('the Overhauling radiator row does not borrow CRGO item 5 - the oil gauge glass', () => {
  assert.deepEqual(inheritedForCell('CRGO', S26, '5', 'Oil Level Glass', '10'), { kind: 'rate', value: 46 });
  for (const kva of CAPS) {
    assert.deepEqual(inheritedForCell('OVERHAULING', S26, '5', 'Complete Radiator replacement of same size', kva), { kind: 'none' }, kva);
  }
});

test("CRGO shows the AT's own tender - 2079, 1524, 165 under UGVCL-2026", () => {
  assert.deepEqual(inheritedForCell('CRGO', S26, '1a', 'Dismentaling', '25'), { kind: 'rate', value: 2079 });
  assert.deepEqual(inheritedForCell('CRGO', S20, '1a', 'Dismentaling', '25'), { kind: 'rate', value: 2061 });
  assert.deepEqual(inheritedForCell('CRGO', S26, '17', 'Con. of Sealed to Bolt', '63'), { kind: 'rate', value: 1524 });
  assert.deepEqual(inheritedForCell('CRGO', S26, '12A(b)', 'HV Wdg. (Not Miss) -AL', '25'), { kind: 'rate', value: 165 });
});

test("the Overhauling overhaul row shows Schedule-A Sr 21 of the AT's own tender", () => {
  const oh = (set: typeof S26, kva: string) => inheritedForCell('OVERHAULING', set, '7', 'Overhauling of complete transformer:', kva);
  assert.deepEqual(oh(S26, '63'), { kind: 'rate', value: 3189 });
  assert.deepEqual(oh(S20, '63'), { kind: 'rate', value: 3162 });
  assert.deepEqual(oh(S26, '5'), { kind: 'rate', value: 2009 });
  assert.deepEqual(oh(S26, '500'), { kind: 'rate', value: 3510 });
});

test('no other Overhauling row inherits anything - tank, conservator, radiator, sealing, or a custom row', () => {
  for (const [code, name] of [['3', 'Tank replacement of same size & thickness (per KG)'], ['4', 'Conservator Tank replacement of same size (per KG)'],
    ['5', 'Complete Radiator replacement of same size'], ['6', 'Rate for sealing of uneconomical unit by welding'], ['9', 'Some other overhauling extra']]) {
    for (const kva of CAPS) assert.deepEqual(inheritedForCell('OVERHAULING', S26, code, name, kva), { kind: 'none' }, `${code}@${kva}`);
  }
});

test('no CRGO code answers in any other section, under either tender', () => {
  const others: GridSection[] = ['AMORPHOUS', 'WOUND_CORE', 'CIRCLE_LIMITS', 'OVERHAULING'];
  for (const set of [S20, S26]) {
    for (const m of SCHEDULE_ITEM_MAP) {
      for (const section of others) {
        for (const kva of CAPS) {
          assert.deepEqual(inheritedForCell(section, set, m.masterCode, m.masterName, kva), { kind: 'none' }, `${section} ${m.masterCode}@${kva}`);
        }
      }
    }
  }
});

test('the CRGO variant forms are unchanged', () => {
  assert.deepEqual(inheritedForCell('CRGO', S26, '12C', 'HV Coil - Labour', '63'), { kind: 'pair', al: 34, cu: 11 });
  assert.deepEqual(inheritedForCell('CRGO', S26, '8', 'HV Bushing', '63'), { kind: 'kv', value: 177, kv: '11' });
  assert.deepEqual(inheritedForCell('CRGO', S26, '21', 'Repl. Of Rediator', '500'), { kind: 'radiator', value: 2652.2 });
  assert.deepEqual(inheritedForCell('CRGO', S26, '21', 'Repl. Of Rediator', '315'), { kind: 'marker', text: 'Varies by capacity' });
});

test('the estimate and the grid ask the same question about which overhauling row is which', () => {
  assert.equal(overhaulingRowKind('7', 'anything'), 'overhaul');
  assert.equal(overhaulingRowKind('9', 'Overhauling of complete transformer'), 'overhaul');
  assert.equal(overhaulingRowKind('9', 'Some other overhauling extra'), 'other');
  assert.equal(overhaulingRowKind('10', 'Tank cleaning'), 'other');
  assert.equal(overhaulingRowKind('5', 'Complete Radiator replacement of same size'), 'radiator');
});
