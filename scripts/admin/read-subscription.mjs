/**
 * READ ONE AGENCY'S SUBSCRIPTION DOCUMENT - EVERY FIELD, WITH DATES DECODED.
 *
 * READ-ONLY. Nothing here writes.
 *
 *     node scripts/admin/read-subscription.mjs "ZENITH"
 *
 * Matches agencies by name (case-insensitive substring) and prints each one's
 * subscriptions/<agencyId> document in full. Millisecond timestamps are shown with their date and
 * their distance from now in days, because "1636 days" is only checkable against both.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const needle = String(process.argv[2] || '').toLowerCase();
if (!needle) { console.error('usage: node scripts/admin/read-subscription.mjs "<agency name>"'); process.exit(1); }

const cfg = JSON.parse(readFileSync('firebase-applet-config.json', 'utf8'));
const key = JSON.parse(readFileSync('.secrets/serviceAccountKey.json', 'utf8'));
const db = getFirestore(initializeApp({ credential: cert(key) }), cfg.firestoreDatabaseId);

const DAY = 86400000;
const now = Date.now();
const looksLikeMs = (v) => typeof v === 'number' && v > 1.5e12 && v < 4.1e12;
const show = (v) => {
  if (v && typeof v.toDate === 'function') v = v.toDate().getTime();
  if (looksLikeMs(v)) {
    const d = new Date(v);
    return `${v}  = ${d.toISOString()}  (${((v - now) / DAY).toFixed(2)} days from now)`;
  }
  return JSON.stringify(v);
};

console.log(`\nproject ${cfg.projectId}   READ-ONLY   now = ${new Date(now).toISOString()}\n`);

const agencies = (await db.collection('agencies').get()).docs
  .filter((d) => String(d.data().name || '').toLowerCase().includes(needle));
if (agencies.length === 0) { console.log('no agency matched'); process.exit(0); }

for (const a of agencies) {
  console.log(`=== agency "${a.data().name}"  id ${a.id}`);
  const sub = await db.collection('subscriptions').doc(a.id).get();
  if (!sub.exists) { console.log('   (no subscriptions document)\n'); continue; }
  const data = sub.data();
  for (const k of Object.keys(data).sort()) {
    const v = data[k];
    if (Array.isArray(v)) {
      console.log(`   ${k}: [${v.length}]`);
      v.forEach((item, i) => {
        console.log(`     [${i}]`);
        for (const kk of Object.keys(item || {}).sort()) console.log(`        ${kk}: ${show(item[kk])}`);
      });
    } else if (v && typeof v === 'object' && typeof v.toDate !== 'function') {
      console.log(`   ${k}:`);
      for (const kk of Object.keys(v).sort()) console.log(`      ${kk}: ${show(v[kk])}`);
    } else {
      console.log(`   ${k}: ${show(v)}`);
    }
  }
  console.log('');
}
