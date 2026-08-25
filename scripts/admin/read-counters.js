// JOB-NUMBER COUNTERS, AS THEY STAND RIGHT NOW
//
// READ-ONLY.   node scripts/admin/read-counters.js
//
// WHAT A COUNTER IS NOW
// ---------------------
// A HIGH-WATER MARK, not an allocator. Nothing in the app draws a job number: the operator
// types what the division put on the MR, and the counter advances at SAVE to the highest
// number actually recorded (AUDIT F70). So the question this script answers has changed.
//
// It used to be "did one keystroke draw exactly one number" - a test of reservation guards
// that no longer exist. It is now simply: what is the app going to SUGGEST next, and did a
// save move the mark.
//
// THE TEST THAT MATTERS
// ---------------------
//   1. node scripts/admin/read-counters.js --save
//   2. In the app: open New Job, type into it, flip core type and division as much as you
//      like, then NAVIGATE AWAY WITHOUT SAVING
//   3. node scripts/admin/read-counters.js --diff
//
//   EXPECTED: NOTHING MOVED. Not one number, however much was typed or flipped. An intake
//   that is abandoned costs the allotment nothing - that is the whole point of F70, and
//   this is the check that proves it.
//
// And the save side:
//
//   1. read      2. save an MR with job numbers      3. read
//   EXPECTED: each counter touched lands on the HIGHEST number in what was saved. Not
//   "+1 per row" - a save of SU-40, SU-41, SU-42 puts DEESA_CRGO at 42 whatever it held
//   before, and a save of numbers BELOW the mark moves nothing, because it only advances.
//   Two keys moving is normal for CRGO: `<div>` and `<div>_CRGO` are written together.
//
// A key CREATED is also normal and is not a jump - absent reads as zero, so a bare `<div>`
// key appearing at 42 is one write, not forty-two.

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
  // The first version knew only "delta must be 1" - a rule taken from the allocator, which
  // is gone. It read an absent bare `<div>` key as 0, reported 0 -> 11 as a jump of eleven,
  // and warned at the exact moment the code was working correctly.
  //
  // Under the high-water model there is NO expected delta at all: a save of five rows
  // numbered 40-44 moves the counter by however far it was behind 44. So this no longer
  // judges the size of a move. It reports what moved and leaves the reading to whoever ran
  // it - which is the honest output for a mark that tracks data rather than issuing it.
  const bareOf = k => k.replace(/_CRGO$/, '');
  const wasPresent = k => k in before.counters;

  if (moved.length === 0) {
    console.log('  NOTHING MOVED.');
    console.log('  Correct for ANY amount of unsaved intake - typing, flipping core type or');
    console.log('  division, adding and removing rows. Only a save moves a counter (F70).');
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
        console.log('    the save writes both and the prediction reads the MAX of them, so a');
        console.log('    missing bare key is repaired in step, not restarted at 1.');
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

    console.log('');
    console.log('  These are HIGH-WATER MARKS. A counter now sits at the highest job number');
    console.log('  recorded against it, so the size of a move says how far behind the mark');
    console.log('  was - not how many numbers were issued. If you saved an MR, each counter');
    console.log('  above should equal the largest number on that MR.');
    console.log('');
    console.log('  ⚠ IF YOU DID NOT SAVE, nothing should have moved at all. A move without a');
    console.log('  save means something is writing lastJobNumbers outside the save path.');
  }
} else {
  const rows = Object.entries(current).sort(([a], [b]) => a.localeCompare(b))
    .map(([counter, value]) => ({ counter, value }));
  console.table(rows);
  console.log(`\n${rows.length} counters. Use --save / --diff to measure a single action.`);
}

console.log('\nDone. Nothing was written to Firestore.');
