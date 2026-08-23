// WRITE the shared default: copy one agency's three correct sections into
// public_config/estimate_master (and its system_config mirror).
//
// WHY THIS IS NEEDED: public_config holds CRGO without scrap code "22", Amorphous without
// "0", and no Wound Core field at all. addAgency seeds every NEW agency from it, so an
// agency created now starts with the same faults that were just repaired by hand across
// four agencies (AUDIT O12).
//
// WHY THE APP CANNOT DO IT: publishing requires super admin, and
// saveGlobalDefaultEstimateMaster's fan-out iterates the OWNER-SCOPED agency list. From the
// admin account that list does not contain these agencies, so the app has no way to read
// the correct sections and no screen on which to load them.
//
// WHY A SCRIPT CAN: the restriction is the app's CLIENT QUERY, not the rules.
// firestore.rules allows a super admin to read any agency (`isSuperAdmin()` is in the
// get/list condition), so this reads the source agency directly instead of through the
// owner-filtered query the switcher uses. No privilege change, no rules change.
//
// YOU MUST BE SIGNED IN AS THE SUPER ADMIN. public_config create/update is
// `isSuperAdmin()` only. Running as anyone else fails at the rules layer, after the read.
//
// FIELDS WRITTEN:  estimateMasterCRGO, estimateMasterAmorphous, estimateMasterWoundCore,
//                  estimateMaster (legacy CRGO mirror), updatedAt, updatedBy
// NOT TOUCHED:     estimateMasterOverhauling, estimateMasterCircleLimits. Overhauling is
//                  deliberately left ABSENT so new agencies keep falling through to the
//                  shipped all-null override shell, which is the correct state (F31).
//
// HOW TO RUN
//   1. npm run dev, sign in as the SUPER ADMIN account, RELOAD the tab.
//   2. DevTools console, paste this whole file, Enter. Review the dry run.
//   3. Set MODE to 'write', re-paste. Then set it back to 'dry-run' before committing.

const MODE = 'dry-run';                 // 'dry-run' | 'write'

// PREFER THE ID. Agency names are not unique across owners, and this script deliberately
// reads ALL agencies (as super admin), so the name space it searches is larger than any one
// owner's - which makes a name match strictly more ambiguous here than in the copy script.
const SOURCE_AGENCY_ID = '';            // set this to work by id; takes precedence
const SOURCE_AGENCY = 'MEGHA';          // used only when SOURCE_AGENCY_ID is empty
const MIRROR_TO_SYSTEM_CONFIG = true;   // saveGlobalDefaultEstimateMaster mirrors too

const SECTIONS = [
  { key: 'CRGO', field: 'estimateMasterCRGO', scrapCode: '22' },
  { key: 'AMORPHOUS', field: 'estimateMasterAmorphous', scrapCode: '0' },
  { key: 'WOUND_CORE', field: 'estimateMasterWoundCore', scrapCode: '0' },
];

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs, doc, getDoc, updateDoc } = fs;
  // Every handle checked BEFORE any read, so a missing one stops the run rather than
  // surfacing between the public_config write and the system_config mirror.
  if (MODE === 'write' && !updateDoc) {
    console.error('updateDoc handle missing from window.__fs. Reload the tab; if it persists, add it to the DEV block in src/lib/firebase.ts.');
    return;
  }

  const user = auth?.currentUser;
  if (!user) { console.error('Not signed in.'); return; }
  const email = String(user.email || '').toLowerCase().trim();

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

  // Read agencies WITHOUT the ownerId filter the app uses. Permitted for a super admin by
  // firestore.rules; it will simply return nothing (or fail) for anyone else, which is the
  // clearest possible signal that the wrong account is signed in.
  let agencies = [];
  try {
    agencies = (await getDocs(collection(db, 'agencies'))).docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('Could not list agencies:', e?.message || e);
    console.error(`Signed in as ${email || '(no email)'}. public_config writes require the super-admin account.`);
    return;
  }
  console.log(`Signed in as: ${email}`);
  console.log(`Agencies readable: ${agencies.length}`);
  agencies.forEach(a => console.log(`  ${String(a.name || '(unnamed)').padEnd(24)} id=${a.id}  owner=${a.ownerId || '(none)'}`));

  let source = null;
  if (SOURCE_AGENCY_ID) {
    source = agencies.find(a => a.id === SOURCE_AGENCY_ID) || null;
    if (!source) { console.error(`No agency with id "${SOURCE_AGENCY_ID}".`); return; }
  } else {
    const hits = agencies.filter(a => String(a.name ?? '').toLowerCase().includes(SOURCE_AGENCY.toLowerCase()));
    if (hits.length === 0) { console.error(`No agency matching "${SOURCE_AGENCY}".`); return; }
    if (hits.length > 1) {
      console.error(`"${SOURCE_AGENCY}" matches ${hits.length} agencies:`);
      hits.forEach(h => console.error(`    ${h.name}  id=${h.id}  owner=${h.ownerId || '(none)'}`));
      console.error('Refusing to guess. Set SOURCE_AGENCY_ID to the one you mean.');
      return;
    }
    source = hits[0];
  }
  console.log(`Source resolved: ${source.name}  id=${source.id}  owner=${source.ownerId || '(none)'}`);

  // ------------------------------------------------------------- source must be clean
  hdr(`SOURCE: ${source.name}  (${source.id})`);
  let blocked = false;
  SECTIONS.forEach(({ key, field, scrapCode }) => {
    const list = source[field];
    const h = checkMasterSection(key, list);
    const clean = Array.isArray(list) && list.length > 0 && h.problems.length === 0;
    if (!clean) {
      blocked = true;
      console.error(`REFUSING ${key}: source section is not clean.`);
      (h.problems.length ? h.problems : ['section is empty or absent']).forEach(p => console.error(`     ${p}`));
    }
    console.log(`  ${key.padEnd(11)} ${String((list || []).length).padStart(3)} row(s)   ${scrapState(list, scrapCode)}`);
  });
  if (blocked) { console.error('\nAborting - nothing written. A bad shared default seeds every future agency.'); return; }

  // ------------------------------------------------------------- current shared default
  const readDoc = async (col, id) => {
    try { const sn = await getDoc(doc(db, col, id)); return sn.exists() ? sn.data() : null; }
    catch (e) { console.warn(`Could not read ${col}/${id}:`, e?.message || e); return undefined; }
  };
  const pub = await readDoc('public_config', 'estimate_master');
  const sys = await readDoc('system_config', 'estimate_master');

  hdr('BEFORE / AFTER - public_config/estimate_master');
  if (pub === undefined) { console.error('public_config unreadable. Aborting.'); return; }
  if (pub === null) console.log('(document does not exist - it would be created)');
  else console.log(`updatedAt: ${pub.updatedAt ? new Date(pub.updatedAt).toISOString() : '(none)'}   updatedBy: ${pub.updatedBy || '(none)'}`);

  console.table(SECTIONS.map(({ key, field, scrapCode }) => {
    const before = pub ? pub[field] : undefined;
    const after = source[field];
    return {
      field,
      itemsBefore: Array.isArray(before) ? before.length : '(field absent)',
      itemsAfter: after.length,
      scrapBefore: scrapState(before, scrapCode),
      scrapAfter: scrapState(after, scrapCode),
      unchanged: JSON.stringify(before ?? null) === JSON.stringify(after ?? null),
    };
  }).concat([{
    field: 'estimateMaster (legacy)',
    itemsBefore: Array.isArray(pub?.estimateMaster) ? pub.estimateMaster.length : '(field absent)',
    itemsAfter: source.estimateMasterCRGO.length,
    scrapBefore: scrapState(pub?.estimateMaster, '22'),
    scrapAfter: scrapState(source.estimateMasterCRGO, '22'),
    unchanged: JSON.stringify(pub?.estimateMaster ?? null) === JSON.stringify(source.estimateMasterCRGO ?? null),
  }]));

  console.log('');
  console.log('LEFT ALONE: estimateMasterOverhauling ' +
    (pub && 'estimateMasterOverhauling' in pub ? '(present in public_config - not modified)' : '(absent - stays absent, which is correct)'));
  console.log('LEFT ALONE: estimateMasterCircleLimits ' +
    (pub && 'estimateMasterCircleLimits' in pub ? '(present - not modified)' : '(absent)'));

  const payload = {
    estimateMasterCRGO: source.estimateMasterCRGO,
    estimateMaster: source.estimateMasterCRGO,   // legacy mirror, from CRGO not from the source's own legacy field
    estimateMasterAmorphous: source.estimateMasterAmorphous,
    estimateMasterWoundCore: source.estimateMasterWoundCore,
    updatedAt: Date.now(),
    updatedBy: email || 'script',
  };

  hdr('WHAT WOULD BE WRITTEN');
  Object.keys(payload).forEach(f => {
    const v = payload[f];
    console.log(`  ${f}${Array.isArray(v) ? `  (${v.length} row(s))` : `  = ${v}`}`);
  });
  console.log(`  target: public_config/estimate_master${MIRROR_TO_SYSTEM_CONFIG ? '  +  system_config/estimate_master' : ''}`);
  console.log(`  system_config currently: ${sys === undefined ? 'unreadable' : sys === null ? 'does not exist' : 'exists'}`);

  if (MODE !== 'write') {
    hdr('DRY RUN - NOTHING WAS WRITTEN');
    console.log('After this write, a newly created agency seeds a CRGO section carrying "22"');
    console.log('and an Amorphous section carrying "0", and inherits a correct Wound Core');
    console.log('section instead of falling through to the shipped default. That closes O12.');
    console.log("To apply: set MODE to 'write' at the top and re-paste, signed in as the super admin.");
    window.__pubFix = { source: source.name, payload, publicConfigBefore: pub, systemConfigBefore: sys };
    console.log('Full results: window.__pubFix');
    return;
  }

  hdr('WRITING public_config/estimate_master');
  try {
    // setDoc-with-merge is what the app uses; updateDoc is equivalent here EXCEPT that it
    // requires the document to exist. Reported rather than guessed at.
    if (pub === null) {
      console.error('public_config/estimate_master does not exist, and updateDoc cannot create it.');
      console.error('Add setDoc to the DEV handles in src/lib/firebase.ts and re-run, or create the document once from the app.');
      return;
    }
    await updateDoc(doc(db, 'public_config', 'estimate_master'), payload);
    console.log('  public_config: written');
  } catch (e) {
    console.error('  public_config write FAILED:', e?.message || e);
    console.error('  If this is a permission error, you are not signed in as the super admin.');
    return;
  }

  if (MIRROR_TO_SYSTEM_CONFIG && sys !== null && sys !== undefined) {
    try {
      await updateDoc(doc(db, 'system_config', 'estimate_master'), payload);
      console.log('  system_config: mirrored');
    } catch (e) {
      console.warn('  system_config mirror failed (non-fatal - it is only read when public_config is absent):', e?.message || e);
    }
  }

  console.log('\nDONE. Re-run public-config-master-console.js to verify from Firestore.');
  window.__pubFix = { source: source.name, payload, written: true };
})();
