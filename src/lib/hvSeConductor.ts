/**
 * THE HV COIL CONDUCTOR'S INSULATION - S.E. OR DPC, AND WHEN THE QUESTION ARISES (AUDIT G105).
 *
 * The HV winding's conductor is insulated one of two ways, and Schedule-A prices the coil differently for each:
 *
 *   - **S.E.** - Super Enamelled, an enamel coating on the conductor.
 *   - **DPC** - Double Paper Cover, paper insulation on the conductor instead of Super Enamelled.
 *
 * ⚠ "NOT S.E." WAS THE WRONG LABEL, AND WRONG IN A WAY THAT MATTERED. It read as the ABSENCE of something - a job
 * where S.E. had not been done - when it is a different insulation that was done instead. An operator choosing
 * between "S.E." and "Not S.E." is being asked whether a thing is missing; between "S.E." and "DPC (not S.E.)" they
 * are being asked which of two materials is on the coil. Corrected by the operator, 2026-10-01.
 *
 * ⚠⚠ THE QUESTION ARISES FOR ALUMINIUM ONLY. A copper HV winding has no S.E./DPC selection - copper windings in this
 * work are not Super Enamelled, so the question does not arise and asking it invited a meaningless answer. See
 * `hvSeApplies`, and see the pricing consequence recorded with it.
 *
 * ⚠ THE STORED VALUES DO NOT CHANGE. `WITH_SE` and `WITHOUT_SE` are what is on disk and what the estimate reads to
 * select Schedule-A 12A. Renaming them to match the label would make every consumer's comparison miss, silently -
 * the same trap recorded against DAM/DMG in lib/inspectionAbbreviations, where the dropdown still emits the stored
 * term on purpose. Only the LABEL changes here.
 */

/** What is written to the inspection record. Unchanged since G61 - see the warning above. */
export const HV_SE_WITH = 'WITH_SE';
export const HV_SE_WITHOUT = 'WITHOUT_SE';

/** What the operator reads. `WITHOUT_SE` names the material that is there, not the one that is not. */
export const HV_SE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: HV_SE_WITH, label: 'S.E.' },
  { value: HV_SE_WITHOUT, label: 'DPC (not S.E.)' },
];

/** The printed and on-screen cell for a job the question does not apply to - the legend's "not applicable". */
export const HV_SE_NOT_APPLICABLE = '-';

/**
 * Whether the S.E./DPC question arises for this winding material (AUDIT G105).
 *
 * ⚠ SUPPRESSED ONLY WHERE THE MATERIAL IS POSITIVELY KNOWN TO BE COPPER. An unclassified winding type - blank, or a
 * spelling `classifyWindingMaterial` does not recognise - still gets the question. That is the narrower claim and the
 * safer direction: it can ask a question that turns out not to apply, never silently withhold one that does. A job
 * whose material cannot be classified is blocked by the estimate on that ground anyway, before any coil rate is read.
 */
export function hvSeApplies(material: 'Copper' | 'Aluminium' | null): boolean {
  return material !== 'Copper';
}

/**
 * ⚠⚠ A PRICING DECISION, NOT A DISPLAY ONE - AND A SCHEDULE ROW THIS APP CAN NO LONGER REACH (AUDIT G105).
 *
 * Schedule-A prices copper on the S.E. axis in both tenders:
 *
 *   | row       | meaning                   | UGVCL-2020 | UGVCL-2026 |
 *   |-----------|---------------------------|------------|------------|
 *   | `12A-a`   | copper, without S.E.      | Rs 357/kg  | Rs 360/kg  |
 *   | `12A-a1`  | copper, WITH S.E.         | Rs 407/kg  | Rs 411/kg  |
 *
 * With the question withdrawn for copper, **a copper HV coil prices at `12A-a` permanently** and `12A-a1` becomes
 * unreachable. That forecloses **Rs 50/kg** (Rs 51 on UGVCL-2026) and is accepted on the owner's decision of
 * 2026-10-01, for this reason: **copper windings in this work are not Super Enamelled, so `12A-a1` describes a
 * combination that does not occur. The tender prices it; the workshop never sees it.**
 *
 * ⚠ RECORDED AS AN UNREACHABLE PRICED ROW, THE SAME CLASS AS THE ORIGINALS-MISSING ROWS (O21), SO NOBODY LATER
 * "COMPLETES THE SET". A future reader finding `12A-a1` transcribed and unused should read this before wiring it up:
 * it is unused because the work does not exist, not because the app is incomplete. `12B-a1` - originals missing, with
 * S.E. - is unreachable for both reasons at once.
 *
 * It cost nothing when taken: of 123 live internal inspections only two were copper, neither answered `WITH_SE`, and
 * both carried a zero HV coil weight, so no job on the database priced a copper HV coil at all.
 */
export const COPPER_HV_SCHEDULE_ROW = '12A-a';
