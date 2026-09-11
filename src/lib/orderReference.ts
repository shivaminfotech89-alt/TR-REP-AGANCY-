/**
 * THE ORDER AN ESTIMATE NAMES - FROM THE JOB'S OWN TENDER, OR NOTHING (AUDIT O61, G63).
 *
 * The estimate prints "Order No.: ..., Dt.: ..." - the A/T letter the work is done under. It used to
 * read two agency fields nothing ever wrote, then `atMaster.orderNo`, which nothing wrote either, and
 * then print a hardcoded `UGVCL/EE-T-1/TRANS-REP/2020-21/01/1102` dated `16/04/2021`. Every estimate in
 * the database named that 2020-21 order, whatever tender its job was on - including one sent under a
 * UGVCL-2026 allotment.
 *
 * ⚠ THE JOB'S OWN AT, AND ONLY IT. Pricing keeps its documented `?? activeAtMaster` fallback for a job
 * with no AT; the order must not follow it, because the active tender's letter is someone else's
 * order. So this takes the RESOLUTION, which says why there is no AT, not just the AT.
 *
 * ⚠ UNSET IS A REFUSAL, NEVER A DEFAULT. Both fields blank print blank, and `refusal` says why the
 * estimate cannot be printed, downloaded or sent. A document that will not print is recoverable in a
 * minute; one naming the wrong tender goes to a division office and stays in its file.
 *
 * No Firebase import - types only - so the rule is testable under `npm test` (O57).
 */
import type { AtMaster, atResolutionForJob } from './AgencyContext';

type AtResolution = ReturnType<typeof atResolutionForJob>;

export interface OrderReference {
  /** The A/T reference exactly as entered on the AT, trimmed; '' when there is nothing to print. */
  orderNo: string;
  /** The A/T letter's date as entered (YYYY-MM-DD); '' when there is nothing to print. */
  orderDate: string;
  /** Why an estimate carrying this reference must not leave, or null when both parts are present. */
  refusal: string | null;
  /** The AT it was read from - null when the job has no tender of its own. */
  at: AtMaster | null;
}

export function orderReferenceFor(resolution: AtResolution, jobLabel: string): OrderReference {
  if (resolution.source === 'no-at') {
    return {
      orderNo: '', orderDate: '', at: null,
      refusal: `${jobLabel} belongs to no tender, so its estimate cannot name an order. Assign the job to the AT it was booked under.`,
    };
  }
  if (resolution.source === 'at-missing') {
    return {
      orderNo: '', orderDate: '', at: null,
      refusal: `${jobLabel} names a tender that no longer exists, so its estimate cannot name an order.`,
    };
  }
  const at = resolution.at;
  const orderNo = String(at.orderNo ?? '').trim();
  const orderDate = String(at.orderDate ?? '').trim();
  const missing = [orderNo ? '' : 'order number', orderDate ? '' : 'order date'].filter(Boolean);
  return {
    orderNo,
    orderDate,
    at,
    refusal: missing.length === 0
      ? null
      : `AT ${at.atNumber || at.name || at.id} has no ${missing.join(' or ')}. Enter the number and date from its A/T letter on the AT before an estimate under it is printed or sent.`,
  };
}

export interface OrderRefusal {
  /** One line per distinct reason; jobs sharing an AT are listed on that AT's line. */
  lines: string[];
  /** The first AT named, for a link to its settings; null when every refusal is a job with no AT. */
  at: AtMaster | null;
}

/** The refusal for a set of estimates about to leave together, or null when all of them can. */
export function orderRefusalFor(items: Array<{ jobLabel: string; ref: OrderReference }>): OrderRefusal | null {
  const byReason = new Map<string, { at: AtMaster | null; jobs: string[] }>();
  for (const { jobLabel, ref } of items) {
    if (!ref.refusal) continue;
    const entry = byReason.get(ref.refusal) ?? { at: ref.at, jobs: [] };
    entry.jobs.push(jobLabel);
    byReason.set(ref.refusal, entry);
  }
  if (byReason.size === 0) return null;
  const lines = [...byReason].map(([reason, { at, jobs }]) => (at ? `${reason} Jobs: ${jobs.join(', ')}.` : reason));
  return { lines, at: [...byReason.values()].find(e => e.at)?.at ?? null };
}
