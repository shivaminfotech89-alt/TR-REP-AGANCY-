/**
 * PER-AT JOB NUMBER CENSUS, AND THE CROSS-TENDER COLLISION PICTURE.
 *
 * READ-ONLY. Nothing here writes.
 *
 *     node scripts/admin/at-job-number-census.mjs
 *
 * Two questions, one pass over the same data:
 *
 *   1. CENSUS. For each AT: its stored `lastJobNumbers`, and the highest job number
 *      ACTUALLY booked under it, per counter key. The two disagree in both directions and
 *      the difference is the point - `lastJobNumbers` is a CACHE of a fact that lives in
 *      the jobs collection (AgencyContext :2044).
 *
 *   2. COLLISION CHECK. If a new AT started its own series at 1 instead of inheriting
 *      (reversing F42), which job numbers would it have REISSUED? That is only a collision
 *      when the PREFIX is also the same, because the prefix is what appears on the challan.
 *      So ranges are grouped by (agency, resolved prefix, counter key), not by key alone.
 *
 * ⚠ THE APP'S OWN RULES ARE REPRODUCED HERE EXACTLY, NOT RE-READ. A census that groups keys
 * differently from the app produces a picture that looks authoritative and describes nothing.
 *   - getCounterKey  - AgencyContext.tsx:557-586, all five branches including the OVERHAUL
 *                      long form (G43) and the LSTC/SDT/PLMT/PAT branch (G43).
 *   - jobNoSequence  - AgencyContext.tsx:730-736, digits after the LAST dash.
 *   - exclusions     - addAtMaster:2084 - GP and Cancelled jobs never advance a counter.
 * If any of those change in src, this script is wrong and must be changed with them.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const cfg = JSON.parse(readFileSync('firebase-applet-config.json', 'utf8'));
const key = JSON.parse(readFileSync('.secrets/serviceAccountKey.json', 'utf8'));
const app = initializeApp({ credential: cert(key) });
const db = getFirestore(app, cfg.firestoreDatabaseId);

/** AgencyContext.tsx:557-586, verbatim in behaviour. */
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

/** AgencyContext.tsx:730-736, verbatim in behaviour. */
function jobNoSequence(jobNo) {
  const raw = String(jobNo ?? '').trim();
  if (!raw) return null;
  const dash = raw.lastIndexOf('-');
  const n = parseInt(dash >= 0 ? raw.slice(dash + 1) : raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** addAtMaster:2084 - the jobs that never advance a counter. */
function skipForCounters(j) {
  return (j.repairType || '').toUpperCase() === 'GP'
    || j.isGp
    || j.status === 'Cancelled'
    || j.isCancelled
    || j.mrStatus === 'Cancelled';
}

/** The prefix actually printed, resolved the way the AT stores it. */
function prefixFor(at, division, coreType) {
  const entry = (at.prefixes || {})[String(division || '').trim()];
  if (!entry) return null;
  if (typeof entry === 'string') return entry.trim() || null;
  const type = (coreType || 'CRGO').trim().toUpperCase();
  const pick = entry[type] ?? entry.CRGO ?? Object.values(entry)[0];
  return String(pick || '').trim() || null;
}

const fmtDate = (v) => (v ? new Date(Number(v)).toISOString().slice(0, 10) : '(none)');

console.log(`\nproject ${cfg.projectId}   READ-ONLY\n`);

const [atSnap, jobSnap, agencySnap] = await Promise.all([
  db.collection('atMasters').get(),
  db.collection('jobs').get(),
  db.collection('agencies').get(),
]);

const ats = atSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const jobs = jobSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const agencyName = new Map(agencySnap.docs.map((d) => [d.id, d.data().name || d.id]));

console.log(`${ats.length} AT(s), ${jobs.length} job(s), ${agencySnap.size} agenc(ies)\n`);

// ---------------------------------------------------------------- 1. THE CENSUS
const byAt = new Map();          // atId -> key -> {min,max,count,prefixes:Set}
const noAt = { count: 0, keys: new Map() };

for (const j of jobs) {
  if (skipForCounters(j)) continue;
  const n = jobNoSequence(j.jobNo);
  if (n === null) continue;
  const division = String(j.division ?? '').trim();
  if (!division) continue;
  const k = getCounterKey(division, j.coreType || 'CRGO');
  const atId = String(j.atId ?? '').trim();

  if (!atId) {
    noAt.count++;
    const cur = noAt.keys.get(k) || { min: n, max: n, count: 0 };
    cur.min = Math.min(cur.min, n); cur.max = Math.max(cur.max, n); cur.count++;
    noAt.keys.set(k, cur);
    continue;
  }
  if (!byAt.has(atId)) byAt.set(atId, new Map());
  const keys = byAt.get(atId);
  const cur = keys.get(k) || { min: n, max: n, count: 0, division, coreTypes: new Set() };
  cur.min = Math.min(cur.min, n);
  cur.max = Math.max(cur.max, n);
  cur.count++;
  cur.coreTypes.add(String(j.coreType || 'CRGO'));
  keys.set(k, cur);
}

const ordered = [...ats].sort((a, b) => Number(a.startDate || 0) - Number(b.startDate || 0));

console.log('='.repeat(100));
console.log('1. CENSUS - stored counter vs highest number ACTUALLY booked');
console.log('='.repeat(100));

for (const at of ordered) {
  const keys = byAt.get(at.id) || new Map();
  const stored = at.lastJobNumbers || {};
  const allKeys = [...new Set([...Object.keys(stored), ...keys.keys()])].sort();

  console.log(`\n${at.name || '(unnamed)'}   [${at.status || '?'}]   ${fmtDate(at.startDate)} -> ${fmtDate(at.endDate)}`);
  console.log(`   agency: ${agencyName.get(at.agencyId) || at.agencyId}    id: ${at.id}`);
  if (allKeys.length === 0) { console.log('   (no counters, no jobs)'); continue; }

  const rows = allKeys.map((k) => {
    const actual = keys.get(k);
    const seed = (at.startingJobNumbers || {})[k];
    return {
      key: k,
      stored: stored[k] === undefined ? '-' : Number(stored[k]),
      booked: actual ? `${actual.min}..${actual.max}` : '-',
      jobs: actual ? actual.count : 0,
      'starts at 1?': actual ? (actual.min === 1 ? 'YES' : 'no') : '-',
      seeded: seed === undefined ? '-' : Number(seed),
    };
  });
  console.table(rows);
}

if (noAt.count > 0) {
  console.log(`\n⚠ ${noAt.count} job(s) carry NO atId - they belong to no tender and advance no counter (A3).`);
  console.table([...noAt.keys.entries()].map(([k, v]) => ({ key: k, booked: `${v.min}..${v.max}`, jobs: v.count })));
}

// ------------------------------------------------- 2. THE COLLISION CHECK
console.log('\n' + '='.repeat(100));
console.log('2. COLLISION CHECK - would a per-AT restart at 1 reissue a number already on a challan?');
console.log('   Grouped by (agency, PRINTED PREFIX, counter key). A different prefix is a different series.');
console.log('='.repeat(100));

const series = new Map();   // `${agencyId}|${prefix}|${key}` -> [{at, min, max, count}]
for (const at of ordered) {
  const keys = byAt.get(at.id);
  if (!keys) continue;
  for (const [k, v] of keys) {
    const prefix = prefixFor(at, v.division, [...v.coreTypes][0]) || '(no prefix configured)';
    const id = `${at.agencyId}|${prefix}|${k}`;
    if (!series.has(id)) series.set(id, []);
    series.get(id).push({ at, ...v, prefix });
  }
}

let overlaps = 0;
let shared = 0;
for (const [id, entries] of [...series.entries()].sort()) {
  if (entries.length < 2) continue;
  shared++;
  const [agencyId, prefix, k] = id.split('|');
  entries.sort((a, b) => Number(a.at.startDate || 0) - Number(b.at.startDate || 0));

  // Existing overlap: two ATs in one series already using the same number.
  const clashPairs = [];
  for (let i = 0; i < entries.length; i++) {
    for (let x = i + 1; x < entries.length; x++) {
      if (entries[i].min <= entries[x].max && entries[x].min <= entries[i].max) {
        clashPairs.push([entries[i], entries[x]]);
      }
    }
  }
  // Would-be overlap if each AT had started at 1 instead of continuing.
  const firstMax = entries[0].max;
  const wouldReissue = entries.slice(1).filter((e) => e.min > 1);

  console.log(`\n${agencyName.get(agencyId) || agencyId}   prefix "${prefix}"   key ${k}   - ${entries.length} tenders`);
  console.table(entries.map((e) => ({
    tender: e.at.name || e.at.id,
    start: fmtDate(e.at.startDate),
    booked: `${e.min}..${e.max}`,
    jobs: e.count,
    'continues?': e.min > 1 ? 'YES - starts above 1' : 'no - starts at 1',
  })));

  if (clashPairs.length > 0) {
    overlaps++;
    console.log(`   ⚠ ALREADY OVERLAPPING - ${clashPairs.length} pair(s) of tenders share numbers in this series TODAY.`);
    for (const [a, b] of clashPairs) {
      console.log(`      ${a.at.name || a.at.id} (${a.min}..${a.max})  vs  ${b.at.name || b.at.id} (${b.min}..${b.max})`);
    }
  }
  if (wouldReissue.length > 0) {
    console.log(`   ⚠ IF EACH TENDER RESTARTED AT 1, these would reissue numbers already printed under "${prefix}":`);
    for (const e of wouldReissue) {
      const upTo = Math.min(e.count, firstMax);
      console.log(`      ${e.at.name || e.at.id}: would issue 1..${e.count}, colliding with the first tender's 1..${firstMax} for ${upTo} number(s)`);
    }
  }
}

console.log('\n' + '-'.repeat(100));
console.log(`series shared by more than one tender : ${shared}`);
console.log(`series ALREADY overlapping today      : ${overlaps}`);
console.log('\n⚠ "Already overlapping" means duplicate job numbers exist NOW under one prefix.');
console.log('⚠ "Would reissue" is the cost of reversing F42: those numbers are on issued challans.');
console.log('⚠ Ranges are min..max and may be sparse - a gap is not proof a number is free.');
