// READ-ONLY: compare every agency's Amorphous section against every other and against the
// shipped default, item code by item code.
//
// The question it answers: to repair MEGHA's Amorphous, is a "Reset to Default" enough, or
// must AARATI's content be copied in? Those differ if AARATI carries items or rates the
// shipped default does not - and a reset would then silently lose them.
//
// It WRITES NOTHING. It reports.
//
// HOW TO RUN: npm run dev, log in, reload the tab, paste into the DevTools console.

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs } = fs;

  const uid = auth?.currentUser?.uid;
  if (!uid) { console.error('Not signed in.'); return; }

  const { defaultAmorphousEstimateData } = await import('/src/lib/estimateData.ts');

  const snap = async (col, ...c) =>
    (await getDocs(query(collection(db, col), ...c))).docs.map(d => ({ id: d.id, ...d.data() }));
  const agencies = await snap('agencies', where('ownerId', '==', uid));

  const hdr = t => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
  const KVA = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'];

  const index = list => {
    const m = {};
    (list || []).forEach(it => { m[String(it.itemCode ?? '').trim()] = it; });
    return m;
  };
  const rateCount = it =>
    KVA.filter(k => it?.rates && it.rates[k] !== null && it.rates[k] !== undefined && Number(it.rates[k]) > 0).length;

  const sources = [
    { name: 'SHIPPED DEFAULT', items: defaultAmorphousEstimateData },
    ...agencies.map(a => ({ name: a.name || a.id, items: a.estimateMasterAmorphous || [] })),
  ];

  hdr('AMORPHOUS SECTION - size and how much of it carries real rates');
  console.table(sources.map(s => ({
    source: s.name,
    items: s.items.length,
    itemsWithAnyRate: s.items.filter(it => rateCount(it) > 0).length,
    itemsAllBlank: s.items.filter(it => rateCount(it) === 0).length,
    hasScrapCode0: s.items.some(it => String(it.itemCode ?? '').trim() === '0'),
    codes: s.items.map(it => it.itemCode).join(', '),
  })));

  // Union of every code seen anywhere, so a code present in one source and absent in
  // another shows as a gap rather than silently not appearing.
  const allCodes = [];
  sources.forEach(s => s.items.forEach(it => {
    const c = String(it.itemCode ?? '').trim();
    if (c && !allCodes.includes(c)) allCodes.push(c);
  }));

  hdr('ITEM BY ITEM - presence and rate count per source');
  const idx = sources.map(s => ({ name: s.name, map: index(s.items) }));
  console.table(allCodes.map(code => {
    const row = { itemCode: code };
    idx.forEach(s => {
      const it = s.map[code];
      row[s.name] = !it ? 'ABSENT' : (rateCount(it) === 0 ? 'present, no rates' : `${rateCount(it)} rate(s)`);
    });
    const ref = idx.find(s => s.name === 'SHIPPED DEFAULT')?.map[code];
    row.description = String((ref || idx.map(s => s.map[code]).find(Boolean))?.itemName ?? '').slice(0, 60);
    return row;
  }));

  // Names matter as much as codes: a section can carry the right codes under wrong
  // descriptions, which prints wrong on a UGVCL document while every check passes.
  hdr('DESCRIPTION MISMATCHES vs the shipped default');
  const defMap = index(defaultAmorphousEstimateData);
  const mismatches = [];
  idx.filter(s => s.name !== 'SHIPPED DEFAULT').forEach(s => {
    Object.entries(s.map).forEach(([code, it]) => {
      const d = defMap[code];
      if (!d) return;
      const a = String(it.itemName ?? '').trim();
      const b = String(d.itemName ?? '').trim();
      if (a !== b) mismatches.push({ source: s.name, itemCode: code, stored: a.slice(0, 50), shippedDefault: b.slice(0, 50) });
    });
  });
  if (mismatches.length) console.table(mismatches);
  else console.log('(none) - every shared item code carries the shipped description.');

  hdr('WHAT THIS DECIDES');
  console.log('If a source has codes or rates the SHIPPED DEFAULT lacks, "Reset to Default"');
  console.log('would LOSE them - copy that content instead. If it is a strict subset of the');
  console.log('default with no extra rates, a reset restores it and is the smaller action.');
  console.log('');
  console.log('Note the scrap row: item code "0" is the FIRST item of the shipped default');
  console.log('("Rate for inspection & dismantling charges ... declared scrap"). A section');
  console.log('with 12 items and no "0" is the 13-item default with exactly that row removed -');
  console.log('which is the row resolveScrapCharge needs to bill an Amorphous scrap unit.');

  window.__amorphousDiff = { sources, allCodes, mismatches };
  console.log('\nFull results: window.__amorphousDiff');
})();
