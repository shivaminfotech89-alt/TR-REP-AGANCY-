import { getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { app } from './firebase';

/**
 * DELETING AN AT OR AN AGENCY — through the callable, never directly.
 *
 * `firestore.rules` carries `allow delete: if false` on both collections and that is not
 * going to change (AUDIT F76). A rule cannot ask "does anything live under this document" -
 * rules have `get()` and `exists()` on a known path and no query - so the guard has to run
 * somewhere that can query, in the same breath as the delete. That place is the function.
 *
 * The UI decides which button to SHOW. The function decides what may HAPPEN, and it re-checks
 * ownership and emptiness whatever the screen believed.
 */

/** Must match the region the function is deployed to - see functions/index.js. */
const REGION = 'us-central1';

let fns: Functions | null = null;
const functionsClient = () => (fns ??= getFunctions(app, REGION));

export type DeleteBlocker = {
  what: string;
  count: string;
  items: string[];
  consequence: string;
};

export class GuardedDeleteError extends Error {
  /** 'blocked' — something lives under it. 'not-deployed' — the function is missing. */
  readonly kind: 'blocked' | 'not-deployed' | 'denied' | 'gone' | 'unknown';
  readonly blockers: DeleteBlocker[];
  readonly advice: string;
  constructor(kind: GuardedDeleteError['kind'], message: string, blockers: DeleteBlocker[] = [], advice = '') {
    super(message);
    this.kind = kind;
    this.blockers = blockers;
    this.advice = advice;
  }
}

/**
 * ⚠ A MISSING FUNCTION MUST NOT LOOK LIKE A WORKING ONE (AUDIT F75, F77).
 *
 * F75 was a rule and a writer that each changed correctly, disagreed, and went unnoticed for
 * three days because the only action that would have revealed it was one nobody performed.
 * A function is a THIRD thing that deploys separately and can drift the same way - and the
 * most likely drift is the simplest: it was never deployed at all.
 *
 * The callable SDK reports that as `functions/not-found` or `functions/internal`, which a
 * generic catch would render as "something went wrong" - indistinguishable from a network
 * blip, and the operator would retry forever. So it is named, and it says what to do
 * instead: the admin script still works and is not going anywhere.
 */
function translate(err: any): GuardedDeleteError {
  const code = String(err?.code || '');
  const details = err?.details || {};

  if (code === 'functions/not-found' || code === 'functions/unimplemented') {
    return new GuardedDeleteError(
      'not-deployed',
      'The delete function is not deployed, so nothing was changed.',
      [],
      'Deploy it with "firebase deploy --only functions", or delete this record with '
      + 'scripts/admin/delete-at.js, which performs the same check.',
    );
  }
  if (code === 'functions/failed-precondition') {
    return new GuardedDeleteError(
      'blocked',
      err?.message || 'This record still has things under it.',
      Array.isArray(details.blocking) ? details.blocking : [],
      String(details.advice || ''),
    );
  }
  if (code === 'functions/permission-denied' || code === 'functions/unauthenticated') {
    return new GuardedDeleteError('denied', err?.message || 'You are not allowed to delete that record.');
  }
  if (code === 'functions/not-found-doc' || code === 'functions/aborted') {
    return new GuardedDeleteError('gone', err?.message || 'That record no longer exists.');
  }

  // Anything else, including a genuine network failure. NOT reported as success, and not
  // dressed up as a permission problem - the operator is told the state is unknown, which
  // it is.
  return new GuardedDeleteError(
    'unknown',
    err?.message || 'The delete could not be completed.',
    [],
    'Nothing is assumed to have happened. Reload and check whether the record is still there '
    + 'before trying again.',
  );
}

export async function deleteIfEmpty(
  collection: 'atMasters' | 'agencies',
  id: string,
): Promise<{ name: string; label: string }> {
  try {
    const call = httpsCallable(functionsClient(), 'deleteIfEmpty');
    const res: any = await call({ collection, id });
    return { name: String(res?.data?.name || ''), label: String(res?.data?.label || 'record') };
  } catch (err) {
    throw translate(err);
  }
}
