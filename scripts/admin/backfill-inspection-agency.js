// PUT agencyId ON THE 59 INSPECTIONS THAT LACK ONE — WRITES WHEN MODE = 'apply'.
//
//     node scripts/admin/backfill-inspection-agency.js
//
// ⚠ THIS SCRIPT WRITES. It ships as 'dry-run'; set MODE to 'apply' to run it for real, and set it
// back to 'dry-run' before committing.
//
// WHY IT IS A PREREQUISITE, NOT A TIDY
// ------------------------------------
// Half B loads the ACTIVE AGENCY's jobs, inspections and oil once in the data layer, and 15
// screens read from it instead of querying for themselves. Jobs are 79/79 scoped by agencyId and
// oil is 1/1 - but 59 of 144 inspections carry NO agencyId, so an agency-scoped load would return
// 85 and the other 59 would simply stop appearing. Work that is still in the database would go
// quiet on the screens, caused by a change made to save reads. That is a worse fault than the
// cost it removes, so this runs FIRST or inspections stay owner-scoped.
//
// WHY IT IS NOT A GUESS
// ---------------------
// Every one of the 59 carries `jobId` (59/59), and each resolves to exactly one job with exactly
// one agencyId: 0 ambiguous, 0 unresolvable - measured by inspection-attribution.js. This script
// re-checks that from scratch and REFUSES THE WHOLE RUN if any orphan fails to resolve, rather
// than writing the ones it can and leaving a partial state nobody can see.
//
// WHAT IT WRITES: `agencyId` on the inspection, and nothing else. No dates, no type, no data.

import { db, all } from './_db.js';

const MODE = 'dry-run'; // 'dry-run' | 'apply'

const has = v => String(v ?? '').trim() !== '';

console.log('\nBACKFILL agencyId ON INSPECTIONS');
console.log(`MODE = ${MODE}${MODE === 'apply' ? '  ⚠ THIS RUN WRITES' : '  (nothing will be written)'}\n`);

const [agencies, jobs, inspections] = await Promise.all([
  all('agencies'), all('jobs'), all('inspections'),
]);

const agName = id => agencies.find(a => a.id === id)?.name || `(unknown ${String(id).slice(0, 6)})`;
const orphans = inspections.filter(i => !has(i.agencyId));

console.log(`${inspections.length} inspection(s); ${orphans.length} without an agencyId\n`);
if (orphans.length === 0) {
  console.log('Nothing to do.\n');
  process.exit(0);
}

// ---------------------------------------------------------------- resolve, or refuse entirely

const planned = [];
const failed = [];

for (const insp of orphans) {
  if (!has(insp.jobId)) { failed.push({ insp, why: 'no jobId' }); continue; }
  const job = jobs.find(j => j.id === insp.jobId);
  if (!job) { failed.push({ insp, why: `jobId ${insp.jobId} matches no job` }); continue; }
  if (!has(job.agencyId)) { failed.push({ insp, why: `job ${job.jobNo || job.id} has no agencyId` }); continue; }
  // ⚠ THE OWNER MUST AGREE. An inspection taking its agency from a job owned by someone else
  // would move a record across accounts - the one mistake this cannot be allowed to make.
  if (has(insp.ownerId) && has(job.ownerId) && insp.ownerId !== job.ownerId) {
    failed.push({ insp, why: `owner mismatch: inspection ${insp.ownerId} vs job ${job.ownerId}` });
    continue;
  }
  planned.push({ id: insp.id, agencyId: job.agencyId, via: job.jobNo || job.id });
}

if (failed.length > 0) {
  console.log(`REFUSING THE WHOLE RUN: ${failed.length} of ${orphans.length} cannot be resolved.`);
  console.log('  Writing only the resolvable ones would leave a partial state that looks complete.\n');
  for (const f of failed.slice(0, 25)) console.log(`    ${f.insp.id}  ${f.why}`);
  process.exit(1);
}

const spread = new Map();
for (const p of planned) spread.set(p.agencyId, (spread.get(p.agencyId) ?? 0) + 1);

console.log(`All ${planned.length} resolve to exactly one agency, every one via jobId:\n`);
for (const [ag, n] of spread) console.log(`  ${agName(ag).padEnd(32)} ${n}`);
console.log('\n  Only `agencyId` is written. Nothing else on the record is touched.\n');

if (MODE !== 'apply') {
  console.log('DRY RUN — nothing was written. Set MODE = \'apply\' to write, then set it back.\n');
  process.exit(0);
}

// ---------------------------------------------------------------- write, in batches

const CHUNK = 200;
let written = 0;
for (let i = 0; i < planned.length; i += CHUNK) {
  const slice = planned.slice(i, i + CHUNK);
  const batch = db.batch();
  for (const p of slice) batch.update(db.collection('inspections').doc(p.id), { agencyId: p.agencyId });
  await batch.commit();
  written += slice.length;
  console.log(`  committed ${written}/${planned.length}`);
}

// ---------------------------------------------------------------- read back from the database

const after = await all('inspections');
const stillMissing = after.filter(i => !has(i.agencyId));
const nowScoped = after.filter(i => has(i.agencyId));

console.log('\nREAD BACK FROM THE DATABASE:');
console.log(`  inspections with agencyId : ${nowScoped.length}/${after.length}`);
console.log(`  still missing             : ${stillMissing.length}`);

const wrong = planned.filter(p => {
  const now = after.find(i => i.id === p.id);
  return !now || String(now.agencyId) !== String(p.agencyId);
});
if (stillMissing.length === 0 && wrong.length === 0) {
  console.log('\n  Every record now carries the agency its job belongs to. Confirmed from the');
  console.log('  database, not from this script\'s intention. Inspections can now be loaded');
  console.log('  agency-scoped without hiding anything.\n');
} else {
  console.log(`\n  ⚠ ${stillMissing.length} still missing and ${wrong.length} did not take the intended value.`);
  console.log('  DO NOT scope inspections by agency until this reads clean.\n');
  process.exit(3);
}
