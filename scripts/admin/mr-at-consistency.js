// DOES EVERY MR AGREE WITH ITSELF ABOUT WHICH TENDER IT BELONGS TO?
//
// READ-ONLY.   node scripts/admin/mr-at-consistency.js
//
// Admin-SDK port of scripts/mr-at-consistency-console.js. Same question, but across EVERY
// owner in one run rather than once per signed-in account.
//
// WHY IT MATTERS
// --------------
// MrLedger draws a new transformer's job number from - and stamps - the MR's OWN AT, because
// a unit added to MR 1563 belongs to the tender MR 1563 was issued under: it consumes that
// AT's allotment and prices at its percentage, whatever is selected today (AUDIT F66).
//
// That refusal is already in shipped code. This counts what it would refuse:
//
//   AGREED   every job on the MR carries the same non-empty atId   -> usable
//   PARTIAL  one AT is known, some jobs simply lack the stamp      -> backfillable from siblings
//   SPLIT    the MR's jobs disagree                                -> a data fault, decide per MR
//   MISSING  no job carries an atId at all                         -> nothing to draw from

import { all, banner, fmtDate } from './_db.js';

banner('MR / AT CONSISTENCY');

const [agencies, ats, jobs] = await Promise.all([all('agencies'), all('atMasters'), all('jobs')]);

const agName = id => agencies.find(a => a.id === id)?.name || id || '(none)';
const atName = id => {
  const a = ats.find(x => x.id === id);
  return a ? (a.atNumber || a.name || a.id) : `(unknown ${String(id).slice(0, 6)}…)`;
};
const ownerOf = id => agencies.find(a => a.id === id)?.ownerId || '(no agency)';

const mrs = {};
jobs.forEach(j => {
  const key = `${j.agencyId}|${String(j.mrNo ?? '').trim()}`;
  (mrs[key] ||= []).push(j);
});

const rows = [];
const counts = { AGREED: 0, PARTIAL: 0, SPLIT: 0, MISSING: 0 };

Object.entries(mrs).forEach(([key, list]) => {
  const [agencyId, mrNo] = key.split('|');
  const ids = [...new Set(list.map(j => String(j.atId ?? '').trim()).filter(Boolean))];
  const without = list.filter(j => !String(j.atId ?? '').trim()).length;

  let verdict;
  if (ids.length === 1 && without === 0) verdict = 'AGREED';
  else if (ids.length === 0) verdict = 'MISSING';
  else if (ids.length === 1) verdict = 'PARTIAL';
  else verdict = 'SPLIT';
  counts[verdict]++;

  rows.push({
    verdict,
    agency: agName(agencyId),
    mr: mrNo || '(blank)',
    jobs: list.length,
    noAt: without,
    ats: ids.length ? ids.map(atName).join(' | ') : '(none)',
    firstDate: fmtDate(list[0]?.dateOfIssue ?? list[0]?.createdAt).split(',')[0],
  });
});

const order = { SPLIT: 0, MISSING: 1, PARTIAL: 2, AGREED: 3 };
rows.sort((a, b) => order[a.verdict] - order[b.verdict] || a.agency.localeCompare(b.agency));

console.log(`${rows.length} MR(s) across ${agencies.length} agency(ies), ${new Set(agencies.map(a => a.ownerId)).size} owner(s)\n`);
console.table(rows);

console.log('\n=== VERDICT ===');
console.log(`  AGREED   ${String(counts.AGREED).padStart(4)}   one AT, every job - usable`);
console.log(`  PARTIAL  ${String(counts.PARTIAL).padStart(4)}   AT known, some jobs unstamped - backfillable from siblings`);
console.log(`  SPLIT    ${String(counts.SPLIT).padStart(4)}   jobs under different ATs - decide per MR`);
console.log(`  MISSING  ${String(counts.MISSING).padStart(4)}   no atId anywhere - nothing to draw from`);

const blocked = counts.PARTIAL + counts.SPLIT + counts.MISSING;
if (blocked === 0) {
  console.log('\n  Every MR agrees with itself. The refusal in MrLedger can never fire, and');
  console.log('  drawing the number and the atId from the MR\'s own AT works everywhere.');
} else {
  console.log(`\n  ${blocked} MR(s) would be refused a new transformer, with a named error rather`);
  console.log('  than silently taking the session\'s AT.');
  if (counts.PARTIAL) {
    console.log(`\n  ${counts.PARTIAL} are PARTIAL - the answer is in the sibling jobs, so these are a`);
    console.log('  mechanical backfill rather than a decision.');
  }
  console.log('\n  Per-owner breakdown of the affected MRs:');
  const byOwner = {};
  rows.filter(r => r.verdict !== 'AGREED').forEach(r => {
    const owner = ownerOf(agencies.find(a => a.name === r.agency)?.id);
    (byOwner[owner] ||= []).push(`${r.agency}/${r.mr} (${r.verdict})`);
  });
  Object.entries(byOwner).forEach(([owner, list]) => {
    console.log(`    ${owner}: ${list.length}`);
    list.slice(0, 12).forEach(x => console.log(`      ${x}`));
    if (list.length > 12) console.log(`      … and ${list.length - 12} more`);
  });
}

console.log('\nDone. Nothing was written.');
