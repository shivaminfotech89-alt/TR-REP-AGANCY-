// LIVE DATA, KEY-GATED: reads Firestore with the service-account key through scripts/admin/_db.js, read-only, and
// picks real records for each document by pricing them with the app's own builder.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, Refusal, slash } from './env.mjs';

/**
 * EVERY BARE IMPORT IS STUBBED - AND AN ABSOLUTE WINDOWS PATH IS NOT A BARE IMPORT.
 * "C:/..." starts with neither "." nor "/". Treating it as bare once stubbed the builder itself, and a comparison of
 * 77 jobs reported "0 moved" having priced nothing (AUDIT G61).
 */
const STUB = {
  name: 'stub-bare-imports',
  setup(b) {
    b.onResolve({ filter: /^[^./]|^\.\.?$/ }, a => (a.kind === 'entry-point' || /^[A-Za-z]:[\\/]/.test(a.path) ? null : { path: a.path, namespace: 'stub' }));
    b.onResolve({ filter: /(^|\/)firebase$/ }, a => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'const h={get:()=>new Proxy(function(){},h),apply:()=>undefined,construct:()=>({})};module.exports=Object.create(new Proxy({},h));',
      loader: 'js',
    }));
  },
};

async function pricing(work) {
  const dir = join(work, 'pricing');
  mkdirSync(dir, { recursive: true });
  const r = slash(REPO);
  writeFileSync(join(dir, 'entry.ts'), [
    `export { buildSingleJobEstimateData, classifyCoreType } from '${r}/src/components/SingleJobEstimateReport';`,
    `export { scheduleSetForAt, pricingModelForSchedule } from '${r}/src/lib/ugvclSchedules';`,
    `export { atForJob } from '${r}/src/lib/AgencyContext';`,
    `export { isGpJob } from '${r}/src/lib/estimateCalc';`,
  ].join('\n'));
  await build({ entryPoints: [join(dir, 'entry.ts')], bundle: true, format: 'esm', platform: 'node', outfile: join(dir, 'pricing.mjs'),
    plugins: [STUB], logLevel: 'silent', jsx: 'transform', loader: { '.tsx': 'tsx', '.ts': 'ts', '.js': 'jsx' } });
  const P = await import(pathToFileURL(join(dir, 'pricing.mjs')).href);
  for (const k of ['buildSingleJobEstimateData', 'classifyCoreType', 'scheduleSetForAt', 'pricingModelForSchedule', 'atForJob', 'isGpJob']) {
    if (typeof P[k] !== 'function') throw new Refusal(`the pricing bundle has no ${k} - selection would price nothing.`);
  }
  return P;
}

export async function loadLive(work) {
  // _db.js exits with its own message when no key is found: that is the key gate.
  const { all } = await import(pathToFileURL(join(REPO, 'scripts', 'admin', '_db.js')).href);
  const [agencies, ats, jobs, inspections] = await Promise.all(['agencies', 'atMasters', 'jobs', 'inspections'].map(c => all(c)));
  if (!jobs.length || !ats.length || !agencies.length) throw new Refusal(`read ${agencies.length} agencies, ${ats.length} ATs and ${jobs.length} jobs - there is nothing to print from.`);
  // The same maps EstimateGenerate builds: data under `data`, keyed by job, by type.
  const ext = {}, int = {};
  for (const i of inspections) {
    const type = String(i.type || '').toLowerCase();
    if (!i.jobId) continue;
    if (type === 'external') ext[i.jobId] = i.data || i;
    else if (type === 'internal') int[i.jobId] = i.data || i;
  }
  return { agencies, ats, jobs, ext, int, P: await pricing(work) };
}

const hasLetterhead = a => !!a?.letterheadUrl && (a.letterheadMode === 'full_a4' || !a.letterheadMode);
const byKey = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const pick = (maps, ids) => Object.fromEntries(ids.filter(id => maps[id]).map(id => [id, maps[id]]));

/** The cleanly priced job with the most lines on the given layout, preferring a full-A4 letterhead. */
export function pickEstimate(live, model) {
  const found = [];
  for (const j of live.jobs) {
    if (!live.ext[j.id] || !live.int[j.id] || j.status === 'Scrap') continue;
    const at = live.P.atForJob(j, live.ats);
    const agency = live.agencies.find(a => a.id === j.agencyId);
    if (!at || !agency) continue;
    if (live.P.pricingModelForSchedule(live.P.scheduleSetForAt(at), live.P.classifyCoreType(j.coreType || 'CRGO')) !== model) continue;
    const est = live.P.buildSingleJobEstimateData(j, agency, at, live.ext[j.id], live.int[j.id]);
    if (!est || (est.rateErrors || []).length) continue;
    found.push({ j, at, agency, lh: hasLetterhead(agency), n: est.physicalItems.length + est.internalItems.length + est.labourItems.length });
  }
  found.sort((a, b) => (b.lh - a.lh) || (b.n - a.n) || byKey(a.j.jobNo, b.j.jobNo));
  if (!found.length) throw new Refusal(`no live job prices cleanly on the ${model} layout, so there is nothing real to print.`);
  const { j, at, agency, lh, n } = found[0];
  return {
    label: `job ${j.jobNo} - ${agency.name}, AT ${at.atNumber}, ${n} lines, ${lh ? 'full-A4 letterhead' : 'no letterhead'}`,
    data: { job: j, at, ats: live.ats.filter(a => a.agencyId === agency.id), agency, ext: live.ext[j.id], int: live.int[j.id] },
  };
}

/** The MR with the most internal inspections. */
export function pickInspection(live) {
  const groups = new Map();
  for (const j of live.jobs) {
    if (!j.mrNo || !live.int[j.id]) continue;
    const key = `${j.agencyId}|${j.mrNo}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(j);
  }
  const [key, mrJobs] = [...groups].sort((a, b) => (b[1].length - a[1].length) || byKey(a[0], b[0]))[0] || [];
  if (!mrJobs) throw new Refusal('no MR has an internal inspection, so there is no inspection sheet to print.');
  const agency = live.agencies.find(a => a.id === mrJobs[0].agencyId);
  const dates = mrJobs.map(j => j.internalInspectionDate).filter(Boolean).sort();
  return {
    label: `MR ${mrJobs[0].mrNo} - ${agency?.name}, ${mrJobs.length} jobs, ${hasLetterhead(agency) ? 'full-A4 letterhead' : 'no letterhead'}`,
    data: { agency, mrJobs, formsData: pick(live.int, mrJobs.map(j => j.id)), selectedMrNo: mrJobs[0].mrNo, internalInspectionDate: dates[dates.length - 1] || '' },
  };
}

/** The MR with the most estimable jobs that all price cleanly, itemised, under one AT. */
export function pickMultiJob(live) {
  const groups = new Map();
  for (const j of live.jobs) {
    if (!j.mrNo) continue;
    const key = `${j.agencyId}|${j.mrNo}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(j);
  }
  const found = [];
  for (const [key, jobs] of groups) {
    const estimable = jobs.filter(j => !live.P.isGpJob(j));
    if (estimable.length < 2) continue;
    const agency = live.agencies.find(a => a.id === jobs[0].agencyId);
    const at = live.P.atForJob(estimable[0], live.ats);
    if (!agency || !at) continue;
    const clean = estimable.every(j => {
      if (!live.ext[j.id] || !live.int[j.id] || live.P.atForJob(j, live.ats)?.id !== at.id) return false;
      if (live.P.pricingModelForSchedule(live.P.scheduleSetForAt(at), live.P.classifyCoreType(j.coreType || 'CRGO')) !== 'ITEMISED') return false;
      const est = live.P.buildSingleJobEstimateData(j, agency, at, live.ext[j.id], live.int[j.id]);
      return est && !(est.rateErrors || []).length;
    });
    if (clean) found.push({ key, jobs, estimable, agency, at, lh: hasLetterhead(agency) });
  }
  found.sort((a, b) => (b.lh - a.lh) || (b.estimable.length - a.estimable.length) || byKey(a.key, b.key));
  if (!found.length) throw new Refusal('no MR has two or more estimable jobs that all price cleanly under one AT, so there is no multi-job sheet to print.');
  const { jobs, estimable, agency, at, lh } = found[0];
  const ids = jobs.map(j => j.id);
  return {
    label: `MR ${jobs[0].mrNo} - ${agency.name}, AT ${at.atNumber}, ${estimable.length} transformers, ${lh ? 'full-A4 letterhead' : 'no letterhead'}`,
    data: {
      agency, at, ats: live.ats.filter(a => a.agencyId === agency.id), jobs, mrNo: jobs[0].mrNo,
      ext: pick(live.ext, ids), int: pick(live.int, ids),
      refNo: estimable.find(j => j.estimateRefNo)?.estimateRefNo || '', division: jobs[0].division || '', signedBy: `For, ${agency.name || ''}`,
    },
  };
}
