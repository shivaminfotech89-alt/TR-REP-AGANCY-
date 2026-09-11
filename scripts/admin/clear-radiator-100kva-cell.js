// CLEAR THE RADIATOR'S 100 kVA CELL - A 63 kVA FIGURE HONOURED AS A 100 kVA OVERRIDE (AUDIT O66)
//
//   node scripts/admin/clear-radiator-100kva-cell.js            <- DRY RUN, writes nothing
//   node scripts/admin/clear-radiator-100kva-cell.js --apply    <- writes, after MODE is changed
//
// ⚠ MODE MUST BE 'dry-run' IN THE REPOSITORY. Change it to run, change it back before committing.
// Security rules do NOT apply to the Admin SDK - see _db.js.
//
// WHAT IT CLEARS
// --------------
// ONE CELL: the 100 kVA cell of CRGO row 21 (radiator replacement, Schedule-A Sr 20), in every AT, agency, published
// template, public_config and system_config where it holds 1248 - the 50/63/75 kVA figure. It becomes null. No other
// cell of the row, no other row, and no other field is written.
//
// WHY
// ---
// The 2020 Sr 20 at 100 kVA is 1446. A stored 1248 differs from it, so the copy test honours it as an override, and
// every 100 kVA radiator replacement on a UGVCL-2020 AT is charged Rs 198 under, per radiator. A null falls through
// to the job's own tender (1446 under 2020, 1458 under 2026). Latent when written: no live 100 kVA job records a
// damaged radiator. The shipped default row has no 100 kVA cell, so there is no code change to go with this.
//
// WHAT IT REFUSES
// ---------------
// A 100 kVA cell holding anything but 1248 or nothing, or two rows coded 21, is HELD: listed, not touched.
//
// PROOF BEFORE ANY WRITE - dry run and apply alike
// ------------------------------------------------
//   - POSITIVE CONTROL. On a UGVCL-2020 AT holding the cell, a synthetic CRGO job with one damaged radiator, priced
//     through the APP'S OWN BUILDER: at 100 kVA it must move from 1248 to the tender's 1446; at 63 kVA it must not
//     move. Otherwise the run refuses.
//   - EVERY LIVE JOB priced before and after. The only movement allowed is a 100 kVA radiator line going from 1248 to
//     the tender's figure. Any other movement refuses the run. Zero jobs priced refuses the run.
//   - APPLY re-reads each document in a transaction, writes only a cell still holding 1248, and reads back.

import { all, banner, db } from './_db.js';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const MODE = 'dry-run';   // 'dry-run' | 'apply'
const APPLY = MODE === 'apply' && process.argv.includes('--apply');

banner("CLEAR THE RADIATOR'S 100 kVA CELL");
console.log(`MODE = '${MODE}'${APPLY ? '   ** WRITING **' : '   (dry run - nothing will be written)'}\n`);

const refuse = msg => { console.error(`\nREFUSED - ${msg}\nNothing was written.`); process.exit(2); };

// --- the app's own pricing code, bundled outside the repository (AUDIT G62) ---------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..').replace(/\\/g, '/');
const OUT = join(tmpdir(), `clear-radiator-100kva-cell-${process.pid}`);
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
      // ⚠ An absolute Windows path is not a bare import - stubbing one stubbed the builder itself (AUDIT G61).
      b.onResolve({ filter: /^[^./]|^\.\.?$/ }, a => (a.kind === 'entry-point' || /^[A-Za-z]:[\\/]/.test(a.path) ? null : { path: a.path, namespace: 'stub' }));
      b.onResolve({ filter: /(^|\/)firebase$/ }, a => ({ path: a.path, namespace: 'stub' }));
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
const STALE = 1248;
const isRow21 = r => String(r?.itemCode ?? '').trim() === '21';

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
  const rows = section.filter(isRow21);
  if (rows.length === 0) return { verdict: 'NO ROW 21' };
  if (rows.length > 1) return { verdict: 'HELD', why: `${rows.length} rows coded 21` };
  const v = rows[0].rates?.['100'];
  if (v === null || v === undefined) return { verdict: 'ALREADY CLEAR' };
  if (Number(v) === STALE) return { verdict: 'CLEAR' };
  return { verdict: 'HELD', why: `row 21 holds ${v} at 100 kVA` };
}
const cleared = section => section.map(r => (isRow21(r) ? { ...r, rates: { ...r.rates, '100': null } } : r));

const plan = holders.map(h => ({ ...h, ...classify(h.doc.estimateMasterCRGO) }));
for (const verdict of ['CLEAR', 'ALREADY CLEAR', 'HELD', 'NO ROW 21', 'NO SECTION']) {
  const these = plan.filter(p => p.verdict === verdict);
  console.log(`${verdict}: ${these.length}`);
  these.forEach(p => console.log(`  ${p.label}${p.why ? `\n      ${p.why}` : ''}`));
}
const toClear = plan.filter(p => p.verdict === 'CLEAR');
if (!toClear.length) { console.log('\nNo 100 kVA radiator cell holds 1248. Nothing to do.'); process.exit(0); }

const after = doc => (toClear.some(p => p.doc === doc) ? { ...doc, estimateMasterCRGO: cleared(doc.estimateMasterCRGO) } : doc);
const atsAfter = ats.map(after);
const agenciesAfter = agencies.map(after);

// --- proof: the positive control -----------------------------------------------------------------------------------
console.log('\nPOSITIVE CONTROL - a synthetic CRGO job with one damaged radiator, cell as stored and cleared');
let controls = 0;
for (const scheduleId of Object.keys(app.SCHEDULES)) {
  const at = ats.find(a => app.scheduleIdForAt(a) === scheduleId && toClear.some(p => p.doc === a));
  if (!at) { console.log(`  ${scheduleId}: no AT on this schedule holds the cell - no control`); continue; }
  const agency = agencies.find(a => a.id === at.agencyId);
  const tender = kva => app.SCHEDULES[scheduleId].scheduleA.find(i => i.sr === '20')?.rates[app.bandForKva(kva)];
  const rateOn = (atDoc, kva) => {
    const job = { id: 'control', jobNo: 'CONTROL', capacityKva: kva, coreType: 'CRGO', atId: at.id, agencyId: at.agencyId, status: 'Pending' };
    const d = app.buildSingleJobEstimateData(job, agency, atDoc, { kv: '11', damRadNo: 1 }, { windingType: 'AL', hvSeConductor: 'WITHOUT_SE' });
    return d.physicalItems.find(l => String(l.itemCode) === '21')?.rate;
  };
  for (const [kva, wantBefore, wantAfter] of [[100, STALE, tender(100)], [63, tender(63), tender(63)]]) {
    const b = rateOn(at, kva), a = rateOn(after(at), kva);
    const ok = b === wantBefore && a === wantAfter;
    console.log(`  ${scheduleId} on ${at.atNumber}: ${kva} kVA radiator  stored ${String(b).padEnd(6)} -> cleared ${String(a).padEnd(6)} (expected ${wantBefore} -> ${wantAfter})  ${ok ? 'OK' : 'FAILED'}`);
    if (!ok) refuse(`the ${kva} kVA control on ${scheduleId} did not behave as expected.`);
  }
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
const fp = l => JSON.stringify([l.itemCode, l.scheduleSr, l.qty, l.rate, l.amt]);
const price = (job, atList, agencyList) => {
  const at = app.atForJob(job, atList);
  const agency = agencyList.find(a => a.id === job.agencyId);
  if (!at || !agency) return null;
  const d = app.buildSingleJobEstimateData(job, agency, at, ext.get(job.id), int.get(job.id));
  return { d, lines: [...d.physicalItems, ...d.internalItems, ...d.labourItems] };
};
let priced = 0, unpriceable = 0;
const moved = [], allowed = [];
for (const job of jobs) {
  let b, a;
  try { b = price(job, ats, agencies); a = price(job, atsAfter, agenciesAfter); } catch { unpriceable++; continue; }
  if (!b || !a) { unpriceable++; continue; }
  priced++;
  const diffs = b.lines.map((l, i) => [l, a.lines[i]]).filter(([l, m]) => !m || fp(l) !== fp(m));
  if (!diffs.length && b.lines.length === a.lines.length && b.d.finalAmount === a.d.finalAmount) continue;
  const onlyRadiator = b.lines.length === a.lines.length && diffs.length && Number(job.capacityKva) === 100
    && diffs.every(([l, m]) => String(l.itemCode) === '21' && l.rate === STALE && m.rate !== STALE);
  (onlyRadiator ? allowed : moved).push(`${job.jobNo} (${job.coreType}, ${job.capacityKva} kVA): ${diffs.map(([l, m]) => `${l.itemCode} ${l.rate} -> ${m?.rate}, ${l.amt} -> ${m?.amt}`).join('; ')}; final ${b.d.finalAmount} -> ${a.d.finalAmount}`);
}
console.log(`\nEVERY LIVE JOB: ${priced} priced before and after, ${unpriceable} without an AT or agency to price against`);
if (!priced) refuse('no job was priced, so "nothing moved" would mean nothing.');
console.log(`  moved by the 100 kVA radiator only: ${allowed.length}`);
allowed.forEach(x => console.log(`    ${x}`));
if (moved.length) { moved.forEach(x => console.log(`    MOVED: ${x}`)); refuse(`${moved.length} job(s) moved in a way this change should not move them.`); }
console.log('  any other movement: 0');

if (!APPLY) {
  console.log(`\nDRY RUN - ${toClear.length} document(s) would have the 100 kVA radiator cell cleared. Set MODE = 'apply' and pass --apply to write.`);
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
      const section = snap.data()?.estimateMasterCRGO;
      if (classify(section).verdict !== 'CLEAR') throw new Error('changed since it was read');
      tx.update(ref, { estimateMasterCRGO: cleared(section) });
    });
    written.push(p);
    console.log(`  written: ${p.label}`);
  } catch (e) {
    failures.push(`${p.label}: ${e.message}`);
  }
}
for (const p of written) {
  const now = (await db.collection(p.collection).doc(p.doc.id).get()).data()?.estimateMasterCRGO;
  if (classify(now).verdict !== 'ALREADY CLEAR') failures.push(`${p.label}: read back, the cell is not clear`);
  const without100 = s => JSON.stringify((s || []).map(r => (isRow21(r) ? { ...r, rates: { ...r.rates, '100': '(cell)' } } : r)));
  if (without100(now) !== without100(p.doc.estimateMasterCRGO)) failures.push(`${p.label}: read back, something other than the cell changed`);
}
console.log(`\nAPPLIED - ${written.length} of ${toClear.length} written and read back.`);
if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log(`  ${f}`)); process.exit(1); }
process.exit(0);
