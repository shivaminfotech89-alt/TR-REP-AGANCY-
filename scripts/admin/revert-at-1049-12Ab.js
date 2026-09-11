// MOVE AT 2020-21/01/1049's TYPED 213 FROM 12A(b) INTO 12A(b1) - where the agency meant it (AUDIT G61, G64).
//
// WHAT AND WHY.
//
// On 2026-09-11 the Estimate Master for Gujarat Energy Transmission's AT 2020-21/01/1049 was saved with 213 in
// `12A(b)` - "HV Wdg. (Not Miss) -AL", the WITHOUT-S.E. row - at 10, 16, 25, 63 and 100 kVA. 213 is the UGVCL-2020
// WITH-S.E. rate, 12A-b1. The master had no S.E. row to put it in, so it went into the only aluminium HV row there
// was, and because 213 differs from 12A-b's 2020 figure (163) the copy test reads it as an override: every aluminium
// HV coil on this AT prices at the S.E. rate, S.E. or not.
//
// Since G64 there is an S.E. row: `12A(b1)`, "HV Wdg. (Not Miss) -AL S.E.". This script puts 163 back into those
// five cells of 12A(b) - the agency's own figure there - and 213 into the same five cells of 12A(b1), inserting that
// row directly under 12A(b) when the stored master does not have it yet. It MOVES what they typed instead of deleting
// it. (It was a plain revert until G64; the file keeps its name so the references to it stay true.)
//
// ⚠ AGAINST A PLAIN REVERT IT CHANGES NO FIGURE, AND THAT IS STATED RATHER THAN HIDDEN. 213 in 12A(b1) equals the
// 2020 figure for that row, so the copy test reads it as a copy and Schedule-A prices S.E. work - 213 under 2020, the
// same number. Proved before building on the three live jobs: after either, S.E. 213, Not S.E. 163, unanswered 163.
// What the move keeps is the agency's entry, visible where they meant it. And if this AT turns out to be on UGVCL-2026
// (O59), the moved 213 prices 215: an override equal to the old tender's figure is the one the copy test cannot see.
//
// ⚠ RUN ORDER: ONLY AFTER G64 IS DEPLOYED, AND THESE JOBS HAVE BEEN ANSWERED.
//
// Before G64 nothing reads 12A(b1), so the moved 213 would sit where nothing looks. And today an unanswered job on
// this AT prices 213; after the move it prices 163. So an apply is REFUSED while any non-scrap job under this AT with
// an HV coil weight on its internal inspection has no HV S.E. answer (`hvSeConductor`, AUDIT G61). The dry run
// reports the same check.
//
// SCOPE: five cells of 12A(b), five of 12A(b1), and at most one inserted row. Every other row is compared before and
// after, and the write happens inside a transaction that re-reads the document and refuses if anything moved.
//
// It does not touch `estimateMasterEditedAt` / `estimateMasterEditedBy`: those record who entered 213. It stamps its
// own fields instead.
//
// MODE is 'dry-run'. Set it to 'apply' to write, and set it back before committing.

import { db, banner } from './_db.js';

const MODE = 'dry-run';           // 'dry-run' | 'apply'

const AT_ID = 'hzOnRqgOz37AF91dJiEn';
const AT_NUMBER_ENDS = '2020-21/01/1049';
const FIELD = 'estimateMasterCRGO';
const FROM = '12a(b)';
const TO = '12a(b1)';
const TO_ROW = { itemCode: '12A(b1)', itemName: 'HV Wdg. (Not Miss) -AL S.E.' };   // exactly as the G64 default row
const TYPED = 213;
const RIGHT = 163;

/** The HV S.E. answer - the rows moved price the HV coil only. Must match the field the app writes (AUDIT G61). */
const SE_FIELD = 'hvSeConductor';

banner(`MOVE AT ...${AT_NUMBER_ENDS}  ${FIELD}  12A(b) ${TYPED} -> 12A(b1), 12A(b) back to ${RIGHT}  [${MODE}]`);

const atRef = db.collection('atMasters').doc(AT_ID);
const atSnap = await atRef.get();
if (!atSnap.exists) { console.error(`  AT ${AT_ID} not found. Nothing to do.`); process.exit(1); }
const at = { id: atSnap.id, ...atSnap.data() };
if (!String(at.atNumber || '').endsWith(AT_NUMBER_ENDS)) {
  console.error(`  AT ${AT_ID} is "${at.atNumber}", not ...${AT_NUMBER_ENDS}. Refusing.`);
  process.exit(1);
}
const agencySnap = await db.collection('agencies').doc(at.agencyId).get();
const agency = agencySnap.data() || {};

const findRow = (rows, code) => (rows || []).findIndex(r => String(r.itemCode ?? '').trim().toLowerCase() === code);
const rows = at[FIELD] || [];
const idxFrom = findRow(rows, FROM);
if (idxFrom === -1) { console.error(`  ${FIELD} has no 12A(b) row. Nothing to do.`); process.exit(1); }
const idxTo = findRow(rows, TO);
const agencyFrom = (agency[FIELD] || [])[findRow(agency[FIELD], FROM)];

console.log(`  AT      ${at.atNumber}  (${agency.name || at.agencyId})  schedule ${at.scheduleId}`);
console.log(`  master  last edited ${at.estimateMasterEditedAt?.toDate?.().toISOString?.() ?? '-'} by ${at.estimateMasterEditedBy || '-'}`);
console.log(`  12A(b1) ${idxTo === -1 ? 'not stored yet - it would be inserted directly under 12A(b)' : `stored at position ${idxTo + 1}`}\n`);

// ---------------------------------------------------------------- the plan
const fromBefore = rows[idxFrom].rates || {};
const toBefore = idxTo === -1 ? {} : (rows[idxTo].rates || {});
const fromAfter = { ...fromBefore };
const toAfter = idxTo === -1 ? Object.fromEntries(Object.keys(fromBefore).map(k => [k, null])) : { ...toBefore };
const planned = [];
let unexpected = 0;
console.log('  kVA   12A(b) before -> after    12A(b1) before -> after    agency 12A(b)');
for (const kva of Object.keys(fromBefore)) {
  const cur = fromBefore[kva];
  const ag = agencyFrom?.rates?.[kva];
  const toCur = toBefore[kva] ?? null;
  let note = '';
  if (cur === TYPED) {
    if (ag !== RIGHT) { note = `SKIPPED - the agency does not hold ${RIGHT} here`; unexpected++; }
    else if (toCur !== null && toCur !== TYPED) { note = `UNEXPECTED - 12A(b1) already holds ${toCur}`; unexpected++; }
    else { fromAfter[kva] = RIGHT; toAfter[kva] = TYPED; planned.push(kva); note = '<- moves'; }
  } else if (cur != null && cur !== RIGHT) {
    note = `UNEXPECTED - neither ${TYPED} nor ${RIGHT}`;
    unexpected++;
  }
  console.log(`  ${kva.padEnd(5)} ${String(cur).padEnd(6)} -> ${String(fromAfter[kva]).padEnd(10)} ${String(toCur).padEnd(6)} -> ${String(toAfter[kva] ?? null).padEnd(12)} ${String(ag).padEnd(6)} ${note}`);
}

const toRow = idxTo === -1
  ? { ...TO_ROW, unit: rows[idxFrom].unit || 'QTY', rates: toAfter }
  : { ...rows[idxTo], rates: toAfter };
const newRows = rows.map((r, i) => (i === idxFrom ? { ...r, rates: fromAfter } : i === idxTo ? toRow : r));
if (idxTo === -1) newRows.splice(idxFrom + 1, 0, toRow);
const untouched = rows.filter((r, i) => i !== idxFrom && i !== idxTo);
const otherRowsChanged = untouched.filter(r => !newRows.includes(r)).length;
console.log(`\n  cells moving: ${planned.length}   rows inserted: ${idxTo === -1 ? 1 : 0}   other rows touched: ${otherRowsChanged} of ${untouched.length}`);

// ---------------------------------------------------------------- the order check
const jobsSnap = await db.collection('jobs').where('atId', '==', AT_ID).get();
const jobs = jobsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
const unanswered = [];
console.log(`\n  jobs under this AT: ${jobs.length}`);
for (const job of jobs) {
  const insp = await db.collection('inspections').where('jobId', '==', job.id).where('type', '==', 'Internal').get();
  const data = insp.docs[0]?.data()?.data || {};
  const scrap = job.status === 'Scrap' || job.condition === 'Scrap';
  const coilWeight = [data.totWt, data.wtOfCoil].some(v => Number(v) > 0);   // HV only - these are the HV rows
  const answer = data[SE_FIELD];
  const needs = !scrap && coilWeight && (answer === undefined || answer === null || answer === '');
  if (needs) unanswered.push(job.jobNo || job.id);
  console.log(`    ${String(job.jobNo || job.id).padEnd(12)} ${scrap ? 'scrap  ' : '       '} HV coil weight ${coilWeight ? 'yes' : 'no '}   HV S.E. answer: ${answer ?? '(not recorded)'}${needs ? '   <- must be answered first' : ''}`);
}

if (unexpected) {
  console.log(`\n  REFUSED - ${unexpected} cell(s) are not in the state this script was written for. Nothing assumed.`);
  process.exit(1);
}
if (!planned.length) { console.log(`\n  Nothing to move - no 12A(b) cell holds ${TYPED}.`); process.exit(0); }
if (unanswered.length) {
  console.log(`\n  ${MODE === 'apply' ? 'REFUSED' : 'An apply would be REFUSED'}: ${unanswered.length} job(s) have no HV S.E. answer yet (${unanswered.join(', ')}).`);
  console.log('  Deploy G64, record the answer on each inspection, then run this. Moving first would re-price');
  console.log(`  unanswered HV coils on this AT from ${TYPED} to ${RIGHT} before anyone has said whether the work is S.E.`);
  if (MODE === 'apply') process.exit(1);
}

if (MODE !== 'apply') {
  console.log(`\n  DRY RUN - nothing was written. ${planned.length} cell(s) would move${idxTo === -1 ? ' and 12A(b1) would be inserted' : ''}.`);
  process.exit(0);
}

// ---------------------------------------------------------------- the write
await db.runTransaction(async tx => {
  const fresh = (await tx.get(atRef)).data() || {};
  const freshRows = fresh[FIELD] || [];
  const moved = JSON.stringify(freshRows.map(r => r.itemCode)) !== JSON.stringify(rows.map(r => r.itemCode))
    || planned.some(kva => freshRows[idxFrom]?.rates?.[kva] !== TYPED)
    || (idxTo !== -1 && planned.some(kva => (freshRows[idxTo]?.rates?.[kva] ?? null) !== (toBefore[kva] ?? null)));
  if (moved) throw new Error('The master changed since this script read it. Nothing was written - run it again.');
  const out = freshRows.map((r, i) => (i === idxFrom
    ? { ...r, rates: { ...r.rates, ...Object.fromEntries(planned.map(k => [k, RIGHT])) } }
    : i === idxTo ? { ...r, rates: { ...r.rates, ...Object.fromEntries(planned.map(k => [k, TYPED])) } } : r));
  if (idxTo === -1) out.splice(idxFrom + 1, 0, toRow);
  tx.update(atRef, {
    [FIELD]: out,
    seMoveAt: Date.now(),
    seMoveBy: 'scripts/admin/revert-at-1049-12Ab.js',
    seMoveNote: `12A(b) ${planned.map(k => `@${k}`).join(' ')} ${TYPED} -> ${RIGHT}, and ${TYPED} into 12A(b1) at the same kVA: the with-S.E. rate had been entered into the without-S.E. row, before the master had an S.E. row (AUDIT G64).`,
  });
});
console.log(`\n  Moved ${planned.length} cell(s)${idxTo === -1 ? ', inserted 12A(b1),' : ''} and stamped seMoveAt.`);
process.exit(0);
