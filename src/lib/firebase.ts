import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, getFirestore, collection, query, where, getDocs, doc, getDoc, writeBatch, updateDoc } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { formatDDMMYYYY, toMillis } from './utils';
import { SCHEDULE_A, bandForKva } from './ugvclSchedule2020';
import { scheduleSrForMasterCode, variantAxisForMasterCode } from './scheduleItemMap';
import { defaultOverhaulingEstimateData, defaultCircleLimitsEstimateData } from './estimateData';

const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(
  app, 
  { experimentalForceLongPolling: true }, 
  firebaseConfig.firestoreDatabaseId
);
export const auth = getAuth(app);

// Dev-only diagnostic handles for read-only console scripts (scripts/*.js).
//
// The console cannot resolve bare module specifiers like 'firebase/firestore' -
// those only exist through Vite's build step - so diagnostics reuse the app's
// already-initialised instance instead of importing their own. Same instance,
// same signed-in session, which is what a diagnostic wants anyway.
//
// `import.meta.env.DEV` is statically replaced with `false` in a production build,
// so this becomes `if (false) { ... }` and is dropped as dead code. Nothing is
// exposed in production, and nothing here changes app behaviour in dev.
if (import.meta.env.DEV) {
  (window as any).__db = db;
  (window as any).__auth = auth;
  // Keep this list in step with what the scripts in /scripts destructure. A script that
  // needs a handle absent from here fails at its own guard rather than mid-write, which is
  // the intended behaviour - but the fix belongs here, not in the script.
  //   collection/query/where/getDocs/doc/getDoc - every read-only diagnostic
  //   writeBatch  - backfill-condition.js, reverse-bulk-move.js (bulk, batched)
  //   updateDoc   - fix-woundcore-scrap-code.js (single document, single field)
  (window as any).__fs = { collection, query, where, getDocs, doc, getDoc, writeBatch, updateDoc };
  // DATE FORMATTING, exposed for the same reason as the Firestore handles.
  //
  // A console script cannot import from src, so every diagnostic that printed a date
  // hand-rolled one - and one of them hand-rolled `Number(x) || Date.parse(x)`, which
  // silently mis-renders a Firestore Timestamp. formatDDMMYYYY already knew about
  // Timestamps; the script reimplemented it badly instead of reaching for it, because
  // there was no way to reach for it. There is now (AUDIT F58).
  (window as any).__utils = { formatDDMMYYYY, toMillis };
  // TENDER SCHEDULE, for diagnostics that compare stored rates against it.
  //
  // Same reason as __utils: a console script cannot import from src, and the alternative
  // is a script carrying its own transcription of Schedule-A - a second copy of the tender,
  // which is the defect class this audit exists to remove. One transcription, reachable.
  (window as any).__schedule = { SCHEDULE_A, bandForKva, scheduleSrForMasterCode, variantAxisForMasterCode };
  // SHIPPED SHELLS for the two sections that have no baseline in public_config. A
  // diagnostic cannot otherwise tell "this agency stores the shell" from "this agency
  // stores its own rates that happen to look like the shell" - which is the only handle
  // left on whether a bulk write replaced a hand-maintained section (AUDIT O31).
  (window as any).__defaults = { defaultOverhaulingEstimateData, defaultCircleLimitsEstimateData };
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: any, operationType: OperationType, path: string | null) {
  
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));

  // SHOW THE OPERATOR SOMETHING SPECIFIC, then rethrow.
  //
  // This function used to log and rethrow only. Every caller wraps it in a catch, so the
  // rethrow escaped as an UNHANDLED REJECTION: the screen did nothing at all - no message,
  // no state change, the spinner simply stopped. An operator who had just typed an
  // inspection saw a form that looked saved and navigated away from data that was never
  // written. That was true of every Firestore failure in the app, not only the one that
  // exposed it (AUDIT F45).
  //
  // The message says WHAT failed and, above all, THAT NOTHING WAS SAVED - which is the
  // fact that decides whether it is safe to leave the screen. A generic "an error
  // occurred" does not answer that, and an operator who cannot tell will assume the save
  // worked, because it usually does.
  //
  // The rethrow is KEPT: callers' `finally` blocks must still run to clear their
  // submitting state, and a caller that wants to handle the error itself still can. This
  // adds a floor, it does not take over.
  alert(userFacingMessage(error, operationType, path));

  throw new Error(JSON.stringify(errInfo));
}

/**
 * Plain-language failure text. Deliberately names the operation and the consequence rather
 * than the Firestore error code - "permission-denied" tells an operator nothing they can
 * act on, while "nothing was saved" tells them not to navigate away.
 */
function userFacingMessage(error: any, operationType: OperationType, path: string | null): string {
  const raw = (error instanceof Error ? error.message : String(error)) || '';
  const code = String((error && (error as any).code) || '').toLowerCase();

  const wrote = operationType === OperationType.CREATE
    || operationType === OperationType.UPDATE
    || operationType === OperationType.WRITE
    || operationType === OperationType.DELETE;

  const what = wrote
    ? 'NOTHING WAS SAVED. Your entry is still on screen - do not navigate away until it saves.'
    : 'The data could not be loaded, so what you see may be incomplete or out of date.';

  let why: string;
  if (code.includes('permission-denied') || raw.includes('permission-denied') || raw.includes('Missing or insufficient permissions')) {
    why = 'The database refused the write. This usually means a field is in a shape the security rules do not accept, or you are signed in as an account without access to this agency.';
  } else if (code.includes('unavailable') || raw.includes('offline') || raw.includes('network')) {
    why = 'The database could not be reached. Check the connection and try again - nothing has been lost.';
  } else if (code.includes('not-found') || raw.includes('No document to update')) {
    why = 'The record being updated no longer exists. It may have been deleted in another session.';
  } else if (code.includes('failed-precondition')) {
    why = 'The database rejected the operation because another change landed first. Reload and try again.';
  } else {
    why = raw.slice(0, 300) || 'Unknown database error.';
  }

  const target = path ? `\n\nRecord: ${path}` : '';
  return `Could not ${operationType} to the database.\n\n${what}\n\n${why}${target}\n\n` +
    `If this repeats, the full technical detail is in the browser console (F12).`;
}
