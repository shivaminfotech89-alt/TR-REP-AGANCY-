// DOES MOVING THE RATES ONTO THE AT CHANGE ANY PRICE? — READ-ONLY.
//
//   node scripts/admin/master-equivalence.js
//
// The migration copied each agency's five sections onto its ATs, so the AT rung and the
// agency rung hold the SAME arrays. The resolver therefore returns identical rates before
// and after the move, and no price can change (AUDIT F73).
//
// That is a claim about data, so it is checked against data rather than asserted. For every
// job, this deep-compares:
//
//   BEFORE   what the agency rung would have returned
//   AFTER    what the AT rung now returns
//
// Any difference is a migration fault or a resolver fault, and either one moves money.

import { all, banner } from './_db.js';

banner('MASTER EQUIVALENCE — AGENCY RUNG vs AT RUNG');

const [agencies, ats, jobs] = await Promise.all([all('agencies'), all('atMasters'), all('jobs')]);
const agName = id => agencies.find(a => a.id === id)?.name || id || '(none)';

// Which section a core type resolves to - mirrors getEstimateMasterForCore's branches.
const sectionFor = (coreType) => {
  const t = String(coreType || 'CRGO').trim().toUpperCase();
  if (t === 'OH' || t.includes('OVERHAUL')) return 'estimateMasterOverhauling';
  if (t.includes('AMORPHOUS') || t.includes('AM')) return 'estimateMasterAmorphous';
  if (t.includes('WOUND') || t.includes('WC')) return 'estimateMasterWoundCore';
  return 'estimateMasterCRGO';
};

const norm = v => JSON.stringify(v ?? null);

const rows = [];
let identical = 0, differing = 0, noAt = 0;

for (const j of jobs) {
  const ag = agencies.find(a => a.id === j.agencyId);
  const at = j.atId ? ats.find(a => a.id === j.atId) : null;
  const key = sectionFor(j.coreType);

  if (!at) { noAt++; continue; }   // resolves through the agency both ways - unchanged by construction

  const before = ag?.[key];
  const after = at?.[key];
  const same = norm(before) === norm(after);
  same ? identical++ : differing++;

  if (!same) rows.push({
    agency: agName(j.agencyId), jobNo: j.jobNo, core: j.coreType || 'CRGO', section: key,
    agencyItems: Array.isArray(before) ? before.length : '(none)',
    atItems: Array.isArray(after) ? after.length : '(none)',
  });
}

console.log(`${jobs.length} job(s): ${identical} identical, ${differing} DIFFERING, ${noAt} have no AT\n`);

if (differing === 0) {
  console.log('  ✓ EVERY job whose AT is known resolves the SAME array from the AT rung as it');
  console.log('    would have from the agency rung. The move cannot have changed a price.');
} else {
  console.log('  ⚠ THESE JOBS WOULD PRICE DIFFERENTLY:');
  console.table(rows);
}

console.log(`\n  ${noAt} job(s) carry no atId. They resolve through the agency rung exactly as`);
console.log('  before - the AT rung is simply skipped, so they are unchanged by construction.');

// Section-level view: which AT sections match their agency, byte for byte
console.log('\n=== PER AT, PER SECTION ===');
const SECTIONS = ['estimateMasterCRGO','estimateMasterAmorphous','estimateMasterWoundCore','estimateMasterOverhauling','estimateMasterCircleLimits'];
console.table(ats.map(at => {
  const ag = agencies.find(a => a.id === at.agencyId);
  const r = { at: at.atNumber || at.name || at.id, agency: ag?.name || '?', ratesSource: at.ratesSource || '(NONE)' };
  SECTIONS.forEach(k => {
    const label = k.replace('estimateMaster', '');
    r[label] = norm(ag?.[k]) === norm(at?.[k]) ? 'same' : `DIFFERS (${Array.isArray(ag?.[k]) ? ag[k].length : 0} vs ${Array.isArray(at?.[k]) ? at[k].length : 0})`;
  });
  return r;
}));

console.log('\nDone. Nothing was written.');
