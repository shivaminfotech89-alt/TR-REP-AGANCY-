// DO THE INLINE SCRAP TESTS AGREE WITH `scrapState.isScrapJob`? — READ-ONLY (AUDIT G120).
//
//     node scripts/admin/scrap-predicate-mirror.js
//
// Third application of the mirror pattern (see the Pattern entry at the top of AUDIT.md).
//
//   implementation A   49 inline copies of `job.status === 'Scrap' || job.condition === 'Scrap'`, spread over
//                      BillingSystem (20), DispatchChallan (15), Reports (7), EstimateGenerate (3),
//                      Dashboard (2), NewJob (1), SingleJobEstimateReport (1)
//   implementation B   `lib/scrapState.isScrapJob`, which has THREE arms: status (either spelling), condition,
//                      and an Internal inspection recording `data.condition: 'Scrap'`
//
// B is authoritative. O80 established why: `status` is a workflow STAGE and it moves on - dispatch overwrites
// it - while `condition` is an ASSESSMENT and persists, and one live unit carries the declaration ONLY in its
// inspection. The inline form has two of the three arms, so it is narrower than the rule it restates.
//
// ⚠ UNDERSTATEMENT IS THE DANGEROUS DIRECTION HERE, and it is the direction the inline form fails in. A job the
// inline test calls repairable lands on the REPAIRABLE bill. That is a different document, a different total and
// a different signature.
//
// Run BEFORE the fix, so the count is a measurement rather than a prediction.

import { all, banner } from './_db.js';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

banner('SCRAP: THE 49 INLINE TESTS vs scrapState.isScrapJob');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..').replace(/\\/g, '/');
const OUT = join(tmpdir(), `scrap-mirror-${process.pid}`);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'entry.ts'),
  `export { isScrapJob, scrapEvidence } from '${ROOT}/src/lib/scrapState';`);
await build({
  entryPoints: [join(OUT, 'entry.ts')], bundle: true, format: 'esm', platform: 'node',
  outfile: join(OUT, 'bundle.mjs'), logLevel: 'silent', loader: { '.ts': 'ts' },
});
const app = await import(pathToFileURL(join(OUT, 'bundle.mjs')).href);

const N = v => String(v ?? '').trim();
/** JSON.stringify(undefined) returns undefined, not a string - and ASU-2's `condition` is absent. */
const J = v => String(JSON.stringify(v));
const [jobs, agencies, inspections] = await Promise.all([all('jobs'), all('agencies'), all('inspections')]);
const agencyName = new Map(agencies.map(a => [a.id, a.name]));

/**
 * ⚠ THE INLINE FORM, TRANSCRIBED EXACTLY AS THE 49 SITES WRITE IT - not tidied, not normalised.
 *
 * It does `=== 'Scrap'` on raw values, with no trim and no second spelling. Writing `N(job.status) === 'Scrap'`
 * here would hide a whitespace or casing difference that the real sites are exposed to, which would make this
 * mirror agree with something the app does not do.
 */
const inlineSaysScrap = job => job.status === 'Scrap' || job.condition === 'Scrap';

const BOTH = [], ONLY_SHARED = [], ONLY_INLINE = [];
for (const job of jobs) {
  const a = inlineSaysScrap(job);
  const b = app.isScrapJob(job, inspections);
  if (a && b) BOTH.push(job);
  else if (b && !a) ONLY_SHARED.push(job);
  else if (a && !b) ONLY_INLINE.push(job);
}

console.log(`jobs                                      : ${jobs.length}`);
console.log(`both agree it is scrap                    : ${BOTH.length}`);
console.log(`both agree it is NOT scrap                : ${jobs.length - BOTH.length - ONLY_SHARED.length - ONLY_INLINE.length}`);
console.log(`\n⚠ SHARED PREDICATE SAYS SCRAP, THE 49 INLINE TESTS DO NOT : ${ONLY_SHARED.length}`);
for (const j of ONLY_SHARED) {
  const ev = app.scrapEvidence(j, inspections);
  console.log(`   ${N(j.jobNo).padEnd(10)} ${N(agencyName.get(N(j.agencyId))).slice(0, 18).padEnd(20)}`
    + ` status=${J(j.status).padEnd(14)} condition=${J(j.condition).padEnd(11)}`
    + ` matched=[${ev.matched.join(',')}]`);
  console.log(`   ${' '.repeat(10)} billStatus=${J(j.billStatus)} billNo=${J(j.billNo)}`
    + ` challanNo=${J(j.challanNo)} challanDate=${J(j.challanDate)}`
    + ` deliveryDate=${J(j.deliveryDate)}`);
}
console.log(`\n⚠ INLINE TESTS SAY SCRAP, THE SHARED PREDICATE DOES NOT : ${ONLY_INLINE.length}`);
for (const j of ONLY_INLINE) {
  console.log(`   ${N(j.jobNo).padEnd(10)} status=${J(j.status)} condition=${J(j.condition)}`);
}

// ⚠ THE SECOND SPELLING, WHICH NOTHING HAS EVER MATCHED. MrLedger offers 'Scrap / Unrepairable' in its status
// list and every scrap test in the app compares against 'Scrap'. A job saved with it today would be invisible
// to the inline form AND counted by the shared one - so it belongs in this report whether or not it occurs.
const variant = jobs.filter(j => N(j.status) === 'Scrap / Unrepairable');
console.log(`\njobs carrying the 'Scrap / Unrepairable' status variant : ${variant.length}`
  + (variant.length ? '  ' + variant.map(j => N(j.jobNo)).join(', ') : '   (none - still a live trap)'));

// Untrimmed / miscased values the inline form would miss even on its own two arms.
const looseStatus = jobs.filter(j => typeof j.status === 'string' && j.status !== N(j.status) && /scrap/i.test(j.status));
const looseCond = jobs.filter(j => typeof j.condition === 'string' && j.condition !== N(j.condition) && /scrap/i.test(j.condition));
console.log(`values needing a trim to match           : status ${looseStatus.length}, condition ${looseCond.length}`);

if (ONLY_SHARED.length > 1 || ONLY_INLINE.length > 0) {
  console.log('\n⚠ MORE THAN THE ONE EXPECTED DISAGREEMENT - report before changing anything.');
  process.exit(1);
}
console.log('\nONE disagreement, in the expected direction. Safe to consolidate onto the shared predicate.');
process.exit(0);
