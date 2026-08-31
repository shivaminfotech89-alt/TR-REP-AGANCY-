/**
 * THE AGENCY-WIDE OIL NET — the figure the Oil register shows in "All tenders" mode.
 *
 * READ-ONLY. Nothing here writes.
 *
 * ⚠ THIS EXISTS TO BE COMPARED WITH THE SCREEN, NOT CONSULTED INSTEAD OF IT (AUDIT F87).
 * A script and a screen measuring one quantity by different means, never printed side by
 * side, is how the MR Ledger banner reported 4 of 12 for a fortnight. So the arithmetic
 * below is COPIED FROM THE APP - `jobOilShortage` in src/lib/oilBalance.ts, including its
 * kVA-based capacity defaults and the 5% filtration loss - and the numbers printed are what
 * the register will render. If the two ever disagree, that is the bug.
 *
 * THE DEFINITION (AUDIT F89):
 *
 *     agency net = Σ shortage (all jobs) − Σ received (all transactions)
 *
 * across the agency's whole recorded history, with OPENING BALANCES EXCLUDED. An opening
 * balance is a bookkeeping figure carried between tenders; every litre behind it is already
 * in the history summed here, so adding it would count those litres twice.
 *
 * ⚠ AND IT IS THE APP'S HISTORY, NOT THE DIVISION'S. The DISCOM's own workbook carries real
 * opening balances that predate any app record - CHINTAMANI +122, KRYFS −172, ALFA −171 on
 * the first row of the year. If an agency was not at zero with the division when these
 * records began, this figure differs from theirs by exactly that amount, permanently, and
 * nothing inside the app can detect it.
 *
 * SIGN: positive means the DIVISION OWES THE AGENCY - the agency topped up more than it was
 * issued. See OIL_DIRECTION in src/lib/oilBalance.ts for the evidence from the UGVCL sheet.
 */
import { all, banner } from './_db.js';
import { inspectionFor } from '../../src/lib/inspectionLink.js';

const describe = (n) =>
  `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(Number(n.toFixed(2))).toFixed(2)} LTR  ` +
  (n > 0 ? 'division owes the agency' : n < 0 ? 'agency owes the division' : 'settled level');

banner('AGENCY-WIDE OIL NET — "All tenders" mode (AUDIT F89)');

const [agencies, jobs, txns, inspections] = await Promise.all(
  ['agencies', 'jobs', 'oilTransactions', 'inspections'].map(all));

const external = inspections.filter(i => i.type === 'External' || !i.type);

// ⚠ THE LINK RULE IS IMPORTED, NOT COPIED (AUDIT G4). Seven identical copies existed and
// each could drift; this decides whether an inspection's measurements apply to a transformer,
// so a divergence changes a shortage on a document sent to a division.
const inspFor = (job) => inspectionFor(job, external);

/** src/lib/oilBalance.ts jobOilShortage — a stored netShortage wins; the rest is its fallback. */
function jobOilShortage(job) {
  const insp = inspFor(job);
  const stored = insp?.data?.netShortage ?? insp?.netShortage ?? job.externalDetails?.netShortage;
  if (typeof stored === 'number') return stored;

  const rawCap = insp?.data?.oilCapLtrs ?? insp?.oilCapLtrs ?? job.externalDetails?.oilCapLtrs ?? job.oilCapLtrs ?? job.oilCapacity;
  const rawLess = insp?.data?.lessOilLtrs ?? insp?.lessOilLtrs ?? job.externalDetails?.lessOilLtrs ?? job.lessOilLtrs;

  const kva = Number(job.capacityKva) || 25;
  const defaultCap = kva <= 16 ? 140 : kva <= 25 ? 184 : kva <= 63 ? 240 : 323;
  const cap = (rawCap !== undefined && rawCap !== null && String(rawCap).trim() !== '') ? Number(rawCap) : defaultCap;
  const less = (rawLess !== undefined && rawLess !== null && String(rawLess).trim() !== '') ? Number(rawLess) : 0;
  return less + Math.max(0, cap - less) * 0.05;
}

const divKey = (v) => String(v ?? '').trim() || '(no division)';

for (const ag of agencies) {
  // The register keys on MR; a row without one contributes nothing, exactly as computeOilBalance.
  const agJobs = jobs.filter(j => j.agencyId === ag.id && j.mrNo);
  const agTxns = txns.filter(t => t.agencyId === ag.id && t.mrNo);
  if (!agJobs.length && !agTxns.length) continue;

  const byDiv = {};
  let shortage = 0, received = 0;
  for (const j of agJobs) {
    const n = jobOilShortage(j);
    shortage += n;
    (byDiv[divKey(j.division)] ??= { s: 0, r: 0 }).s += n;
  }
  for (const t of agTxns) {
    const n = Number(t.netLiters) || 0;
    received += n;
    (byDiv[divKey(t.division)] ??= { s: 0, r: 0 }).r += n;
  }

  console.log(`\n${ag.name}   ${agJobs.length} job(s), ${agTxns.length} transaction(s)`);
  console.log(`   shortage ${shortage.toFixed(2)}  −  received ${received.toFixed(2)}  =  ${describe(shortage - received)}`);
  for (const [div, v] of Object.entries(byDiv).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`      ${div.padEnd(14)} ${describe(v.s - v.r)}`);
  }
}

console.log('\nOpening balances are excluded from every figure above, by definition.');
