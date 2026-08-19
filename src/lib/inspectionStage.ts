// Single source of truth for what "done" means at each inspection stage (External,
// Internal) across the screens that read it. Pending/Completed filters and row badges
// must both go through these so they can never disagree with each other again.

// Statuses at or past External inspection in the job lifecycle
// (blank / 'Received') -> External Done -> Internal Done -> Ready for Testing ->
// Testing Completed -> Dispatched, with Scrap reachable as an alternate terminal status.
const EXTERNAL_DONE_STATUSES = new Set([
  'External Done', 'Internal Done', 'Ready for Testing', 'Testing Completed', 'Dispatched'
]);

const INTERNAL_DONE_STATUSES = new Set([
  'Internal Done', 'Ready for Testing', 'Testing Completed', 'Dispatched'
]);

/**
 * Whether a saved inspection record actually has meaningful data in it, rather than
 * being an empty shell that only exists because a save happened. Checked two ways:
 *
 * 1. `data.inspectedBy` - the reliable signal going forward. The External/Internal
 *    forms now require an inspector name before they'll save at all, so any record
 *    saved from here on has this set. A record with a name on it is unambiguously
 *    a real inspection.
 * 2. For legacy records saved before that field existed, a per-type heuristic:
 *    - Internal: at least one coil/winding weight field, or a per-phase damage note,
 *      or an explicit Scrap condition. These fields genuinely default to blank on
 *      the form, so a non-blank value is a reliable signal someone filled them in.
 *    - External: `namePlate !== '-'`. Every other External field auto-fills a
 *      plausible-looking default the moment the form opens (sealType='BL',
 *      nuteBolt='Y', etc.), so none of them can distinguish "reviewed and OK" from
 *      "never touched" - namePlate is the only field with a genuine unset sentinel.
 *      This is a heuristic for old data, not a permanent rule.
 */
export function hasInspectionData(record: any): boolean {
  const data = record?.data;
  if (!data) return false;
  if (data.inspectedBy && String(data.inspectedBy).trim() !== '') return true;

  if (record.type === 'Internal') {
    const hasCoilWeight = [data.totWt, data.wtOfCoil, data.totWtLv, data.wtOfCoilLv]
      .some(v => v !== undefined && v !== null && String(v).trim() !== '');
    const hasDamageNote = [data.damR, data.damY, data.damB]
      .some(v => v !== undefined && v !== null && String(v).trim() !== '');
    const isScrapDecision = data.condition === 'Scrap';
    return hasCoilWeight || hasDamageNote || isScrapDecision;
  }

  // External (or unrecognized type): legacy namePlate heuristic.
  return data.namePlate !== undefined && data.namePlate !== '-';
}

/**
 * A job counts as externally done when it has an External-type inspection record
 * with real data in it, its status is at/past External Done, it's Scrap (a scrapped
 * transformer isn't inspected further), or it's closed.
 */
export function isJobExternallyDone(job: any, inspections: any[]): boolean {
  return inspections.some(i => i.jobId === job.id && hasInspectionData(i))
    || EXTERNAL_DONE_STATUSES.has(job.status)
    || job.status === 'Scrap'
    || job.isClosed === true;
}

/** Same idea, for internal inspection. */
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
 * An MR is ready for testing once it's both externally and internally complete.
 * `inspections` is the combined External + Internal inspection list - each record's
 * own `type` field is used to split it, so callers don't need to pre-filter.
 */
export function isMrReadyForTesting(jobsForMr: any[], inspections: any[]): boolean {
  const externalInspections = inspections.filter(i => i.type === 'External');
  const internalInspections = inspections.filter(i => i.type === 'Internal');
  return isMrExternalComplete(jobsForMr, externalInspections) && isMrInternalComplete(jobsForMr, internalInspections);
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
