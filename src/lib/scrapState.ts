/**
 * IS THIS JOB SCRAP? — ONE ANSWER, AND IT SAYS WHAT ANSWERED (AUDIT O80).
 *
 * ⚠ THERE WERE FOUR TESTS FOR THIS AND THEY DISAGREE BY MORE THAN HALF THE POPULATION. Measured
 * across live data, 12 scrap jobs:
 *
 *     job.status === 'Scrap'                  ->  5 of 12
 *     job.condition === 'Scrap'               -> 11 of 12   <- what the O76/O77 census used
 *     inspection data.condition === 'Scrap'   -> 12 of 12
 *     job.status === 'Scrap / Unrepairable'   ->  0         <- offered by MrLedger's status
 *                                                              list, matched by nothing
 *
 * A census is wrong depending on which it picked, and O77's was: it missed ASU-2 (ADMIN, 90.00
 * litres) and reported 609.00 where the figure is 699.00.
 *
 * ⚠ WHY `status` FINDS LESS THAN HALF. `status` is a workflow STAGE and it MOVES ON; `condition`
 * is an ASSESSMENT and it PERSISTS. Six of the twelve read `status: 'Dispatched'` because the
 * scrapped unit was returned to the division - so a scrapped job that has been delivered back
 * stops being findable by status, which is precisely the population an oil census is about.
 *
 * ⚠ AND ONE JOB IS SCRAP ONLY IN ITS INSPECTION. ASU-2 has `status: 'Dispatched'` and an EMPTY
 * `condition`, while its internal inspection records `data.condition: 'Scrap'`. The declaration
 * never propagated to the job document, so THE JOB ALONE CANNOT ANSWER THE QUESTION - which is
 * why `inspections` is a parameter here rather than something callers may omit.
 *
 * ⚠ IT REPORTS WHICH EVIDENCE MATCHED, NOT JUST A BOOLEAN. A breakdown that silently used the
 * narrowest test would understate by ASU-2's 90 litres and say nothing. `scrapEvidence` lets a
 * caller show "5 by status, 11 by condition, 12 including the inspection" instead of one number
 * with no provenance.
 *
 * ⚠ THIS FILE IS DELIBERATELY NOT PART OF THE OIL WORK. O80 records the four-way split as its
 * own defect; defining the predicate inside the oil feature is how it would acquire a FIFTH
 * definition. It is imported by the oil breakdown, not owned by it, and nothing here knows what
 * a litre is.
 *
 * No React, no Firebase - so it is reachable from src/ AND from scripts/admin/ under tsx.
 */

/** The declared-scrap marker as stored on a job or an inspection record. */
export const SCRAP = 'Scrap';

/**
 * ⚠ THE STATUS THE UI OFFERS AND NOTHING MATCHES. MrLedger's JOB_STATUSES contains
 * 'Scrap / Unrepairable'. No live job carries it, and every scrap test in the app compared
 * against 'Scrap', so a job saved with it today would be invisible to all of them. It is
 * accepted here rather than left as a trap - and named, so the disagreement is visible.
 */
export const SCRAP_STATUS_VARIANT = 'Scrap / Unrepairable';

const norm = (v: unknown): string => String(v ?? '').trim();

export interface ScrapEvidence {
  /** `job.status` says Scrap (either spelling). */
  byStatus: boolean;
  /** `job.condition` says Scrap. */
  byCondition: boolean;
  /** An Internal inspection for this job records `data.condition: 'Scrap'`. */
  byInspection: boolean;
  /** True when ANY of the above did. */
  isScrap: boolean;
  /** Which ones, for a caller that must show provenance. Empty when not scrap. */
  matched: Array<'status' | 'condition' | 'inspection'>;
}

/**
 * Every test, kept apart so the disagreement stays visible.
 *
 * `inspections` may be the whole list or pre-filtered to Internal; records are matched on
 * `jobId` and their own `type` is checked here, so callers need not pre-filter and cannot
 * accidentally pass External records that would never match anyway.
 */
export function scrapEvidence(job: any, inspections: any[] = []): ScrapEvidence {
  const status = norm(job?.status);
  const byStatus = status === SCRAP || status === SCRAP_STATUS_VARIANT;
  const byCondition = norm(job?.condition) === SCRAP;

  const jobId = norm(job?.id);
  const byInspection = jobId !== '' && (inspections || []).some((i: any) =>
    norm(i?.jobId) === jobId
    && norm(i?.type) === 'Internal'
    && norm(i?.data?.condition) === SCRAP);

  const matched: Array<'status' | 'condition' | 'inspection'> = [];
  if (byStatus) matched.push('status');
  if (byCondition) matched.push('condition');
  if (byInspection) matched.push('inspection');

  return { byStatus, byCondition, byInspection, isScrap: matched.length > 0, matched };
}

/**
 * THE WIDEST TEST — a job is scrap if ANY evidence says so.
 *
 * ⚠ WIDEST ON PURPOSE. The narrow tests each miss a real scrapped unit, and for an oil figure
 * an understatement is the dangerous direction: it hides litres from a total the DISCOM settles
 * against. A caller that needs a narrower answer should read `scrapEvidence` and say which.
 */
export function isScrapJob(job: any, inspections: any[] = []): boolean {
  return scrapEvidence(job, inspections).isScrap;
}

// ---------------------------------------------------------------------------
// THE SCRAP ADJUSTMENT — an oil row that is not a receipt from the division
// ---------------------------------------------------------------------------

/**
 * THE `oilType` THAT MARKS A SCRAP ADJUSTMENT (AUDIT O79).
 *
 * When a transformer is scrapped its oil STAYS WITH THE AGENCY. Those litres are recorded as a
 * deduction against what the division owes - a THIRD term beside shortage and inward:
 *
 *     opening + shortage - inward - scrap adjustment = net
 *
 * ⚠ IT MUST BE AN EXPLICIT MARKER, NOT THE PRESENCE OF `jobId`. An implicit marker means
 * anything that ever writes a job reference for some other reason silently becomes an
 * adjustment. This cannot drift: a row is an adjustment because it says so.
 *
 * ⚠ AND IT CANNOT BE `Used`. Used oil is a legitimate INWARD type - oil the division issued -
 * so it classifies nothing. It also forces `filtrationLossPercent: 5`, and a scrapped unit's
 * oil is never filtered: the filtration allowance is for oil that goes back INTO a transformer,
 * and the transformer is gone. A scrap adjustment carries the RAW quantity that was in the
 * tank, so gross === net and the loss is 0.
 */
export const SCRAP_OIL_TYPE = 'Scrap';

/** What the operator reads, wherever the row is labelled. */
export const SCRAP_OIL_LABEL = 'Scrap adjustment';

/**
 * Is this oil row a scrap adjustment rather than a receipt from the division?
 *
 * ⚠ ONE DEFINITION, BECAUSE FIVE SURFACES ASK IT. The printed Inward Oil Received Log, the
 * invoice's oil deduction, two Excel exports and the Oil Account's own totals each have to tell
 * an adjustment from a receipt, and a copy in any one of them is how the statement and the
 * screen come to disagree without either being wrong on its own terms.
 */
export function isScrapAdjustment(tx: any): boolean {
  return norm(tx?.oilType) === SCRAP_OIL_TYPE;
}

/** The receipts the division actually issued - everything that is not an adjustment. */
export function inwardOnly<T>(transactions: T[]): T[] {
  return (transactions || []).filter(t => !isScrapAdjustment(t));
}

/** The adjustments alone. */
export function scrapAdjustmentsOnly<T>(transactions: T[]): T[] {
  return (transactions || []).filter(t => isScrapAdjustment(t));
}

/** How many jobs each test finds, for a report that must state its own provenance. */
export function scrapCounts(jobs: any[], inspections: any[] = []) {
  let byStatus = 0, byCondition = 0, byInspection = 0, any = 0;
  for (const j of jobs || []) {
    const e = scrapEvidence(j, inspections);
    if (e.byStatus) byStatus++;
    if (e.byCondition) byCondition++;
    if (e.byInspection) byInspection++;
    if (e.isScrap) any++;
  }
  return { byStatus, byCondition, byInspection, any, total: (jobs || []).length };
}
