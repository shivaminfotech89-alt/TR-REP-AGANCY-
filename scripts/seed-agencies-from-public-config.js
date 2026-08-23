// COPY the corrected shared default into named agency documents, by ID.
//
// SOURCE: public_config/estimate_master. Deliberately not another agency - public_config is
// readable by any signed-in user (firestore.rules: `allow get, list: if isSignedIn() ||
// true`), so this sidesteps the ownership problem that blocks agency-to-agency copying
// across accounts (AUDIT O12, F36).
//
// TARGETS: resolved by DOCUMENT ID, never by name. Agency names are not unique across
// owners - two agencies named "suchit" exist under two accounts, and a repair was once
// verified against the wrong one because of it (F36). Ids cannot be ambiguous.
//
// FIELDS WRITTEN:  estimateMasterCRGO, estimateMasterAmorphous, estimateMasterWoundCore,
//                  and estimateMaster (legacy CRGO mirror) sourced from CRGO - not from
//                  public_config's own legacy field, which may differ.
// NOT TOUCHED:     estimateMasterOverhauling (empty is correct - F31),
//                  estimateMasterCircleLimits, and every non-master field.
//
// HOW TO RUN
//   1. npm run dev, sign in as the OWNER of the target agencies, RELOAD the tab.
//   2. DevTools console, paste this whole file, Enter. Review the dry run.
//   3. Set MODE to 'write', re-paste. Then set it back to 'dry-run' before committing.

const MODE =  'dry-run';        // 'dry-run' | 'write'

const TARGET_AGENCY_IDS = [
  '9REEEUHthjCNs4sYVEmm',      // SUCHIT
  'sqGhsXqIDiMIJqjSmn8m',      // UPENDRA
];

const SECTIONS = [
  { key: 'CRGO', field: 'estimateMasterCRGO', scrapCode: '22' },
  { key: 'AMORPHOUS', field: 'estimateMasterAmorphous', scrapCode: '0' },
  { key: 'WOUND_CORE', field: 'estimateMasterWoundCore', scrapCode: '0' },
];

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { doc, getDoc, updateDoc } = fs;
  // Handles verified before any read, so a missing one stops the run rather than surfacing
  // between the first agency write and the second.
  if (MODE === 'write' && !updateDoc) {
    console.error('updateDoc handle missing from window.__fs. Reload the tab; if it persists, add it to the DEV block in src/lib/firebase.ts.');
    return;
  }

  const user = auth?.currentUser;
  if (!user) { console.error('Not signed in.'); return; }

  const { checkMasterSection } = await import('/src/lib/estimateMasterHealth.ts');

  const hdr = t => console.log(`\n${'='.repeat(96)}\n${t}\n${'='.repeat(96)}`);
  const codesOf = list => (list || []).map(it => String(it.itemCode ?? '').trim());
  const readsAsScrap = it => {
    const n = String(it.itemName ?? '').toLowerCase();
    return n.includes('scrap') || n.includes('dismantl') || n.includes('dismentl');
  };
  const scrapState = (list, required) => {
    if (!Array.isArray(list) || list.length === 0) return '(absent)';
    const codes = codesOf(list);
    const strays = (list || [])
      .filter(it => readsAsScrap(it) && String(it.itemCode ?? '').trim() !== required)
      .map(it => '"' + String(it.itemCode ?? '').trim() + '"');
    const dupes = [...new Set(codes.filter((c, i) => c && codes.indexOf(c) !== i))];
    return [
      codes.includes(required) ? '"' + required + '" PRESENT' : '"' + required + '" MISSING',
      strays.length ? 'STRAY scrap row(s) under ' + [...new Set(strays)].join(',') : null,
      dupes.length ? 'DUPLICATE code(s): ' + dupes.map(c => '"' + c + '"').join(',') : null,
    ].filter(Boolean).join('; ');
  };

  console.log(`Signed in as: ${user.email}  uid=${user.uid}`);

  // ------------------------------------------------------------------ source
  let pub;
  try {
    const sn = await getDoc(doc(db, 'public_config', 'estimate_master'));
    if (!sn.exists()) { console.error('public_config/estimate_master does not exist. Nothing to copy from.'); return; }
    pub = sn.data();
  } catch (e) { console.error('Could not read public_config/estimate_master:', e?.message || e); return; }

  hdr('SOURCE: public_config/estimate_master');
  console.log(`updatedAt: ${pub.updatedAt ? new Date(pub.updatedAt).toISOString() : '(none)'}   updatedBy: ${pub.updatedBy || '(none)'}`);

  let blocked = false;
  SECTIONS.forEach(({ key, field, scrapCode }) => {
    const list = pub[field];
    const h = checkMasterSection(key, list);
    const clean = Array.isArray(list) && list.length > 0 && h.problems.length === 0;
    if (!clean) {
      blocked = true;
      console.error(`REFUSING ${key}: the shared default's section is not clean.`);
      (h.problems.length ? h.problems : ['section is empty or absent']).forEach(p => console.error(`     ${p}`));
    }
    console.log(`  ${key.padEnd(11)} ${String((list || []).length).padStart(3)} row(s)   ${scrapState(list, scrapCode)}`);
  });
  if (blocked) {
    console.error('\nAborting - correct public_config first (fix-public-config-master.js). Nothing written.');
    return;
  }

  const payload = {
    estimateMasterCRGO: pub.estimateMasterCRGO,
    estimateMaster: pub.estimateMasterCRGO,     // legacy mirror, from CRGO - see header
    estimateMasterAmorphous: pub.estimateMasterAmorphous,
    estimateMasterWoundCore: pub.estimateMasterWoundCore,
  };
  const legacyDiffers = JSON.stringify(pub.estimateMaster ?? null) !== JSON.stringify(pub.estimateMasterCRGO ?? null);
  if (legacyDiffers) {
    console.log('');
    console.log("  NOTE: public_config's own legacy estimateMaster differs from its estimateMasterCRGO.");
    console.log('  The legacy field is written from estimateMasterCRGO, so both end up holding the');
    console.log('  same correct card and no stale second copy is spread.');
  }

  // ------------------------------------------------------------------ targets
  const targets = [];
  for (const id of TARGET_AGENCY_IDS) {
    try {
      const sn = await getDoc(doc(db, 'agencies', id));
      if (!sn.exists()) { console.error(`Agency ${id} does not exist.`); return; }
      targets.push({ id, ...sn.data() });
    } catch (e) {
      console.error(`Could not read agency ${id}:`, e?.message || e);
      return;
    }
  }

  hdr(`TARGETS - ${targets.length}, resolved by id`);
  targets.forEach(t => {
    const mine = t.ownerId === user.uid;
    console.log(`  ${String(t.name || '(unnamed)').padEnd(20)} id=${t.id}  owner=${t.ownerId || '(none)'}${mine ? '  (you)' : '  *** NOT OWNED BY THE SIGNED-IN ACCOUNT ***'}`);
    if (!mine) {
      console.warn('    The write will succeed only if this account is super admin. If it is not,');
      console.warn('    the update fails at the rules layer - sign in as the owner instead.');
    }
  });

  hdr('PER TARGET, PER SECTION - before / after');
  const rows = [];
  targets.forEach(t => {
    SECTIONS.forEach(({ key, field, scrapCode }) => {
      const before = t[field];
      const after = payload[field];
      const beforeCodes = codesOf(before).filter(Boolean);
      const afterCodes = codesOf(after).filter(Boolean);
      rows.push({
        agency: t.name || t.id,
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
    const lb = t.estimateMaster;
    rows.push({
      agency: t.name || t.id,
      section: 'estimateMaster (legacy)',
      itemsBefore: Array.isArray(lb) ? lb.length : 0,
      itemsAfter: payload.estimateMaster.length,
      scrapBefore: scrapState(lb, '22'),
      scrapAfter: scrapState(payload.estimateMaster, '22'),
      codesRemoved: '-', codesAdded: '-',
      unchanged: JSON.stringify(lb ?? null) === JSON.stringify(payload.estimateMaster ?? null),
    });
  });
  console.table(rows);
  targets.forEach(t => {
    console.log(`\n${t.name || t.id}:`);
    rows.filter(r => r.agency === (t.name || t.id)).forEach(r =>
      console.log(`  ${String(r.section).padEnd(24)} ${String(r.itemsBefore).padStart(3)} -> ${String(r.itemsAfter).padStart(3)} rows   removed: ${r.codesRemoved}   added: ${r.codesAdded}`));
  });

  hdr('WHAT IS AND IS NOT WRITTEN');
  Object.keys(payload).forEach(f => console.log(`  WRITE  ${f}  (${payload[f].length} row(s))`));
  targets.forEach(t => {
    console.log(`  KEEP   ${String(t.name || t.id)}: estimateMasterOverhauling ` +
      `(${Array.isArray(t.estimateMasterOverhauling) ? t.estimateMasterOverhauling.length + ' row(s)' : 'absent'}), ` +
      `estimateMasterCircleLimits (${Array.isArray(t.estimateMasterCircleLimits) ? t.estimateMasterCircleLimits.length + ' row(s)' : 'absent'})`);
  });
  console.log('  KEEP   every non-master field: name, GSTIN, prefixes, counters, allotments...');

  if (MODE !== 'write') {
    hdr('DRY RUN - NOTHING WAS WRITTEN');
    console.log(`Would write ${Object.keys(payload).length} field(s) on each of ${targets.length} agencies.`);
    console.log('Neither target has issued any estimate, bill or challan, so no document');
    console.log('already names these agencies against the old rates - this is the cheapest');
    console.log('moment to correct them.');
    console.log("To apply: set MODE to 'write' at the top and re-paste.");
    window.__seedFromPublic = { payload, targets: targets.map(t => ({ id: t.id, name: t.name })), rows };
    console.log('Full results: window.__seedFromPublic');
    return;
  }

  hdr(`WRITING ${Object.keys(payload).length} field(s) on ${targets.length} agencies`);
  for (const t of targets) {
    try {
      await updateDoc(doc(db, 'agencies', t.id), payload);   // awaited - one at a time
      console.log(`  ${t.name || t.id} (${t.id}): written`);
    } catch (e) {
      console.error(`  ${t.name || t.id} (${t.id}): FAILED -`, e?.message || e);
      console.error('  Stopping. Earlier agencies in this list were written; later ones were not.');
      return;
    }
  }
  console.log('\nDONE. Reload the tab, then run verify-agency-masters-console.js to confirm');
  console.log('from Firestore - and check the docId column matches these ids.');
  window.__seedFromPublic = { payload, targets: targets.map(t => ({ id: t.id, name: t.name })), rows, written: true };
})();
