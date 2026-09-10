/**
 * THE FOUR PROVENANCES, IN ONE VOCABULARY (AUDIT G34).
 *
 * A subscription is read by two screens that answer different questions - the owner's panel in
 * Agency Settings ("what do I have, and when does it run out") and the vendor's table in the
 * Admin Panel ("which of these has been paid for"). They render differently and they must
 * CLASSIFY identically.
 *
 * ⚠ TWO COPIES OF THIS WOULD DRIFT, and the session that produced this file is a catalogue of
 * exactly that: two agency-name spellings, two subtitles on the two screens a user sees first,
 * two spellings of a subscription expiry field where only the unvalidated one was written. The
 * classification of a payment is a worse candidate than any of them.
 *
 * ⚠ `admin` IS TESTED BEFORE EXPIRY, AND THE ORDER IS THE WHOLE GUARD. An admin-created agency
 * has `expiryDate: null`, so `expiry` is 0, so an expiry test reached first would find
 * `0 < now` and call it EXPIRED. A subscription that never existed rendered as one that lapsed
 * is the same class of lie as one that never existed rendered as ACTIVE PAID (G28) - it just
 * errs the other way, and erring safe is still asserting something untrue.
 *
 * ⚠ AND ABSENCE IS A CASE, NOT A DEFAULT. `none` is returned for an agency with no subscription
 * document, and every caller must render it as absence. The whole of G28 was a screen supplying
 * a plausible value where the missing one belonged.
 */

export type SubscriptionRecord = {
  status?: string;
  planAmount?: number;
  startDate?: number;
  expiryDate?: number | null;
  grantReason?: string;
  invoicePending?: boolean;
  lastPaymentDate?: number;
  origin?: string;

  /**
   * ⚠ CANCELLATION IS A DIFFERENT AXIS FROM PROVENANCE, WHICH IS WHY IT IS NOT A FIFTH STATUS
   * (AUDIT G40). `active`, `granted` and `admin` say how a subscription CAME TO BE. Cancelled
   * says how it ENDED - and something that was granted and then cancelled is both, so folding
   * them into one field would force a choice between two facts that are both true.
   *
   * The practical outcome of a cancellation is an expiry in the past, which the vocabulary
   * already handles. What it did not carry was WHY, and a subscription that ran out and one
   * that was ended are different facts even though both are expired.
   */
  cancelledAt?: number;
  cancelledBy?: string;
  cancelReason?: string;

  /**
   * ⚠ PAID, BUT NOT BY THE GATEWAY. Recorded by the vendor against a cheque, a UTR or a cash
   * receipt. It counts as revenue - money was received - and it must stay distinguishable from
   * a Razorpay payment, because only one of the two has a gateway record behind it to reconcile
   * against. A single "paid" flag would lose that, and the loss would only surface at a
   * reconciliation nobody could complete.
   */
  manualPayment?: boolean;
  paymentReference?: string;
  recordedBy?: string;

  /** Present only on a gateway-verified payment. The presence IS the verification. */
  razorpayPaymentId?: string;
};

export type SubscriptionKey = 'none' | 'admin' | 'expired' | 'granted' | 'active';

export type SubscriptionClass = {
  key: SubscriptionKey;
  /** The word on the badge. Never colour alone - see ui.ts rule 1. */
  word: string;
  /** Badge classes, light-mode. */
  tone: string;
  /** Whether an expiry DATE exists to show. False for `admin` and `none`. */
  hasExpiry: boolean;
  /**
   * Whether money was received. TRUE for a manual payment as well as a gateway one - the
   * question this answers is "is this revenue", and a cheque is.
   */
  wasPaid: boolean;
  /**
   * Whether a GATEWAY record exists behind it. False for a manual payment even though that is
   * still revenue. `wasPaid && !verified` is exactly the set a reconciliation has to chase by
   * hand, which is why the two are separate booleans and not one.
   */
  verified: boolean;
  /** Ended deliberately rather than lapsing. Only meaningful when `key === 'expired'`. */
  cancelled: boolean;
};

export const DAY_MS = 24 * 60 * 60 * 1000;

export function classifySubscription(
  sub: SubscriptionRecord | null | undefined,
  now: number,
): SubscriptionClass {
  const cancelled = !!sub?.cancelledAt;
  const paidSomehow = sub?.status === 'active';
  const verified = !!sub?.razorpayPaymentId && !sub?.manualPayment;

  if (!sub) {
    return {
      key: 'none',
      word: 'NOT BILLED',
      tone: 'bg-slate-100 text-slate-600 border-slate-300',
      hasExpiry: false,
      wasPaid: false,
      verified: false,
      cancelled: false,
    };
  }

  // ⚠ FIRST. See the header - an admin subscription has no expiry, and an expiry test reached
  // before this one would read its null as a date in 1970 and call it lapsed.
  if (sub.status === 'admin') {
    return {
      key: 'admin',
      word: 'ADMIN',
      tone: 'bg-violet-100 text-violet-800 border-violet-300',
      hasExpiry: false,
      wasPaid: false,
      verified: false,
      cancelled: false,
    };
  }

  const expiry = Number(sub.expiryDate || 0);
  /**
   * ⚠ `<= now`, NOT `< now`, AND `cancelled` FORCES IT REGARDLESS.
   *
   * Cancelling writes `expiryDate: now` - that is the whole of what "cancel" means here, since
   * `expired` is derived rather than stored. With a strict `<` the two were equal at that
   * instant, so a subscription rendered ACTIVE at the exact moment it was cancelled and only
   * flipped a millisecond later. A test using the value the code actually writes is what found
   * it; one using `now - 1` would have passed and shipped it.
   *
   * `cancelled ||` makes the intent independent of clock arithmetic altogether: an ended
   * subscription is ended, whatever the comparison says about the boundary.
   */
  if (cancelled || (expiry && expiry <= now)) {
    return {
      key: 'expired',
      // ⚠ THE WORD SAYS WHICH, THE KEY DOES NOT. Cancelled and lapsed resolve to the same
      // practical state and the same handling, so they share a key; but they are different
      // facts and the row must not present an ended subscription as one that ran out.
      word: cancelled ? 'CANCELLED' : 'EXPIRED',
      tone: 'bg-red-100 text-red-800 border-red-300',
      hasExpiry: true,
      wasPaid: paidSomehow,
      verified,
      cancelled,
    };
  }

  if (sub.status === 'granted') {
    return {
      key: 'granted',
      word: 'GRANTED',
      tone: 'bg-blue-100 text-blue-800 border-blue-300',
      hasExpiry: true,
      wasPaid: false,
      verified: false,
      cancelled: false,
    };
  }

  return {
    key: 'active',
    // ⚠ THE BADGE SAYS THE PAYMENT WAS MANUAL. It is revenue either way, and it is not the
    // same kind of record: one can be reconciled against a gateway statement and one has to be
    // chased through a cheque book.
    word: sub.manualPayment ? 'ACTIVE (MANUAL)' : 'ACTIVE',
    tone: 'bg-green-100 text-green-800 border-green-300',
    hasExpiry: true,
    wasPaid: true,
    verified,
    cancelled: false,
  };
}

/** Whole days from now until expiry. Null when there is no expiry to count to. */
export function daysRemaining(sub: SubscriptionRecord | null | undefined, now: number): number | null {
  const expiry = Number(sub?.expiryDate || 0);
  if (!expiry) return null;
  return Math.ceil((expiry - now) / DAY_MS);
}
