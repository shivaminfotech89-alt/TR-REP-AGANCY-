// MR 5585: REPAIR THE RECEIPT'S TENDER **AND** THE CARRY IT CORRUPTED — DRY-RUN BY DEFAULT (AUDIT G124).
//
//     node scripts/admin/fix-mr5585-tender-and-carry.js            reports, writes nothing
//     node scripts/admin/fix-mr5585-tender-and-carry.js --apply    writes both halves in ONE batch
//
// ⚠⚠ TWO HALVES OF ONE CORRECTION, AND EITHER ALONE IS WRONG.
//
//   Half A  oilTransactions/jiRVY3ADM9JmhFfJoQTj  atId  NpJKH9fZpMoijypO1GZr -> krdXRrzgCl0aTbJNTiL4
//   Half B  atMasters/O141gDio6XTRyuMyZeQl        openingOilBalance / ByDivision.DEESA  2212 -> recomputed
//
// Half A alone moves 2,110 L onto ADMIN's `2026_27` statement, where it belongs - and leaves the 1819 tender
// opening at 2,212 L, a debt the agency had already settled. The printed statement would be right and the Oil
// Account screen wrong, which is worse than both being wrong the same way.
//
// Half B alone recomputes a carry from a source tender that still cannot see the receipt, so it reproduces
// 2,212. The halves are applied in one `writeBatch` for that reason.
//
// WHY 2026_27, FROM EVIDENCE
// --------------------------
//   - the receipt is dated 2026-08-28 (`date` and `mrDate` agree)
//   - ADMIN `2026_27`         startDate 2026-08-15, endDate 2027-08-15  -> LIVE on that date
//   - ADMIN `2026-28/AT/1819` startDate 2026-09-07                      -> did not exist for another 10 days
//   - `2026_27` holds 20 DEESA jobs spanning 2026-08-15 .. 2026-09-07, bracketing the receipt
//   - `2026-28/AT/1819`'s earliest DEESA job is 2026-10-06, five weeks after it
//   - the dead id `NpJKH9fZpMoijypO1GZr` appears on NO other record, so nothing else can say what it was
//
// ⚠ THE CARRIED FIGURE IS RECOMPUTED BY THE APP'S OWN CODE, NOT TYPED IN. `computeOilBalance` and
// `openingMapFrom` are imported from `src/lib/oilBalance.ts` - the same functions `addAtMaster` calls - and the
// surrounding arithmetic is the block at `AgencyContext` ~2108: carry the source's net, then add the source's
// OWN opening (F86), because a tender that opened owing 40 and moved nothing still closes owing 40. Writing
// 102 by hand would be a figure that could drift from what the screen computes.
//
// ⚠ IT REFUSES IF THE DATA IS NOT WHAT THIS SCRIPT WAS REASONED ABOUT: wrong current atId, a target tender that
// does not exist, a source tender that is not `openingOilBalanceFromAtId`, or a recomputed figure that still
// equals the old one.

import { all, banner, db } from './_db.js';

const MODE = process.argv.includes('--apply') ? 'apply' : 'dry-run';

const TX_ID = 'jiRVY3ADM9JmhFfJoQTj';
const DEAD_AT = 'NpJKH9fZpMoijypO1GZr';
const TARGET_AT = 'krdXRrzgCl0aTbJNTiL4';     // ADMIN 2026_27
const CARRY_AT = 'O141gDio6XTRyuMyZeQl';      // ADMIN 2026-28/AT/1819

const N = v => String(v ?? '').trim();

banner(`MR 5585 - RECEIPT TENDER + CARRY-FORWARD   [MODE = ${MODE}]`, { writes: MODE === 'apply' });

// the app's own arithmetic, bundled out of src/ so this script cannot answer the question differently
const { computeOilBalance, openingMapFrom, inspectionFor } = await (async () => {
  const { build } = await import('esbuild');
  const { mkdirSync, writeFileSync } = await import('fs');
  const { join, dirname } = await import('path');
  const { tmpdir } = await import('os');
  const { fileURLToPath, pathToFileURL } = await import('url');
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..').replace(/\\/g, '/');
  const OUT = join(tmpdir(), `mr5585-${process.pid}`);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'e.ts'), [
    `export { computeOilBalance, openingMapFrom } from '${ROOT}/src/lib/oilBalance';`,
    `export { inspectionFor } from '${ROOT}/src/lib/inspectionLink';`,
  ].join('\n'));
  await build({ entryPoints: [join(OUT, 'e.ts')], bundle: true, format: 'esm', platform: 'node',
    outfile: join(OUT, 'b.mjs'), logLevel: 'silent', loader: { '.ts': 'ts' } });
  return import(pathToFileURL(join(OUT, 'b.mjs')).href);
})();

const [jobs, insps, oil, ats] = await Promise.all(
  [all('jobs'), all('inspections'), all('oilTransactions'), all('atMasters')]);

const tx = oil.find(t => t.id === TX_ID);
const target = ats.find(a => a.id === TARGET_AT);
const carry = ats.find(a => a.id === CARRY_AT);

if (!tx) { console.error(`\nREFUSED - no oilTransactions/${TX_ID}.`); process.exit(2); }
if (!target) { console.error(`\nREFUSED - no atMasters/${TARGET_AT} to point the receipt at.`); process.exit(2); }
if (!carry) { console.error(`\nREFUSED - no atMasters/${CARRY_AT} to recompute.`); process.exit(2); }
if (N(tx.atId) !== DEAD_AT) {
  console.error(`\nREFUSED - the receipt's atId is ${N(tx.atId) || '(absent)'}, not ${DEAD_AT}.`);
  console.error('Something else has changed it. The reasoning in this script was about the dead reference.');
  process.exit(2);
}
if (N(carry.openingOilBalanceFromAtId) !== TARGET_AT) {
  console.error(`\nREFUSED - ${CARRY_AT} carries from ${N(carry.openingOilBalanceFromAtId) || '(absent)'},`);
  console.error(`not from ${TARGET_AT}. This script assumes the carry came from the tender it is repairing.`);
  process.exit(2);
}
if (ats.some(a => a.id === DEAD_AT)) {
  console.error(`\nREFUSED - ${DEAD_AT} EXISTS after all. It is not a dangling reference and this is the wrong fix.`);
  process.exit(2);
}

console.log('HALF A - the receipt');
console.log(`  oilTransactions/${TX_ID}`);
console.log(`     ${Number(tx.netLiters || 0).toFixed(1)} L ${N(tx.oilType)}, MR ${N(tx.mrNo)}, ${N(tx.division)}, ${N(tx.mrDate)}`);
console.log(`     atId  ${DEAD_AT}  (no such tender)  ->  ${TARGET_AT}  (${N(target.atNumber || target.name)})`);

// --- HALF B: recompute the carry the way addAtMaster does, WITH the repair applied -------------------------
const repaired = oil.map(t => (t.id === TX_ID ? { ...t, atId: TARGET_AT } : t));
const srcJobs = jobs.filter(j => N(j.atId) === TARGET_AT);
const srcTx = repaired.filter(t => N(t.atId) === TARGET_AT);

const balance = computeOilBalance({ jobs: srcJobs, inspections: insps, transactions: srcTx });
const carriedMap = openingMapFrom(balance);
// The source tender's OWN opening is part of what it closes with (F86).
const prevOpeningMap = (target.openingOilBalanceByDivision || {});
for (const [div, v] of Object.entries(prevOpeningMap)) {
  carriedMap[div] = Number(((carriedMap[div] || 0) + (Number(v) || 0)).toFixed(2));
}
const prevOpening = Number(target.openingOilBalance);
const total = Number(((Number.isFinite(prevOpening) ? prevOpening : 0) + balance.net).toFixed(2));

console.log('\nHALF B - the carry-forward onto 2026-28/AT/1819, recomputed by lib/oilBalance');
console.log(`  source tender ${N(target.atNumber || target.name)}: jobs ${balance.jobsCounted}, receipts ${balance.transactionsCounted}`);
console.log(`     shortage ${balance.shortage} L   received ${balance.received} L   net ${balance.net} L`);
console.log(`  source's own opening carried forward (F86): ${Number.isFinite(prevOpening) ? prevOpening : 0} L`);
console.log(`  atMasters/${CARRY_AT}`);
console.log(`     openingOilBalance            ${carry.openingOilBalance}  ->  ${total}`);
console.log(`     openingOilBalanceByDivision  ${JSON.stringify(carry.openingOilBalanceByDivision)}  ->  ${JSON.stringify(carriedMap)}`);

if (balance.jobsCounted === 0 && balance.transactionsCounted === 0) {
  console.error('\nREFUSED - the source tender has no records, so a carry of 0 would be an absence written as a fact (F82, F92).');
  process.exit(2);
}
if (Number(carry.openingOilBalance) === total) {
  console.error(`\nREFUSED - the recomputed carry equals the stored one (${total}). Half B would change nothing,`);
  console.error('which means the receipt repair is not reaching the arithmetic. Investigate before writing.');
  process.exit(2);
}

if (MODE === 'dry-run') {
  console.log('\n[dry-run] Nothing was written. Both halves go in ONE batch when applied.');
  process.exit(0);
}

const batch = db.batch();
batch.update(db.collection('oilTransactions').doc(TX_ID), { atId: TARGET_AT, updatedAt: Date.now() });
batch.update(db.collection('atMasters').doc(CARRY_AT), {
  openingOilBalance: total,
  openingOilBalanceByDivision: carriedMap,
  openingOilBalanceAt: carry.openingOilBalanceAt ?? Date.now(),
});
await batch.commit();
console.log('\n[apply] both halves committed in one batch.');
console.log('Re-run without --apply: it should then REFUSE on the atId check, which is the confirmation.');
process.exit(0);
