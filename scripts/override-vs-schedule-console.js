// EVERY STORED RATE THAT OVERRIDES THE TENDER, AND BY HOW MUCH
//
// READ-ONLY. No set/update/delete/batch anywhere in this file.
//
// Paste into the browser console on a DEV build, signed in. Run once per account -
// it can only see agencies owned by the signed-in user.
//
// WHY
// ---
// The estimate master was filled in by hand. A cell holding a value different from the
// Schedule-A rate for its band is EITHER a deliberate agency rate OR a typing slip, and
// the cell cannot tell you which - `1b` at 100 kVA held 49.00 against the tender's 46.00
// for months, across seven agencies, because one mistyped digit was copied onward.
//
// This lists every such cell so the slips can be spotted among the decisions. It changes
// nothing and recommends nothing: most differences will be intentional.
//
// SORTED BY RELATIVE DIFFERENCE, because that is what makes a typo visible. A cell 6.5%
// off the tender is the shape of a wrong digit; one 40% off is more likely a decision.
//
// Reads the RAW stored section, never the enriched context object - an agency with nothing
// stored inherits and overrides nothing, and reporting the fallback's output as an
// override would invent hundreds of them (the F27 trap).

(async () => {
  const { collection, query, where, getDocs, doc, getDoc } = window.__fs;
  const sch = window.__schedule;
  const db = window.__db, uid = window.__auth.currentUser?.uid;
  if (!db || !uid) { console.error('Sign in first - window.__db / __auth not ready.'); return; }
  if (!sch) {
    console.error('window.__schedule is missing - update src/lib/firebase.ts, and run on a DEV build.');
    console.error('Refusing to carry a second copy of Schedule-A in this script.');
    return;
  }
  const { SCHEDULE_A, bandForKva, scheduleSrForMasterCode, variantAxisForMasterCode } = sch;

  const KVA = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'];
  const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);

  // The tender rate for a master row at a capacity, or null when there isn't a single one.
  // Variant rows (winding material, KV class, capacity) have no single figure to compare
  // against, so they are skipped rather than compared to an arbitrary half of the pair.
  const tenderRate = (itemCode, kva) => {
    if (variantAxisForMasterCode(itemCode)) return null;
    const sr = scheduleSrForMasterCode(itemCode);
    if (!sr) return null;
    const entry = SCHEDULE_A.find(i => i.sr === sr);
    if (!entry) return null;
    const v = entry.rates[bandForKva(Number(kva) || 0)];
    return typeof v === 'number' && v > 0 ? v : null;
  };

  const scan = (label, section) => {
    const rows = [];
    (Array.isArray(section) ? section : []).forEach(item => {
      const code = String(item?.itemCode ?? '').trim();
      if (!code) return;
      KVA.forEach(kva => {
        const stored = num(item?.rates?.[kva]);
        if (stored === null) return;                 // inheriting - overrides nothing
        const tender = tenderRate(code, kva);
        if (tender === null) return;                 // no single tender figure to compare
        if (stored === tender) return;               // agrees - not an override
        rows.push({
          where: label,
          item: `${code} ${String(item.itemName ?? '').slice(0, 26)}`,
          kva,
          stored: stored.toFixed(2),
          tender: tender.toFixed(2),
          diff: (stored - tender).toFixed(2),
          pct: `${(((stored - tender) / tender) * 100).toFixed(1)}%`,
          _abs: Math.abs((stored - tender) / tender),
        });
      });
    });
    return rows;
  };

  const all = [];

  // CRGO ONLY. The Overhauling section is NOT scanned, and that is a correction rather than
  // an omission - the first version of this script scanned it and produced confident false
  // positives that read exactly like typos.
  //
  // SCHEDULE_ITEM_MAP pairs CRGO master codes with Schedule-A sr values. The overhauling
  // master reuses the same short codes for entirely different items, so applying the CRGO
  // map to it compares unrelated things:
  //
  //   OH '3' Tank replacement per kg (54)       vs sr '3' Inside painting of tank (156)
  //   OH '5' Complete radiator replacement      vs sr '5' Oil level gauge glass (46)
  //   OH '6' Sealing of uneconomical unit (189) vs sr '6' Breather (309)
  //
  // Every one of those "overrides" was this script comparing a radiator to a gauge glass.
  // It is the terminology hazard already recorded in AUDIT - an item code means different
  // things in different sections - reproduced by the tool written to find data errors.
  // Scanning a section requires a map for THAT section; one exists for CRGO and no other.
  const pubSnap = await getDoc(doc(db, 'public_config', 'estimate_master'));
  if (pubSnap.exists()) {
    all.push(...scan('public_config', pubSnap.data().estimateMasterCRGO));
  }

  const snap = await getDocs(query(collection(db, 'agencies'), where('ownerId', '==', uid)));
  const agencies = [];
  snap.forEach(d => agencies.push({ id: d.id, ...d.data() }));
  agencies.forEach(a => all.push(...scan(a.name || a.id, a.estimateMasterCRGO)));

  all.sort((x, y) => x._abs - y._abs);
  all.forEach(r => delete r._abs);

  console.log(`\n${all.length} stored cell(s) differ from the tender rate for their band.`);
  console.log('Closest to the tender first - a small percentage is the shape of a mistyped digit.\n');
  console.table(all);

  // the same cell diverging identically everywhere is the signature of a copied slip
  const byCell = {};
  all.forEach(r => { (byCell[`${r.item} @ ${r.kva} kVA -> ${r.stored}`] ||= []).push(r.where); });
  const spread = Object.entries(byCell).filter(([, w]) => w.length > 1);
  if (spread.length) {
    console.log('\nSAME VALUE IN MORE THAN ONE PLACE - a single entry that was copied onward:');
    spread.forEach(([cell, w]) => console.log(`  ${cell}\n      ${w.join(', ')}`));
  }

  // BY CAPACITY COLUMN. Hand entry happens a column at a time, so several near-misses
  // sharing one capacity is the signature of a single editing session rather than of
  // several independent decisions - which is how the 100 kVA column was identified.
  const byKva = {};
  all.forEach(r => { (byKva[r.kva] ||= []).push(r); });
  console.log('\n=== DIFFERENCES BY CAPACITY COLUMN ===');
  console.log('A column carrying several small differences was probably typed in one sitting.');
  Object.entries(byKva)
    .sort((x, y) => Number(x[0]) - Number(y[0]))
    .forEach(([kva, rows]) => {
      const near = rows.filter(r => Math.abs(parseFloat(r.pct)) < 15).length;
      console.log(`  ${String(kva).padStart(4)} kVA : ${String(rows.length).padStart(3)} differing` +
                  (near ? `  (${near} within 15% of the tender - the shape of a mistyped digit)` : ''));
    });

  console.log('\nNothing here is a recommendation. Most differences are deliberate agency rates.');
  console.log('Done. Nothing was written.');
})();
