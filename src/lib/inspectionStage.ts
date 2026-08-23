// Single source of truth for what "done" means at each inspection stage (External,
// Internal) across the screens that read it. Pending/Completed filters and row badges
// must both go through these so they can never disagree with each other again.

// Statuses at or past External inspection in the job lifecycle
// (blank / 'Received') -> External Done -> Internal Done -> Tested - Ready for
// Dispatch -> Dispatched, with Scrap reachable as an alternate terminal status
// during internal inspection. 'Tested - Ready for Dispatch' is the real status
// TestingReport.tsx saves (see its handleSubmit) - not 'Testing Completed' or
// 'Ready for Testing', which no code in the app ever actually sets.
const EXTERNAL_DONE_STATUSES = new Set([
  'External Done', 'Internal Done', 'Tested - Ready for Dispatch', 'Dispatched'
]);

const INTERNAL_DONE_STATUSES = new Set([
  'Internal Done', 'Tested - Ready for Dispatch', 'Dispatched'
]);

/**
 * Whether a saved inspection record actually has meaningful data in it, rather than
 * being an empty shell that only exists because a save happened.
 *
 * - Internal: requires at least one coil/winding weight field, a per-phase damage
 *   note, or an explicit Scrap condition. These fields genuinely default to blank
 *   on the form (Amorphous/Wound Core jobs are exempt from needing them at the
 *   form-validation level, since those core types never use coil weight data -
 *   see the isAmorphousOrWound check in InternalInspection.tsx's handleSubmit), so
 *   a non-blank value here is a reliable signal someone filled them in.
 * - External: any saved record with a data object counts as real. External's
 *   fields all auto-fill a plausible-looking default the moment the form opens, so
 *   no field value can distinguish "reviewed and OK" from "never touched" - there
 *   is no reliable per-field signal, so record existence is what's checked instead.
 */
export function hasInspectionData(record: any): boolean {
  const data = record?.data;
  if (!data) return false;

  if (record.type === 'Internal') {
    const hasCoilWeight = [data.totWt, data.wtOfCoil, data.totWtLv, data.wtOfCoilLv]
      .some(v => v !== undefined && v !== null && String(v).trim() !== '');
    const hasDamageNote = [data.damR, data.damY, data.damB]
      .some(v => v !== undefined && v !== null && String(v).trim() !== '');
    const isScrapDecision = data.condition === 'Scrap';
    return hasCoilWeight || hasDamageNote || isScrapDecision;
  }

  // External (or unrecognized type): any saved record counts.
  return true;
}

/**
 * A job counts as externally done when it has an External-type inspection record
 * with real data in it, its status is at/past External Done, or it's closed.
 *
 * Scrap does NOT count as done here. Scrap is declared during internal inspection,
 * when the unit is opened - external (physical) inspection happens for every job
 * without exception, before that. A job that's Scrap with no external record is a
 * data error and must surface as such, not be silently masked as "done".
 */
export function isJobExternallyDone(job: any, inspections: any[]): boolean {
  return inspections.some(i => i.jobId === job.id && hasInspectionData(i))
    || EXTERNAL_DONE_STATUSES.has(job.status)
    || job.isClosed === true;
}

/**
 * Same idea, for internal inspection - except Scrap DOES count as done here, since
 * Scrap is declared during internal inspection itself, so a scrapped job has an
 * internal record by definition.
 */
export function isJobInternallyDone(job: any, inspections: any[]): boolean {
  return inspections.some(i => i.jobId === job.id && hasInspectionData(i))
    || INTERNAL_DONE_STATUSES.has(job.status)
    || job.status === 'Scrap'
    || job.isClosed === true;
}

/** An MR is externally complete only when EVERY job in it is externally done. */
export function isMrExternalComplete(jobsForMr: any[], inspections: any[]): boolean {
  return jobsForMr.every(j => isJobExternallyDone(j, inspections));
}

/** An MR is internally complete only when EVERY job in it is internally done. */
export function isMrInternalComplete(jobsForMr: any[], inspections: any[]): boolean {
  return jobsForMr.every(j => isJobInternallyDone(j, inspections));
}

/**
 * An MR is ready for testing once every job that still needs testing is both
 * externally and internally complete. Scrap jobs are excluded from this check
 * entirely - they're never tested, so their own external/internal state must never
 * block their MR (an MR that is ALL scrap simply never becomes ready for testing,
 * since there's nothing left in it to test).
 * `inspections` is the combined External + Internal inspection list - each record's
 * own `type` field is used to split it, so callers don't need to pre-filter.
 */
export function isMrReadyForTesting(jobsForMr: any[], inspections: any[]): boolean {
  const testableJobs = jobsForMr.filter(j => j.status !== 'Scrap');
  if (testableJobs.length === 0) return false;
  const externalInspections = inspections.filter(i => i.type === 'External');
  const internalInspections = inspections.filter(i => i.type === 'Internal');
  return isMrExternalComplete(testableJobs, externalInspections) && isMrInternalComplete(testableJobs, internalInspections);
}

/**
 * Latest non-empty date (ISO 'YYYY-MM-DD' strings sort correctly lexicographically)
 * across a set of jobs for the given date field, e.g. 'externalInspectionDate'. An MR
 * is only complete when every one of its jobs is, so its stage date is the latest one,
 * not whichever job happens to be first. Returns null if none of them have it set -
 * callers should show a dash, not substitute today's date or a job's createdAt.
 */
export function latestJobDate(jobsForMr: any[], field: string): string | null {
  const dates: string[] = jobsForMr.map(j => j[field]).filter(Boolean);
  if (dates.length === 0) return null;
  return dates.reduce((latest, d) => (d > latest ? d : latest));
}

/**
 * TESTING and DISPATCH completeness.
 *
 * These live here, beside the external/internal helpers, for the reason the others do:
 * stage completeness is defined ONCE. Written inline in a screen it would be copied to the
 * second screen that needed it and the two would drift - which is the "rule enforced at one
 * call site" pattern this audit opens with.
 *
 * `isMrTestingComplete` was declined once before, when nothing called it: a helper with no
 * caller is a future inconsistency, not an asset. Two screens use it now.
 */

/** A job is tested once it carries a testing date, or has moved past testing. */
export function isJobTested(job: any): boolean {
  return Boolean(String(job?.testingDate ?? '').trim())
    || job?.status === 'Tested - Ready for Dispatch'
    || job?.status === 'Dispatched'
    || job?.isClosed === true;
}

/**
 * An MR is tested when every job that CAN be tested is.
 *
 * Scrap is excluded from the denominator, not counted as done: a scrapped unit is never
 * tested, so including it would make a fully-tested MR read "4 of 5" forever. Same exclusion
 * as isMrReadyForTesting, deliberately - the two must agree about what "testable" means.
 * An MR that is entirely scrap has nothing to test and is reported complete with a zero
 * denominator, which callers render as "no testable jobs" rather than "0 of 0".
 */
export function isMrTestingComplete(jobsForMr: any[]): boolean {
  const testable = jobsForMr.filter(j => j.status !== 'Scrap');
  if (testable.length === 0) return true;
  return testable.every(isJobTested);
}

/** Jobs in an MR that testing applies to - scrap excluded. */
export function testableJobs(jobsForMr: any[]): any[] {
  return jobsForMr.filter(j => j.status !== 'Scrap');
}

/** A job is dispatched once it has left on a challan. */
export function isJobDispatched(job: any): boolean {
  return job?.status === 'Dispatched'
    || Boolean(String(job?.challanNo ?? '').trim())
    || job?.isClosed === true;
}

/**
 * An MR is dispatched when EVERY job in it is - scrap INCLUDED.
 *
 * Unlike testing, scrap counts here: a scrapped unit is still physically returned to the
 * division on a delivery challan, so it is part of the dispatch obligation. The two
 * denominators differing is intentional and is the whole reason both helpers exist rather
 * than one generic one.
 */
export function isMrDispatchComplete(jobsForMr: any[]): boolean {
  if (jobsForMr.length === 0) return false;
  return jobsForMr.every(isJobDispatched);
}

export interface StageState {
  /** Every job that this stage applies to has completed it. */
  complete: boolean;
  doneCount: number;
  /** Jobs the stage applies to - scrap is excluded for testing only. */
  total: number;
  /** Latest completion date across the MR, or null. Only meaningful when complete. */
  date: string | null;
}

/**
 * The four stages for one MR, computed once so no screen derives any of it itself.
 *
 * `inspections` is the combined External + Internal list; it is split here by each record's
 * own `type`, so callers do not pre-filter and cannot pre-filter differently from one
 * another.
 */
export function mrStageSummary(jobsForMr: any[], inspections: any[]): {
  external: StageState; internal: StageState; testing: StageState; dispatch: StageState;
} {
  const ext = inspections.filter(i => i.type === 'External');
  const int = inspections.filter(i => i.type === 'Internal');
  const testable = testableJobs(jobsForMr);

  const extDone = jobsForMr.filter(j => isJobExternallyDone(j, ext)).length;
  const intDone = jobsForMr.filter(j => isJobInternallyDone(j, int)).length;
  const testDone = testable.filter(isJobTested).length;
  const dispDone = jobsForMr.filter(isJobDispatched).length;

  return {
    external: {
      complete: isMrExternalComplete(jobsForMr, ext),
      doneCount: extDone, total: jobsForMr.length,
      date: latestJobDate(jobsForMr, 'externalInspectionDate'),
    },
    internal: {
      complete: isMrInternalComplete(jobsForMr, int),
      doneCount: intDone, total: jobsForMr.length,
      date: latestJobDate(jobsForMr, 'internalInspectionDate'),
    },
    testing: {
      complete: isMrTestingComplete(jobsForMr),
      doneCount: testDone, total: testable.length,
      date: latestJobDate(testable, 'testingDate'),
    },
    dispatch: {
      complete: isMrDispatchComplete(jobsForMr),
      doneCount: dispDone, total: jobsForMr.length,
      // deliveryDate is what the challan records as the handover; challanDate is the
      // document's own date and is the fallback when delivery was not entered separately.
      date: latestJobDate(jobsForMr, 'deliveryDate') || latestJobDate(jobsForMr, 'challanDate'),
    },
  };
}
