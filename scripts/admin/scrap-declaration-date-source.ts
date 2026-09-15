/**
 * IS `createdAt` AN HONEST STAND-IN FOR A MISSING INSPECTION DATE? (AUDIT O79)
 *
 * READ-ONLY. Nothing here writes.
 *
 *     npx tsx scripts/admin/scrap-declaration-date-source.ts
 *
 * SCRAP IS DECLARED AT INTERNAL INSPECTION, so the internal inspection's own `inspectionDate`
 * IS the declaration date - not a proxy for it. That settles eight of the twelve scrap jobs.
 *
 * ⚠ THE OPEN QUESTION IS THE OTHER FOUR, whose inspections carry only a write timestamp. The
 * tempting answer is `createdAt`: the record was written when the inspection was recorded, so
 * its date should be the declaration date.
 *
 * THAT CLAIM IS TESTABLE, AND THIS TESTS IT. For every scrap job that HAS an `inspectionDate`,
 * compare it with the calendar date of `createdAt`. If they agree throughout, `createdAt` is a
 * sound fallback. **One divergence is enough to refuse it** - a record written weeks after the
 * event dates the typing, not the inspection, and the billing cutoff filters on this field.
 */
import { all, banner, toMillis } from './_db.js';
import { isScrapJob } from '../../src/lib/scrapState';

const iso = (ms: number | null) => (ms === null ? '(none)' : new Date(ms).toISOString().slice(0, 10));

banner('IS createdAt AN HONEST DECLARATION DATE? - measured against the eight that record one');

const [jobs, inspections, agencies]: any[][] = await Promise.all(
  ['jobs', 'inspections', 'agencies'].map(all));

const agName = (id: string) => agencies.find((a: any) => a.id === id)?.name || id;
const scrap = jobs.filter((j: any) => isScrapJob(j, inspections));

const rows = scrap.map((j: any) => {
  const internal: any = inspections.find((i: any) =>
    String(i.jobId ?? '') === String(j.id) && i.type === 'Internal');
  const declared = internal?.data?.inspectionDate ?? internal?.inspectionDate;
  const declaredStr = declared && String(declared).trim() ? String(declared).slice(0, 10) : null;
  const createdIso = iso(toMillis(internal?.createdAt));
  const updatedIso = iso(toMillis(internal?.updatedAt));
  return {
    job: j.jobNo || '(none)',
    agency: agName(j.agencyId),
    mr: j.mrNo || '(blank)',
    inspectionDate: declaredStr ?? '(NOT RECORDED)',
    createdAtDate: createdIso,
    updatedAtDate: updatedIso,
    agree: declaredStr === null ? '-' : (declaredStr === createdIso ? 'YES' : '** NO **'),
    gapDays: declaredStr === null || createdIso === '(none)'
      ? '-'
      : String(Math.round((Date.parse(createdIso) - Date.parse(declaredStr)) / 86400000)),
  };
});

console.table(rows);

const withDate = rows.filter(r => r.inspectionDate !== '(NOT RECORDED)');
const agreeing = withDate.filter(r => r.agree === 'YES');
const diverging = withDate.filter(r => r.agree === '** NO **');

console.log(`\n${withDate.length} scrap job(s) record an inspectionDate.`);
console.log(`   createdAt falls on the SAME day for ${agreeing.length}`);
console.log(`   and on a DIFFERENT day for ${diverging.length}`);
for (const d of diverging) {
  console.log(`      ${d.job.padEnd(11)} inspection ${d.inspectionDate}  vs  written ${d.createdAtDate}  (${d.gapDays} days)`);
}

console.log('\nVERDICT:');
if (diverging.length === 0) {
  console.log('   createdAt agreed everywhere it could be checked - it is a sound fallback.');
} else {
  console.log(`   ⚠ createdAt DIVERGES on ${diverging.length} of ${withDate.length}. It dates the TYPING, not the`);
  console.log('     inspection, so it must NOT be used for the four that record no date. Operator-typed.');
}

console.log('\nThe four with no inspectionDate:');
for (const r of rows.filter(r => r.inspectionDate === '(NOT RECORDED)')) {
  console.log(`   ${r.job.padEnd(11)} ${r.agency.padEnd(22)} MR ${String(r.mr).padEnd(8)} record written ${r.createdAtDate}`);
}
