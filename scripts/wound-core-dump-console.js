// READ-ONLY: exactly what every agency's Wound Core section holds, character by character.
//
// Written to settle a contradiction: a section reported as containing scrap code "0" while
// the scorecard reported scrapCodePresent: false. Those cannot both be true of the same
// stored data, so one of three things is happening -
//
//   1. the row was added on screen but never SAVED, so Firestore does not have it;
//   2. the code is not the character it looks like - a letter "O", a full-width zero, or a
//      trailing non-breaking space all render identically to "0" in most fonts;
//   3. the scorecard ran against a stale fetch.
//
// It therefore prints each item code as a quoted string AND as character codes, so a
// look-alike cannot hide. Reads Firestore directly - not the React context, which
// AgencyContext enriches (AUDIT F30).
//
// It WRITES NOTHING. It reports.
//
// HOW TO RUN: npm run dev, log in, RELOAD the tab (so the read is fresh), paste in console.

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs } = fs;

  const uid = auth?.currentUser?.uid;
  if (!uid) { console.error('Not signed in.'); return; }

  const snap = async (col, ...c) =>
    (await getDocs(query(collection(db, col), ...c))).docs.map(d => ({ id: d.id, ...d.data() }));
  const agencies = await snap('agencies', where('ownerId', '==', uid));

  const KVA = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'];
  const hdr = t => console.log(`\n${'='.repeat(100)}\n${t}\n${'='.repeat(100)}`);

  const charCodes = str => Array.from(String(str)).map(ch => ch.charCodeAt(0)).join(' ');
  const show = v => {
    if (v === undefined) return '--';
    if (v === null) return 'null';
    const n = Number(v);
    if (isNaN(n)) return 'NaN';
    return String(n);
  };
  const usableCount = it =>
    KVA.filter(k => { const v = it?.rates?.[k]; return v !== null && v !== undefined && Number(v) > 0; }).length;

  agencies.forEach(a => {
    const items = a.estimateMasterWoundCore || [];
    hdr(`WOUND CORE - ${a.name || a.id}   ${items.length} item(s)   [stored in Firestore]`);
    if (items.length === 0) { console.log('(empty)'); return; }

    console.log('#   code        charCodes        fixedRate  rates>0  description');
    console.log('-'.repeat(100));
    items.forEach((it, i) => {
      const raw = it.itemCode;
      const asStr = String(raw ?? '');
      console.log(
        String(i + 1).padEnd(4) +
        JSON.stringify(asStr).padEnd(12) +
        charCodes(asStr).padEnd(17) +
        show(it.fixedRate).padEnd(11) +
        String(usableCount(it)).padEnd(9) +
        String(it.itemName ?? '').slice(0, 46)
      );
    });

    // Which rows could serve as the scrap charge, and what each would bill.
    const scrapish = items.filter(it => {
      const name = String(it.itemName ?? '').toLowerCase();
      return name.includes('scrap') || name.includes('dismantl') || name.includes('dismentl');
    });
    console.log('');
    console.log(`Rows whose DESCRIPTION reads as a scrap / dismantling charge: ${scrapish.length}`);
    scrapish.forEach(it => {
      const flat = it.fixedRate;
      const perKva = KVA.filter(k => { const v = it?.rates?.[k]; return v !== null && v !== undefined && Number(v) > 0; })
        .map(k => `${k}=${it.rates[k]}`).join(', ');
      console.log(`   code ${JSON.stringify(String(it.itemCode ?? ''))}  fixedRate=${show(flat)}  perCapacity=[${perKva || 'none'}]`);
      console.log(`        "${String(it.itemName ?? '').slice(0, 80)}"`);
    });

    // The exact test checkMasterSection applies, reproduced here so the verdict and the
    // evidence for it appear together.
    const codes = items.map(it => String(it.itemCode ?? '').trim());
    const hasExactZero = codes.includes('0');
    console.log('');
    console.log(`Codes present (trimmed): ${codes.map(c => JSON.stringify(c)).join(', ')}`);
    console.log(`Contains an EXACT "0" (U+0030): ${hasExactZero}`);
    if (!hasExactZero) {
      const lookalikes = items
        .map(it => String(it.itemCode ?? '').trim())
        .filter(c => c !== '0' && /^[0OoO०０ \s]+$/.test(c));
      if (lookalikes.length) {
        console.log(`LOOK-ALIKE CODES FOUND: ${lookalikes.map(c => `${JSON.stringify(c)} [${charCodes(c)}]`).join(', ')}`);
        console.log('A letter "O" is 79, a digit zero is 48. They are not interchangeable to the resolver.');
      } else {
        console.log('No look-alike either - the "0" row is not in the stored document.');
        console.log('Most likely it was added on screen and the section was never saved.');
      }
    }
    const dupes = codes.filter((c, i) => c && codes.indexOf(c) !== i);
    if (dupes.length) {
      console.log(`DUPLICATE CODES: ${[...new Set(dupes)].map(c => JSON.stringify(c)).join(', ')}`);
      console.log('resolveRate uses .find(), so the FIRST row with a duplicated code wins and');
      console.log('the later one is silently unreachable.');
    }
  });

  hdr('WHICH ROW TO KEEP');
  console.log('The correct scrap row for Wound Core is:');
  console.log('  itemCode  "0"');
  console.log('  itemName  "Rate for inspection & dismantling charges of damaged transformer');
  console.log('             declared scrap by E.E. (TR)"');
  console.log('  fixedRate 500        (flat for every capacity - resolveScrapCharge reads the');
  console.log('                        per-capacity rate first, then falls back to fixedRate)');
  console.log('');
  console.log('A row coded "1" is not a tender code - handleAddItem assigns a new row the code');
  console.log('`length + 1`, so "1" is simply row 1 of what was then an empty section (F32).');

  window.__woundCoreDump = agencies.map(a => ({ agency: a.name || a.id, items: a.estimateMasterWoundCore || [] }));
  console.log('\nFull results: window.__woundCoreDump');
})();
