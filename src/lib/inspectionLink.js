/**
 * WHICH INSPECTION BELONGS TO THIS JOB (AUDIT G4).
 *
 * ⚠ PLAIN .js SO THE APP AND THE ADMIN SCRIPTS SHARE ONE DEFINITION. `tsconfig` sets
 * `allowJs` and the package is `"type": "module"`, so Vite and plain Node import this same
 * file. Seven copies of this matcher existed - oilBalance.ts, BillingSystem twice, OilInward,
 * and three scripts - each character-identical and each free to drift. It decides whether an
 * inspection's measurements apply to a transformer, so a divergence changes an oil shortage
 * on a document sent to a division.
 *
 * ⚠ A BRANCH THAT COULD NEVER MATCH WAS REMOVED. The matcher read:
 *
 *     i.jobId === job.id || i.jobId === job.jobNo || i.id === job.inspectionId ||
 *     (i.mrNo === job.mrNo && i.jobNo === job.jobNo)          <- deleted
 *
 * NO inspection carries `mrNo` or `jobNo`. Measured against live data: 0 of 103 for each.
 * Neither inspection save path has ever written them, so that clause compared `undefined`
 * against a job's real value and was false every time it ran.
 *
 * That is the F44 / F53 shape - a comparison against a literal the producing code never emits
 * - and it is worse here than in a price, because it sits in the function that decides
 * whether an inspection BELONGS to a job. A reader seeing four link routes concludes the link
 * is robust; there was only ever one.
 *
 * ⚠ THE FIELDS WERE NOT POPULATED TO MAKE THE BRANCH WORK, DELIBERATELY. `jobId` is the link,
 * it works, and nothing needs a second route. Filling in `mrNo`/`jobNo` would create a SECOND
 * LINKING RULE THAT CAN DISAGREE WITH THE FIRST - a job renumbered or moved between MRs would
 * match by one route and not the other, and which answer you got would depend on which clause
 * ran first. One rule cannot disagree with itself.
 *
 * WHAT REMAINS, and why each is real:
 *   - `i.jobId === job.id`        the normal case, written by both inspection screens
 *   - `i.jobId === job.jobNo`     older records stored the job NUMBER in jobId
 *   - `i.id === job.inspectionId` the job pointing back at its inspection
 * The trailing fallback drops the type filter: a job whose only inspection is untyped or
 * internal still resolves rather than silently reading as "never inspected".
 */

/** The external inspection for a job, by any of the three ways they are actually linked. */
export function inspectionFor(job, inspections) {
  return inspections.find(i =>
    (i.jobId === job.id || i.jobId === job.jobNo || i.id === job.inspectionId) &&
    (i.type === 'External' || !i.type || i.data?.oilCapLtrs !== undefined)
  ) || inspections.find(i => i.jobId === job.id);
}

/** Every inspection attached to a job, whatever its type - for cascade deletion (AUDIT G4). */
export function inspectionsForJob(job, inspections) {
  return inspections.filter(i =>
    i.jobId === job.id || i.jobId === job.jobNo || i.id === job.inspectionId
  );
}
