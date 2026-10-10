// DOES EVERY BANDED LINE PRICE AT THE JOB'S OWN BAND? — READ-ONLY (AUDIT G119).
//
//     node scripts/admin/band-rates-vs-schedule.js
//
// The second application of the mirror pattern (see the Pattern entry at the top of AUDIT.md): one rule, two
// implementations, verified by RUNNING both over live records rather than by grepping either.
//
//   implementation A   `buildSingleJobEstimateData` -> `resolveRate(masterCode, scheduleRateFor(code))`
//   implementation B   this file: `bandForKva(job.capacityKva)` indexed straight into the job's own schedule
//
// B is authoritative about which BAND applies. A is authoritative about the rate, because it also consults the
// agency's estimate master. So a disagreement is only a defect when the master did not override - which is why
// the master cell is printed beside every mismatch instead of being inferred.
//
// ⚠ IT TESTS ONLY THE ITEMS WHOSE BANDS DIFFER. A flat item (`flat(54)`) prices identically at every band, so
// it cannot reveal a band slip and its agreement proves nothing. Nine Schedule-A rows have a B2 figure that
// differs from their B4 figure; those are the whole test.
//
// ⚠ ONE JOB PER BAND IS NOT ENOUGH, SO IT RUNS EVERY JOB. The bands present in live data are uneven - 2 jobs at
// B1, 96 at B2, 48 at B3, 67 at B4, 30 at B5, 14 at B6 - and a single sample per band would miss a slip that
// only happens on one tender or one agency.

import { all, banner } from './_db.js';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

banner('BANDED RATES: WHAT THE ESTIMATE CHARGES vs THE JOB\'S OWN BAND');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..').replace(/\\/g, '/');
const OUT = join(tmpdir(), `band-check-${process.pid}`);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'entry.ts'), [
  `export { buildSingleJobEstimateData } from '${ROOT}/src/components/SingleJobEstimateReport';`,
  `export { bandForKva, scheduleSetForAt } from '${ROOT}/src/lib/ugvclSchedules';`,
  `export { SCHEDULE_ITEM_MAP } from '${ROOT}/src/lib/scheduleItemMap';`,
  `export { pricingModelForJob } from '${ROOT}/src/lib/ugvclSchedules';`,
  `export { classifyCoreType } from '${ROOT}/src/components/SingleJobEstimateReport';`,
].join('\n'));

await build({
  entryPoints: [join(OUT, 'entry.ts')], bundle: true, format: 'esm', platform: 'node',
  outfile: join(OUT, 'bundle.mjs'), logLevel: 'silent', jsx: 'transform',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  plugins: [{
    name: 'stub-bare-imports',
    setup(b) {
      b.onResolve({ filter: /^[^./]|^\.\.?$/ }, a =>
        (a.kind === 'entry-point' || /^[A-Za-z]:[\\/]/.test(a.path) ? null : { path: a.path, namespace: 'stub' }));
      b.onResolve({ filter: /(^|\/)firebase$/ }, a => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'const h={get:()=>new Proxy(function(){},h),apply:()=>undefined,construct:()=>({})};module.exports=Object.create(new Proxy({},h));',
        loader: 'js',
      }));
    },
  }],
});
const app = await import(pathToFileURL(join(OUT, 'bundle.mjs')).href);

const N = v => String(v ?? '').trim();
const [jobs, agencies, ats, inspections] = await Promise.all(
  [all('jobs'), all('agencies'), all('atMasters'), all('inspections')]);
const agencyById = new Map(agencies.map(a => [a.id, a]));
const atById = new Map(ats.map(a => [a.id, a]));

/** master item code -> Schedule-A sr, for the rows whose bands are not flat. Variant rows are skipped. */
const SR_FOR = new Map();
for (const e of app.SCHEDULE_ITEM_MAP) if (e.sr) SR_FOR.set(N(e.masterCode).toLowerCase(), N(e.sr));

// Which schedule rows actually vary by band? Taken from the schedule itself, never listed by hand.
function bandedRows(set) {
  const out = new Map();
  for (const row of set.scheduleA || []) {
    const r = row.rates;
    const vals = new Set([r.B5, r.B10_16, r.B25, r.B50_63_75, r.B100, r.B_ABOVE_100]);
    if (vals.size > 1) out.set(N(row.sr), r);
  }
  return out;
}

const bandCount = {};
let priced = 0, lines = 0, agree = 0, master = 0, flatSkip = 0, fixedSkip = 0;
const MISMATCH = [];

for (const job of jobs) {
  const at = atById.get(N(job.atId));
  if (!at) continue;
  const agency = agencyById.get(N(job.agencyId));
  const mine = inspections.filter(i => N(i.jobId) === N(job.id));
  const ext = mine.find(i => N(i.type) === 'External');
  const int = mine.find(i => N(i.type) === 'Internal');
  if (!int && !ext) continue;

  const kva = Number(job.capacityKva);
  if (!Number.isFinite(kva) || kva <= 0) continue;

  /**
   * ⚠ FIXED-RATE JOBS ARE EXCLUDED, AND THE FIRST RUN OF THIS SCRIPT PROVED WHY. It reported 7 mismatches -
   * figures like 10148, 17970, 8395 against a Schedule-A band of 344 or 57 - all on Amorphous and Wound Core
   * jobs under UGVCL-2020, which has a Schedule-B. Those jobs do not price from Schedule-A at all; their item
   * codes merely COLLIDE with Schedule-A sr numbers ('1b', '1c', '1e', '1f'), so mapping them through
   * SCHEDULE_ITEM_MAP and comparing against a band compared two unrelated rate tables.
   *
   * That was a false positive in the CHECK, not a defect in the app - and it is the failure mode this script
   * exists to avoid, so it is recorded here rather than quietly filtered.
   */
  const model = app.pricingModelForJob(at, app.classifyCoreType(N(job.coreType) || 'CRGO'));
  if (model !== 'ITEMISED') { fixedSkip += 1; continue; }

  const band = app.bandForKva(kva);
  bandCount[band] = (bandCount[band] || 0) + 1;

  const set = app.scheduleSetForAt(at);
  const banded = bandedRows(set);

  let d;
  try { d = app.buildSingleJobEstimateData(job, agency, at, ext?.data, int?.data); }
  catch { continue; }
  priced += 1;

  const all3 = [].concat(d.physicalItems || [], d.internalItems || [], d.labourItems || []);
  for (const l of all3) {
    const code = N(l.itemCode).toLowerCase();
    const rate = Number(l.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const sr = SR_FOR.get(code);
    if (!sr) continue;
    const rates = banded.get(sr);
    if (!rates) { flatSkip += 1; continue; }   // flat row: proves nothing about bands
    lines += 1;

    const want = Number(rates[band]);
    if (rate === want) { agree += 1; continue; }

    // Did the agency's master override it? Print the cell rather than assume.
    const masterRows = (at.estimateMasterCRGO && at.estimateMasterCRGO.length ? at.estimateMasterCRGO
      : agency?.estimateMasterCRGO) || [];
    const row = masterRows.find(r => N(r.itemCode).toLowerCase() === code);
    const cell = row?.rates ? row.rates[String(kva)] : undefined;
    const overrode = cell !== undefined && cell !== null && Number(cell) === rate;
    if (overrode) { master += 1; continue; }

    // Which band WOULD have produced this figure? That is the diagnosis.
    const from = Object.keys(rates).filter(b => Number(rates[b]) === rate);
    MISMATCH.push({
      jobNo: N(job.jobNo), agency: N(agency?.name), kva, band, code, sr,
      charged: rate, want, from, cell,
      at: N(at.atNumber || at.name), schedule: N(at.scheduleId),
    });
  }
}

console.log('jobs priced                       :', priced);
console.log('band distribution                 :', JSON.stringify(bandCount));
console.log('banded lines compared             :', lines);
console.log('  agree with the job\'s own band   :', agree);
console.log('  agency master overrode the rate :', master);
console.log('flat lines skipped (prove nothing):', flatSkip);
console.log('fixed-rate jobs skipped           :', fixedSkip, ' (Schedule-B; they never read Schedule-A)');
console.log(`\n⚠ CHARGED A RATE THAT IS NOT THIS JOB'S BAND : ${MISMATCH.length}`);

if (MISMATCH.length) {
  console.log('\n  job        agency               kVA band        item sr   charged     want  looks like   master cell');
  for (const m of MISMATCH.slice(0, 60)) {
    console.log(`  ${m.jobNo.padEnd(10)} ${m.agency.slice(0, 20).padEnd(20)} ${String(m.kva).padStart(4)} `
      + `${m.band.padEnd(12)} ${m.code.padEnd(4)} ${m.sr.padEnd(4)} `
      + `${String(m.charged).padStart(9)} ${String(m.want).padStart(8)}  ${(m.from.join('/') || '(no band)').padEnd(12)} ${JSON.stringify(m.cell)}`);
  }
  if (MISMATCH.length > 60) console.log(`  … and ${MISMATCH.length - 60} more`);
  // If every mismatch "looks like" the same wrong band, the cause is systematic rather than per-agency.
  const shapes = {};
  for (const m of MISMATCH) { const k = m.from.join('/') || '(no band)'; shapes[k] = (shapes[k] || 0) + 1; }
  console.log('\n  which band the charged figure came from:');
  for (const [k, v] of Object.entries(shapes).sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(5)}  ${k}`);
  process.exit(1);
}
console.log('\nPASSED - every banded line priced at its own job\'s band, or was overridden by a master cell.');
process.exit(0);
