// CLEAR OVERHAULING ROW 7 - THE STORED FIGURES THAT UNDERCHARGE EVERY OVERHAULING JOB (AUDIT O66)
//
//   node scripts/admin/clear-overhauling-row-7.js            <- DRY RUN, writes nothing
//   node scripts/admin/clear-overhauling-row-7.js --apply    <- writes, after MODE is changed
//
// ⚠ MODE MUST BE 'dry-run' IN THE REPOSITORY. Change it to run, change it back before committing.
// Security rules do NOT apply to the Admin SDK - see _db.js.
//
// WHAT IT CLEARS
// --------------
// Row 7 ("Overhauling of complete transformer") of the Overhauling section, in every AT, agency, published template,
// public_config and system_config that holds EXACTLY the figures the shipped default carried from 2026-08-18:
//
//     5:2061  10:1603  16:1603  25:2061  50:2061  63:2061  100:2500  200:3000  315:3000  500:3000   fixedRate 2061
//
// Every rate cell becomes null, and fixedRate becomes null. No other row, and no other field, is written.
//
// WHY NULL, AND WHY THE ROW STAYS
// -------------------------------
// Overhauling has no rate of its own in either tender: both bill it "as per Sr. No. 21 of Schedule-A". A null cell
// falls through to the job's own tender's Sr 21 (resolveRate) and cannot go stale when the next tender reprices. The
// figures cleared were never a tender's - 1603 and 2061 are the 2020 Sr 1a labour charge, and 2500 and 3000 appear in
// no tender - but differing from the 2020 Sr 21 baseline, the copy test honoured them as overrides.
//   - AN ABSENT KEY IS REFILLED from the shipped defaults (normalizeOverhaulingData); a null is kept. So every key is
//     written, as null.
//   - A DELETED ROW IS RE-ADDED from the shipped defaults (getEstimateMasterForCore). So the row stays.
//   - A HOLDER WITH NO SECTION prices from the shipped defaults. That is fixed by the same commit's change to
//     defaultOverhaulingEstimateData, once deployed - not by this script.
//
// WHAT IT REFUSES
// ---------------
// A row 7 holding anything other than exactly those figures, or exactly all-null, is HELD: listed and not touched. It
// may be a figure someone typed.
//
// PROOF BEFORE ANY WRITE - dry run and apply alike
// ------------------------------------------------
//   - POSITIVE CONTROL. A synthetic 63 kVA overhauling job on one AT of each schedule, priced through the APP'S OWN
//     BUILDER, must charge 2061 with row 7 as stored and exactly that schedule's Sr 21 with it cleared. Otherwise the
//     run refuses: a comparison that cannot see the change it is making proves nothing (AUDIT, "a harness that reports
//     no difference must contain a case that MUST differ").
//   - EVERY LIVE JOB is priced before and after. Overhauling jobs are listed line by line. Any other job that moves
//     refuses the run. Zero jobs priced refuses the run.
//   - APPLY re-reads each document in a transaction and writes only if it still holds exactly the default figures.
//     Afterwards every written document is read back: row 7 must be null, every other row unchanged.

import { all, banner, db } from './_db.js';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const MODE = 'dry-run';   // 'dry-run' | 'apply'
const APPLY = MODE === 'apply' && process.argv.includes('--apply');

banner('CLEAR OVERHAULING ROW 7');
console.log(`MODE = '${MODE}'${APPLY ? '   ** WRITING **' : '   (dry run - nothing will be written)'}\n`);

const refuse = msg => { console.error(`\nREFUSED - ${msg}\nNothing was written.`); process.exit(2); };

// --- the app's own pricing code ----------------------------------------------------------------------------------
// Bundled OUTSIDE the repository: a bundle inside it would be scanned by the app's own Tailwind build (AUDIT G62).
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..').replace(/\\/g, '/');
const OUT = join(tmpdir(), `clear-overhauling-row-7-${process.pid}`);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'entry.ts'), [
  `export { buildSingleJobEstimateData } from '${ROOT}/src/components/SingleJobEstimateReport';`,
  `export { SCHEDULES, scheduleIdForAt, bandForKva } from '${ROOT}/src/lib/ugvclSchedules';`,
  `export { atForJob } from '${ROOT}/src/lib/AgencyContext';`,
].join('\n'));
await build({
  entryPoints: [join(OUT, 'entry.ts')], bundle: true, format: 'esm', platform: 'node', outfile: join(OUT, 'bundle.mjs'),
  logLevel: 'silent', jsx: 'transform', loader: { '.tsx': 'tsx', '.ts': 'ts' },
  plugins: [{
    name: 'stub-bare-imports',
    setup(b) {
      // ⚠ AN ABSOLUTE WINDOWS PATH IS NOT A BARE IMPORT. "C:/..." starts with neither "." nor "/"; stubbing it once
      // stubbed the builder itself and a comparison reported "0 moved" having priced nothing (AUDIT G61).
      b.onResolve({ filter: /^[^./]|^\.\.?$/ }, a => (a.kind === 'entry-point' || /^[A-Za-z]:[\\/]/.test(a.path) ? null : { path: a.path, namespace: 'stub' }));
      b.onResolve({ filter: /(^|\/)firebase$/ }, a => ({ path: a.path, namespace: 'stub' }));
      // The Proxy sits on the PROTOTYPE - see pricing-model-regression.js for why.
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'const h={get:()=>new Proxy(function(){},h),apply:()=>undefined,construct:()=>({})};module.exports=Object.create(new Proxy({},h));',
        loader: 'js',
      }));
    },
  }],
});
const app = await import(pathToFileURL(join(OUT, 'bundle.mjs')).href);
for (const k of ['buildSingleJobEstimateData', 'SCHEDULES', 'scheduleIdForAt', 'bandForKva', 'atForJob']) {
  if (!app[k]) refuse(`the pricing bundle has no ${k}, so nothing could be priced.`);
}

// --- what is stored ------------------------------------------------------------------------------------------------
const CAPS = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'];
const DEFAULT_FIGURES = { 5: 2061, 10: 1603, 16: 1603, 25: 2061, 50: 2061, 63: 2061, 100: 2500, 200: 3000, 315: 3000, 500: 3000 };
const DEFAULT_FIXED = 2061;
const isRow7 = r => String(r?.itemCode ?? '').trim() === '7';

const [agencies, ats, pubs, jobs, inspections] = await Promise.all(
  ['agencies', 'atMasters', 'published_ats', 'jobs', 'inspections'].map(c => all(c)));
const one = async (c, d) => { const s = await db.collection(c).doc(d).get(); return s.exists ? { id: d, ...s.data() } : null; };
const [publicConfig, systemConfig] = await Promise.all([one('public_config', 'estimate_master'), one('system_config', 'estimate_master')]);
const agencyName = id => agencies.find(a => a.id === id)?.name || id;

const holders = [
  ...ats.map(doc => ({ collection: 'atMasters', doc, label: `AT        ${agencyName(doc.agencyId)} | ${doc.atNumber} [${doc.scheduleId || 'no scheduleId'}]` })),
  ...agencies.map(doc => ({ collection: 'agencies', doc, label: `agency    ${doc.name}` })),
  ...pubs.map(doc => ({ collection: 'published_ats', doc, label: `template  ${doc.atNumber || doc.name || doc.id} v${doc.version ?? '-'}` })),
  ...[['public_config', publicConfig], ['system_config', systemConfig]].filter(([, d]) => d)
    .map(([collection, doc]) => ({ collection, doc, label: `shared    ${collection}/estimate_master` })),
];

function classify(section) {
  if (!Array.isArray(section) || section.length === 0) return { verdict: 'NO SECTION' };
  const rows = section.filter(isRow7);
  if (rows.length !== 1) return { verdict: 'HELD', why: `${rows.length} rows coded 7` };
  const r = rows[0];
  const keys = [...new Set([...CAPS, ...Object.keys(r.rates || {})])];
  if (CAPS.every(c => r.rates?.[c] !== null && r.rates?.[c] !== undefined && Number(r.rates[c]) === DEFAULT_FIGURES[c])
      && keys.every(k => CAPS.includes(k) || r.rates[k] === null) && Number(r.fixedRate) === DEFAULT_FIXED) {
    return { verdict: 'CLEAR' };
  }
  if (r.rates && keys.every(k => k in r.rates && r.rates[k] === null) && r.fixedRate === null) return { verdict: 'ALREADY CLEAR' };
  return { verdict: 'HELD', why: `row 7 holds ${CAPS.map(c => `${c}:${r.rates?.[c] ?? '-'}`).join(' ')}  fixedRate ${r.fixedRate ?? '-'}` };
}

function cleared(section) {
  return section.map(r => (isRow7(r)
    ? { ...r, rates: Object.fromEntries([...new Set([...CAPS, ...Object.keys(r.rates || {})])].map(k => [k, null])), fixedRate: null }
    : r));
}

const plan = holders.map(h => ({ ...h, ...classify(h.doc.estimateMasterOverhauling) }));
for (const verdict of ['CLEAR', 'ALREADY CLEAR', 'HELD', 'NO SECTION']) {
  const these = plan.filter(p => p.verdict === verdict);
  console.log(`${verdict}: ${these.length}`);
  these.forEach(p => console.log(`  ${p.label}${p.why ? `\n      ${p.why}` : ''}`));
}
console.log('  (NO SECTION prices from the shipped defaults - fixed by deploying the defaultOverhaulingEstimateData change, not here.)');
const toClear = plan.filter(p => p.verdict === 'CLEAR');
if (!toClear.length) { console.log('\nNothing holds the default figures. Nothing to do.'); process.exit(0); }

// --- proof: the positive control -----------------------------------------------------------------------------------
const after = doc => { const p = toClear.find(x => x.doc === doc); return p ? { ...doc, estimateMasterOverhauling: cleared(doc.estimateMasterOverhauling) } : doc; };
const atsAfter = ats.map(after);
const agenciesAfter = agencies.map(after);

console.log('\nPOSITIVE CONTROL - a synthetic 63 kVA overhauling job, row 7 as stored and cleared');
let controls = 0;
for (const scheduleId of Object.keys(app.SCHEDULES)) {
  const at = ats.find(a => app.scheduleIdForAt(a) === scheduleId && toClear.some(p => p.doc === a));
  if (!at) { console.log(`  ${scheduleId}: no AT on this schedule holds the default row - no control`); continue; }
  const agency = agencies.find(a => a.id === at.agencyId);
  const job = { id: 'control', jobNo: 'CONTROL', capacityKva: '63', coreType: 'OH', atId: at.id, agencyId: at.agencyId, status: 'Pending' };
  const rateOn = atDoc => app.buildSingleJobEstimateData(job, agency, atDoc, {}, {}).physicalItems.find(l => String(l.itemCode) === '7')?.rate;
  const tender = app.SCHEDULES[scheduleId].scheduleA.find(i => i.sr === '21')?.rates[app.bandForKva(63)];
  const before = rateOn(at), afterRate = rateOn(after(at));
  const ok = before === DEFAULT_FIGURES[63] && afterRate === tender;
  console.log(`  ${scheduleId} on ${at.atNumber}: stored ${before}  ->  cleared ${afterRate}   (tender Sr 21 at 63 kVA: ${tender})   ${ok ? 'OK' : 'FAILED'}`);
  if (!ok) refuse(`the control on ${scheduleId} did not move from ${DEFAULT_FIGURES[63]} to the tender's ${tender}.`);
  controls++;
}
if (!controls) refuse('no control could run, so nothing shows the clearing changes a price.');

// --- proof: every live job -----------------------------------------------------------------------------------------
const ext = new Map(), int = new Map();
for (const i of inspections) {
  if (!i.jobId) continue;
  const t = String(i.type || '').toLowerCase();
  if (t === 'external') ext.set(i.jobId, i.data || {});
  else if (t === 'internal') int.set(i.jobId, i.data || {});
}
const price = (job, atList, agencyList) => {
  const at = app.atForJob(job, atList);
  const agency = agencyList.find(a => a.id === job.agencyId);
  if (!at || !agency) return null;
  const d = app.buildSingleJobEstimateData(job, agency, at, ext.get(job.id), int.get(job.id));
  const lines = [...d.physicalItems, ...d.internalItems, ...d.labourItems];
  return { d, lines, key: JSON.stringify([lines.map(l => [l.itemCode, l.scheduleSr, l.qty, l.rate, l.amt]), d.finalAmount]) };
};
let priced = 0, unpriceable = 0;
const moved = [], overhauling = [];
for (const job of jobs) {
  let b, a;
  try { b = price(job, ats, agencies); a = price(job, atsAfter, agenciesAfter); } catch (e) { unpriceable++; continue; }
  if (!b || !a) { unpriceable++; continue; }
  priced++;
  if (/^(OH|OVERHAUL)/i.test(String(job.coreType || '').trim())) overhauling.push({ job, b, a });
  else if (b.key !== a.key) moved.push(`${job.jobNo} (${job.coreType})`);
}
console.log(`\nEVERY LIVE JOB: ${priced} priced before and after, ${unpriceable} without an AT or agency to price against`);
if (!priced) refuse('no job was priced, so "nothing else moved" would mean nothing.');
if (moved.length) refuse(`jobs that are not overhauling moved: ${moved.join(', ')}.`);
console.log(`  non-overhauling jobs moved: 0`);
console.log(`  overhauling jobs: ${overhauling.length}`);
for (const { job, b, a } of overhauling) {
  console.log(`\n  ${job.jobNo} | ${job.capacityKva} kVA | ${app.atForJob(job, ats)?.atNumber} [${app.scheduleIdForAt(app.atForJob(job, ats))}] | ${job.status || '-'}`);
  console.log(`    ${'line'.padEnd(52)}${'qty'.padEnd(6)}${'rate before'.padEnd(14)}${'rate after'.padEnd(13)}amount before -> after`);
  b.lines.forEach((l, i) => {
    const m = a.lines[i];
    console.log(`    ${`${l.itemCode} ${String(l.desc).split('\n')[0].slice(0, 44)}`.padEnd(52)}${String(l.qty).padEnd(6)}${String(l.rate).padEnd(14)}${String(m?.rate).padEnd(13)}${l.amt} -> ${m?.amt}`);
  });
  console.log(`    base ${b.d.baseTotal} -> ${a.d.baseTotal}   with ${b.d.atPercentage}%: ${b.d.finalAmount} -> ${a.d.finalAmount}`);
}

if (!APPLY) {
  console.log(`\nDRY RUN - ${toClear.length} document(s) would have row 7 cleared. Set MODE = 'apply' and pass --apply to write.`);
  process.exit(0);
}

// --- apply ---------------------------------------------------------------------------------------------------------
const failures = [];
const written = [];
for (const p of toClear) {
  const ref = db.collection(p.collection).doc(p.doc.id);
  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const section = snap.data()?.estimateMasterOverhauling;
      if (classify(section).verdict !== 'CLEAR') throw new Error('changed since it was read');
      tx.update(ref, { estimateMasterOverhauling: cleared(section) });
    });
    written.push(p);
    console.log(`  written: ${p.label}`);
  } catch (e) {
    failures.push(`${p.label}: ${e.message}`);
  }
}
for (const p of written) {
  const now = (await db.collection(p.collection).doc(p.doc.id).get()).data()?.estimateMasterOverhauling;
  const others = s => JSON.stringify((s || []).filter(r => !isRow7(r)));
  if (classify(now).verdict !== 'ALREADY CLEAR') failures.push(`${p.label}: read back, row 7 is not clear`);
  if (others(now) !== others(p.doc.estimateMasterOverhauling)) failures.push(`${p.label}: read back, another row changed`);
}
console.log(`\nAPPLIED - ${written.length} of ${toClear.length} written and read back.`);
if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log(`  ${f}`)); process.exit(1); }
process.exit(0);
