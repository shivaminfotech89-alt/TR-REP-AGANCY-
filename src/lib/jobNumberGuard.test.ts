// Tests for lib/jobNumberGuard.ts (AUDIT G92). Run with `npm test`.
//
// This predicate is called from TWO intake paths - New Job and MrLedger's Full Edit add-row. It was
// extracted because only one of them had it, and the failure that produced was silent: a duplicate
// job number written with no error. These tests exist so the two doors cannot drift apart again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSameTransformer,
  holdsItsNumber,
  jobNumberClashes,
  duplicateWithinBatch,
} from './jobNumberGuard';

const unit = (over: Record<string, unknown> = {}) => ({
  jobNo: 'MSBT-12', serialNo: '12', make: '121', capacityKva: 100, mrNo: '9344', ...over,
});

// ---------------------------------------------------------------- the transformer test

test('the same transformer matches on serial, make and capacity - case and spacing ignored', () => {
  assert.equal(isSameTransformer(unit(), unit({ serialNo: ' 12 ', make: '121' })), true);
  assert.equal(isSameTransformer(unit(), unit({ make: '121 ' })), true);
});

test('⚠ ANY of the three differing makes it a different transformer', () => {
  assert.equal(isSameTransformer(unit(), unit({ serialNo: '13' })), false);
  assert.equal(isSameTransformer(unit(), unit({ make: '122' })), false);
  assert.equal(isSameTransformer(unit(), unit({ capacityKva: 63 })), false);
});

test('the repair type is NOT part of the test', () => {
  // A GP job and an OGP job can be the same unit; what makes a repeat legitimate is the metal.
  assert.equal(isSameTransformer(unit({ repairType: 'GP' }), unit({ repairType: 'OGP' })), true);
});

// ---------------------------------------------------------------- cancelled frees the number

test('a cancelled job does not hold its number', () => {
  assert.equal(holdsItsNumber(unit()), true);
  assert.equal(holdsItsNumber(unit({ status: 'Cancelled' })), false);
  assert.equal(holdsItsNumber(unit({ isCancelled: true })), false);
  assert.equal(holdsItsNumber(unit({ mrStatus: 'Cancelled' })), false);
});

test('a number held only by a cancelled job is free', () => {
  const clashes = jobNumberClashes([unit()], [unit({ status: 'Cancelled', serialNo: 'OTHER' })]);
  assert.equal(clashes.length, 0);
});

// ---------------------------------------------------------------- the clash itself

test('a free number clashes with nothing', () => {
  assert.equal(jobNumberClashes([unit({ jobNo: 'MSBT-99' })], [unit()]).length, 0);
});

test('⚠ a DIFFERENT transformer on the same number clashes, GP or not', () => {
  const held = [unit({ serialNo: '312132135', make: 'DVDVDFV', capacityKva: 25, mrNo: '85558' })];
  assert.equal(jobNumberClashes([unit()], held).length, 1, 'OGP row must clash');
  assert.equal(
    jobNumberClashes([unit({ repairType: 'GP' })], held).length, 1,
    'GP does not license taking another unit\'s number',
  );
});

test('⚠ THE ONE LEGITIMATE REPEAT: the same unit returning under guarantee', () => {
  // MSBT-10 in live data: same serial, make and capacity on MRs 6652 and 85558.
  const held = [unit({ jobNo: 'MSBT-10', mrNo: '85558' })];
  const returning = unit({ jobNo: 'MSBT-10', mrNo: '6652', repairType: 'GP' });
  assert.equal(jobNumberClashes([returning], held).length, 0);
});

test('⚠ the same unit WITHOUT GP still clashes', () => {
  // Reusing a number for the same transformer on a fresh OGP intake is not the exception.
  const held = [unit({ mrNo: '85558' })];
  assert.equal(jobNumberClashes([unit({ repairType: 'OGP' })], held).length, 1);
});

test('a blank job number is not checked - the empty-field validation catches it first', () => {
  assert.equal(jobNumberClashes([unit({ jobNo: '   ' })], [unit()]).length, 0);
});

test('every clashing row is reported, not just the first', () => {
  const held = [unit({ serialNo: 'X' }), unit({ jobNo: 'MSBT-13', serialNo: 'Y' })];
  const rows = [unit(), unit({ jobNo: 'MSBT-13' })];
  assert.equal(jobNumberClashes(rows, held).length, 2);
});

// ---------------------------------------------------------------- twice in one save

test('the same number on two rows of one save is caught, with both positions', () => {
  const twice = duplicateWithinBatch([unit(), unit({ serialNo: '99' })]);
  assert.deepEqual(twice && { first: twice.first, second: twice.second }, { first: 0, second: 1 });
});

test('distinct numbers in one save are fine, and blanks do not collide with each other', () => {
  assert.equal(duplicateWithinBatch([unit(), unit({ jobNo: 'MSBT-13' })]), null);
  assert.equal(duplicateWithinBatch([unit({ jobNo: '' }), unit({ jobNo: '  ' })]), null);
});
