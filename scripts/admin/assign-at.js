// ATTRIBUTE UNASSIGNED WORK TO A TENDER
//
//   node scripts/admin/assign-at.js                       <- what is unassigned, and what can be inferred
//   node scripts/admin/assign-at.js --apply               <- writes, after MODE is changed
//
// ⚠ MODE MUST BE 'dry-run' IN THE REPOSITORY.
//
// WHY (AUDIT F82)
// ---------------
// Every screen now shows the active tender's work. A job with no `atId` belongs to no
// tender and appears under none - correct, and it would silently remove MSBT-12, which is
// estimated, billed AND paid, from Billing and Reports. So unassigned work is surfaced
// rather than hidden, and this is what empties that list.
//
// ⚠ IT INFERS ONLY FROM SIBLINGS ON THE SAME MR, and never guesses otherwise. An MR whose
// other jobs all name one tender is not ambiguous: the unstamped ones belong to it. An MR
// where NO job names a tender has nothing to infer from, and this refuses rather than
// picking the agency's active AT - a job attributed to the wrong tender prices from the
// wrong schedule and counts against the wrong allotment, silently.
//
// Oil is not touched. A transaction names an MR, not a job, and three of the four
// unassigned ones name an MR with no jobs at all - there is nothing to infer from.

import { all, banner, db } from './_db.js';

const MODE = 'dry-run';
const APPLY = MODE === 'apply' && process.argv.includes('--apply');

banner('ASSIGN UNASSIGNED WORK TO A TENDER');
console.log(`MODE = '${MODE}'${APPLY ? '   ** WRITING **' : '   (dry run - nothing will be written)'}\n`);

const [agencies, ats, jobs, oilTx] = await Promise.all([
  all('agencies'), all('atMasters'), all('jobs'), all('oilTransactions'),
]);
const agName = id => agencies.find(a => a.id === id)?.name || id;
const atLabel = id => { const a = ats.find(x => x.id === id); return a ? (a.atNumber || a.name || id) : `(missing ${String(id).slice(0,8)}…)`; };
const issued = j => [j.estimateSentDate && 'est', j.estimateAmount && `est ₹${j.estimateAmount}`,
  j.billNo && 'billed', j.billAmount && `bill ₹${j.billAmount}`, j.paymentStatus === 'Paid' && 'PAID',
  j.challanNo && 'challan'].filter(Boolean).join(', ');

const unassigned = jobs.filter(j => !String(j.atId ?? '').trim());
console.log(`${unassigned.length} of ${jobs.length} job(s) carry no atId\n`);

const plan = [], blocked = [];
for (const j of unassigned) {
  const siblings = jobs.filter(x =>
    x.agencyId === j.agencyId &&
    String(x.mrNo ?? '').trim() === String(j.mrNo ?? '').trim() &&
    String(x.atId ?? '').trim());
  const ids = [...new Set(siblings.map(x => String(x.atId).trim()))];
  const row = {
    agency: agName(j.agencyId), jobNo: j.jobNo || j.id, mr: j.mrNo || '(blank)',
    issued: issued(j) || '-',
  };
  if (ids.length === 1) plan.push({ ...row, id: j.id, atId: ids[0], to: atLabel(ids[0]), from: `${siblings.length} sibling(s) on the MR` });
  else blocked.push({ ...row, why: ids.length === 0 ? 'no job on this MR names a tender' : `siblings SPLIT across ${ids.length} tenders` });
}

console.log('================ CAN BE INFERRED ================');
if (plan.length === 0) console.log('  None. No unassigned job has a sibling that names a tender.\n');
else { console.table(plan.map(({ id, atId, ...r }) => r)); }

console.log('\n================ CANNOT — NOT GUESSED ================');
if (blocked.length === 0) console.log('  None.');
else {
  console.table(blocked);
  console.log('  These need a human with the MR paperwork. Attributing them to the agency\'s');
  console.log('  active AT would price them from the wrong schedule and count them against the');
  console.log('  wrong allotment, with nothing saying so.');
  const paid = blocked.filter(b => b.issued !== '-');
  if (paid.length) {
    console.log(`\n  ⚠ ${paid.length} of them carry an ISSUED DOCUMENT. Until assigned they appear`);
    console.log('    under no tender, so they are reachable only through the unassigned view.');
  }
}

const oilUn = oilTx.filter(t => !String(t.atId ?? '').trim());
console.log(`\n================ OIL ================`);
console.log(`  ${oilUn.length} of ${oilTx.length} transaction(s) carry no atId.`);
if (oilUn.length) {
  console.table(oilUn.map(t => {
    const js = jobs.filter(j => j.agencyId === t.agencyId && String(j.mrNo ?? '').trim() === String(t.mrNo ?? '').trim());
    const ids = [...new Set(js.map(j => String(j.atId ?? '').trim()).filter(Boolean))];
    return { agency: agName(t.agencyId), mr: t.mrNo, division: t.division, net: t.netLiters,
      couldInfer: js.length === 0 ? 'NO - no jobs on that MR' : ids.length === 1 ? atLabel(ids[0]) : 'NO - jobs have no atId' };
  }));
  console.log('  Not written by this script. Oil names an MR, not a job, and a transaction');
  console.log('  attributed to the wrong tender moves a balance the DISCOM is owed against.');
}

console.log('\n================ TOTALS ================');
console.log(`  ${plan.length} job(s) would be written, ${blocked.length} refused, ${oilUn.length} oil transaction(s) left alone.`);

if (!APPLY) {
  console.log("\nDRY RUN - nothing was written.");
  console.log("To apply: set MODE = 'apply' in this file AND pass --apply, then set it back.");
  process.exit(0);
}

for (const p of plan) {
  await db.collection('jobs').doc(p.id).update({ atId: p.atId });
  console.log(`  written  jobs/${p.id}  ${p.jobNo} -> ${p.to}`);
}
console.log(`\n${plan.length} job(s) written.`);
