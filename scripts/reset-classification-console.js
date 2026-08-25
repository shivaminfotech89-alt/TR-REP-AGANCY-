// WHAT CAN BE DELETED AND WHAT MUST STAY - a partial-reset classification
//
// READ-ONLY. No set/update/delete/batch anywhere in this file. It classifies; it does not
// act, and it must not be turned into something that does without the review below.
//
// Paste into the browser console on a DEV build, signed in as the OWNER. Run once per
// account - it is owner-scoped (AUDIT F59).
//
// WHY
// ---
// The reset is no longer "wipe everything". One AT is live and generating estimates, so the
// question is which records are under it and which are debris. A half-cleared database is
// worse than either extreme: a deleted job leaves its inspections behind (O33), a deleted MR
// takes every job on it, and a guarantee claim that loses its predecessor silently stops
// being a guarantee claim.
//
// This reports four groups and, critically, THE OVERLAP between them - jobs that must stay
// sharing an MR with jobs you want gone, which the MR-scoped delete path cannot separate.

const TEST_MAKE_PATTERNS = [/^WNP$/i, /^SS$/i, /^NJA$/i];   // makes that look like scratch
const TEST_JOBNO_PATTERN = /^\d+$/;                          // a bare number, no prefix

(async () => {
  const { collection, query, where, getDocs } = window.__fs;
  const db = window.__db, uid = window.__auth.currentUser?.uid;
  const fdm = window.__utils?.formatDDMMYYYY, toMs = window.__utils?.toMillis;
  if (!db || !uid) { console.error('Sign in first - window.__db / __auth not ready.'); return; }
  if (!fdm || !toMs) { console.error('window.__utils missing - update src/lib/firebase.ts, run a DEV build.'); return; }

  const [agSnap, atSnap, jobSnap, inspSnap, oilSnap] = await Promise.all([
    getDocs(query(collection(db, 'agencies'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'atMasters'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'jobs'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'inspections'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'oilTransactions'), where('ownerId', '==', uid))),
  ]);
  const grab = s => { const o = []; s.forEach(d => o.push({ id: d.id, ...d.data() })); return o; };
  const agencies = grab(agSnap), ats = grab(atSnap), jobs = grab(jobSnap),
        insps = grab(inspSnap), oils = grab(oilSnap);
  const agName = id => (agencies.find(a => a.id === id) || {}).name || id || '(none)';

  // ---------- 1. the live AT ----------
  console.log('\n================ 1. AT RECORDS ================');
  console.table(ats.map(a => ({
    atNumber: a.atNumber || a.name || '(blank)',
    status: a.status || '(blank)',
    agency: agName(a.agencyId),
    start: fdm(a.startDate), end: fdm(a.endDate),
    jobsReferencing: jobs.filter(j => j.atId === a.id).length,
    atPctCRGO: a.atPercentageCRGO ?? a.atPercentage ?? '(unset)',
  })));
  const active = ats.filter(a => String(a.status || '').toLowerCase() === 'active');
  console.log(active.length === 1
    ? `  ACTIVE: "${active[0].atNumber || active[0].name}" on ${agName(active[0].agencyId)}`
    : active.length === 0
      ? '  NO AT IS MARKED ACTIVE. Which one is "live" cannot be read from the data - confirm by hand.'
      : `  ${active.length} ATs are marked Active. Only one can be the live one; confirm which.`);

  // ---------- 2. what the live AT depends on ----------
  console.log('\n================ 2. DEPENDENCIES OF THE LIVE AT ================');
  for (const a of (active.length ? active : ats)) {
    const ag = agencies.find(x => x.id === a.agencyId);
    console.log(`\n  AT "${a.atNumber || a.name}" -> agency ${agName(a.agencyId)}`);
    if (!ag) { console.log('    AGENCY NOT FOUND - this AT already points at nothing.'); continue; }
    const pfx = ag.prefixes || {}, apfx = a.prefixes || {};
    console.log(`    agency doc          : ${ag.id}   MUST STAY`);
    console.log(`    prefixes on agency  : ${Object.keys(pfx).length} division(s) [${Object.keys(pfx).join(', ') || 'none'}]`);
    console.log(`    prefixes on AT      : ${Object.keys(apfx).length} division(s) [${Object.keys(apfx).join(', ') || 'none'}]`);
    console.log(`    allotments on AT    : ${Object.keys(a.allotments || {}).length} division(s)`);
    console.log(`    allotment history   : ${(a.allotmentHistory || []).length} record(s)`);
    console.log(`    job counters        : ${Object.keys(a.lastJobNumbers || {}).length} key(s) -> ${JSON.stringify(a.lastJobNumbers || {})}`);
    console.log(`    estimate master     : CRGO ${Array.isArray(ag.estimateMasterCRGO) ? ag.estimateMasterCRGO.length + ' rows' : 'ABSENT'}`);
    console.log('    NOTE: allotment CONSUMPTION is counted live by querying jobs, not stored,');
    console.log('          so deleting jobs lowers the consumed count. Counters are stored and');
    console.log('          are NOT decremented - numbering continues past the gap, which is safe.');
  }

  // ---------- 3. jobs under the live AT, and their stage ----------
  const liveIds = new Set(active.map(a => a.id));
  const stageOf = j => {
    if (j.status === 'Scrap' || j.condition === 'Scrap') return 'scrap';
    const s = String(j.status || '').trim();
    return s === '' || s === 'Received' ? 'intake'
         : s === 'External Done' ? 'external done'
         : s === 'Internal Done' ? 'internal done'
         : s.startsWith('Tested') ? 'tested'
         : s === 'Dispatched' ? 'dispatched' : s;
  };
  const issuedOf = j => [
    j.estimateSentDate && 'est sent', j.billNo && 'billed',
    j.paymentStatus === 'Paid' && 'PAID', j.challanNo && 'challan',
  ].filter(Boolean).join(', ');

  console.log('\n================ 3. JOBS UNDER THE LIVE AT ================');
  const under = jobs.filter(j => liveIds.has(j.atId));
  console.log(`  ${under.length} job(s) reference the live AT - ALL MUST STAY`);
  if (under.length) {
    console.table(under.map(j => ({
      jobNo: j.jobNo || j.id, mrNo: j.mrNo || '-', make: j.make || '',
      kva: j.capacityKva || '', stage: stageOf(j),
      midCycle: ['intake', 'external done', 'internal done', 'tested'].includes(stageOf(j)) ? 'YES' : 'no',
      issued: issuedOf(j) || '-',
    })));
    const mid = under.filter(j => ['intake', 'external done', 'internal done', 'tested'].includes(stageOf(j)));
    console.log(`  ${mid.length} of ${under.length} are MID-CYCLE - work in progress, not finished records.`);
  }

  // ---------- 4. deletion candidates ----------
  console.log('\n================ 4. DELETION CANDIDATES ================');
  const byNo = {};
  jobs.forEach(j => { (byNo[String(j.jobNo ?? '').trim()] ||= []).push(j); });
  const dupNos = new Set(Object.entries(byNo).filter(([n, v]) => n && v.length > 1).map(([n]) => n));

  const candidates = jobs.filter(j => {
    if (liveIds.has(j.atId)) return false;                       // never a candidate
    const make = String(j.make || '').trim();
    return TEST_MAKE_PATTERNS.some(re => re.test(make))
        || TEST_JOBNO_PATTERN.test(String(j.jobNo ?? '').trim())
        || dupNos.has(String(j.jobNo ?? '').trim())
        || !j.atId;
  });
  console.log(`  ${candidates.length} candidate(s), none of which reference the live AT`);
  console.table(candidates.map(j => ({
    jobNo: j.jobNo || j.id, mrNo: j.mrNo || '-', agency: agName(j.agencyId),
    make: j.make || '', serial: j.serialNo || '', date: fdm(j.dateOfIssue),
    atId: j.atId ? 'set' : '(EMPTY)', stage: stageOf(j),
    issued: issuedOf(j) || '-',
    inspections: insps.filter(i => i.jobId === j.id).length,
  })));

  // ---------- 5. THE OVERLAP - the part that decides whether a partial reset is safe ----------
  console.log('\n================ 5. WHAT A PARTIAL RESET WOULD BREAK ================');
  const candIds = new Set(candidates.map(j => j.id));
  const candMrs = new Set(candidates.map(j => `${j.agencyId}|${String(j.mrNo ?? '').trim()}`));
  const mixed = jobs.filter(j => !candIds.has(j.id) && candMrs.has(`${j.agencyId}|${String(j.mrNo ?? '').trim()}`));
  if (mixed.length) {
    console.log(`  MIXED MRs - ${mixed.length} job(s) you are KEEPING share an MR with a candidate.`);
    console.log('  The only delete path in the app is MR-SCOPED (O33): deleting that MR takes these too.');
    console.table(mixed.map(j => ({ keep: j.jobNo || j.id, mrNo: j.mrNo, agency: agName(j.agencyId), stage: stageOf(j) })));
    console.log('  -> These MRs cannot be cleared through the UI. Either leave them, or delete');
    console.log('     the individual job documents directly, which the app cannot do.');
  } else {
    console.log('  No MR contains both a candidate and a job you are keeping. MR-scoped deletion');
    console.log('  can remove the candidates without touching anything else.');
  }

  const orphanInsp = candidates.reduce((n, j) => n + insps.filter(i => i.jobId === j.id).length, 0);
  console.log(`\n  ORPHANED INSPECTIONS: deleting the candidates strands ${orphanInsp} inspection record(s).`);
  console.log('  Nothing in the app deletes them (O33). They are inert - no map ever looks up a');
  console.log('  missing id - but every later census has to recognise and explain them.');

  const candMrNos = new Set(candidates.map(j => String(j.mrNo ?? '').trim()).filter(Boolean));
  const strandedOil = oils.filter(t => candMrNos.has(String(t.mrNo ?? '').trim()));
  console.log(`  STRANDED OIL TRANSACTIONS: ${strandedOil.length} record(s) key on an MR whose jobs would be gone.`);

  const candSerials = new Set(candidates.map(j => String(j.serialNo ?? '').trim().toLowerCase()).filter(Boolean));
  const gpRisk = jobs.filter(j => !candIds.has(j.id)
    && candSerials.has(String(j.serialNo ?? '').trim().toLowerCase()));
  console.log(`  GUARANTEE HISTORY: ${gpRisk.length} kept job(s) share a serial with a candidate.`);
  if (gpRisk.length) console.log('    Deleting the candidate removes the predecessor a GP claim would match on.');

  console.log('\n  COUNTERS ARE NOT REWOUND. lastJobNumbers keeps its high-water mark, so numbering');
  console.log('  continues past the deleted range - gaps in the sequence, never a reused number.');
  console.log('  That is the safe direction and needs no action.');
  console.log('\nDone. Nothing was written.');
})();
