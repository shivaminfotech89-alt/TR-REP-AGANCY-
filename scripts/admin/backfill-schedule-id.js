// Stamp `scheduleId: 'UGVCL-2020'` onto every AT that predates the field.
//
// WHY THIS BACKFILL IS CORRECT WHERE F37's WAS NOT.
//
// F37 refused to backfill `issuedByAgencyId` onto reversed jobs, on the rule that a field
// asserting a historical fact must not be populated for records that predate it - an
// inferred value is indistinguishable from a recorded one, and there the fact was genuinely
// unknowable.
//
// This is a different question with a knowable answer. `scheduleId` does not assert what
// someone once decided; it names which schedule an AT prices from, and every AT written
// before this field existed prices from UGVCL-2020 *because that was the only schedule in
// the app*. The stamp records what these tenders are charging right now, and it is
// verifiable: they all predate AT 1819 (07.09.2026), and their estimates today resolve
// through the 2020 tables.
//
// WHAT IT BUYS. Until it runs, an absent `scheduleId` is ambiguous - "created before
// schedules were versioned" and "created after, nobody chose" look identical, and both fall
// through to the 2020 default. After it runs, absent means nobody chose, which is a state
// the AT form no longer produces and which can then be treated as an error.
//
// MODE is 'dry-run'. Set it to 'apply' to write, and set it back before committing.

import { db, all, banner } from './_db.js';

const MODE = 'dry-run';           // 'dry-run' | 'apply'
const SCHEDULE_ID = 'UGVCL-2020';

banner(`BACKFILL scheduleId=${SCHEDULE_ID}  [${MODE}]`);

/**
 * ⚠ ONE AT IN THE DATABASE IS ALREADY THE 2026 TENDER, AND MUST NOT BE STAMPED 2020.
 *
 * ZENITH's `UGVCL/EE-T-1/TRANS-REP/2026-28/01/AT/1819` is A/T 1819 itself - the tender whose
 * Schedule-A reprices 255 of 306 cells. It carries no rates yet and its AT percentage is 7,
 * matching the 7.00%-above on the 2026 paper. Blanket-stamping it UGVCL-2020 would silently
 * price the new tender at the old schedule, which is the exact defect the scheduleId field
 * was added to prevent - introduced by the migration meant to prevent it.
 *
 * It is skipped and reported, not guessed at: it should be set to UGVCL-2026 by hand once
 * that schedule is transcribed, and until then it is correctly unpriceable.
 *
 * Matched on the tender number rather than the agency, because the agency could rename.
 */
const IS_2026_TENDER = (a) => /2026-28\/01\/AT\/1819/i.test(String(a.atNumber ?? ''));

const ats = await all('atMasters');
const already = ats.filter(a => String(a.scheduleId ?? '').trim());
const candidates = ats.filter(a => !String(a.scheduleId ?? '').trim());
const held = candidates.filter(IS_2026_TENDER);
const missing = candidates.filter(a => !IS_2026_TENDER(a));

console.log(`  ATs total                 : ${ats.length}`);
console.log(`  already carry a scheduleId: ${already.length}`);
console.log(`  HELD BACK (2026 tender)   : ${held.length}`);
console.log(`  to stamp ${SCHEDULE_ID}     : ${missing.length}\n`);

already.forEach(a => console.log(`    (skip) ${String(a.atNumber || a.id).padEnd(44)} scheduleId=${a.scheduleId}`));
if (already.length) console.log('');

held.forEach(a => {
  console.log(`    *** HELD  ${String(a.atNumber || a.id).padEnd(44)} this IS A/T 1819 - set it to UGVCL-2026 by hand`);
  console.log(`              once that schedule is transcribed. Stamping 2020 would price the`);
  console.log(`              new tender at the old rates.`);
});
if (held.length) console.log('');

missing.forEach(a => {
  console.log(`    ${MODE === 'apply' ? 'STAMP' : 'would stamp'}  ${String(a.atNumber || a.id).padEnd(44)} -> ${SCHEDULE_ID}`);
});

if (MODE !== 'apply') {
  console.log('\n  DRY RUN - nothing was written. Set MODE = \'apply\' to stamp.');
} else {
  let n = 0;
  for (const a of missing) {
    await db.collection('atMasters').doc(a.id).update({ scheduleId: SCHEDULE_ID });
    n++;
  }
  console.log(`\n  Stamped ${n} AT(s).`);
}
