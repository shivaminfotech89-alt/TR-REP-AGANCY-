/**
 * DOES EACH AT'S ALLOTMENT QUOTA MATCH THE LETTERS THAT JUSTIFY IT?
 *
 * READ-ONLY. Nothing here writes.
 *
 *     node scripts/admin/allotment-vs-letters.mjs
 *
 * `AtAllotments` initialises its quota map from `at.allotments || activeAgency.allotments`
 * (:28-30, re-synced at :166-168) and then, on the FIRST letter, deep-copies that inherited
 * map and writes it back to the AT (:208-217). So an agency-level quota nobody issued a letter
 * for becomes the tender's own stored figure the moment one real letter is added - the same
 * shape as the job-number counters in O89, one screen over.
 *
 * This compares, per AT and per division/core type:
 *
 *   STORED   `at.allotments[division][coreType]`      - what the screen shows
 *   LETTERS  sum of `at.allotmentHistory` quantities  - what the paperwork justifies
 *
 * ⚠ A DIFFERENCE IS NOT AUTOMATICALLY AN ERROR, AND THIS SCRIPT DOES NOT SAY IT IS. A quota
 * may legitimately predate the letter history if letters were recorded on paper before the
 * feature existed. What the script CAN say is which figures have no letter behind them in the
 * app, and how much of each quota would remain if only letters counted. Deciding which is
 * right needs the paperwork, and that is not in this database.
 *
 * ⚠ AND `booked` IS SHOWN ALONGSIDE, because it is the floor. A quota cannot honestly be
 * reduced below the jobs already booked against it, so any proposal to rebuild quotas from
 * letters has to be read against what is already committed.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const cfg = JSON.parse(readFileSync('firebase-applet-config.json', 'utf8'));
const key = JSON.parse(readFileSync('.secrets/serviceAccountKey.json', 'utf8'));
const db = getFirestore(initializeApp({ credential: cert(key) }), cfg.firestoreDatabaseId);

/** lib/allotments.ts bookedFor - OGP only; GP repairs do not consume quota. */
const isGpJob = (j) => (j.repairType || '').toUpperCase() === 'GP' || j.isGp;
const isCancelled = (j) => j.status === 'Cancelled' || j.isCancelled || j.mrStatus === 'Cancelled';

console.log(`\nproject ${cfg.projectId}   READ-ONLY\n`);

const [atSnap, jobSnap, agencySnap] = await Promise.all([
  db.collection('atMasters').get(),
  db.collection('jobs').get(),
  db.collection('agencies').get(),
]);
const ats = atSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const jobs = jobSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const agencies = new Map(agencySnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));

// Jobs booked per AT per division/coreType - the floor.
const bookedBy = new Map();
for (const j of jobs) {
  if (isGpJob(j) || isCancelled(j)) continue;
  const atId = String(j.atId ?? '').trim();
  if (!atId) continue;
  const div = String(j.division ?? '').trim();
  const ct = String(j.coreType || 'CRGO').trim();
  if (!div) continue;
  const k = `${div}|${ct}`;
  if (!bookedBy.has(atId)) bookedBy.set(atId, new Map());
  const m = bookedBy.get(atId);
  m.set(k, (m.get(k) || 0) + 1);
}

let atsWithExcess = 0;
let totalExcess = 0;
let atsMatching = 0;
const readyIds = [];

for (const at of [...ats].sort((a, b) => Number(a.startDate || 0) - Number(b.startDate || 0))) {
  const stored = at.allotments || {};
  const history = at.allotmentHistory || [];
  const storedKeys = [];
  for (const [div, byCore] of Object.entries(stored)) {
    for (const [ct, v] of Object.entries(byCore || {})) {
      if (Number(v) > 0) storedKeys.push(`${div}|${ct}`);
    }
  }
  if (storedKeys.length === 0 && history.length === 0) continue;

  // What the letters justify.
  const fromLetters = new Map();
  for (const r of history) {
    const k = `${String(r.division || '').trim()}|${String(r.coreType || 'CRGO').trim()}`;
    fromLetters.set(k, (fromLetters.get(k) || 0) + (Number(r.quantity) || 0));
  }

  const keys = [...new Set([...storedKeys, ...fromLetters.keys()])].sort();
  const booked = bookedBy.get(at.id) || new Map();

  const rows = keys.map((k) => {
    const [div, ct] = k.split('|');
    const s = Number(stored[div]?.[ct] || 0);
    const l = Number(fromLetters.get(k) || 0);
    const b = Number(booked.get(k) || 0);
    return {
      'division / core': `${div} / ${ct}`,
      stored: s,
      'from letters': l,
      'unexplained': s - l,
      booked: b,
      'letters >= booked?': l >= b ? 'yes' : `NO - letters ${l} < booked ${b}`,
    };
  });

  /**
   * ⚠ CAN THIS TENDER LEAVE `LEGACY_QUOTA_ATS`? (AUDIT G94)
   *
   * The list is a WORK QUEUE, not an exemption, and this is the test that says when an entry
   * is done. Removing an id makes the tender letters-only, and `NewJob` then governs it:
   * a division/core with NO letters hits `allowed === 0` and BLOCKS intake outright (A3),
   * while one with letters below its booked count refuses the next intake.
   *
   * So the condition is exactly `lib/allotments.ts`'s own floor, applied to the whole tender
   * instead of to one correction: for every pair with work booked, the letters must total at
   * least what is booked. Anything less and removing the id turns a correct rule into an
   * outage on a division that already has jobs.
   */
  const blockers = rows.filter((r) => r.booked > 0 && r['from letters'] < r.booked);
  const readyToLeave = blockers.length === 0;

  const excess = rows.reduce((t, r) => t + Math.max(0, r.unexplained), 0);
  const anyDiff = rows.some((r) => r.unexplained !== 0);
  if (!anyDiff) {
    atsMatching++;
    // ⚠ These skipped the verdict entirely in the first version of this block, because the
    //   `continue` came first. A tender whose quota already equals its letters is the
    //   easiest id to take off the list, and it was the one case that never said so.
    if (readyToLeave) {
      readyIds.push({ id: at.id, label: at.name || at.atNumber || at.id });
    }
    continue;
  }

  atsWithExcess++;
  totalExcess += excess;

  const agency = agencies.get(at.agencyId);
  console.log(`\n${at.name || at.atNumber || '(unnamed)'}   [${at.status || '?'}]   agency: ${agency?.name || at.agencyId}`);
  console.log(`   id: ${at.id}   letters recorded: ${history.length}   unexplained units: ${excess}`);
  console.table(rows);

  // Is the agency map the likely source of the unexplained figure?
  const agencyAllot = agency?.allotments || {};
  const matchesAgency = rows.filter((r) => {
    const [div, ct] = r['division / core'].split(' / ');
    return Number(agencyAllot[div]?.[ct] || 0) === r.stored && r.unexplained !== 0;
  });
  if (matchesAgency.length > 0) {
    console.log(`   ⚠ ${matchesAgency.length} row(s) EQUAL the agency's own allotments map - consistent with inheritance, not with a letter.`);
  }

  if (readyToLeave) {
    readyIds.push({ id: at.id, label: at.name || at.atNumber || at.id });
    console.log(`   ✓ READY TO LEAVE LEGACY_QUOTA_ATS - every booked pair is covered by its letters.`);
    console.log(`     Delete '${at.id}' from LEGACY_QUOTA_ATS in src/lib/allotmentInheritance.ts.`);
  } else {
    console.log(`   ✗ NOT ready to leave - ${blockers.length} pair(s) have work booked that the letters do not cover:`);
    for (const b of blockers) {
      console.log(`       ${b['division / core']}: ${b['from letters']} letter(s) vs ${b.booked} booked`
        + ` - enter the missing letter, or the next intake on it would be refused.`);
    }
  }
}

console.log('\n' + '-'.repeat(90));
console.log(`ATs whose quota matches their letters exactly : ${atsMatching}`);
console.log(`ATs with a quota their letters do not explain : ${atsWithExcess}`);
console.log(`total unexplained units                       : ${totalExcess}`);

console.log(`\nREADY TO LEAVE LEGACY_QUOTA_ATS: ${readyIds.length}`);
for (const r of readyIds) console.log(`   ${String(r.label).padEnd(24)} ${r.id}`);
if (readyIds.length > 0) {
  console.log('\nDelete those ids from LEGACY_QUOTA_ATS in src/lib/allotmentInheritance.ts.');
  console.log('The list may only shrink - allotmentInheritance.test.ts fails if it grows.');
}
console.log('\n⚠ Unexplained does NOT mean wrong - a letter may exist on paper and not in the app.');
console.log('⚠ "letters >= booked" is the floor test: a quota rebuilt from letters alone must not');
console.log('  fall below what is already booked, or committed work would sit outside its quota.');
