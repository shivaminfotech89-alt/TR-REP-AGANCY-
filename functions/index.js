// GUARDED DELETES — the guard and the delete in one server-side call.
//
// WHY A FUNCTION AND NOT A RULE (AUDIT F76, F77)
// ----------------------------------------------
// `firestore.rules` carries `allow delete: if false` on both atMasters and agencies, and it
// STAYS that way. No client can ever delete either, from the app, the console or the SDK.
//
// The guard that matters is "nothing lives under this document", and a Firestore rule CANNOT
// express it: rules have `get()` and `exists()` on a known document path and no query at all.
// A client-side guard would need the rule to permit any owner delete, and the client SDK
// cannot make the check and the delete atomic either - `runTransaction` reads documents, not
// queries - so a job saved between the check passing and the delete landing would be
// orphaned silently.
//
// Here the check and the delete happen in ONE call, under one authority, with no window.
// That is the property that made the admin script right; this is the same thing reachable
// from the app.
//
// ⚠ THE NAMED DATABASE IS LOAD-BEARING. This project's data lives in
// `ai-studio-trrepagency-...`, NOT in `(default)`. An Admin SDK handle pointing at the
// default database would query an EMPTY collection, find nothing under the document, and
// cheerfully delete a live tender - the guard passing precisely because it is looking in the
// wrong place. It is read from the same committed config the app and the admin scripts read,
// so the three cannot disagree.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { makeCreateSubscriptionOrder, makeVerifySubscriptionPayment } from './subscription.js';
import { makeCreateAgency } from './createAgency.js';
import { makeAdminSubscriptionAction } from './adminSubscription.js';
import { isSuperAdmin as callerIsSuperAdmin } from './adminIdentity.js';

const here = dirname(fileURLToPath(import.meta.url));
const appConfig = JSON.parse(readFileSync(join(here, 'app-config.json'), 'utf8'));

initializeApp();
const db = getFirestore(appConfig.firestoreDatabaseId);

// ⚠ THE VENDOR'S IDENTITY NOW HAS ONE DEFINITION, in ./adminIdentity.js. It was written out
// here as a literal and again in firestore.rules; createAgency would have been the third copy,
// and three copies of "who is the vendor" is the point at which they start to disagree. An
// exemption that is true in one function and false in another looks right in both isolations.

/** How many blocking items to name in the refusal. Enough to recognise, not a dump. */
const SAMPLE = 10;

/**
 * What must be empty before each kind of document can go, and how to describe what is not.
 *
 * ONE PLACE. A second copy of "what blocks an agency" is how the list and the guard drift
 * apart, and a guard that checks less than its message claims is worse than no guard.
 */
const GUARDS = {
  atMasters: {
    label: 'AT',
    name: d => d.atNumber || d.name || '(unnamed AT)',
    blockers: [
      {
        what: 'job',
        query: id => db.collection('jobs').where('atId', '==', id),
        describe: d => `${d.jobNo || '(no job number)'} — MR ${d.mrNo || '-'}`,
        consequence:
          'Deleting it would leave every one of them naming a tender that no longer exists. '
        + 'They would price from whichever AT is selected at the time, and the printed estimate '
        + 'recomputes rather than reading stored figures — so the paper in the file would stop '
        + 'matching the screen, with nothing announcing it.',
      },
    ],
    advice: "If the tender is finished, set its status to 'Closed'. That is what Closed is for.",
  },
  agencies: {
    label: 'agency',
    name: d => d.name || '(unnamed agency)',
    blockers: [
      {
        what: 'AT',
        // ⚠ ANY AT BLOCKS, EMPTY OR NOT. An empty tender can be deleted from AT Settings, which is itself guarded,
        // so the two-step route is honest. One button that cascades "only the empty ones" would mean two different
        // things depending on data the operator cannot see from the row.
        query: id => db.collection('atMasters').where('agencyId', '==', id),
        describe: d => d.atNumber || d.name || '(unnamed AT)',
        consequence: 'An agency owns its tenders; removing it would orphan them.',
      },
      {
        what: 'job',
        query: id => db.collection('jobs').where('agencyId', '==', id),
        describe: d => `${d.jobNo || '(no job number)'} — MR ${d.mrNo || '-'}`,
        consequence: 'Every job, inspection and oil record beneath it becomes unreachable.',
      },
      {
        what: 'inspection',
        /**
         * ⚠ NOT BY `agencyId` ALONE - THAT FIELD MISSES MOST OF THEM (AUDIT G73).
         *
         * Measured 2026-09-12: of 144 inspections, only 85 carry `agencyId`. The other 59 are reachable solely
         * through their job. A guard querying the field would find nothing for them, report the agency as empty, and
         * orphan 59 records - the exact shape of a check that passes because it cannot see its subject.
         *
         * So both routes are taken: the field, which catches inspections whose job has since been deleted, and the
         * agency's own jobs, which catches the ones carrying no agencyId. When jobs exist the job blocker above
         * fires first and this never decides anything - it matters if that blocker is ever relaxed, and it costs one
         * query when there are none.
         */
        find: async (id) => {
          const seen = new Set();
          const items = [];
          let count = 0;
          const add = (doc) => {
            if (seen.has(doc.id)) return;
            seen.add(doc.id);
            count++;
            if (items.length < SAMPLE) {
              const d = doc.data() || {};
              items.push(`inspection ${doc.id} — ${d.type || 'unknown type'}${d.jobId ? ` on job ${d.jobId}` : ''}`);
            }
          };
          const direct = await db.collection('inspections').where('agencyId', '==', id).limit(SAMPLE + 1).get();
          direct.docs.forEach(add);
          if (count <= SAMPLE) {
            const jobs = await db.collection('jobs').where('agencyId', '==', id).limit(200).get();
            const jobIds = jobs.docs.map(d => d.id);
            for (let i = 0; i < jobIds.length && count <= SAMPLE; i += 30) {
              const snap = await db.collection('inspections')
                .where('jobId', 'in', jobIds.slice(i, i + 30)).limit(SAMPLE + 1).get();
              snap.docs.forEach(add);
            }
          }
          return { count, items };
        },
        consequence:
          'An inspection records what was found inside a transformer. Removing the agency would leave them '
        + 'unreachable - most carry no agencyId at all and are found only through their job.',
      },
      {
        what: 'oil transaction',
        query: id => db.collection('oilTransactions').where('agencyId', '==', id),
        describe: d => `${d.type || 'transaction'} — ${d.quantity ?? d.litres ?? '?'} litres`,
        consequence: 'Oil is settled with a division against this agency; the balance is computed from these rows.',
      },
      {
        what: 'payment',
        /**
         * ⚠ MONEY REFUSES THE DELETE OUTRIGHT, AND THE TEST IS `wasPaid` OR A ROW IN `payments` - NEVER AN ORDER.
         *
         * A `payment_orders` row is created when checkout opens and survives an abandoned one: two live agencies
         * carry orders nobody paid, and blocking on those would refuse a delete over a window someone closed. A
         * `payments` row, or a subscription recorded as active, is money actually received - and a GST invoice for
         * it is still owed (G30), so the agency it names must go on existing.
         */
        find: async (id) => {
          const items = [];
          let count = 0;
          const sub = await db.collection('subscriptions').doc(id).get();
          const s = sub.exists ? (sub.data() || {}) : null;
          if (s && (s.status === 'active' || s.razorpayPaymentId || s.manualPayment)) {
            count++;
            items.push(
              `subscription recorded as paid`
              + (s.razorpayPaymentId ? ` — gateway ${s.razorpayPaymentId}` : '')
              + (s.manualPayment ? ` — manual, reference ${s.paymentReference || '(none)'}` : ''));
          }
          const pays = await db.collection('payments').where('agencyId', '==', id).limit(SAMPLE + 1).get();
          count += pays.size;
          for (const d of pays.docs) {
            if (items.length >= SAMPLE) break;
            const p = d.data() || {};
            items.push(`payment ${d.id} — ${((Number(p.amountPaise) || 0) / 100).toLocaleString('en-IN')}`);
          }
          return { count, items };
        },
        consequence:
          'Money was received against this agency, and the GST invoice for it is still owed. An invoice is '
        + 'answered with a credit note, never by removing the record it points at.',
      },
    ],
    advice: 'Delete the tenders and their jobs first, or leave the agency in place — nothing requires removing it.',
  },
};

export const deleteIfEmpty = onCall({ region: 'us-central1' }, async (request) => {
  // ---- 1. signed in
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }
  const uid = request.auth.uid;

  // ---- 2. a collection this function is willing to touch
  const collection = String(request.data?.collection || '');
  const id = String(request.data?.id || '').trim();
  const guard = GUARDS[collection];
  if (!guard) {
    throw new HttpsError('invalid-argument', `This function does not delete from "${collection}".`);
  }
  if (!id) {
    throw new HttpsError('invalid-argument', 'No document id was given.');
  }

  // ---- 3. the document exists
  const ref = db.collection(collection).doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'That record no longer exists. It may already have been deleted.');
  }
  const data = snap.data() || {};

  // ---- 4. THE CALLER OWNS IT — checked here, never taken from the UI.
  //
  // The UI decides which button to show; this decides what may happen. A caller reaching
  // the function directly, or a stale screen belonging to a different account, is refused
  // by the same test either way.
  const isOwner = String(data.ownerId || '') === uid;
  const isSuperAdmin = callerIsSuperAdmin(request.auth.token?.email);
  if (!isOwner && !isSuperAdmin) {
    throw new HttpsError('permission-denied', 'That record belongs to another account.');
  }

  // ---- 5. THE GUARD, in the same call as the delete.
  const blocking = [];
  for (const b of guard.blockers) {
    // A blocker is either a single query, or - where one query cannot answer it - a `find` that returns the same
    // shape. The inspections blocker needs the second: its subject is not reachable by one field (AUDIT G73).
    let found;
    if (b.find) {
      found = await b.find(id);
    } else {
      // limit(SAMPLE + 1): enough to name a few and to say "and N more" without reading a
      // whole collection to refuse.
      const snap = await b.query(id).limit(SAMPLE + 1).get();
      found = { count: snap.size, items: snap.docs.slice(0, SAMPLE).map(d => b.describe(d.data() || {})) };
    }
    if (!found.count) continue;
    blocking.push({
      what: b.what,
      count: found.count > SAMPLE ? `${SAMPLE}+` : String(found.count),
      items: found.items,
      consequence: b.consequence,
    });
  }

  if (blocking.length > 0) {
    const summary = blocking.map(b => `${b.count} ${b.what}${b.count === '1' ? '' : 's'}`).join(' and ');
    throw new HttpsError(
      'failed-precondition',
      `This ${guard.label} cannot be deleted: ${summary} still reference it.`,
      { blocking, advice: guard.advice, label: guard.label, name: guard.name(data) },
    );
  }

  // ---- 6. delete. Nothing was found between the check and here, because there is no
  //         "between" - the query above and this line are the same invocation.
  //
  /**
   * ⚠ AN UNPAID SUBSCRIPTION GOES WITH ITS AGENCY, IN THE SAME TRANSACTION (AUDIT G73).
   *
   * `subscriptions/{agencyId}` is `allow write: if false` for every client, and this audit records that a
   * subscription is never deleted because an invoice points at it and expiry is a status, not an absence. That rule
   * is about a subscription that EXISTED AND ENDED. A trial or a grant on an agency that no longer exists is not an
   * ended subscription - it is a record pointing at nothing, and the id it is keyed by resolves to no document.
   *
   * A PAID one never reaches here: the payment blocker above refuses the delete outright. The check is repeated
   * inside the transaction anyway, because a payment could land between the guard and this write, and the cost of
   * being wrong is a record a GST invoice needs.
   *
   * ⚠ `payments` AND `payment_orders` ARE NEVER TOUCHED, by this or anything else. They record money, and an
   * abandoned order is still a fact about what happened.
   */
  let removedSubscription = null;
  const subRef = collection === 'agencies' ? db.collection('subscriptions').doc(id) : null;
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) {
      throw new HttpsError('not-found', 'That record no longer exists. It may already have been deleted.');
    }
    const subSnap = subRef ? await tx.get(subRef) : null;
    if (subSnap && subSnap.exists) {
      const s = subSnap.data() || {};
      if (s.status === 'active' || s.razorpayPaymentId || s.manualPayment) {
        throw new HttpsError('failed-precondition',
          'A payment was recorded against this agency while it was being deleted. Nothing was removed.');
      }
      tx.delete(subRef);
      removedSubscription = String(s.status || 'unknown');
    }
    tx.delete(ref);
  });

  return {
    deleted: true,
    collection,
    id,
    name: guard.name(data),
    label: guard.label,
    // What went with it, so the screen can say so rather than implying only the agency was removed.
    removedSubscription,
  };
});

/**
 * SUBSCRIPTION PAYMENTS. Defined in ./subscription.js and wired here because a deployed
 * function is only discovered through the package's main entry.
 *
 * They take `db` rather than building their own handle, for the reason this file's header
 * gives at length: the NAMED database is load-bearing, and a second `getFirestore()` call is a
 * second chance to point at `(default)` and find an empty collection where the real one is.
 * One handle, made once, from the committed config.
 */
export const createSubscriptionOrder = makeCreateSubscriptionOrder(db);
export const verifySubscriptionPayment = makeVerifySubscriptionPayment(db);

/**
 * AGENCY CREATION WITHOUT PAYMENT - the vendor's path only. See ./createAgency.js.
 *
 * A paying customer never reaches it: they name their agencies, pay for all of them at once,
 * and verifySubscriptionPayment creates them in the transaction that records the payment. There
 * is no slot and no interval between paying and receiving (AUDIT G38).
 */
export const createAgency = makeCreateAgency(db);

/**
 * CANCEL, GRANT DAYS, MARK PAID. See ./adminSubscription.js.
 *
 * subscriptions/{agencyId} is write-denied to every client, so an admin action on one cannot
 * be a client write however privileged the caller - it has to come through a function.
 */
export const adminSubscriptionAction = makeAdminSubscriptionAction(db);
