// PRICING-MODEL REGRESSION: nothing existing moves, and the new branch does what it claims.
//
// WHY THIS EXISTS. Making the pricing model schedule-dependent touched eight sites across
// five files, including which estimate-master section a job reads. Every one of them prices
// money. And the change CANNOT be validated by looking at the app, because both UGVCL-2026
// ATs have zero jobs: there is nothing on screen that exercises the new branch, and nothing
// on screen that should have changed.
//
// So this does two things:
//
//   PART A - REGRESSION. Prices every live job through the REAL builder and compares the
//   total against a baseline captured before the change. Any movement is a broken 2020 job.
//   61 jobs, 17 of them Amorphous or Wound Core, all under 2020 ATs.
//
//   PART B - THE NEW BRANCH. Takes one real Amorphous job and prices it twice: once under
//   its own 2020 AT, once under a synthetic AT carrying scheduleId 'UGVCL-2026'. Asserts the
//   model flips, the line items change shape, and the circle-limit check switches on.
//
// ⚠ IT BUNDLES AND RUNS THE APP'S OWN CODE. A second implementation of the rules here would
// prove only that the copy agrees with itself - the mistake this codebase has made before
// (four scrap codes across six agencies). esbuild compiles the real modules; nothing is
// reimplemented.
//
// USAGE
//   node scripts/admin/pricing-model-regression.js --capture   writes the baseline
//   node scripts/admin/pricing-model-regression.js             compares against it
//
// Capture on the commit BEFORE the model change, compare after. The baseline file is
// committed so the comparison is reproducible.

import { all, banner } from './_db.js';
import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BASELINE = join(ROOT, 'scripts', 'admin', 'pricing-baseline.json');
const OUT = join(ROOT, '.tmp-pricing');

const CAPTURE = process.argv.includes('--capture');

banner(`PRICING MODEL ${CAPTURE ? 'BASELINE CAPTURE' : 'REGRESSION'}`);

// --- bundle the real app modules for Node -----------------------------------------------
// `--packages=external` keeps react and firebase out; nothing we call touches them at
// module scope. The entry re-exports exactly what this script needs.
mkdirSync(OUT, { recursive: true });
const ENTRY = join(OUT, 'entry.ts');
writeFileSync(ENTRY, `
export { buildSingleJobEstimateData, classifyCoreType } from '../src/components/SingleJobEstimateReport';
export { checkJobCircleLimit, coreTypeHasCircleLimit } from '../src/lib/estimateCalc';
export { pricingModelForJob, scheduleSetForAt, hasScheduleB, SCHEDULES } from '../src/lib/ugvclSchedules';
export { getEstimateMasterForCore } from '../src/lib/AgencyContext';
`);

// EVERY BARE IMPORT IS STUBBED. `packages: 'external'` was tried first and Node then
// actually loaded them - pdfjs-dist builds a DOMMatrix at module scope and died on import.
// The pricing path touches none of these packages at runtime: it is arithmetic over plain
// objects. The stub is CJS behind a Proxy so any named import resolves to a no-op rather
// than a missing-export error at bundle time.
const stubEverythingExternal = {
  name: 'stub-bare-imports',
  setup(b) {
    b.onResolve({ filter: /^[^./]|^\.\.?$/ }, args => {
      if (args.kind === 'entry-point') return null;
      return { path: args.path, namespace: 'stub' };
    });
    // AND src/lib/firebase, which is APP code but calls initializeApp at module scope.
    // Importing it would open a real connection from a script whose whole point is that it
    // writes nothing. The pricing path never touches `db` or `auth`.
    b.onResolve({ filter: /(^|\/)firebase$/ }, args => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      // ⚠ THE PROXY GOES ON THE PROTOTYPE, NOT ON module.exports.
      //
      // esbuild's interop is `__copyProps(__create(__getProtoOf(mod)), mod)`, and
      // __copyProps enumerates OWN property names. A Proxy has none to enumerate, so every
      // named import came out undefined and React.createContext blew up at module scope.
      // Setting __esModule does not help either - the importer is in node mode, which
      // bypasses that check.
      //
      // Putting the trap on the PROTOTYPE works with the helper instead of against it:
      // __getProtoOf returns the proxy, __create makes the namespace inherit from it, and
      // any property lookup - known or not - falls through the get trap to a callable stub.
      contents: 'const h={get:()=>new Proxy(function(){},h),apply:()=>undefined,construct:()=>({})};'
              + 'module.exports=Object.create(new Proxy({},h));',
      loader: 'js',
    }));
  },
};

await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(OUT, 'bundle.mjs'),
  plugins: [stubEverythingExternal],
  logLevel: 'silent',
  jsx: 'transform',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
});

const app = await import(pathToFileURL(join(OUT, 'bundle.mjs')).href);

// --- load live data ----------------------------------------------------------------------
const [jobs, agencies, ats, inspections] = await Promise.all([
  all('jobs'), all('agencies'), all('atMasters'), all('inspections'),
]);

const agencyById = new Map(agencies.map(a => [a.id, a]));
const atById = new Map(ats.map(a => [a.id, a]));
const extByJob = new Map();
const intByJob = new Map();
// ⚠ `.data`, NOT THE DOCUMENT. An inspection stores its fields under `data`, and the
// builder reads `externalData.damRadNo`, `internalData.damR` and so on directly. Passing
// the wrapper made every damage field undefined: no radiator, no coils, no dry-out - so
// every job priced down to its unconditional lines and the fingerprints were all but
// identical. The Part A comparison still held (the same impoverishment on both sides), but
// it was comparing estimates that could not see most of what the change touches, which is
// the "comparator that cannot see" trap for the second time in this file.
for (const i of inspections) {
  const m = String(i.type || '').toLowerCase().includes('ext') ? extByJob : intByJob;
  if (i.jobId) m.set(i.jobId, i.data ?? i);
}

function priceJob(job, atOverride) {
  const at = atOverride ?? atById.get(job.atId) ?? null;
  const agency = agencyById.get(job.agencyId) ?? null;
  return app.buildSingleJobEstimateData(
    job, agency, at, extByJob.get(job.id) ?? null, intByJob.get(job.id) ?? null
  );
}

// A total that survives JSON and is stable to the paisa.
const round2 = n => (Number.isFinite(Number(n)) ? Math.round(Number(n) * 100) / 100 : null);

/** Every priced line, in print order. */
const lines = est => [
  ...(est?.physicalItems || []),
  ...(est?.internalItems || []),
  ...(est?.labourItems || []),
];

function fingerprint(job) {
  let est;
  try { est = priceJob(job); }
  catch (e) { return { error: String(e && e.message || e) }; }
  return {
    baseTotal: round2(est?.baseTotal),
    amountWithPercentage: round2(est?.amountWithPercentage),
    // ⚠ THREE ARRAYS, NOT ONE `items`. The builder returns physicalItems / internalItems /
    // labourItems, and reading a field that does not exist made every job look identical -
    // a comparator that cannot see a change is worse than no comparator.
    lineCount: lines(est).length,
    rateErrors: (est?.rateErrors || []).length,
    finalAmount: round2(est?.finalAmount),
    // The codes, not the amounts: a model change shows up here first.
    codes: lines(est).map(i => String(i.itemCode ?? '')).join('|'),
  };
}

// =========================== PART A - REGRESSION ==========================================
const current = {};
for (const j of jobs) current[j.id] = fingerprint(j);

if (CAPTURE) {
  writeFileSync(BASELINE, JSON.stringify({
    capturedAt: new Date().toISOString(),
    jobCount: jobs.length,
    jobs: current,
  }, null, 2));
  console.log(`  Captured ${jobs.length} job fingerprints -> ${BASELINE}`);
  rmSync(OUT, { recursive: true, force: true });
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error('  No baseline. Run with --capture on the commit BEFORE the change.');
  rmSync(OUT, { recursive: true, force: true });
  process.exit(1);
}

const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
let moved = 0, missing = 0, added = 0;

for (const [id, was] of Object.entries(base.jobs)) {
  const now = current[id];
  if (!now) { missing++; console.log(`  GONE   job ${id}`); continue; }
  const diffs = Object.keys(was).filter(k => JSON.stringify(was[k]) !== JSON.stringify(now[k]));
  if (diffs.length) {
    moved++;
    const j = jobs.find(x => x.id === id) || {};
    const at = atById.get(j.atId);
    console.log(`\n  MOVED  ${j.jobNo || id}  (${j.coreType || '?'}, AT ${at?.atNumber || '?'}, ${at?.scheduleId || 'unset'})`);
    for (const k of diffs) console.log(`           ${k}: ${JSON.stringify(was[k])}  ->  ${JSON.stringify(now[k])}`);
  }
}
for (const id of Object.keys(current)) if (!(id in base.jobs)) added++;

console.log(`\n  PART A: ${Object.keys(base.jobs).length} baseline jobs, ${moved} moved, ${missing} gone, ${added} new since capture.`);

// =========================== PART B - THE NEW BRANCH ======================================
console.log('\n  PART B: the 2026 branch, on a synthetic AT (nothing is written).\n');

const amorphous = jobs.find(j => {
  const c = app.classifyCoreType(j.coreType || 'CRGO');
  return c === 'AMORPHOUS' && atById.get(j.atId);
});

let partB = 'SKIPPED - no Amorphous job with an AT found';
if (amorphous) {
  const realAt = atById.get(amorphous.atId);
  const at2020 = { ...realAt, scheduleId: 'UGVCL-2020' };
  const at2026 = { ...realAt, scheduleId: 'UGVCL-2026' };

  const m2020 = app.pricingModelForJob(at2020, 'AMORPHOUS');
  const m2026 = app.pricingModelForJob(at2026, 'AMORPHOUS');
  const b2020 = hasB(at2020), b2026 = hasB(at2026);
  const c2020 = app.coreTypeHasCircleLimit(amorphous.coreType, at2020);
  const c2026 = app.coreTypeHasCircleLimit(amorphous.coreType, at2026);

  const e2020 = safe(() => priceJob(amorphous, at2020));
  const e2026 = safe(() => priceJob(amorphous, at2026));

  console.log(`  job ${amorphous.jobNo || amorphous.id}  ${amorphous.coreType}  ${amorphous.capacityKva} KVA\n`);
  row('pricing model',      m2020, m2026);
  row('schedule has B',     b2020, b2026);
  row('circle limit applies', c2020, c2026);
  row('line items',         count(e2020), count(e2026));
  row('item codes',         codes(e2020), codes(e2026));
  row('base total',         round2(e2020?.baseTotal), round2(e2026?.baseTotal));

  const checks = [
    ['2020 is FIXED_RATE',            m2020 === 'FIXED_RATE'],
    ['2026 is ITEMISED',              m2026 === 'ITEMISED'],
    ['2020 has a Schedule-B',         b2020 === true],
    ['2026 has none',                 b2026 === false],
    ['2020 skips the circle limit',   c2020 === false],
    ['2026 applies it',               c2026 === true],
    ['the two price differently',     codes(e2020) !== codes(e2026)],
    ['neither throws',                !!e2020 && !!e2026],
  ];
  console.log('');
  let bad = 0;
  for (const [name, ok] of checks) { if (!ok) bad++; console.log(`    ${ok ? 'OK  ' : 'FAIL'}  ${name}`); }
  partB = bad === 0 ? 'PASS' : `${bad} FAILED`;
}

function hasB(at) { return app.hasScheduleB(app.scheduleSetForAt(at)); }
function safe(fn) { try { return fn(); } catch { return null; } }
function count(e) { return e ? lines(e).length : 'threw'; }
function codes(e) { return e ? lines(e).map(i => String(i.itemCode ?? '')).join(',') : 'threw'; }
function row(label, a, b) { console.log(`    ${String(label).padEnd(22)} 2020: ${String(a).padEnd(28)} 2026: ${b}`); }

rmSync(OUT, { recursive: true, force: true });

console.log(`\n  PART A ${moved === 0 ? 'PASS - no live job moved' : `FAIL - ${moved} moved`}`);
console.log(`  PART B ${partB}`);
process.exit(moved === 0 && partB === 'PASS' ? 0 : 1);
