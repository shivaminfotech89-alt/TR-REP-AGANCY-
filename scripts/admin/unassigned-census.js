/**
 * WORK BELONGING TO NO TENDER — and the side-by-side check that AUDIT F87 exists for.
 *
 * READ-ONLY. Nothing here writes.
 *
 * ⚠ THIS SCRIPT'S JOB IS TO AGREE WITH THE APP, OUT LOUD. The defect it was written after
 * was not a wrong filter - it was a script and a screen measuring the same quantity by
 * different means, reporting 12 and 4 days apart, with nothing putting the two numbers in
 * the same place. `assign-at.js` filtered in JavaScript and was right; the banner queried
 * Firestore with `where('atId','==','')` and silently missed the 8 documents whose field is
 * ABSENT rather than empty, because no Firestore equality matches a missing field.
 *
 * So `isUnassigned` below is COPIED FROM THE APP deliberately, and the counts printed are
 * what each screen will actually render - not an independent opinion about the data. If this
 * script and the app ever disagree again, that is the bug, and it should be loud.
 */
import { all, banner } from './_db.js';

/** The app's own test, verbatim - src/lib/AgencyContext.ts isUnassigned. */
const isUnassigned = r => !String(r?.atId ?? '').trim();

banner('UNASSIGNED CENSUS — what each screen will show (AUDIT F87)');
const [agencies, ats, jobs, txns] = await Promise.all(
  ['agencies','atMasters','jobs','oilTransactions'].map(all));
const agName = id => agencies.find(a => a.id === id)?.name || id;

console.log('\n1. MR LEDGER BANNER  (was where(atId,==,"") -> 4)');
for (const ag of agencies) {
  const mine = jobs.filter(j => j.agencyId === ag.id);
  const u = mine.filter(isUnassigned);
  if (u.length) console.log(`   ${ag.name.padEnd(22)} ${u.length} unassigned of ${mine.length}`);
}
console.log(`   TOTAL now found: ${jobs.filter(isUnassigned).length}  (absent ${jobs.filter(j=>!('atId' in j)).length} + empty ${jobs.filter(j=>'atId' in j && !String(j.atId??'').trim()).length})`);

console.log('\n2. OIL REGISTER  (was 0 for every tender)');
for (const at of ats) {
  const scoped = txns.filter(t => !isUnassigned(t) && String(t.atId) === at.id);
  console.log(`   AT ${String(at.atNumber||at.name).padEnd(14)} [${agName(at.agencyId).padEnd(20)}] scoped ${scoped.length}`);
}
const uTx = txns.filter(isUnassigned);
console.log(`   UNASSIGNED SECTION: ${uTx.length} txn(s), ${uTx.reduce((s,t)=>s+(Number(t.netLiters)||0),0).toFixed(2)} LTR`);
uTx.forEach(t => console.log(`      MR ${String(t.mrNo).padEnd(8)} ${String(t.division||'(none)').padEnd(12)} ${(Number(t.netLiters)||0).toFixed(2)} LTR  [${agName(t.agencyId)}]`));

console.log('\n3. CARRY-FORWARD  (refuses while anything is unassigned)');
for (const ag of agencies) {
  const uT = txns.filter(t => t.agencyId === ag.id && isUnassigned(t)).length;
  const uJ = jobs.filter(j => j.agencyId === ag.id && isUnassigned(j)).length;
  const prevExists = ats.filter(a => a.agencyId === ag.id).some(at =>
    ats.some(p => p.agencyId === ag.id && p.id !== at.id && (p.startDate||0) < (at.startDate||0)));
  if (!ats.some(a => a.agencyId === ag.id)) continue;
  console.log(`   ${ag.name.padEnd(22)} ${(uT||uJ) ? `REFUSED (${uT} txn, ${uJ} job)` : (prevExists ? 'offered' : 'no previous tender')}`);
}
