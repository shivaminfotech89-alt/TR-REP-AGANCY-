// DO THE TWO JOB-NUMBER PARSERS AGREE? — READ-ONLY.
//
//   node scripts/admin/seed-parser-equivalence.js
//
// The AT seeder had its own parser - a trailing digit run - separate from the one every
// screen uses to read a job number back off the field. Unifying them (AUDIT F81) can only
// be safe if they produce identical counters on the data that exists.
//
// Run BEFORE and AFTER the change. Every counter must be identical in both runs; a single
// difference is the change doing something unintended, not an improvement.

import { all, banner } from './_db.js';

banner('SEED PARSER EQUIVALENCE — old vs new');

const [agencies, ats, jobs] = await Promise.all([all('agencies'), all('atMasters'), all('jobs')]);

const getCounterKey = (division, coreType) => {
  const div = String(division || '').trim();
  const t = String(coreType || 'CRGO').trim().toUpperCase();
  if (t === 'OH') return `${div}_OH`;
  if (t.includes('AMORPHOUS') || t.includes('AM')) return `${div}_AMORPHOUS`;
  if (t.includes('WOUND') || t.includes('WC')) return `${div}_WOUND_CORE`;
  return `${div}_CRGO`;
};

// OLD: the seeder's own regex - digits at the very end of the string.
const oldTail = raw => { const m = String(raw ?? '').trim().match(/(\d+)\s*$/); return m ? Number(m[1]) : null; };

// NEW: jobNoSequence - after the last dash if there is one, else the whole string.
// Mirrors src/lib/AgencyContext.tsx exactly. Keep the two in step or this check is worthless.
const newTail = raw => {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  const dash = t.lastIndexOf('-');
  const n = parseInt(dash >= 0 ? t.slice(dash + 1) : t, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const seedable = j => !(
  String(j.repairType || '').toUpperCase() === 'GP' || j.isGp ||
  j.status === 'Cancelled' || j.isCancelled || j.mrStatus === 'Cancelled'
);

/** What the seeder would produce for a NEW AT of this agency, with the given parser. */
const seedFor = (agencyId, tail) => {
  const counters = {};
  const bump = (k, v) => { if (k && Number.isFinite(v) && v > 0 && (!counters[k] || v > counters[k])) counters[k] = v; };

  ats.filter(a => a.agencyId === agencyId)
     .forEach(a => Object.entries(a.lastJobNumbers || {}).forEach(([k, v]) => bump(k, Number(v))));
  const ag = agencies.find(a => a.id === agencyId);
  Object.entries(ag?.lastJobNumbers || {}).forEach(([k, v]) => bump(k, Number(v)));

  jobs.filter(j => j.agencyId === agencyId && seedable(j)).forEach(j => {
    const division = String(j.division ?? '').trim();
    if (!division) return;
    const key = getCounterKey(division, j.coreType || 'CRGO');
    const n = tail(j.jobNo);
    if (n === null) return;
    bump(key, n);
    if (key.endsWith('_CRGO')) bump(division, n);
  });
  return counters;
};

let differing = 0;
const rows = [];
for (const ag of agencies) {
  const a = seedFor(ag.id, oldTail);
  const b = seedFor(ag.id, newTail);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys) {
    if (a[k] !== b[k]) { differing++; rows.push({ agency: ag.name, counterKey: k, oldParser: a[k] ?? '-', newParser: b[k] ?? '-' }); }
  }
}

// Where the parsers disagree on an INDIVIDUAL number, whether or not it moves a counter.
const perJob = jobs.filter(j => {
  const raw = String(j.jobNo ?? '').trim();
  if (!raw) return false;
  return oldTail(raw) !== newTail(raw);
});

console.log(`${jobs.length} job(s), ${agencies.length} agency(ies)\n`);
console.log('=== 1. COUNTERS A NEW AT WOULD BE SEEDED WITH ===');
console.log(differing === 0
  ? '  IDENTICAL under both parsers, for every agency and every counter key.'
  : `  ⚠ ${differing} counter(s) differ:`);
if (differing) console.table(rows);

console.log('\n=== 2. INDIVIDUAL JOB NUMBERS THE TWO PARSERS READ DIFFERENTLY ===');
if (perJob.length === 0) {
  console.log('  NONE. Every stored job number reads the same either way.');
} else {
  console.table(perJob.slice(0, 25).map(j => ({
    agency: agencies.find(a => a.id === j.agencyId)?.name, jobNo: j.jobNo,
    oldParser: oldTail(j.jobNo) ?? 'UNREADABLE', newParser: newTail(j.jobNo) ?? 'UNREADABLE',
  })));
  if (perJob.length > 25) console.log(`  … and ${perJob.length - 25} more`);
  console.log('\n  These do not necessarily move a counter - section 1 is what decides that.');
}

console.log('\nDone. Nothing was written.');
