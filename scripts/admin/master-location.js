// WHERE THE ESTIMATE RATES ACTUALLY LIVE TODAY — READ-ONLY.
//   node scripts/admin/master-location.js
// Precondition check for moving the estimate master onto the AT: which agencies hold their
// own sections, which ATs exist to receive them, and how many jobs could name their own AT.
import { all, banner } from './_db.js';
banner('ESTIMATE MASTER — CURRENT LOCATION');
const [agencies, ats, jobs] = await Promise.all([all('agencies'), all('atMasters'), all('jobs')]);
const SECTIONS = ['estimateMasterCRGO','estimateMasterAmorphous','estimateMasterWoundCore','estimateMasterOverhauling','estimateMasterCircleLimits','estimateMaster'];
const n = v => Array.isArray(v) ? v.length : 0;
console.log('--- AGENCIES: sections held on the agency document ---');
console.table(agencies.map(a => ({
  agency: a.name, owner: String(a.ownerId||'').slice(0,8),
  CRGO: n(a.estimateMasterCRGO), Amorph: n(a.estimateMasterAmorphous),
  Wound: n(a.estimateMasterWoundCore), OH: n(a.estimateMasterOverhauling),
  Circle: n(a.estimateMasterCircleLimits), legacy: n(a.estimateMaster),
  ats: ats.filter(t => t.agencyId === a.id).length,
})));
console.log('\n--- ATs: do any already hold rates? ---');
console.table(ats.map(t => ({
  at: t.atNumber || t.name || t.id, agency: (agencies.find(a=>a.id===t.agencyId)||{}).name || '?',
  status: t.status || '(blank)',
  sectionsHeld: SECTIONS.filter(k => n(t[k]) > 0).join(', ') || 'NONE',
  jobs: jobs.filter(j => j.atId === t.id).length,
})));
const withAt = jobs.filter(j => String(j.atId||'').trim()).length;
console.log(`\n--- JOBS ---\n  ${jobs.length} total, ${withAt} carry an atId, ${jobs.length-withAt} do NOT.`);
console.log('  A job with no atId cannot resolve rates from "its own AT" - it has none to name.');
console.log('\nDone. Nothing was written.');
