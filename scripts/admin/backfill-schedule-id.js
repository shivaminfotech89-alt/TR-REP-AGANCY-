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
// the app*. The stamp records what these tenders are charging right now.
//
// ⚠ CORRECTED 2026-09-11 (AUDIT O59). This said the stamp was "verifiable: they all predate
// AT 1819 (07.09.2026)". What could be verified was only that these ATs were CHARGING 2020
// rates, because the app had no other schedule. Which schedule each was AWARDED under was
// inferred from its name and dates, and nothing has confirmed it against an A/T letter.
// The stamp also left no trace on the records: `scheduleSource` is empty on every AT it wrote.
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
/** A/T 1819 IS the 2026-28 tender, so it is stamped 2026 - see IS_2026_TENDER. */
const SCHEDULE_ID_2026 = 'UGVCL-2026';

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
 * It is now stamped UGVCL-2026, which is only correct because that schedule has since been
 * transcribed. Until it was, this AT was HELD BACK rather than guessed at - a blanket
 * backfill is only safe where the value is the same for every row, and here it never was.
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
console.log(`  to stamp ${SCHEDULE_ID_2026}     : ${held.length}   (A/T 1819 itself)`);
console.log(`  to stamp ${SCHEDULE_ID}     : ${missing.length}\n`);

already.forEach(a => console.log(`    (skip) ${String(a.atNumber || a.id).padEnd(44)} scheduleId=${a.scheduleId}`));
if (already.length) console.log('');

held.forEach(a => {
  console.log(`    ${MODE === 'apply' ? 'STAMP' : 'would stamp'}  ${String(a.atNumber || a.id).padEnd(44)} -> ${SCHEDULE_ID_2026}   (this IS A/T 1819)`);
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
  let n26 = 0;
  for (const a of held) {
    await db.collection('atMasters').doc(a.id).update({ scheduleId: SCHEDULE_ID_2026 });
    n26++;
  }
  console.log(`\n  Stamped ${n} AT(s) ${SCHEDULE_ID} and ${n26} ${SCHEDULE_ID_2026}.`);
}
