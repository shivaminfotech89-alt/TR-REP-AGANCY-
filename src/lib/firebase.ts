import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, getFirestore, collection, query, where, getDocs, doc, getDoc, writeBatch, updateDoc } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

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
  throw new Error(JSON.stringify(errInfo));
}
