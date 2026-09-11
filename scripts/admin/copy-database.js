// COPY THE WHOLE DATABASE INTO A NEW, EMPTY ONE - THE FALLBACK IF "UPGRADE DATABASE" DOES NOT LIFT THE LIMIT (AUDIT O71)
//
//   node scripts/admin/copy-database.js --target=<new-database-id>                    <- DRY RUN, writes nothing
//   node scripts/admin/copy-database.js --target=<new-database-id> --apply            <- copies, after MODE is changed
//   node scripts/admin/copy-database.js --target=<new-database-id> --apply --resume   <- continues a copy that stopped
//
// ⚠ MODE MUST BE 'dry-run' IN THE REPOSITORY. Change it to run, change it back before committing.
// Security rules do NOT apply to the Admin SDK - see _db.js.
//
// WHY
// ---
// The production database was created by AI Studio as a free-tier-limited database: 50,000 read units a day, and
// billing does not lift that on its own. The first remedy is the console's Upgrade database button. If that does not
// work, the data has to move to a database created normally, and this is the move.
//
// WHAT IT DOES
// ------------
// SOURCE is the database the app uses now: firebase-applet-config.json's firestoreDatabaseId, via _db.js.
// TARGET is --target, a database that must already exist and must be EMPTY.
//
//   - Every root collection the SOURCE lists, and every subcollection found beneath any document, is copied.
//   - Document ids are preserved.
//   - Values are preserved exactly: Timestamps, GeoPoints and bytes pass through, and a DocumentReference is re-pointed
//     at the same path in the TARGET.
//   - Anything else that is not plain data REFUSES the run rather than being silently converted.
//   - After copying, EVERY copied document is read back from the TARGET and compared by hash with what was read from
//     the SOURCE. A missing or different document fails the run (exit 3).
//
// WHAT IT DOES NOT DO
// -------------------
//   - It deletes nothing, in either database. A document in the TARGET that the SOURCE no longer has is listed, not
//     removed.
//   - It changes no configuration and deploys nothing. The switch is the owner's, and is printed at the end.
//   - Firestore's own create and update times are not preserved: every document is new in the TARGET. The app keeps
//     its own date fields, which are copied.
//   - A double that happens to be whole (5.0) is written back as the integer 5. JavaScript cannot tell them apart, and
//     neither can the app.
//   - A "missing" document - one with no fields that exists only because something sits beneath it - is not found by
//     a query, so is not copied. The app writes no subcollections (checked 2026-09-12), so none should exist.
//
// ⚠ WRITES MADE WHILE IT RUNS ARE NOT IN THE COPY
// ----------------------------------------------
// The app, and the payment and subscription functions, keep writing to the SOURCE until the switch is deployed. A
// document changed after this script read it is copied as it was. Either freeze writes first, or re-run with
// --resume after the switch: that re-reads the SOURCE and rewrites only what differs. --resume cannot see deletions;
// the verification lists those.
//
// COST
// ----
//   - SOURCE: one full read of every document, billed as read units on bytes (4 KiB each). It counts against the free
//     daily quota, so run it early in the quota day and with the app quiet.
//   - TARGET: one write per document, billed as write units on bytes (1 KiB each) plus index entries, then one read of
//     everything for the verification. A new database is billed from its first operation.
//   - The run prints the KiB it read, so the cost is known afterwards rather than estimated.

import { db as source, databaseId as SOURCE_ID, projectId, banner } from './_db.js';
import { getFirestore, FieldPath, Timestamp, GeoPoint, DocumentReference } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';

const MODE = 'dry-run';   // 'dry-run' | 'apply'
const APPLY = MODE === 'apply' && process.argv.includes('--apply');
const RESUME = process.argv.includes('--resume');
const TARGET_ID = (process.argv.find(a => a.startsWith('--target=')) || '').slice('--target='.length).trim();

const PAGE = 300;                        // documents per source query
const BATCH_DOCS = 200;                  // documents per commit
const BATCH_BYTES = 4 * 1024 * 1024;     // and no more than this per commit (the request limit is 10 MiB)

banner('COPY THE DATABASE TO A NEW ONE');
console.log(`MODE = '${MODE}'${APPLY ? '   ** WRITING TO THE TARGET **' : '   (dry run - nothing will be written)'}`);
if (process.argv.includes('--apply') && !APPLY) console.log(`--apply ignored: MODE is '${MODE}' in the file.`);
console.log(`source ${SOURCE_ID}\ntarget ${TARGET_ID || '(none given)'}${RESUME ? '   --resume' : ''}\n`);

const refuse = msg => { console.error(`\nREFUSED - ${msg}\nNothing was written.`); process.exit(2); };

if (!TARGET_ID) refuse('no --target=<database id>. Create the new database first (Firebase console -> Firestore -> Create database).');
if (TARGET_ID === SOURCE_ID) refuse('the target is the source database.');
if (TARGET_ID === '(default)' || !/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/.test(TARGET_ID)) {
  refuse(`"${TARGET_ID}" is not a named database id (4-63 characters: lowercase letters, digits and hyphens, starting with a letter).`);
}

const target = getFirestore(TARGET_ID);

// --- values ----------------------------------------------------------------------------------------------------------
const isPlain = v => { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; };
const unsupported = (v, where) => { throw new Error(`unsupported value type ${v?.constructor?.name ?? typeof v} in ${where}`); };

/** A form that is equal for equal Firestore values, whichever database they came from. */
function canon(v, where) {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Timestamp) return { __t: 'ts', s: v.seconds, n: v.nanoseconds };
  if (v instanceof GeoPoint) return { __t: 'geo', lat: v.latitude, lng: v.longitude };
  if (v instanceof DocumentReference) return { __t: 'ref', p: v.path };
  if (v instanceof Uint8Array) return { __t: 'bytes', b: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(x => canon(x, where));
  if (!isPlain(v)) unsupported(v, where);
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = canon(v[k], where);
  return out;
}
const hashOf = (data, where) => createHash('sha256').update(JSON.stringify(canon(data, where))).digest('hex');

let refsRepointed = 0;
/** The same value, with any reference re-pointed at the target database. */
function forTarget(v, where) {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof DocumentReference) { refsRepointed++; return target.doc(v.path); }
  if (v instanceof Timestamp || v instanceof GeoPoint || v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return v.map(x => forTarget(x, where));
  if (!isPlain(v)) unsupported(v, where);
  const out = {};
  for (const k of Object.keys(v)) out[k] = forTarget(v[k], where);
  return out;
}

// --- reading ---------------------------------------------------------------------------------------------------------
async function eachPage(colRef, fn, { idsOnly = false } = {}) {
  let last = null;
  for (;;) {
    let q = colRef.orderBy(FieldPath.documentId()).limit(PAGE);
    if (idsOnly) q = q.select();
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return;
    await fn(snap.docs);
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) return;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- the target must exist, and must be empty unless resuming ---------------------------------------------------------
let targetCollections;
try {
  targetCollections = await target.listCollections();
} catch (e) {
  refuse(`the target database could not be listed (${e.code ?? ''} ${e.message}). Does "${TARGET_ID}" exist in project ${projectId}?`);
}
if (targetCollections.length > 0 && !RESUME) {
  refuse(`the target is not empty - it has ${targetCollections.map(c => c.id).join(', ')}. Use --resume only to continue a copy this script started.`);
}
if (targetCollections.length === 0 && RESUME) console.log('--resume given, but the target is empty: this is a full copy.\n');

let sourceCollections;
try {
  sourceCollections = await source.listCollections();
} catch (e) {
  refuse(`the source could not be listed (${e.code ?? ''} ${e.message}). If this is RESOURCE_EXHAUSTED, the day's quota is spent - wait for the reset.`);
}
console.log(`Source root collections (${sourceCollections.length}): ${sourceCollections.map(c => c.id).join(', ') || '(none)'}`);
console.log(`Target root collections (${targetCollections.length}): ${targetCollections.map(c => c.id).join(', ') || '(none)'}\n`);
if (sourceCollections.length === 0) refuse('the source lists no collections - wrong database, or no access.');

// --- dry run stops here ----------------------------------------------------------------------------------------------
function printSwitch() {
  console.log(`
AFTER A VERIFIED COPY - THE SWITCH, IN THIS ORDER (the owner's steps; this script does none of them)
  1. firebase.json -> firestore.database = "${TARGET_ID}", then:   firebase deploy --only firestore
     (rules and indexes onto the new database, before any client reads it)
  2. firebase-applet-config.json -> firestoreDatabaseId = "${TARGET_ID}"
     (read by src/lib/firebase.ts, scripts/admin/_db.js and the older scripts)
  3. firebase deploy --only functions,hosting
     (the predeploy hook copies the config into functions/app-config.json; the hosting build bundles it)
  4. Every open tab must reload - a tab loaded before the switch keeps writing to the old database.
  5. Re-run this script with --apply --resume if anything was written to the old database during the copy.
  6. Leave the old database in place until the new one has been used for a working day. Delete nothing.`);
}

if (!APPLY) {
  console.log('DRY RUN: the target exists and is usable, and the source can be listed. No document was read or written.');
  console.log('An apply reads every document once (see COST at the top of this file), writes each to the target, and reads each back.');
  printSwitch();
  process.exit(0);
}

// --- copy ------------------------------------------------------------------------------------------------------------
const copied = new Map();          // path -> hash of what was read from the source
const perCollection = new Map();   // root collection -> documents read
let kibRead = 0, written = 0, unchanged = 0, subcollections = 0;

class Batcher {
  constructor() { this.ops = []; this.bytes = 0; }
  async set(path, data, bytes) {
    if (this.ops.length >= BATCH_DOCS || this.bytes + bytes > BATCH_BYTES) await this.flush();
    this.ops.push([path, data]);
    this.bytes += bytes;
  }
  async flush() {
    if (this.ops.length === 0) return;
    for (let attempt = 1; ; attempt++) {
      const batch = target.batch();   // rebuilt each attempt: a committed batch cannot be committed again
      for (const [path, data] of this.ops) batch.set(target.doc(path), data);
      try { await batch.commit(); break; } catch (e) {
        if (attempt >= 5) throw new Error(`commit of ${this.ops.length} documents failed 5 times, first ${this.ops[0][0]}: ${e.code ?? ''} ${e.message}`);
        console.log(`  commit failed (${e.code ?? ''} ${e.message}) - retry ${attempt} of 4`);
        await sleep(1000 * 2 ** attempt);
      }
    }
    written += this.ops.length;
    this.ops = [];
    this.bytes = 0;
  }
}

async function copyCollection(colRef, root) {
  await eachPage(colRef, async docs => {
    const existing = new Map();
    if (RESUME) {
      const snaps = await target.getAll(...docs.map(d => target.doc(d.ref.path)));
      for (const s of snaps) if (s.exists) existing.set(s.ref.path, hashOf(s.data(), s.ref.path));
    }
    const batcher = new Batcher();
    for (const d of docs) {
      const path = d.ref.path;
      const data = d.data();
      const h = hashOf(data, path);
      const bytes = Buffer.byteLength(JSON.stringify(canon(data, path)));
      copied.set(path, h);
      kibRead += bytes / 1024;
      perCollection.set(root, (perCollection.get(root) ?? 0) + 1);
      if (existing.get(path) === h) { unchanged++; continue; }
      await batcher.set(path, forTarget(data, path), bytes);
    }
    await batcher.flush();

    const subs = await Promise.all(docs.map(d => d.ref.listCollections()));
    for (const list of subs) {
      for (const sub of list) { subcollections++; await copyCollection(sub, root); }
    }
  });
}

const startedAt = new Date();
try {
  for (const col of sourceCollections) {
    const before = written;
    await copyCollection(col, col.id);
    console.log(`  ${col.id.padEnd(24)} read ${String(perCollection.get(col.id) ?? 0).padStart(6)}   written ${String(written - before).padStart(6)}`);
  }
} catch (e) {
  console.error(`\nSTOPPED - ${e.message}`);
  console.error(`${written} documents were written before it stopped. Re-run with --apply --resume to continue.`);
  process.exit(2);
}
console.log(`\nCopied: ${copied.size} documents read (${kibRead.toFixed(0)} KiB, approximate), ${written} written, ${unchanged} already identical, ${subcollections} subcollections, ${refsRepointed} references re-pointed.`);
console.log(`Started ${startedAt.toISOString()} - anything written to the source after that may not be in the copy.\n`);

// --- verify: every copied document, read back from the target ---------------------------------------------------------
const missing = [], differ = [];
const paths = [...copied.keys()];
for (let i = 0; i < paths.length; i += 100) {
  const chunk = paths.slice(i, i + 100);
  const snaps = await target.getAll(...chunk.map(p => target.doc(p)));
  for (const s of snaps) {
    if (!s.exists) missing.push(s.ref.path);
    else if (hashOf(s.data(), s.ref.path) !== copied.get(s.ref.path)) differ.push(s.ref.path);
  }
}

// Documents in the target the source did not supply this run - left over from an earlier run whose source document
// has since been deleted. Listed, never removed. (Root collections only, ids only.)
const extra = [];
for (const col of await target.listCollections()) {
  await eachPage(col, async docs => { for (const d of docs) if (!copied.has(d.ref.path)) extra.push(d.ref.path); }, { idsOnly: true });
}

console.log(`VERIFY: ${paths.length - missing.length - differ.length} of ${paths.length} identical in the target.`);
if (missing.length) console.log(`  MISSING (${missing.length}): ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ' ...' : ''}`);
if (differ.length) console.log(`  DIFFERENT (${differ.length}): ${differ.slice(0, 20).join(', ')}${differ.length > 20 ? ' ...' : ''}`);
if (extra.length) console.log(`  IN THE TARGET BUT NOT READ FROM THE SOURCE (${extra.length}, not removed): ${extra.slice(0, 20).join(', ')}${extra.length > 20 ? ' ...' : ''}`);

if (missing.length || differ.length) {
  console.error('\nFAILED VERIFICATION - do not switch the app to the target.');
  process.exit(3);
}
console.log('\nThe target holds every document read from the source, unchanged.');
printSwitch();
