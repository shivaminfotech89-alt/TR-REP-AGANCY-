// COPY EACH AGENCY'S ESTIMATE MASTER ONTO ITS ATs
//
//   node scripts/admin/migrate-master-to-at.js            <- DRY RUN, writes nothing
//   node scripts/admin/migrate-master-to-at.js --apply    <- writes, after MODE is changed
//
// ⚠ MODE MUST BE 'dry-run' IN THE REPOSITORY. Change it to run, change it back before
// committing. Security rules do NOT apply to the Admin SDK - see _db.js.
//
// WHAT THIS IS FOR
// ----------------
// Rates have moved from the agency onto the AT (AUDIT F73). A tender is negotiated with its
// own schedule, so holding one set of rates per agency meant re-pricing an old job after a
// rollover produced the NEW tender's figures for work done under the OLD one.
//
// Every existing AT therefore needs the rates its agency was using while that AT was live,
// which is the agency's current sections - there is no other record of them.
//
// WHY IT IS SAFE TO COPY THE SAME SECTIONS ONTO EVERY AT OF AN AGENCY
// -------------------------------------------------------------------
// It is not safe in general, and this script does not pretend otherwise. Copying one master
// onto two ATs ASSERTS the two tenders had identical rates, which is exactly the assumption
// the move exists to break. It is being done here because the data is test data and the
// operator has said so explicitly. On real data this needs deciding per AT.
//
// The pairs where that assertion is being made are listed under "SHARED SOURCE" below.
//
// WHAT IT DOES NOT DO
// -------------------
//   - does not delete or alter the agency's sections. They stay as the fallback rung and as
//     the recovery path if a copy turns out wrong.
//   - does not touch an AT that already holds rates. Re-running cannot overwrite.
//   - does not touch public_config, jobs, or anything outside atMasters.
//   - does not invent rates for an agency that has none.

import { all, banner, db } from './_db.js';

const MODE = 'dry-run';   // 'dry-run' | 'apply'

const APPLY = MODE === 'apply' && process.argv.includes('--apply');

const SECTIONS = [
  'estimateMasterCRGO',
  'estimateMasterAmorphous',
  'estimateMasterWoundCore',
  'estimateMasterOverhauling',
  'estimateMasterCircleLimits',
];

banner('MIGRATE ESTIMATE MASTER -> AT');
console.log(`MODE = '${MODE}'${APPLY ? '   ** WRITING **' : '   (dry run - nothing will be written)'}\n`);

const [agencies, ats, jobs] = await Promise.all([all('agencies'), all('atMasters'), all('jobs')]);
const agById = Object.fromEntries(agencies.map(a => [a.id, a]));
const atLabel = t => t.atNumber || t.name || t.id;
const len = v => Array.isArray(v) ? v.length : 0;

// ---------------------------------------------------------------- plan
const plan = [];
const skipped = [];

for (const at of ats) {
  const ag = agById[at.agencyId];
  const label = `${atLabel(at)} [${ag?.name || 'NO AGENCY'}]`;

  if (!ag) { skipped.push({ at: label, why: 'AT points at no agency - repoint or delete it first' }); continue; }
  if (at.ratesSource) { skipped.push({ at: label, why: `already has rates (ratesSource='${at.ratesSource}') - never overwritten` }); continue; }

  const held = SECTIONS.filter(k => len(at[k]) > 0);
  if (held.length) { skipped.push({ at: label, why: `already holds sections (${held.join(', ')}) without a ratesSource - inspect by hand` }); continue; }

  const available = SECTIONS.filter(k => len(ag[k]) > 0);
  if (available.length === 0) { skipped.push({ at: label, why: `agency ${ag.name} has no sections to copy - it resolves from public_config, which is correct` }); continue; }

  plan.push({
    atId: at.id,
    atLabel: label,
    agencyId: ag.id,
    agencyName: ag.name,
    fields: Object.fromEntries(available.map(k => [k, len(ag[k])])),
    jobCount: jobs.filter(j => j.atId === at.id).length,
  });
}

// ---------------------------------------------------------------- report
console.log('================ WHAT WOULD BE WRITTEN ================\n');
if (plan.length === 0) {
  console.log('  Nothing. No AT needs rates copied onto it.');
} else {
  for (const p of plan) {
    console.log(`  atMasters/${p.atId}`);
    console.log(`    ${p.atLabel}   (${p.jobCount} job(s) booked under it)`);
    console.log(`    source: agencies/${p.agencyId}  "${p.agencyName}"`);
    SECTIONS.forEach(k => {
      const n = p.fields[k];
      console.log(n ? `      ${k.padEnd(28)} <- ${n} item(s)` : `      ${k.padEnd(28)} (agency has none - field NOT written)`);
    });
    console.log(`      ${'ratesSource'.padEnd(28)} <- 'inherited-agency'`);
    console.log(`      ${'ratesUpdatedAt'.padEnd(28)} <- <now>`);
    console.log('');
  }
}

if (skipped.length) {
  console.log('================ SKIPPED ================');
  skipped.forEach(s => console.log(`  ${s.at}\n    ${s.why}`));
  console.log('');
}

// SHARED SOURCE - one agency master copied onto more than one AT. Each of these asserts
// that the two tenders had identical rates.
const byAgency = {};
plan.forEach(p => { (byAgency[p.agencyName] ||= []).push(p); });
const shared = Object.entries(byAgency).filter(([, list]) => list.length > 1);
if (shared.length) {
  console.log('================ ⚠ SHARED SOURCE ================');
  console.log('  One agency master copied onto more than one AT. Each of these ASSERTS that the');
  console.log('  two tenders were negotiated at identical rates - the assumption this whole');
  console.log('  move exists to break. Confirm per AT before applying on real data.\n');
  shared.forEach(([ag, list]) => {
    console.log(`  ${ag}:`);
    list.forEach(p => console.log(`    -> ${p.atLabel}  (${p.jobCount} job(s))`));
  });
  console.log('');
}

console.log('================ TOTALS ================');
console.log(`  ${plan.length} document(s) would be written, ${skipped.length} skipped.`);
console.log(`  ${plan.reduce((n, p) => n + p.jobCount, 0)} job(s) are booked under the ATs being written.`);
console.log('  Nothing outside atMasters is touched. No agency section is deleted or altered.\n');

// ---------------------------------------------------------------- apply
if (!APPLY) {
  console.log('DRY RUN - nothing was written.');
  console.log("To apply: set MODE = 'apply' in this file AND pass --apply, then set it back.");
  process.exit(0);
}

console.log('APPLYING...\n');
const now = Date.now();
let written = 0;
for (const p of plan) {
  const ag = agById[p.agencyId];
  const payload = { ratesSource: 'inherited-agency', ratesUpdatedAt: now };
  SECTIONS.forEach(k => { if (len(ag[k]) > 0) payload[k] = ag[k]; });
  await db.collection('atMasters').doc(p.atId).update(payload);
  written++;
  console.log(`  written  atMasters/${p.atId}  ${p.atLabel}`);
}
console.log(`\n${written} document(s) written. Re-run the dry run to confirm they are now skipped.`);
