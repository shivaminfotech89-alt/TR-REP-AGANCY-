/**
 * SCRAP OIL UNDER THE RETAINED-OIL MODEL — what each scrapped unit would record as received.
 *
 * READ-ONLY. Nothing here writes.
 *
 *     npx tsx scripts/admin/scrap-oil-retained.ts
 *
 * THE MODEL BEING MEASURED: when a transformer is scrapped its oil STAYS WITH THE AGENCY, so
 * the agency genuinely receives those litres - not from a barrel, but received. Recording them
 * as received reduces what the division owes, which is right, because the agency now holds oil
 * it did not buy.
 *
 * ⚠ THE SHORTAGE IS IMPORTED, NOT COPIED (see oil-net-census.js, which copies it and says so).
 * A figure about what the DISCOM is owed must come from the function the register calls.
 *
 * ⚠ AND "OIL PRESENT IN THE TANK" IS NOT RE-DERIVED EITHER. ExternalInspection.tsx:536 already
 * stores `oilAvailable` = oilCapLtrs - lessOilLtrs on the inspection. That IS the retained
 * quantity this model needs, so it is read rather than recomputed - and where it is absent the
 * row says so instead of silently falling back to the register's kVA default.
 *
 * ⚠ THERE IS NO ONE SCRAP PREDICATE IN THIS CODEBASE, so this tests all of them and prints
 * which matched: job.status === 'Scrap' (inspectionStage), job.status === 'Scrap / Unrepairable'
 * (MrLedger's status list), job.condition === 'Scrap' (BillingSystem), and the internal
 * inspection's data.condition === 'Scrap'. A census that picked one would get a different
 * count from AUDIT O77's eleven and never say why.
 */
import { all, banner } from './_db.js';
import { jobOilShortage, computeOilBalance, describeOil } from '../../src/lib/oilBalance';
import { inspectionFor } from '../../src/lib/inspectionLink.js';

const n2 = (n: number) => Number(n.toFixed(2)).toFixed(2);
const blank = (v: any) => v === undefined || v === null || String(v).trim() === '';
const num = (v: any) => Number(v) || 0;

banner('SCRAP OIL — WHAT THE RETAINED-OIL MODEL WOULD RECORD AS RECEIVED');

// ⚠ `any[]`, DELIBERATELY - see unassigned-oil-contribution.ts. `all()` is typed
// `{ id: string }[]`, so field access is a type error without it; tsx runs regardless, which
// is how a script can print correct figures and fail the typecheck at the same time.
const [agencies, ats, jobs, txns, inspections]: any[][] = await Promise.all(
  ['agencies', 'atMasters', 'jobs', 'oilTransactions', 'inspections'].map(all));

const external = inspections.filter((i: any) => i.type === 'External' || !i.type);
const internal = inspections.filter((i: any) => i.type === 'Internal');
const agName = (id: string) => agencies.find((a: any) => a.id === id)?.name || id;

/** Every scrap test in the codebase, kept apart so the disagreement is visible. */
function scrapMarks(job: any): string[] {
  const marks: string[] = [];
  if (job.status === 'Scrap') marks.push('status=Scrap');
  if (job.status === 'Scrap / Unrepairable') marks.push('status=Scrap/Unrep');
  if (job.condition === 'Scrap') marks.push('condition=Scrap');
  if (internal.some((i: any) => String(i.jobId ?? '') === String(job.id) && i?.data?.condition === 'Scrap')) {
    marks.push('inspection=Scrap');
  }
  return marks;
}

const scrap = jobs.map((j: any) => ({ job: j, marks: scrapMarks(j) })).filter((r: any) => r.marks.length > 0);

console.log(`${scrap.length} scrap job(s) of ${jobs.length}\n`);
if (scrap.length === 0) process.exit(0);

// ---------------------------------------------------------------- per job

const rows = scrap.map(({ job, marks }: any) => {
  const insp: any = inspectionFor(job, external);
  const cap = insp?.data?.oilCapLtrs ?? insp?.oilCapLtrs ?? job.externalDetails?.oilCapLtrs ?? job.oilCapLtrs ?? job.oilCapacity;
  const less = insp?.data?.lessOilLtrs ?? insp?.lessOilLtrs ?? job.externalDetails?.lessOilLtrs ?? job.lessOilLtrs;
  const storedAvail = insp?.data?.oilAvailable;

  // ⚠ STORED, NOT RE-DERIVED. Only computed from cap/less when the inspection did not store it,
  // and flagged when neither is available so no figure rests on an invented capacity.
  const available = !blank(storedAvail) ? num(storedAvail)
    : (!blank(cap) ? Math.max(0, num(cap) - num(less)) : null);

  const shortage = jobOilShortage(job, external);
  const retainedRaw = available === null ? null : available;
  const retained95 = available === null ? null : available * 0.95;

  return {
    agency: agName(job.agencyId),
    jobNo: job.jobNo || '(none)',
    mr: job.mrNo || '(blank)',
    kVA: job.capacityKva ?? '-',
    scrapBy: marks.join('+'),
    capacity: blank(cap) ? '(none)' : String(cap),
    lessOil: blank(less) ? '(none)' : String(less),
    available: available === null ? '(UNKNOWN)' : n2(available),
    shortageNow: n2(shortage),
    retainedRaw: retainedRaw === null ? '-' : n2(retainedRaw),
    retained95: retained95 === null ? '-' : n2(retained95),
    netRaw: retainedRaw === null ? '-' : n2(shortage - retainedRaw),
    net95: retained95 === null ? '-' : n2(shortage - retained95),
    _agencyId: job.agencyId,
    _atId: String(job.atId ?? '').trim(),
    _shortage: shortage,
    _rawRetained: retainedRaw ?? 0,
    _r95: retained95 ?? 0,
    _unknown: available === null,
  };
});

console.table(rows.map(({ _agencyId, _atId, _shortage, _rawRetained, _r95, _unknown, ...r }) => r));

const sum = (f: (r: any) => number) => rows.reduce((s, r) => s + f(r), 0);
const totShort = sum(r => r._shortage);
const totRaw = sum(r => r._rawRetained);
const tot95 = sum(r => r._r95);
const unknowns = rows.filter(r => r._unknown).length;

console.log(`\nshortage credited today          ${n2(totShort).padStart(10)} LTR   (AUDIT O77 measured 609.00)`);
console.log(`retained, raw available          ${n2(totRaw).padStart(10)} LTR`);
console.log(`retained, available x 0.95       ${n2(tot95).padStart(10)} LTR   (what "Used" oil nets to today)`);
console.log(`\nNET if retained recorded as received:`);
console.log(`   raw          ${n2(totShort - totRaw).padStart(10)} LTR   ${describeOil(totShort - totRaw).direction}`);
console.log(`   x 0.95       ${n2(totShort - tot95).padStart(10)} LTR   ${describeOil(totShort - tot95).direction}`);
if (unknowns) console.log(`\n⚠ ${unknowns} job(s) have no recorded capacity - their retained figure is UNKNOWN, not zero.`);

// ---------------------------------------------------------------- do they cancel?

console.log('\n================ DO THE TWO FIGURES CANCEL? ================\n');
console.log('O77 asks whether a scrapped unit should credit a top-up it never received.');
console.log('Under this model the shortage STAYS and the retained oil offsets it, so:\n');
for (const r of rows) {
  if (r._unknown) continue;
  const resid = r._shortage - r._rawRetained;
  console.log(
    `   ${r.jobNo.padEnd(10)} ${r.agency.padEnd(8)} shortage ${r.shortageNow.padStart(8)}`
    + ` - retained ${r.retainedRaw.padStart(8)} = ${n2(resid).padStart(9)}`,
  );
}

// ---------------------------------------------------------------- effect on the tender

console.log('\n================ EFFECT ON EACH TENDER ================\n');
for (const ag of agencies) {
  const mine = rows.filter(r => r._agencyId === ag.id);
  if (!mine.length) continue;
  const agAts = ats.filter((a: any) => a.agencyId === ag.id);
  const agJobs = jobs.filter((j: any) => j.agencyId === ag.id);
  const agTx = txns.filter((t: any) => t.agencyId === ag.id);
  console.log(`${ag.name}   ${mine.length} scrap job(s)`);
  for (const at of agAts) {
    const sj = agJobs.filter((j: any) => String(j.atId ?? '') === at.id);
    const st = agTx.filter((t: any) => String(t.atId ?? '') === at.id);
    const now = computeOilBalance({ jobs: sj, inspections: external, transactions: st });
    const inThisAt = mine.filter(r => r._atId === at.id);
    const addRaw = inThisAt.reduce((s, r) => s + r._rawRetained, 0);
    const add95 = inThisAt.reduce((s, r) => s + r._r95, 0);
    if (!inThisAt.length) continue;
    console.log(
      `   AT ${String(at.atNumber || at.name).padEnd(10)}`
      + ` now ${describeOil(now.net).signed.padStart(12)}`
      + ` -> raw ${describeOil(now.net - addRaw).signed.padStart(12)}`
      + ` -> x0.95 ${describeOil(now.net - add95).signed.padStart(12)}`
      + `   (${inThisAt.length} scrap job(s) in this tender)`,
    );
    /**
     * ⚠ THE DECOMPOSITION THE OIL ACCOUNT SUMMARY SHOWS, PRINTED HERE TOO (AUDIT F87).
     *
     * A script and a screen measuring one quantity by different means, never printed side by
     * side, is how a banner reported 4 of 12 for a fortnight. The read-only scrap breakdown on
     * the Oil Account shows exactly these four figures, so they are emitted here to be compared
     * against it. If the two ever disagree, that is the bug.
     */
    const scrapShortage = inThisAt.reduce((s, r) => s + r._shortage, 0);
    const repairShortage = now.shortage - scrapShortage;
    console.log(
      `      shortage ${n2(now.shortage).padStart(9)}`
      + `  = repair ${n2(repairShortage).padStart(9)}`
      + ` + scrap ${n2(scrapShortage).padStart(9)}`
      + `   received ${n2(now.received).padStart(9)}`
      + `   retained (NOT in the balance) ${n2(addRaw).padStart(9)}`,
    );
  }
  console.log('');
}
