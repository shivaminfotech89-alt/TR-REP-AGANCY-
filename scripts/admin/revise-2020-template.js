// SWAP name AND atNumber ON THE 2020-21 PUBLISHED TEMPLATE — WRITES WHEN MODE = 'apply'.
//
//     node scripts/admin/revise-2020-template.js
//
// ⚠ THIS SCRIPT WRITES. It ships as 'dry-run'; set MODE to 'apply' to run it for real, and set it
// back to 'dry-run' before committing.
//
// WHY
// ---
// The two published templates disagree about what their own fields mean:
//
//   1819 template    name     'UGVCL/2026-28/01/AT/1819'                      <- a reference
//                    atNumber 'UGVCL/EE-T-1/TRANS-REP/2026-28/01/AT/1819'     <- the full reference
//
//   2020 template    name     'UGVCL/EE-T-1/TRANS-REP/2020-21/01/AT/1087'     <- the full reference
//                    atNumber 'UGVCL 2020-21 Schedule'                        <- a description
//
// They are inverted on the 2020 one. The canonical shape is: atNumber holds the full A/T
// reference, name holds a short description. This matters now because the Add AT form is about
// to prefill an AT's atNumber FROM the template's atNumber - and with the fields inverted, an
// agency adopting the 2020 template would be handed "UGVCL 2020-21 Schedule" as its A/T number.
//
// ⚠ WHY THIS IS SAFE TO RUN: the 2020 template has ZERO adopters. No AT carries
// ratesSource 'published:<its id>', so nothing has copied these values and nothing inherits them.
// The script re-checks that before writing and refuses if it has changed.
//
// ⚠ THE VERSION IS NOT BUMPED, DELIBERATELY. A version bump exists to tell adopters their copy is
// behind. Nothing has adopted this template, and no rate changed - only two labels that were
// swapped. Bumping it would announce drift that does not exist.

import { db, all } from './_db.js';

const MODE = 'dry-run'; // 'dry-run' | 'apply'

const EXPECTED_NAME = 'UGVCL/EE-T-1/TRANS-REP/2020-21/01/AT/1087';
const EXPECTED_AT_NUMBER = 'UGVCL 2020-21 Schedule';

console.log('\nREVISE THE 2020-21 TEMPLATE — swap name and atNumber');
console.log(`MODE = ${MODE}${MODE === 'apply' ? '  ⚠ THIS RUN WRITES' : '  (nothing will be written)'}\n`);

const [templates, ats] = await Promise.all([all('published_ats'), all('atMasters')]);

// Located by its CURRENT VALUES, not by a doc id typed from a truncated console listing.
const target = templates.filter(t =>
  String(t.name ?? '').trim() === EXPECTED_NAME
  && String(t.atNumber ?? '').trim() === EXPECTED_AT_NUMBER);

if (target.length === 0) {
  console.log('REFUSING: no template holds the expected inverted values.');
  console.log('  Either this has already been applied, or the template changed. Current templates:\n');
  for (const t of templates) {
    console.log(`  ${t.id}`);
    console.log(`    name     ${JSON.stringify(t.name ?? null)}`);
    console.log(`    atNumber ${JSON.stringify(t.atNumber ?? null)}`);
  }
  process.exit(1);
}
if (target.length > 1) {
  console.log(`REFUSING: ${target.length} templates hold those values. Expected exactly one.`);
  process.exit(1);
}

const tpl = target[0];
const adopters = ats.filter(a => String(a.ratesSource || '') === `published:${tpl.id}`);

console.log(`Template ${tpl.id}`);
console.log(`  name     ${JSON.stringify(tpl.name)}`);
console.log(`  atNumber ${JSON.stringify(tpl.atNumber)}`);
console.log(`  adopters ${adopters.length}\n`);

if (adopters.length > 0) {
  console.log('REFUSING: this template has adopters. Swapping its labels now would leave their');
  console.log('  copies describing themselves differently from the template they came from.');
  for (const a of adopters) console.log(`    ${a.id}  atNumber=${JSON.stringify(a.atNumber ?? null)}`);
  process.exit(1);
}

console.log('AFTER:');
console.log(`  name     ${JSON.stringify(EXPECTED_AT_NUMBER)}`);
console.log(`  atNumber ${JSON.stringify(EXPECTED_NAME)}`);
console.log('\n  Only these two fields change. Rates, scheduleId, version, dates and percentage are untouched.\n');

if (MODE !== 'apply') {
  console.log('DRY RUN — nothing was written. Set MODE = \'apply\' to write, then set it back.\n');
  process.exit(0);
}

await db.collection('published_ats').doc(tpl.id).update({
  name: EXPECTED_AT_NUMBER,
  atNumber: EXPECTED_NAME,
});

const after = (await all('published_ats')).find(t => t.id === tpl.id);
console.log('WRITTEN. Read back:');
console.log(`  name     ${JSON.stringify(after?.name ?? null)}`);
console.log(`  atNumber ${JSON.stringify(after?.atNumber ?? null)}`);
const ok = String(after?.name ?? '') === EXPECTED_AT_NUMBER && String(after?.atNumber ?? '') === EXPECTED_NAME;
console.log(ok ? '\n  Confirmed from the database, not from this script\'s intention.\n'
               : '\n  ⚠ READ-BACK DOES NOT MATCH. Check the template before relying on it.\n');
