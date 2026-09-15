/**
 * WHEN WAS SCRAP DECLARED? — what the database actually records, for the twelve scrap jobs.
 *
 * READ-ONLY. Nothing here writes.
 *
 *     npx tsx scripts/admin/scrap-declaration-dates.ts
 *
 * THE QUESTION THAT DECIDES A FEATURE: the retained-oil model dates the scrap oil receipt from
 * the day scrap was declared, and the billing cutoff filters on that date - so a receipt dated
 * from a PROXY is a receipt dated wrongly, and it lands on the wrong bill. Before anything is
 * built: does anything store WHEN the condition became Scrap, or only that it IS Scrap?
 *
 * ⚠ THIS DUMPS EVERY DATE-SHAPED FIELD RATHER THAN THE ONES EXPECTED. Looking only for a field
 * named `scrapDate` would confirm its absence and miss whatever is actually there. Every key
 * matching /date|_at$|At$|time/i is printed with its value, on the job AND on its inspections,
 * so the report describes the records rather than my expectation of them.
 */
import { all, banner, fmtDate } from './_db.js';

banner('SCRAP DECLARATION DATES — what is recorded, and what would be a proxy');

// ⚠ `any[]`, DELIBERATELY - see unassigned-oil-contribution.ts.
const [agencies, jobs, inspections]: any[][] = await Promise.all(
  ['agencies', 'jobs', 'inspections'].map(all));

const agName = (id: string) => agencies.find((a: any) => a.id === id)?.name || id;
const internal = inspections.filter((i: any) => i.type === 'Internal');
const external = inspections.filter((i: any) => i.type === 'External' || !i.type);

function scrapMarks(job: any): string[] {
  const marks: string[] = [];
  if (job.status === 'Scrap') marks.push('status');
  if (job.status === 'Scrap / Unrepairable') marks.push('status/unrep');
  if (job.condition === 'Scrap') marks.push('condition');
  if (internal.some((i: any) => String(i.jobId ?? '') === String(job.id) && i?.data?.condition === 'Scrap')) marks.push('inspection');
  return marks;
}

const isDateKey = (k: string) => /date|_at$|At$|time/i.test(k);
const show = (v: any) => {
  if (v === null || v === undefined || v === '') return '(empty)';
  if (typeof v === 'object') return fmtDate(v);
  return String(v);
};

const scrap = jobs.map((j: any) => ({ j, marks: scrapMarks(j) })).filter((r: any) => r.marks.length);
console.log(`${scrap.length} scrap job(s)\n`);

// ---------------------------------------------------------------- what exists at all

const jobKeys = new Set<string>();
const inspKeys = new Set<string>();
const inspDataKeys = new Set<string>();
for (const { j } of scrap) {
  Object.keys(j).filter(isDateKey).forEach(k => jobKeys.add(k));
  for (const i of internal.filter((x: any) => String(x.jobId ?? '') === String(j.id))) {
    Object.keys(i).filter(isDateKey).forEach(k => inspKeys.add(k));
    Object.keys(i.data || {}).filter(isDateKey).forEach(k => inspDataKeys.add(k));
  }
}
console.log('date-shaped fields present on these JOBS            :', [...jobKeys].sort().join(', ') || '(none)');
console.log('date-shaped fields on their INTERNAL inspections    :', [...inspKeys].sort().join(', ') || '(none)');
console.log('  ...and inside inspection.data                     :', [...inspDataKeys].sort().join(', ') || '(none)');
console.log('\nAnything named for SCRAP specifically              :',
  [...jobKeys, ...inspKeys, ...inspDataKeys].filter(k => /scrap/i.test(k)).join(', ') || '(NONE)');

// ---------------------------------------------------------------- per job

console.log('\n================ EACH SCRAP JOB ================\n');
for (const { j, marks } of scrap) {
  const ins = internal.filter((i: any) => String(i.jobId ?? '') === String(j.id));
  const ext = external.filter((i: any) => String(i.jobId ?? '') === String(j.id));
  console.log(`${(j.jobNo || '(none)').padEnd(11)} ${agName(j.agencyId).padEnd(28)} MR ${String(j.mrNo || '-').padEnd(8)} scrap by: ${marks.join('+')}`);
  console.log(`   job.status=${show(j.status)}   job.condition=${show(j.condition)}`);
  for (const k of [...jobKeys].sort()) {
    if (k in j) console.log(`   job.${k.padEnd(26)} ${show(j[k])}`);
  }
  if (!ins.length) console.log('   (NO internal inspection record)');
  for (const i of ins) {
    console.log(`   internal inspection ${String(i.id).slice(0, 8)}  data.condition=${show(i?.data?.condition)}`);
    for (const k of [...inspKeys].sort()) if (k in i) console.log(`      insp.${k.padEnd(23)} ${show(i[k])}`);
    for (const k of [...inspDataKeys].sort()) if (k in (i.data || {})) console.log(`      insp.data.${k.padEnd(18)} ${show(i.data[k])}`);
  }
  for (const i of ext) {
    const d = i?.data?.inspectionDate ?? i?.inspectionDate;
    console.log(`   external inspection ${String(i.id).slice(0, 8)}  inspectionDate=${show(d)}`);
  }
  console.log('');
}
