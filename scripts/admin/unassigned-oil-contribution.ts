/**
 * WHAT THE UNASSIGNED JOBS ACTUALLY CONTRIBUTE TO THE OIL BALANCE.
 *
 * READ-ONLY. Nothing here writes.
 *
 *     npx tsx scripts/admin/unassigned-oil-contribution.ts
 *
 * THE QUESTION: the app warns that N jobs belong to no tender. A warning about a figure that
 * does not move is noise, and noise is how the warning that matters gets skipped. So: how many
 * litres do those jobs carry, and what would each tender's balance read if they were attributed?
 *
 * ⚠ THE SHORTAGE FORMULA IS IMPORTED, NOT COPIED, AND THAT IS WHY THIS IS TYPESCRIPT.
 * scripts/admin/oil-net-census.js copies `jobOilShortage` out of src/lib/oilBalance.ts and says
 * so in its own header: "if the two ever disagree, that is the bug." A THIRD copy of the
 * arithmetic behind a figure the DISCOM is settled against would make that worse, so this runs
 * under tsx and calls the same function the register calls. Every litre below is the app's own.
 *
 * ⚠ THE CAPACITY AND LESS-OIL COLUMNS PRINT WHAT IS STORED, NOT A RE-DERIVED FALLBACK. The
 * register's kVA defaults and its 5% filtration loss live in oilBalance.ts; restating them here
 * to explain a number would be the same duplication by another route. Where a field is blank,
 * the column says so and the imported figure is what the register will show anyway.
 *
 * ⚠ UNASSIGNED WORK IS FOUND IN MEMORY, NEVER BY A QUERY (AUDIT F87). No Firestore equality
 * matches an ABSENT field, so `where('atId','==','')` misses exactly the documents this is
 * about - which is how a banner reported 4 of 12 for a fortnight.
 */
import { all, banner } from './_db.js';
import { jobOilShortage, computeOilBalance, describeOil } from '../../src/lib/oilBalance';
// ⚠ THE JOB/INSPECTION LINK IS IMPORTED TOO (AUDIT G4). `jobOilShortage` resolves the
// inspection through this; if the columns below found it by a hand-rolled `jobId` match, they
// could describe a DIFFERENT inspection from the one that produced the figure beside them -
// two measurements of one quantity, which is the fault this whole session keeps removing.
import { inspectionFor } from '../../src/lib/inspectionLink.js';

/** The app's own test, verbatim - src/lib/tenderState.ts isUnassigned. */
const isUnassigned = (r: any): boolean => !String(r?.atId ?? '').trim();

const n2 = (n: number) => Number(n.toFixed(2)).toFixed(2);
const blank = (v: any) => v === undefined || v === null || String(v).trim() === '';

banner('WHAT THE UNASSIGNED JOBS CONTRIBUTE TO THE OIL BALANCE');

// ⚠ `any[]`, DELIBERATELY. `all()` is typed `{ id: string }[]` - the spread of `d.data()`
// contributes nothing to the inferred type - so every field access below is a type error
// without this. tsx strips types without checking, so these scripts RUN clean while `tsc`
// reports thirteen errors: the check that can see the fault and the run that cannot.
const [agencies, ats, jobs, txns, inspections]: any[][] = await Promise.all(
  ['agencies', 'atMasters', 'jobs', 'oilTransactions', 'inspections'].map(all));

// The same set the register's shortage reads from - external inspections only.
const external = inspections.filter((i: any) => i.type === 'External' || !i.type);
const agName = (id: string) => agencies.find((a: any) => a.id === id)?.name || id;
const atLabel = (at: any) => at.atNumber || at.name || at.id;

const unassignedJobs = jobs.filter(isUnassigned);
const unassignedTx = txns.filter(isUnassigned);

console.log(`${unassignedJobs.length} of ${jobs.length} job(s) carry no atId`);
console.log(`${unassignedTx.length} of ${txns.length} oil transaction(s) carry no atId\n`);

if (unassignedJobs.length === 0) {
  console.log('Nothing is unassigned. The notice would not render.');
  process.exit(0);
}

// ---------------------------------------------------------------- job by job

console.log('================ EACH UNASSIGNED JOB ================\n');

const rows = unassignedJobs.map((j: any) => {
  const insp: any = inspectionFor(j, external);
  const storedNet = insp?.data?.netShortage ?? insp?.netShortage ?? j.externalDetails?.netShortage;
  const rawCap = insp?.data?.oilCapLtrs ?? insp?.oilCapLtrs ?? j.externalDetails?.oilCapLtrs ?? j.oilCapLtrs ?? j.oilCapacity;
  const rawLess = insp?.data?.lessOilLtrs ?? insp?.lessOilLtrs ?? j.externalDetails?.lessOilLtrs ?? j.lessOilLtrs;
  // ⚠ THE FIGURE ITSELF COMES FROM THE APP, not from the columns beside it.
  const shortage = jobOilShortage(j, external);
  return {
    agency: agName(j.agencyId),
    jobNo: j.jobNo || '(none)',
    mr: j.mrNo || '(blank)',
    division: j.division || '(none)',
    kVA: j.capacityKva ?? '(none)',
    inspected: insp ? 'yes' : 'NO',
    oilCapLtrs: blank(rawCap) ? '(not recorded)' : String(rawCap),
    lessOilLtrs: blank(rawLess) ? '(not recorded)' : String(rawLess),
    storedNetShortage: typeof storedNet === 'number' ? n2(storedNet) : '(none)',
    shortageLTR: n2(shortage),
    _shortage: shortage,
    _agencyId: j.agencyId,
    _division: String(j.division ?? '').trim() || '(no division)',
  };
});

console.table(rows.map(({ _shortage, _agencyId, _division, ...r }) => r));

const total = rows.reduce((s, r) => s + r._shortage, 0);
console.log(`\nTOTAL contributed by unassigned jobs: ${n2(total)} LTR of shortage.`);
console.log('(Shortage RAISES the balance: positive means the division owes the agency - F88.)');

// ---------------------------------------------------------------- what each tender would read

console.log('\n================ WHAT EACH TENDER WOULD READ ================\n');
console.log('Current = the tender as the register shows it now (its own atId only).');
console.log('If attributed = the same, with the unassigned jobs of that agency folded in.\n');

for (const ag of agencies) {
  const agUnassigned = rows.filter(r => r._agencyId === ag.id);
  if (agUnassigned.length === 0) continue;

  const agAts = ats.filter((a: any) => a.agencyId === ag.id);
  const agJobs = jobs.filter((j: any) => j.agencyId === ag.id);
  const agTx = txns.filter((t: any) => t.agencyId === ag.id);
  const addedShortage = agUnassigned.reduce((s, r) => s + r._shortage, 0);

  console.log(`${ag.name}   (${agUnassigned.length} unassigned job(s), ${n2(addedShortage)} LTR)`);

  if (agAts.length === 0) {
    console.log('   no tender exists for this agency\n');
    continue;
  }

  for (const at of agAts) {
    const scopedJobs = agJobs.filter((j: any) => String(j.atId ?? '') === at.id);
    const scopedTx = agTx.filter((t: any) => String(t.atId ?? '') === at.id);
    const now = computeOilBalance({ jobs: scopedJobs, inspections: external, transactions: scopedTx });
    const withThem = computeOilBalance({
      jobs: [...scopedJobs, ...unassignedJobs.filter((j: any) => j.agencyId === ag.id)],
      inspections: external,
      transactions: scopedTx,
    });
    const moved = withThem.net - now.net;
    console.log(
      `   AT ${String(atLabel(at)).padEnd(12)}`
      + ` current ${describeOil(now.net).signed.padStart(12)}`
      + ` -> if attributed ${describeOil(withThem.net).signed.padStart(12)}`
      + `   (moves ${moved >= 0 ? '+' : ''}${n2(moved)})`,
    );
  }

  // Oil settles per division, not per DISCOM (AUDIT F86) - so say which divisions move.
  const byDiv: Record<string, number> = {};
  for (const r of agUnassigned) byDiv[r._division] = (byDiv[r._division] || 0) + r._shortage;
  console.log('   divisions affected: '
    + Object.entries(byDiv).map(([d, v]) => `${d} ${n2(v)} LTR`).join(', '));
  console.log('');
}

// ---------------------------------------------------------------- is it noise?

console.log('================ IS THE NOTICE WORTH READING? ================\n');
const agencyTotals = agencies.map((ag: any) => {
  const agJobs = jobs.filter((j: any) => j.agencyId === ag.id && j.mrNo);
  const agTx = txns.filter((t: any) => t.agencyId === ag.id && t.mrNo);
  if (!agJobs.length && !agTx.length) return null;
  const whole = computeOilBalance({ jobs: agJobs, inspections: external, transactions: agTx });
  const missing = rows.filter(r => r._agencyId === ag.id).reduce((s, r) => s + r._shortage, 0);
  return { agency: ag.name, wholeNet: whole.net, missing };
}).filter(Boolean) as { agency: string; wholeNet: number; missing: number }[];

for (const t of agencyTotals) {
  if (t.missing === 0) continue;
  const pct = t.wholeNet === 0 ? Infinity : Math.abs(t.missing / t.wholeNet) * 100;
  console.log(
    `${t.agency.padEnd(22)} unassigned ${n2(t.missing).padStart(10)} LTR`
    + `   agency net (all tenders) ${describeOil(t.wholeNet).signed.padStart(12)}`
    + `   = ${Number.isFinite(pct) ? `${pct.toFixed(1)}% of it` : 'the whole of it'}`,
  );
}

console.log('\nA tender balance excludes these jobs entirely until each is attributed.');
