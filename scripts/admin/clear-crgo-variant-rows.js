// CLEAR CRGO ROWS 8, 12C AND 13C - ONE MASTER ROW PRICED AGAINST TWO TENDER ROWS (AUDIT O66)
//
//   node scripts/admin/clear-crgo-variant-rows.js            <- DRY RUN, writes nothing
//   node scripts/admin/clear-crgo-variant-rows.js --apply    <- writes, after MODE is changed
//
// ⚠ MODE MUST BE 'dry-run' IN THE REPOSITORY. Change it to run, change it back before committing.
// Security rules do NOT apply to the Admin SDK - see _db.js.
//
// WHAT IT CLEARS
// --------------
// Three rows of the CRGO section, in every AT, agency, published template, public_config and system_config:
//
//   8    HV bushing              priced as 8-A (11 kV) or 8-B (22 kV)            stored 176   - the 11 kV figure
//   12C  HV coil winding labour  priced as 12C-a (copper) or 12C-b (aluminium)   stored 34    - the aluminium figure
//   13C  LV coil winding labour  priced as 13C-a (copper) or 13C-b (aluminium)   stored 51.75 - the 2020 aluminium figure,
//                                                                                 and 51.7 at 100 kVA in some holders
//
// A row is cleared only when every cell it holds is that figure. Every cell becomes null. The rows stay.
//
// WHY
// ---
// One cell can hold one tender row's figure. It is a correct copy for one variant, and the copy test honours it as an
// override of the other: a 22 kV bushing charged 176 against 268 / 265, copper HV winding labour 34 against 11, copper
// LV winding labour 51.75 against 17. A null falls through to the job's own variant row of its own tender. The shipped
// defaults are nulled in the same change (variantRowDefaults.test.ts), so a re-seed cannot bring the figures back.
//   - In a CRGO row an absent key reads as null (mergeDefaultRates fills with nulls, not with default figures), but every
//     key is written as null anyway, so the stored row says what it means.
//   - A DELETED row would be re-added from the defaults (withMissingDefaultsInPlace). So the rows stay.
//
// WHAT IT REFUSES
// ---------------
// A row holding any other figure, carrying a fixedRate, or sharing its code with another row is HELD: listed, not
// touched. Its holder's other rows are still cleared.
//
// PROOF BEFORE ANY WRITE - dry run and apply alike
// ------------------------------------------------
//   - POSITIVE CONTROL. On one AT of each schedule, synthetic 63 kVA CRGO jobs priced through the APP'S OWN BUILDER: the
//     wrong variant must move to its tender row (22 kV bushing; copper HV and LV labour), and the right variant must
//     not move (11 kV bushing; aluminium HV and LV labour). Otherwise the run refuses.
//   - EVERY LIVE JOB priced before and after. The only movement allowed is a 13C line going from 51.7 to 51.75, and each
//     is listed. Any other movement refuses the run. Zero jobs priced refuses the run.
//   - APPLY re-reads each document in a transaction, clears only rows still exactly as classified, and reads back.

import { all, banner, db } from './_db.js';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const MODE = 'dry-run';   // 'dry-run' | 'apply'
const APPLY = MODE === 'apply' && process.argv.includes('--apply');

banner('CLEAR CRGO ROWS 8, 12C, 13C');
console.log(`MODE = '${MODE}'${APPLY ? '   ** WRITING **' : '   (dry run - nothing will be written)'}\n`);

const refuse = msg => { console.error(`\nREFUSED - ${msg}\nNothing was written.`); process.exit(2); };

// --- the app's own pricing code, bundled outside the repository (AUDIT G62) ---------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..').replace(/\\/g, '/');
const OUT = join(tmpdir(), `clear-crgo-variant-rows-${process.pid}`);
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
const CAPS = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'];
const ROWS = {
  '8':   kva => [176],
  '12C': kva => [34],
  '13C': kva => (kva === '100' ? [51.75, 51.7] : [51.75]),
};
const CODES = Object.keys(ROWS);
const codeOf = r => String(r?.itemCode ?? '').trim().toLowerCase();
const known = r => CODES.find(c => c.toLowerCase() === codeOf(r));

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

function classifyRow(section, code) {
  const rows = section.filter(r => codeOf(r) === code.toLowerCase());
  if (rows.length === 0) return { verdict: 'ABSENT' };
  if (rows.length > 1) return { verdict: 'HELD', why: `${rows.length} rows coded ${code}` };
  const r = rows[0];
  const values = Object.entries(r.rates || {}).filter(([, v]) => v !== null && v !== undefined);
  const odd = values.filter(([k, v]) => !ROWS[code](k).includes(Number(v)));
  if (odd.length || (r.fixedRate !== null && r.fixedRate !== undefined)) {
    return { verdict: 'HELD', why: `${code} holds ${values.map(([k, v]) => `${k}:${v}`).join(' ')}  fixedRate ${r.fixedRate ?? '-'}` };
  }
  if (!values.length) return { verdict: 'ALREADY CLEAR' };
  return { verdict: 'CLEAR', note: values.some(([, v]) => Number(v) === 51.7) ? '51.7 at 100 kVA' : '' };
}
const classify = section => (!Array.isArray(section) || !section.length
  ? { verdict: 'NO SECTION', rows: {} }
  : (rows => ({ verdict: CODES.some(c => rows[c].verdict === 'CLEAR') ? 'CLEAR' : 'NOTHING TO CLEAR', rows }))(
      Object.fromEntries(CODES.map(c => [c, classifyRow(section, c)]))));
const cleared = (section, rows) => section.map(r => {
  const c = known(r);
  return c && rows[c]?.verdict === 'CLEAR'
    ? { ...r, rates: Object.fromEntries([...new Set([...CAPS, ...Object.keys(r.rates || {})])].map(k => [k, null])) }
    : r;
});

const plan = holders.map(h => ({ ...h, ...classify(h.doc.estimateMasterCRGO) }));
const summary = p => CODES.map(c => `${c} ${p.rows[c]?.verdict ?? '-'}${p.rows[c]?.note ? ` (${p.rows[c].note})` : ''}`).join('  ·  ');
for (const verdict of ['CLEAR', 'NOTHING TO CLEAR', 'NO SECTION']) {
  const these = plan.filter(p => p.verdict === verdict);
  console.log(`${verdict}: ${these.length}`);
  these.forEach(p => {
    console.log(`  ${p.label}${verdict === 'NO SECTION' ? '' : `\n      ${summary(p)}`}`);
    CODES.filter(c => p.rows[c]?.why).forEach(c => console.log(`      HELD: ${p.rows[c].why}`));
  });
}
const held = plan.flatMap(p => CODES.filter(c => p.rows[c]?.verdict === 'HELD').map(c => `${p.label} row ${c}`));
console.log(`rows held: ${held.length}`);
const legacy = holders.filter(h => Array.isArray(h.doc.estimateMaster) && h.doc.estimateMaster.length);
console.log(`(legacy pre-sections estimateMaster present on ${legacy.length} holder(s) - unreachable while a CRGO section exists; not touched)`);
const toClear = plan.filter(p => p.verdict === 'CLEAR');
if (!toClear.length) { console.log('\nNothing holds these figures. Nothing to do.'); process.exit(0); }

const after = doc => { const p = toClear.find(x => x.doc === doc); return p ? { ...doc, estimateMasterCRGO: cleared(doc.estimateMasterCRGO, p.rows) } : doc; };
const atsAfter = ats.map(after);
const agenciesAfter = agencies.map(after);

// --- proof: the positive control -----------------------------------------------------------------------------------
console.log('\nPOSITIVE CONTROL - synthetic 63 kVA CRGO jobs, rows as stored and cleared');
let controls = 0;
for (const scheduleId of Object.keys(app.SCHEDULES)) {
  const at = ats.find(a => app.scheduleIdForAt(a) === scheduleId && toClear.some(p => p.doc === a && CODES.every(c => p.rows[c].verdict === 'CLEAR')));
  if (!at) { console.log(`  ${scheduleId}: no AT on this schedule holds all three rows - no control`); continue; }
  const agency = agencies.find(a => a.id === at.agencyId);
  const tender = sr => app.SCHEDULES[scheduleId].scheduleA.find(i => i.sr === sr)?.rates[app.bandForKva(63)];
  const rateOn = (atDoc, kv, mat, code) => {
    const job = { id: 'control', jobNo: 'CONTROL', capacityKva: '63', coreType: 'CRGO', atId: at.id, agencyId: at.agencyId, status: 'Pending' };
    const d = app.buildSingleJobEstimateData(job, agency, atDoc, { kv }, { windingType: mat, hvSeConductor: 'WITHOUT_SE' });
    return [...d.physicalItems, ...d.internalItems, ...d.labourItems].find(l => String(l.itemCode) === code)?.rate;
  };
  const checks = [
    ['22 kV bushing (wrong variant)', '22', 'AL', '8', 176, tender('8-B')],
    ['11 kV bushing (right variant)', '11', 'AL', '8', tender('8-A'), tender('8-A')],
    ['copper HV labour (wrong variant)', '11', 'CU', '12C', 34, tender('12C-a')],
    ['aluminium HV labour (right variant)', '11', 'AL', '12C', tender('12C-b'), tender('12C-b')],
    ['copper LV labour (wrong variant)', '11', 'CU', '13C', 51.75, tender('13C-a')],
    ['aluminium LV labour (right variant)', '11', 'AL', '13C', tender('13C-b'), tender('13C-b')],
  ];
  for (const [what, kv, mat, code, wantBefore, wantAfter] of checks) {
    const b = rateOn(at, kv, mat, code), a = rateOn(after(at), kv, mat, code);
    const ok = b === wantBefore && a === wantAfter;
    console.log(`  ${scheduleId} on ${at.atNumber}: ${what.padEnd(36)} stored ${String(b).padEnd(6)} -> cleared ${String(a).padEnd(6)} (expected ${wantBefore} -> ${wantAfter})  ${ok ? 'OK' : 'FAILED'}`);
    if (!ok) refuse(`the control "${what}" on ${scheduleId} did not behave as expected.`);
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
  const only51 = b.lines.length === a.lines.length && diffs.length
    && diffs.every(([l, m]) => String(l.itemCode) === '13C' && l.rate === 51.7 && m.rate === 51.75);
  (only51 ? allowed : moved).push(`${job.jobNo} (${job.coreType}, ${job.capacityKva} kVA): ${diffs.map(([l, m]) => `${l.itemCode} ${l.rate} -> ${m?.rate}, ${l.amt} -> ${m?.amt}`).join('; ')}; final ${b.d.finalAmount} -> ${a.d.finalAmount}`);
}
console.log(`\nEVERY LIVE JOB: ${priced} priced before and after, ${unpriceable} without an AT or agency to price against`);
if (!priced) refuse('no job was priced, so "nothing moved" would mean nothing.');
console.log(`  moved by 13C 51.7 -> 51.75 only: ${allowed.length}`);
allowed.forEach(x => console.log(`    ${x}`));
if (moved.length) { moved.forEach(x => console.log(`    MOVED: ${x}`)); refuse(`${moved.length} job(s) moved in a way this change should not move them.`); }
console.log('  any other movement: 0');

if (!APPLY) {
  console.log(`\nDRY RUN - ${toClear.length} document(s) would have rows cleared. Set MODE = 'apply' and pass --apply to write.`);
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
      const now = classify(section);
      if (CODES.some(c => now.rows[c]?.verdict !== p.rows[c]?.verdict)) throw new Error('changed since it was read');
      tx.update(ref, { estimateMasterCRGO: cleared(section, now.rows) });
    });
    written.push(p);
    console.log(`  written: ${p.label}`);
  } catch (e) {
    failures.push(`${p.label}: ${e.message}`);
  }
}
for (const p of written) {
  const now = (await db.collection(p.collection).doc(p.doc.id).get()).data()?.estimateMasterCRGO;
  const back = classify(now);
  CODES.filter(c => p.rows[c].verdict === 'CLEAR' && back.rows[c]?.verdict !== 'ALREADY CLEAR')
    .forEach(c => failures.push(`${p.label}: read back, row ${c} is not clear`));
  const others = s => JSON.stringify((s || []).filter(r => !known(r)));
  if (others(now) !== others(p.doc.estimateMasterCRGO)) failures.push(`${p.label}: read back, another row changed`);
}
console.log(`\nAPPLIED - ${written.length} of ${toClear.length} written and read back.`);
if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log(`  ${f}`)); process.exit(1); }
process.exit(0);
