// READ-ONLY: can the "Move ALL My Data To Active Agency" bulk move be reversed, and
// should it be? Reports the evidence, per job. Decides nothing and writes nothing.
//
// WHAT HAPPENED: the removed button ran `where('ownerId','==',uid)` over the JOBS
// collection with no agency filter and set `agencyId` on every job that did not already
// match the active agency. Four agencies collapsed into one. There is no undo and it
// recorded nothing about what it moved.
//
// WHY REVERSAL IS EVEN POSSIBLE: it only ever touched the `jobs` collection.
// `inspections` and `oilTransactions` each carry their own `agencyId`, stamped from the
// agency that was active when the record was written, and NONE of them were rewritten.
// Those side records still hold the original attribution. The job's `atId` was not
// rewritten either, and an AT belongs to exactly one agency.
//
// So there are three INDEPENDENT witnesses, and where they agree the original agency is
// established rather than guessed. Where they disagree, or are all absent, this says so
// instead of picking one.
//
// It WRITES NOTHING. No set, update, delete or batch. It reports.
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

  const [agencies, atMasters, jobs, inspections, oilTx] = await Promise.all([
    snap('agencies', where('ownerId', '==', uid)),
    snap('atMasters', where('ownerId', '==', uid)),
    snap('jobs', where('ownerId', '==', uid)),
    snap('inspections', where('ownerId', '==', uid)),
    snap('oilTransactions', where('ownerId', '==', uid)),
  ]);

  const hdr = t => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
  const agencyById = Object.fromEntries(agencies.map(a => [a.id, a]));
  const atById = Object.fromEntries(atMasters.map(a => [a.id, a]));
  const nameOf = id => agencyById[id]?.name || (id ? `${id} (unknown)` : '(none)');

  // Index the untouched side records by what links them to a job.
  const inspByJobId = {};
  inspections.forEach(i => { if (i.jobId) (inspByJobId[i.jobId] ||= []).push(i); });
  const oilByMr = {};
  oilTx.forEach(t => { if (t.mrNo) (oilByMr[String(t.mrNo).trim()] ||= []).push(t); });

  // Prefix ownership: which agencies/ATs define a given job-number prefix. A job number
  // was issued from a division prefix belonging to one tender, and the move did not
  // rewrite job numbers - so the prefix is a fourth witness, independent of the rest.
  const prefixOwners = {};              // prefix -> Set of agencyId
  const addPrefixOwner = (p, agId) => {
    const key = String(p ?? '').trim().toUpperCase();
    if (!key || !agId) return;
    (prefixOwners[key] ||= new Set()).add(agId);
  };
  agencies.forEach(a => Object.values(a.prefixes || {}).forEach(v => {
    if (typeof v === 'string') addPrefixOwner(v, a.id);
    else Object.values(v || {}).forEach(p => addPrefixOwner(p, a.id));
  }));
  atMasters.forEach(at => Object.values(at.prefixes || {}).forEach(v => {
    if (typeof v === 'string') addPrefixOwner(v, at.agencyId);
    else Object.values(v || {}).forEach(p => addPrefixOwner(p, at.agencyId));
  }));
  const ownerFromJobNo = jobNo => {
    const s = String(jobNo ?? '').trim().toUpperCase();
    if (!s) return null;
    // Longest matching prefix wins, so "AM21 IS" is not shadowed by "21 IS".
    let best = null;
    Object.keys(prefixOwners).forEach(p => {
      if (s.startsWith(p) && (!best || p.length > best.length)) best = p;
    });
    if (!best) return null;
    const owners = [...prefixOwners[best]];
    return owners.length === 1 ? { agencyId: owners[0], prefix: best } : null;
  };

  const rows = jobs.map(j => {
    const current = String(j.agencyId ?? '').trim();

    // Witness 1 - the AT the job was stamped with.
    const at = j.atId ? atById[j.atId] : null;
    const wAt = at && agencyById[at.agencyId] ? at.agencyId : '';

    // Witness 2 - this job's own inspection records, never rewritten.
    const insps = inspByJobId[j.id] || [];
    const inspAgencies = [...new Set(insps.map(i => String(i.agencyId ?? '').trim()).filter(Boolean))];
    const wInsp = inspAgencies.length === 1 ? inspAgencies[0] : '';

    // Witness 3 - oil transactions on the same MR, never rewritten.
    const txs = j.mrNo ? (oilByMr[String(j.mrNo).trim()] || []) : [];
    const txAgencies = [...new Set(txs.map(t => String(t.agencyId ?? '').trim()).filter(Boolean))];
    const wOil = txAgencies.length === 1 ? txAgencies[0] : '';

    // Witness 4 - the prefix its job number was issued from.
    const pref = ownerFromJobNo(j.jobNo);
    const wPrefix = pref ? pref.agencyId : '';

    const witnesses = [wAt, wInsp, wOil, wPrefix].filter(Boolean);
    const distinct = [...new Set(witnesses)];

    let verdict, origin;
    if (distinct.length === 0)      { verdict = 'NO EVIDENCE';   origin = ''; }
    else if (distinct.length === 1) { verdict = witnesses.length > 1 ? 'CORROBORATED' : 'SINGLE WITNESS'; origin = distinct[0]; }
    else                            { verdict = 'CONFLICTING';   origin = ''; }

    return {
      jobNo: j.jobNo || '(none)',
      docId: j.id,
      mrNo: j.mrNo || '',
      currentAgency: nameOf(current),
      verdict,
      originalAgency: origin ? nameOf(origin) : '(unestablished)',
      moved: Boolean(origin) && origin !== current,
      witnessCount: witnesses.length,
      byAt: wAt ? nameOf(wAt) : '-',
      byInspection: wInsp ? nameOf(wInsp) : (insps.length ? '(inspection has no agencyId)' : '(no inspection)'),
      byOil: wOil ? nameOf(wOil) : '-',
      byPrefix: wPrefix ? nameOf(wPrefix) : '-',
      // Is this real work or a test record? Decides question 2.
      status: j.status || '',
      hasIssuedDocuments: Boolean(j.estimateSentDate || j.billNo || j.challanNo || j.billSentDate),
      billNo: j.billNo || '',
      condition: j.condition || '',
      thinTestRecord: !String(j.make ?? '').trim() || String(j.serialNo ?? '').trim().length < 3,
    };
  });

  hdr(`ALL JOBS - ${rows.length}`);
  console.table(rows.map(({ docId, ...r }) => r));

  // ---------------------------------------------------------------- QUESTION 1
  const moved = rows.filter(r => r.moved);
  const noEvidence = rows.filter(r => r.verdict === 'NO EVIDENCE');
  const conflicting = rows.filter(r => r.verdict === 'CONFLICTING');
  const corroborated = rows.filter(r => r.verdict === 'CORROBORATED');
  const single = rows.filter(r => r.verdict === 'SINGLE WITNESS');
  const noAtId = rows.filter(r => r.byAt === '-');

  hdr('QUESTION 1: CAN IT BE REVERSED?');
  console.log(`  jobs whose evidence names an agency OTHER than their current one : ${moved.length}`);
  console.log(`      of those, corroborated by 2+ independent witnesses           : ${moved.filter(r => r.verdict === 'CORROBORATED').length}`);
  console.log(`      of those, resting on a single witness                        : ${moved.filter(r => r.verdict === 'SINGLE WITNESS').length}`);
  console.log(`  jobs with NO evidence of origin at all                           : ${noEvidence.length}`);
  console.log(`  jobs whose witnesses CONFLICT                                    : ${conflicting.length}`);
  console.log(`  jobs with no atId (the witness asked about specifically)          : ${noAtId.length}`);
  console.log('');
  console.log(`  totals: ${corroborated.length} corroborated, ${single.length} single-witness, ${conflicting.length} conflicting, ${noEvidence.length} unevidenced`);

  const byOrigin = {};
  rows.forEach(r => { if (r.originalAgency !== '(unestablished)') (byOrigin[r.originalAgency] ||= []).push(r.jobNo); });
  console.log('');
  console.log('Reconstructed original distribution:');
  Object.entries(byOrigin).forEach(([name, list]) =>
    console.log(`  ${name}: ${list.length} job(s) - ${list.join(', ')}`));
  if (noEvidence.length) {
    console.log(`  (unestablished): ${noEvidence.length} job(s) - ${noEvidence.map(r => r.jobNo).join(', ')}`);
  }
  if (conflicting.length) {
    console.log('');
    console.log('CONFLICTING - witnesses disagree, do not reassign these automatically:');
    conflicting.forEach(r => console.log(`  ${r.jobNo}: AT=${r.byAt} insp=${r.byInspection} oil=${r.byOil} prefix=${r.byPrefix}`));
  }

  // ---------------------------------------------------------------- QUESTION 2
  hdr('QUESTION 2: DOES IT NEED REVERSING?');
  const perOrigin = {};
  rows.forEach(r => {
    const k = r.originalAgency;
    const g = (perOrigin[k] ||= { agency: k, jobs: 0, withIssuedDocuments: 0, dispatched: 0, scrap: 0, thinTestRecords: 0 });
    g.jobs++;
    if (r.hasIssuedDocuments) g.withIssuedDocuments++;
    if (r.status === 'Dispatched') g.dispatched++;
    if (r.condition === 'Scrap' || r.status === 'Scrap') g.scrap++;
    if (r.thinTestRecord) g.thinTestRecords++;
  });
  console.table(Object.values(perOrigin));
  console.log('');
  console.log('An agency whose jobs are all thin test records with no issued documents can');
  console.log('reasonably be left collapsed. One with issued estimates, bills or challans');
  console.log('cannot: those documents name a supplier, and the job now sits under a');
  console.log('different one. withIssuedDocuments is the column that decides it.');
  console.log('');
  console.log('NOTE what reversal does NOT restore: the record of the move itself. The');
  console.log('button wrote no log, so a reversal is a reconstruction from side evidence,');
  console.log('not an undo. Anything it cannot establish stays where the move put it.');

  window.__reverseBulkMove = {
    rows, moved, corroborated, single, conflicting, noEvidence, noAtId, byOrigin, perOrigin,
  };
  console.log('\nFull results: window.__reverseBulkMove');
})();
