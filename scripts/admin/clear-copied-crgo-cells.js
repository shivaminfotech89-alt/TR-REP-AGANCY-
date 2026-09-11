// CLEAR EVERY COPIED CRGO CELL, AND THE TWO RESIDUE SLIPS - IN EVERY HOLDER (AUDIT O70)
//
//   node scripts/admin/clear-copied-crgo-cells.js            <- DRY RUN, writes nothing
//   node scripts/admin/clear-copied-crgo-cells.js --apply    <- writes, after MODE is changed
//
// ⚠ MODE MUST BE 'dry-run' IN THE REPOSITORY. Change it to run, change it back before committing.
// Security rules do NOT apply to the Admin SDK - see _db.js.
//
// WHAT IT CLEARS
// --------------
// In the CRGO section of public_config, system_config, every published template, every agency and every AT, a cell is
// set to null when it is:
//   - A COPY: it equals the UGVCL-2020 figure of the tender row it prices, at its capacity's band (row 21, the
//     radiator, at its exact capacity above 100 kVA). The copy test ignores it; the grid shows it as the AT's rate.
//   - ONE OF TWO RESIDUE SLIPS: 1f at 100 kVA = 230, and 11B at 100 kVA = 148.99. Wrong against both tenders (229 and
//     230 for 1f; 149 and 150 for 11B) and honoured as overrides - by Rs 1 and 1 paisa - on UGVCL-2020 ATs.
// Nothing else is written. Rows stay (a missing default row is re-added from the shipped defaults).
//
// WHAT IT LEAVES, AND WHY
// -----------------------
//   - the scrap row (22) and any row not priced from Schedule-A - priced from the master, nothing to fall through to;
//   - rows 8, 12C, 13C - clear-crgo-variant-rows.js;
//   - row 21 at 100 kVA - clear-radiator-100kva-cell.js;
//   - AT 2020-21/01/1049's rows 12A(b) and 12A(b1) - revert-at-1049-12Ab.js, which moves the agency's 213.
// Any other non-empty cell is HELD: listed, not touched.
//
// ORDER
// -----
// Pricing does not depend on it: clearing a cell never empties a section, so no read moves to another layer, and a copy
// is ignored whether it is there or not. Order decides only whether copies flow back in DURING the run, so sources are
// written before the documents they feed: shared defaults, then templates (adopted by ATs), then agencies (inherited by
// new ATs), then ATs. The shipped defaults come before all of it - deploy the defaultEstimateData change first, or any
// Estimate Master save re-adds the S.E. rows with 2020 figures. And no order protects against a grid opened before the
// run and saved after it, which is why this reports, afterwards, how many copies are left.
//
// PROOF BEFORE ANY WRITE - dry run and apply alike
// ------------------------------------------------
//   - A CONTROL THAT MUST MOVE: on a UGVCL-2020 AT holding the slips, a synthetic 100 kVA CRGO job through the APP'S OWN
//     BUILDER - 1f from 230 to 229, 11B from 148.99 to 149.
//   - A CONTROL THAT MUST NOT MOVE: on a UGVCL-2026 AT, a synthetic 25 kVA job - every line identical, while its stored
//     1a cell goes from 2061 to empty.
//   - EVERY LIVE JOB priced before and after. The only movement allowed is a 1f or 11B line at 100 kVA moving off a
//     slip to the tender. Anything else refuses the run. Zero jobs priced refuses the run.
//   - AFTERWARDS, IN MEMORY: no cell this script covers still equals its 2020 figure - the condition under which the
//     copy test can be retired without moving a price.
//   - APPLY re-reads each document in a transaction, clears only cells still exactly as classified, and reads back.

import { all, banner, db } from './_db.js';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const MODE = 'dry-run';   // 'dry-run' | 'apply'
const APPLY = MODE === 'apply' && process.argv.includes('--apply');

banner('CLEAR COPIED CRGO CELLS AND THE TWO RESIDUE SLIPS');
console.log(`MODE = '${MODE}'${APPLY ? '   ** WRITING **' : '   (dry run - nothing will be written)'}\n`);

const refuse = msg => { console.error(`\nREFUSED - ${msg}\nNothing was written.`); process.exit(2); };

// --- the app's own code, bundled outside the repository (AUDIT G62) ------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..').replace(/\\/g, '/');
const OUT = join(tmpdir(), `clear-copied-crgo-cells-${process.pid}`);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'entry.ts'), [
  `export { buildSingleJobEstimateData } from '${ROOT}/src/components/SingleJobEstimateReport';`,
  `export { SCHEDULES, scheduleIdForAt, bandForKva } from '${ROOT}/src/lib/ugvclSchedules';`,
  `export { scheduleSrForMasterCode, variantAxisForMasterCode, NOT_FROM_SCHEDULE_A } from '${ROOT}/src/lib/scheduleItemMap';`,
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
for (const k of ['buildSingleJobEstimateData', 'SCHEDULES', 'scheduleIdForAt', 'bandForKva', 'scheduleSrForMasterCode', 'variantAxisForMasterCode', 'NOT_FROM_SCHEDULE_A', 'atForJob']) {
  if (!app[k]) refuse(`the bundle has no ${k}.`);
}

// --- classification --------------------------------------------------------------------------------------------------
const S20 = app.SCHEDULES['UGVCL-2020'];
const AT_1049 = 'hzOnRqgOz37AF91dJiEn';
const SLIPS = { '1f@100': 230, '11b@100': 148.99 };

/** The 2020 figure of the tender row this cell prices, or a reason the cell is not this script's to judge. */
function judge(holderId, code, kva) {
  const c = String(code ?? '').trim(), lc = c.toLowerCase();
  if (app.NOT_FROM_SCHEDULE_A[c] !== undefined) return { leave: 'not priced from Schedule-A' };
  if (['8', '12c', '13c'].includes(lc)) return { leave: 'clear-crgo-variant-rows.js' };
  if (lc === '21' && String(kva) === '100') return { leave: 'clear-radiator-100kva-cell.js' };
  if (holderId === AT_1049 && ['12a(b)', '12a(b1)'].includes(lc)) return { leave: 'revert-at-1049-12Ab.js' };
  if (lc === '21') {
    const n = Number(kva);
    return { base: n > 100 ? S20.radiatorAbove100[n] : S20.scheduleA.find(i => i.sr === '20')?.rates[app.bandForKva(n)] };
  }
  const axis = app.variantAxisForMasterCode(c);
  if (axis) return { leave: `varies by ${axis.axis}` };
  const sr = app.scheduleSrForMasterCode(c);
  if (!sr) return { leave: 'no Schedule-A row mapped' };
  return { base: S20.scheduleA.find(i => i.sr === sr)?.rates[app.bandForKva(Number(kva))] };
}

function classify(holderId, section) {
  const clear = [], held = [], left = {};
  (section || []).forEach((r, rowIdx) => {
    for (const [kva, v] of Object.entries(r.rates || {})) {
      if (v === null || v === undefined || v === '') continue;
      const j = judge(holderId, r.itemCode, kva);
      const cell = { rowIdx, code: String(r.itemCode), kva, value: v };
      if (j.leave) { left[j.leave] = (left[j.leave] || 0) + 1; continue; }
      const slip = SLIPS[`${String(r.itemCode).toLowerCase()}@${kva}`];
      if (j.base !== undefined && Number(v) === j.base) clear.push({ ...cell, why: 'copy' });
      else if (slip !== undefined && Number(v) === slip) clear.push({ ...cell, why: 'slip' });
      else held.push({ ...cell, base: j.base });
    }
  });
  return { clear, held, left };
}
const key = c => `${c.rowIdx}|${c.kva}`;
const applyClear = (section, cells) => {
  const drop = new Set(cells.map(key));
  return section.map((r, rowIdx) => {
    const touched = Object.keys(r.rates || {}).some(k => drop.has(`${rowIdx}|${k}`));
    if (!touched) return r;
    return { ...r, rates: Object.fromEntries(Object.entries(r.rates).map(([k, v]) => [k, drop.has(`${rowIdx}|${k}`) ? null : v])) };
  });
};

// --- what is stored, in write order --------------------------------------------------------------------------------
const [agencies, ats, pubs, jobs, inspections] = await Promise.all(
  ['agencies', 'atMasters', 'published_ats', 'jobs', 'inspections'].map(c => all(c)));
const one = async (c, d) => { const s = await db.collection(c).doc(d).get(); return s.exists ? { id: d, ...s.data() } : null; };
const [publicConfig, systemConfig] = await Promise.all([one('public_config', 'estimate_master'), one('system_config', 'estimate_master')]);
const agencyName = id => agencies.find(a => a.id === id)?.name || id;

const holders = [
  ...[['public_config', publicConfig], ['system_config', systemConfig]].filter(([, d]) => d)
    .map(([collection, doc]) => ({ collection, doc, label: `shared    ${collection}/estimate_master` })),
  ...pubs.map(doc => ({ collection: 'published_ats', doc, label: `template  ${doc.atNumber || doc.name || doc.id} v${doc.version ?? '-'}` })),
  ...agencies.map(doc => ({ collection: 'agencies', doc, label: `agency    ${doc.name}` })),
  ...ats.map(doc => ({ collection: 'atMasters', doc, label: `AT        ${agencyName(doc.agencyId)} | ${doc.atNumber} [${doc.scheduleId || 'no scheduleId'}]` })),
];
const plan = holders.map(h => ({ ...h, ...classify(h.doc.id, h.doc.estimateMasterCRGO) }));

console.log(`${'holder (write order)'.padEnd(80)}${'copies'.padEnd(8)}${'slips'.padEnd(7)}held`);
for (const p of plan) {
  console.log(`${p.label.slice(0, 78).padEnd(80)}${String(p.clear.filter(c => c.why === 'copy').length).padEnd(8)}${String(p.clear.filter(c => c.why === 'slip').length).padEnd(7)}${p.held.length}`);
}
const sum = (list, f) => list.reduce((n, p) => n + f(p), 0);
for (const kind of ['shared', 'template', 'agency', 'AT']) {
  const these = plan.filter(p => p.label.startsWith(kind));
  console.log(`  ${kind.padEnd(9)} ${these.length} holder(s): copies ${sum(these, p => p.clear.filter(c => c.why === 'copy').length)}, slips ${sum(these, p => p.clear.filter(c => c.why === 'slip').length)}, held ${sum(these, p => p.held.length)}`);
}
const left = {};
plan.forEach(p => Object.entries(p.left).forEach(([k, n]) => { left[k] = (left[k] || 0) + n; }));
console.log('  left for their own reason:', Object.entries(left).map(([k, n]) => `${k} ${n}`).join('; '));
const held = plan.flatMap(p => p.held.map(c => `${p.label} - ${c.code}@${c.kva} = ${c.value} (2020 figure ${c.base ?? 'none'})`));
console.log(`\nHELD: ${held.length}`);
held.forEach(h => console.log(`  ${h}`));
const toWrite = plan.filter(p => p.clear.length);
if (!toWrite.length) { console.log('\nNo copied cell and no slip remains. Nothing to do.'); process.exit(0); }

const afterDoc = doc => { const p = toWrite.find(x => x.doc === doc); return p ? { ...doc, estimateMasterCRGO: applyClear(doc.estimateMasterCRGO, p.clear) } : doc; };
const atsAfter = ats.map(afterDoc);
const agenciesAfter = agencies.map(afterDoc);

// --- proof: the controls -------------------------------------------------------------------------------------------
console.log('\nCONTROLS - synthetic CRGO jobs through the builder, as stored and cleared');
const linesOn = (atDoc, kva) => {
  const agency = agencies.find(a => a.id === atDoc.agencyId);
  const job = { id: 'control', jobNo: 'CONTROL', capacityKva: kva, coreType: 'CRGO', atId: atDoc.id, agencyId: atDoc.agencyId, status: 'Pending' };
  const d = app.buildSingleJobEstimateData(job, agency, atDoc, { kv: '11' }, { windingType: 'AL', hvSeConductor: 'WITHOUT_SE' });
  return [...d.physicalItems, ...d.internalItems, ...d.labourItems];
};
const slipAt = ats.find(a => app.scheduleIdForAt(a) === 'UGVCL-2020' && toWrite.some(p => p.doc === a && p.clear.some(c => c.why === 'slip' && c.code.toLowerCase() === '1f'))
  && toWrite.some(p => p.doc === a && p.clear.some(c => c.why === 'slip' && c.code.toLowerCase() === '11b')));
if (!slipAt) refuse('no UGVCL-2020 AT holds both slips, so the control that must move cannot run.');
{
  const t = sr => S20.scheduleA.find(i => i.sr === sr).rates[app.bandForKva(100)];
  const b = linesOn(slipAt, 100), a = linesOn(afterDoc(slipAt), 100);
  const rate = (ls, code) => ls.find(l => String(l.itemCode) === code)?.rate;
  const checks = [['1f', 230, t('1f')], ['11B', 148.99, t('11B')]];
  for (const [code, wantBefore, wantAfter] of checks) {
    const ok = rate(b, code) === wantBefore && rate(a, code) === wantAfter;
    console.log(`  MUST MOVE     ${slipAt.atNumber} [UGVCL-2020] 100 kVA ${code}: ${rate(b, code)} -> ${rate(a, code)} (expected ${wantBefore} -> ${wantAfter})  ${ok ? 'OK' : 'FAILED'}`);
    if (!ok) refuse(`the ${code} slip control did not move as expected.`);
  }
}
const copyAt = ats.find(a => app.scheduleIdForAt(a) === 'UGVCL-2026' && toWrite.some(p => p.doc === a && p.clear.some(c => c.code === '1a' && c.kva === '25')));
if (!copyAt) refuse('no UGVCL-2026 AT holds a copied 1a at 25 kVA, so the control that must not move cannot run.');
{
  const fp = ls => JSON.stringify(ls.map(l => [l.itemCode, l.scheduleSr, l.qty, l.rate, l.amt]));
  const b = linesOn(copyAt, 25), aDoc = afterDoc(copyAt), a = linesOn(aDoc, 25);
  const storedBefore = (copyAt.estimateMasterCRGO || []).find(r => r.itemCode === '1a')?.rates?.['25'];
  const storedAfter = (aDoc.estimateMasterCRGO || []).find(r => r.itemCode === '1a')?.rates?.['25'];
  const ok = fp(b) === fp(a) && storedBefore === 2061 && storedAfter === null && b.find(l => l.itemCode === '1a')?.rate === 2079;
  console.log(`  MUST NOT MOVE ${copyAt.atNumber} [UGVCL-2026] 25 kVA: every line identical ${fp(b) === fp(a)}; 1a charged ${b.find(l => l.itemCode === '1a')?.rate}; stored 1a@25 ${storedBefore} -> ${storedAfter}  ${ok ? 'OK' : 'FAILED'}`);
  if (!ok) refuse('the copy control moved, or its stored cell did not clear.');
}

// --- proof: every live job -----------------------------------------------------------------------------------------
const ext = new Map(), int = new Map();
for (const i of inspections) {
  if (!i.jobId) continue;
  const t = String(i.type || '').toLowerCase();
  if (t === 'external') ext.set(i.jobId, i.data || {});
  else if (t === 'internal') int.set(i.jobId, i.data || {});
}
const fpl = l => JSON.stringify([l.itemCode, l.scheduleSr, l.qty, l.rate, l.amt]);
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
  const diffs = b.lines.map((l, i) => [l, a.lines[i]]).filter(([l, m]) => !m || fpl(l) !== fpl(m));
  if (!diffs.length && b.lines.length === a.lines.length && b.d.finalAmount === a.d.finalAmount) continue;
  const onlySlips = b.lines.length === a.lines.length && diffs.length && Number(job.capacityKva) === 100
    && diffs.every(([l, m]) => (String(l.itemCode) === '1f' && l.rate === 230) || (String(l.itemCode) === '11B' && l.rate === 148.99));
  (onlySlips ? allowed : moved).push(`${job.jobNo} (${job.coreType}, ${job.capacityKva} kVA): ${diffs.map(([l, m]) => `${l.itemCode} ${l.rate} -> ${m?.rate}, ${l.amt} -> ${m?.amt}`).join('; ')}; final ${b.d.finalAmount} -> ${a.d.finalAmount}`);
}
console.log(`\nEVERY LIVE JOB: ${priced} priced before and after, ${unpriceable} without an AT or agency to price against`);
if (!priced) refuse('no job was priced, so "nothing moved" would mean nothing.');
console.log(`  moved only by a slip clearing to the tender: ${allowed.length}`);
allowed.forEach(x => console.log(`    ${x}`));
if (moved.length) { moved.forEach(x => console.log(`    MOVED: ${x}`)); refuse(`${moved.length} job(s) moved in a way this change should not move them.`); }
console.log('  any other movement: 0');

// --- afterwards, in memory: can the copy test be retired? ---------------------------------------------------------
const remaining = holders.map(h => classify(h.doc.id, (toWrite.find(p => p.doc === h.doc) ? applyClear(h.doc.estimateMasterCRGO, toWrite.find(p => p.doc === h.doc).clear) : h.doc.estimateMasterCRGO)));
console.log(`\nAFTERWARDS, IN MEMORY: copies left in the cells this script covers ${sum(remaining, r => r.clear.filter(c => c.why === 'copy').length)}, slips left ${sum(remaining, r => r.clear.filter(c => c.why === 'slip').length)}`);
console.log('  Still to clear by their own scripts before the copy test can be retired: rows 8, 12C, 13C; and the moved 213 in AT 1049\'s 12A(b1) will equal its 2020 figure - an agency entry, honoured the same either way.');

if (!APPLY) {
  console.log(`\nDRY RUN - ${sum(toWrite, p => p.clear.length)} cell(s) in ${toWrite.length} document(s) would be cleared. Deploy the defaultEstimateData change first. Set MODE = 'apply' and pass --apply to write.`);
  process.exit(0);
}

// --- apply, sources first ------------------------------------------------------------------------------------------
const failures = [];
const written = [];
for (const p of toWrite) {
  const ref = db.collection(p.collection).doc(p.doc.id);
  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const section = snap.data()?.estimateMasterCRGO;
      const now = classify(p.doc.id, section);
      if (JSON.stringify(now.clear.map(key).sort()) !== JSON.stringify(p.clear.map(key).sort())) throw new Error('changed since it was read');
      tx.update(ref, { estimateMasterCRGO: applyClear(section, now.clear) });
    });
    written.push(p);
    console.log(`  written: ${p.label} (${p.clear.length} cells)`);
  } catch (e) {
    failures.push(`${p.label}: ${e.message}`);
  }
}
for (const p of written) {
  const now = (await db.collection(p.collection).doc(p.doc.id).get()).data()?.estimateMasterCRGO;
  if (classify(p.doc.id, now).clear.length) failures.push(`${p.label}: read back, cells still to clear`);
  const expected = JSON.stringify(applyClear(p.doc.estimateMasterCRGO, p.clear));
  if (JSON.stringify(now) !== expected) failures.push(`${p.label}: read back, the section is not exactly the cleared one`);
}
console.log(`\nAPPLIED - ${written.length} of ${toWrite.length} documents written and read back.`);
if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log(`  ${f}`)); process.exit(1); }
process.exit(0);
