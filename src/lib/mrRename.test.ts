// Tests for lib/mrRename.ts (AUDIT G74). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collisionJobs, collisionOilRows, oilRowsForMr, oilRowsMissingMrNumber, litresOf, describeRename, isCancelledJob,
  type RenameJobLike, type OilRowLike,
} from './mrRename';

const A = 'agency-1';
const B = 'agency-2';

const jobs: RenameJobLike[] = [
  { id: 'j1', mrNo: '1234', agencyId: A, jobNo: 'SU-1' },
  { id: 'j2', mrNo: '1234', agencyId: A, jobNo: 'SU-2' },
  { id: 'j3', mrNo: '5555', agencyId: A, jobNo: 'SU-9' },
  { id: 'j4', mrNo: '5555', agencyId: A, jobNo: 'SU-10', status: 'Cancelled' },
  { id: 'j5', mrNo: '5555', agencyId: B, jobNo: 'OT-1' },
];

const oil: OilRowLike[] = [
  { id: 'o1', mrNo: '1234', agencyId: A, netLiters: 900, division: 'SABARMATI' },
  { id: 'o2', mrNo: '1234', agencyId: A, netLiters: 210, division: 'SABARMATI' },
  { id: 'o3', mrNo: '5585', agencyId: A, netLiters: 2110, division: 'DEESA' },
  { id: 'o4', mrNo: '1234', agencyId: B, netLiters: 50, division: 'KALOL' },
];

// ---------------------------------------------------------------- the merge refusal

test('renaming onto a number another MR already uses is a collision', () => {
  const hit = collisionJobs({ newMrNo: '5555', agencyId: A, jobs, movingJobIds: ['j1', 'j2'] });
  assert.deepEqual(hit.map(j => j.id), ['j3'], 'j4 is cancelled, j5 belongs to another agency');
});

test('the group being renamed is never a collision with itself', () => {
  assert.deepEqual(collisionJobs({ newMrNo: '1234', agencyId: A, jobs, movingJobIds: ['j1', 'j2'] }), []);
});

test('a free number collides with nothing', () => {
  assert.deepEqual(collisionJobs({ newMrNo: '7777', agencyId: A, jobs, movingJobIds: ['j1', 'j2'] }), []);
});

test('another agency may hold the same MR number', () => {
  const hit = collisionJobs({ newMrNo: '5555', agencyId: B, jobs, movingJobIds: [] });
  assert.deepEqual(hit.map(j => j.id), ['j5']);
});

test('a cancelled job releases its number', () => {
  assert.equal(isCancelledJob({ status: 'Cancelled' }), true);
  assert.equal(isCancelledJob({ isCancelled: true }), true);
  assert.equal(isCancelledJob({ mrStatus: 'Cancelled' }), true);
  assert.equal(isCancelledJob({ status: 'Received' }), false);
});

test('whitespace around a number does not hide a collision', () => {
  const hit = collisionJobs({ newMrNo: ' 5555 ', agencyId: A, jobs, movingJobIds: ['j1'] });
  assert.deepEqual(hit.map(j => j.id), ['j3']);
});

// ---------------------------------------------------------------- ⚠ the oil that must move

test('the oil rows for an MR are found, scoped to the agency', () => {
  const rows = oilRowsForMr('1234', A, oil);
  assert.deepEqual(rows.map(t => t.id), ['o1', 'o2'], "another agency's row with the same number does not move");
  assert.equal(litresOf(rows), 1110);
});

// ---------------------------------------------------------------- ⚠ two oil-only MRs must not merge

test('⚠ RENAMING ONTO A NUMBER ANOTHER MR\'S OIL HOLDS IS A COLLISION (AUDIT O78)', () => {
  // An oil-only MR can be renamed once the register lists it. `collisionJobs` sees no jobs on either
  // side and would wave this through, folding two oil groups into one.
  const hit = collisionOilRows({ newMrNo: '5585', agencyId: A, transactions: oil, movingOilIds: ['o1', 'o2'] });
  assert.deepEqual(hit.map(t => t.id), ['o3']);
});

test('the oil moving with the rename is never a collision with itself', () => {
  assert.deepEqual(
    collisionOilRows({ newMrNo: '1234', agencyId: A, transactions: oil, movingOilIds: ['o1', 'o2'] }),
    [],
  );
});

test('a free number collides with no oil, and another agency may hold it', () => {
  assert.deepEqual(collisionOilRows({ newMrNo: '7777', agencyId: A, transactions: oil, movingOilIds: [] }), []);
  // o4 is agency B's row on MR 1234 - not a collision for A, and A's rows are not one for B.
  const forB = collisionOilRows({ newMrNo: '1234', agencyId: B, transactions: oil, movingOilIds: [] });
  assert.deepEqual(forB.map(t => t.id), ['o4']);
});

test('the new number is compared trimmed, as collisionJobs compares it', () => {
  const hit = collisionOilRows({ newMrNo: ' 5585 ', agencyId: A, transactions: oil, movingOilIds: [] });
  assert.deepEqual(hit.map(t => t.id), ['o3']);
});

test('an MR with no oil moves none', () => {
  assert.deepEqual(oilRowsForMr('5555', A, oil), []);
});

test('the confirmation states the transformers and the litres that move with them', () => {
  const text = describeRename({ fromMrNo: '1234', toMrNo: '7777', jobCount: 2, oilRows: oilRowsForMr('1234', A, oil) });
  assert.match(text, /Rename MR 1234 to 7777/);
  assert.match(text, /2 transformers will carry the new number/);
  assert.match(text, /2 oil records \(1,110 litres\) will be renumbered/);
});

test('and says plainly when there is no oil to move', () => {
  const text = describeRename({ fromMrNo: '5555', toMrNo: '7777', jobCount: 1, oilRows: [] });
  assert.match(text, /No oil record carries this MR number\./);
  assert.match(text, /1 transformer will carry/);
});

// ---------------------------------------------------------------- ⚠ oil matching no MR at all

test('⚠ AN MR WITH OIL AND NO TRANSFORMERS IS NORMAL BUSINESS, AND IS NOT REPORTED (AUDIT O78)', () => {
  // The division raises an MR for oil issue alone. `o3` is MR 5585 carrying 2,110 litres that no job names -
  // the live row the deleted 'no-jobs' rule cited as proof of a fault. It is correctly recorded.
  assert.deepEqual(oilRowsMissingMrNumber(oil, A), []);
  assert.deepEqual(oilRowsMissingMrNumber(oil), []);
});

test('an oil row carrying no MR number at all IS reported - the balance drops it', () => {
  const out = oilRowsMissingMrNumber([{ id: 'x', mrNo: '  ', agencyId: A, netLiters: 5 }], A);
  assert.deepEqual(out.map(t => t.id), ['x']);
});

test('⚠ WHITESPACE IS THE REACHABLE CASE - an empty mrNo is refused by the form and the rules', () => {
  const rows: OilRowLike[] = [
    { id: 'blank', mrNo: '', agencyId: A, netLiters: 1 },
    { id: 'spaces', mrNo: '   ', agencyId: A, netLiters: 2 },
    { id: 'tab', mrNo: '\t', agencyId: A, netLiters: 3 },
    { id: 'real', mrNo: '1234', agencyId: A, netLiters: 4 },
  ];
  assert.deepEqual(oilRowsMissingMrNumber(rows, A).map(t => t.id), ['blank', 'spaces', 'tab']);
});

test('it is scoped to the agency, and unscoped when no agency is given', () => {
  const rows: OilRowLike[] = [
    { id: 'a1', mrNo: ' ', agencyId: A, netLiters: 1 },
    { id: 'b1', mrNo: ' ', agencyId: B, netLiters: 2 },
  ];
  assert.deepEqual(oilRowsMissingMrNumber(rows, A).map(t => t.id), ['a1']);
  assert.deepEqual(oilRowsMissingMrNumber(rows, B).map(t => t.id), ['b1']);
  assert.deepEqual(oilRowsMissingMrNumber(rows).map(t => t.id), ['a1', 'b1']);
});

test('litresOf still totals what is reported', () => {
  const rows: OilRowLike[] = [{ id: 'x', mrNo: ' ', agencyId: A, netLiters: 5 }];
  assert.equal(litresOf(oilRowsMissingMrNumber(rows, A)), 5);
});
