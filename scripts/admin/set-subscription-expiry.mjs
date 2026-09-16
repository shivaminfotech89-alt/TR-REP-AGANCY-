/**
 * CORRECT ONE AGENCY'S SUBSCRIPTION EXPIRY - DRY RUN BY DEFAULT (AUDIT G100).
 *
 *     node scripts/admin/set-subscription-expiry.mjs --agency <id> --expiry YYYY-MM-DD
 *     node scripts/admin/set-subscription-expiry.mjs --agency <id> --expiry YYYY-MM-DD --reason "..." --apply
 *
 * ⚠ DRY RUN IS THE DEFAULT; --apply IS THE ONLY WAY TO WRITE, AND IT REQUIRES --reason.
 *
 * WHAT A WRITE TOUCHES - stated because an expiry is read in more places than the admin panel:
 *   - subscriptions/<id>.expiryDate            the only field changed
 *   - subscriptions/<id>.history               one entry appended: op 'correct_expiry', before,
 *                                              after, reason, by, at
 *   - the app's write gate (trialGate)         reads expiryDate to decide whether the agency may
 *                                              write; a date still in the future changes nothing
 *   - the customer's receipt (lib/receipt.ts)  prints "Runs to <expiryDate>" LIVE from the record,
 *                                              so a receipt reprinted after this shows the new date
 *   - the admin panel "N days left"            recomputed from expiryDate
 * Nothing else is written: status, planAmount, startDate, payment fields are left exactly as they are.
 *
 * ⚠ THE TIME OF DAY IS KEPT. The current expiry is 07:22:02.854 because every extension so far has
 * counted whole days from the original start. The target date takes that same time, so the record
 * stays aligned with how it was built rather than acquiring a midnight that no operation produced.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const APPLY = process.argv.includes('--apply');
const agencyId = arg('agency');
const target = arg('expiry');
const reason = String(arg('reason') || '').trim();

if (!agencyId || !/^\d{4}-\d{2}-\d{2}$/.test(String(target))) {
  console.error('usage: --agency <id> --expiry YYYY-MM-DD [--reason "..." --apply]');
  process.exit(1);
}
if (APPLY && reason.length < 3) {
  console.error('--apply requires --reason: it is the only record of why this was changed.');
  process.exit(1);
}

const cfg = JSON.parse(readFileSync('firebase-applet-config.json', 'utf8'));
const key = JSON.parse(readFileSync('.secrets/serviceAccountKey.json', 'utf8'));
const db = getFirestore(initializeApp({ credential: cert(key) }), cfg.firestoreDatabaseId);

const DAY = 86400000;
const fmt = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').replace('Z', ' UTC') : 'none');
const ref = db.collection('subscriptions').doc(agencyId);
const snap = await ref.get();
if (!snap.exists) { console.error(`no subscriptions document for ${agencyId}`); process.exit(1); }
const sub = snap.data();
const now = Date.now();

const cur = Number(sub.expiryDate || 0);
const curDate = new Date(cur || now);
const [y, m, d] = String(target).split('-').map(Number);
const next = Date.UTC(y, m - 1, d, curDate.getUTCHours(), curDate.getUTCMinutes(),
  curDate.getUTCSeconds(), curDate.getUTCMilliseconds());

console.log(`\nproject ${cfg.projectId}   ${APPLY ? '*** APPLY - THIS WILL WRITE ***' : 'DRY RUN - nothing is written'}`);
console.log(`agency          ${sub.agencyName || ''} (${agencyId})`);
console.log(`status          ${sub.status}   (unchanged)`);
console.log(`expiryDate      ${fmt(cur)}   ->   ${fmt(next)}`);
console.log(`change          ${((next - cur) / DAY).toFixed(2)} days`);
console.log(`days left after ${Math.ceil((next - now) / DAY)}   (the admin panel figure)`);
console.log(`write gate      ${next > now ? 'still open - no change to what the agency can do' : '⚠ CLOSES - the date is in the past'}`);
// The receipt formats the date itself (formatDDMMYYYY); this line does not guess its exact rendering.
console.log(`receipt         "Runs to ..." will show the new expiry when next shown or reprinted`);
console.log(`history         +1 entry: correct_expiry ${fmt(cur)} -> ${fmt(next)}`);

if (!APPLY) {
  console.log('\nDRY RUN - nothing was written. Add --reason "..." --apply to write.\n');
  process.exit(0);
}

await db.runTransaction(async (tx) => {
  const fresh = await tx.get(ref);
  const before = Number(fresh.data()?.expiryDate || 0);
  if (before !== cur) throw new Error('the expiry changed since this run read it - re-run the dry run');
  const history = Array.isArray(fresh.data()?.history) ? fresh.data().history : [];
  tx.update(ref, {
    expiryDate: next,
    history: [...history, { op: 'correct_expiry', before: cur, after: next, reason, by: 'admin-script', at: Date.now() }],
  });
});
console.log('\nWritten.\n');
