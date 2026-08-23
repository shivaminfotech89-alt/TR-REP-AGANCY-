// READ-ONLY: find an AT written against the wrong agency (AUDIT F22), and report whether
// anything references it yet - so you can tell whether to repoint its agencyId or delete it.
//
// HOW TO RUN: npm run dev, log in, reload the tab, paste into the DevTools console.

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs } = fs;

  const uid = auth?.currentUser?.uid;
  if (!uid) { console.error('Not signed in.'); return; }

  const snap = async (col, ...c) =>
    (await getDocs(query(collection(db, col), ...c))).docs.map(d => ({ id: d.id, ...d.data() }));

  const [agencies, atMasters, jobs] = await Promise.all([
    snap('agencies', where('ownerId', '==', uid)),
    snap('atMasters', where('ownerId', '==', uid)),
    snap('jobs', where('ownerId', '==', uid)),
  ]);
  const agencyName = id => agencies.find(a => a.id === id)?.name || (id ? `${id} (unknown)` : '(none)');
  const hdr = t => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);

  hdr(`ALL AT MASTERS - ${atMasters.length}`);
  // ATs created since AUDIT F38 carry a server createdAt; older ones do not, and never
  // will. So "newest" is still inferred from startDate here, which is the TENDER period
  // start - a business date the operator types, not a creation time. Stated rather than
  // assumed. Where createdAt is present it is shown alongside, so a real creation order
  // can be read directly instead of inferred.
  const sorted = [...atMasters].sort((a, b) => (b.startDate || 0) - (a.startDate || 0));

  console.table(sorted.map(at => {
    const linkedJobs = jobs.filter(j => j.atId === at.id);
    const divisions = Object.keys(at.prefixes || {});
    const allotDivs = Object.keys(at.allotments || {});
    return {
      atNumber: at.atNumber || '(none)',
      name: at.name || '',
      docId: at.id,
      belongsTo: agencyName(at.agencyId),
      agencyId: at.agencyId || '(EMPTY - orphan)',
      status: at.status || '',
      startDate: at.startDate ? new Date(at.startDate).toISOString().split('T')[0] : '',
      createdAt: at.createdAt?.seconds
        ? new Date(at.createdAt.seconds * 1000).toISOString().split('T')[0]
        : (at.createdAt ? String(at.createdAt) : '(not recorded - predates F38)'),
      pctCRGO: at.atPercentageCRGO ?? at.atPercentage ?? '(unset)',
      pctAmorphous: at.atPercentageAmorphous ?? '(unset)',
      pctWoundCore: at.atPercentageWoundCore ?? '(unset)',
      // Everything that would be LOST by deleting rather than repointing
      divisionsConfigured: divisions.length ? divisions.join(', ') : '(none)',
      allotmentsConfigured: allotDivs.length ? allotDivs.join(', ') : '(none)',
      allotmentHistoryEntries: (at.allotmentHistory || []).length,
      counterKeysUsed: Object.keys(at.lastJobNumbers || {}).filter(k => at.lastJobNumbers[k] > 0).join(', ') || '(none)',
      // Everything that would BREAK by deleting
      jobsReferencing: linkedJobs.length,
      jobNos: linkedJobs.map(j => j.jobNo).join(', ') || '(none)',
      SAFE_TO_DELETE: linkedJobs.length === 0
        && divisions.length === 0
        && allotDivs.length === 0
        && (at.allotmentHistory || []).length === 0
        && Object.values(at.lastJobNumbers || {}).every(v => !v),
    };
  }));

  hdr('READING THIS');
  console.log('SAFE_TO_DELETE=true  -> nothing references it and nothing was configured on');
  console.log('                        it. Deleting loses nothing; recreate under the right');
  console.log('                        agency once addAgency activates it (F22 fix).');
  console.log('SAFE_TO_DELETE=false -> REPOINT agencyId instead. Deleting would lose the');
  console.log('                        divisions/prefixes, allotments, allotment history or');
  console.log('                        job-number counters listed, and orphan any job whose');
  console.log('                        atId points at it.');
  console.log('');
  console.log('An AT with jobsReferencing > 0 must NOT be deleted: those jobs would fall');
  console.log('back to a 4% AT percentage and vanish from every per-AT report (F21).');

  const orphans = atMasters.filter(at => !String(at.agencyId ?? '').trim());
  if (orphans.length) {
    hdr(`ATs WITH NO AGENCY AT ALL - ${orphans.length}`);
    console.table(orphans.map(at => ({ atNumber: at.atNumber, docId: at.id })));
    console.log('These are invisible in every agency-scoped view. Repoint or delete.');
  }

  window.__atMasters = { atMasters: sorted, agencies, orphans };
  console.log('\nFull results: window.__atMasters');
})();
