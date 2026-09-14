// WHAT AN INSPECTIONS READ COSTS, OWNER-SCOPED vs AGENCY-SCOPED — READ-ONLY.
//
//     node scripts/admin/inspection-read-cost.js
//
// Every screen reads `inspections` by ownerId today - never by agency - because 59 of 144 records
// carried no agencyId. Once the backfill has run, the shared loader can scope them to the active
// agency. This measures what that is worth.
//
// ⚠ IT MEASURES BYTES, NOT JUST ROWS. This database is Enterprise edition, which bills reads by
// BYTES in 4 KiB read units rather than one unit per document. A count of rows understates or
// overstates the saving depending on how big the rows are, and inspection rows carry a `data`
// blob. So both are reported, and the read units are what the bill actually follows.
//
// Nothing is written.

import { all, banner } from './_db.js';

banner('INSPECTIONS — OWNER-SCOPED vs AGENCY-SCOPED');

const [agencies, inspections] = await Promise.all([all('agencies'), all('inspections')]);

const KIB = 1024;
const UNIT = 4 * KIB; // Enterprise read unit
const has = v => String(v ?? '').trim() !== '';
const bytesOf = r => Buffer.byteLength(JSON.stringify(r), 'utf8');
const units = b => Math.max(1, Math.ceil(b / UNIT));

const stillMissing = inspections.filter(i => !has(i.agencyId));
console.log(`${inspections.length} inspection(s); ${stillMissing.length} without an agencyId\n`);
if (stillMissing.length > 0) {
  console.log('  ⚠ AGENCY SCOPING IS NOT SAFE YET — these would vanish from every screen.');
  console.log('     Run backfill-inspection-agency.js first.\n');
}

// ---------------------------------------------------------------- per agency, and per owner

const rows = [];
for (const a of agencies) {
  const mine = inspections.filter(i => i.agencyId === a.id);
  if (mine.length === 0) continue;
  // What a screen reads TODAY when this agency is active: every inspection of its OWNER.
  const ownerScoped = inspections.filter(i => i.ownerId === a.ownerId);
  const agencyBytes = mine.reduce((n, r) => n + bytesOf(r), 0);
  const ownerBytes = ownerScoped.reduce((n, r) => n + bytesOf(r), 0);
  rows.push({
    agency: String(a.name || a.id).slice(0, 28),
    ownerRows: ownerScoped.length,
    agencyRows: mine.length,
    rowsSaved: ownerScoped.length - mine.length,
    ownerKiB: +(ownerBytes / KIB).toFixed(1),
    agencyKiB: +(agencyBytes / KIB).toFixed(1),
    ownerUnits: units(ownerBytes),
    agencyUnits: units(agencyBytes),
  });
}
rows.sort((x, y) => y.rowsSaved - x.rowsSaved);
console.log('PER ACTIVE AGENCY — what one load reads before and after scoping\n');
console.table(rows);

// ---------------------------------------------------------------- the honest summary

const totalOwnerUnits = rows.reduce((n, r) => n + r.ownerUnits, 0);
const totalAgencyUnits = rows.reduce((n, r) => n + r.agencyUnits, 0);
const totalOwnerRows = rows.reduce((n, r) => n + r.ownerRows, 0);
const totalAgencyRows = rows.reduce((n, r) => n + r.agencyRows, 0);

console.log('=== ONE LOAD PER AGENCY, SUMMED ACROSS EVERY AGENCY THAT HAS INSPECTIONS ===');
console.log(`  rows       ${totalOwnerRows} -> ${totalAgencyRows}   (${totalOwnerRows - totalAgencyRows} fewer)`);
console.log(`  read units ${totalOwnerUnits} -> ${totalAgencyUnits}   (${totalOwnerUnits - totalAgencyUnits} fewer)`);
console.log('');
console.log('  ⚠ THIS IS THE SAVING PER LOAD, NOT PER DAY. It is multiplied by how often the');
console.log('     agency is switched or the app reloaded - and, before Half B, by how many');
console.log('     SCREENS each did their own inspections read. Nine did.');

const multi = agencies.filter(a => agencies.filter(b => b.ownerId === a.ownerId).length > 1);
console.log('');
console.log(`  The saving is zero for an owner with ONE agency: owner-scoped and agency-scoped`);
console.log(`  are the same set. ${new Set(multi.map(a => a.ownerId)).size} of ${new Set(agencies.map(a => a.ownerId)).size} owner(s) have more than one agency,`);
console.log('  so most accounts save nothing here and the change is about correctness of scope');
console.log('  as much as cost.');

console.log('\nDone. Nothing was written.');
