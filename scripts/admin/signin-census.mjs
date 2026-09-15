/**
 * WHO HAS SIGNED IN, AND WHEN - the blast radius of a broken sign-in path.
 *
 * READ-ONLY. Nothing here writes.
 *
 *     node scripts/admin/signin-census.mjs
 *
 * ⚠ WHAT THIS CAN AND CANNOT ANSWER. Firebase Auth records `lastSignInTime` and
 * `lastRefreshTime` per account. IT RECORDS NO USER AGENT, so nothing here can say which
 * accounts are on Chrome for Android - only when each last authenticated and when its session
 * last refreshed. The device question is not answerable from this data and must not be
 * inferred from it.
 *
 * ⚠ AND `lastSignInTime` IS NOT "LAST USED". A persisted session refreshes without a new
 * sign-in, so a user working daily on a desktop that signed in months ago shows an old
 * sign-in time and a recent refresh. The two columns together are the honest picture:
 * refresh says "still working", sign-in says "last had to authenticate".
 *
 * That distinction is the whole point here. A mobile user who CANNOT complete sign-in leaves
 * NO trace at all - no account row changes - so absence of evidence for them is expected and
 * is not evidence of absence.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const cfg = JSON.parse(readFileSync('firebase-applet-config.json', 'utf8'));
const key = JSON.parse(readFileSync('.secrets/serviceAccountKey.json', 'utf8'));
const app = initializeApp({ credential: cert(key) });
const db = getFirestore(app, cfg.firestoreDatabaseId);

const fmt = (v) => (v ? new Date(v).toISOString().slice(0, 16).replace('T', ' ') : '(never)');
const days = (v) => (v ? Math.round((Date.now() - new Date(v).getTime()) / 86400000) : null);

console.log(`\nproject ${cfg.projectId}   READ-ONLY\n`);

const [users, agencySnap] = await Promise.all([
  getAuth(app).listUsers(1000),
  db.collection('agencies').get(),
]);

const agencies = agencySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const byOwner = new Map();
for (const a of agencies) {
  const list = byOwner.get(a.ownerId) || [];
  list.push(a.name || a.id);
  byOwner.set(a.ownerId, list);
}

console.log(`${users.users.length} account(s), ${agencies.length} agenc(ies)\n`);

const rows = users.users
  .map((u) => ({
    email: u.email || '(no email)',
    agencies: (byOwner.get(u.uid) || []).join(', ') || '(none)',
    created: fmt(u.metadata.creationTime),
    lastSignIn: fmt(u.metadata.lastSignInTime),
    signInDaysAgo: days(u.metadata.lastSignInTime),
    lastRefresh: fmt(u.metadata.lastRefreshTime),
    refreshDaysAgo: days(u.metadata.lastRefreshTime),
    providers: u.providerData.map((p) => p.providerId).join(',') || '(none)',
  }))
  .sort((a, b) => (a.signInDaysAgo ?? 1e9) - (b.signInDaysAgo ?? 1e9));

console.table(rows.map(({ signInDaysAgo, refreshDaysAgo, ...r }) => r));

const ownerless = agencies.filter((a) => !users.users.some((u) => u.uid === a.ownerId));
console.log(`\nagencies whose ownerId matches no account: ${ownerless.length}`);
for (const a of ownerless) console.log(`   ${a.name || a.id}`);

const recentSignIn = rows.filter((r) => r.signInDaysAgo !== null && r.signInDaysAgo <= 7).length;
const recentRefresh = rows.filter((r) => r.refreshDaysAgo !== null && r.refreshDaysAgo <= 7).length;
console.log(`\nsigned in within 7 days:  ${recentSignIn} of ${rows.length}`);
console.log(`session refreshed within 7 days: ${recentRefresh} of ${rows.length}`);
console.log('\n⚠ No user agent is recorded, so none of the above identifies a device or browser.');
console.log('⚠ A user who CANNOT complete sign-in changes nothing here - they leave no trace.');
