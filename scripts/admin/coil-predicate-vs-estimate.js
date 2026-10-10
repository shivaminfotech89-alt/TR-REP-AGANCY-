// DOES `coilReplacementRecorded` AGREE WITH WHAT THE ESTIMATE ACTUALLY CHARGES? — READ-ONLY (AUDIT G114).
//
//     node scripts/admin/coil-predicate-vs-estimate.js
//
// WHY THIS EXISTS
// ---------------
// `lib/inspectionCondition.coilReplacementRecorded` decides whether a unit may be declared OH. The CHARGE for
// the same coils is computed in `buildSingleJobEstimateData`. Those are two readings of the same eleven
// inspection fields, and this file is the only thing that can prove they agree:
//
//   - the lib cannot import the estimate builder, because that module pulls in `pdfjs-dist` and needs a DOM.
//     No unit test in this repo imports it for the same reason.
//   - so a unit test can pin the field NAMES against the estimate's source text, and nothing more.
//
// This bundles the real builder out of src/ (the same trick as `price-job-under-at.js`, AUDIT G62) and runs both
// over every live internal inspection. Nothing is written.
//
// ⚠ THE PREDICATE IS DELIBERATELY WIDER THAN THE CHARGE, so disagreement in ONE direction is expected and
// correct: a damage COUNT with no weight recorded charges nothing (the estimate raises a `missing-input` error
// instead) but is still a record of coils having been changed. Refusing an OH declaration only once the weight
// is typed would let the contradiction be saved and then surface on the estimate - the wrong screen and the
// wrong person.
//
// So the failure this script looks for is the OTHER direction: the estimate charges a coil item and the
// predicate says nothing was recorded. That would let a declared-OH job carry a coil line, which is the exact
// defect G114's amendment exists to close.

import { all, banner } from './_db.js';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

banner('COIL PREDICATE vs THE ESTIMATE, OVER EVERY LIVE JOB');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..').replace(/\\/g, '/');
const OUT = join(tmpdir(), `coil-check-${process.pid}`);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'entry.ts'), [
  `export { buildSingleJobEstimateData } from '${ROOT}/src/components/SingleJobEstimateReport';`,
  `export { coilReplacementRecorded, COIL_ITEM_CODES } from '${ROOT}/src/lib/inspectionCondition';`,
].join('\n'));

await build({
  entryPoints: [join(OUT, 'entry.ts')], bundle: true, format: 'esm', platform: 'node',
  outfile: join(OUT, 'bundle.mjs'), logLevel: 'silent', jsx: 'transform',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  plugins: [{
    name: 'stub-bare-imports',
    setup(b) {
      // ⚠ An absolute Windows path is not a bare import - stubbing one stubbed the builder itself (AUDIT G61).
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
for (const k of ['buildSingleJobEstimateData', 'coilReplacementRecorded']) {
  if (!app[k]) { console.error(`\nREFUSED - the bundle has no ${k}.`); process.exit(2); }
}

const N = v => String(v ?? '').trim();
const [jobs, agencies, ats, inspections] = await Promise.all(
  [all('jobs'), all('agencies'), all('atMasters'), all('inspections')]);
const agencyById = new Map(agencies.map(a => [a.id, a]));
const atById = new Map(ats.map(a => [a.id, a]));
const COILS = new Set(app.COIL_ITEM_CODES);

let checked = 0, agree = 0, widerOnly = 0, threw = 0;
const BAD = [];

for (const job of jobs) {
  const mine = inspections.filter(i => N(i.jobId) === N(job.id));
  const internal = mine.find(i => N(i.type) === 'Internal');
  if (!internal) continue;
  const external = mine.find(i => N(i.type) === 'External');
  const at = atById.get(N(job.atId));
  const agency = agencyById.get(N(job.agencyId));
  if (!at) continue;

  checked += 1;
  const said = app.coilReplacementRecorded(internal.data);

  let charged = [];
  try {
    const d = app.buildSingleJobEstimateData(job, agency, at, external?.data, internal.data);
    charged = [].concat(d.physicalItems || [], d.internalItems || [], d.labourItems || [])
      .filter(l => COILS.has(N(l.itemCode)) && Number(l.amt ?? l.amount) > 0);
  } catch (e) {
    threw += 1;
    continue;
  }

  const estimateCharges = charged.length > 0;
  if (said.recorded === estimateCharges) agree += 1;
  else if (said.recorded && !estimateCharges) widerOnly += 1;
  else {
    // ⚠ THE ONE THAT MATTERS: money on a coil item the predicate cannot see.
    BAD.push({
      jobNo: job.jobNo,
      agency: agency?.name,
      lines: charged.map(l => `${l.itemCode} ${N(l.desc ?? l.itemName)} = ${l.amt ?? l.amount}`),
    });
  }
}

console.log(`internal inspections checked : ${checked}`);
console.log(`both agree                   : ${agree}`);
console.log(`predicate wider (expected)   : ${widerOnly}   damage recorded, no weight, so nothing is charged`);
console.log(`estimate threw               : ${threw}   (rate errors etc - not this script's question)`);
console.log(`\n⚠ ESTIMATE CHARGES A COIL ITEM THE PREDICATE MISSED : ${BAD.length}`);
for (const b of BAD) {
  console.log(`   ${N(b.jobNo).padEnd(14)} ${N(b.agency).slice(0, 20).padEnd(22)} ${b.lines.join(' | ')}`);
}

if (BAD.length) {
  console.log('\nFAILED - a declared-OH job could carry those coil lines. The mirror in');
  console.log('lib/inspectionCondition.coilReplacementRecorded has drifted from the estimate.');
  process.exit(1);
}
console.log('\nPASSED - nothing the estimate charges on a coil item is invisible to the OH refusal.');
process.exit(0);
