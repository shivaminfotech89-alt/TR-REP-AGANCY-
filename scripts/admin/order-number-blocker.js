// WHO CANNOT PRINT OR SEND AN ESTIMATE TODAY, AND WHAT THEY WERE ABLE TO DO BEFORE — READ-ONLY.
//
//   node scripts/admin/order-number-blocker.js
//
// G63 made an estimate refuse to print, download or send unless its AT carries BOTH
// `orderNo` and `orderDate`, read from the job's own AT and never from another. The rule
// is right: a document that names another tender's order goes to a division office and
// stays in its file.
//
// The question this answers is different, and it is about SEQUENCING rather than the rule:
// the field and the refusal arrived in the same change, so on the day it shipped no AT
// could satisfy it. This prints who is blocked, how much work sits behind the block, and
// whether anyone has issued an estimate since - which is the only evidence available of
// somebody hitting it.
//
// Nothing is written.

import { all, banner } from './_db.js';

banner('ORDER NUMBER — WHO IS BLOCKED');

const [agencies, ats, jobs] = await Promise.all([all('agencies'), all('atMasters'), all('jobs')]);

const agName = id => agencies.find(a => a.id === id)?.name || id || '(none)';
const atLabel = a => String(a.atNumber ?? '').trim() || String(a.name ?? '').trim() || a.id;
const has = v => String(v ?? '').trim() !== '';

// G63's rule, mirrored: BOTH parts are required or the estimate refuses.
const canPrint = a => has(a.orderNo) && has(a.orderDate);

const jobsFor = atId => jobs.filter(j => j.atId === atId);
const live = j => j.status !== 'Cancelled' && !j.isCancelled && j.mrStatus !== 'Cancelled';

console.log(`${ats.length} AT(s), ${jobs.length} job(s)\n`);

const rows = ats.map(a => {
  const mine = jobsFor(a.id);
  return {
    agency: agName(a.agencyId),
    at: atLabel(a).slice(0, 44),
    status: a.status || '—',
    orderNo: has(a.orderNo) ? a.orderNo : '—',
    orderDate: has(a.orderDate) ? a.orderDate : '—',
    canPrint: canPrint(a) ? 'yes' : 'NO',
    jobs: mine.length,
    liveJobs: mine.filter(live).length,
  };
});
rows.sort((x, y) => (x.canPrint === y.canPrint ? y.liveJobs - x.liveJobs : x.canPrint === 'NO' ? -1 : 1));
console.table(rows);

const blocked = ats.filter(a => !canPrint(a));
const blockedJobs = blocked.flatMap(a => jobsFor(a.id));
const blockedLive = blockedJobs.filter(live);
const blockedAgencies = new Set(blocked.map(a => a.agencyId));

console.log('=== THE BLOCK ===');
console.log(`  ${blocked.length} of ${ats.length} AT(s) cannot print, download or send an estimate.`);
console.log(`  ${blockedAgencies.size} of ${agencies.length} agency/agencies affected.`);
console.log(`  ${blockedJobs.length} job(s) sit on a blocked AT; ${blockedLive.length} of them are not cancelled.`);
const jobsNoAt = jobs.filter(j => !has(j.atId));
console.log(`  ${jobsNoAt.length} job(s) carry no atId at all - they refuse for a different reason`);
console.log('     ("belongs to no tender"), which predates this and is not counted above.');

// ---------------------------------------------------------------- evidence of attempts

console.log('\n=== ESTIMATE ACTIVITY — the only evidence anyone hit the block ===');
const withEstimate = jobs.filter(j => has(j.estimateNo) || has(j.estimateSentDate) || has(j.estimateAmount));
console.log(`  ${withEstimate.length} job(s) carry any estimate mark at all.`);

const dated = jobs
  .filter(j => has(j.estimateSentDate))
  .map(j => ({
    sent: String(j.estimateSentDate),
    jobNo: j.jobNo || j.id,
    agency: agName(j.agencyId),
    at: j.atId ? (ats.find(a => a.id === j.atId) ? atLabel(ats.find(a => a.id === j.atId)) : '(AT missing)') : '(no atId)',
    atCanPrint: j.atId && ats.find(a => a.id === j.atId) ? (canPrint(ats.find(a => a.id === j.atId)) ? 'yes' : 'NO') : 'n/a',
  }));
dated.sort((a, b) => String(a.sent).localeCompare(String(b.sent)));
if (dated.length === 0) {
  console.log('  No job carries an estimateSentDate, so no estimate has ever been recorded as sent.');
} else {
  console.log(`\n  ${dated.length} job(s) with an estimateSentDate, oldest first:`);
  console.table(dated);
  console.log(`\n  Most recent estimate sent: ${dated[dated.length - 1].sent}`);
  console.log('  ⚠ An estimate SENT while its AT cannot print is evidence the send predates G63,');
  console.log('    not that the refusal is bypassable - the refusal gates print/download/send today.');
}

console.log('\n=== WHAT A BLOCKED AGENCY WOULD HAVE TO DO ===');
for (const a of blocked) {
  const mine = jobsFor(a.id).filter(live);
  if (mine.length === 0) continue;
  const missing = [has(a.orderNo) ? '' : 'order number', has(a.orderDate) ? '' : 'order date'].filter(Boolean);
  console.log(`  ${agName(a.agencyId).padEnd(30)} AT "${atLabel(a)}"`);
  console.log(`${' '.repeat(32)}needs ${missing.join(' and ')} — ${mine.length} live job(s) waiting`);
}

console.log('\nDone. Nothing was written.');
