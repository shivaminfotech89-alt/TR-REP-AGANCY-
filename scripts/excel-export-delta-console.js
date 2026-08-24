// EXCEL EXPORT: WHAT THE OLD ITEM ROWS CHARGED vs WHAT THE JOB ACTUALLY COSTS
//
// READ-ONLY. No set/update/delete/batch anywhere in this file.
//
// Paste into the browser console with the app open and signed in as the agency owner.
//
// WHY THIS SCRIPT EXISTS
// ---------------------
// handleExportExcel used to fill its item rows from calculateJobItemDetails(item, job) -
// called with NO external and NO internal inspection data. Every optional item is gated by
// a test of the shape `x !== 'N' && x !== '0'`, and `undefined` matches neither exclusion,
// so every optional item was charged on every job. The quantity-driven items are worse:
// they fall back to a fixed default when the field is absent (HV bushing 3, LV metal parts
// 4, washer ring 6, HV/LV gaskets 7, HV metal parts 2, LV bushing 1).
//
// The TOTALS rows of the same spreadsheet were already computed by
// buildSingleJobEstimateData with real inspection data. So the sheet never reconciled
// against itself. This script reproduces the old item-row sum - it does NOT depend on the
// deleted code, because a dataless call reduces to a fixed table of quantities times the
// agency's master rates - and prints it beside the job's real Base Repair Cost, which you
// can read off the app for the same jobs.
//
// The reproduction is exact for the 17 items below. Every other CRGO item contributed 0 to
// a dataless call: the coil lines read weights from internalData (absent -> 0), 9B/11B
// default to 0, conservator tank and radiator read damage counts (absent -> 0), and
// Sealed-to-Bolted never fired at all (see AUDIT O23 / F53).

(async () => {
  const { collection, query, where, getDocs } = window.__fs;
  const db = window.__db, uid = window.__auth.currentUser?.uid;
  if (!db || !uid) { console.error('Sign in first - window.__db / __auth not ready.'); return; }

  // qty a DATALESS call produced for each item, straight from the old code paths
  const DATALESS = {
    '1a': 1, '16': 1, '2b': 1, '1e': 1, '5': 1, '6': 1, '3': 1, '1d': 1, '2a': 1,
    '1f': 1, '20': 1, '10': 1, '11A': 4, '15': 6, '1c': 7, '8': 3, '9A': 2,
  };

  const agencies = await getDocs(query(collection(db, 'agencies'), where('ownerId', '==', uid)));
  const rows = [];
  agencies.forEach(a => rows.push({ id: a.id, ...a.data() }));

  for (const ag of rows) {
    // estimateMasterCRGO is the live section. The legacy `estimateMaster` mirror is only a
    // fallback, and is on its way out (AUDIT O26) - reading it first would have made this
    // script depend on a field nothing else reads.
    const master = (ag.estimateMasterCRGO && ag.estimateMasterCRGO.length > 0)
      ? ag.estimateMasterCRGO
      : (ag.estimateMaster || []);
    if (!master.length) { console.log(`${ag.agencyName || ag.id}: no CRGO estimate master, skipped`); continue; }

    const jobsSnap = await getDocs(query(collection(db, 'jobs'), where('agencyId', '==', ag.id)));
    const jobs = [];
    jobsSnap.forEach(j => jobs.push({ id: j.id, ...j.data() }));
    const crgo = jobs.filter(j => !/AMORPH|WOUND|WC|OH|OVERHAUL/i.test(String(j.coreType || 'CRGO'))
                                  && j.status !== 'Scrap' && j.condition !== 'Scrap');

    console.log(`\n=== ${ag.agencyName || ag.id} - ${crgo.length} CRGO non-scrap jobs ===`);
    console.log('Compare "old item-row sum" against the Base Repair Cost the app shows for the same job.');

    // three jobs, spread across capacities so the fallback behaviour is visible
    const byKva = {};
    crgo.forEach(j => { const k = String(j.capacityKva || '25'); (byKva[k] = byKva[k] || []).push(j); });
    const sample = Object.keys(byKva).sort((a, b) => Number(a) - Number(b)).slice(0, 3).map(k => byKva[k][0]);

    for (const job of sample) {
      const kva = String(job.capacityKva || '25').trim();
      let sum = 0; const detail = []; let fellBack = 0;
      for (const [code, qty] of Object.entries(DATALESS)) {
        const item = master.find(m => String(m.itemCode).toLowerCase() === code.toLowerCase());
        if (!item || !item.rates) continue;
        let rate = item.rates[kva], src = 'master';
        if (rate === null || rate === undefined || !(Number(rate) > 0)) {
          // engine 2's last resort: the FIRST non-null rate in ANY capacity column
          const first = Object.entries(item.rates)
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .find(([, v]) => v !== null && v !== undefined && Number(v) > 0);
          if (!first) continue;
          rate = first[1]; src = `from ${first[0]} kVA column`; fellBack++;
        }
        const amt = Number(rate) * qty;
        sum += amt;
        detail.push(`    ${code.padEnd(5)} qty ${String(qty).padEnd(2)} x ${Number(rate).toFixed(2).padStart(9)} = ${amt.toFixed(2).padStart(10)}  ${src === 'master' ? '' : src}`);
      }
      console.log(`\n  JOB ${job.jobNo || job.id}  (${kva} kVA, MR ${job.mrNo || '-'})`);
      detail.forEach(d => console.log(d));
      console.log(`    OLD EXCEL ITEM-ROW SUM (before AT %): Rs ${sum.toFixed(2)}`);
      if (fellBack) console.log(`    ${fellBack} item(s) priced off a DIFFERENT capacity column - the ${kva} kVA cell is blank in this master.`);
      console.log('    Read the app\'s Base Repair Cost for this job and subtract: that difference was in every exported sheet.');
    }
  }
  console.log('\nDone. Nothing was written.');
})();
