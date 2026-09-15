/**
 * CAN A SCRAP ADJUSTMENT BE WRITTEN FOR EVERY SCRAP JOB? — the rules say not always (AUDIT O79).
 *
 * READ-ONLY. Nothing here writes.
 *
 *     npx tsx scripts/admin/scrap-at-coverage.ts
 *
 * ⚠ `firestore.rules:535` REQUIRES `hasTender(incoming())` ON CREATE, and `hasTender` (`:139-141`)
 * demands a non-empty `atId`. A scrap adjustment takes its tender from the JOB - the adjustment
 * belongs to the tender the unit was booked under, not to whatever is selected today - so a
 * scrap job carrying no `atId` cannot have one written at all. The rules refuse it, and the
 * picker must say so rather than offering a row whose save fails.
 *
 * A job naming a tender that no longer exists is the same problem by another route: the id is
 * present so the rule passes, but nothing resolves it.
 *
 * This also reports whether any oil transaction already carries a `jobId`, since that field is
 * what would mark a job as already adjusted - and a pre-existing one would change what "already
 * adjusted" means before the feature ships.
 */
import { all, banner } from './_db.js';
import { isScrapJob, scrapEvidence, scrapCounts } from '../../src/lib/scrapState';

banner('SCRAP JOBS vs THE TENDER THE RULES REQUIRE');

const [jobs, inspections, ats, txns, agencies]: any[][] = await Promise.all(
  ['jobs', 'inspections', 'atMasters', 'oilTransactions', 'agencies'].map(all));

const agName = (id: string) => agencies.find((a: any) => a.id === id)?.name || id;
const scrap = jobs.filter((j: any) => isScrapJob(j, inspections));

const counts = scrapCounts(jobs, inspections);
console.log(`scrap jobs: ${scrap.length} of ${counts.total}`);
console.log(`   by status ${counts.byStatus}  ·  by condition ${counts.byCondition}`
  + `  ·  by inspection ${counts.byInspection}  ·  widest ${counts.any}\n`);

const noAt = scrap.filter((j: any) => !String(j.atId ?? '').trim());
console.log(`⚠ scrap jobs with NO atId - the rules would REFUSE an adjustment: ${noAt.length}`);
for (const j of noAt) {
  console.log(`      ${String(j.jobNo || '(none)').padEnd(11)} MR ${String(j.mrNo || '-').padEnd(8)} ${agName(j.agencyId)}`);
}

const missingAt = scrap.filter((j: any) => {
  const id = String(j.atId ?? '').trim();
  return id !== '' && !ats.some((a: any) => a.id === id);
});
console.log(`\n⚠ scrap jobs naming a tender that no longer exists: ${missingAt.length}`);
for (const j of missingAt) {
  console.log(`      ${String(j.jobNo || '(none)').padEnd(11)} atId ${j.atId}`);
}

const already = txns.filter((t: any) => String(t.jobId ?? '').trim());
console.log(`\noil transactions already carrying a jobId: ${already.length}`);

const noAvailable = scrap.filter((j: any) => {
  const insp: any = inspections.find((i: any) =>
    String(i.jobId ?? '') === String(j.id) && (i.type === 'External' || !i.type));
  const stored = insp?.data?.oilAvailable;
  return stored === undefined || stored === null || String(stored).trim() === '';
});
console.log(`\nscrap jobs with no stored oilAvailable - quantity would have to be derived: ${noAvailable.length}`);
for (const j of noAvailable) {
  console.log(`      ${String(j.jobNo || '(none)').padEnd(11)} MR ${String(j.mrNo || '-').padEnd(8)} ${agName(j.agencyId)}`);
}

console.log('\nEvidence per job, for the picker\'s provenance column:');
for (const j of scrap) {
  const e = scrapEvidence(j, inspections);
  console.log(`   ${String(j.jobNo || '(none)').padEnd(11)} ${agName(j.agencyId).padEnd(28)}`
    + ` atId ${String(j.atId ?? '').trim() ? 'yes' : 'NO '}   matched: ${e.matched.join('+')}`);
}

/**
 * THE ROWS THE SCRAP TAB WILL RENDER, PRINTED HERE TOO (AUDIT F87/O79).
 *
 * ⚠ THE SAME COLUMNS THE SCREEN SHOWS, SO THE TWO CAN BE COMPARED OUT LOUD. A script and a
 * screen measuring one thing by different means, never printed side by side, is the shape this
 * audit keeps recording. If a row here disagrees with the list, that is the bug.
 *
 * ⚠ THE DATE IS SHOWN EXACTLY AS THE LIST MUST SHOW IT: the INTERNAL inspection's own
 * `inspectionDate` where one exists, and `(not recorded)` where it does not - never a write
 * timestamp, never the external inspection's date, never today. Nothing stores WHEN scrap was
 * declared, so a proxy dressed as a date is the one thing this column must not do.
 */
console.log('\n================ THE ROWS THE SCRAP TAB WILL SHOW ================\n');
const rows = scrap.map((j: any) => {
  const internal: any = inspections.find((i: any) =>
    String(i.jobId ?? '') === String(j.id) && i.type === 'Internal');
  const ext: any = inspections.find((i: any) =>
    String(i.jobId ?? '') === String(j.id) && (i.type === 'External' || !i.type));
  const declared = internal?.data?.inspectionDate ?? internal?.inspectionDate;
  const available = ext?.data?.oilAvailable;
  const adjustment = txns.find((t: any) => String(t.jobId ?? '') === String(j.id));
  return {
    job: j.jobNo || '(none)',
    mr: j.mrNo || '(blank)',
    agency: agName(j.agencyId),
    division: j.division || '(none)',
    declaredOn: declared && String(declared).trim() ? String(declared) : '(not recorded)',
    capacity: ext?.data?.oilCapLtrs ?? '(none)',
    retainedRaw: available === undefined || available === null ? '(unknown)' : Number(available).toFixed(2),
    evidence: scrapEvidence(j, inspections).matched.join('+'),
    state: adjustment ? 'recorded' : 'awaiting',
  };
});
console.table(rows);

const withDate = rows.filter(r => r.declaredOn !== '(not recorded)').length;
console.log(`\n${withDate} of ${rows.length} have a declaration date; ${rows.length - withDate} do NOT.`);
console.log(`total retained, raw: ${rows.reduce((s, r) => s + (Number(r.retainedRaw) || 0), 0).toFixed(2)} LTR`);
console.log(`state: ${rows.filter(r => r.state === 'awaiting').length} awaiting, `
  + `${rows.filter(r => r.state === 'recorded').length} recorded`);
