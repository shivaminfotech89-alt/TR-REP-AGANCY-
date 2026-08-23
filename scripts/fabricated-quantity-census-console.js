// READ-ONLY: how many ISSUED estimates and bills carry a line whose QUANTITY was invented
// by the app rather than recorded by an inspector?
//
// The estimate builder falls back to a hardcoded quantity whenever an inspection field is
// blank. Those constants are in no schedule, no master and no tender document - they exist
// only in SingleJobEstimateReport.tsx. Where one fired, the printed line shows a quantity
// nobody measured, and the document went to UGVCL saying otherwise.
//
// The re-insulation one is the worst of them because it fires on the "nothing wrong" path:
// with every LV coil marked OK, totWtLv is 0 and item 14 is charged at a per-capacity
// constant - so a job with no LV work recorded is billed MORE than one with real damage.
//
// It WRITES NOTHING. It reports.
//
// HOW TO RUN: npm run dev, sign in, reload the tab, paste into the DevTools console.

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs } = fs;

  const user = auth?.currentUser;
  if (!user) { console.error('Not signed in.'); return; }

  const hdr = t => console.log(`\n${'='.repeat(100)}\n${t}\n${'='.repeat(100)}`);
  const snap = async (col, ...c) =>
    (await getDocs(query(collection(db, col), ...c))).docs.map(d => ({ id: d.id, ...d.data() }));

  const [agencies, jobs, inspections] = await Promise.all([
    snap('agencies', where('ownerId', '==', user.uid)),
    snap('jobs', where('ownerId', '==', user.uid)),
    snap('inspections', where('ownerId', '==', user.uid)),
  ]);
  const agencyName = id => agencies.find(a => a.id === id)?.name || id || '(none)';

  const intByJob = {}, extByJob = {};
  inspections.forEach(i => {
    if (!i.jobId) return;
    if ((i.type || '') === 'Internal') intByJob[i.jobId] = i.data || {};
    if ((i.type || '') === 'External') extByJob[i.jobId] = i.data || {};
  });

  // The fallbacks, transcribed from SingleJobEstimateReport. Each says which field being
  // BLANK triggers it, so a hit names the missing measurement rather than just the line.
  const blank = v => v === undefined || v === null || String(v).trim() === '';
  const perKva = (kva, map, dflt) => (map[String(Number(kva))] !== undefined ? map[String(Number(kva))] : dflt);

  const FALLBACKS = [
    { item: '14',  label: 'Re-insulation LV coil', src: 'internal',
      fires: (int) => !blankRecord(int) && Number(int.totWtLv || 0) === 0,
      qty: (kva) => perKva(kva, { '63': 24.30, '25': 15.54, '100': 35.00 }, 12.00),
      field: 'totWtLv (all LV coils OK / untouched)' },
    { item: '12A', label: 'HV coil', src: 'internal',
      fires: (int) => !blankRecord(int) && Number(int.totWt || 0) === 0,
      qty: (kva) => perKva(kva, { '63': 47.00, '25': 15.54, '100': 55.00 }, 14.00),
      field: 'totWt (no HV coil weight)' },
    { item: '9',   label: 'HV/LV rod', src: 'external', fires: (e) => blank(e.hvLvRod), qty: () => 7,  field: 'hvLvRod' },
    { item: 'gask',label: 'Gasket set', src: 'external', fires: (e) => blank(e.gasket),
      qty: (kva) => (Number(kva) >= 63 ? 3 : 1), field: 'gasket' },
    { item: '9a',  label: 'HV bushing', src: 'external', fires: (e) => blank(e.hvSideHvb), qty: () => 3, field: 'hvSideHvb' },
    { item: '9b',  label: 'HV metal part', src: 'external', fires: (e) => blank(e.hvSideHvm), qty: () => 2, field: 'hvSideHvm' },
    { item: '11a', label: 'LV bushing', src: 'external', fires: (e) => blank(e.lvSideLvb), qty: () => 1, field: 'lvSideLvb' },
    { item: '11b', label: 'LV metal part', src: 'external', fires: (e) => blank(e.lvSideLvm), qty: () => 4, field: 'lvSideLvm' },
    { item: '15',  label: 'Washer ring', src: 'internal', fires: (i) => blank(i.wasring), qty: () => 6, field: 'wasring' },
  ];
  const blankRecord = r => !r || Object.keys(r).length === 0;

  const issued = jobs.filter(j =>
    String(j.estimateSentDate ?? '').trim() || String(j.billNo ?? '').trim() || String(j.billSentDate ?? '').trim());

  const rows = [];
  issued.forEach(j => {
    const core = String(j.coreType || 'CRGO').toUpperCase();
    // Amorphous / Wound Core price from Schedule-B and never reach these lines.
    if (core.includes('AM') || core.includes('WOUND') || core.includes('WC')) return;
    const int = intByJob[j.id], ext = extByJob[j.id];
    FALLBACKS.forEach(f => {
      const src = f.src === 'internal' ? int : ext;
      if (f.src === 'internal' && blankRecord(int)) return;   // no record - blocked, not defaulted
      if (f.src === 'external' && blankRecord(ext)) return;
      if (!f.fires(src || {})) return;
      rows.push({
        jobNo: j.jobNo, agency: agencyName(j.agencyId), kva: j.capacityKva, coreType: j.coreType || 'CRGO',
        item: f.item, line: f.label, inventedQty: f.qty(j.capacityKva), missingField: f.field,
        estimateSent: j.estimateSentDate || '', billNo: j.billNo || '', billSent: j.billSentDate || '',
      });
    });
  });

  hdr(`ISSUED DOCUMENTS CARRYING AN INVENTED QUANTITY - ${rows.length} line(s) across ${new Set(rows.map(r => r.jobNo)).size} job(s)`);
  if (rows.length === 0) console.log('(none)');
  else console.table(rows);

  const reIns = rows.filter(r => r.item === '14');
  hdr('BY LINE');
  const byItem = {};
  rows.forEach(r => { (byItem[`${r.item} ${r.line}`] ||= { line: `${r.item} ${r.line}`, jobs: new Set(), missing: r.missingField }); byItem[`${r.item} ${r.line}`].jobs.add(r.jobNo); });
  console.table(Object.values(byItem).map(v => ({ line: v.line, jobs: v.jobs.size, firesWhenBlank: v.missing })));

  hdr('THE ONE THAT INFLATES');
  console.log(`Re-insulation (item 14) on issued documents: ${new Set(reIns.map(r => r.jobNo)).size} job(s).`);
  console.log('');
  console.log('It fires when every LV coil is marked OK - so it is charged on jobs where NO LV');
  console.log('work was recorded, at a per-capacity constant, and is LARGER than the real');
  console.log('replacement figure for any coil under ~18.75 kg. Recording actual damage');
  console.log('reduces the estimate; recording nothing raises it.');
  console.log('');
  console.log('Every quantity in the table is a stand-in with no source - not Schedule-A,');
  console.log('not Schedule-B, not any master. Compare each against the printed document');
  console.log('before deciding anything: the paper is what UGVCL holds.');

  // ---- What changes when the RI/DAM split ships ----
  // Every job with an RI or DAM coil was estimated as though the LV side were untouched:
  // the 'DMG' comparison never matched the form's 'DAM', so the observation fell through
  // and the per-capacity constant was charged instead.
  const lvMarked = jobs.filter(j => {
    const int = intByJob[j.id];
    if (!int) return false;
    return [int.lvCoilR, int.lvCoilY, int.lvCoilB].some(v => v === 'RI' || v === 'DAM');
  });
  const lvRi = lvMarked.filter(j => {
    const int = intByJob[j.id];
    return [int.lvCoilR, int.lvCoilY, int.lvCoilB].some(v => v === 'RI');
  });
  const lvNoWeight = lvMarked.filter(j => !(Number(intByJob[j.id].wtOfCoilLv) > 0));

  hdr('WHAT CHANGES WHEN THE RI/DAM SPLIT SHIPS');
  console.log(`Jobs with any LV coil marked RI or DAM : ${lvMarked.length}`);
  console.log(`  of those, at least one RI            : ${lvRi.length}   <- were billed at 149/kg, should be 115/kg`);
  console.log(`  of those, no wtOfCoilLv recorded     : ${lvNoWeight.length}   <- will now BLOCK with a named error`);
  console.log(`  already issued (estimate or bill)    : ${lvMarked.filter(j => j.estimateSentDate || j.billNo || j.billSentDate).length}`);
  if (lvMarked.length) {
    console.log('');
    console.table(lvMarked.map(j => {
      const int = intByJob[j.id];
      const st = [int.lvCoilR, int.lvCoilY, int.lvCoilB];
      return {
        jobNo: j.jobNo, agency: agencyName(j.agencyId), kva: j.capacityKva,
        lvCoils: st.join('/'),
        dam: st.filter(v => v === 'DAM').length,
        ri: st.filter(v => v === 'RI').length,
        wtOfCoilLv: int.wtOfCoilLv || '(blank)',
        issued: Boolean(j.estimateSentDate || j.billNo || j.billSentDate),
      };
    }));
  }

  window.__fabricatedQty = { rows, reIns, issuedCount: issued.length, lvMarked, lvRi, lvNoWeight };
  console.log('\nFull results: window.__fabricatedQty');
})();
