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

export interface MrAddInput {
  mrNo: string;
  /** The MR's jobs as the dialog holds them - see lib/mrEditDraft. Only `atId` is consulted. */
  jobs: readonly { atId?: string | null }[];
  /** Every AT this agency has, for resolving the id and reading its status. */
  agencyAts: readonly DecisionAt[];
  agencyId: string;
  agencyName?: string;
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

  const gate = existingMrIntake(master as any);
  if (gate.open) return { open: true, atId: at.atId, reason: '' };
  return {
    open: false,
    reason: `A transformer cannot be added to MR ${input.mrNo}: ${gate.reason}

The units already on this MR can still be edited, inspected, tested and dispatched.`,
  };
}
