// WHICH JOBS CHANGE PRICE WHEN THE AT PERCENTAGE COMES FROM THE JOB'S OWN AT — READ-ONLY.
//
//   node scripts/admin/at-percentage-exposure.js
//
// Every pricing path today passes `activeAtMaster` - the AT the SESSION has selected - to
// getAtPercentageForCore. Ten call sites, none reading job.atId. So switching the active AT
// re-prices historical jobs at the new tender's percentage.
//
// This is the baseline for that fix. It compares, per job:
//   OWN     the percentage on the AT the job was booked under (job.atId)
//   SESSION the percentage on whichever AT is Active for that agency today
//
// Rows where they differ are the jobs whose price changes when the fix lands. Rows where
// they agree are proof the fix is a no-op for them. Run again afterwards: the deltas
// predicted here must be exactly the deltas observed.

import { all, banner } from './_db.js';

banner('AT PERCENTAGE — OWN AT vs SESSION AT');

const [agencies, ats, jobs] = await Promise.all([all('agencies'), all('atMasters'), all('jobs')]);
const agName = id => agencies.find(a => a.id === id)?.name || id || '(none)';
const atLabel = t => t ? (t.atNumber || t.name || t.id) : '(none)';

// Mirrors getAtPercentageForCore in AgencyContext.tsx - default 4 when no AT.
const pctFor = (at, coreType) => {
  if (!at) return 4;
  const t = String(coreType || 'CRGO').trim().toUpperCase();
  if (t.includes('AMORPHOUS') || t.includes('AM')) return at.atPercentageAmorphous ?? at.atPercentage ?? 4;
  if (t.includes('WOUND') || t.includes('WC')) return at.atPercentageWoundCore ?? at.atPercentage ?? 4;
  return at.atPercentageCRGO ?? at.atPercentage ?? 4;
};

const rows = [];
for (const j of jobs) {
  const own = ats.find(a => a.id === j.atId) || null;
  // "the session's AT" = the agency's Active one, which is what a user normally has selected
  const session = ats.find(a => a.agencyId === j.agencyId && String(a.status || '').toLowerCase() === 'active') || null;
  const pOwn = own ? pctFor(own, j.coreType) : null;
  const pSess = pctFor(session, j.coreType);
  rows.push({
    agency: agName(j.agencyId), jobNo: j.jobNo || j.id, core: j.coreType || 'CRGO',
    ownAt: own ? atLabel(own) : '(NO atId)',
    sessionAt: atLabel(session),
    ownPct: pOwn === null ? '-' : pOwn,
    sessionPct: pSess,
    changes: own ? (pOwn !== pSess ? `${pSess}% -> ${pOwn}%` : '') : 'n/a - no atId',
  });
}

const differing = rows.filter(r => r.changes && r.changes !== 'n/a - no atId');
const noAt = rows.filter(r => r.changes === 'n/a - no atId');

console.log(`${jobs.length} job(s)\n`);
console.table(rows.filter(r => r.changes));

console.log('=== VERDICT ===');
console.log(`  ${differing.length} job(s) would be priced at a DIFFERENT percentage after the fix.`);
console.log(`  ${noAt.length} job(s) carry no atId - nothing to resolve, so they keep the`);
console.log(`     session AT's percentage and are recorded as ratesSource 'no-at'.`);
console.log(`  ${jobs.length - differing.length - noAt.length} job(s) are unaffected: own AT and session AT agree.`);
if (differing.length === 0) {
  console.log('\n  The fix is currently a NO-OP on live data - every job whose AT is known sits');
  console.log('  under the AT that is active for its agency. That is not proof it is unnecessary:');
  console.log('  it becomes live the moment a second AT is activated, which is what a rollover is.');
}
console.log('\nDone. Nothing was written.');
