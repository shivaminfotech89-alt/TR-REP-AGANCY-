// CORRECT AARATI'S MSBT-5, WHICH CARRIES MEGHA'S TENDER — DRY-RUN BY DEFAULT (AUDIT G116).
//
//     node scripts/admin/fix-msbt5-at-stamp.js            reports, writes nothing
//     node scripts/admin/fix-msbt5-at-stamp.js --apply    writes, after printing the same report
//
// ⚠ WHY THIS IS A SCRIPT AND NOT A SCREEN. No screen in the app can re-stamp a job's `atId`: the tender a job
// belongs to is read from the job, and a job whose tender belongs to another agency has no consistent answer for
// its job-number series or its AT percentage. G107 found it, named it in the add-unit refusal, and pointed at
// `scripts/find-misattached-at-console.js` for the diagnosis. This is the correction half.
//
// THE CASE
// --------
// `MSBT-5` is AARATI TRANSFORMER's job. Its `atId` names MEGHA's `AT 26-27`. Until G116 all three allotment
// count sites scoped by `ownerId` + `atId` and nothing else, so MSBT-5 was counted as MEGHA's 21st
// SABARMATI/CRGO job — against MEGHA's quota of 30, on work MEGHA never did.
//
// ⚠ G116 MAKES THE FIGURE RIGHT WITHOUT THIS SCRIPT. The agency filter already stops MSBT-5 being counted
// against MEGHA. What stays wrong is the job's own record: it is priced and numbered under a tender its agency
// does not hold, which affects its AT percentage and its estimate, not just a count.
//
// ⚠⚠ AND THAT IS WHY THIS IS THE OWNER'S DECISION, NOT A MIGRATION. The app cannot tell which of two things is
// true (F22's shape):
//
//   - the JOB is in the wrong agency: it is really MEGHA's work, filed under AARATI, or
//   - the TENDER stamp is wrong: it is AARATI's work and should carry an AARATI tender.
//
// `MSBT` is MEGHA's SABARMATI prefix, which argues for the first. But the job's `agencyId` is AARATI's and
// AARATI also has SABARMATI work, which argues for the second. Only the paperwork settles it. So this script
// REPORTS both readings and applies only the one named on the command line — it never picks.
//
// ⚠ IT ALSO REFUSES TO MOVE A JOB THAT HAS BEEN BILLED. An estimate is rebuilt from the job, its inspections
// and the tender every time it is opened (F72), so re-stamping a job with an issued bill changes what the paper
// recomputes to. O72 is the entry that asks that question; a correction must not answer it by accident.

import { all, banner, db } from './_db.js';

/** ⚠ 'dry-run' IN THE COMMITTED FILE, ALWAYS. `--apply` is the only way to change it. */
const MODE = process.argv.includes('--apply') ? 'apply' : 'dry-run';

/** Which reading to apply. Neither is a default: --apply alone refuses and says so. */
const READING = process.argv.includes('--job-moves-to-megha') ? 'job-moves-to-megha'
  : process.argv.includes('--stamp-moves-to-aarati') ? 'stamp-moves-to-aarati'
  : null;

const JOB_NO = 'MSBT-5';

/**
 * ⚠⚠ PINNED TO ONE DOCUMENT ID, DELIBERATELY (AUDIT G118).
 *
 * This script's reasoning is about ONE job: four witnesses say MEGHA - the MSBT prefix, its position between
 * MSBT-4 and MSBT-6, the SABARMATI division AARATI has no prefix for, and the tender stamp - and only
 * `agencyId` said AARATI. None of that transfers to the next mis-stamped job, which may well be the other
 * reading. Repointing this by editing `JOB_NO` would inherit the conclusion without the evidence.
 *
 * A second case gets its own script, with its own witnesses stated.
 */
const JOB_DOC_ID = 'ogsqw5RJW7RpfLvzetqH';

const N = v => String(v ?? '').trim();

banner(`CORRECT ${JOB_NO}'S TENDER STAMP   [MODE = ${MODE}]`, { writes: MODE === 'apply' });

const [jobs, agencies, ats] = await Promise.all([all('jobs'), all('agencies'), all('atMasters')]);

const agencyName = new Map(agencies.map(a => [a.id, a.name]));
const atById = new Map(ats.map(a => [a.id, a]));

const job = jobs.find(j => N(j.id) === JOB_DOC_ID);
if (!job) {
  console.error(`\nREFUSED - no job with document id ${JOB_DOC_ID}. This script is pinned to one document.`);
  process.exit(2);
}
// The id is the authority; the number is the cross-check. If they disagree, something else has happened to
// this record and the evidence gathered about MSBT-5 may no longer describe it.
if (N(job.jobNo) !== JOB_NO) {
  console.error(`\nREFUSED - document ${JOB_DOC_ID} is numbered ${N(job.jobNo)}, not ${JOB_NO}.`);
  console.error(`The evidence in this script was gathered about ${JOB_NO} and does not transfer.`);
  process.exit(2);
}
const at = atById.get(N(job.atId));

console.log('THE RECORD AS IT STANDS');
console.log(`  job            ${job.jobNo}   (doc ${job.id})`);
console.log(`  job.agencyId   ${job.agencyId}   -> ${agencyName.get(N(job.agencyId)) || '(unknown)'}`);
console.log(`  job.atId       ${job.atId}   -> ${at ? `${at.atNumber || at.name}` : '(not found)'}`);
console.log(`  at.agencyId    ${at?.agencyId}   -> ${agencyName.get(N(at?.agencyId)) || '(unknown)'}`);
console.log(`  division       ${job.division}      coreType ${job.coreType}      kVA ${job.capacityKva}`);
console.log(`  condition      ${JSON.stringify(job.condition)}      status ${JSON.stringify(job.status)}`);

if (N(job.agencyId) === N(at?.agencyId)) {
  console.log('\nNOTHING TO DO - the job and its tender already belong to the same agency.');
  process.exit(0);
}

// ⚠ THE MONEY CHECK COMES BEFORE EITHER READING IS OFFERED.
const money = ['estimateAmount', 'estimateRefNo', 'estimateSentDate', 'billNo', 'billSentDate',
  'billTotalMrAmount', 'paidAmount', 'paymentRefNo', 'approvedAmount']
  .filter(k => job[k] !== undefined && job[k] !== '' && job[k] !== null);

console.log('\nMONEY ALREADY ON THIS JOB');
if (!money.length) {
  console.log('  (none) - no estimate sent, no bill raised, nothing paid. Safe to re-stamp.');
} else {
  for (const k of money) console.log(`  ${k.padEnd(22)} ${job[k]}`);
  console.log('\nREFUSED - this job carries issued paperwork.');
  console.log('An estimate is rebuilt from the job, its inspections and the tender every time it is opened');
  console.log('(F72), so changing the tender changes what the paper recomputes to. That is O72\'s open');
  console.log('question and it is not for this script to answer. Decide it first, then re-run.');
  process.exit(1);
}

// --- the two readings, both priced out ---------------------------------------------------------------------
const aarati = N(job.agencyId);
const megha = N(at.agencyId);
const aaratiAts = ats.filter(a => N(a.agencyId) === aarati);

console.log('\nREADING 1 - THE JOB IS IN THE WRONG AGENCY  (--job-moves-to-megha)');
console.log(`  set job.agencyId  ${aarati} -> ${megha}`);
console.log(`  the MSBT prefix is ${agencyName.get(megha)}'s SABARMATI prefix, which argues for this.`);
console.log(`  it would also move the job's issuedBy* fields, which this script does NOT touch:`);
for (const k of ['issuedByAgencyId', 'issuedByAgencyName', 'issuedByAgencyGstin']) {
  if (job[k] !== undefined) console.log(`    ${k.padEnd(22)} ${job[k]}   <- would still say ${agencyName.get(aarati)}`);
}

console.log('\nREADING 2 - THE TENDER STAMP IS WRONG  (--stamp-moves-to-aarati)');
if (!aaratiAts.length) {
  console.log(`  NOT AVAILABLE - ${agencyName.get(aarati)} holds no tender, so there is nothing to re-stamp to.`);
} else {
  console.log(`  set job.atId  ${job.atId} -> one of ${agencyName.get(aarati)}'s own tenders:`);
  for (const a of aaratiAts) {
    const q = Number(a.allotments?.[N(job.division)]?.[N(job.coreType)] ?? 0) || 0;
    console.log(`    ${a.id}  ${String(a.atNumber || a.name).slice(0, 40).padEnd(42)} status ${String(a.status || '?').padEnd(8)}`
      + ` ${N(job.division)}/${N(job.coreType)} quota ${q}`);
  }
  console.log('  ⚠ THE AT PERCENTAGE AND THE JOB NUMBER SERIES BOTH COME FROM THE TENDER, so this changes what');
  console.log('    the job prices at and which counter it belongs to. Check the percentages above match.');
}

if (MODE === 'dry-run') {
  console.log('\n[dry-run] Nothing was written.');
  console.log('To apply, re-run with --apply AND one of --job-moves-to-megha / --stamp-moves-to-aarati');
  console.log('(and for reading 2, append --at=<atDocId>).');
  process.exit(0);
}

if (!READING) {
  console.error('\nREFUSED - --apply needs a reading. Neither is a default; the paperwork decides which is true.');
  console.error('  --job-moves-to-megha      the job is really MEGHA\'s work, filed under AARATI');
  console.error('  --stamp-moves-to-aarati   the job is AARATI\'s and the tender stamp is wrong (needs --at=<id>)');
  process.exit(2);
}

const patch = {};
if (READING === 'job-moves-to-megha') {
  patch.agencyId = megha;
  /**
   * ⚠ THE issuedBy* FIELDS MOVE WITH IT, OR THE RECORD STILL NAMES THE WRONG AGENCY (AUDIT G118).
   *
   * They are stamped on a job for the DISCOM's paperwork. Moving `agencyId` and leaving them behind produces a
   * job owned by MEGHA that still prints AARATI's name and GSTIN - half-corrected, which is worse than
   * uncorrected because it looks fixed.
   *
   * MSBT-5 carries none of them, so this is dead on the only job this script can touch. It is here because the
   * first version noted the gap in a comment and did nothing about it, and a noted gap that nothing closes is
   * the shape this audit keeps finding.
   */
  const target = agencies.find(a => N(a.id) === megha);
  if (job.issuedByAgencyId !== undefined) patch.issuedByAgencyId = megha;
  if (job.issuedByAgencyName !== undefined) patch.issuedByAgencyName = N(target?.name);
  if (job.issuedByAgencyGstin !== undefined) patch.issuedByAgencyGstin = N(target?.gstin);
} else {
  const arg = process.argv.find(a => a.startsWith('--at='));
  const target = arg && N(arg.slice(5));
  const chosen = aaratiAts.find(a => a.id === target);
  if (!chosen) {
    console.error(`\nREFUSED - --at=<atDocId> must name one of ${agencyName.get(aarati)}'s tenders, listed above.`);
    process.exit(2);
  }
  patch.atId = chosen.id;
}
patch.updatedAt = Date.now();

console.log(`\n[apply] writing to jobs/${job.id}: ${JSON.stringify(patch)}`);
await db.collection('jobs').doc(job.id).update(patch);
console.log('Done. Re-run without --apply to confirm the record now agrees with itself.');
process.exit(0);
