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
   * Written beside the amount by the payment functions, and declared here so the document that RENDERS a payment -
   * the receipt - reads them by name instead of casting past the type (AUDIT G71).
   */
  currency?: string;
  ownerEmail?: string;
  agencyName?: string;
  razorpayOrderId?: string;

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

export type SubscriptionKey =
  'none' | 'admin' | 'trial' | 'trial_ended' | 'expired' | 'granted' | 'active';

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
  /**
   * ⚠ WHETHER NEW WORK MAY BE RECORDED. The one question every gated screen asks, answered here
   * so eleven components cannot each decide it differently - which is how G42's three guarantee
   * periods came to disagree.
   *
   * False only for a trial that has ended. A lapsed PAID subscription is deliberately left
   * writable: the customer has paid before, the relationship is different, and locking them out
   * over a missed renewal is a different product decision that has not been made.
   */
  canWrite: boolean;
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
      // No subscription, and an admin agency: both may write. Only an ENDED TRIAL may not.
      canWrite: true,
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
      // No subscription, and an admin agency: both may write. Only an ENDED TRIAL may not.
      canWrite: true,
    };
  }

  /**
   * ⚠ TRIAL IS TESTED BEFORE THE EXPIRY BRANCH, EXACTLY AS `admin` IS (AUDIT G49).
   *
   * Not for `admin`'s reason - a trial HAS an expiry - but so that an ended trial keeps saying
   * TRIAL ENDED rather than collapsing into the generic EXPIRED. Those are different facts: one
   * is a prospect who never paid, the other a customer whose renewal lapsed, and the second is
   * still allowed to write while the first is not.
   *
   * If this sat after the expiry branch, an ended trial would render EXPIRED, `canWrite` would
   * come from the wrong branch, and the gate would let it through. The ordering is the guard, and
   * nothing about the code makes that visible - which is why it is asserted in a test.
   */
  if (sub.status === 'trial') {
    const ended = hasEnded(sub.expiryDate, now);
    return ended
      ? {
          key: 'trial_ended',
          word: 'TRIAL ENDED',
          tone: 'bg-amber-100 text-amber-900 border-amber-400',
          hasExpiry: true,
          wasPaid: false,
          verified: false,
          cancelled: false,
          canWrite: false,
        }
      : {
          key: 'trial',
          word: 'TRIAL',
          tone: 'bg-indigo-100 text-indigo-800 border-indigo-300',
          hasExpiry: true,
          wasPaid: false,
          verified: false,
          cancelled: false,
          canWrite: true,
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
      // ⚠ A LAPSED PAID SUBSCRIPTION STAYS WRITABLE. Deliberate: they have paid before, and
      // locking them out over a missed renewal is a product decision nobody has made.
      canWrite: true,
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
      canWrite: true,
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
    canWrite: true,
  };
}

/**
 * Has an expiry passed? Shared by the trial branch and the expiry branch so the two cannot
 * disagree about the boundary - `<=`, for the reason recorded at the expiry branch.
 */
function hasEnded(expiryDate: number | null | undefined, now: number): boolean {
  const e = Number(expiryDate || 0);
  return !!e && e <= now;
}

/** Hours left, rounded down. Null when there is no expiry. Never negative. */
export function hoursRemaining(sub: SubscriptionRecord | null | undefined, now: number): number | null {
  const e = Number(sub?.expiryDate || 0);
  if (!e) return null;
  return Math.max(0, Math.floor((e - now) / (60 * 60 * 1000)));
}

/** Whole days from now until expiry. Null when there is no expiry to count to. */
export function daysRemaining(sub: SubscriptionRecord | null | undefined, now: number): number | null {
  const expiry = Number(sub?.expiryDate || 0);
  if (!expiry) return null;
  return Math.ceil((expiry - now) / DAY_MS);
}
