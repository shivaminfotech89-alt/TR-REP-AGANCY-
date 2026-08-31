// BACKFILL THE OPENING OIL BALANCE ONTO ATs THAT PREDATE THE AUTOMATIC CARRY
//
//   node scripts/admin/backfill-opening-oil.js            <- DRY RUN, writes nothing
//   node scripts/admin/backfill-opening-oil.js --apply    <- writes, after MODE is changed
//
// ⚠ MODE MUST BE 'dry-run' IN THE REPOSITORY. Change it to run, change it back before
// committing. Security rules do NOT apply to the Admin SDK - see _db.js.
//
// WHAT THIS IS FOR
// ----------------
// AUDIT F96 moved the oil carry-forward into `addAtMaster`: a tender now opens with the
// previous tender's closing net, computed in the same write that creates it. ATs created
// BEFORE that change have no opening balance and will never get one, because the only moment
// that writes it has passed for them.
//
// ⚠ IT SNAPSHOTS TODAY'S DATA, NOT THE DATA AT ROLLOVER. The automatic version computes the
// source tender's closing net at the instant the new tender is created. This computes it now.
// For a tender created recently against static data those are the same number; for an old one
// they are not, and the difference is silent. That is the honest limit of a backfill and the
// reason this is a separate, approved, one-off rather than something the app does.
//
// THE RULES, MATCHING addAtMaster EXACTLY
// ---------------------------------------
//   - previous tender = the agency's most recent AT by `startDate` STRICTLY BEFORE this one's
//   - no previous tender            -> SKIP. The first tender starts at nothing.
//   - previous tender has NO records -> SKIP. "We have no account of what happened" is not
//     "it closed level", and writing 0.00 would convert the first into the second permanently
//     (AUDIT F82, F92). A tender that really did close level HAS records netting to zero.
//   - an opening balance already recorded -> SKIP. This never overwrites.
//   - unassigned work in the source -> STILL CARRY, and stamp openingOilBalanceIncomplete.
//
// The arithmetic is copied from src/lib/oilBalance.ts so this script and the app cannot
// answer the same question differently - the side-by-side discipline from AUDIT F87.

import { all, banner, db } from './_db.js';
import { inspectionFor } from '../../src/lib/inspectionLink.js';

const MODE = 'dry-run';   // 'dry-run' | 'apply'

const APPLY = MODE === 'apply' && process.argv.includes('--apply');

const isUnassigned = (r) => !String(r?.atId ?? '').trim();
const divKey = (v) => String(v ?? '').trim() || '(no division)';
const sign = (n) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(Number(n.toFixed(2))).toFixed(2)}`;
const dir = (n) => n > 0 ? 'division owes the agency' : n < 0 ? 'agency owes the division' : 'settled level';

banner('BACKFILL OPENING OIL BALANCE (AUDIT F96)');
console.log(`MODE = '${MODE}'${APPLY ? '   ** WRITING **' : '   (dry run - nothing will be written)'}\n`);

const [agencies, ats, jobs, txns, inspections] = await Promise.all(
  ['agencies', 'atMasters', 'jobs', 'oilTransactions', 'inspections'].map(all));

const external = inspections.filter(i => i.type === 'External' || !i.type);
// ⚠ THE LINK RULE IS IMPORTED, NOT COPIED (AUDIT G4). Seven identical copies existed and
// each could drift; this decides whether an inspection's measurements apply to a transformer,
// so a divergence changes a shortage on a document sent to a division.
const inspFor = (job) => inspectionFor(job, external);

/** src/lib/oilBalance.ts jobOilShortage, verbatim. */
function jobOilShortage(job) {
  const insp = inspFor(job);
  const stored = insp?.data?.netShortage ?? insp?.netShortage ?? job.externalDetails?.netShortage;
  if (typeof stored === 'number') return stored;
  const rawCap = insp?.data?.oilCapLtrs ?? insp?.oilCapLtrs ?? job.externalDetails?.oilCapLtrs ?? job.oilCapLtrs ?? job.oilCapacity;
  const rawLess = insp?.data?.lessOilLtrs ?? insp?.lessOilLtrs ?? job.externalDetails?.lessOilLtrs ?? job.lessOilLtrs;
  const kva = Number(job.capacityKva) || 25;
  const defaultCap = kva <= 16 ? 140 : kva <= 25 ? 184 : kva <= 63 ? 240 : 323;
  const cap = (rawCap !== undefined && rawCap !== null && String(rawCap).trim() !== '') ? Number(rawCap) : defaultCap;
  const less = (rawLess !== undefined && rawLess !== null && String(rawLess).trim() !== '') ? Number(rawLess) : 0;
  return less + Math.max(0, cap - less) * 0.05;
}

const agName = (id) => agencies.find(a => a.id === id)?.name || id;
const label = (t) => `AT ${t.atNumber || t.name || t.id}`;

const writes = [];
const skipped = [];

for (const at of ats) {
  if (at.openingOilBalance !== undefined && at.openingOilBalance !== null) {
    skipped.push({ at, why: `already has an opening balance (${sign(Number(at.openingOilBalance))} LTR)` });
    continue;
  }

  const prior = ats
    .filter(t => t.agencyId === at.agencyId && t.id !== at.id && (t.startDate || 0) < (at.startDate || 0))
    .sort((a, b) => (b.startDate || 0) - (a.startDate || 0));
  const prev = prior[0];
  if (!prev) {
    skipped.push({ at, why: 'no previous tender — the first tender starts at nothing' });
    continue;
  }

  const pJobs = jobs.filter(j => j.agencyId === at.agencyId && String(j.atId ?? '') === prev.id && j.mrNo);
  const pTx = txns.filter(t => t.agencyId === at.agencyId && String(t.atId ?? '') === prev.id && t.mrNo);

  if (pJobs.length === 0 && pTx.length === 0) {
    skipped.push({ at, why: `${label(prev)} holds no jobs and no transactions — no account of what happened, which is not the same as a zero balance` });
    continue;
  }

  const byDivision = {};
  for (const j of pJobs) {
    const n = jobOilShortage(j);
    (byDivision[divKey(j.division)] ??= 0);
    byDivision[divKey(j.division)] += n;
  }
  for (const t of pTx) {
    (byDivision[divKey(t.division)] ??= 0);
    byDivision[divKey(t.division)] -= (Number(t.netLiters) || 0);
  }
  // The source tender's OWN opening is part of what it closes with (AUDIT F86).
  const prevOpeningMap = prev.openingOilBalanceByDivision || {};
  for (const [d, v] of Object.entries(prevOpeningMap)) {
    byDivision[d] = (byDivision[d] || 0) + (Number(v) || 0);
  }
  for (const d of Object.keys(byDivision)) byDivision[d] = Number(byDivision[d].toFixed(2));
  const total = Number(Object.values(byDivision).reduce((s, v) => s + v, 0).toFixed(2));

  const strayJobs = jobs.filter(j => j.agencyId === at.agencyId && isUnassigned(j)).length;
  const strayTx = txns.filter(t => t.agencyId === at.agencyId && isUnassigned(t)).length;

  writes.push({ at, prev, byDivision, total, strayJobs, strayTx });
}

console.log('=========================================================================');
console.log(`WOULD WRITE  (${writes.length})`);
console.log('=========================================================================');
if (!writes.length) console.log('  none');
for (const w of writes) {
  console.log(`\n  ${agName(w.at.agencyId)} — ${label(w.at)}   id ${w.at.id}`);
  console.log(`     carried from ${label(w.prev)}  (id ${w.prev.id})`);
  for (const [d, v] of Object.entries(w.byDivision).sort()) {
    console.log(`        ${d.padEnd(14)} ${sign(v).padStart(10)} LTR  ${dir(v)}`);
  }
  console.log(`     openingOilBalance = ${w.total}   ${dir(w.total)}`);
  if (w.strayJobs || w.strayTx) {
    console.log(`     ⚠ openingOilBalanceIncomplete = { jobs: ${w.strayJobs}, txns: ${w.strayTx} }  — the register will call this approximate`);
  }
}

console.log('\n=========================================================================');
console.log(`SKIPPED  (${skipped.length})`);
console.log('=========================================================================');
for (const s of skipped) {
  console.log(`  ${agName(s.at.agencyId).padEnd(20)} ${label(s.at).padEnd(16)} ${s.why}`);
}

if (!APPLY) {
  console.log("\nDRY RUN — nothing was written. To apply: set MODE = 'apply' and pass --apply.");
  process.exit(0);
}

for (const w of writes) {
  await db.collection('atMasters').doc(w.at.id).update({
    openingOilBalance: w.total,
    openingOilBalanceByDivision: w.byDivision,
    openingOilBalanceFromAtId: w.prev.id,
    openingOilBalanceAt: Date.now(),
    ...(w.strayJobs || w.strayTx
      ? { openingOilBalanceIncomplete: { jobs: w.strayJobs, txns: w.strayTx } }
      : {}),
  });
  console.log(`  wrote ${label(w.at)}  ${sign(w.total)} LTR`);
}
console.log(`\nBackfilled ${writes.length} tender(s). ${skipped.length} skipped.`);
