/**
 * IS "0 SHARED SERIES" A FINDING, OR DID THE GROUPING FIND NOTHING TO COMPARE?
 *
 * READ-ONLY. Nothing here writes.
 *
 *     node scripts/admin/verify-at-grouping.mjs
 *
 * ⚠ THIS CHECKS THE INSTRUMENT, NOT THE DATA. `at-job-number-census.mjs` reported that no
 * prefix+key series is shared by two tenders, and that zero is what a decision to reverse
 * F42 would rest on. A false negative here is shaped exactly like a pass: if almost no AT
 * has jobs attached, or if `prefixFor` resolves to nothing, the collision check reports
 * "no collisions" because it had nothing to compare rather than because nothing collides.
 *
 * ⚠ AND IT LIVES IN scripts/admin/ RATHER THAN THE SCRATCHPAD FOR A REASON. Node resolves
 * ESM imports relative to the IMPORTING FILE, not the process cwd, so a .mjs in a temp
 * directory cannot see node_modules/firebase-admin however it is invoked. That was already
 * found once this session and walked into a second time.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const cfg = JSON.parse(readFileSync('firebase-applet-config.json', 'utf8'));
const key = JSON.parse(readFileSync('.secrets/serviceAccountKey.json', 'utf8'));
const db = getFirestore(initializeApp({ credential: cert(key) }), cfg.firestoreDatabaseId);

const [atSnap, jobSnap, agencySnap] = await Promise.all([
  db.collection('atMasters').get(),
  db.collection('jobs').get(),
  db.collection('agencies').get(),
]);
const ats = atSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const jobs = jobSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const agencyName = new Map(agencySnap.docs.map((d) => [d.id, d.data().name || d.id]));

console.log(`\nproject ${cfg.projectId}   READ-ONLY\n`);

// 1. How much data did the collision check actually have?
const jobsPerAt = new Map();
for (const j of jobs) {
  const a = String(j.atId ?? '').trim() || '(none)';
  jobsPerAt.set(a, (jobsPerAt.get(a) || 0) + 1);
}
const atsWithJobs = [...jobsPerAt.keys()].filter((k) => k !== '(none)');
console.log('--- 1. how many ATs actually have jobs attached? ---');
console.log(`ATs total: ${ats.length}   ATs that appear as a job's atId: ${atsWithJobs.length}`);
console.table([...jobsPerAt.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([atId, n]) => {
    const at = ats.find((a) => a.id === atId);
    return {
      atId,
      tender: at ? (at.name || '(unnamed)') : '(no such AT)',
      agency: at ? (agencyName.get(at.agencyId) || at.agencyId) : '-',
      jobs: n,
    };
  }));

// 2. The only way a collision CAN exist: one agency, two ATs, both with jobs.
console.log('\n--- 2. does any ONE agency have TWO ATs that both have jobs? ---');
const byAgency = new Map();
for (const at of ats) {
  if (!byAgency.has(at.agencyId)) byAgency.set(at.agencyId, []);
  byAgency.get(at.agencyId).push({ ...at, jobs: jobsPerAt.get(at.id) || 0 });
}
let comparablePairs = 0;
for (const [ag, list] of byAgency) {
  if (list.length < 2) continue;
  const live = list.filter((x) => x.jobs > 0);
  const flag = live.length > 1 ? '   <-- COMPARABLE PAIR' : '';
  if (live.length > 1) comparablePairs++;
  console.log(`\n${agencyName.get(ag) || ag}: ${list.length} ATs, ${live.length} with jobs${flag}`);
  for (const x of list) {
    console.log(`    ${(x.name || '(unnamed)').padEnd(16)} ${x.id}  status=${x.status || '?'}  jobs=${x.jobs}`);
  }
}
console.log(`\ncomparable pairs (one agency, two ATs both carrying jobs): ${comparablePairs}`);
console.log(comparablePairs === 0
  ? '=> "0 shared series" is EXPECTED, not evidence of safety. Nothing could have collided.'
  : '=> there WERE pairs to compare, so "0 shared series" is a real finding.');

// 3. Does prefixFor resolve at all, or is every series "(no prefix configured)"?
console.log('\n--- 3. do ATs carry prefixes at all? ---');
let withPrefixes = 0;
for (const at of ats) {
  const n = Object.keys(at.prefixes || {}).length;
  if (n > 0) withPrefixes++;
}
console.log(`ATs with a non-empty prefixes map: ${withPrefixes} of ${ats.length}`);
for (const at of ats.filter((a) => (jobsPerAt.get(a.id) || 0) > 0)) {
  console.log(`  ${(at.name || '(unnamed)').padEnd(16)} jobs=${jobsPerAt.get(at.id)}  prefixes=${JSON.stringify(at.prefixes || {}).slice(0, 150)}`);
}
