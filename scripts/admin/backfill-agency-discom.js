// STAMP EACH AGENCY WITH ITS ELECTRICITY BOARD — WRITES WHEN MODE = 'apply'.
//
//     node scripts/admin/backfill-agency-discom.js
//
// ⚠ THIS SCRIPT WRITES. It ships as 'dry-run'; set MODE to 'apply' to run it for real, and set it
// back to 'dry-run' before committing.
//
// WHY
// ---
// `discomName` is FREE TEXT and is already inconsistent: eight agencies hold
// "Uttar Gujarat Vij Company Ltd." and one holds "UTTAR GUJARAT VIJ CO LTD." - the same board,
// two spellings, which a string filter reads as two boards. Four hold "" and four have no field
// at all. A tender filter keyed on that string would show an empty list to half the customers.
//
// So a CODE is written alongside it: `discomCode`, one of a fixed list. The printed name stays in
// `discomName`, because that is the legal name on a tax invoice and a forwarding letter
// (BillingSystem, EditAgencyForm) - one field cannot be both a printed name and a match key.
//
// ⚠ IT DERIVES ONLY FROM `discomName`, NEVER FROM A DIVISION PREFIX.
//
// Four of the unset agencies carry a prefix - DEESA on BANAS, SABARMATI on three others - and it
// is tempting to read those as a board. They are the agency's own job-numbering configuration;
// nothing in this app ties a division name to a board. SABARMATI is the sharp case: a UGVCL
// division, and also Ahmedabad, which is Torrent Power territory. Guessing UGVCL there could put
// an agency on a board it has never tendered with, and the app would then hide the tenders it
// actually needs. An agency with no code sees "set your electricity board in Agency Settings",
// which is honest and one click to fix.
//
// WHAT IT WRITES: `discomCode` only. `discomName` is left exactly as it is, including the variant
// spelling - correcting the printed legal name is a separate decision about what appears on a
// document, not a filter concern.

import { db, all } from './_db.js';

const MODE = 'dry-run'; // 'dry-run' | 'apply'

/** The fixed list. Must stay in step with src/lib/discoms.ts. */
const CODES = ['UGVCL', 'MGVCL', 'PGVCL', 'DGVCL', 'GETCO'];

/** Match on letters only, so case and punctuation cannot make one board into two. */
const norm = v => String(v ?? '').toUpperCase().replace(/[^A-Z]/g, '');

function codeFor(discomName) {
  const n = norm(discomName);
  if (!n) return null;
  if (/UTTARGUJARAT/.test(n) || /^UGVCL/.test(n)) return 'UGVCL';
  if (/MADHYAGUJARAT/.test(n) || /^MGVCL/.test(n)) return 'MGVCL';
  if (/PASCHIMGUJARAT/.test(n) || /^PGVCL/.test(n)) return 'PGVCL';
  if (/DAKSHINGUJARAT/.test(n) || /^DGVCL/.test(n)) return 'DGVCL';
  if (/GUJARATENERGYTRANSMISSION/.test(n) || /^GETCO/.test(n)) return 'GETCO';
  return null;
}

console.log('\nBACKFILL agencyCode ON AGENCIES');
console.log(`MODE = ${MODE}${MODE === 'apply' ? '  ⚠ THIS RUN WRITES' : '  (nothing will be written)'}\n`);

const agencies = await all('agencies');

const planned = [];
const leftUnset = [];
const already = [];

for (const a of agencies) {
  const existing = String(a.discomCode ?? '').trim();
  const derived = codeFor(a.discomName);
  if (existing) {
    already.push({ a, existing });
  } else if (derived) {
    planned.push({ id: a.id, name: a.name, from: a.discomName, code: derived });
  } else {
    leftUnset.push(a);
  }
}

console.log(`${agencies.length} agency/agencies\n`);

if (already.length > 0) {
  console.log(`ALREADY CODED — untouched (${already.length}):`);
  for (const { a, existing } of already) console.log(`  ${String(a.name).padEnd(32)} ${existing}`);
  console.log('');
}

console.log(`WOULD WRITE (${planned.length}):`);
for (const p of planned) {
  console.log(`  ${String(p.name).slice(0, 32).padEnd(32)} discomCode=${p.code.padEnd(6)} from ${JSON.stringify(p.from)}`);
}

console.log(`\n⚠ LEFT UNSET — nothing on the record names a board (${leftUnset.length}):`);
for (const a of leftUnset) {
  const prefixes = Object.keys(a.prefixes ?? {});
  const hint = prefixes.length ? `prefix ${prefixes.join(', ')}` : 'no prefix';
  console.log(`  ${String(a.name).slice(0, 32).padEnd(32)} discomName=${a.discomName === undefined ? '(absent)' : JSON.stringify(a.discomName)}  (${hint})`);
}
console.log('  These see "set your electricity board in Agency Settings" and choose it themselves.');
console.log('  A division prefix is NOT read as a board - see the note at the top of this file.');

const bad = planned.filter(p => !CODES.includes(p.code));
if (bad.length > 0) {
  console.log(`\nREFUSING: ${bad.length} derived code(s) are not in the fixed list.`);
  process.exit(1);
}

if (MODE !== 'apply') {
  console.log('\nDRY RUN — nothing was written. Set MODE = \'apply\' to write, then set it back.\n');
  process.exit(0);
}

const CHUNK = 200;
let written = 0;
for (let i = 0; i < planned.length; i += CHUNK) {
  const slice = planned.slice(i, i + CHUNK);
  const batch = db.batch();
  for (const p of slice) batch.update(db.collection('agencies').doc(p.id), { discomCode: p.code });
  await batch.commit();
  written += slice.length;
  console.log(`  committed ${written}/${planned.length}`);
}

const after = await all('agencies');
console.log('\nREAD BACK FROM THE DATABASE:');
const coded = after.filter(a => String(a.discomCode ?? '').trim());
console.log(`  agencies with a discomCode : ${coded.length}/${after.length}`);
const wrong = planned.filter(p => String(after.find(a => a.id === p.id)?.discomCode ?? '') !== p.code);
if (wrong.length === 0) {
  console.log('\n  Every intended agency carries its code. Confirmed from the database, not from');
  console.log("  this script's intention.\n");
} else {
  console.log(`\n  ⚠ ${wrong.length} did not take the intended value. Do not rely on the filter yet.\n`);
  process.exit(3);
}
