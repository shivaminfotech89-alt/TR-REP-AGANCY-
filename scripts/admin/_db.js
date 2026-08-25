// SHARED INITIALISATION for the local admin runner.
//
// Every script under scripts/admin/ starts here. Run them with plain Node:
//
//     node scripts/admin/<script>.js
//
// WHAT THIS IS FOR
// ----------------
// The console scripts in scripts/*.js run in the browser as a signed-in user, so they see
// only that user's own data and have to be pasted once per account. A census that spans
// owners - "every agency, every job, whoever owns it" - cannot be done that way at all
// without signing in as each of them in turn.
//
// The Admin SDK authenticates as a service account and reads the project directly. One
// command, no browser, no sign-in, every owner.
//
// ⚠ SECURITY RULES DO NOT APPLY TO THIS SDK.
//
// firestore.rules is the safety net for everything else in this codebase. Here there is
// none: a service account can read and write anything in the project. So:
//
//   - Scripts under scripts/admin/ are READ-ONLY unless the filename says otherwise.
//   - A write-capable one must ship with MODE = 'dry-run' and be set back before committing,
//     the same rule the browser scripts follow.
//   - The key never enters the repository. .gitignore covers .secrets/ and the usual
//     serviceAccount filename shapes; check `git status` before committing regardless.
//
// GETTING A KEY
// -------------
//   Firebase console -> Project settings -> Service accounts -> Generate new private key
//   Save the downloaded JSON as:  .secrets/serviceAccountKey.json
//
// Or point at it explicitly:  GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node …

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const KEY_PATHS = [
  process.env.GOOGLE_APPLICATION_CREDENTIALS,
  '.secrets/serviceAccountKey.json',
  'serviceAccountKey.json',
].filter(Boolean);

function loadKey() {
  for (const p of KEY_PATHS) {
    const full = resolve(process.cwd(), p);
    if (existsSync(full)) return { path: full, json: JSON.parse(readFileSync(full, 'utf8')) };
  }
  console.error('\nNo service account key found. Looked in:');
  KEY_PATHS.forEach(p => console.error(`  ${resolve(process.cwd(), p)}`));
  console.error('\nFirebase console -> Project settings -> Service accounts -> Generate new private key');
  console.error('Save it as .secrets/serviceAccountKey.json (gitignored), then run again.\n');
  process.exit(1);
}

// The app config is committed, so the project and database ids come from it rather than
// being retyped here - one source, and a script cannot end up pointed at the wrong database.
const appConfig = JSON.parse(readFileSync(resolve(process.cwd(), 'firebase-applet-config.json'), 'utf8'));

const { path: keyPath, json: key } = loadKey();

if (key.project_id && appConfig.projectId && key.project_id !== appConfig.projectId) {
  console.error(`\nKEY IS FOR THE WRONG PROJECT.\n  key:    ${key.project_id}\n  config: ${appConfig.projectId}\n`);
  process.exit(1);
}

if (!getApps().length) initializeApp({ credential: cert(key) });

/** Firestore handle for the app's NAMED database - not the default one. */
export const db = getFirestore(appConfig.firestoreDatabaseId);

export const projectId = appConfig.projectId;
export const databaseId = appConfig.firestoreDatabaseId;

/** Fetch a whole collection as plain objects. */
export async function all(collection) {
  const snap = await db.collection(collection).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function banner(title) {
  console.log(`\n${title}`);
  console.log(`project ${projectId}  ·  database ${databaseId}`);
  console.log(`key ${keyPath.replace(process.cwd(), '.')}`);
  console.log('READ-ONLY — nothing in this script writes.\n');
}

/** Dates from Firestore come as Timestamp, number, or ISO string. See AUDIT F58. */
export function toMillis(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v?.toDate === 'function') return v.toDate().getTime();
  if (typeof v?._seconds === 'number') return v._seconds * 1000;
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const str = String(v).trim();
  const n = /^\d+$/.test(str) ? Number(str) : Date.parse(str);
  return isNaN(n) ? null : n;
}

export function fmtDate(v) {
  const ms = toMillis(v);
  return ms === null ? '(none)' : new Date(ms).toLocaleString('en-IN');
}
