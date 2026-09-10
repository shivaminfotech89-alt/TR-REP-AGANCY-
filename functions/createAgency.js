// CREATING AN AGENCY WITHOUT PAYING — the vendor's path, and only the vendor's (AUDIT G38).
//
// WHAT THIS IS NOW, AND WHAT IT IS NOT
// ------------------------------------
// A paying customer does NOT arrive here. They name their agencies, pay for all of them in one
// payment, and `verifySubscriptionPayment` creates them in the transaction that records the
// payment. There is no slot, no credit and no interval between paying and receiving.
//
// This function is what remains: the vendor creating agencies for themselves, free, with the
// provenance recorded so they can never be mistaken for something that was bought.
//
// ⚠ SO A NON-ADMIN CALLER IS REFUSED OUTRIGHT, and told where to go. It previously accepted any
// caller holding a slot; slots are gone, and an endpoint that creates agencies for free must
// not be reachable by the accounts that are supposed to pay for them.
//
// ⚠ THE SEED IS THE COMPILED ARTEFACT, NOT A COPY. `agency-seed.generated.mjs` is produced from
// src/lib/agencySeed.ts at predeploy, so the browser and the server assemble a new agency with
// literally the same code. A hand-written second copy is the arrangement AUDIT F30 records the
// cost of, and this is the worst possible place to pay it twice.
//
// ⚠ THREE PROVENANCES STAY THREE FACTS, and everything created here is the first one:
//
//     admin    the vendor created it. No payment, NO EXPIRY, because it has none. HERE.
//     active   bought and paid for. One year. Written by verifySubscriptionPayment.
//     granted  a founding agency predating billing. Eighteen months. The grant script.
//
// G28 is what happens when provenances collapse into one plausible-looking status: twelve
// agencies rendered ACTIVE PAID at a price nobody was charged. An admin-created agency
// displaying as paid would be that same defect in a new field.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { buildNewAgencyDocument } from './agency-seed.generated.mjs';
import { isSuperAdmin, normaliseEmail } from './adminIdentity.js';
import { nameKey, validateNames } from './agencyNames.js';

const REGION = 'us-central1';

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

    // ---- 3. REFUSE ANYONE ELSE. This creates agencies for free.
    if (!admin) {
      throw new HttpsError('permission-denied',
        'Agencies are created by buying them: choose Add Agency, name them, and pay. '
        + 'This endpoint creates agencies without payment and is the vendor\'s alone.');
    }

    // ---- 4. the names
    //
    // ⚠ THE SAME RULES AS THE PAID PATH, from the same module. If the vendor's path accepted a
    // name the paying path refused, the two would disagree about what an agency may be called -
    // and the one that accepted it would produce two agencies a switcher cannot tell apart.
    const names = await validateNames(
      request.data?.agencyNames,
      () => db.collection('agencies').where('ownerId', '==', uid).get(),
    );

    const now = Date.now();
    const createdIds = [];
    const createdDocs = [];

    // ---- 5. ONE TRANSACTION, ALL OR NONE.
    //
    // ⚠ THE NAMES ARE RE-CHECKED INSIDE IT. They were checked above, but another tab could have
    // created a clashing agency in between; reading inside the transaction is what makes the
    // check and the create atomic.
    await db.runTransaction(async (tx) => {
      // Cleared per attempt: a transaction callback CAN RUN MORE THAN ONCE under contention,
      // and an array filled across attempts would report ids from a rolled-back one.
      createdIds.length = 0;
      createdDocs.length = 0;

      const owned = await tx.get(db.collection('agencies').where('ownerId', '==', uid));
      const taken = new Set(owned.docs.map(d => nameKey((d.data() || {}).name)));
      for (const nm of names) {
        if (taken.has(nameKey(nm))) {
          throw new HttpsError('already-exists',
            `An agency called "${nm}" already exists on this account. Nothing was created.`);
        }
        taken.add(nameKey(nm));
      }

      for (const nm of names) {
        const ref = db.collection('agencies').doc();
        const document = buildNewAgencyDocument({ name: nm }, uid);
        tx.create(ref, { ...document, createdAt: FieldValue.serverTimestamp() });
        createdDocs.push({ id: ref.id, document });
        tx.set(db.collection('subscriptions').doc(ref.id), {
          agencyId: ref.id,
          agencyName: nm,
          ownerId: uid,
          ownerEmail: email,
          status: 'admin',
          planAmount: 0,
          currency: 'INR',
          startDate: now,
          // ⚠ NULL, NOT A DATE. Nothing was bought, so there is no year to run out. Writing
          // `now + 365 days` would invent an expiry no payment supports, and it would render
          // as an ordinary subscription quietly counting down. Absence is the fact.
          expiryDate: null,
          createdByAdmin: true,
          grantReason: 'Created by the vendor. No payment, and no expiry.',
        });
        createdIds.push(ref.id);
      }
    });

      // ⚠ THE ASSEMBLED DOCUMENT GOES BACK TO THE CALLER (AUDIT G39). The client keeps its
      // agency list in memory from a one-shot read, so a creation it does not learn about
      // leaves that list stale - and a stale list plus a pointer at a new agency renders an
      // empty page, which is exactly the defect this returns to prevent.
      //
      // ⚠ THE SERVER SENDS IT RATHER THAN THE CLIENT REBUILDING IT. The client HAS the same
      // seed code and could assemble an identical document, but then local state would be the
      // client's assertion about what the server wrote rather than the server's account of it.
      // The two are identical today - proved by verify-seed-equality - and the point is that
      // nothing has to keep proving it.
      //
      // ⚠ WITHOUT `createdAt`. It is a serverTimestamp sentinel, not a value, and putting a
      // FieldValue into React state puts a sentinel where a date is expected (AUDIT A5).
    return {
      createdAgencyIds: createdIds,
      createdNames: names,
      createdAgencies: createdDocs,
      admin: true,
    };
  });
}
