// CORRECT THE STORED 11 KV LEVEL-1 CIRCLE LIMITS — DRY-RUN BY DEFAULT (AUDIT G123).
//
//     node scripts/admin/fix-circle-limit-level1.js            reports, writes nothing
//     node scripts/admin/fix-circle-limit-level1.js --apply    writes
//
// ⚠⚠ WHY A SCRIPT IS NEEDED AT ALL: CORRECTING THE SEED MOVES NO LIVE JOB.
//
// `getCircleLimitForJob` prefers a stored copy over `defaultCircleLimitsEstimateData`:
//
//     const limits = (circleLimitsData && circleLimitsData.length > 0) ? circleLimitsData : defaultCircle…
//
// and 18 of 19 ATs plus 21 of 22 agencies hold one. All 39 carry the old Level-1 row. So the code change fixes
// only agencies and tenders created from now on; every existing one keeps checking against figures the
// authority's table contradicts in all eight cells.
//
// THE SOURCE
// ----------
// The Circle Authority Approval Power Limit table, typed by the owner on 2026-10-10. USER-SUPPLIED - not
// inferred, not derived from anything in this repo. `1819AT.md` cites `ugvcl-2026-estimate-approval.txt` as the
// authoritative extract and that file is still not in the repository, so this table is the only source there is.
//
// ⚠ IT TOUCHES ROW '03' AND NOTHING ELSE. Rows 01, 02, 04 and 05 were verified cell by cell against the same
// paper and match exactly in every one of the 39 stored copies - including the two cells previously recorded as
// suspected transcription errors (4-Star 7,707 at 10 kVA, 3-Star 8,696 at 16 kVA), which the paper confirms.
// Rewriting a row that already agrees would put this script's authorship on figures it did not establish.
//
// ⚠ 50 AND 315 kVA ARE LEFT AT ZERO. The authority's table has no row for either capacity. Zero means
// "no limit recorded", which `hasLimit: limit > 0` turns into UNCHECKED - see the report below, and note that
// no live job sits at either capacity today.
//
// ⚠⚠ THIS MOVES AN ASSERTION THAT HAS ALREADY REACHED PAPER. The circle limit is recomputed live at six sites,
// one of them the Condition column of the PRINTED ESTIMATE, and nothing stamps the authority onto a job. Only a
// `repairWithinLimitConsent` record carries a snapshot (`limitAtConsent`). So for any job without consent, this
// changes what an already-issued estimate would say if reprinted. Every affected job is listed with its bill and
// payment status before anything is written, and the script REFUSES if any of them carries a bill.

import { all, banner, db } from './_db.js';

/** ⚠ 'dry-run' IN THE COMMITTED FILE, ALWAYS. */
const MODE = process.argv.includes('--apply') ? 'apply' : 'dry-run';

const N = v => String(v ?? '').trim();

/** The authority's 11 KV Level-1 column. 50 and 315 absent from the paper; left at 0. */
const LEVEL1 = {
  '5': 13287, '10': 14367, '16': 15546, '25': 18585,
  '50': 0, '63': 34156, '100': 44750, '200': 85124,
  '315': 0, '500': 294789,
};

/** The other four rows, for verification only - never written. */
const OTHERS = {
  '01': { 5: 5422, 10: 8716, 16: 8696, 25: 10124, 63: 20423, 100: 24609, 200: 47170, 500: 148260 },
  '02': { 5: 6206, 10: 7707, 16: 11729, 25: 15651, 63: 23684, 100: 31094, 200: 65139, 500: 193768 },
  '04': { 16: 10851, 25: 13998, 63: 22137, 100: 27700, 200: 55986, 500: 198914 },
  '05': { 16: 16455, 25: 18889, 63: 33661, 100: 48700, 200: 87710, 500: 161287 },
};

banner(`CORRECT THE STORED 11 KV LEVEL-1 CIRCLE LIMITS   [MODE = ${MODE}]`, { writes: MODE === 'apply' });

const [ags, ats, jobs] = await Promise.all([all('agencies'), all('atMasters'), all('jobs')]);
const agName = new Map(ags.map(a => [a.id, a.name]));

/** Every holder of a stored copy, as {collection, id, label, rows}. */
const holders = [];
for (const a of ats) {
  if ((a.estimateMasterCircleLimits || []).length) {
    holders.push({ coll: 'atMasters', id: a.id, rows: a.estimateMasterCircleLimits,
      label: `AT   ${N(agName.get(N(a.agencyId))).slice(0, 18).padEnd(20)} ${N(a.atNumber || a.name).slice(0, 34)}` });
  }
}
for (const a of ags) {
  if ((a.estimateMasterCircleLimits || []).length) {
    holders.push({ coll: 'agencies', id: a.id, rows: a.estimateMasterCircleLimits,
      label: `AG   ${N(a.name).slice(0, 18).padEnd(20)}` });
  }
}

console.log(`stored copies found: ${holders.length}   (${ats.filter(a => (a.estimateMasterCircleLimits || []).length).length} of ${ats.length} ATs, ${ags.filter(a => (a.estimateMasterCircleLimits || []).length).length} of ${ags.length} agencies)\n`);

// --- verify the rows this script does NOT touch -------------------------------------------------------------
console.log('VERIFYING ROWS 01, 02, 04, 05 AGAINST THE SAME PAPER (not written, only checked)');
let otherDiffs = 0;
for (const h of holders) {
  for (const [code, want] of Object.entries(OTHERS)) {
    const row = h.rows.find(r => N(r.itemCode) === code);
    if (!row) { console.log(`  ${h.label}  row ${code} ABSENT`); otherDiffs += 1; continue; }
    for (const [cap, w] of Object.entries(want)) {
      const got = Number(row.rates?.[cap] ?? 0);
      if (got !== w) { console.log(`  ${h.label}  row ${code} @${cap} kVA: stored ${got}, paper ${w}`); otherDiffs += 1; }
    }
  }
}
/**
 * ⚠ A DISAGREEMENT IN THE OTHER FOUR ROWS NOW REFUSES, RATHER THAN BEING REPORTED AND IGNORED.
 *
 * Added before the live run. If 01, 02, 04 or 05 does not match the paper in some holder, then that holder's
 * table is not the table this script was reasoned about - and writing row 03 into it would be writing into an
 * unknown. The count is 0 across all 39 copies today, so this costs nothing and removes a way for a future run
 * to do damage quietly.
 */
if (otherDiffs > 0) {
  console.log(`  ⚠ ${otherDiffs} disagreement(s) above in rows this script does NOT write.`);
  console.log('\nREFUSED - a holder whose other rows do not match the paper is not the table this script was');
  console.log('reasoned about. Resolve those before writing row 03 into it.');
  process.exit(1);
}
console.log('  all four rows match the paper in every stored copy - nothing to correct there\n');

// --- what row 03 would become ------------------------------------------------------------------------------
console.log('ROW 03, 11 KV LEVEL-1 - WHAT CHANGES');
const CAPS = Object.keys(LEVEL1);
let needing = 0;
for (const h of holders) {
  const row = h.rows.find(r => N(r.itemCode) === '03');
  if (!row) { console.log(`  ${h.label}  row 03 ABSENT - would be added`); needing += 1; continue; }
  const diffs = CAPS.filter(c => Number(row.rates?.[c] ?? 0) !== LEVEL1[c]);
  if (!diffs.length) continue;
  needing += 1;
  console.log(`  ${h.label}  ${diffs.length} cell(s): `
    + diffs.map(c => `${c}kVA ${Number(row.rates?.[c] ?? 0)}->${LEVEL1[c]}`).join('  '));
}
console.log(`\n  copies needing the correction: ${needing} of ${holders.length}`);

// --- which jobs are affected, and do any carry a bill? -----------------------------------------------------
const isLevel1 = j => /level[-\s]?1/i.test(N(j.starRating) || N(j.ratingLevel));
const affected = jobs.filter(isLevel1);
console.log(`\nLEVEL-1 JOBS AFFECTED: ${affected.length}`);
console.log('  job        kVA  old limit  new limit  bill        paid        estimate sent');
const billed = [];
for (const j of affected.sort((a, b) => Number(a.capacityKva) - Number(b.capacityKva))) {
  const cap = String(Number(j.capacityKva));
  // the old figure as the seed and every stored copy held it
  const OLD = { '5': 0, '10': 8010, '16': 8475, '25': 9859, '50': 0, '63': 0, '100': 0, '200': 0, '315': 0, '500': 0 };
  const hasBill = Boolean(N(j.billNo)) || Boolean(N(j.billStatus)) || Number(j.paidAmount) > 0;
  if (hasBill) billed.push(N(j.jobNo));
  console.log(`  ${N(j.jobNo).padEnd(10)} ${cap.padStart(4)}  ${String(OLD[cap] ?? 0).padStart(9)}  ${String(LEVEL1[cap] ?? 0).padStart(9)}`
    + `  ${(N(j.billNo) || '-').padEnd(11)} ${String(j.paidAmount ?? '-').padEnd(11)} ${N(j.estimateSentDate) || '-'}`);
}

if (billed.length) {
  console.log(`\nREFUSED - ${billed.length} affected job(s) carry a bill: ${billed.join(', ')}`);
  console.log('A circle limit is the sanctioning authority\'s power, recomputed live and printed on the estimate.');
  console.log('Moving it under an issued bill changes what the paper would say on a reprint. Decide those first.');
  process.exit(1);
}
console.log('\n  none of the affected jobs carries a bill or a payment - no issued money moves.');

if (MODE === 'dry-run') {
  console.log('\n[dry-run] Nothing was written. Re-run with --apply to write row 03 to all listed copies.');
  process.exit(0);
}

let written = 0;
for (const h of holders) {
  const rows = h.rows.map(r => (N(r.itemCode) === '03'
    ? { ...r, rates: { ...r.rates, ...LEVEL1 } }
    : r));
  const had = h.rows.some(r => N(r.itemCode) === '03');
  if (!had) {
    rows.push({ itemCode: '03', itemName: '11 KV - Level-1', unit: 'Rs.', fixedRate: null, rates: { ...LEVEL1 } });
  }
  await db.collection(h.coll).doc(h.id).update({ estimateMasterCircleLimits: rows });
  written += 1;
  console.log(`  [apply] ${h.coll}/${h.id}  ${h.label}`);
}
console.log(`\nDone. ${written} stored copy/copies updated. Re-run without --apply to confirm.`);
process.exit(0);
