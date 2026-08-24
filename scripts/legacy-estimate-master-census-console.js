// THE LEGACY `estimateMaster` FIELD - WHO HOLDS IT, AND DOES IT MATCH THEIR CRGO SECTION
//
// READ-ONLY. No set/update/delete/batch anywhere in this file.
//
// Paste into the browser console with the app open and signed in.
//
// WHY
// ---
// `estimateMaster` is the pre-sections CRGO field. Five write paths still populate it as a
// mirror of `estimateMasterCRGO`:
//
//   EstimateMaster.tsx:663   per-agency "Save All"
//   EstimateMaster.tsx:902   payload build
//   EstimateMaster.tsx:937   per-section publish (CRGO branch)
//   EstimateMaster.tsx:982   "Publish as Default for All Users" -> public_config AND, via
//                            AgencyContext.tsx:625, every agency the caller owns
//   AgencyContext.tsx:680    addAgency - so every agency is BORN with it
//
// Nothing reads it in any reachable path (see AUDIT O26): every reader checks
// public_config's CRGO section first, and public_config has one. So it is a shadow copy
// that stays correct only because it happens to be written in the same breath as the field
// that shadows it.
//
// This script answers the three questions that decide whether it can go:
//   1. which agencies hold it
//   2. whether it matches their current CRGO section, cell by cell
//   3. whether any agency's CRGO section is EMPTY while the legacy field is not - the only
//      state in which removing it could change what an estimate charges

(async () => {
  const { collection, query, where, getDocs, doc, getDoc } = window.__fs;
  const db = window.__db, uid = window.__auth.currentUser?.uid;
  if (!db || !uid) { console.error('Sign in first - window.__db / __auth not ready.'); return; }

  const KVA = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'];
  const norm = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) ? null : Number(v);

  // cell-by-cell comparison, keyed by itemCode so row ORDER differences are not reported
  // as content differences
  const compare = (crgo, legacy) => {
    const byCode = list => {
      const m = new Map();
      (list || []).forEach(it => m.set(String(it.itemCode ?? '').trim().toLowerCase(), it));
      return m;
    };
    const A = byCode(crgo), B = byCode(legacy);
    const codes = new Set([...A.keys(), ...B.keys()]);
    let cellDiffs = 0; const rowNotes = [];
    codes.forEach(code => {
      const a = A.get(code), b = B.get(code);
      if (!a) { rowNotes.push(`${code}: only in legacy`); return; }
      if (!b) { rowNotes.push(`${code}: only in CRGO`); return; }
      const d = KVA.filter(k => norm(a.rates?.[k]) !== norm(b.rates?.[k]));
      if (d.length) { cellDiffs += d.length; rowNotes.push(`${code}: ${d.length} rate(s) differ (${d.join(', ')} kVA)`); }
      if (String(a.itemName ?? '') !== String(b.itemName ?? '')) rowNotes.push(`${code}: name differs`);
    });
    return { cellDiffs, rowNotes };
  };

  // public_config first - its CRGO section is what makes every agency's legacy field
  // unreachable. If this is empty, the legacy field becomes live.
  const pub = await getDoc(doc(db, 'public_config', 'estimate_master'));
  const p = pub.exists() ? pub.data() : null;
  console.log('=== public_config/estimate_master ===');
  console.log(`  estimateMasterCRGO : ${Array.isArray(p?.estimateMasterCRGO) ? p.estimateMasterCRGO.length + ' items' : '(ABSENT - legacy fields become reachable)'}`);
  console.log(`  estimateMaster     : ${Array.isArray(p?.estimateMaster) ? p.estimateMaster.length + ' items' : '(absent)'}`);
  if (Array.isArray(p?.estimateMasterCRGO) && Array.isArray(p?.estimateMaster)) {
    const r = compare(p.estimateMasterCRGO, p.estimateMaster);
    console.log(`  match              : ${r.cellDiffs === 0 && r.rowNotes.length === 0 ? 'IDENTICAL' : r.rowNotes.length + ' row note(s), ' + r.cellDiffs + ' differing cell(s)'}`);
    r.rowNotes.slice(0, 10).forEach(n => console.log(`      ${n}`));
  }

  const snap = await getDocs(query(collection(db, 'agencies'), where('ownerId', '==', uid)));
  const rows = [];
  snap.forEach(d => rows.push({ id: d.id, ...d.data() }));

  console.log(`\n=== ${rows.length} agencies owned by this user ===`);
  const live = [];
  for (const a of rows) {
    const crgo = a.estimateMasterCRGO, legacy = a.estimateMaster;
    const hasCrgo = Array.isArray(crgo) && crgo.length > 0;
    const hasLegacy = Array.isArray(legacy) && legacy.length > 0;
    console.log(`\n  ${a.name || a.id}`);
    console.log(`    estimateMasterCRGO : ${hasCrgo ? crgo.length + ' items' : '(EMPTY)'}`);
    console.log(`    estimateMaster     : ${hasLegacy ? legacy.length + ' items' : '(absent)'}`);
    if (hasCrgo && hasLegacy) {
      const r = compare(crgo, legacy);
      if (r.cellDiffs === 0 && r.rowNotes.length === 0) {
        console.log('    -> IDENTICAL. Unread weight; removing it changes nothing.');
      } else {
        console.log(`    -> DIVERGED: ${r.rowNotes.length} row note(s), ${r.cellDiffs} differing cell(s)`);
        r.rowNotes.slice(0, 12).forEach(n => console.log(`         ${n}`));
        console.log('       Divergence means the mirror stopped being written at some point.');
        console.log('       The CRGO section is what prices jobs; the legacy copy is stale.');
      }
    }
    if (!hasCrgo && hasLegacy) {
      live.push(a.name || a.id);
      console.log('    -> CRGO SECTION EMPTY, LEGACY PRESENT. This is the only state where the');
      console.log('       legacy field could matter. It is still shadowed by public_config CRGO,');
      console.log('       but it would become live if public_config were empty or unreachable.');
    }
  }

  console.log('\n=== VERDICT ===');
  if (!live.length) {
    console.log('  No agency has an empty CRGO section with a populated legacy field.');
    console.log('  Removing `estimateMaster` cannot change any estimate under any');
    console.log('  public_config state, because no agency depends on it as a fallback.');
  } else {
    console.log(`  ${live.length} agency(ies) would depend on the legacy field if public_config`);
    console.log(`  CRGO were ever empty: ${live.join(', ')}`);
    console.log('  Fill their estimateMasterCRGO before removing the legacy field.');
  }
  console.log('\nDone. Nothing was written.');
})();
