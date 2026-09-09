import { getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { app } from './firebase';

/**
 * SUBSCRIPTION CHECKOUT — the browser's whole part in taking a payment (AUDIT G31).
 *
 * THE DIVISION OF LABOUR, AND WHY IT IS NOT NEGOTIABLE
 * ----------------------------------------------------
 * This file opens a checkout with an order id it was HANDED and passes back what Razorpay
 * returns. It does not decide the price, it does not decide what the payment buys, and its
 * report that a payment succeeded is not what activates anything. All three of those are
 * settled in `functions/subscription.js`, which has the key secret and can verify a signature.
 *
 * ⚠ SO EVERY OUTCOME BELOW IS PROVISIONAL UNTIL `verifySubscriptionPayment` RETURNS. Razorpay's
 * own handler firing means the customer completed checkout - it does not mean the payment is
 * genuine, and a browser can call that handler with invented ids. Nothing in this file writes
 * to Firestore, and nothing it believes has any effect until the server agrees.
 *
 * ⚠ THE ONE FAILURE THIS FILE MUST GET RIGHT is the gap between "money left the customer" and
 * "the server recorded it". Razorpay charges the card before our handler runs, so if
 * verification then fails - a dropped connection, a closed tab, a cold start timing out - the
 * customer has paid and the subscription is not active. That is a real state, not a
 * hypothetical, and the honest thing is to SAY SO with the payment id rather than showing a
 * generic error that implies nothing was charged. `PaymentTakenButUnverified` exists for
 * exactly that, and its message is written to be read out to support.
 */

/** Must match the region the functions are deployed to - see functions/index.js. */
const REGION = 'us-central1';

let fns: Functions | null = null;
const functionsClient = () => (fns ??= getFunctions(app, REGION));

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

export type OrderKind = 'renewal' | 'new_agency';

export type CreatedOrder = {
  orderId: string;
  amountPaise: number;
  currency: string;
  keyId: string;
  kind: OrderKind;
  agencyId: string;
  agencyName: string;
};

export type VerifiedPayment = {
  kind: OrderKind;
  agencyId: string;
  /** True when this payment had already been counted. Not an error - see the idempotency note. */
  alreadyProcessed: boolean;
  expiryDate: number | null;
  invoicePending: boolean;
};

/**
 * The customer was charged and the server did not confirm it.
 *
 * ⚠ THIS IS NOT AN ORDINARY ERROR AND MUST NOT BE SHOWN AS ONE. A generic failure message
 * would tell the customer nothing was charged, which is false and which they will discover
 * from their bank. The payment id is the only thing that lets the payment be found and settled
 * afterwards, so it is carried on the error and belongs on screen.
 */
export class PaymentTakenButUnverified extends Error {
  readonly paymentId: string;
  readonly orderId: string;
  constructor(paymentId: string, orderId: string, cause: string) {
    super(
      `Your payment went through, but this app could not confirm it (${cause}). `
      + `Nothing is lost. Quote payment ${paymentId} to support and it will be applied.`,
    );
    this.paymentId = paymentId;
    this.orderId = orderId;
  }
}

/** The customer closed the checkout without paying. Not a failure, and not worth an alarm. */
export class CheckoutDismissed extends Error {
  constructor() { super('Checkout was closed before payment.'); }
}

/**
 * Load Razorpay's checkout script, once.
 *
 * ⚠ LOADED ON DEMAND RATHER THAN IN index.html. It is a third-party script on every page load
 * otherwise, on an app whose users mostly never buy anything twice a year, and a payment screen
 * is the one place where waiting a moment for it is expected rather than surprising.
 */
let scriptPromise: Promise<void> | null = null;
function loadCheckoutScript(): Promise<void> {
  if ((window as any).Razorpay) return Promise.resolve();
  return (scriptPromise ??= new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = CHECKOUT_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever - the usual cause
      // is a transient network, not a permanently missing script.
      scriptPromise = null;
      reject(new Error('The payment gateway could not be loaded. Check the connection and try again.'));
    };
    document.body.appendChild(el);
  }));
}

/** Ask the server for an order. The amount is the server's, not ours. */
export async function createOrder(kind: OrderKind, agencyId?: string): Promise<CreatedOrder> {
  const call = httpsCallable(functionsClient(), 'createSubscriptionOrder');
  const res: any = await call({ kind, agencyId: agencyId || '' });
  const d = res?.data || {};
  if (!d.orderId || !d.keyId) {
    throw new Error('The server did not return a usable order. Nothing was charged.');
  }
  return d as CreatedOrder;
}

/**
 * Open checkout and settle the result with the server.
 *
 * Resolves only when the server has verified the signature. Rejects with `CheckoutDismissed`
 * if the customer closed it, with `PaymentTakenButUnverified` if money moved and verification
 * did not complete, and with an ordinary Error otherwise.
 */
export function payWithRazorpay(
  order: CreatedOrder,
  who: { name?: string; email?: string; contact?: string },
): Promise<VerifiedPayment> {
  return new Promise<VerifiedPayment>((resolve, reject) => {
    loadCheckoutScript().then(() => {
      // ⚠ `settled` GUARDS AGAINST BOTH CALLBACKS FIRING. Razorpay calls `ondismiss` when the
      // modal closes, which can happen AFTER a successful handler on some flows. Without this,
      // a completed payment could be reported as a dismissal and the resolve discarded.
      let settled = false;

      const rzp = new (window as any).Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amountPaise,
        currency: order.currency,
        name: 'TransRegister',
        description: order.kind === 'renewal'
          ? `Annual subscription — ${order.agencyName}`
          : 'Annual subscription — new agency',
        prefill: {
          name: who.name || '',
          email: who.email || '',
          contact: who.contact || '',
        },
        // Razorpay's own retry UI would re-open checkout on a NEW order behind our back, which
        // would leave a paid order this app never verified. One attempt per order; a retry is
        // the customer pressing the button again, which makes a fresh order we know about.
        retry: { enabled: false },
        modal: {
          ondismiss: () => {
            if (settled) return;
            settled = true;
            reject(new CheckoutDismissed());
          },
        },
        handler: async (response: any) => {
          settled = true;
          const paymentId = String(response?.razorpay_payment_id || '');
          const orderId = String(response?.razorpay_order_id || order.orderId);
          try {
            const call = httpsCallable(functionsClient(), 'verifySubscriptionPayment');
            const res: any = await call({
              razorpay_order_id: orderId,
              razorpay_payment_id: paymentId,
              razorpay_signature: String(response?.razorpay_signature || ''),
            });
            const d = res?.data || {};
            if (!d.ok) {
              reject(new PaymentTakenButUnverified(paymentId, orderId, 'the server declined to confirm it'));
              return;
            }
            resolve({
              kind: d.kind,
              agencyId: String(d.agencyId || ''),
              alreadyProcessed: !!d.alreadyProcessed,
              expiryDate: d.expiryDate ?? null,
              invoicePending: !!d.invoicePending,
            });
          } catch (e: any) {
            // ⚠ THE MONEY HAS ALREADY MOVED BY THE TIME WE ARE HERE. Whatever went wrong, the
            // customer must not be told the payment failed.
            reject(new PaymentTakenButUnverified(
              paymentId, orderId, String(e?.message || 'the confirmation call did not complete')));
          }
        },
      });

      rzp.on('payment.failed', (resp: any) => {
        if (settled) return;
        settled = true;
        // A genuine gateway decline - card refused, expired, insufficient funds. No money moved.
        reject(new Error(String(resp?.error?.description || 'The payment was declined. Nothing was charged.')));
      });

      rzp.open();
    }).catch(reject);
  });
}
