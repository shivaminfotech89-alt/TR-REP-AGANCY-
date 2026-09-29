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

/**
 * THE CASE THAT PRODUCED O58: the largest inspection MR, with every row carrying the longest real value of every field
 * the sheet prints - a combination no single job has, but every value is real. A fix to the sheet's pagination is
 * tested against the case that failed, not against rows that happen to fit.
 */
export function pickInspectionStress(live) {
  const base = pickInspection(live);
  const longest = vals => vals.map(v => (v == null ? '' : String(v))).reduce((a, b) => (b.length > a.length ? b : a), '');
  const inspections = Object.values(live.int);
  // As the scratch stress census that found O58 built them, plus HV S.E. (G61's column). repairType GP adds " (GP)" to
  // the job number cell - the widest form of it; WITHOUT_SE is the longest raw value and prints "Not S.E.".
  const job = {
    jobNo: longest(live.jobs.map(j => j.jobNo)), repairType: 'GP', serialNo: longest(live.jobs.map(j => j.serialNo)),
    make: longest(live.jobs.map(j => j.make)), coreType: longest(live.jobs.map(j => j.coreType)), capacityKva: longest(live.jobs.map(j => j.capacityKva)),
  };
  const FIELDS = ['windingType', 'hvCoilLimb', 'damR', 'damY', 'damB', 'totCoil', 'wtOfCoil', 'totWt', 'lvCoilR', 'lvCoilY', 'lvCoilB',
    'wtOfCoilLv', 'totWtLv', 'wasring', 'inPnt', 'tstTrn', 'dc', 'insula', 'condition', 'hvSeConductor'];
  const fields = Object.fromEntries(FIELDS.map(f => [f, longest(inspections.map(d => d[f]))]).filter(([, v]) => v !== ''));
  return {
    label: `${base.label}, every row stressed with the longest real values (serial ${job.serialNo.length}, make ${job.make.length} characters)`,
    data: {
      ...base.data,
      mrJobs: base.data.mrJobs.map(j => ({ ...j, ...job })),
      formsData: Object.fromEntries(Object.entries(base.data.formsData).map(([id, d]) => [id, { ...d, ...fields }])),
    },
  };
}

/**
 * THE EXTERNAL INSPECTION SHEET (AUDIT G102) - the same shape as the internal one, 29 columns instead of 26, and it
 * had O58's exposure without ever being measured.
 *
 * `letterhead` picks the largest MR on a full-A4 letterhead; without it, the largest on an agency that has none.
 * **Both ends of the range are real agencies here** - MEGHA carries a letterhead and ZENITH does not - so unlike the
 * internal sheet this needs no synthetic case to measure the other end.
 */
export function pickExternalInspection(live, { letterhead = true } = {}) {
  const groups = new Map();
  for (const j of live.jobs) {
    if (!j.mrNo || !live.ext[j.id]) continue;
    const key = `${j.agencyId}|${j.mrNo}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(j);
  }
  const wanted = [...groups].filter(([, js]) => {
    const a = live.agencies.find(x => x.id === js[0].agencyId);
    return hasLetterhead(a) === letterhead;
  });
  const [, mrJobs] = wanted.sort((a, b) => (b[1].length - a[1].length) || byKey(a[0], b[0]))[0] || [];
  if (!mrJobs) {
    throw new Refusal(`no MR with an external inspection belongs to an agency ${letterhead ? 'with' : 'without'} a full-A4 letterhead, so there is nothing real to print for that end of the range.`);
  }
  const agency = live.agencies.find(a => a.id === mrJobs[0].agencyId);
  const dates = mrJobs.map(j => j.externalInspectionDate).filter(Boolean).sort();
  return {
    label: `MR ${mrJobs[0].mrNo} - ${agency?.name}, ${mrJobs.length} jobs, ${hasLetterhead(agency) ? 'full-A4 letterhead' : 'no letterhead'}`,
    data: { agency, mrJobs, formsData: pick(live.ext, mrJobs.map(j => j.id)), selectedMrNo: mrJobs[0].mrNo, externalInspectionDate: dates[dates.length - 1] || '' },
  };
}

/**
 * THE EXTERNAL SHEET'S STRESS CASE - every row carrying the longest real value of every field IT prints.
 *
 * ⚠ THE FIELD LIST IS THIS SHEET'S, NOT THE INTERNAL ONE'S. Reusing pickInspectionStress's list would stress fields
 * this sheet does not print and leave its own at their short live values - a stress case that stresses nothing, which
 * is the shape of check this project keeps recording (G33, G59).
 */
export function pickExternalInspectionStress(live) {
  const base = pickExternalInspection(live);
  const longest = vals => vals.map(v => (v == null ? '' : String(v))).reduce((a, b) => (b.length > a.length ? b : a), '');
  const externals = Object.values(live.ext);
  const job = {
    jobNo: longest(live.jobs.map(j => j.jobNo)), repairType: 'GP', serialNo: longest(live.jobs.map(j => j.serialNo)),
    make: longest(live.jobs.map(j => j.make)), coreType: longest(live.jobs.map(j => j.coreType)), capacityKva: longest(live.jobs.map(j => j.capacityKva)),
    starRating: longest(live.jobs.map(j => j.starRating)), ratingLevel: longest(live.jobs.map(j => j.ratingLevel)),
  };
  // Read off the sheet's own `data.<field>` reads, not guessed: a first pass here invented twenty-two plausible
  // names and every one of them was wrong, which would have produced exactly the stress case that stresses nothing.
  const FIELDS = ['breather', 'clnDrtyTank', 'damCtTank', 'damRadNo', 'dryActPart', 'gasket', 'hvLvRod', 'hvSideHvCc',
    'hvSideHvb', 'hvSideHvm', 'kv', 'lessOilLtrs', 'lvSideLvCc', 'lvSideLvb', 'lvSideLvm', 'namePlate', 'nuteBolt',
    'oilCapLtrs', 'oilLevGls', 'outsidePaint', 'sealType', 'starRating', 'transType'];
  const fields = Object.fromEntries(FIELDS.map(f => [f, longest(externals.map(d => d[f]))]).filter(([, v]) => v !== ''));
  return {
    label: `${base.label}, every row stressed with the longest real values (serial ${job.serialNo.length}, make ${job.make.length} characters; ${Object.keys(fields).length} of ${FIELDS.length} fields present in live data)`,
    data: {
      ...base.data,
      mrJobs: base.data.mrJobs.map(j => ({ ...j, ...job })),
      formsData: Object.fromEntries(Object.entries(base.data.formsData).map(([id, d]) => [id, { ...d, ...fields }])),
    },
  };
}

/**
 * THE SAME MR WITH NO LETTERHEAD - the other end of the range a derived row count has to work across (AUDIT O64).
 *
 * The body a sheet has to spend is the page less the letterhead's header and footer reservations, so the row count
 * is an agency-by-agency figure, not a constant: on MEGHA's 64mm/25mm letterhead a sheet holds far fewer rows than
 * on none, where PrintableA4Page reserves 6mm each way and prints its own header block instead. A count derived from
 * the measured body is the reason both are right; a constant raised to suit one of them is wrong for the other.
 *
 * ⚠ THIS AGENCY IS SYNTHETIC - the live agency with its letterhead removed, not a real record. It exists to measure
 * the range, and nothing is asserted about it beyond the fit of what it prints.
 */
export function pickInspectionNoLetterhead(live) {
  const base = pickInspection(live);
  const agency = { ...base.data.agency };
  delete agency.letterheadUrl;
  delete agency.letterheadMode;
  return {
    label: `MR ${base.data.selectedMrNo} - ${base.data.agency?.name} WITH ITS LETTERHEAD REMOVED (synthetic), ${base.data.mrJobs.length} jobs`,
    data: { ...base.data, agency },
  };
}

/**
 * THE TESTING REPORT (AUDIT G103) - the last of the three fixed-count sheets, `CHUNK_SIZE = 8`.
 *
 * ⚠ ITS SELECTION IS NOT AN MR. The screen prints whatever job ids the operator has ticked, so there is no
 * `selectedMrNo` to key on. This picks the MR whose jobs carry the most `testingDetails` - which is what an operator
 * ticking a whole MR would produce - and hands the print branch that set.
 *
 * ⚠ ITS DATA IS ON THE JOB, NOT IN `inspections`. Testing values live on the job document as `testingDetails`, so a
 * job with none prints a row of defaults; those are excluded, or the sheet would measure empty rows.
 *
 * `letterhead: false` asks for the other end of the range. Live data may not have a usable deck there - the only
 * no-letterhead agency with testing data has ONE job - so it refuses rather than printing a one-row sheet and
 * calling that a measurement of pagination.
 */
export function pickTestingReport(live, { letterhead = true, minJobs = 2 } = {}) {
  const groups = new Map();
  for (const j of live.jobs) {
    if (!j.mrNo || !j.testingDetails) continue;
    if (!Object.values(j.testingDetails).some(v => v !== '' && v != null)) continue;
    const key = `${j.agencyId}|${j.mrNo}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(j);
  }
  const wanted = [...groups].filter(([, js]) => {
    const a = live.agencies.find(x => x.id === js[0].agencyId);
    return hasLetterhead(a) === letterhead && js.length >= minJobs;
  });
  const [, selected] = wanted.sort((a, b) => (b[1].length - a[1].length) || byKey(a[0], b[0]))[0] || [];
  if (!selected) {
    throw new Refusal(`no MR with at least ${minJobs} jobs carrying filled testingDetails belongs to an agency ${letterhead ? 'with' : 'without'} a full-A4 letterhead. A one-row sheet would not measure pagination, so this is a refusal rather than a thin case.`);
  }
  const agency = live.agencies.find(a => a.id === selected[0].agencyId);
  const dates = selected.map(j => j.testingDate).filter(Boolean).sort();
  return {
    label: `MR ${selected[0].mrNo} - ${agency?.name}, ${selected.length} jobs, ${hasLetterhead(agency) ? 'full-A4 letterhead' : 'no letterhead'}`,
    data: { agency, selectedJobs: selected, selectedJobIds: selected.map(j => j.id), testingDate: dates[dates.length - 1] || '' },
  };
}

/**
 * THE TESTING REPORT WITH ITS LETTERHEAD REMOVED - the other end of the range, synthetically.
 *
 * ⚠ SYNTHETIC, and only because live data leaves no choice: the one no-letterhead agency carrying testing data has a
 * single job. Nothing is asserted about this agency beyond the fit of what it prints.
 */
export function pickTestingReportNoLetterhead(live) {
  const base = pickTestingReport(live);
  const agency = { ...base.data.agency };
  delete agency.letterheadUrl;
  delete agency.letterheadMode;
  return {
    label: `MR ${base.data.selectedJobs[0].mrNo} - ${base.data.agency?.name} WITH ITS LETTERHEAD REMOVED (synthetic), ${base.data.selectedJobs.length} jobs`,
    data: { ...base.data, agency },
  };
}

/**
 * THE TESTING REPORT'S STRESS CASE - every row carrying the longest real value of every field IT prints.
 *
 * The field list is read off the sheet's own `data.<field>` reads, after G102's list of twenty-two guessed names
 * matched none of the real ones and would have produced a stress case that stressed nothing.
 */
export function pickTestingReportStress(live) {
  const base = pickTestingReport(live);
  const longest = vals => vals.map(v => (v == null ? '' : String(v))).reduce((a, b) => (b.length > a.length ? b : a), '');
  const details = live.jobs.map(j => j.testingDetails).filter(Boolean);
  const job = {
    jobNo: longest(live.jobs.map(j => j.jobNo)), serialNo: longest(live.jobs.map(j => j.serialNo)),
    division: longest(live.jobs.map(j => j.division)), mrNo: longest(live.jobs.map(j => j.mrNo)),
    capacityKva: longest(live.jobs.map(j => j.capacityKva)), coreType: longest(live.jobs.map(j => j.coreType)),
  };
  const FIELDS = ['noLoadVoltage', 'excitationCurrent', 'noLoadLoss', 'fullLoadCurrent', 'impedanceVoltage', 'loadLoss',
    'neutralCurrent', 'percentageImpedance', 'dvdfTest', 'highVoltageTest', 'insulationResistance', 'oilBdv',
    'ratioTest', 'remarks'];
  const fields = Object.fromEntries(FIELDS.map(f => [f, longest(details.map(d => d[f]))]).filter(([, v]) => v !== ''));
  return {
    label: `${base.label}, every row stressed with the longest real values (remarks ${String(fields.remarks || '').length} characters; ${Object.keys(fields).length} of ${FIELDS.length} fields present in live data)`,
    data: {
      ...base.data,
      selectedJobs: base.data.selectedJobs.map(j => ({ ...j, ...job, testingDetails: { ...j.testingDetails, ...fields } })),
    },
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
