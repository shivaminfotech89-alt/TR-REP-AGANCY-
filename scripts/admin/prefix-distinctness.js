// ARE PREFIXES DISTINCT ACROSS AN OWNER'S AGENCIES? — READ-ONLY.
// node scripts/admin/prefix-distinctness.js
//
// If a job number's prefix comes from the agency being booked into, the wrong-agency case
// cannot show up as a wrong prefix on an AUTO-generated number - the number is derived from
// whichever agency is active, so it is always internally consistent.
//
// It can only show up on a HAND-TYPED number: the operator copies numbers off the MR that
// were agreed for a different agency. That is detectable only if the two agencies use
// different prefixes for the same division.
import { all, banner } from './_db.js';
banner('PREFIX DISTINCTNESS ACROSS AN OWNER\'S AGENCIES');
const [agencies, ats] = await Promise.all([all('agencies'), all('atMasters')]);

const flat = (prefixes) => {
  const out = [];
  Object.entries(prefixes || {}).forEach(([div, v]) => {
    if (typeof v === 'string') out.push([`${div}/CRGO`, v]);
    else Object.entries(v || {}).forEach(([core, p]) => { if (p) out.push([`${div}/${core}`, p]); });
  });
  return out;
};

const byOwner = {};
agencies.forEach(a => { (byOwner[a.ownerId] ||= []).push(a); });

for (const [owner, list] of Object.entries(byOwner)) {
  console.log(`\n=== owner ${owner.slice(0, 8)} — ${list.length} agencies ===`);
  const rows = [];
  list.forEach(a => {
    const atPfx = ats.filter(t => t.agencyId === a.id).flatMap(t => flat(t.prefixes));
    const src = atPfx.length ? atPfx : flat(a.prefixes);
    if (!src.length) rows.push({ agency: a.name, key: '(none configured)', prefix: '-' });
    src.forEach(([key, p]) => rows.push({ agency: a.name, key, prefix: p }));
  });
  console.table(rows);

  // A prefix used by more than one of this owner's agencies cannot identify which
  const byPrefix = {};
  rows.filter(r => r.prefix !== '-').forEach(r => { (byPrefix[r.prefix] ||= new Set()).add(r.agency); });
  const shared = Object.entries(byPrefix).filter(([, set]) => set.size > 1);
  console.log(shared.length
    ? `  SHARED PREFIXES — cannot identify an agency:\n` +
      shared.map(([p, set]) => `    "${p}" used by ${[...set].join(', ')}`).join('\n')
    : '  Every prefix belongs to exactly one agency — a typed prefix identifies its agency.');
}
console.log('\nDone. Nothing was written.');
