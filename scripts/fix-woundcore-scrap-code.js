// CHANGE ONE ITEM CODE: MEGHA's Wound Core scrap row, "1" -> "0".
//
// WHY A SCRIPT AND NOT THE SCREEN: EstimateMaster loads Wound Core through
// normalizeAmorphousOrWoundCoreData, which merges the default list in - cloning any default
// row the stored section lacks, reordering to default order, forcing units to QTY and
// backfilling fixedRate. Saving from that screen would persist all of that alongside the
// one change intended. This writes the stored array back with exactly one string altered.
//
// WHAT IT DOES: reads the agency, finds the ONE row whose itemCode is "1", sets that row's
// itemCode to "0", writes back `estimateMasterWoundCore` and nothing else. No reordering,
// no unit change, no fixedRate change, no rate change, no added or removed rows.
//
// HOW TO RUN
//   1. npm run dev, log in, RELOAD the tab.
//   2. DevTools console, paste this whole file, Enter.
//
//   MODE is 'dry-run' below. It reads and prints only - it writes NOTHING.
//   Change MODE to 'write' ONLY after the dry-run output has been reviewed and authorised,
//   and set it BACK to 'dry-run' before committing.

const MODE = 'dry-run';        // 'dry-run' | 'write'

const AGENCY_NAME = 'MEGHA';   // matched case-insensitively on a name that CONTAINS this
const FROM_CODE = '1';
const TO_CODE = '0';

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs, doc, updateDoc } = fs;
  if (MODE === 'write' && !updateDoc) { console.error('updateDoc handle missing - reload the tab.'); return; }

  const uid = auth?.currentUser?.uid;
  if (!uid) { console.error('Not signed in.'); return; }

  const hdr = t => console.log(`\n${'='.repeat(92)}\n${t}\n${'='.repeat(92)}`);
  const KVA = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'];

  const snap = async (col, ...c) =>
    (await getDocs(query(collection(db, col), ...c))).docs.map(d => ({ id: d.id, ...d.data() }));
  const agencies = await snap('agencies', where('ownerId', '==', uid));

  const matches = agencies.filter(a =>
    String(a.name ?? '').toLowerCase().includes(AGENCY_NAME.toLowerCase()));
  if (matches.length === 0) { console.error(`No agency whose name contains "${AGENCY_NAME}".`); return; }
  if (matches.length > 1) {
    console.error(`${matches.length} agencies match "${AGENCY_NAME}": ${matches.map(a => a.name).join(', ')}.`);
    console.error('Refusing to guess. Narrow AGENCY_NAME at the top of this file.');
    return;
  }
  const agency = matches[0];

  const stored = agency.estimateMasterWoundCore;
  if (!Array.isArray(stored)) {
    console.error(`${agency.name} has no stored estimateMasterWoundCore array. Nothing to change.`);
    return;
  }

  const targets = stored
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => String(it.itemCode ?? '').trim() === FROM_CODE);
  const collisions = stored.filter(it => String(it.itemCode ?? '').trim() === TO_CODE);

  hdr(`${agency.name} - stored estimateMasterWoundCore: ${stored.length} item(s)   MODE: ${MODE.toUpperCase()}`);
  console.log('#   code      fixedRate  unit    description');
  console.log('-'.repeat(92));
  stored.forEach((it, i) => {
    const mark = String(it.itemCode ?? '').trim() === FROM_CODE ? ' <== TARGET' : '';
    console.log(
      String(i + 1).padEnd(4) +
      JSON.stringify(String(it.itemCode ?? '')).padEnd(10) +
      String(it.fixedRate ?? '').padEnd(11) +
      String(it.unit ?? '').padEnd(8) +
      String(it.itemName ?? '').slice(0, 44) + mark
    );
  });

  // Refuse anything but the unambiguous case. Renaming a code is only safe when exactly
  // one row carries the old code and nothing already carries the new one - otherwise the
  // result is a duplicate, and .find() would silently make one of them unreachable.
  if (targets.length === 0) {
    console.error(`\nNo row with itemCode "${FROM_CODE}". Nothing to do.`);
    return;
  }
  if (targets.length > 1) {
    console.error(`\n${targets.length} rows carry itemCode "${FROM_CODE}". Refusing to guess which to rename.`);
    return;
  }
  if (collisions.length > 0) {
    console.error(`\n${collisions.length} row(s) already carry itemCode "${TO_CODE}". Renaming would create a duplicate.`);
    console.error('Resolve by hand first - .find() returns the first match, so the other would price nothing.');
    return;
  }

  const { it: row, i: idx } = targets[0];

  hdr('THE ONE ROW BEING CHANGED - full before / after');
  const fullRow = r => ({
    itemCode: r.itemCode,
    itemName: r.itemName,
    unit: r.unit,
    fixedRate: r.fixedRate,
    ...Object.fromEntries(KVA.map(k => [k, r.rates ? r.rates[k] : undefined])),
  });
  const after = { ...row, itemCode: TO_CODE };
  console.log(`row #${idx + 1} of ${stored.length}`);
  console.table([{ when: 'BEFORE', ...fullRow(row) }, { when: 'AFTER', ...fullRow(after) }]);
  console.log('BEFORE (raw):', JSON.stringify(row));
  console.log('AFTER  (raw):', JSON.stringify(after));

  // Build the new array by identity: every other element is the SAME OBJECT, so nothing
  // else can differ even by key order.
  const updated = stored.map((it, i) => (i === idx ? after : it));

  hdr('PROOF THE OTHER ROWS ARE UNTOUCHED');
  let identical = 0, differing = 0;
  stored.forEach((it, i) => {
    if (i === idx) return;
    const same = JSON.stringify(it) === JSON.stringify(updated[i]);
    if (same) identical++; else { differing++; console.log(`  row #${i + 1} DIFFERS - this should be impossible`); }
  });
  console.log(`  ${identical} row(s) byte-identical, ${differing} differing, order preserved (${stored.length} -> ${updated.length} items)`);
  const onlyDiff = JSON.stringify(stored.map((r, i) => i === idx ? null : r)) ===
                   JSON.stringify(updated.map((r, i) => i === idx ? null : r));
  console.log(`  whole-array comparison excluding row #${idx + 1}: ${onlyDiff ? 'IDENTICAL' : 'DIFFERENT - DO NOT WRITE'}`);
  if (!onlyDiff) { console.error('Aborting: something other than the target row changed.'); return; }

  if (MODE !== 'write') {
    hdr('DRY RUN - NOTHING WAS WRITTEN');
    console.log(`Would set estimateMasterWoundCore on agency "${agency.name}" (${agency.id}),`);
    console.log(`changing row #${idx + 1} itemCode "${FROM_CODE}" -> "${TO_CODE}" and nothing else.`);
    console.log('No other field on the agency document is touched.');
    console.log("To apply: change MODE to 'write' at the top and re-paste.");
    window.__wcFix = { agency: agency.name, agencyId: agency.id, idx, before: row, after, stored, updated };
    console.log('Full results: window.__wcFix');
    return;
  }

  hdr(`WRITING estimateMasterWoundCore on "${agency.name}"`);
  await updateDoc(doc(db, 'agencies', agency.id), { estimateMasterWoundCore: updated });
  console.log(`DONE. Row #${idx + 1} itemCode is now "${TO_CODE}". No other field was modified.`);
  console.log('Reload the tab, then re-run master-section-scorecard-console.js to verify');
  console.log('scrapCodePresent is true for Wound Core from Firestore, not from the screen.');
  window.__wcFix = { agency: agency.name, agencyId: agency.id, idx, before: row, after, updated, written: true };
})();
