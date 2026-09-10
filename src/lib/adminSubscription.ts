import { getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { app } from './firebase';

/**
 * THE THREE ADMIN SUBSCRIPTION ACTIONS (AUDIT G40).
 *
 * ⚠ THIS FILE DECIDES NOTHING. It sends an op and its arguments; `adminSubscriptionAction`
 * checks the verified auth token, refuses anyone but the vendor, and refuses any of the three
 * without its reason or reference. The screen decides which buttons to draw and that is all.
 *
 * ⚠ AND IT CANNOT WRITE THE SUBSCRIPTION ITSELF, whoever is signed in.
 * `subscriptions/{agencyId}` is `allow write: if false` for every client, because that total
 * denial is the only construction that makes "only the server may write this" true in Firestore
 * (G29). These actions exist as a function for that reason, not for convenience.
 */

const REGION = 'us-central1';

let fns: Functions | null = null;
const functionsClient = () => (fns ??= getFunctions(app, REGION));

export type AdminSubOp = 'cancel' | 'grant_days' | 'mark_paid';

export type AdminSubResult = {
  ok: boolean;
  op: AdminSubOp;
  agencyId: string;
  expiryDate?: number;
  amount?: number;
};

/** A refusal a person can read, rather than a Firebase error code. */
export class AdminSubError extends Error {
  readonly kind: 'denied' | 'not-found' | 'invalid' | 'state' | 'not-deployed' | 'unknown';
  constructor(kind: AdminSubError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

function translate(err: any): AdminSubError {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  if (code.includes('not-found') && !msg.trim()) {
    return new AdminSubError('not-deployed',
      'Subscription actions are not available: the server function has not been deployed.');
  }
  if (code.includes('permission-denied') || code.includes('unauthenticated')) {
    return new AdminSubError('denied', msg || 'Not permitted.');
  }
  if (code.includes('failed-precondition')) return new AdminSubError('state', msg);
  if (code.includes('invalid-argument')) return new AdminSubError('invalid', msg);
  if (code.includes('not-found')) return new AdminSubError('not-found', msg);
  return new AdminSubError('unknown', msg || 'The action could not be completed.');
}

async function call(payload: Record<string, unknown>): Promise<AdminSubResult> {
  try {
    const fn = httpsCallable(functionsClient(), 'adminSubscriptionAction');
    const res: any = await fn(payload);
    return (res?.data || {}) as AdminSubResult;
  } catch (err) {
    throw translate(err);
  }
}

/** End it now. The expiry moves to this instant and the reason is recorded against it. */
export function cancelSubscription(agencyId: string, reason: string) {
  return call({ op: 'cancel', agencyId, reason });
}

/** Add days with no money behind them. Extends from the existing expiry if that is ahead. */
export function grantDays(agencyId: string, days: number, reason: string) {
  return call({ op: 'grant_days', agencyId, days, reason });
}

/**
 * Record a payment taken outside the gateway.
 *
 * ⚠ THE REFERENCE IS REQUIRED BY THE SERVER, not merely by this form. A manual payment with no
 * reference is a grant wearing the word "paid", and it would count toward revenue with nothing
 * to reconcile it against.
 */
export function markPaid(agencyId: string, reference: string, amount?: number, days?: number) {
  return call({ op: 'mark_paid', agencyId, reference, amount, days });
}

/**
 * THE ONE-RUPEE GATEWAY CHECK (AUDIT G44).
 *
 * ⚠ IT WRITES NO SUBSCRIPTION. What it proves is the round trip: the keys authenticate, the
 * order is created, checkout opens, the signature verifies server-side, and the idempotency
 * record lands. A subscription would prove nothing extra and would then need a flag, a branch
 * in classifySubscription, a case in the revenue metric and a row saying "ignore me".
 *
 * ⚠ AND THE MODE IS THE KEY PAIR. There is no test switch anywhere: an order made with
 * `rzp_live_` keys is real and one made with `rzp_test_` keys is not. Running this against test
 * keys costs nothing and exercises the identical code; running it after the live swap costs a
 * rupee and proves the live configuration.
 */
export async function runLiveGatewayCheck(): Promise<{ paymentId: string }> {
  const { createOrder, payWithRazorpay } = await import('./subscriptionClient');
  const order = await createOrder('live_check');
  const done = await payWithRazorpay(order, { name: '', email: '', contact: '' });
  return { paymentId: done.paymentId };
}
