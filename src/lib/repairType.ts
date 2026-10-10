/**
 * THE THREE VALUES `repairType` MAY HOLD - AND WHY ONLY TWO OF THEM CAN BE CHOSEN (AUDIT G114).
 *
 *     OGP   out of guarantee - ordinary paid repair work
 *     GP    guarantee-period rework, at no cost, on a job the quota already paid for
 *     OH    overhauling - the unit was opened and found serviceable
 *
 * ⚠⚠ `OH` IS DECLARED, NEVER CREATED. A job is never booked as OH at intake, because nobody knows yet: the
 * determination is made at internal inspection, with the unit open on the bench and the engineer looking at it.
 * So the two creation selectors - New Job's repair-category toggle and the MR edit dialog's - deliberately offer
 * `CREATABLE_REPAIR_TYPES`, two options, and `OH` reaches a job only through
 * `lib/inspectionCondition.jobUpdatesForCondition`.
 *
 * A narrower type for the selectors and a wider one for the model is the shape that says this in code rather
 * than in a comment that can be ignored: a dropdown cannot be handed `'OH'` by accident, and nothing that reads
 * a stored job has to pretend the value is impossible.
 *
 * ⚠ WHAT `OH` CHANGES, ALL FROM THIS ONE FIELD:
 *
 *   - `drawsOnAllotment`     false - the agency did not repair it, so it consumed no quota
 *   - `hasNoGuarantee`       true  - overhauling is an act the tender does not guarantee
 *   - `Service Type:`        prints "OH" on the estimate, from `job.repairType`
 *   - pricing                UNCHANGED - it stays on the itemised path. See AUDIT G114 for why this is reading
 *                            (a) and not Schedule-A sr 21.
 *
 * ⚠ AND WHAT IT DOES NOT CHANGE: `coreType`, `jobNo`, `mrNo`. "DONT CHANGE JOB NO WHICH ACTUALLY CREATED".
 *
 * No React, no Firebase - reachable from src/ AND from scripts/admin/ under tsx.
 */

/** Every value a stored job's `repairType` may hold. */
export type RepairType = 'OGP' | 'GP' | 'OH';

/** The two a human may pick when a job is created. See the note above. */
export type CreatableRepairType = 'OGP' | 'GP';

export const CREATABLE_REPAIR_TYPES: ReadonlyArray<{ value: CreatableRepairType; label: string }> = [
  { value: 'OGP', label: 'OGP (Out of Guarantee)' },
  { value: 'GP', label: 'GP (Guarantee Period Warranty)' },
];

/** The value stored when a job is declared overhauled. Same string as `CONDITION_OH`, deliberately. */
export const REPAIR_TYPE_OH: RepairType = 'OH';

/**
 * True when this repair type means the job drew nothing from the allotment.
 *
 * ⚠ READ-ONLY CONVENIENCE - `drawsOnAllotment` remains the one decision, and it asks about scrap too, which
 * this cannot see. Use it for a label, never for a count.
 */
export function repairTypeDrawsNothing(repairType: unknown): boolean {
  const t = String(repairType ?? '').trim().toUpperCase();
  return t === 'GP' || t === 'OH';
}
