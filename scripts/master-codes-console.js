// READ-ONLY: what item codes does the ACTIVE agency's saved estimate master hold,
// and which standard items are missing from it?
//
// The saved array shadows the local defaults: getEstimateMasterForCore returns the
// agency's array whenever it is non-empty, WITHOUT merging in any default item the
// array lacks. So a partial saved master silently hides standard items from billing.
//
// HOW TO RUN: npm run dev, log in, select the agency, reload the tab, paste in console.

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs } = fs;

  const uid = auth?.currentUser?.uid;
  if (!uid) { console.error('Not signed in.'); return; }
  const agencyId = localStorage.getItem('activeAgencyId');
  if (!agencyId) { console.error('No active agency selected.'); return; }

  const defaults = await import('/src/lib/estimateData.ts');
  const { getScrapItemCodeForCore } = await import('/src/lib/estimateCalc.ts');

  const agency = (await getDocs(query(collection(db, 'agencies'), where('ownerId', '==', uid))))
    .docs.map(d => ({ id: d.id, ...d.data() })).find(a => a.id === agencyId);
  if (!agency) { console.error('Active agency not found.'); return; }

  const sections = [
    ['CRGO',       'estimateMaster',            defaults.defaultEstimateData,           getScrapItemCodeForCore('CRGO')],
    ['CRGO (alt)', 'estimateMasterCRGO',        defaults.defaultEstimateData,           getScrapItemCodeForCore('CRGO')],
    ['AMORPHOUS',  'estimateMasterAmorphous',   defaults.defaultAmorphousEstimateData,  getScrapItemCodeForCore('AMORPHOUS')],
    ['WOUND_CORE', 'estimateMasterWoundCore',   defaults.defaultWoundCoreEstimateData,  getScrapItemCodeForCore('WOUND CORE')],
  ];

  const codesOf = arr => (arr || []).map(i => String(i.itemCode ?? '').trim());

  console.log(`\n=== ESTIMATE MASTER CODES - agency ${agency.name || agencyId} ===`);
  const summary = [];
  sections.forEach(([label, field, defaultArr, scrapCode]) => {
    const saved = agency[field];
    const savedCodes = codesOf(saved);
    const defaultCodes = codesOf(defaultArr);
    const missing = defaultCodes.filter(c => !savedCodes.includes(c));
    const extra = savedCodes.filter(c => !defaultCodes.includes(c));

    summary.push({
      section: label,
      field,
      savedExists: Array.isArray(saved),
      savedItemCount: saved ? saved.length : '(field absent)',
      defaultItemCount: defaultArr.length,
      scrapCodeExpected: scrapCode ?? '(none mapped)',
      scrapCodePresent: scrapCode ? savedCodes.includes(scrapCode) : 'n/a',
      missingStandardCodes: missing.join(', ') || '(none)',
      userAddedCodes: extra.join(', ') || '(none)',
    });

    if (scrapCode && saved && !savedCodes.includes(scrapCode)) {
      const defItem = defaultArr.find(i => String(i.itemCode).trim() === scrapCode);
      console.log(`\n!! ${label}: scrap code "${scrapCode}" MISSING from saved master (${saved.length} items).`);
      console.log(`   Default item that should be there:`, defItem);
    }
  });
  console.table(summary);

  // Full saved contents, so the actual rows can be eyeballed.
  sections.forEach(([label, field]) => {
    const saved = agency[field];
    if (!Array.isArray(saved)) return;
    console.log(`\n--- ${label} (${field}) - ${saved.length} saved items ---`);
    console.table(saved.map(i => ({
      itemCode: i.itemCode, itemName: i.itemName, unit: i.unit,
      fixedRate: i.fixedRate ?? '', rate25: i.rates?.['25'] ?? '', rate63: i.rates?.['63'] ?? '',
    })));
  });

  window.__masterCodes = { agency, summary };
  console.log('\nFull results: window.__masterCodes');
})();
