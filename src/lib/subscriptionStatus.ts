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
  /** Whether money was actually taken for this. False for `granted` and `admin`. */
  wasPaid: boolean;
};

export const DAY_MS = 24 * 60 * 60 * 1000;

export function classifySubscription(
  sub: SubscriptionRecord | null | undefined,
  now: number,
): SubscriptionClass {
  if (!sub) {
    return {
      key: 'none',
      word: 'NOT BILLED',
      tone: 'bg-slate-100 text-slate-600 border-slate-300',
      hasExpiry: false,
      wasPaid: false,
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
    };
  }

  const expiry = Number(sub.expiryDate || 0);
  if (expiry && expiry < now) {
    return {
      key: 'expired',
      word: 'EXPIRED',
      tone: 'bg-red-100 text-red-800 border-red-300',
      hasExpiry: true,
      wasPaid: sub.status === 'active',
    };
  }

  if (sub.status === 'granted') {
    return {
      key: 'granted',
      word: 'GRANTED',
      tone: 'bg-blue-100 text-blue-800 border-blue-300',
      hasExpiry: true,
      wasPaid: false,
    };
  }

  return {
    key: 'active',
    word: 'ACTIVE',
    tone: 'bg-green-100 text-green-800 border-green-300',
    hasExpiry: true,
    wasPaid: true,
  };
}

/** Whole days from now until expiry. Null when there is no expiry to count to. */
export function daysRemaining(sub: SubscriptionRecord | null | undefined, now: number): number | null {
  const expiry = Number(sub?.expiryDate || 0);
  if (!expiry) return null;
  return Math.ceil((expiry - now) / DAY_MS);
}
