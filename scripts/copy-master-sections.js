// COPY the estimate-master sections from one agency to several, byte-identical.
//
// WHY A SCRIPT: there is no "copy from another agency" path in the UI. The only
// cross-source writes are Restore from Global Defaults (reads public_config, not an
// agency), the Amorphous -> Wound Core sync (within one agency), and addAgency's seeding
// (creation only, and no longer from another agency since AUDIT F30).
//
// And the UI cannot do it safely even one agency at a time: saving AARATI's Wound Core
// would store its FALLBACK view, and saving its Amorphous would store twelve normaliser
// rewrites alongside the one row wanted (F27, F34). This writes the SOURCE's stored arrays
// straight onto each target - no normaliser, no merge, no reorder, no default rows.
//
// FIELDS WRITTEN:  estimateMaster (legacy CRGO mirror), estimateMasterCRGO,
//                  estimateMasterAmorphous, estimateMasterWoundCore
// NOT TOUCHED:     estimateMasterOverhauling, estimateMasterCircleLimits, and every
//                  non-master field (name, GSTIN, prefixes, counters, allotments...)
//
// HOW TO RUN
//   1. npm run dev, log in as the OWNER of all these agencies, RELOAD the tab.
//   2. DevTools console, paste this whole file, Enter. Review the dry run.
//   3. Set MODE to 'write', re-paste. Then set it back to 'dry-run' before committing.

const MODE = 'dry-run';                                  // 'dry-run' | 'write'

const SOURCE_AGENCY = 'MEGHA';                           // name CONTAINS this, case-insensitive
const TARGET_AGENCIES = ['AARATI', 'DRISHIV', 'suchit']; // each must match exactly one agency

// Sections copied, with the scrap item code the resolver requires for each. Overhauling is
// deliberately absent: an empty Overhauling section is the correct state (F31).
const SECTIONS = [
  { key: 'CRGO', field: 'estimateMasterCRGO', scrapCode: '22' },
  { key: 'AMORPHOUS', field: 'estimateMasterAmorphous', scrapCode: '0' },
  { key: 'WOUND_CORE', field: 'estimateMasterWoundCore', scrapCode: '0' },
];
const LEGACY_FIELD = 'estimateMaster';   // legacy CRGO mirror, read only when CRGO is empty

// The legacy field is written from the source's estimateMasterCRGO, NOT from the source's
// own legacy field - those two differ on MEGHA despite both holding 32 rows. Copying the
// differing one would put two different CRGO cards on every target: the correct card in
// estimateMasterCRGO and a stale one in estimateMaster, unread today and indistinguishable
// from a current one to whoever finds it later. Set false to copy the source's legacy field
// verbatim instead - only useful if the difference is deliberate, which nothing suggests.
const LEGACY_FROM_CRGO = true;

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs, doc, updateDoc } = fs;
  // Checked BEFORE reading anything, so a missing handle stops the run rather than
  // surfacing partway through a multi-agency write.
  if (MODE === 'write' && !updateDoc) {
    console.error('updateDoc handle missing from window.__fs. Reload the tab; if it persists, add it to the DEV block in src/lib/firebase.ts.');
    return;
  }

  const uid = auth?.currentUser?.uid;
  if (!uid) { console.error('Not signed in.'); return; }

  const { checkMasterSection } = await import('/src/lib/estimateMasterHealth.ts');

  const hdr = t => console.log(`\n${'='.repeat(100)}\n${t}\n${'='.repeat(100)}`);
  const codesOf = list => (list || []).map(it => String(it.itemCode ?? '').trim());

  // Does this ROW read as a scrap / dismantling charge? Name-based, because that is the
  // only thing distinguishing a scrap row from an ordinary one carrying the same code.
  const readsAsScrap = it => {
    const n = String(it.itemName ?? '').toLowerCase();
    return n.includes('scrap') || n.includes('dismantl') || n.includes('dismentl');
  };

  // CORRECTED. A previous version listed any of ['22','0','18','1'] present in a section as
  // a "foreign" scrap code. That was wrong and produced a false alarm: "18" is also the
  // LEGITIMATE CRGO code for "Repl. Of Tank", and "1" is an ordinary item code. Those codes
  // matter only when the ROW ITSELF reads as a scrap charge - the number alone proves
  // nothing. Flagging a correct section as carrying a stray scrap row is the
  // confident-wrong-verdict shape this audit keeps recording, so the test now reads what
  // the row says rather than what it is numbered.
  const scrapState = (list, required) => {
    if (!Array.isArray(list) || list.length === 0) return '(section absent)';
    const codes = codesOf(list);
    const has = codes.includes(required);
    const strays = (list || [])
      .filter(it => readsAsScrap(it) && String(it.itemCode ?? '').trim() !== required)
      .map(it => '"' + String(it.itemCode ?? '').trim() + '"');
    const dupes = [...new Set(codes.filter((c, i) => c && codes.indexOf(c) !== i))];
    return [
      has ? '"' + required + '" PRESENT' : '"' + required + '" MISSING',
      strays.length ? 'STRAY scrap row(s) under ' + [...new Set(strays)].join(',') : null,
      dupes.length ? 'DUPLICATE code(s): ' + dupes.map(c => '"' + c + '"').join(',') : null,
    ].filter(Boolean).join('; ');
  };

  const snap = async (col, ...c) =>
    (await getDocs(query(collection(db, col), ...c))).docs.map(d => ({ id: d.id, ...d.data() }));
  const agencies = await snap('agencies', where('ownerId', '==', uid));
  console.log(`Agencies visible to this account: ${agencies.map(a => a.name).join(', ')}`);

  const pick = (needle, label) => {
    const hits = agencies.filter(a => String(a.name ?? '').toLowerCase().includes(String(needle).toLowerCase()));
    if (hits.length === 0) { console.error(`No ${label} agency matching "${needle}".`); return null; }
    if (hits.length > 1) { console.error(`"${needle}" matches ${hits.length} agencies (${hits.map(a => a.name).join(', ')}). Refusing to guess.`); return null; }
    return hits[0];
  };

  const source = pick(SOURCE_AGENCY, 'SOURCE');
  if (!source) return;
  const targets = TARGET_AGENCIES.map(n => pick(n, 'TARGET'));
  if (targets.some(t => !t)) { console.error('Aborting - resolve the names above.'); return; }
  if (targets.some(t => t.id === source.id)) { console.error('A target is the source agency. Aborting.'); return; }

  // -------------------------------------------------------------- source must be clean
  hdr(`SOURCE: ${source.name}`);
  console.log('(If this section scrolled off, the same facts are on window.__copyMaster.source*)');
  let blocked = false;
  SECTIONS.forEach(({ key, field, scrapCode }) => {
    const list = source[field];
    const h = checkMasterSection(key, list);
    const clean = Array.isArray(list) && list.length > 0 && h.problems.length === 0;
    if (!clean) {
      blocked = true;
      console.error(`REFUSING ${key}: the source section is not clean.`);
      (h.problems.length ? h.problems : ['section is empty or absent']).forEach(p => console.error(`     ${p}`));
    }
    console.log(`  ${key.padEnd(11)} ${String(Array.isArray(list) ? list.length : 0).padStart(3)} row(s)   ${scrapState(list, scrapCode)}`);
  });

  // The legacy mirror is copied as instructed, but if it disagrees with the source's own
  // CRGO section that disagreement is about to be propagated to three more agencies.
  const legacySrc = LEGACY_FROM_CRGO ? source.estimateMasterCRGO : source[LEGACY_FIELD];
  const legacyStored = source[LEGACY_FIELD];
  const legacyMatchesCrgo = JSON.stringify(legacyStored ?? null) === JSON.stringify(source.estimateMasterCRGO ?? null);
  console.log(`  ${LEGACY_FIELD.padEnd(11)} ${String(Array.isArray(legacySrc) ? legacySrc.length : 0).padStart(3)} row(s)   ${legacyMatchesCrgo ? 'identical to estimateMasterCRGO' : '*** DIFFERS from estimateMasterCRGO ***'}`);
  if (!legacyMatchesCrgo) {
    console.warn('  NOTE: ' + source.name + " stored legacy estimateMaster DIFFERS from its estimateMasterCRGO.");
    console.warn('  LEGACY_FROM_CRGO is ' + LEGACY_FROM_CRGO + ', so the legacy field will be written from');
    console.warn('  ' + (LEGACY_FROM_CRGO
      ? 'estimateMasterCRGO - both fields end up holding the same correct card.'
      : "the source's own differing legacy field - two different cards per target."));

    // Where they differ, item by item, so the choice rests on evidence rather than counts.
    const crgo = source.estimateMasterCRGO || [];
    const leg = legacyStored || [];
    const byCode = arr => Object.fromEntries(arr.map(it => [String(it.itemCode ?? '').trim(), it]));
    const c1 = byCode(crgo), c2 = byCode(leg);
    const allCodes = [...new Set([...Object.keys(c1), ...Object.keys(c2)])];
    const diffs = [];
    allCodes.forEach(code => {
      const x = c1[code], y = c2[code];
      if (!x) { diffs.push({ code, difference: 'only in legacy estimateMaster', crgo: '(absent)', legacy: String(y.itemName ?? '').slice(0, 38) }); return; }
      if (!y) { diffs.push({ code, difference: 'only in estimateMasterCRGO', crgo: String(x.itemName ?? '').slice(0, 38), legacy: '(absent)' }); return; }
      if (String(x.itemName ?? '') !== String(y.itemName ?? '')) {
        diffs.push({ code, difference: 'description', crgo: String(x.itemName ?? '').slice(0, 38), legacy: String(y.itemName ?? '').slice(0, 38) });
      }
      const rx = JSON.stringify(x.rates ?? null), ry = JSON.stringify(y.rates ?? null);
      if (rx !== ry) diffs.push({ code, difference: 'RATES', crgo: rx.slice(0, 58), legacy: ry.slice(0, 58) });
      if (JSON.stringify(x.fixedRate ?? null) !== JSON.stringify(y.fixedRate ?? null)) {
        diffs.push({ code, difference: 'fixedRate', crgo: String(x.fixedRate ?? ''), legacy: String(y.fixedRate ?? '') });
      }
    });
    console.log('  ' + diffs.length + ' difference(s) between the two CRGO copies:');
    if (diffs.length) console.table(diffs);
    window.__legacyDiff = diffs;
  }
  if (blocked) { console.error('\nAborting - fix the source first. Nothing was written.'); return; }

  // -------------------------------------------------------------- per target, before/after
  const payload = { [LEGACY_FIELD]: legacySrc };
  SECTIONS.forEach(({ field }) => { payload[field] = source[field]; });

  const rows = [];
  targets.forEach(t => {
    SECTIONS.forEach(({ key, field, scrapCode }) => {
      const before = t[field];
      const after = source[field];
      // Codes gained and lost are stored on the row, not only logged: a console block
      // scrolls away, and this is the detail that distinguishes a section that was
      // already correct from one that was not.
      const beforeCodes = codesOf(before).filter(Boolean);
      const afterCodes = codesOf(after).filter(Boolean);
      rows.push({
        agency: t.name,
        section: key,
        itemsBefore: Array.isArray(before) ? before.length : 0,
        itemsAfter: after.length,
        scrapBefore: scrapState(before, scrapCode),
        scrapAfter: scrapState(after, scrapCode),
        codesRemoved: beforeCodes.filter(c => !afterCodes.includes(c)).join(',') || 'none',
        codesAdded: afterCodes.filter(c => !beforeCodes.includes(c)).join(',') || 'none',
        unchanged: JSON.stringify(before ?? null) === JSON.stringify(after ?? null),
      });
    });
    const lb = t[LEGACY_FIELD];
    rows.push({
      agency: t.name,
      section: `${LEGACY_FIELD} (legacy)`,
      itemsBefore: Array.isArray(lb) ? lb.length : 0,
      itemsAfter: Array.isArray(legacySrc) ? legacySrc.length : 0,
      scrapBefore: scrapState(lb, '22'),
      scrapAfter: scrapState(legacySrc, '22'),
      unchanged: JSON.stringify(lb ?? null) === JSON.stringify(legacySrc ?? null),
    });
  });

  hdr('PER TARGET, PER SECTION - what each one gains and loses');
  console.table(rows);
  // Printed again per agency, because a 10-row table scrolls and the top of a long paste
  // is the first thing lost.
  targets.forEach(t => {
    console.log(`
${t.name}:`);
    rows.filter(r => r.agency === t.name).forEach(r =>
      console.log(`  ${String(r.section).padEnd(22)} ${String(r.itemsBefore).padStart(3)} -> ${String(r.itemsAfter).padStart(3)} rows   removed: ${r.codesRemoved}   added: ${r.codesAdded}`));
  });

  hdr('WHAT EACH TARGET LOSES');
  targets.forEach(t => {
    console.log(`\n${t.name}:`);
    SECTIONS.forEach(({ key, field }) => {
      const before = t[field];
      const beforeCodes = codesOf(before);
      const afterCodes = codesOf(source[field]);
      const lost = beforeCodes.filter(c => c && !afterCodes.includes(c));
      const gained = afterCodes.filter(c => c && !beforeCodes.includes(c));
      console.log(`  ${key.padEnd(11)} codes removed: ${lost.length ? lost.map(c => `"${c}"`).join(', ') : 'none'}`);
      console.log(`  ${''.padEnd(11)} codes added  : ${gained.length ? gained.map(c => `"${c}"`).join(', ') : 'none'}`);
      if (Array.isArray(before) && before.length > 0) {
        console.log(`  ${''.padEnd(11)} ALL ${before.length} existing row(s) are replaced, including any rates typed into them.`);
      }
    });
  });

  hdr('FIELDS WRITTEN ON EACH TARGET');
  Object.keys(payload).forEach(f => console.log(`  ${f}  (${(payload[f] || []).length} row(s))`));
  console.log('');
  console.log('NOT touched: estimateMasterOverhauling, estimateMasterCircleLimits, and every');
  console.log('non-master field on the agency document.');

  if (MODE !== 'write') {
    hdr('DRY RUN - NOTHING WAS WRITTEN');
    console.log(`Would write ${Object.keys(payload).length} field(s) on each of ${targets.length} agencies: ${targets.map(t => t.name).join(', ')}.`);
    console.log("To apply: set MODE to 'write' at the top and re-paste.");
    window.__copyMaster = {
      source: source.name, targets: targets.map(t => t.name), payload, rows,
      // Stored so the source header does not have to be read off a scrolled console.
      sourceLegacyMatchesCrgo: legacyMatchesCrgo,
      sourceSectionCounts: Object.fromEntries(
        [...SECTIONS.map(s2 => [s2.key, (source[s2.field] || []).length]), [LEGACY_FIELD, (legacySrc || []).length]]
      ),
    };
    console.log('Full results: window.__copyMaster');
    return;
  }

  hdr(`WRITING to ${targets.length} agencies`);
  for (const t of targets) {
    await updateDoc(doc(db, 'agencies', t.id), payload);   // awaited - one agency at a time
    console.log(`  ${t.name}: written`);
  }
  console.log(`\nDONE. ${targets.length} agencies now hold ${source.name}'s CRGO, Amorphous and Wound Core sections verbatim.`);
  console.log('Reload the tab and re-run master-section-scorecard-console.js to verify from');
  console.log('Firestore rather than from the screen.');
  window.__copyMaster = { source: source.name, targets: targets.map(t => t.name), payload, rows, written: true };
})();
