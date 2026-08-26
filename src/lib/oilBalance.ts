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
 * Net is shortage minus received: positive means the agency owes oil, negative means it is
 * owed. That sign convention is the register's and is not reinterpreted here.
 *
 * ⚠ The defaults below (capacity by kVA, the 5% filtration loss) are the register's own and
 * are reproduced exactly. They are assumptions about missing inspection data, not facts, and
 * changing one changes what the DISCOM is told — so they change in this file or not at all.
 */

export interface OilBalanceInput {
  jobs: any[];
  inspections: any[];
  transactions: any[];
}

export interface OilBalance {
  /** Litres short, from external inspections. */
  shortage: number;
  /** Litres received, from oil transactions. */
  received: number;
  /** shortage - received. Positive: the agency owes. Negative: the agency is owed. */
  net: number;
  /** How many jobs contributed a shortage figure, so a zero can be told from an empty set. */
  jobsCounted: number;
  /** How many transactions contributed. */
  transactionsCounted: number;
}

/** The external inspection for a job, by any of the four ways they are linked. */
function inspectionFor(job: any, inspections: any[]): any {
  return inspections.find(i =>
    (i.jobId === job.id || i.jobId === job.jobNo || i.id === job.inspectionId ||
     (i.mrNo === job.mrNo && i.jobNo === job.jobNo)) &&
    (i.type === 'External' || !i.type || i.data?.oilCapLtrs !== undefined)
  ) || inspections.find(i => i.jobId === job.id);
}

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

export function computeOilBalance({ jobs, inspections, transactions }: OilBalanceInput): OilBalance {
  let shortage = 0;
  let jobsCounted = 0;
  for (const job of jobs) {
    if (!job?.mrNo) continue;      // the register keys on MR; a job without one contributes nothing
    shortage += jobOilShortage(job, inspections);
    jobsCounted++;
  }

  let received = 0;
  let transactionsCounted = 0;
  for (const tx of transactions) {
    if (!tx?.mrNo) continue;
    received += Number(tx.netLiters) || 0;
    transactionsCounted++;
  }

  return {
    shortage: Number(shortage.toFixed(2)),
    received: Number(received.toFixed(2)),
    net: Number((shortage - received).toFixed(2)),
    jobsCounted,
    transactionsCounted,
  };
}
