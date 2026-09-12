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

/**
 * THE TRIAL: 72 HOURS FROM CREATION (AUDIT G49).
 *
 * ⚠ HOURS, NOT CALENDAR DAYS. "3 days" from a signup at 11pm is a different trial from one at
 * 9am - calendar days would give one prospect 73 hours and another 96. The expiry is a timestamp
 * computed here on the SERVER's clock, and the screens show that timestamp rather than "3 days".
 */
const TRIAL_HOURS = 72;

/**
 * ⚠ THE MECHANISM IS HOURS AND THE WORDING IS DAYS (AUDIT G50). Hours are right for the
 * mechanism - calendar days would give an 11pm signup 73 hours and a 9am signup 96 - but that is
 * the vendor's reasoning, not the customer's. Every message a person reads says "3 days"; the
 * expiry they are shown is the exact moment.
 */
const TRIAL_LENGTH_LABEL = '3 days';

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

    // ---- 3. WHO MAY CREATE WITHOUT PAYING: the vendor, or a first-time trial.
    const wantsTrial = request.data?.trial === true;

    if (!admin && !wantsTrial) {
      throw new HttpsError('permission-denied',
        'Agencies are created by buying them: choose Add Agency, name them, and pay. '
        + 'This endpoint creates agencies without payment.');
    }

    if (!admin && wantsTrial) {
      // ⚠ ONE TRIAL PER ACCOUNT, EVER - not one ACTIVE trial. An expired trial still counts,
      // which is why this queries by status with no date filter. Agencies cannot be deleted by
      // any client (`allow delete: if false`), so the record cannot be cleared to earn another.
      //
      // ⚠ THIS CHECK IS NOT REDUNDANT WITH THE AGENCY CHECK BELOW, though it looks it: an
      // account with no agency normally has no subscription either, since subscriptions are
      // per agency and agencies cannot be deleted by a client. The gap is `deleteIfEmpty` -
      // the vendor CAN remove an agency through it, and it does not remove the subscription.
      // A deleted trial agency would otherwise leave the account eligible for a second trial.
      //
      // ⚠ AND A FRESH GOOGLE ACCOUNT DEFEATS THIS. That is accepted rather than defended:
      // stopping it needs a card on file or phone verification, both of which defeat the point
      // of a trial. The friction of a new account plus re-entering an AT, divisions and rates is
      // already higher than a second 72-hour look is worth. A defence that does not hold is
      // worse than a stated limit.
      // ⚠ ONE EQUALITY FILTER, NOT TWO, AND THE STATUS IS CHECKED IN CODE. A query with
      // `where ownerId == x` AND `where status == 'trial'` needs a COMPOSITE INDEX, this project
      // has no firestore.indexes.json, and a missing index fails at RUNTIME with
      // FAILED_PRECONDITION and a console URL - so the first prospect ever to click Start Trial
      // would meet an error nobody had seen. An account holds a handful of subscriptions; reading
      // them and filtering here costs nothing and depends on no configuration.
      const ownSubs = await db.collection('subscriptions').where('ownerId', '==', uid).get();
      const hadTrial = ownSubs.docs.some(d => (d.data() || {}).status === 'trial');
      if (hadTrial) {
        // ⚠ "its free trial", NOT "its free ${TRIAL_LENGTH_LABEL}" (AUDIT G75). The label is a noun phrase - it
        // fits "for 3 days" and "After 3 days", and does not fit a slot that wants the noun "trial". The length is
        // still stated, where it reads as a length.
        throw new HttpsError('failed-precondition',
          `This login has already used its free trial. The trial is ${TRIAL_LENGTH_LABEL}, one per `
          + 'account rather than one per agency - add this agency by buying it. The price and what it '
          + 'includes are on the Pricing page.');
      }

      // ⚠ NO TRIAL FOR AN ACCOUNT THAT ALREADY HOLDS AN AGENCY. Someone who has paid does not
      // need one, and without this a paying customer could mint a free agency alongside.
      const existingAgencies = await db.collection('agencies')
        .where('ownerId', '==', uid).limit(1).get();
      if (!existingAgencies.empty) {
        throw new HttpsError('failed-precondition',
          'A free trial is for a first agency. This account already has one, so add the next by '
          + 'buying it.');
      }

      // ⚠ ONE AGENCY ON A TRIAL, NOT UP TO TEN. The batch cap belongs to a purchase.
      if ((request.data?.agencyNames || []).length > 1) {
        throw new HttpsError('invalid-argument', 'A trial covers one agency.');
      }
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
        // ⚠ 'trial' IS A FIFTH PROVENANCE, NOT `granted` WITH A REASON. A trial and a founding
        // grant differ in duration (72 hours against eighteen months), in meaning (a prospect who
        // has bought nothing against a vendor commitment to an existing customer), and in a
        // number that will be wanted: how many trials became payments is answerable with a status
        // and unanswerable with a free-text reason. G28's rule - provenances stay distinct.
        const isTrial = !admin;
        tx.set(db.collection('subscriptions').doc(ref.id), {
          agencyId: ref.id,
          agencyName: nm,
          ownerId: uid,
          ownerEmail: email,
          status: isTrial ? 'trial' : 'admin',
          planAmount: 0,
          currency: 'INR',
          startDate: now,
          // ⚠ NULL, NOT A DATE. Nothing was bought, so there is no year to run out. Writing
          // `now + 365 days` would invent an expiry no payment supports, and it would render
          // as an ordinary subscription quietly counting down. Absence is the fact.
          // ⚠ NULL FOR ADMIN, A REAL TIMESTAMP FOR A TRIAL. An admin agency bought nothing so
          // there is no term to run out; a trial bought nothing either but is deliberately
          // time-boxed. Computed from the SERVER's clock, so the endpoint is trustworthy even
          // though the browser comparing against it may not be - see lib/serverClock.ts.
          expiryDate: isTrial ? now + TRIAL_HOURS * 60 * 60 * 1000 : null,
          trialHours: isTrial ? TRIAL_HOURS : null,
          createdByAdmin: !isTrial,
          grantReason: isTrial
            ? `Free trial - ${TRIAL_LENGTH_LABEL} from creation (${TRIAL_HOURS}h).`
            : 'Created by the vendor. No payment, and no expiry.',
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
      admin,
      trial: !admin,
    };
  });
}
