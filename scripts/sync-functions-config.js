// KEEP functions/app-config.json IDENTICAL TO firebase-applet-config.json.
//
// Run automatically by `firebase deploy` via the predeploy hook in firebase.json.
//
// WHY THIS EXISTS (AUDIT F75, F77)
// --------------------------------
// A deployed function only ships what is inside functions/, so it cannot import the config
// the app and the admin scripts read - it needs its own copy. A copy is a second source of
// truth, and this codebase has already lost three days to two things that were each correct
// and disagreed with each other.
//
// What the copy carries is the NAMED DATABASE id. If it drifts, the function's Admin SDK
// points at `(default)` or at some older database, queries a collection that is empty there,
// finds nothing beneath a document, and DELETES A LIVE TENDER - the guard passing precisely
// because it is looking in the wrong place. That is the failure this file exists to make
// impossible, so it runs on every deploy rather than being remembered.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SRC = 'firebase-applet-config.json';
const DST = 'functions/app-config.json';

const src = readFileSync(SRC, 'utf8');
const before = existsSync(DST) ? readFileSync(DST, 'utf8') : null;

if (before === src) {
  console.log(`[sync-functions-config] ${DST} already matches ${SRC}.`);
} else {
  writeFileSync(DST, src);
  console.log(`[sync-functions-config] ${DST} UPDATED from ${SRC}.`);
  if (before !== null) {
    const a = JSON.parse(before), b = JSON.parse(src);
    if (a.firestoreDatabaseId !== b.firestoreDatabaseId) {
      console.log(`  ⚠ database id changed: ${a.firestoreDatabaseId} -> ${b.firestoreDatabaseId}`);
    }
  }
}

const cfg = JSON.parse(src);
if (!cfg.firestoreDatabaseId) {
  console.error('[sync-functions-config] REFUSING: firestoreDatabaseId is missing from ' + SRC + '.');
  console.error('  The function would fall back to the default database and its guard would');
  console.error('  query an empty collection. Fix the config before deploying.');
  process.exit(1);
}
console.log(`[sync-functions-config] functions will use database: ${cfg.firestoreDatabaseId}`);
