/**
 * BRING EVERY AT'S `lastJobNumbers` BACK TO WHAT ITS OWN JOBS JUSTIFY (AUDIT O89).
 *
 *     node scripts/admin/repair-at-counters.mjs            # DRY RUN - reports, writes nothing
 *     node scripts/admin/repair-at-counters.mjs --apply     # writes
 *
 * ⚠ DRY RUN IS THE DEFAULT AND --apply IS THE ONLY WAY TO WRITE. Every other admin script in
 * this directory is read-only; this one is not, so the safe mode is the one you get by
 * forgetting the flag.
 *
 * WHY THIS EXISTS. F42 seeded new tenders from the agency's high-water mark, so counters hold
 * numbers no job under that tender ever used: SAMOR's `DAEESA-1_*` and `DEESA-2_*` all store
 * 24/9 against ZERO jobs, ADMIN's `DEESA_CRGO` stores 29 against zero, MEGHA's
 * `SABARMATI_CRGO` stores 35 against a real high-water of 23. Changing the RULE for new
 * tenders does nothing to these - a tender whose counter already reads 24 still offers 25.
 *
 * TWO CASES, AND THEY ARE NOT THE SAME:
 *
 *   - AT WITH NO JOBS      -> CLEAR the counter entirely. Nobody earned those numbers; the
 *                             tender has issued nothing, so it starts at 1 like any other.
 *   - AT WITH JOBS         -> SET each key to that AT's real high-water mark. NOT cleared:
 *                             a counter below its own issued numbers would offer them again,
 *                             which is the duplicate this whole thread is about. MEGHA's
 *                             `SABARMATI_CRGO` must read 23, not empty.
 *
 * ⚠ KEYS WITH JOBS ARE NEVER LOWERED BELOW THEIR OWN HIGH-WATER, and keys with no jobs on an
 * AT that HAS other jobs are dropped - they are seeded values for divisions this tender never
 * touched. Both follow from the same rule: a counter describes what THIS tender issued.
 *
 * The app's own rules are reproduced here exactly, not re-read - see at-job-number-census.mjs
 * for why that matters. If getCounterKey, jobNoSequence or the GP/Cancelled exclusions change
 * in src, this script is wrong and must change with them.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');

const cfg = JSON.parse(readFileSync('firebase-applet-config.json', 'utf8'));
const key = JSON.parse(readFileSync('.secrets/serviceAccountKey.json', 'utf8'));
const db = getFirestore(initializeApp({ credential: cert(key) }), cfg.firestoreDatabaseId);

/** AgencyContext.tsx getCounterKey, verbatim in behaviour. */
function getCounterKey(division, coreType = 'CRGO') {
  const div = (division || '').trim();
  const type = (coreType || 'CRGO').trim().toUpperCase();
  if (type === 'OH' || type.includes('OVERHAUL')) return `${div}_OH`;
  if (type.includes('AMORPHOUS') || type.includes('AM')) return `${div}_AMORPHOUS`;
  if (type.includes('WOUND') || type.includes('WC')) return `${div}_WOUND_CORE`;
  if (type.includes('LSTC') || type.includes('SDT') || type.includes('PLMT') || type.includes('PAT')) {
    return `${div}_LSTC`;
  }
  return `${div}_CRGO`;
}

/** AgencyContext.tsx jobNoSequence, verbatim in behaviour. */
function jobNoSequence(jobNo) {
  const raw = String(jobNo ?? '').trim();
  if (!raw) return null;
  const dash = raw.lastIndexOf('-');
  const n = parseInt(dash >= 0 ? raw.slice(dash + 1) : raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** addAtMaster's exclusions - the jobs that never advance a counter. */
const skipForCounters = (j) => (j.repairType || '').toUpperCase() === 'GP'
  || j.isGp || j.status === 'Cancelled' || j.isCancelled || j.mrStatus === 'Cancelled';

console.log(`\nproject ${cfg.projectId}   ${APPLY ? '*** APPLY - THIS WILL WRITE ***' : 'DRY RUN - nothing is written'}\n`);

const [atSnap, jobSnap, agencySnap] = await Promise.all([
  db.collection('atMasters').get(),
  db.collection('jobs').get(),
  db.collection('agencies').get(),
]);
const ats = atSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const jobs = jobSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const agencyName = new Map(agencySnap.docs.map((d) => [d.id, d.data().name || d.id]));

// The real high-water per AT per counter key - the only authority here.
const highWater = new Map();   // atId -> key -> max
for (const j of jobs) {
  if (skipForCounters(j)) continue;
  const n = jobNoSequence(j.jobNo);
  if (n === null) continue;
  const division = String(j.division ?? '').trim();
  if (!division) continue;
  const atId = String(j.atId ?? '').trim();
  if (!atId) continue;                       // belongs to no tender - advances no counter (A3)
  const k = getCounterKey(division, j.coreType || 'CRGO');
  if (!highWater.has(atId)) highWater.set(atId, new Map());
  const m = highWater.get(atId);
  if (!m.has(k) || n > m.get(k)) m.set(k, n);
  /**
   * ⚠ THE BARE `<div>` KEY IS DELIBERATELY *NOT* WRITTEN HERE, AND THE REASON IS NOT THAT
   * THE DUAL-KEY RULE IS FICTIONAL - IT IS REAL.
   *
   * CRGO genuinely counts under EITHER `<div>_CRGO` or a bare `<div>`: the save paths
   * advance both together (AgencyContext addAtMaster, MrLedger:1167), and
   * `predictNextJobNo:2387` reads `Math.max(counters[counterKey], counters[division])`.
   * An earlier revision of this script therefore bumped the bare key too, so a prediction
   * could not sit below a real number.
   *
   * It was removed because it made the repair INVENT keys. `SABARMATI`, `GNR`, `BAVLA`,
   * `DAEESA` were never stored on those tenders, and a repair that writes keys nobody
   * earned has stopped being a repair and become a change.
   *
   * NOTHING IS LOST BY OMITTING IT. `predictNextJobNo` takes the MAX of the two, so
   * `<div>_CRGO` alone already yields the same answer - the bare key can only ever equal
   * or undercut it once `_CRGO` holds the true high-water, which is exactly what this
   * script writes. Bare keys that WERE stored are cleared like any other key with no jobs
   * under it, and the `_CRGO` key carries the number.
   */
}

let changedAts = 0;
let clearedKeys = 0;
let loweredKeys = 0;
let keptKeys = 0;
const writes = [];

for (const at of [...ats].sort((a, b) => Number(a.startDate || 0) - Number(b.startDate || 0))) {
  const stored = at.lastJobNumbers || {};
  const real = highWater.get(at.id) || new Map();
  const hasJobs = real.size > 0;
  const storedKeys = Object.keys(stored);
  if (storedKeys.length === 0 && !hasJobs) continue;

  const next = {};
  for (const [k, v] of real) next[k] = v;          // never below this tender's own numbers

  const rows = [...new Set([...storedKeys, ...real.keys()])].sort().map((k) => {
    const before = stored[k] === undefined ? '-' : Number(stored[k]);
    const after = next[k] === undefined ? '(cleared)' : next[k];
    let action;
    if (next[k] === undefined) { action = 'CLEAR - no jobs under this tender'; clearedKeys++; }
    else if (before === '-') { action = 'set from jobs'; loweredKeys++; }
    else if (Number(before) > next[k]) { action = `lower ${before} -> ${next[k]}`; loweredKeys++; }
    else if (Number(before) < next[k]) { action = `RAISE ${before} -> ${next[k]} (counter sat below its own jobs)`; loweredKeys++; }
    else { action = 'unchanged'; keptKeys++; }
    return { key: k, before, after, action };
  });

  const differs = rows.some((r) => r.action !== 'unchanged');
  if (!differs) continue;
  changedAts++;

  console.log(`\n${at.name || '(unnamed)'}   [${at.status || '?'}]   agency: ${agencyName.get(at.agencyId) || at.agencyId}`);
  console.log(`   id: ${at.id}   jobs under this tender: ${hasJobs ? [...real.values()].length + ' key(s)' : 'NONE'}`);
  console.table(rows);
  writes.push({ id: at.id, next });
}

console.log('\n' + '-'.repeat(90));
console.log(`ATs needing repair : ${changedAts} of ${ats.length}`);
console.log(`keys cleared       : ${clearedKeys}`);
console.log(`keys reset to jobs : ${loweredKeys}`);
console.log(`keys already right : ${keptKeys}`);

if (!APPLY) {
  console.log('\nDRY RUN - nothing was written. Re-run with --apply to write the "after" column.');
} else {
  console.log(`\nWriting ${writes.length} document(s)...`);
  for (const w of writes) {
    await db.collection('atMasters').doc(w.id).update({ lastJobNumbers: w.next });
    console.log(`   wrote ${w.id}`);
  }
  console.log('Done.');
}
