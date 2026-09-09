// SUBSCRIPTION PAYMENTS — order creation and signature verification (AUDIT G30).
//
// THE SHAPE, AND WHY EACH HALF IS WHERE IT IS
// -------------------------------------------
// An order is created HERE and not in the browser, because creating one authenticates with the
// key secret. A payment is verified HERE and not in the browser, because verifying one is an
// HMAC over the key secret. The client's whole job is to open the Razorpay checkout with an
// order id it was handed and to pass back what checkout returns. It never sees the secret, and
// nothing it says about the outcome of a payment is believed.
//
// ⚠ THE CLIENT'S REPORT OF SUCCESS IS NOT EVIDENCE OF SUCCESS. Razorpay's checkout hands the
// browser `razorpay_payment_id`, `razorpay_order_id` and `razorpay_signature`. Only the third
// matters: it is HMAC-SHA256(order_id + "|" + payment_id) under the key secret, so it can only
// have been produced by Razorpay. Without that check a caller could invent the two ids and
// activate a subscription for free, and the two ids alone are exactly what a browser would
// naturally send.
//
// ⚠ AND THE SUBSCRIPTION IS WRITTEN ONLY BY THIS FUNCTION. `subscriptions/{agencyId}` carries
// `allow write: if false` for every client, so this and the grant script are the only writers
// that exist. That is not a stricter rule - it is the only construction Firestore offers, since
// rules cannot express "only a function may write this" (the Admin SDK bypasses them rather
// than satisfying them, so no predicate can tell a server write from a client one).
//
// ⚠ THE INVOICE IS DELIBERATELY NOT ISSUED HERE, and this is the one design decision most
// likely to look like an omission. A GST invoice number must be sequential and GAP-FREE within
// a financial year. The seller's SAC code is not yet decided, so an invoice cannot be rendered
// correctly today - and allocating a number to an invoice that cannot be rendered puts a
// permanent hole in the sequence, which is a filing defect rather than a missing feature.
//
// Refusing the PAYMENT over missing invoice config would be far worse: the money has already
// left the customer's account by the time this function runs. So a verified payment always
// records the subscription, and marks `invoicePending: true`. Invoices are issued afterwards,
// in order, once the SAC code is set. Nothing is lost and no number is burned.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { FieldValue } from 'firebase-admin/firestore';

/** The key secret. Never returned, never logged, never written to Firestore. */
const RAZORPAY_KEY_SECRET = defineSecret('RAZORPAY_KEY_SECRET');

/**
 * The publishable key id (`rzp_test_...` / `rzp_live_...`). Not a secret - it is designed to
 * sit in client code - but a PARAM rather than a constant so switching test to live is a
 * configuration change instead of a code change. It is handed to the client with the order
 * rather than being duplicated in the bundle, so the two cannot disagree about which mode the
 * app is in.
 *
 * ⚠ NO DEFAULT VALUE, DELIBERATELY. It was written as `{ default: '' }` first, which is the
 * worse failure by some distance: a deploy would succeed, the function would be live, and the
 * first customer to press Pay would meet a runtime refusal. With no default the Firebase CLI
 * REFUSES TO DEPLOY until a value exists - it prompts once and persists the answer to
 * functions/.env.<project>. The misconfiguration is caught at deploy time by someone watching
 * a terminal rather than at payment time by a customer.
 */
const RAZORPAY_KEY_ID = defineString('RAZORPAY_KEY_ID');

/**
 * ⚠ THE PRICE IS DUPLICATED FROM src/lib/pricing.ts, AND THAT IS NOT AN OVERSIGHT.
 *
 * A deployed function ships only what is inside functions/, so it cannot import from src/. The
 * same constraint produced functions/app-config.json and its predeploy sync (F75, F77).
 *
 * The copy is safe here in a way the database id was not, because THIS is the authoritative
 * one: the amount charged is whatever this function tells Razorpay, and the client's figure is
 * only a label. If the two drift, the customer is charged this number and shown the other -
 * which is a display bug, not an overcharge. The reverse arrangement, with the client naming
 * the amount, is the one that must never exist.
 */
const PRICE_INCLUSIVE_INR = 5900;
const CURRENCY = 'INR';

/** Razorpay works in the smallest currency unit. Rupees to paise. */
const AMOUNT_PAISE = PRICE_INCLUSIVE_INR * 100;

/** One subscription year. Renewals extend from the existing expiry, not from today. */
const SUBSCRIPTION_DAYS = 365;

/** What an order may be for. A renewal names an agency; a new slot cannot, as none exists yet. */
const ORDER_KINDS = ['renewal', 'new_agency'];

const REGION = 'us-central1';

/** Shared by both functions: the caller, or a refusal. */
function requireAuth(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  return {
    uid: request.auth.uid,
    email: String(request.auth.token?.email || '').toLowerCase().trim(),
  };
}

/**
 * The caller owns this agency. Checked against the database, never taken from the request.
 *
 * The UI decides which button to show; this decides what may happen. Same rule as
 * deleteIfEmpty - a caller reaching the function directly is refused by the same test.
 */
async function requireOwnedAgency(db, agencyId, uid) {
  if (!agencyId) throw new HttpsError('invalid-argument', 'No agency was given.');
  const snap = await db.collection('agencies').doc(agencyId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'That agency no longer exists.');
  const data = snap.data() || {};
  if (String(data.ownerId || '') !== uid) {
    throw new HttpsError('permission-denied', 'That agency belongs to another account.');
  }
  return data;
}

// ---------------------------------------------------------------------------------------
// 1. CREATE THE ORDER
// ---------------------------------------------------------------------------------------

export function makeCreateSubscriptionOrder(db) {
  return onCall(
    { region: REGION, secrets: [RAZORPAY_KEY_SECRET] },
    async (request) => {
      const { uid, email } = requireAuth(request);

      const kind = String(request.data?.kind || '');
      if (!ORDER_KINDS.includes(kind)) {
        throw new HttpsError('invalid-argument', `Unknown order kind "${kind}".`);
      }

      const agencyId = String(request.data?.agencyId || '').trim();
      let agencyName = '';
      if (kind === 'renewal') {
        const agency = await requireOwnedAgency(db, agencyId, uid);
        agencyName = String(agency.name || '').trim();
      }

      const keyId = RAZORPAY_KEY_ID.value();
      const keySecret = RAZORPAY_KEY_SECRET.value();
      if (!keyId || !keySecret) {
        // ⚠ SAYS WHICH ONE IS MISSING, because the two are configured by different mechanisms
        // and "payments are not configured" sends the reader to the wrong place half the time.
        throw new HttpsError('failed-precondition',
          `Razorpay is not configured on the server: ${!keyId ? 'RAZORPAY_KEY_ID (a deploy param)' : ''}`
          + `${!keyId && !keySecret ? ' and ' : ''}`
          + `${!keySecret ? 'RAZORPAY_KEY_SECRET (a Functions secret)' : ''} is unset.`);
      }

      // ⚠ THE AMOUNT IS NOT TAKEN FROM THE REQUEST. It is this constant, always. A client that
      // could name its own price would be the whole vulnerability, and an order endpoint that
      // accepts an amount is the most common way it appears.
      const body = {
        amount: AMOUNT_PAISE,
        currency: CURRENCY,
        // ⚠ RAZORPAY CAPS `receipt` AT 40 CHARACTERS, and the first version of this line
        // produced 42: `renewal:` (8) + a 20-character Firestore id + `:` + a 13-digit
        // millisecond timestamp. Over the cap the Orders API returns 400 and no order is
        // created at all - which is a failure BEFORE checkout opens, and so is emphatically
        // NOT the same thing as a payment failing after card entry.
        //
        // Nothing is lost by shortening it: the full ids are in `notes` below and in this
        // application's own payment_orders document, and the receipt is only a short label for
        // reconciliation in Razorpay's dashboard. Base-36 for the timestamp, and the tail of
        // the id, which is the part that actually distinguishes one Firestore id from another.
        receipt: `${kind === 'renewal' ? 'rnw' : 'new'}_${String(agencyId || uid).slice(-10)}_${Date.now().toString(36)}`,
        notes: { kind, uid, agencyId, agencyName, email },
      };

      let order;
      try {
        const res = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
          },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) {
          // The gateway's own message is useful and carries no secret; the credentials are in
          // the request header, not the response.
          console.error('razorpay order failed', res.status, text);
          throw new HttpsError('unavailable', `The payment gateway refused the order (${res.status}).`);
        }
        order = JSON.parse(text);
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        console.error('razorpay order error', e);
        throw new HttpsError('unavailable', 'Could not reach the payment gateway. Nothing was charged.');
      }

      // ⚠ RECORDED BEFORE THE CUSTOMER PAYS, so a payment can always be matched back to what it
      // was for. `kind` and `agencyId` come from here at verification time and NOT from the
      // browser, which is what stops a renewal order being redeemed as a new-agency slot.
      await db.collection('payment_orders').doc(String(order.id)).set({
        orderId: String(order.id),
        kind,
        agencyId: agencyId || '',
        agencyName,
        uid,
        email,
        amountPaise: AMOUNT_PAISE,
        currency: CURRENCY,
        createdAt: Date.now(),
        status: 'created',
      });

      return {
        orderId: String(order.id),
        amountPaise: AMOUNT_PAISE,
        currency: CURRENCY,
        keyId,
        kind,
        agencyId: agencyId || '',
        agencyName,
      };
    },
  );
}

// ---------------------------------------------------------------------------------------
// 2. VERIFY THE PAYMENT AND RECORD IT
// ---------------------------------------------------------------------------------------

export function makeVerifySubscriptionPayment(db) {
  return onCall(
    { region: REGION, secrets: [RAZORPAY_KEY_SECRET] },
    async (request) => {
      const { uid, email } = requireAuth(request);

      const orderId = String(request.data?.razorpay_order_id || '');
      const paymentId = String(request.data?.razorpay_payment_id || '');
      const signature = String(request.data?.razorpay_signature || '');
      if (!orderId || !paymentId || !signature) {
        throw new HttpsError('invalid-argument', 'The payment response was incomplete.');
      }

      // ---- 1. THE SIGNATURE. Everything else depends on this line.
      const expected = createHmac('sha256', RAZORPAY_KEY_SECRET.value())
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      // ⚠ TIMING-SAFE, and length-checked first because timingSafeEqual THROWS on a length
      // mismatch rather than returning false - an exception that would read as a server error
      // instead of a rejected payment.
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(signature, 'utf8');
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        console.warn('signature mismatch', { orderId, paymentId, uid });
        throw new HttpsError('permission-denied', 'That payment could not be verified.');
      }

      // ---- 2. WHAT THE ORDER WAS FOR — read from the server's own record, not the request.
      const orderSnap = await db.collection('payment_orders').doc(orderId).get();
      if (!orderSnap.exists) {
        throw new HttpsError('not-found', 'That order was not created by this application.');
      }
      const order = orderSnap.data() || {};
      if (String(order.uid || '') !== uid) {
        throw new HttpsError('permission-denied', 'That order belongs to another account.');
      }

      const now = Date.now();
      const kind = String(order.kind || '');
      const agencyId = String(order.agencyId || '');

      // ---- 3. ONE TRANSACTION: idempotency, then the effect.
      //
      // ⚠ THE PAYMENT ID IS THE IDEMPOTENCY KEY. A checkout callback can arrive twice - a
      // retry, a double-click, a refresh - and without this the second one would extend the
      // subscription by another year for a single payment. `create` fails if the document
      // exists, so the second attempt loses the race rather than both succeeding.
      const result = await db.runTransaction(async (tx) => {
        const payRef = db.collection('payments').doc(paymentId);
        if ((await tx.get(payRef)).exists) {
          return { alreadyProcessed: true };
        }

        let expiryDate = null;

        if (kind === 'renewal') {
          const subRef = db.collection('subscriptions').doc(agencyId);
          const existing = await tx.get(subRef);
          const prev = existing.exists ? (existing.data() || {}) : {};

          // ⚠ EXTENDS FROM THE EXISTING EXPIRY WHEN IT IS STILL IN THE FUTURE, not from today.
          // Renewing early must not cost the customer the days they have already paid for -
          // and the eighteen-month founding grants make early renewal the normal case here,
          // not an edge one.
          const base = Number(prev.expiryDate || 0) > now ? Number(prev.expiryDate) : now;
          expiryDate = base + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000;

          tx.set(subRef, {
            agencyId,
            agencyName: String(order.agencyName || prev.agencyName || ''),
            ownerId: uid,
            ownerEmail: email,
            status: 'active',
            planAmount: Number(order.amountPaise || 0) / 100,
            currency: String(order.currency || CURRENCY),
            startDate: Number(prev.startDate || now),
            expiryDate,
            razorpayOrderId: orderId,
            razorpayPaymentId: paymentId,
            lastPaymentDate: now,
            // ⚠ NO INVOICE NUMBER IS ALLOCATED HERE. See the header: a GST sequence must be
            // gap-free, and the SAC code is not settled, so a number allocated now could not
            // be rendered onto a valid invoice. The payment is recorded regardless - refusing
            // it would lose money already taken.
            invoicePending: true,
          }, { merge: true });
        } else if (kind === 'new_agency') {
          // A slot to create one agency. The decrement happens in createAgency, in its own
          // transaction, because only a check-and-decrement in one call can stop a single
          // slot creating several agencies.
          tx.set(db.collection('entitlements').doc(uid), {
            uid,
            email,
            agencySlots: FieldValue.increment(1),
            updatedAt: now,
          }, { merge: true });
        } else {
          throw new HttpsError('failed-precondition', `Order ${orderId} has no usable kind.`);
        }

        tx.create(payRef, {
          paymentId,
          orderId,
          uid,
          email,
          kind,
          agencyId,
          amountPaise: Number(order.amountPaise || 0),
          currency: String(order.currency || CURRENCY),
          verifiedAt: now,
          invoicePending: true,
        });

        tx.update(orderSnap.ref, { status: 'paid', paidAt: now, paymentId });

        return { alreadyProcessed: false, expiryDate };
      });

      return {
        ok: true,
        kind,
        agencyId,
        alreadyProcessed: !!result.alreadyProcessed,
        expiryDate: result.expiryDate ?? null,
        // Stated plainly so the screen can say it rather than implying an invoice is coming
        // in the next few seconds.
        invoicePending: true,
      };
    },
  );
}
