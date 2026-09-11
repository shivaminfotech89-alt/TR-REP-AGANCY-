// REVERT AT 2020-21/01/1049's 12A(b) FROM 213 TO 163 - the without-S.E. aluminium HV coil row.
//
// WHAT AND WHY.
//
// On 2026-09-11 the Estimate Master for Gujarat Energy Transmission's AT 2020-21/01/1049 was saved
// with 213 in `12A(b)` - the row coded "HV Wdg. (Not Miss) -AL", which the app maps to Schedule-A
// 12A-b, WITHOUT S.E. 213 is the UGVCL-2020 WITH-S.E. rate (12A-b1). The master had no S.E. row to
// put it in, so it went into the only aluminium HV row there was.
//
// Because 213 differs from the 2020 baseline for 12A-b (163), `resolveRate`'s copy test reads it as a
// genuine override. So EVERY aluminium HV coil on this AT prices at the S.E. rate, S.E. or not.
//
// Once the S.E. inspection field exists, S.E. jobs price 12A-b1 from Schedule-A without any master
// row (AUDIT O20), and this cell has to go back to the without-S.E. figure - or non-S.E. jobs on this
// AT are overcharged Rs 50/kg. The target is the agency's own 12A(b), which holds 163 in exactly these
// five cells: the AT's CRGO section is otherwise identical to the agency's.
//
// ⚠ RUN ORDER: ONLY AFTER THE S.E. FIELD HAS SHIPPED AND THESE JOBS HAVE BEEN ANSWERED.
//
// Someone entered 213 for a reason. If this AT's work is S.E., reverting first under-charges it
// until the field exists. So an apply is REFUSED while any non-scrap job under this AT with an HV
// coil weight on its internal inspection has no HV S.E. answer (`hvSeConductor`, AUDIT G61). The
// dry run reports the same check. HV only: 12A(b) is the HV row, and S.E. is recorded per winding.
//
// SCOPE: five cells of one row. Every other row and cell is compared before and after, and the write
// happens inside a transaction that re-reads the document and refuses if anything moved.
//
// It does not touch `estimateMasterEditedAt` / `estimateMasterEditedBy`: those record who entered
// 213, and overwriting them with this script would erase that. It stamps its own fields instead.
//
// MODE is 'dry-run'. Set it to 'apply' to write, and set it back before committing.

import { db, banner } from './_db.js';

const MODE = 'dry-run';           // 'dry-run' | 'apply'

const AT_ID = 'hzOnRqgOz37AF91dJiEn';
const AT_NUMBER_ENDS = '2020-21/01/1049';
const FIELD = 'estimateMasterCRGO';
const CODE = '12a(b)';
const WRONG = 213;
const RIGHT = 163;

/** The HV S.E. answer - the reverted row prices the HV coil only. Must match the field the app writes (AUDIT G61). */
const SE_FIELD = 'hvSeConductor';

banner(`REVERT AT ...${AT_NUMBER_ENDS}  ${FIELD} 12A(b)  ${WRONG} -> ${RIGHT}  [${MODE}]`);

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

const findRow = rows => (rows || []).findIndex(r => String(r.itemCode ?? '').trim().toLowerCase() === CODE);
const rows = at[FIELD] || [];
const idx = findRow(rows);
if (idx === -1) { console.error(`  ${FIELD} has no 12A(b) row. Nothing to do.`); process.exit(1); }
const agencyRow = (agency[FIELD] || [])[findRow(agency[FIELD])];

console.log(`  AT      ${at.atNumber}  (${agency.name || at.agencyId})  schedule ${at.scheduleId}`);
console.log(`  master  last edited ${at.estimateMasterEditedAt?.toDate?.().toISOString?.() ?? '-'} by ${at.estimateMasterEditedBy || '-'}\n`);

// ---------------------------------------------------------------- the plan
const before = rows[idx].rates || {};
const after = { ...before };
const planned = [];
let unexpected = 0;
console.log('  kVA   before   after   agency');
for (const kva of Object.keys(before)) {
  const cur = before[kva];
  const ag = agencyRow?.rates?.[kva];
  if (cur === WRONG) {
    if (ag !== RIGHT) { console.log(`  ${kva.padEnd(5)} ${String(cur).padEnd(8)} -       ${ag}   SKIPPED - the agency does not hold ${RIGHT} here`); unexpected++; continue; }
    after[kva] = RIGHT;
    planned.push(kva);
  } else if (cur != null && cur !== RIGHT) {
    console.log(`  ${kva.padEnd(5)} ${String(cur).padEnd(8)} -       ${ag}   UNEXPECTED - neither ${WRONG} nor ${RIGHT}`);
    unexpected++;
    continue;
  }
  console.log(`  ${kva.padEnd(5)} ${String(cur).padEnd(8)} ${String(after[kva]).padEnd(7)} ${ag}${planned.includes(kva) ? '   <- changes' : ''}`);
}

const newRows = rows.map((r, i) => (i === idx ? { ...r, rates: after } : r));
const otherRowsChanged = newRows.filter((r, i) => i !== idx && r !== rows[i]).length;
const matchesAgency = agencyRow && Object.keys({ ...after, ...agencyRow.rates }).every(k => (after[k] ?? null) === (agencyRow.rates[k] ?? null));
console.log(`\n  cells changing: ${planned.length}   other rows touched: ${otherRowsChanged} of ${rows.length - 1}   row after matches the agency's 12A(b): ${matchesAgency ? 'yes' : 'NO'}`);

// ---------------------------------------------------------------- the order check
const jobsSnap = await db.collection('jobs').where('atId', '==', AT_ID).get();
const jobs = jobsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
const unanswered = [];
console.log(`\n  jobs under this AT: ${jobs.length}`);
for (const job of jobs) {
  const insp = await db.collection('inspections').where('jobId', '==', job.id).where('type', '==', 'Internal').get();
  const data = insp.docs[0]?.data()?.data || {};
  const scrap = job.status === 'Scrap' || job.condition === 'Scrap';
  const coilWeight = [data.totWt, data.wtOfCoil].some(v => Number(v) > 0);   // HV only - 12A(b) is the HV row
  const answer = data[SE_FIELD];
  const needs = !scrap && coilWeight && (answer === undefined || answer === null || answer === '');
  if (needs) unanswered.push(job.jobNo || job.id);
  console.log(`    ${String(job.jobNo || job.id).padEnd(12)} ${scrap ? 'scrap  ' : '       '} HV coil weight ${coilWeight ? 'yes' : 'no '}   HV S.E. answer: ${answer ?? '(not recorded)'}${needs ? '   <- must be answered first' : ''}`);
}

if (unexpected) {
  console.log(`\n  REFUSED - ${unexpected} cell(s) are not in the state this script was written for. Nothing assumed.`);
  process.exit(1);
}
if (!planned.length) { console.log('\n  Nothing to change - no cell holds 213.'); process.exit(0); }
if (unanswered.length) {
  console.log(`\n  ${MODE === 'apply' ? 'REFUSED' : 'An apply would be REFUSED'}: ${unanswered.length} job(s) have no HV S.E. answer yet (${unanswered.join(', ')}).`);
  console.log('  Ship the S.E. field, record the answer on each inspection, then run this. Reverting first');
  console.log('  would under-charge S.E. work on this AT until the field exists.');
  if (MODE === 'apply') process.exit(1);
}

if (MODE !== 'apply') {
  console.log(`\n  DRY RUN - nothing was written. ${planned.length} cell(s) would change.`);
  process.exit(0);
}

// ---------------------------------------------------------------- the write
await db.runTransaction(async tx => {
  const fresh = (await tx.get(atRef)).data() || {};
  const freshRows = fresh[FIELD] || [];
  const freshIdx = findRow(freshRows);
  const moved = freshIdx !== idx
    || JSON.stringify(freshRows.map(r => r.itemCode)) !== JSON.stringify(rows.map(r => r.itemCode))
    || planned.some(kva => freshRows[freshIdx]?.rates?.[kva] !== WRONG);
  if (moved) throw new Error('The master changed since this script read it. Nothing was written - run it again.');
  tx.update(atRef, {
    [FIELD]: freshRows.map((r, i) => (i === freshIdx ? { ...r, rates: { ...r.rates, ...Object.fromEntries(planned.map(k => [k, RIGHT])) } } : r)),
    seRevertAt: Date.now(),
    seRevertBy: 'scripts/admin/revert-at-1049-12Ab.js',
    seRevertNote: `12A(b) ${planned.map(k => `@${k}`).join(' ')} ${WRONG} -> ${RIGHT}: the with-S.E. rate had been entered into the without-S.E. row. S.E. jobs price 12A-b1 from Schedule-A (AUDIT O20).`,
  });
});
console.log(`\n  Wrote ${planned.length} cell(s) and stamped seRevertAt.`);
process.exit(0);
