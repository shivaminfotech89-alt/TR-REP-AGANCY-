// READ-ONLY: jobs created with no AT master attached, and what they carry.
//
// `NewJob` writes `atId: activeAtMaster ? activeAtMaster.id : ''` - so a job saved while
// no AT was active for the agency (the cross-agency AT id leak, AUDIT F20) carries an
// empty atId. Such a job has no AT percentage, no prefix source and no allotment to
// check against.
//
// HOW TO RUN: npm run dev, log in, select the agency, reload the tab, paste in console.

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs } = fs;

  const uid = auth?.currentUser?.uid;
  if (!uid) { console.error('Not signed in.'); return; }

  const snap = async (col, ...c) =>
    (await getDocs(query(collection(db, col), ...c))).docs.map(d => ({ id: d.id, ...d.data() }));

  // ALL agencies - an orphaned job may sit under one you are not currently viewing.
  const [agencies, atMasters, jobs] = await Promise.all([
    snap('agencies', where('ownerId', '==', uid)),
    snap('atMasters', where('ownerId', '==', uid)),
    snap('jobs', where('ownerId', '==', uid)),
  ]);
  const agencyName = id => agencies.find(a => a.id === id)?.name || id || '(none)';
  const atById = Object.fromEntries(atMasters.map(a => [a.id, a]));

  const hdr = t => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);

  const orphaned = jobs.filter(j => !String(j.atId ?? '').trim() || !atById[j.atId]);

  hdr(`JOBS WITH NO VALID AT - ${orphaned.length} of ${jobs.length} (all agencies)`);
  if (orphaned.length === 0) {
    console.log('(none)');
  } else {
    console.table(orphaned.map(j => ({
      jobNo: j.jobNo,
      agency: agencyName(j.agencyId),
      mrNo: j.mrNo || '',
      atId: j.atId ? `${j.atId} (not found)` : '(empty)',
      prevAtNo: j.prevAtNo || '',
      division: j.division || '(none)',
      coreType: j.coreType || '(none)',
      repairType: j.repairType || '(unset)',
      capacityKva: j.capacityKva ?? '',
      make: j.make || '',
      serialNo: j.serialNo || '',
      status: j.status || '',
      createdAt: j.createdAt || '',
      // What downstream cannot resolve without an AT
      estimateSentDate: j.estimateSentDate || '',
      billNo: j.billNo || '',
      hasAnyDownstream: Boolean(j.estimateSentDate || j.billNo || j.challanNo || j.billSentDate),
      // Evidence of whether it is real work or a test record
      looksLikeTestRecord: [j.make, j.serialNo].some(v => !String(v ?? '').trim())
        || String(j.serialNo ?? '').length < 3,
    })));

    console.log('');
    console.log('WHAT AN EMPTY atId COSTS THIS JOB:');
    console.log('  - AT percentage falls back to the 4% default (getAtPercentageForCore)');
    console.log('  - the allotment check never ran (gated on activeAtMaster being present)');
    console.log('  - it is invisible to any per-AT quota or allotment report');
    console.log('');
    console.log('hasAnyDownstream=false means nothing has been estimated, billed or');
    console.log('dispatched against it - such a job can be deleted without affecting any');
    console.log('issued document. true means correct it rather than delete it.');
  }

  // For context: which agencies currently have no AT at all?
  const noAt = agencies.filter(a => !atMasters.some(m => m.agencyId === a.id));
  if (noAt.length) {
    hdr(`AGENCIES WITH NO AT MASTER AT ALL - ${noAt.length}`);
    console.table(noAt.map(a => ({ agency: a.name || a.id, id: a.id })));
    console.log('Jobs created under these would carry an empty atId by construction.');
  }

  window.__jobAtLinkage = { orphaned, noAt };
  console.log('\nFull results: window.__jobAtLinkage');
})();
