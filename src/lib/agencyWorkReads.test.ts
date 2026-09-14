// WHO MAY QUERY THE AGENCY'S WORK, AND WHO MUST NOT (AUDIT O71 fix 3, G84). Run with `npm test`.
//
// These are source-level, because the rule they protect is about WHERE a read happens rather than
// what it returns. Two opposite mistakes are both cheap to make and invisible once made:
//
//   1. A screen queries `jobs` for itself again, re-creating the per-screen fetch pattern O71
//      measured as one twelve customers can exhaust in a day.
//   2. A guard that must be ACCOUNT-WIDE and FRESH is "tidied" into reading the shared list,
//      which is agency-scoped and a snapshot - so it stops catching the clash it exists to catch.
//
// The second is the dangerous one: it fails silently, in the direction of allowing a duplicate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

test('the Dashboard does not query Firestore itself - it reads the shared load', () => {
  const dashboard = src('src/components/Dashboard.tsx');
  assert.equal(
    /from ['"]firebase\/firestore['"]/.test(dashboard), false,
    'Dashboard imports firestore again - it should read agencyJobs/agencyOil/agencyInspections',
  );
  assert.ok(dashboard.includes('agencyJobs'), 'Dashboard no longer reads the shared job list');
  assert.ok(
    dashboard.includes('agencyDataLoad'),
    'Dashboard no longer reads the load status, so a failed read renders as an empty workshop',
  );
});

test('⚠ the account-wide duplicate checks still ask the DATABASE, not the cached list', () => {
  const newJob = src('src/components/NewJob.tsx');
  // The duplicate MR and duplicate job-number guards are deliberately owner-scoped, NOT
  // agency-scoped: a job number already used in another agency of the same account is still a
  // clash. The shared list cannot see that, so these must remain direct queries.
  assert.ok(
    newJob.includes("where('mrNo'"),
    'the duplicate MR check no longer queries by mrNo - a cached agency list cannot answer it',
  );
  assert.ok(
    newJob.includes("where('jobNo'"),
    'the duplicate job-number check no longer queries by jobNo - a cached agency list cannot answer it',
  );
  assert.ok(
    /from ['"]firebase\/firestore['"]/.test(newJob),
    'NewJob no longer talks to Firestore at all, so its save-time guards cannot be fresh',
  );
});

test('⚠ the MR rename collision check still asks the database', () => {
  const ledger = src('src/components/MrLedger.tsx');
  assert.ok(
    ledger.includes("where('mrNo'"),
    'the rename collision check no longer queries by mrNo - renaming could silently merge two MRs',
  );
});

test('⚠ the allotment floor is still read fresh at the moment it refuses', () => {
  const allotments = src('src/components/AtAllotments.tsx');
  assert.ok(
    /from ['"]firebase\/firestore['"]/.test(allotments),
    'AtAllotments no longer queries - a quota floor from a cached list refuses against a stale count',
  );
  const newJob = src('src/components/NewJob.tsx');
  assert.ok(
    newJob.includes("where('atId'"),
    'the intake allotment check no longer queries by atId',
  );
});

test('the shared loader carries the G70 status rather than an empty list', () => {
  const context = src('src/lib/AgencyContext.tsx');
  assert.ok(context.includes('agencyDataLoad'), 'the shared load has no status');
  assert.ok(
    context.includes('refreshAgencyData'),
    'nothing can re-read after a write, so writing screens would have to query for themselves',
  );
  assert.ok(
    context.includes('describeLoadFailure'),
    'the shared load does not describe its failure, so screens cannot tell a failure from emptiness',
  );
});
