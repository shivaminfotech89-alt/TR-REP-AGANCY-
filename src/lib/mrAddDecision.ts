/**
 * MAY A UNIT BE ADDED TO THIS MR? - ONE DEFINITION, CALLABLE WITHOUT A SCREEN (AUDIT G112).
 *
 * ⚠ IT LIVED INSIDE `MrLedger` AND THEREFORE COULD NOT BE TESTED, WHICH IS HOW G111 SHIPPED. The decision composed
 * three things - resolve the MR's AT from its own jobs, check the AT belongs to this agency, check its status - and
 * every check written for it tested the pieces separately. `existingMrIntake` had unit tests. `mrEditJob` has them
 * now. **Nothing ever ran the composition**, and the composition was what was broken: the draft handed in had no
 * `atId`, so the first arm answered "no AT on any job" for every MR in the app.
 *
 * So the whole decision is here, taking plain data. A test can hand it a stored MR's jobs and assert what an
 * operator would see - which is the smallest thing that would have caught G111, and costs no DOM, no browser and no
 * new dependency.
 *
 * ⚠ ALSO THE ONE PLACE THE FIVE MESSAGES LIVE. They are the text an operator reads, so they are worth pinning: a
 * test can assert the wording of the mis-stamped case without rendering anything.
 */
import { existingMrIntake } from './tenderState';

/** A tender, as much of one as this decision needs. */
export interface DecisionAt {
  id: string;
  agencyId?: string;
  atNumber?: string;
  name?: string;
  status?: string;
}

export type MrAddDecision =
  /** A unit may be added, and this is the tender it belongs to - the id the save stamps and the number comes from. */
  | { open: true; atId: string; reason: '' }
  /** Refused, with the sentence an operator reads. */
  | { open: false; reason: string };

/** One MR of this agency, as much as the latest-MR rule needs. */
export interface MrSummary {
  mrNo: string;
  division?: string | null;
  /** When the MR was entered - the earliest `createdAt` among its jobs. */
  createdAt: number;
  /** True when every job on it is cancelled. Such an MR is not "latest": see `latestMrInDivision`. */
  allCancelled: boolean;
}

export interface MrAddInput {
  mrNo: string;
  /** The MR's jobs as the dialog holds them - see lib/mrEditDraft. Only `atId` is consulted. */
  jobs: readonly { atId?: string | null }[];
  /** Every AT this agency has, for resolving the id and reading its status. */
  agencyAts: readonly DecisionAt[];
  agencyId: string;
  agencyName?: string;
  /**
   * The division this MR belongs to, and every MR of this agency - for the latest-MR rule.
   *
   * ⚠ REQUIRED, NOT OPTIONAL, DELIBERATELY. An optional input that a caller forgets silently disables the rule,
   * and a rule that is silently off is the shape G111 shipped. Required means tsc names every call site.
   */
  division?: string | null;
  agencyMrs: readonly MrSummary[];
}

/**
 * THE LATEST MR OF ONE DIVISION - WHICH IS THE ONLY ONE THAT TAKES A NEW UNIT (AUDIT G113).
 *
 * ⚠⚠ PER DIVISION, NOT PER AGENCY, AND THE AGENCY-WIDE VERSION WAS MEASURED AND REJECTED. The job-number series is
 * per division, so `ZBP-7` and `ZSBT-15` never interleave and a BOPAL MR cannot put a SABARMATI number out of
 * sequence. An agency-wide rule would have frozen **three of ZENITH's four divisions** - KALOL, SABARMATI and
 * BAVLA - because a BOPAL MR happened to be entered most recently, and the same for MEGHA's KALOL and AARATI's
 * SABARMATI. The sequence argument only applies within one series.
 *
 * ⚠ BY `createdAt`, NOT BY MR NUMBER OR DATE. MR numbers are division references - `STD-02`, `00008`, and one
 * that is 451 followed by a stray backtick - and are not ordered. `dateOfIssue` is operator-typed and ties: SAMOR's MR 2938 and MR 2222 share 2026-09-11 and
 * disagree about which is later.
 *
 * ⚠ FULLY CANCELLED MRs ARE NOT CANDIDATES, OR THE ROUTE OUT OF THIS RULE BLOCKS ITSELF. The way to add to an older
 * MR is to cancel the newer one, add, then reactivate - and if a cancelled MR still counted as latest, cancelling
 * it would change nothing. Live proof that this is not hypothetical: GUJARAT ENERGY's latest MR, 1217, is fully
 * cancelled, so without this its live MR 1742 could never take a unit.
 */
export function latestMrInDivision(
  mrs: readonly MrSummary[],
  division: string | null | undefined,
): MrSummary | null {
  const want = String(division ?? '').trim().toUpperCase();
  const candidates = mrs
    .filter(m => !m.allCancelled)
    .filter(m => String(m.division ?? '').trim().toUpperCase() === want);
  if (!candidates.length) return null;
  return candidates.reduce((latest, m) => (m.createdAt > latest.createdAt ? m : latest));
}

/**
 * The MR's own tender, from its own jobs - never from the session (F66).
 *
 * Returns the id when the jobs agree on exactly one and none is blank; otherwise the sentence saying why not.
 */
export function resolveMrAt(input: Pick<MrAddInput, 'mrNo' | 'jobs'>): { atId: string } | { error: string } {
  const trimmed = input.jobs.map(j => String(j?.atId ?? '').trim());
  const ids = [...new Set(trimmed.filter(Boolean))];
  const without = trimmed.filter(v => !v).length;

  if (ids.length === 1 && without === 0) return { atId: ids[0] };

  /**
   * ⚠ EVERY MESSAGE BELOW IS ABOUT ADDING A TRANSFORMER, AND ONLY FIRES WHEN ONE IS BEING ADDED (AUDIT G79). They
   * were accurate about the case they were written for and silent about the case they were shown for: an operator
   * who renamed an MR number met three sentences on job numbering and AT percentages, none of which described what
   * they had done.
   */
  if (ids.length === 0) {
    return { error: `A transformer cannot be added to MR ${input.mrNo}: it does not record which AT it was issued under - none of its ${input.jobs.length} transformer(s) carries one.

A new unit would have no tender to take its job number and AT percentage from.

The units already on this MR can still be edited - their numbers, serials, MR number and status all save normally. Set the AT on them if you need to add one.` };
  }
  if (ids.length === 1) {
    return { error: `A transformer cannot be added to MR ${input.mrNo}: it is partly unstamped - ${without} of its ${input.jobs.length} transformer(s) carry no AT.

The AT is known from the others, but adding a unit while the MR disagrees with itself would spread the inconsistency.

The units already on this MR can still be edited. Set the AT on the unstamped ones if you need to add one.` };
  }
  return { error: `A transformer cannot be added to MR ${input.mrNo}: its transformers sit under ${ids.length} DIFFERENT ATs.

An MR belongs to one tender, so there is no single sequence to draw a job number from and no single percentage to price a new unit at.

The units already on this MR can still be edited.` };
}

/** The whole gate: the MR's tender, that it belongs here, and that it still takes work. */
export function mrAddDecision(input: MrAddInput): MrAddDecision {
  const at = resolveMrAt(input);
  if ('error' in at) return { open: false, reason: at.error };

  const master = input.agencyAts.find(a => String(a.id) === String(at.atId));

  /**
   * ⚠ THE FIFTH CASE (AUDIT G107). `resolveMrAt` succeeds whenever the jobs agree on ONE atId - it does not ask
   * whether that id names a tender this agency has. One live MR is in exactly that state: AARATI's MR 12 carries
   * job MSBT-5 - a MEGHA prefix - stamped with MEGHA's AT.
   *
   * Refused, because nothing here can be answered honestly: no series to draw a number from, no percentage to
   * price at, and the app cannot tell whether the job is in the wrong agency or the tender is (F22's shape). The
   * wording states the fault without blaming the operator and points at the diagnostic, because no screen can
   * re-stamp a job's AT.
   */
  if (!master || String(master.agencyId ?? '') !== String(input.agencyId ?? '')) {
    return {
      open: false,
      reason: `A transformer cannot be added to MR ${input.mrNo}: it is stamped with a tender that does not belong to ${input.agencyName || 'this agency'}.

This is a fault in the record rather than anything done on this screen - the transformer and the tender it names sit under different agencies, so there is no series to take a job number from and no accepted percentage to price a new unit at.

The units already on this MR can still be edited, inspected, tested and dispatched. Correcting the stamp is an administrator's job: scripts/find-misattached-at-console.js reports whether the tender or the transformer is the one in the wrong place.`,
    };
  }

  /**
   * ⚠ THE TENDER IS ASKED BEFORE THE SEQUENCE, AND THE ORDER IS THE POINT (AUDIT G113).
   *
   * A Closed tender cannot be opened from this screen; a not-the-latest MR can be reached by cancelling the newer
   * one. Telling an operator to walk a three-step route and then refusing them at the end for a reason no route
   * can fix is G107's trap - "pick the tender this MR belongs to", which led straight to "superseded". So the
   * unfixable refusal comes first.
   *
   * Live case: SAMOR's MR 2938 is the latest in its division AND on a Closed tender. It gets the Closed message.
   */
  const gate = existingMrIntake(master as any);
  if (!gate.open) {
    return {
      open: false,
      reason: `A transformer cannot be added to MR ${input.mrNo}: ${gate.reason}

The units already on this MR can still be edited, inspected, tested and dispatched.`,
    };
  }

  /**
   * ⚠⚠ ONLY THE LATEST MR OF THE DIVISION TAKES A NEW UNIT - the owner's rule, 2026-10-07.
   *
   * The reasoning is about paper rather than arithmetic: a unit added to an older MR gets a job number out of
   * sequence with the MRs around it, and that is confusing to read however correct the number is. The existing
   * route handles it properly and keeps every number in order.
   */
  const latest = latestMrInDivision(input.agencyMrs, input.division);
  if (latest && String(latest.mrNo) !== String(input.mrNo)) {
    const where = String(input.division ?? '').trim();
    return {
      open: false,
      reason: `A transformer cannot be added to MR ${input.mrNo} - it is not the latest MR${where ? ` in ${where}` : ''}.

MR ${latest.mrNo} was received after it, so a unit added here would take a job number out of sequence with the MRs around it. Correct on the counter, confusing on paper.

To add a transformer to MR ${input.mrNo}: cancel MR ${latest.mrNo} - which releases its job numbers and keeps the record, jobs and all - then add the transformer here so it takes the next free number, then reactivate MR ${latest.mrNo}. Three steps, and Reactivate is a button on the cancelled MR rather than re-entering it.

If the new unit takes a number the cancelled MR held, you will be asked to renumber before reactivating - that is a known step, not a fault.

The recreated MR is yours to see through; the app does not track that you have done it.

The units already on MR ${input.mrNo} can still be edited, inspected, tested and dispatched.`,
    };
  }

  return { open: true, atId: at.atId, reason: '' };
}
