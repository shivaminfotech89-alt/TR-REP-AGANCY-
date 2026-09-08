// Correct the two artefact cells in public_config/estimate_master.
//
// WHAT AND WHY.
//
// `public_config` holds 17 CRGO cells at the 100 KVA column that the shipped constants leave
// null - the residue of the eight-cell correction recorded in AUDIT. FIFTEEN of them are the
// correct UGVCL-2020 figures, so the copy test in `resolveRate` neutralises them: a master
// cell equal to the schedule it was copied from is not an override, and resolves to the
// schedule anyway. Rewriting those would be churn.
//
// TWO ARE WRONG, and because they DIFFER from the 2020 baseline the copy test reads them as
// genuine overrides and they WIN over the tender:
//
//     1f  @ 100 KVA   230      the tender says 229
//     11B @ 100 KVA   148.99   the tender says 149
//
// ⚠ WHY THIS RUNS BEFORE THE UI CONTROL IS REMOVED. "Publish to the shared baseline" is the
// last writer of this document. Removing it first would leave these two cells permanently
// wrong and unwritable from inside the app - frozen carrying an error, for the one agency
// that still resolves through public_config. Correct first, then remove.
//
// SCOPE: four cells - two in estimateMasterCRGO and the same two in the legacy mirror. The
// fifteen no-op cells at 100 KVA are deliberately untouched: they match the schedule, so the
// copy test resolves them identically either way and rewriting them is churn.
//
// MODE is 'dry-run'. Set it to 'apply' to write, and set it back before committing.

import { db, all, banner } from './_db.js';

const MODE = 'dry-run';           // 'dry-run' | 'apply'
const DOC = 'estimate_master';

/** [section field, item code, KVA key, wrong value, tender value] */
const FIXES = [
  ['estimateMasterCRGO', '1f', '100', 230, 229],
  ['estimateMasterCRGO', '11B', '100', 148.99, 149],
  // ⚠ THE LEGACY MIRROR CARRIES THE SAME TWO ERRORS AND IS CORRECTED WITH THEM.
  //
  // `estimateMaster` (no suffix) is rung 4 of the CRGO chain and is UNREACHABLE while
  // `estimateMasterCRGO` is non-empty (AgencyContext:898-903). That is a statement about
  // DATA, not about code: it becomes live the moment an agency's own CRGO section is empty
  // AND public_config's CRGO section is empty or fails to load.
  //
  // Which is exactly why it must not be left wrong. A fallback reached only in a degraded
  // state should not itself be a source of error - it is the layer that catches a failure,
  // and the one place nobody will be checking when it does. Same write, no extra cost.
  ['estimateMaster', '1f', '100', 230, 229],
  ['estimateMaster', '11B', '100', 148.99, 149],
];

banner(`FIX public_config/${DOC} artefact cells  [${MODE}]`);

const docs = await all('public_config');
const pc = docs.find(d => d.id === DOC);
if (!pc) { console.error(`  public_config/${DOC} not found. Nothing to do.`); process.exit(1); }

console.log(`  frozenAt : ${pc.frozenAt ? new Date(pc.frozenAt).toISOString() : '(not stamped)'}`);
console.log(`  updatedAt: ${pc.updatedAt ? new Date(pc.updatedAt).toISOString() : '(none)'}\n`);

const planned = [];
for (const [field, code, kva, wrong, right] of FIXES) {
  const arr = pc[field];
  if (!Array.isArray(arr)) { console.log(`  ${field}: MISSING - skipped`); continue; }
  const idx = arr.findIndex(it => String(it.itemCode ?? '').trim().toLowerCase() === code.toLowerCase());
  if (idx === -1) { console.log(`  ${field} "${code}": row not found - skipped`); continue; }
  const cur = arr[idx].rates?.[kva];
  if (Number(cur) !== wrong) {
    console.log(`  ${field} "${code}"@${kva}: is ${cur}, expected ${wrong} - SKIPPED, nothing assumed`);
    continue;
  }
  console.log(`  ${MODE === 'apply' ? 'FIX ' : 'would fix'}  ${field} "${code}"@${kva} KVA:  ${cur}  ->  ${right}`);
  planned.push({ field, idx, kva, right });
}

if (MODE !== 'apply') {
  console.log(`\n  DRY RUN - nothing was written. ${planned.length} cell(s) would change.`);
} else {
  if (!planned.length) { console.log('\n  Nothing to write.'); process.exit(0); }
  // Read-modify-write the whole arrays: Firestore cannot patch one element of an array.
  const update = {};
  for (const { field, idx, kva, right } of planned) {
    const arr = update[field] ?? JSON.parse(JSON.stringify(pc[field]));
    arr[idx] = { ...arr[idx], rates: { ...arr[idx].rates, [kva]: right } };
    update[field] = arr;
  }
  update.artefactFixAt = Date.now();
  update.artefactFixBy = 'scripts/admin/fix-public-config-artefacts.js';
  update.artefactFixNote = '1f@100 230->229 and 11B@100 148.99->149, in estimateMasterCRGO and the legacy estimateMaster mirror, to the UGVCL-2020 tender figures. The other 15 filled cells at 100 KVA match the schedule and were left alone.';
  await db.collection('public_config').doc(DOC).update(update);
  console.log(`\n  Wrote ${planned.length} cell(s) and stamped artefactFixAt.`);
}
