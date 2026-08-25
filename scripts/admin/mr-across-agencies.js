// THE SAME MR NUMBER UNDER MORE THAN ONE AGENCY — READ-ONLY.
// node scripts/admin/mr-across-agencies.js
import { all, banner, fmtDate } from './_db.js';
banner('MR NUMBERS SHARED ACROSS AGENCIES');
const [agencies, jobs] = await Promise.all([all('agencies'), all('jobs')]);
const ag = id => agencies.find(a => a.id === id) || {};
const byMr = {};
jobs.forEach(j => {
  const mr = String(j.mrNo ?? '').trim();
  if (!mr) return;
  (byMr[mr] ||= []).push(j);
});
const rows = [];
Object.entries(byMr).forEach(([mr, list]) => {
  const agencyIds = [...new Set(list.map(j => j.agencyId))];
  if (agencyIds.length < 2) return;
  const owners = [...new Set(agencyIds.map(id => ag(id).ownerId))];
  rows.push({
    mr,
    agencies: agencyIds.map(id => ag(id).name || id).join(' | '),
    owners: owners.length,
    sameOwner: owners.length === 1 ? 'YES — one owner, several agencies' : 'no',
    divisions: [...new Set(list.map(j => j.division))].join(','),
    jobs: list.length,
    dates: [...new Set(list.map(j => fmtDate(j.dateOfIssue).split(',')[0]))].join(', '),
  });
});
if (!rows.length) console.log('  No MR number appears under more than one agency.');
else {
  console.table(rows);
  const same = rows.filter(r => r.sameOwner.startsWith('YES'));
  console.log(`\n  ${rows.length} MR number(s) appear under more than one agency.`);
  console.log(`  ${same.length} of those are agencies belonging to the SAME OWNER — the`);
  console.log('  wrong-agency case: one person re-entering a handwritten MR under the');
  console.log('  agency that happened to be selected.');
  console.log('\n  The duplicate-MR guard in NewJob is scoped to ownerId + division +');
  console.log('  agencyId, so a second agency is a different key and passes cleanly.');
}
console.log('\nDone. Nothing was written.');
