/**
 * THE OIL BALANCE OF A SET OF WORK — one computation, used everywhere it is shown.
 *
 * ONE IMPLEMENTATION ON PURPOSE (AUDIT F82). The Oil Account register computes this to show
 * what is owed; the Tenders card computes it to offer a closing figure to carry into the
 * next tender. A second copy of it is how the balance an operator confirms comes to differ
 * from the balance the register shows — and this session has already untangled that shape in
 * estimates (F41/F55), in job numbering (F68) and in job-number parsing (F81). It is not
 * being introduced again for a number the DISCOM is owed against.
 *
 * SHORTAGE comes from the EXTERNAL INSPECTION on each job; RECEIVED from oil transactions.
 * Net is shortage minus received — the same arithmetic as the DISCOM's own oil accounting
 * workbook, which computes "Balance oil with agency" as (opening + oil required to top up +
 * filtration loss) − oil issued. POSITIVE MEANS THE DIVISION OWES THE AGENCY: the agency has
 * topped up more than it has been issued. See OIL_DIRECTION below for the evidence, and do
 * not restate the direction anywhere else — say it by calling `describeOil` (AUDIT F88).
 *
 * ⚠ The defaults below (capacity by kVA, the 5% filtration loss) are the register's own and
 * are reproduced exactly. They are assumptions about missing inspection data, not facts, and
 * changing one changes what the DISCOM is told — so they change in this file or not at all.
 */

/**
 * WHICH DIRECTION A SIGNED OIL FIGURE RUNS — the ONE place it is put into words (AUDIT F88).
 *
 * ⚠ "-2120.00 LTR" DOES NOT SAY WHO OWES WHOM, and a figure the DISCOM is settled against
 * must say so on its face rather than leave it to be inferred from a minus sign. Every screen
 * that prints a signed oil balance takes its wording from here, so the direction is stated
 * identically everywhere and can be corrected in exactly one place if it is ever wrong.
 *
 * ⚠ TAKEN FROM THE DISCOM'S OWN SHEET, NOT INFERRED (AUDIT F88). "SBT CO Oil Account
 * MARCH-2026", the UGVCL agency-wise oil accounting workbook, computes exactly this figure
 * and its arithmetic fixes the direction beyond argument:
 *
 *     Total oil in       = Opening balance + Oil required to top up failed X'mer + Filtration loss
 *     Balance with agency = Total oil in − Oil Issued to agency
 *
 * The balance RISES with oil the agency puts into transformers and with oil the agency loses
 * in filtration, and FALLS with oil the DISCOM issues. A quantity that grows when you spend
 * and shrinks when you are supplied is a RECEIVABLE: positive means the agency has topped up
 * more than it has been issued, so THE DIVISION OWES THE AGENCY. The sheet confirms it a
 * second way by dividing this balance to get "Oil consumption per X'mer" - it is measuring
 * consumption, not stock.
 *
 * This is the same arithmetic as computeOilBalance below (shortage − received, with the 5%
 * filtration loss inside the shortage), so the app's SIGN already matched the DISCOM's. Only
 * the words were wrong, and they were wrong in the dangerous direction - stated rather than
 * inferred.
 *
 * ⚠ THE COLUMN NAMES CUT THE OTHER WAY AND SHOULD NOT MISLEAD THE NEXT READER. "Opening
 * balance of oil with agencies" and "Balance oil with agency" both read as oil physically
 * sitting in the agency's shed, which would make positive a liability. The arithmetic rules
 * that out: filtration loss DESTROYS oil and yet INCREASES the balance, which no measure of
 * stock on hand can do. The names are loose; the formula is not.
 */
export const OIL_DIRECTION = {
  /** Topped up more than was issued: the agency is out of pocket. */
  positive: 'division owes the agency',
  /** Issued more than was topped up: the agency holds the surplus. */
  negative: 'agency owes the division',
  /** exactly nil. */
  level: 'settled level',
} as const;

export interface OilDirection {
  /** '+' , '-' or '' — the sign as displayed, always explicit for non-zero. */
  sign: string;
  /** The magnitude, two decimals, never signed. */
  magnitude: string;
  /** "+2120.00 LTR" / "-2120.00 LTR" / "0.00 LTR". */
  signed: string;
  /** Who owes whom, in words. */
  direction: string;
  /**
   * True when the agency is the CREDITOR — positive, i.e. topped up more than it was issued.
   * ⚠ FOR COLOURING ONLY, never for arithmetic. It is deliberately NOT named `agencyOwes`:
   * an earlier revision was named that and asserted the opposite of what the DISCOM sheet
   * says, which is precisely how a wrong direction gets copied to a new call site (F88).
   */
  agencyIsOwed: boolean;
}

/** One signed litre figure, described so the direction never has to be inferred. */
export function describeOil(litres: number): OilDirection {
  const n = Number.isFinite(litres) ? litres : 0;
  const rounded = Number(n.toFixed(2));
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  const magnitude = Math.abs(rounded).toFixed(2);
  return {
    sign,
    magnitude,
    signed: `${sign}${magnitude} LTR`,
    direction: rounded > 0 ? OIL_DIRECTION.positive : rounded < 0 ? OIL_DIRECTION.negative : OIL_DIRECTION.level,
    agencyIsOwed: rounded > 0,
  };
}

import { inspectionFor } from './inspectionLink.js';

export interface OilBalanceInput {
  jobs: any[];
  inspections: any[];
  transactions: any[];
}

export interface OilDivisionBalance {
  shortage: number;
  received: number;
  /** shortage - received, for this division alone. */
  net: number;
  jobsCounted: number;
  transactionsCounted: number;
}

export interface OilBalance {
  /** Litres short, from external inspections. */
  shortage: number;
  /** Litres received, from oil transactions. */
  received: number;
  /** shortage - received. Positive: the DIVISION owes the agency — see OIL_DIRECTION (F88). */
  net: number;
  /** How many jobs contributed a shortage figure, so a zero can be told from an empty set. */
  jobsCounted: number;
  /** How many transactions contributed. */
  transactionsCounted: number;

  /**
   * THE SAME FIGURES, PER DIVISION (AUDIT F86).
   *
   * Oil is settled with a division, not with the DISCOM as a whole - SABARMATI's shortage
   * is not offset by KALOL's surplus, and a tender that closes owing 40 litres in one and
   * holding 30 in another owes 40 and holds 30. A single net conceals that, and it is the
   * figure carried into the next tender, so it would conceal it permanently.
   *
   * The agency total is the sum of these and is kept alongside rather than derived at the
   * point of use - see openingOilBalance on AtMaster for why both are stored.
   */
  byDivision: Record<string, OilDivisionBalance>;
}

// The job/inspection link lives in inspectionLink.js — one definition, shared with the
// admin scripts, with the branch that could never match removed (AUDIT G4).

/** One job's net oil shortage, exactly as the register derives it. */
export function jobOilShortage(job: any, inspections: any[]): number {
  const insp = inspectionFor(job, inspections);

  const rawOilCap = insp?.data?.oilCapLtrs ?? insp?.oilCapLtrs ?? job.externalDetails?.oilCapLtrs ?? job.oilCapLtrs ?? job.oilCapacity;
  const rawLessOil = insp?.data?.lessOilLtrs ?? insp?.lessOilLtrs ?? job.externalDetails?.lessOilLtrs ?? job.lessOilLtrs;
  const rawNetShortage = insp?.data?.netShortage ?? insp?.netShortage ?? job.externalDetails?.netShortage;

  // A STORED netShortage WINS. It is what the inspection recorded; everything below is the
  // fallback for a job whose inspection did not carry one.
  if (typeof rawNetShortage === 'number') return rawNetShortage;

  const kva = Number(job.capacityKva) || 25;
  const defaultCap = kva <= 16 ? 140 : kva <= 25 ? 184 : kva <= 63 ? 240 : 323;

  const oilCap = (rawOilCap !== undefined && rawOilCap !== null && String(rawOilCap).trim() !== '')
    ? Number(rawOilCap) : defaultCap;
  const lessOil = (rawLessOil !== undefined && rawLessOil !== null && String(rawLessOil).trim() !== '')
    ? Number(rawLessOil) : 0;

  const oilRecd = Math.max(0, oilCap - lessOil);
  return lessOil + oilRecd * 0.05;
}

/** Division names are compared as typed but grouped case-insensitively on the trimmed value. */
const divisionKey = (v: unknown): string => String(v ?? '').trim() || '(no division)';

export function computeOilBalance({ jobs, inspections, transactions }: OilBalanceInput): OilBalance {
  const byDivision: Record<string, OilDivisionBalance> = {};
  const bucket = (div: string): OilDivisionBalance =>
    (byDivision[div] ||= { shortage: 0, received: 0, net: 0, jobsCounted: 0, transactionsCounted: 0 });

  let shortage = 0;
  let jobsCounted = 0;
  for (const job of jobs) {
    if (!job?.mrNo) continue;      // the register keys on MR; a job without one contributes nothing
    const n = jobOilShortage(job, inspections);
    shortage += n;
    jobsCounted++;
    const b = bucket(divisionKey(job.division));
    b.shortage += n;
    b.jobsCounted++;
  }

  let received = 0;
  let transactionsCounted = 0;
  for (const tx of transactions) {
    if (!tx?.mrNo) continue;
    const n = Number(tx.netLiters) || 0;
    received += n;
    transactionsCounted++;
    const b = bucket(divisionKey(tx.division));
    b.received += n;
    b.transactionsCounted++;
  }

  for (const d of Object.keys(byDivision)) {
    const b = byDivision[d];
    b.shortage = Number(b.shortage.toFixed(2));
    b.received = Number(b.received.toFixed(2));
    b.net = Number((b.shortage - b.received).toFixed(2));
  }

  return {
    shortage: Number(shortage.toFixed(2)),
    received: Number(received.toFixed(2)),
    net: Number((shortage - received).toFixed(2)),
    jobsCounted,
    transactionsCounted,
    byDivision,
  };
}

/** The per-division opening balances a tender would carry forward. */
export function openingMapFrom(balance: OilBalance): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [div, b] of Object.entries(balance.byDivision)) out[div] = b.net;
  return out;
}
