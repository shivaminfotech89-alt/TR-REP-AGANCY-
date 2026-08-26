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

const here = dirname(fileURLToPath(import.meta.url));
const appConfig = JSON.parse(readFileSync(join(here, 'app-config.json'), 'utf8'));

initializeApp();
const db = getFirestore(appConfig.firestoreDatabaseId);

/** The one account allowed to delete another owner's document. Mirrors isSuperAdmin() in the rules. */
const SUPER_ADMIN_EMAIL = 'shivaminfotech89@gmail.com';

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
  const email = String(request.auth.token?.email || '').toLowerCase().trim();

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
  const isSuperAdmin = email === SUPER_ADMIN_EMAIL;
  if (!isOwner && !isSuperAdmin) {
    throw new HttpsError('permission-denied', 'That record belongs to another account.');
  }

  // ---- 5. THE GUARD, in the same call as the delete.
  const blocking = [];
  for (const b of guard.blockers) {
    // limit(SAMPLE + 1): enough to name a few and to say "and N more" without reading a
    // whole collection to refuse.
    const found = await b.query(id).limit(SAMPLE + 1).get();
    if (found.empty) continue;
    blocking.push({
      what: b.what,
      count: found.size > SAMPLE ? `${SAMPLE}+` : String(found.size),
      items: found.docs.slice(0, SAMPLE).map(d => b.describe(d.data() || {})),
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
  await ref.delete();

  return {
    deleted: true,
    collection,
    id,
    name: guard.name(data),
    label: guard.label,
  };
});
