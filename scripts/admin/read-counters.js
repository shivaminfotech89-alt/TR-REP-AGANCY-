// JOB-NUMBER COUNTERS, AS THEY STAND RIGHT NOW
//
// READ-ONLY.   node scripts/admin/read-counters.js
//
// THE COUNTER CHECK
// -----------------
// The reservation work (AUDIT F60, F67) has never executed. It typechecks; that says the
// shapes are right and nothing about the logic. The one thing that will say whether a row
// draws ONE number or two is watching the counter across a single deliberate action:
//
//   1. node scripts/admin/read-counters.js          <- before
//   2. In the app: open New Job and type a serial number into the first row
//   3. node scripts/admin/read-counters.js          <- after
//
// EXPECTED: exactly one key advances, by exactly 1.
//
//   advanced by 2   a reservation fired twice - the in-flight guard is not holding
//   advanced by 0   the trigger did not fire at all
//   two keys moved  the CRGO bare/_CRGO pair both moved, which is correct for CRGO
//                   (reserveJobNos writes both deliberately) - check they moved together
//
// And the form-open test, which is what F67 was for:
//
//   1. read      2. open New Job and navigate away WITHOUT typing      3. read
//   EXPECTED: nothing moves. A number burned here would be one drawn before the operator
//   could possibly have marked a transformer, which is what makes no-reclaim defensible.
//
// Pass --save to write a snapshot, then --diff to compare against it:
//
//   node scripts/admin/read-counters.js --save
//   …do the thing…
//   node scripts/admin/read-counters.js --diff

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { all, banner } from './_db.js';

const SNAP = '.secrets/counter-snapshot.json';
const mode = process.argv.includes('--save') ? 'save'
           : process.argv.includes('--diff') ? 'diff' : 'show';

banner('JOB-NUMBER COUNTERS');

const [agencies, ats] = await Promise.all([all('agencies'), all('atMasters')]);
const agName = id => agencies.find(a => a.id === id)?.name || id || '(none)';

// One flat map of every counter in the project: which document owns it, and its value.
const current = {};
ats.forEach(a => {
  Object.entries(a.lastJobNumbers || {}).forEach(([key, val]) => {
    current[`AT ${a.atNumber || a.name || a.id} [${agName(a.agencyId)}] · ${key}`] = Number(val) || 0;
  });
});
agencies.forEach(a => {
  Object.entries(a.lastJobNumbers || {}).forEach(([key, val]) => {
    current[`AGENCY ${a.name || a.id} · ${key}`] = Number(val) || 0;
  });
});

if (mode === 'save') {
  if (!existsSync('.secrets')) mkdirSync('.secrets', { recursive: true });
  writeFileSync(SNAP, JSON.stringify({ at: Date.now(), counters: current }, null, 2));
  console.log(`Snapshot saved: ${Object.keys(current).length} counters -> ${SNAP}`);
  console.log('Now do the action in the app, then run with --diff.');
} else if (mode === 'diff') {
  if (!existsSync(SNAP)) { console.error(`No snapshot at ${SNAP}. Run with --save first.`); process.exit(1); }
  const before = JSON.parse(readFileSync(SNAP, 'utf8'));
  const keys = [...new Set([...Object.keys(before.counters), ...Object.keys(current)])].sort();
  const moved = [];
  keys.forEach(k => {
    const b = before.counters[k] ?? 0, a = current[k] ?? 0;
    if (a !== b) moved.push({ counter: k, before: b, after: a, delta: a - b });
  });

  console.log(`Snapshot taken ${new Date(before.at).toLocaleString('en-IN')}\n`);
  if (moved.length === 0) {
    console.log('  NOTHING MOVED.');
    console.log('  Correct for the form-open test. If you typed a serial, the trigger did not fire.');
  } else {
    console.table(moved);
    const byDelta = moved.reduce((m, r) => { (m[r.delta] ||= []).push(r.counter); return m; }, {});
    console.log('\n  ' + Object.entries(byDelta)
      .map(([d, list]) => `${list.length} counter(s) moved by ${d}`).join(', '));
    const bad = moved.filter(r => r.delta !== 1);
    if (bad.length === 0) {
      console.log('  Every counter that moved advanced by exactly 1 - one row, one number.');
    } else {
      console.log('\n  NOT ALL MOVED BY 1. A delta of 2 on one key means a reservation fired');
      console.log('  twice for one row. A CRGO row legitimately moves BOTH `<div>` and');
      console.log('  `<div>_CRGO` by 1 each - two keys, one apiece, not one key by two.');
    }
  }
} else {
  const rows = Object.entries(current).sort(([a], [b]) => a.localeCompare(b))
    .map(([counter, value]) => ({ counter, value }));
  console.table(rows);
  console.log(`\n${rows.length} counters. Use --save / --diff to measure a single action.`);
}

console.log('\nDone. Nothing was written to Firestore.');
