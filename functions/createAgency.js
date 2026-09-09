// CREATING AN AGENCY — the payment gate, and the only place a slot is consumed (AUDIT G33).
//
// WHY THIS IS A FUNCTION AND NOT A RULE
// -------------------------------------
// A Firestore rule CAN read `entitlements/{uid}.agencySlots > 0` and permit a create. What it
// cannot do is DECREMENT - rules evaluate a write, they do not perform one. So a rule-only gate
// lets one paid slot create unlimited agencies: every create passes the same check against the
// same untouched counter.
//
// Check-and-decrement has to happen in ONE transaction, which only the server can do. That is
// the identical argument that made `deleteIfEmpty` a function: the guard and the act in one
// call, with no window between them.
//
// ⚠ THE SEED IS THE COMPILED ARTEFACT, NOT A COPY. `agency-seed.generated.mjs` is produced from
// src/lib/agencySeed.ts at predeploy, so the browser and the server assemble a new agency with
// literally the same code. A hand-written second copy is the arrangement AUDIT F30 records the
// cost of, and this is the worst possible place to pay it twice.
//
// ⚠ THREE PROVENANCES STAY THREE FACTS. An agency arrives here one of two ways, and the
// subscription written for it says which - never 'active' for something nobody paid for:
//
//     admin   the vendor created it for themselves. No payment, NO EXPIRY, because it has none.
//     slot    a slot was bought and is consumed here. Paid, one year from creation.
//
// with 'granted' being the third, written only by the founding-grant script. G28 is what
// happens when provenances collapse into one plausible-looking status: twelve agencies rendered
// ACTIVE PAID at a price nobody was charged. An admin-created agency displaying as paid would
// be that same defect in a new field.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { buildNewAgencyDocument } from './agency-seed.generated.mjs';
import { isSuperAdmin, normaliseEmail } from './adminIdentity.js';

const REGION = 'us-central1';

/** One subscription year, matching functions/subscription.js. */
const SUBSCRIPTION_DAYS = 365;

/** What a slot cost. Mirrors PRICE_INCLUSIVE_INR in subscription.js and pricing.ts. */
const PRICE_INCLUSIVE_INR = 5900;

/**
 * Fields a caller may not set, whatever it sends.
 *
 * ⚠ `ownerId` IS ALREADY FORCED by buildNewAgencyDocument's spread order, and is listed anyway:
 * a second guard on the field that decides who owns an agency is cheap, and the spread order is
 * exactly the kind of detail a later tidy-up reverses without noticing.
 *
 * The subscription fields are here because they were removed from the agency document
 * altogether (G27) - an owner-writable subscription field was forgeable, which is why
 * subscriptions live in their own unwritable collection. Accepting one back through this
 * function would reopen the hole from the other side.
 */
const FORBIDDEN_FIELDS = [
  'ownerId', 'createdAt', 'id',
  'subscriptionStatus', 'subscriptionExpiresAt', 'subscriptionExpiryDate',
  'subscriptionPlan', 'subscriptionPlanAmount', 'subscriptionLastPaid', 'annualFee',
];

export function makeCreateAgency(db) {
  return onCall({ region: REGION }, async (request) => {
    // ---- 1. signed in
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const uid = request.auth.uid;
    const email = normaliseEmail(request.auth.token?.email);

    // ---- 2. THE VENDOR EXEMPTION, decided here and nowhere else.
    //
    // ⚠ THE SCREEN GETS NO SAY. The client does not send a flag, and if it did this would not
    // read it. The UI decides which button to show; this decides what may happen - the same
    // rule deleteIfEmpty states, and the reason a caller reaching the function directly is
    // refused by exactly the same test as one coming through the app.
    const admin = isSuperAdmin(request.auth.token?.email);

    // ---- 3. the payload
    const agencyData = request.data?.agencyData;
    if (!agencyData || typeof agencyData !== 'object' || Array.isArray(agencyData)) {
      throw new HttpsError('invalid-argument', 'No agency details were given.');
    }
    const name = String(agencyData.name || '').trim();
    if (!name) {
      throw new HttpsError('invalid-argument', 'An agency needs a name.');
    }
    if (name.length > 200) {
      throw new HttpsError('invalid-argument', 'That name is too long.');
    }
    const forbidden = FORBIDDEN_FIELDS.filter(f => f in agencyData);
    if (forbidden.length) {
      // Named rather than stripped: silently discarding a field a caller believed it was
      // setting is how a client comes to depend on a value that never lands.
      throw new HttpsError('invalid-argument',
        `These fields are set by the server and may not be supplied: ${forbidden.join(', ')}.`);
    }

    // ⚠ THE NAME IS TRIMMED HERE TOO, not only in the form. Two agencies are stored with a
    // trailing space because the form wrote its input verbatim (G29); the form now trims, and
    // so does this, because a function must not depend on its caller having been fixed.
    const cleanData = { ...agencyData, name };

    const now = Date.now();
    const agencyRef = db.collection('agencies').doc();
    const document = buildNewAgencyDocument(cleanData, uid);

    // ---- 4. ONE TRANSACTION: check the slot, create the agency, consume the slot.
    //
    // ⚠ THERE IS NO WINDOW. A check that passed and a decrement that happened separately would
    // let two concurrent calls both read `agencySlots: 1` and both create an agency. The
    // transaction is what makes "you may create one agency" mean one.
    const created = await db.runTransaction(async (tx) => {
      const entRef = db.collection('entitlements').doc(uid);
      let slotsAfter = null;

      if (!admin) {
        const entSnap = await tx.get(entRef);
        const slots = entSnap.exists ? Number(entSnap.data()?.agencySlots || 0) : 0;
        if (slots <= 0) {
          // ⚠ SAYS WHAT TO DO, not just that it was refused. This is a paywall, and a paywall
          // that does not say how to pass it is a dead end.
          throw new HttpsError('failed-precondition',
            'You have no agency slots. Buy one from the Subscription panel in Agency Settings, '
            + 'then create the agency.');
        }
        slotsAfter = slots - 1;
        tx.update(entRef, {
          agencySlots: FieldValue.increment(-1),
          lastConsumedAt: now,
          lastConsumedFor: agencyRef.id,
        });
      }

      tx.create(agencyRef, { ...document, createdAt: FieldValue.serverTimestamp() });

      // ---- the subscription, saying which of the three provenances this is.
      tx.set(db.collection('subscriptions').doc(agencyRef.id), admin
        ? {
            agencyId: agencyRef.id,
            agencyName: name,
            ownerId: uid,
            ownerEmail: email,
            status: 'admin',
            planAmount: 0,
            currency: 'INR',
            startDate: now,
            // ⚠ NULL, NOT A DATE. An admin-created agency has no expiry because nothing was
            // bought - there is no year to run out. Writing `now + 365 days` would invent an
            // expiry that no payment supports, and it would render as a normal subscription
            // quietly counting down. Absence is the fact.
            expiryDate: null,
            createdByAdmin: true,
            grantReason: 'Created by the vendor. No payment, and no expiry.',
          }
        : {
            agencyId: agencyRef.id,
            agencyName: name,
            ownerId: uid,
            ownerEmail: email,
            status: 'active',
            // What a slot costs. The payment itself is recorded against the buyer in
            // `payments`, with its own invoicePending flag - this does not re-flag it, or the
            // same purchase would appear twice in the invoice queue.
            planAmount: PRICE_INCLUSIVE_INR,
            currency: 'INR',
            startDate: now,
            // ⚠ THE YEAR RUNS FROM CREATION, NOT FROM PURCHASE. A slot may sit unused for
            // months, and starting the clock at payment would sell somebody a year of service
            // for an agency that did not exist yet.
            expiryDate: now + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000,
            origin: 'slot',
          });

      return { slotsAfter };
    });

    return {
      id: agencyRef.id,
      // The assembled document, so the client can update its local state without a re-read -
      // and WITHOUT createdAt, which is a serverTimestamp sentinel rather than a value and
      // would put a FieldValue where React state expects a date (AUDIT A5).
      document,
      admin,
      slotsRemaining: created.slotsAfter,
    };
  });
}
