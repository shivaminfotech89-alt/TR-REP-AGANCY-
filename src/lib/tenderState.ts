/**
 * WHAT A TENDER IS OPEN TO — THE PURE RULES, LIFTED OUT SO THEY CAN BE TESTED (AUDIT G93).
 *
 * These four moved here UNCHANGED from AgencyContext.tsx. Nothing about them needed React,
 * Firebase or a browser, but the file they lived in imports `./firebase` at its second line
 * and reads `localStorage` at module scope, so anything importing them dragged an initialised
 * Firebase app into the importer. A node test could not touch them at all.
 *
 * That mattered the moment a second reader appeared. The notifications panel asks the same
 * questions the screens ask — is this work unassigned, is this tender open, is more than one
 * marked Active — and the alternative to lifting them was a SECOND copy of each predicate,
 * which is precisely the fault G92 was committed to fix. One definition, two readers.
 *
 * ⚠ AgencyContext RE-EXPORTS ALL OF THESE, so every existing `from '../lib/AgencyContext'`
 * import keeps working and no screen changed. Import them from either place; there is only one.
 *
 * ⚠ TYPE-ONLY IMPORT, DELIBERATELY. `AtMaster` comes back from AgencyContext as a type, which
 * TypeScript erases, so there is no runtime cycle between the two files. This is the shape
 * lib/orderReference.ts already uses for the same reason.
 */
import type { AtMaster } from './AgencyContext';

/** Is this document unattributed to any tender? True for BOTH an absent atId and an empty one. */
export const isUnassigned = (row: any): boolean => !String(row?.atId ?? '').trim();

/**
 * IS THIS TENDER OPEN TO NEW WORK? (AUDIT F83)
 *
 * Once a new AT starts, the old one accepts NO NEW WORK - no new MRs, no new jobs, no new
 * oil entries. It stays fully usable for everything already booked under it: inspections,
 * testing, challans, estimates, bills, reports. A transformer received under 26-27 is
 * inspected, tested and dispatched under 26-27, whenever that work actually happens.
 *
 * ONE FUNCTION, THREE CALLERS - New Job, MrLedger's add-unit, and Oil Inward. Those are the
 * only three paths in the app that create a job, an MR or an oil transaction; everything
 * else writes onto a record that already exists. Three copies of this test is the shape that
 * has cost this session twice already (F73's three publish paths, F81's two parsers).
 *
 * THE RULES, IN ORDER:
 *
 *   1. `status === 'Closed'` -> CLOSED. Unambiguous and operator-declared.
 *
 *   2. Not the agency's CURRENT tender -> CLOSED. Current is the Active AT with the latest
 *      `startDate`. `status === 'Active'` alone is not enough: UPENDRA has TWO ATs marked
 *      Active in live data, and on the plain test both would accept new work, one of them a
 *      tender that finished years ago.
 *
 *   3. Anything else - blank, unrecognised, or the only tender there is -> OPEN. Deliberate.
 *      Every existing AT predates this rule, and refusing intake because a field was never
 *      set would break working agencies on a technicality, silently, with nothing telling
 *      whoever configured them what happened.
 */
export interface IntakeGate {
  open: boolean;
  /** Why it is closed, in the operator's terms. Empty when open. */
  reason: string;
  /** The tender that IS open, when this one is not - so the message can offer it. */
  currentAt: AtMaster | null;
}

/**
 * THE AGENCY'S CURRENT TENDER — the Active AT with the latest start date.
 *
 * ONE DEFINITION, used by `isIntakeOpen` to decide what accepts new work AND by the sign-in
 * default to decide what to select. Two definitions of "current" is how the tender an
 * operator lands on comes to differ from the tender they are allowed to work in - which is
 * precisely the confusion the default exists to remove (AUDIT F84).
 *
 * `startDate` is the tender period the operator typed, which is the right ordering for
 * "the one in force". Creation order is not: an AT created later can start earlier.
 */
export function currentTenderFor(agencyAts: AtMaster[]): AtMaster | null {
  const active = agencyAts
    .filter(t => String(t.status || '').toLowerCase() === 'active')
    .sort((a, b) => (b.startDate || 0) - (a.startDate || 0));
  return active[0] || null;
}

export function isIntakeOpen(
  at: AtMaster | null | undefined,
  agencyAts: AtMaster[],
  /** Optional: lets the refusal say "All tenders" instead of "nothing selected" (F87). */
  viewingAllTenders = false,
): IntakeGate {
  const currentAt = currentTenderFor(agencyAts);

  if (!at) {
    // TWO DIFFERENT NULLS, ONE REFUSAL (AUDIT F87). "All tenders" is a scope the operator
    // deliberately chose, so telling them nothing is selected is simply wrong and sends them
    // looking for a setting they already set. The refusal is identical either way - there is
    // no single AT to book into - only the explanation differs.
    if (viewingAllTenders) {
      return {
        open: false,
        reason: 'The scope is All tenders. New work is recorded against ONE tender, so pick the tender this MR belongs to.',
        currentAt,
      };
    }
    return { open: false, reason: 'No tender is selected. New work is recorded against a tender.', currentAt };
  }

  const label = at.atNumber || at.name || at.id;

  // 1
  if (String(at.status || '').toLowerCase() === 'closed') {
    return {
      open: false,
      reason: `AT ${label} is marked Closed, so no new MRs, jobs or oil entries can be recorded against it.`,
      currentAt,
    };
  }

  // 2
  if (currentAt && currentAt.id !== at.id) {
    return {
      open: false,
      reason: `AT ${label} has been superseded by AT ${currentAt.atNumber || currentAt.name}. New work belongs to the current tender.`,
      currentAt,
    };
  }

  // 3
  return { open: true, reason: '', currentAt: currentAt || at };
}

/**
 * MORE THAN ONE TENDER MARKED ACTIVE — a data fault the app can see (AUDIT F83).
 *
 * `isIntakeOpen` rule 2 handles it safely by taking the latest, so nothing breaks. But a
 * fault the app can see and does not mention is one nobody fixes, so Tenders names it.
 */
export function otherActiveAts(at: AtMaster, agencyAts: AtMaster[]): AtMaster[] {
  if (String(at.status || '').toLowerCase() !== 'active') return [];
  return agencyAts.filter(t =>
    t.id !== at.id &&
    t.agencyId === at.agencyId &&
    String(t.status || '').toLowerCase() === 'active');
}
