// WHAT WOULD THIS JOB PRICE AT UNDER A GIVEN AT? — READ-ONLY (AUDIT O72)
//
//   node scripts/admin/price-job-under-at.js <jobDocId> [<atDocId>]
//
// Prices ONE job through THE APP'S OWN BUILDER - `buildSingleJobEstimateData`, bundled out of src/ exactly as the
// clear scripts do - so the figure is the app's, not this script's. Nothing is written.
//
// WHY IT EXISTS
// -------------
// O72 asks whether stamping an AT onto a job that carries an ISSUED, PAID bill would change what its estimate
// recomputes to. A printed estimate is not stored line by line: it is rebuilt from the job, its inspections and the
// tender every time it is opened (F72). So "would the paper still match the screen" can only be answered by
// building it both ways and comparing.
//
// ⚠ IT PRINTS THE STORED FIGURES BESIDE THE COMPUTED ONE, because they are different kinds of fact: `estimateAmount`
// is what was stamped when the estimate was SENT, and the recomputation is what the screen would show today.

import { all, banner, db } from './_db.js';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const [jobId, atIdArg] = process.argv.slice(2);
if (!jobId) {
  console.error('\nusage: node scripts/admin/price-job-under-at.js <jobDocId> [<atDocId>]\n');
  process.exit(1);
}

banner('PRICE ONE JOB UNDER A CANDIDATE AT');

// --- the app's own pricing code, bundled outside the repository (AUDIT G62) ---------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..').replace(/\\/g, '/');
const OUT = join(tmpdir(), `price-job-under-at-${process.pid}`);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'entry.ts'), [
  `export { buildSingleJobEstimateData } from '${ROOT}/src/components/SingleJobEstimateReport';`,
  `export { isGpJob, getJobFullEstimate } from '${ROOT}/src/lib/estimateCalc';`,
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
for (const k of ['buildSingleJobEstimateData', 'isGpJob']) {
  if (!app[k]) { console.error(`\nREFUSED - the pricing bundle has no ${k}.`); process.exit(2); }
}

// --- the records -----------------------------------------------------------------------------------------------
const snap = await db.collection('jobs').doc(jobId).get();
if (!snap.exists) { console.error(`\nNo job ${jobId}.`); process.exit(2); }
const job = { id: snap.id, ...snap.data() };

const [agencies, ats, inspections] = await Promise.all([all('agencies'), all('atMasters'), all('inspections')]);
const agency = agencies.find(a => a.id === job.agencyId) || null;
const storedAt = job.atId ? ats.find(a => a.id === job.atId) : null;
const candidate = atIdArg ? ats.find(a => a.id === atIdArg) : null;
if (atIdArg && !candidate) { console.error(`\nNo AT ${atIdArg}.`); process.exit(2); }

const mine = inspections.filter(i => i.jobId === job.id);
const external = mine.find(i => i.type === 'External') || mine.find(i => i.data?.oilCapLtrs !== undefined) || null;
const internal = mine.find(i => i.type === 'Internal') || null;

console.log(`job ${job.jobNo}   MR ${job.mrNo}   ${job.coreType} ${job.capacityKva} kVA   ${job.division}`);
console.log(`agency ${agency?.name || '(none)'}   repairType ${job.repairType}   isGpJob(job) = ${app.isGpJob(job)}`);
console.log(`stored atId: ${job.atId || '(none)'}${storedAt ? `  -> ${storedAt.atNumber || storedAt.name}` : ''}`);
console.log(`inspections: external ${external ? 'yes' : 'NO'}, internal ${internal ? 'yes' : 'NO'}`);

console.log('\nSTORED MONEY FIELDS (what the paper says):');
for (const k of ['estimateAmount', 'estimateRefNo', 'estimateStatus', 'estimateApprovalStatus', 'estimateSentDate',
                 'billNo', 'billStatus', 'billTotalMrAmount', 'billSentDate',
                 'paidAmount', 'paymentDeductions', 'paymentRefNo', 'paymentStatus', 'approvedAmount']) {
  if (job[k] !== undefined && job[k] !== '') console.log(`  ${k.padEnd(24)} ${job[k]}`);
}

const price = (at, label) => {
  console.log(`\n=== ${label} ===`);
  let d;
  try {
    d = app.buildSingleJobEstimateData(job, agency, at, external?.data, internal?.data);
  } catch (e) {
    console.log(`  THREW: ${e && e.message ? e.message : e}`);
    return null;
  }
  const lines = [...(d.physicalItems || []), ...(d.internalItems || []), ...(d.labourItems || [])]
    .filter(l => Number(l.amount) > 0 || Number(l.qty) > 0);
  for (const l of lines) {
    console.log(`  ${String(l.itemCode ?? '').padEnd(8)} ${String(l.itemName ?? '').slice(0, 52).padEnd(54)} qty ${String(l.qty ?? '').padStart(4)}  rate ${String(l.rate ?? '').padStart(9)}  amount ${String(l.amount ?? '').padStart(10)}`);
  }
  console.log(`  ${'-'.repeat(96)}`);
  console.log(`  baseTotal ${d.baseTotal}   atPercentage ${d.atPercentage}%   +${d.percentageAmount}   less ${d.lessAmount}   FINAL ${d.finalAmount}`);
  if (d.rateErrors?.length) {
    console.log(`  ⚠ rateErrors (${d.rateErrors.length}): the total must not be trusted`);
    d.rateErrors.slice(0, 8).forEach(e => console.log(`     ${e.itemCode ?? ''} ${e.message ?? JSON.stringify(e)}`));
  }
  if (d.notices?.length) d.notices.forEach(n => console.log(`  notice: ${n}`));
  return d;
};

const asStored = price(storedAt, `AS IT STANDS TODAY - atId ${job.atId || '(none)'}`);
const asCandidate = candidate ? price(candidate, `UNDER ${candidate.atNumber || candidate.name} (${candidate.scheduleId}, ${candidate.atPercentage}%)`) : null;

console.log('\n--- COMPARISON ---------------------------------------------------------------');
const f = d => (d ? d.finalAmount : null);
console.log(`  stored estimateAmount (stamped when sent) : ${job.estimateAmount ?? '(none)'}`);
console.log(`  stored bill / paid                        : ${job.billTotalMrAmount ?? '(none)'} / ${job.paidAmount ?? '(none)'}`);
console.log(`  recomputed as it stands                   : ${f(asStored) ?? '(could not price)'}`);
if (candidate) {
  console.log(`  recomputed under the candidate AT         : ${f(asCandidate) ?? '(could not price)'}`);
  if (f(asStored) !== null && f(asCandidate) !== null) {
    const diff = Number(f(asCandidate)) - Number(f(asStored));
    console.log(`  DIFFERENCE the stamp would make           : ${diff === 0 ? 'NONE - identical' : diff}`);
  }
}
console.log('\nDone. Nothing was written.');
