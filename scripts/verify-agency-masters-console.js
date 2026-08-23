// READ-ONLY: what does Firestore hold for EVERY visible agency, and which document is the
// screen actually showing?
//
// Settles "the write did not land" versus "the screen is stale" - and covers the third
// possibility neither of those names: the write landed on a DIFFERENT document than the one
// on screen. The copy script matched agencies by NAME; this prints document IDs beside the
// names and shows which id `activeAgencyId` points at, so a name/id mismatch cannot hide.
//
// It WRITES NOTHING. It reports.
//
// HOW TO RUN: reload the tab first, then paste into the DevTools console.

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs } = fs;

  const user = auth?.currentUser;
  if (!user) { console.error('Not signed in.'); return; }

  const hdr = t => console.log(`\n${'='.repeat(96)}\n${t}\n${'='.repeat(96)}`);
  const codes = list => (list || []).map(it => String(it.itemCode ?? '').trim());
  const has = (list, code) => codes(list).includes(code);

  const snap = async (col, ...c) =>
    (await getDocs(query(collection(db, col), ...c))).docs.map(d => ({ id: d.id, ...d.data() }));
  const agencies = await snap('agencies', where('ownerId', '==', user.uid));

  const activeId = localStorage.getItem('activeAgencyId');
  const activeDoc = agencies.find(a => a.id === activeId) || null;

  hdr('WHO IS READING, AND WHAT THE SCREEN IS POINTED AT');
  console.log(`signed in as        : ${user.email} (uid ${user.uid})`);
  console.log(`agencies visible    : ${agencies.length}`);
  console.log(`activeAgencyId      : ${activeId || '(none)'}`);
  console.log(`resolves to         : ${activeDoc ? `${activeDoc.name}` : '*** NOT IN THE VISIBLE LIST ***'}`);
  if (activeId && !activeDoc) {
    console.log('  The stored active id is not among this account\'s agencies. The screen would');
    console.log('  fall back to another agency while the header may still read the old name.');
  }

  hdr('FIRESTORE STATE, PER AGENCY - read just now, not from any cache');
  console.table(agencies.map(a => ({
    isActive: a.id === activeId ? '<== ON SCREEN' : '',
    name: a.name || '(unnamed)',
    docId: a.id,
    crgoItems: (a.estimateMasterCRGO || []).length,
    crgo_22: has(a.estimateMasterCRGO, '22'),
    amorphItems: (a.estimateMasterAmorphous || []).length,
    amorph_0: has(a.estimateMasterAmorphous, '0'),
    woundItems: (a.estimateMasterWoundCore || []).length,
    wound_0: has(a.estimateMasterWoundCore, '0'),
    legacyItems: (a.estimateMaster || []).length,
    ohItems: (a.estimateMasterOverhauling || []).length,
  })));

  hdr('VERDICT');
  const bad = agencies.filter(a =>
    (a.estimateMasterCRGO || []).length === 0 || !has(a.estimateMasterCRGO, '22') ||
    !has(a.estimateMasterAmorphous, '0') || !has(a.estimateMasterWoundCore, '0'));
  if (bad.length === 0) {
    console.log('Every visible agency holds CRGO with "22", Amorphous with "0", Wound Core with "0".');
    console.log('THE WRITES LANDED. If a screen disagrees, it is showing a different document or');
    console.log('a page that has not re-rendered - compare the docId above with the one the');
    console.log('screen claims, and check `isActive` marks the agency you think you are viewing.');
  } else {
    console.log('These agencies do NOT hold the expected sections in Firestore:');
    bad.forEach(a => console.log(
      `  ${a.name} (${a.id}): CRGO ${(a.estimateMasterCRGO || []).length} items, "22" ${has(a.estimateMasterCRGO, '22')}; ` +
      `Amorphous "0" ${has(a.estimateMasterAmorphous, '0')}; Wound Core "0" ${has(a.estimateMasterWoundCore, '0')}`
    ));
    console.log('');
    console.log('THE WRITE DID NOT LAND on these. Compare their docId against');
    console.log('window.__copyMaster to see which documents the copy actually targeted -');
    console.log('the copy matched agencies by NAME, so a near-duplicate name is the first');
    console.log('thing to rule out.');
  }

  window.__verifyMasters = { agencies, activeId, activeDoc, bad };
  console.log('\nFull results: window.__verifyMasters');
})();
