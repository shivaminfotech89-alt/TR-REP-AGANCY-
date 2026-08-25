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
// EXPECTED, for one row: one number issued.
//
//   an EXISTING key +2      a reservation fired twice - the in-flight guard is not holding
//   nothing moved           the trigger did not fire at all
//   two keys moved          normal for CRGO: reserveJobNos writes `<div>` and `<div>_CRGO`
//                           together, so one allocation shows as two keys
//   a key CREATED           also normal, and not a jump. An AT predating addAtMaster's
//                           seeding fix can be missing its bare `<div>` key; reserveJobNos
//                           reads the MAX of the pair and writes both, so it is created in
//                           step rather than restarting the sequence at 1. The delta looks
//                           large because absent reads as zero - it is not an increment.
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

  // A KEY THAT DID NOT EXIST IS NOT A KEY THAT JUMPED.
  //
  // The first version knew only "delta must be 1". When reserveJobNos CREATED the bare
  // `<div>` key alongside `<div>_CRGO` - which it does deliberately - the diff read absent
  // as 0, reported 0 -> 11 as a jump of eleven, and printed a warning at the exact moment
  // the code was working correctly.
  //
  // Third time in this audit a check has reported confidently outside its own model: an
  // exact-string comparison that could not detect mistyping, a sweep truncated before the
  // judgement, and this. A diagnostic that flags a failure while the code works is worse
  // than no diagnostic - it costs the investigation that follows.
  const bareOf = k => k.replace(/_CRGO$/, '');
  const wasPresent = k => k in before.counters;

  if (moved.length === 0) {
    console.log('  NOTHING MOVED.');
    console.log('  Correct for the form-open test. If you typed a serial, the trigger did not fire.');
  } else {
    console.table(moved.map(r => ({ ...r, note: wasPresent(r.counter) ? '' : 'key created' })));
    console.log('');

    const pairs = moved.filter(r => r.counter.endsWith('_CRGO'))
      .map(r => ({ crgo: r, bare: moved.find(x => x.counter === bareOf(r.counter)) }))
      .filter(p => p.bare);
    const paired = new Set(pairs.flatMap(p => [p.crgo.counter, p.bare.counter]));

    pairs.forEach(({ crgo, bare }) => {
      console.log(`  ${crgo.counter}`);
      console.log(`    ${crgo.delta} number(s) issued  (${crgo.before} -> ${crgo.after})`);
      if (!wasPresent(bare.counter)) {
        console.log(`    bare key CREATED at ${bare.after} - it did not exist on this AT.`);
        console.log('    reserveJobNos writes both and reads the MAX of them, so a missing bare');
        console.log('    key is repaired in step rather than restarting the sequence at 1.');
      } else if (bare.delta !== crgo.delta) {
        console.log(`    bare key moved by ${bare.delta} against ${crgo.delta} issued - THEY DISAGREE.`);
      } else {
        console.log(`    bare key moved with it (${bare.before} -> ${bare.after}) - in step.`);
      }
    });

    moved.filter(r => !paired.has(r.counter)).forEach(r => {
      console.log(`  ${r.counter}`);
      console.log(wasPresent(r.counter)
        ? `    ${r.delta} number(s) issued  (${r.before} -> ${r.after})`
        : `    key CREATED at ${r.after}.`);
    });

    const overrun = moved.filter(r => wasPresent(r.counter) && r.delta > 1);
    console.log('');
    if (overrun.length === 0) {
      console.log('  VERDICT: no existing counter advanced by more than 1. For a single row that');
      console.log('  means one number was issued and the in-flight guard held.');
    } else {
      console.log('  VERDICT: a counter that already existed advanced by more than 1:');
      overrun.forEach(r => console.log(`    ${r.counter}: +${r.delta}`));
      console.log('  If you added ONE row, a reservation fired more than once.');
    }
  }
} else {
  const rows = Object.entries(current).sort(([a], [b]) => a.localeCompare(b))
    .map(([counter, value]) => ({ counter, value }));
  console.table(rows);
  console.log(`\n${rows.length} counters. Use --save / --diff to measure a single action.`);
}

console.log('\nDone. Nothing was written to Firestore.');
