// Tests for lib/mrRename.ts (AUDIT G74). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collisionJobs, oilRowsForMr, unmatchedOilRows, litresOf, describeRename, isCancelledJob,
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

test('an oil receipt whose MR number no job carries is unmatched - the live MR 5585 case', () => {
  const out = unmatchedOilRows(oil, jobs, A);
  assert.deepEqual(out.map(u => [u.tx.id, u.reason]), [['o3', 'no-jobs']]);
  assert.equal(litresOf(out.map(u => u.tx)), 2110);
});

test('an oil row carrying no MR number at all is reported separately', () => {
  const out = unmatchedOilRows([{ id: 'x', mrNo: '  ', agencyId: A, netLiters: 5 }], jobs, A);
  assert.deepEqual(out.map(u => u.reason), ['no-mr-number']);
});

test('⚠ a cancelled MR still counts as matched - its jobs exist and carry the number', () => {
  const cancelledOnly: RenameJobLike[] = [{ id: 'c1', mrNo: '9000', agencyId: A, status: 'Cancelled' }];
  const rows: OilRowLike[] = [{ id: 'o9', mrNo: '9000', agencyId: A, netLiters: 100 }];
  assert.deepEqual(unmatchedOilRows(rows, cancelledOnly, A), []);
});

test('⚠ matching is scoped: another agency holding that MR number is not a match', () => {
  // Agency B's only job is MR 5555, so its MR-1234 receipt (o4) is unattributed FOR B - even though agency A does
  // have an MR 1234. Oil belongs to the agency that received it, and a number shared across agencies is a
  // coincidence, not a link.
  assert.deepEqual(unmatchedOilRows(oil, jobs, B).map(u => u.tx.id), ['o4']);
  // Unscoped, o4 matches agency A's MR 1234 and only the genuinely absent 5585 remains.
  assert.deepEqual(unmatchedOilRows(oil, jobs).map(u => u.tx.id), ['o3']);
});
