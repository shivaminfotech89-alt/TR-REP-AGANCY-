// READ-ONLY: every Amorphous item, everywhere, with every rate.
//
// Answers three things the summary comparisons could not:
//   (a)/(b) do the corrupted sections carry RATES against their shifted labels, or are they
//           blank? A blank corrupted section was never usable and this is a cleanup. Rates
//           against shifted labels would be a mispricing exposure.
//   (d)     does public_config's Amorphous carry the corrupted descriptions or the correct
//           ones? Code overlap was compared in an earlier run; DESCRIPTIONS were not, and a
//           section can hold the right codes under wrong text - which prints wrong on a
//           UGVCL document while every code-based check passes.
//
// It distinguishes null from 0 deliberately. Both are unusable to resolveRate, which
// requires > 0, but they mean different things: null is "never set", 0 is "set to zero".
//
// It WRITES NOTHING. It reports.
//
// HOW TO RUN: npm run dev, log in, reload the tab, paste into the DevTools console.

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs, doc, getDoc } = fs;

  const uid = auth?.currentUser?.uid;
  if (!uid) { console.error('Not signed in.'); return; }

  const { defaultAmorphousEstimateData } = await import('/src/lib/estimateData.ts');

  const snap = async (col, ...c) =>
    (await getDocs(query(collection(db, col), ...c))).docs.map(d => ({ id: d.id, ...d.data() }));
  const agencies = await snap('agencies', where('ownerId', '==', uid));

  let pub = null;
  try {
    const ps = await getDoc(doc(db, 'public_config', 'estimate_master'));
    pub = ps.exists() ? ps.data() : null;
  } catch (e) { console.warn('public_config unreadable:', e?.message || e); pub = undefined; }

  const hdr = t => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
  const KVA = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'];

  const cell = v => (v === null || v === undefined) ? '' : (Number(v) === 0 ? '0' : String(v));
  const usableRates = it => KVA.filter(k => {
    const v = it?.rates?.[k];
    return v !== null && v !== undefined && !isNaN(Number(v)) && Number(v) > 0;
  }).length;
  const zeroRates = it => KVA.filter(k => {
    const v = it?.rates?.[k];
    return v !== null && v !== undefined && Number(v) === 0;
  }).length;

  const sources = [
    { name: 'SHIPPED DEFAULT', items: defaultAmorphousEstimateData },
    ...(pub ? [{ name: 'public_config', items: pub.estimateMasterAmorphous || [] }] : []),
    ...agencies.map(a => ({ name: a.name || a.id, items: a.estimateMasterAmorphous || [] })),
  ];

  // ---- (a)/(b): full dump, one table per source -------------------------------------
  sources.forEach(src => {
    hdr(`AMORPHOUS - ${src.name}  (${src.items.length} item(s))`);
    if (src.items.length === 0) { console.log('(empty)'); return; }
    console.table(src.items.map(it => {
      const row = {
        itemCode: it.itemCode,
        description: String(it.itemName ?? '').slice(0, 58),
        unit: it.unit || '',
        fixedRate: it.fixedRate === undefined ? '' : cell(it.fixedRate),
      };
      KVA.forEach(k => { row[k] = cell(it.rates?.[k]); });
      row.usable = usableRates(it);
      row.explicitZeros = zeroRates(it);
      return row;
    }));
    const totalUsable = src.items.reduce((n, it) => n + usableRates(it), 0);
    console.log(`Rates greater than zero anywhere in this section: ${totalUsable}`);
    if (totalUsable === 0) {
      console.log('-> NOTHING in this section could ever have priced anything. resolveRate');
      console.log('   requires a rate > 0 and otherwise falls through to UGVCL Schedule-A,');
      console.log('   so every Amorphous line came from Schedule-A regardless of these labels.');
    } else {
      console.log('-> SOME rates are live. If the descriptions are also shifted, those rates');
      console.log('   priced under the wrong capacity label. This needs its own audit entry.');
    }
  });

  // ---- (d) + description comparison for every source --------------------------------
  const defMap = {};
  defaultAmorphousEstimateData.forEach(it => { defMap[String(it.itemCode ?? '').trim()] = it; });

  hdr('DESCRIPTION COMPARISON vs the shipped default - ALL sources including public_config');
  const rows = [];
  sources.filter(s => s.name !== 'SHIPPED DEFAULT').forEach(src => {
    let exact = 0, caseOnly = 0, different = 0, unknownCode = 0;
    src.items.forEach(it => {
      const code = String(it.itemCode ?? '').trim();
      const d = defMap[code];
      const a = String(it.itemName ?? '').trim();
      if (!d) { unknownCode++; return; }
      const b = String(d.itemName ?? '').trim();
      if (a === b) exact++;
      else if (a.toLowerCase() === b.toLowerCase()) caseOnly++;
      else { different++; rows.push({ source: src.name, itemCode: code, stored: a.slice(0, 46), shippedDefault: b.slice(0, 46) }); }
    });
    console.log(`  ${src.name}: ${exact} exact, ${caseOnly} case-only, ${different} DIFFERENT, ${unknownCode} code(s) not in the default`);
  });
  if (rows.length) {
    console.log('');
    console.table(rows);
  } else {
    console.log('  (no substantive description differences anywhere)');
  }

  // ---- the placeholder fingerprint --------------------------------------------------
  // The original defaultAmorphousEstimateData (commit 1f1e735) was a 10-item PLACEHOLDER:
  // codes 1a,1b,1c,1d,1e,2,3,4,5,6 with all rates null except four zeros. Its item code
  // "1d" does not exist in the real Schedule-B default, which uses "1d-1" and "1d-2" - so
  // the presence of a bare "1d" identifies a section seeded from the placeholder, with no
  // reliance on description text at all.
  hdr('PLACEHOLDER FINGERPRINT - a bare item code "1d" (the real default uses 1d-1 / 1d-2)');
  console.table(sources.map(s => ({
    source: s.name,
    items: s.items.length,
    hasBare1d: s.items.some(it => String(it.itemCode ?? '').trim() === '1d'),
    has1d1or1d2: s.items.some(it => ['1d-1', '1d-2'].includes(String(it.itemCode ?? '').trim())),
    hasScrapCode0: s.items.some(it => String(it.itemCode ?? '').trim() === '0'),
    verdict: s.items.some(it => String(it.itemCode ?? '').trim() === '1d')
      ? 'SEEDED FROM THE 10-ITEM PLACEHOLDER'
      : (s.items.length === 0 ? 'empty' : 'derived from the real Schedule-B default'),
  })));

  window.__amorphousDump = { sources, descriptionDiffs: rows, publicConfig: pub };
  console.log('\nFull results: window.__amorphousDump');
})();
