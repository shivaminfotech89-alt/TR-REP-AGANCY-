// ADMIN SUBSCRIPTION ACTIONS — cancel, grant days, mark paid (AUDIT G40).
//
// WHY A FUNCTION
// --------------
// `subscriptions/{agencyId}` carries `allow write: if false` for every client (G29), because
// the only construction Firestore offers for "only the server may write this" is a total client
// denial — rules cannot distinguish a server write from a client one, since the Admin SDK
// bypasses them rather than satisfying them. So an admin action on a subscription cannot be a
// client write however privileged the caller. It has to come through here.
//
// ⚠ ADMIN-ONLY, FROM THE VERIFIED TOKEN. Same construction as createAgency and deleteIfEmpty:
// the screen decides which button to show, this decides what may happen, and a caller reaching
// the function directly meets exactly the same test.
//
// ⚠ EVERY ACTION REQUIRES A REASON OR A REFERENCE, AND REFUSES WITHOUT ONE. These three write
// facts about money into a record a GST invoice can point at, and a year later "why is this
// cancelled" or "what was this paid against" has to be answerable from the document rather than
// from somebody's memory. A blank reason field is how that becomes unanswerable, so it is not
// permitted to be blank rather than merely discouraged.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { isSuperAdmin, normaliseEmail } from './adminIdentity.js';

const REGION = 'us-central1';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Mirrors SUBSCRIPTION_INCLUSIVE_INR in src/lib/pricing.ts and subscription.js. */
const PRICE_INCLUSIVE_INR = 5900;

const OPS = ['cancel', 'grant_days', 'mark_paid'];

/** A reason a person can act on a year later, or a refusal. */
function requireText(raw, field, min = 3, max = 500) {
  const v = String(raw || '').trim();
  if (v.length < min) {
    throw new HttpsError('invalid-argument',
      `${field} is required. It is the only record of why this was done.`);
  }
  if (v.length > max) throw new HttpsError('invalid-argument', `${field} is too long.`);
  return v;
}

export function makeAdminSubscriptionAction(db) {
  return onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    if (!isSuperAdmin(request.auth.token?.email)) {
      throw new HttpsError('permission-denied',
        'Subscription actions are the vendor\'s alone.');
    }
    const actor = normaliseEmail(request.auth.token?.email);

    const op = String(request.data?.op || '');
    if (!OPS.includes(op)) {
      throw new HttpsError('invalid-argument', `Unknown action "${op}".`);
    }
    const agencyId = String(request.data?.agencyId || '').trim();
    if (!agencyId) throw new HttpsError('invalid-argument', 'No agency was given.');

    const now = Date.now();

    return db.runTransaction(async (tx) => {
      const agencySnap = await tx.get(db.collection('agencies').doc(agencyId));
      if (!agencySnap.exists) {
        throw new HttpsError('not-found', 'That agency no longer exists.');
      }
      const agency = agencySnap.data() || {};

      const subRef = db.collection('subscriptions').doc(agencyId);
      const subSnap = await tx.get(subRef);
      const prev = subSnap.exists ? (subSnap.data() || {}) : null;

      // ⚠ EXTENDS FROM THE EXISTING EXPIRY WHEN IT IS STILL AHEAD, exactly as a paid renewal
      // does. Two ways of adding time that compute the end date differently would be a defect
      // waiting for the first person to compare them.
      const base = Number(prev?.expiryDate || 0) > now ? Number(prev.expiryDate) : now;

      const common = {
        agencyId,
        agencyName: String(agency.name || '').trim(),
        ownerId: String(agency.ownerId || ''),
        ownerEmail: String(agency.email || ''),
        currency: 'INR',
      };

      if (op === 'cancel') {
        if (!prev) {
          throw new HttpsError('failed-precondition',
            'There is no subscription on this agency to cancel.');
        }
        if (prev.cancelledAt) {
          throw new HttpsError('failed-precondition',
            'That subscription has already been cancelled.');
        }
        const reason = requireText(request.data?.reason, 'A reason');

        // ⚠ THE EXPIRY MOVES TO NOW; THE STATUS IS LEFT ALONE. `expired` is not a stored value
        // in this system - it is what `classifySubscription` DERIVES from an expiry in the
        // past - so setting an expiry of `now` is the whole of "cancel". Writing a status of
        // 'cancelled' as well would create a fifth provenance for something that resolves to
        // an existing state, and would then disagree with the derivation the moment one of the
        // two was updated and the other was not.
        //
        // ⚠ AND THE ORIGINAL STATUS SURVIVES, deliberately. A granted subscription that was
        // cancelled is still a grant; overwriting `status` would destroy the answer to "what
        // was this before it ended" to record the fact that it ended.
        tx.set(subRef, {
          ...common,
          expiryDate: now,
          cancelledAt: now,
          cancelledBy: actor,
          cancelReason: reason,
        }, { merge: true });

        return { ok: true, op, agencyId, expiryDate: now };
      }

      if (op === 'grant_days') {
        const days = Number(request.data?.days);
        if (!Number.isFinite(days) || days <= 0 || days > 3650) {
          throw new HttpsError('invalid-argument',
            'Days must be a positive number, at most 3650.');
        }
        const reason = requireText(request.data?.reason, 'A reason');
        const expiryDate = base + Math.round(days) * DAY_MS;

        tx.set(subRef, {
          ...common,
          // 'granted' is the honest provenance: time given, no money behind it. planAmount is
          // NOT reset - a subscription that was paid for and then extended by a grant keeps
          // the record of what was paid.
          status: 'granted',
          planAmount: Number(prev?.planAmount || 0),
          startDate: Number(prev?.startDate || now),
          expiryDate,
          grantReason: reason,
          grantedAt: now,
          grantedBy: actor,
          // Re-granting time on a cancelled subscription un-cancels it: it is no longer ended,
          // and leaving the flag would render a live subscription as CANCELLED.
          cancelledAt: null,
          cancelledBy: null,
          cancelReason: null,
        }, { merge: true });

        return { ok: true, op, agencyId, expiryDate };
      }

      // ---- mark_paid
      const reference = requireText(request.data?.reference,
        'A payment reference (cheque number, UTR, or "cash, receipt 14")');
      const amount = request.data?.amount === undefined || request.data?.amount === null
        ? PRICE_INCLUSIVE_INR
        : Number(request.data.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new HttpsError('invalid-argument', 'The amount must be a positive number.');
      }
      const days = Number(request.data?.days);
      const addDays = Number.isFinite(days) && days > 0 ? Math.round(days) : 365;
      const expiryDate = base + addDays * DAY_MS;

      tx.set(subRef, {
        ...common,
        // ⚠ 'active', BECAUSE MONEY WAS RECEIVED. The revenue figure must count it - a cheque
        // is revenue - and `wasPaid` is derived from this status.
        status: 'active',
        planAmount: amount,
        startDate: Number(prev?.startDate || now),
        expiryDate,
        // ⚠ AND FLAGGED, BECAUSE ONLY ONE KIND OF PAYMENT HAS A GATEWAY RECORD BEHIND IT.
        // `wasPaid && !verified` is precisely the set that has to be reconciled by hand; a
        // single "paid" boolean would lose that distinction, and the loss would surface at a
        // reconciliation nobody could finish.
        manualPayment: true,
        paymentReference: reference,
        recordedBy: actor,
        lastPaymentDate: now,
        // ⚠ NO razorpayPaymentId AND NO razorpayOrderId, obviously - but stated because the
        // temptation to write a placeholder there is exactly how a manual payment comes to look
        // verified. Their ABSENCE is the verification signal.
        invoicePending: true,
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
      }, { merge: true });

      return { ok: true, op, agencyId, expiryDate, amount };
    });
  });
}
