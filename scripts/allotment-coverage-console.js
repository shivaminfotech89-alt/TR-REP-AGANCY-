// READ-ONLY: how many existing jobs were created under a division + core type with NO
// allotment recorded? (AUDIT A3)
//
// NewJob resolves an unrecorded allotment to 0 and the whole quota check sits inside
// `if (allowed > 0)` - so an unset allotment currently means UNLIMITED, silently. This
// reports how much of the existing data was created that way, which is the evidence for
// whether quotas are meant to be opt-in or the check is silently doing nothing.
//
// Mirrors NewJob's own counting rules exactly:
//   - only OGP jobs draw on the allotment (GP repairs are exempt)
//   - core type OH is exempt
//   - the AT master's allotment wins; the agency's is the fallback
//
// HOW TO RUN: npm run dev, log in, select the agency, reload the tab, paste in console.

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs } = fs;

  const uid = auth?.currentUser?.uid;
  if (!uid) { console.error('Not signed in.'); return; }
  const agencyId = localStorage.getItem('activeAgencyId');
  if (!agencyId) { console.error('No active agency selected.'); return; }

  const snap = async (col, ...c) =>
    (await getDocs(query(collection(db, col), ...c))).docs.map(d => ({ id: d.id, ...d.data() }));

  const [agencies, atMasters, jobs] = await Promise.all([
    snap('agencies', where('ownerId', '==', uid)),
    snap('atMasters', where('ownerId', '==', uid)),
    snap('jobs', where('ownerId', '==', uid), where('agencyId', '==', agencyId)),
  ]);
  const agency = agencies.find(a => a.id === agencyId) || null;
  const atById = Object.fromEntries(atMasters.map(a => [a.id, a]));

  const hdr = t => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);

  // Same resolution order as NewJob: AT master first, agency as fallback.
  const allotmentFor = (atId, division, coreType) => {
    const at = atById[atId];
    let allowed = Number(at?.allotments?.[division]?.[coreType]);
    if (!allowed || allowed === 0) {
      allowed = Number(agency?.allotments?.[division]?.[coreType]) || 0;
    }
    return allowed || 0;
  };

  const drawsOnAllotment = j =>
    j.repairType !== 'GP' && j.isGp !== true && (j.coreType || 'CRGO') !== 'OH';

  const relevant = jobs.filter(drawsOnAllotment);

  // Group by the key the allotment is actually recorded against.
  const groups = {};
  relevant.forEach(j => {
    const division = j.division || '(no division)';
    const coreType = j.coreType || 'CRGO';
    const atId = j.atId || '';
    const key = `${atId}|${division}|${coreType}`;
    (groups[key] ||= { atId, division, coreType, jobs: [] }).jobs.push(j);
  });

  const rows = Object.values(groups).map(g => {
    const at = atById[g.atId];
    const allowed = allotmentFor(g.atId, g.division, g.coreType);
    return {
      at: at ? (at.atNumber || at.name || g.atId) : '(no AT on job)',
      division: g.division,
      coreType: g.coreType,
      jobsCreated: g.jobs.length,
      allotmentRecorded: allowed > 0 ? allowed : '(none)',
      status: allowed === 0
        ? 'UNCHECKED - no allotment, quota never enforced'
        : g.jobs.length > allowed
          ? `OVER - ${g.jobs.length} created against ${allowed} allowed`
          : `within (${g.jobs.length}/${allowed})`,
      jobNos: g.jobs.map(j => j.jobNo).join(', '),
    };
  }).sort((a, b) => b.jobsCreated - a.jobsCreated);

  hdr(`ALLOTMENT COVERAGE - ${relevant.length} of ${jobs.length} jobs draw on an allotment`);
  console.table(rows.map(({ jobNos, ...r }) => r));

  const unchecked = rows.filter(r => r.allotmentRecorded === '(none)');
  const over = rows.filter(r => String(r.status).startsWith('OVER'));
  const uncheckedJobs = unchecked.reduce((n, r) => n + r.jobsCreated, 0);

  console.log('');
  console.log(`Jobs created with NO allotment recorded: ${uncheckedJobs} of ${relevant.length}`);
  console.log(`Division + core type combinations with no allotment: ${unchecked.length} of ${rows.length}`);
  if (over.length) {
    console.log('');
    console.log(`${over.length} combination(s) have MORE jobs than the recorded allotment.`);
    console.log('Those were created before the allotment was set, or the allotment was');
    console.log('lowered afterwards - the check only runs at intake, never retrospectively.');
    console.table(over);
  }
  if (unchecked.length) {
    console.log('');
    console.log('Combinations never covered by a quota (job numbers, for tracing):');
    unchecked.forEach(r => console.log(`  ${r.at} / ${r.division} / ${r.coreType}: ${r.jobNos}`));
  }

  console.log('');
  console.log('READ THIS AS EVIDENCE, NOT A VERDICT (AUDIT A3): a high unchecked count means');
  console.log('either quotas are deliberately opt-in and most work is outside them, or the');
  console.log('check has been silently inert. Only someone who knows the tender can say which.');

  window.__allotmentCoverage = { rows, unchecked, over, uncheckedJobs, relevantCount: relevant.length };
  console.log('\nFull results: window.__allotmentCoverage');
})();
