// VERIFY AT 1819 PRICES FROM THE RIGHT PLACES — read from live data, not from the source.
//
// Both UGVCL-2026 ATs have zero jobs, so nothing existing exercises the 2026 path. This
// prices SYNTHETIC jobs through the app's own modules against the REAL AT documents, and
// reports what actually comes out. Nothing is written.
//
//   node scripts/admin/verify-1819.js

import { all, banner } from './_db.js';
import { build } from 'esbuild';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const OUT = join(process.cwd(), '.tmp-1819');
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'e.ts'), [
  "export { buildSingleJobEstimateData, classifyCoreType } from '../src/components/SingleJobEstimateReport';",
  "export { checkJobCircleLimit, coreTypeHasCircleLimit, scrapItemCodeForJob } from '../src/lib/estimateCalc';",
  "export { scheduleSetForAt, pricingModelForJob, hasScheduleB, SCHEDULES, scheduleProvenance } from '../src/lib/ugvclSchedules';",
  "export { getEstimateMasterForCore, getAtPercentageForCore } from '../src/lib/AgencyContext';",
].join('\n'));

const stub = { name: 'stub', setup(b) {
  b.onResolve({ filter: /^[^./]|^\.\.?$/ }, a => a.kind === 'entry-point' ? null : ({ path: a.path, namespace: 'stub' }));
  b.onResolve({ filter: /(^|\/)firebase$/ }, a => ({ path: a.path, namespace: 'stub' }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
    contents: 'const h={get:()=>new Proxy(function(){},h),apply:()=>undefined,construct:()=>({})};module.exports=Object.create(new Proxy({},h));',
    loader: 'js' }));
}};

await build({ entryPoints: [join(OUT, 'e.ts')], bundle: true, format: 'esm', platform: 'node',
  outfile: join(OUT, 'b.mjs'), plugins: [stub], logLevel: 'silent', jsx: 'transform',
  loader: { '.tsx': 'tsx', '.ts': 'ts' } });

const app = await import(pathToFileURL(join(OUT, 'b.mjs')).href);

banner('AT 1819 — is every rate in the right place?');

const [ats, ags] = await Promise.all([all('atMasters'), all('agencies')]);
const targets = ats.filter(a => String(a.atNumber || a.name || '').includes('1819'));
if (!targets.length) { console.error('  No AT with 1819 in its number.'); process.exit(1); }

const ok = (b) => b ? 'OK  ' : 'FAIL';
let fails = 0;
const check = (label, pass, detail) => { if (!pass) fails++; console.log(`    ${ok(pass)}  ${label}${detail ? '   ' + detail : ''}`); };

for (const at of targets) {
  const agency = ags.find(a => a.id === at.agencyId) || null;
  console.log(`\n  ${'='.repeat(76)}`);
  console.log(`  ${agency?.name || '?'}   AT ${at.atNumber || at.name}`);
  console.log(`  ${'='.repeat(76)}`);

  // ---- 1. schedule identity -------------------------------------------------------------
  const set = app.scheduleSetForAt(at);
  console.log('\n  SCHEDULE');
  console.log(`    stored scheduleId : ${at.scheduleId || '(unset)'}`);
  console.log(`    resolves to       : ${set.id}  "${set.label}"`);
  console.log(`    provenance        : ${app.scheduleProvenance(at, ats)}`);
  check('resolves UGVCL-2026', set.id === 'UGVCL-2026');
  check('Schedule-A row count 51', set.scheduleA.length === 51, `got ${set.scheduleA.length}`);

  // ---- 2. sample rates, as the schedule prices them -------------------------------------
  console.log('\n  SAMPLE RATES (from the resolved schedule, per band)');
  const band = (kva) => kva <= 5 ? 'B5' : kva <= 16 ? 'B10_16' : kva <= 25 ? 'B25'
    : kva <= 75 ? 'B50_63_75' : kva <= 100 ? 'B100' : 'B_ABOVE_100';
  const rate = (sr, kva) => {
    const it = set.scheduleA.find(i => i.sr === sr);
    return it ? it.rates[band(kva)] : undefined;
  };
  const samples = [
    ['1a  @ 25 KVA  (labour charge)',      rate('1a', 25),   2079],
    ['17  (sealed -> bolted)',             rate('17', 100),  1524],
    ['21  @ 63 KVA (overhauling)',         rate('21', 63),   3189],
    ['12A-b (HV coil AL, per kg)',         rate('12A-b', 100), 165],
  ];
  for (const [label, got, want] of samples) {
    console.log(`    ${label.padEnd(36)} ${String(got).padStart(8)}   expected ${want}`);
    check(label.split('(')[0].trim(), Number(got) === want, `got ${got}`);
  }

  // ---- 3. Schedule-B / pricing model per core type --------------------------------------
  console.log('\n  PRICING MODEL BY CORE TYPE');
  check('no Schedule-B on this tender', app.hasScheduleB(set) === false,
    `hasScheduleB=${app.hasScheduleB(set)}`);
  for (const core of ['CRGO', 'Amorphous', 'Wound Core', 'OH']) {
    const cls = app.classifyCoreType(core);
    const model = app.pricingModelForJob(at, cls);
    const expect = cls === 'OH' ? 'OH' : 'ITEMISED';
    console.log(`    ${core.padEnd(12)} class=${String(cls).padEnd(12)} model=${model}`);
    check(`${core} is ${expect}`, model === expect, `got ${model}`);
  }

  // ---- 4. which master section each core type reads --------------------------------------
  console.log('\n  ESTIMATE MASTER SECTION READ');
  for (const core of ['CRGO', 'Amorphous', 'Wound Core']) {
    const list = app.getEstimateMasterForCore({ at, agency }, core);
    const codes = (list || []).map(i => String(i.itemCode || '')).slice(0, 4).join(',');
    console.log(`    ${core.padEnd(12)} ${String((list || []).length).padStart(3)} rows   first codes: ${codes}`);
    check(`${core} reads a 32-row CRGO-shaped section`, (list || []).length >= 30,
      `${(list || []).length} rows`);
    check(`${core} scrap code`, app.scrapItemCodeForJob(core, at) === '22',
      `got ${app.scrapItemCodeForJob(core, at)}`);
  }

  // ---- 5. circle limits ------------------------------------------------------------------
  console.log('\n  CIRCLE LIMITS (Clause 4.0)');
  const borrowedCl = set.borrowedFrom.circleLimits;
  console.log('    borrowedFrom.circleLimits : ' + (borrowedCl || '(none)'));
  console.log(`    borrowedFrom.scheduleB    : ${set.borrowedFrom.scheduleB || '(none - absent, not borrowed)'}`);
  check('circle limits borrowed from UGVCL-2020', borrowedCl === 'UGVCL-2020', `got ${borrowedCl}`);
  check('Schedule-B is ABSENT, not borrowed', !set.borrowedFrom.scheduleB && !set.scheduleB);
  for (const core of ['CRGO', 'Amorphous', 'Wound Core']) {
    const applies = app.coreTypeHasCircleLimit(core, at);
    console.log(`    ${core.padEnd(12)} circle limit applies: ${applies}`);
    check(`${core} IS circle-limit checked under 2026`, applies === true);
  }

  // ---- 6. the AT percentage ---------------------------------------------------------------
  console.log('\n  AT PERCENTAGE (clause 2.0 says 7.00% for CRGO / Amorphous core)');
  const pcts = {
    CRGO: app.getAtPercentageForCore(at, 'CRGO'),
    Amorphous: app.getAtPercentageForCore(at, 'Amorphous'),
    'Wound Core': app.getAtPercentageForCore(at, 'Wound Core'),
  };
  for (const [k, v] of Object.entries(pcts)) {
    console.log(`    ${k.padEnd(12)} ${v}%   (stored: CRGO=${at.atPercentageCRGO ?? '-'} AM=${at.atPercentageAmorphous ?? '-'} WC=${at.atPercentageWoundCore ?? '-'})`);
    check(`${k} is 7`, Number(v) === 7, `got ${v}`);
  }

  // ---- 7. rate state ----------------------------------------------------------------------
  console.log('\n  RATE STATE');
  const SEC = ['estimateMasterCRGO','estimateMasterAmorphous','estimateMasterWoundCore','estimateMasterOverhauling','estimateMasterCircleLimits'];
  const filled = SEC.filter(s => Array.isArray(at[s]) && at[s].length > 0);
  console.log(`    ratesSource : ${at.ratesSource ?? '(none — this AT has NO rates of its own)'}`);
  console.log(`    sections    : ${filled.length}/5  ${filled.map(f => f.replace('estimateMaster','')).join(', ') || '(none)'}`);
}

rmSync(OUT, { recursive: true, force: true });
console.log(`\n  ${fails === 0 ? 'ALL CHECKS PASS' : fails + ' CHECK(S) FAILED'}\n`);
process.exit(fails === 0 ? 0 : 1);
