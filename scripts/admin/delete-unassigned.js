// DELETE THE WORK THAT BELONGS TO NO TENDER
//
//   node scripts/admin/delete-unassigned.js            <- DRY RUN, writes nothing
//   node scripts/admin/delete-unassigned.js --apply    <- writes, after MODE is changed
//
// ⚠ MODE MUST BE 'dry-run' IN THE REPOSITORY. Change it to run, change it back before
// committing. Security rules do NOT apply to the Admin SDK - see _db.js.
//
// WHAT THIS IS FOR
// ----------------
// 12 jobs and 4 oil transactions carry no `atId`. They predate tender stamping and are test
// data. Nothing creates unassigned records any more - NewJob, MrLedger's add-unit and Oil
// Inward all stamp the active tender at creation (AUDIT F82) - so this set is closed and
// will not refill.
//
// ⚠ THIS IS THE ONE OPERATION WITH NO UNDO. Everything below exists because of that.
//
// WHAT IT REFUSES
// ---------------
// A job carrying an ISSUED DOCUMENT is never deleted, whatever mode this runs in. An
// estimate, a bill, a challan or a recorded payment is a statement made to the division;
// the job document is where `issuedByAgencyId` lives (O14), so deleting it destroys the only
// record of WHAT was billed, TO whom and BY which agency. AUDIT O33 names this as the gap in
// the app's own delete path, and a script that reproduced the gap would be worse than the
// button, because it runs without a confirmation dialog.
//
// Those are listed separately, with what they carry, for a person to decide one at a time.
//
// WHAT IT CLEANS UP
// -----------------
// `inspections` is the only collection storing a `jobId`, and the app's delete path leaves
// them behind - O33's second gap. This script deletes an eligible job's inspections in the
// same batch, and NAMES them before doing it. Anything it cannot clean is reported as
// STRANDED rather than passed over in silence: a stored record asserting a relationship
// that no longer holds is the shape this audit keeps having to explain away.
//
// Oil transactions key on `mrNo`, not `jobId`, so they are stranded by a different route and
// are counted separately.

import { all, banner, db, fmtDate } from './_db.js';
import { issuedMarks } from '../../src/lib/issuedDocuments.js';
import { inspectionFor, inspectionsForJob } from '../../src/lib/inspectionLink.js';

const MODE = 'dry-run';   // 'dry-run' | 'apply'

const APPLY = MODE === 'apply' && process.argv.includes('--apply');

/** The app's own test: absent and empty alike (AUDIT F87). No query can make it. */
const isUnassigned = (r) => !String(r?.atId ?? '').trim();

/**
 * ⚠ THE ISSUED-DOCUMENT TEST IS SHARED WITH THE APP, NOT COPIED (AUDIT G3).
 *
 * It used to be defined here. `MrLedger.handleSaveFullMr` deletes jobs when rows are removed
 * from the MR edit modal and had NO such test, so this script refused to destroy evidence
 * while the UI destroyed it two clicks away. One definition now lives in
 * src/lib/issuedDocuments.js - plain .js so Node and Vite both import the same file - and a
 * change to what counts as "issued" reaches both at once.
 */
banner('DELETE UNASSIGNED WORK — jobs and oil transactions with no tender');
console.log(`MODE = '${MODE}'${APPLY ? '   ** WRITING **' : '   (dry run - nothing will be written)'}\n`);

const [agencies, jobs, txns, inspections] = await Promise.all(
  ['agencies', 'jobs', 'oilTransactions', 'inspections'].map(all));

const agName = (id) => agencies.find(a => a.id === id)?.name || `(unknown agency ${id})`;

const unJobs = jobs.filter(isUnassigned);
const unTxns = txns.filter(isUnassigned);

// ⚠ IMPORTED, NOT COPIED, and the mrNo/jobNo branch is gone with it (AUDIT G4): no
// inspection carries either field, so that clause never matched anything.
const inspectionsFor = (job) => inspectionsForJob(job, inspections);

const blocked = [];
const deletable = [];
for (const j of unJobs) {
  const marks = issuedMarks(j);
  (marks.length ? blocked : deletable).push({ job: j, marks, insps: inspectionsFor(j) });
}

// ---------------------------------------------------------------- 1. WOULD DELETE
console.log('=========================================================================');
console.log(`1. JOBS THIS WOULD DELETE  (${deletable.length} of ${unJobs.length})`);
console.log('=========================================================================');
if (!deletable.length) console.log('  none');
for (const { job, insps } of deletable) {
  console.log(`\n  ${String(job.jobNo || '(no job number)').padEnd(12)} MR ${String(job.mrNo || '(no MR)').padEnd(8)} ${agName(job.agencyId)}`);
  console.log(`     id ${job.id}`);
  console.log(`     division ${job.division || '-'} · ${job.capacityKva || '?'} kVA · status ${job.status || '-'} · issued documents: NONE`);
  if (insps.length) {
    console.log(`     inspections deleted with it: ${insps.length}`);
    for (const i of insps) {
      console.log(`        ${String(i.type || '(no type)').padEnd(9)} id ${i.id}  jobId ${i.jobId ?? '(absent)'}  ${fmtDate(i.createdAt) || ''}`);
    }
  } else {
    console.log('     inspections deleted with it: none');
  }
}

// ---------------------------------------------------------------- 2. REFUSED
console.log('\n=========================================================================');
console.log(`2. JOBS THIS REFUSES TO DELETE  (${blocked.length}) — YOUR DECISION, ONE AT A TIME`);
console.log('=========================================================================');
if (!blocked.length) console.log('  none');
for (const { job, marks, insps } of blocked) {
  console.log(`\n  ${String(job.jobNo || '(no job number)').padEnd(12)} MR ${String(job.mrNo || '(no MR)').padEnd(8)} ${agName(job.agencyId)}`);
  console.log(`     id ${job.id}`);
  console.log(`     division ${job.division || '-'} · ${job.capacityKva || '?'} kVA · status ${job.status || '-'}`);
  console.log('     BLOCKED BY:');
  for (const m of marks) console.log(`        ${m}`);
  console.log(`     would also strand ${insps.length} inspection(s) if forced`);
  if (job.issuedByAgencyId) {
    console.log(`     ⚠ issuedByAgencyId ${job.issuedByAgencyId} (${agName(job.issuedByAgencyId)}) — the only record of which agency issued it (O14)`);
  }
}

// ---------------------------------------------------------------- 3. OIL
console.log('\n=========================================================================');
console.log(`3. OIL TRANSACTIONS THIS WOULD DELETE  (${unTxns.length})`);
console.log('=========================================================================');
let litres = 0;
for (const t of unTxns) {
  litres += Number(t.netLiters) || 0;
  console.log(`  MR ${String(t.mrNo || '(no MR)').padEnd(8)} ${String(t.division || '(no division)').padEnd(12)} ${String(t.oilType || '?').padEnd(6)} ` +
              `${(Number(t.netLiters) || 0).toFixed(2).padStart(9)} LTR  ${agName(t.agencyId)}`);
  console.log(`     id ${t.id}  ${fmtDate(t.date) || ''}`);
}
console.log(`\n  TOTAL ${litres.toFixed(2)} LTR would leave the agency-wide oil net.`);
console.log('  ⚠ That figure is currently INCLUDED in the "All tenders" register (AUDIT F89).');
console.log('    Deleting these changes every agency-wide net by exactly this much. If any of');
console.log('    it was real oil, the day-one opening position (F90) is where it should be');
console.log('    re-asserted, with a source saying so.');

// ---------------------------------------------------------------- 4. STRANDED
console.log('\n=========================================================================');
console.log('4. WHAT WOULD BE LEFT BEHIND');
console.log('=========================================================================');

const deletedJobIds = new Set(deletable.map(d => d.job.id));
const deletedJobNos = new Set(deletable.map(d => d.job.jobNo).filter(Boolean));
const deletedMrNos = new Set(deletable.map(d => d.job.mrNo).filter(Boolean));
const cleaned = new Set(deletable.flatMap(d => d.insps.map(i => i.id)));

// Inspections that name a deleted job but were not matched by the four link rules above.
const missedInsp = inspections.filter(i =>
  !cleaned.has(i.id) &&
  ((i.jobId && (deletedJobIds.has(i.jobId) || deletedJobNos.has(i.jobId))) ||
   (i.jobNo && deletedJobNos.has(i.jobNo))));

console.log(`  inspections deleted in the same batch : ${cleaned.size}`);
console.log(`  inspections still naming a deleted job: ${missedInsp.length}${missedInsp.length ? '   <- STRANDED' : ''}`);
for (const i of missedInsp) {
  console.log(`     id ${i.id}  type ${i.type || '-'}  jobId ${i.jobId ?? '(absent)'}  jobNo ${i.jobNo ?? '(absent)'}  mrNo ${i.mrNo ?? '(absent)'}`);
}

// Oil transactions keyed to an MR whose jobs are all going. They key on mrNo, never jobId.
const orphanTx = txns.filter(t =>
  !isUnassigned(t) && t.mrNo && deletedMrNos.has(t.mrNo));
console.log(`\n  oil transactions on an MR losing all its jobs: ${orphanTx.length}${orphanTx.length ? '   <- STRANDED (they key on mrNo, not jobId)' : ''}`);
for (const t of orphanTx) {
  console.log(`     id ${t.id}  MR ${t.mrNo}  ${(Number(t.netLiters) || 0).toFixed(2)} LTR  ${agName(t.agencyId)}`);
}

// An MR that loses every job stops existing as a group in MrLedger.
const mrLosingAll = [...deletedMrNos].filter(mr =>
  jobs.filter(j => j.mrNo === mr).every(j => deletedJobIds.has(j.id)));
console.log(`\n  MRs that would disappear entirely: ${mrLosingAll.length}`);
if (mrLosingAll.length) console.log(`     ${mrLosingAll.join(', ')}`);

const mrPartial = [...deletedMrNos].filter(mr => !mrLosingAll.includes(mr));
console.log(`  MRs that would keep some jobs   : ${mrPartial.length}`);
if (mrPartial.length) {
  for (const mr of mrPartial) {
    const keep = jobs.filter(j => j.mrNo === mr && !deletedJobIds.has(j.id));
    console.log(`     MR ${mr}: keeps ${keep.length} job(s) — ${keep.map(j => j.jobNo || j.id).join(', ')}`);
  }
}

// ---------------------------------------------------------------- 4b. CONSEQUENCE
// The agency-wide oil net (AUDIT F89) is computed from exactly the jobs and transactions
// this would remove, so it moves. Printed BEFORE and AFTER rather than left to be
// rediscovered on a screen, because these figures are what an agency reconciles with a
// division - see oil-net-census.js, whose arithmetic this reproduces.
console.log('\n=========================================================================');
console.log('4b. WHAT THE AGENCY-WIDE OIL NET BECOMES  (AUDIT F89)');
console.log('=========================================================================');

const external = inspections.filter(i => i.type === 'External' || !i.type);
const inspFor = (job) => inspectionFor(job, external);

function shortageOf(job) {
  const insp = inspFor(job);
  const stored = insp?.data?.netShortage ?? insp?.netShortage ?? job.externalDetails?.netShortage;
  if (typeof stored === 'number') return stored;
  const rawCap = insp?.data?.oilCapLtrs ?? insp?.oilCapLtrs ?? job.externalDetails?.oilCapLtrs ?? job.oilCapLtrs ?? job.oilCapacity;
  const rawLess = insp?.data?.lessOilLtrs ?? insp?.lessOilLtrs ?? job.externalDetails?.lessOilLtrs ?? job.lessOilLtrs;
  const kva = Number(job.capacityKva) || 25;
  const cap = (rawCap !== undefined && rawCap !== null && String(rawCap).trim() !== '')
    ? Number(rawCap) : (kva <= 16 ? 140 : kva <= 25 ? 184 : kva <= 63 ? 240 : 323);
  const less = (rawLess !== undefined && rawLess !== null && String(rawLess).trim() !== '') ? Number(rawLess) : 0;
  return less + Math.max(0, cap - less) * 0.05;
}

const goneTx = new Set(unTxns.map(t => t.id));
const net = (agId, after) => {
  const js = jobs.filter(j => j.agencyId === agId && j.mrNo && (!after || !deletedJobIds.has(j.id)));
  const ts = txns.filter(t => t.agencyId === agId && t.mrNo && (!after || !goneTx.has(t.id)));
  return js.reduce((s, j) => s + shortageOf(j), 0) - ts.reduce((s, t) => s + (Number(t.netLiters) || 0), 0);
};
const sign = (n) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(Number(n.toFixed(2))).toFixed(2)}`;

for (const ag of agencies) {
  const before = net(ag.id, false), after = net(ag.id, true);
  if (Math.abs(before) < 0.005 && Math.abs(after) < 0.005) continue;
  const moved = Math.abs(after - before) >= 0.005;
  console.log(`  ${ag.name.padEnd(22)} ${sign(before).padStart(10)} LTR  ->  ${sign(after).padStart(10)} LTR` +
              `${moved ? `   (moves by ${sign(after - before)})` : '   (unchanged)'}`);
}
console.log('\n  Positive means the division owes the agency (AUDIT F88).');

// ---------------------------------------------------------------- 5. APPLY
console.log('\n=========================================================================');
console.log('5. SUMMARY');
console.log('=========================================================================');
console.log(`  jobs deleted        : ${deletable.length}`);
console.log(`  jobs refused        : ${blocked.length}`);
console.log(`  inspections deleted : ${cleaned.size}`);
console.log(`  oil transactions    : ${unTxns.length}  (${litres.toFixed(2)} LTR)`);
console.log(`  records stranded    : ${missedInsp.length + orphanTx.length}`);

if (!APPLY) {
  console.log('\nDRY RUN — nothing was written. To apply: set MODE = \'apply\' and pass --apply.');
  process.exit(0);
}

// ⚠ Batched so a partial failure cannot leave a job deleted with its inspections intact.
// 500 is the Firestore limit; the sets here are far smaller, and the chunking is present so
// this stays correct if it is ever pointed at a larger set.
const targets = [
  ...deletable.map(d => ({ col: 'jobs', id: d.job.id })),
  ...deletable.flatMap(d => d.insps.map(i => ({ col: 'inspections', id: i.id }))),
  ...unTxns.map(t => ({ col: 'oilTransactions', id: t.id })),
];
for (let i = 0; i < targets.length; i += 400) {
  const batch = db.batch();
  for (const t of targets.slice(i, i + 400)) batch.delete(db.collection(t.col).doc(t.id));
  await batch.commit();
  console.log(`  committed ${Math.min(i + 400, targets.length)} / ${targets.length}`);
}
console.log(`\nDeleted ${targets.length} document(s). ${blocked.length} job(s) were refused and remain.`);
