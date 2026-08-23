// READ-ONLY: for jobs carrying an ISSUED document, what does the record say about which
// agency issued it?
//
// THE ANSWER, ESTABLISHED FROM THE WRITE SITES: nothing does.
//   BillingSystem writes billNo/billRefNo/billSentDate/billAmount/billStatus/...
//   EstimateGenerate writes estimateSentDate/estimateRefNo/estimateAmount/estimateStatus/...
// Neither records an agency. There is no bills or estimates collection - documents are
// rendered on demand from the job plus whichever agency is ACTIVE at print time. So the
// only link between a document and its supplier was job.agencyId, which is the field the
// bulk move overwrote (AUDIT O14).
//
// This prints, per sampled job, everything the record DOES hold, so the gap can be seen
// rather than taken on trust - and so the sample can be checked against a printed copy.
//
// NOTE: reprinting will NOT reproduce the original letterhead. It takes the agency from
// the current session, not from stored data. Only the paper or PDF issued at the time is
// evidence of what was sent.
//
// It WRITES NOTHING. It reports.
//
// HOW TO RUN: sign in as the owner, reload the tab, paste into the DevTools console.

const SAMPLE_COUNT = 3;   // jobs to print in full, spread across the corroborated set

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs } = fs;

  const user = auth?.currentUser;
  if (!user) { console.error('Not signed in.'); return; }

  const hdr = t => console.log(`\n${'='.repeat(100)}\n${t}\n${'='.repeat(100)}`);
  const snap = async (col, ...c) =>
    (await getDocs(query(collection(db, col), ...c))).docs.map(d => ({ id: d.id, ...d.data() }));

  const [agencies, atMasters, jobs, inspections, oilTx] = await Promise.all([
    snap('agencies', where('ownerId', '==', user.uid)),
    snap('atMasters', where('ownerId', '==', user.uid)),
    snap('jobs', where('ownerId', '==', user.uid)),
    snap('inspections', where('ownerId', '==', user.uid)),
    snap('oilTransactions', where('ownerId', '==', user.uid)),
  ]);

  const agencyById = Object.fromEntries(agencies.map(a => [a.id, a]));
  const atById = Object.fromEntries(atMasters.map(a => [a.id, a]));
  const label = id => id ? `${agencyById[id]?.name || '(unnamed)'} [${id}]` : '(none)';

  const inspByJob = {};
  inspections.forEach(i => { if (i.jobId) (inspByJob[i.jobId] ||= []).push(i); });
  const oilByMr = {};
  oilTx.forEach(t => { if (t.mrNo) (oilByMr[String(t.mrNo).trim()] ||= []).push(t); });

  // Same witnesses as reverse-bulk-move.js, so the sample cannot disagree with the plan.
  const witnesses = j => {
    const at = j.atId ? atById[j.atId] : null;
    const wAt = at && agencyById[at.agencyId] ? at.agencyId : '';
    const insps = inspByJob[j.id] || [];
    const ia = [...new Set(insps.map(i => String(i.agencyId ?? '').trim()).filter(Boolean))];
    const wInsp = ia.length === 1 ? ia[0] : '';
    const txs = j.mrNo ? (oilByMr[String(j.mrNo).trim()] || []) : [];
    const ta = [...new Set(txs.map(t => String(t.agencyId ?? '').trim()).filter(Boolean))];
    const wOil = ta.length === 1 ? ta[0] : '';
    return { wAt, wInsp, wOil, insps, txs };
  };

  const hasIssued = j => Boolean(j.estimateSentDate || j.billNo || j.billSentDate || j.challanNo);
  const issued = jobs.filter(hasIssued);

  hdr(`JOBS CARRYING AN ISSUED DOCUMENT: ${issued.length} of ${jobs.length}`);
  console.table(issued.map(j => {
    const w = witnesses(j);
    const distinct = [...new Set([w.wAt, w.wInsp, w.wOil].filter(Boolean))];
    return {
      jobNo: j.jobNo,
      currentAgencyId: j.agencyId || '(none)',
      currentAgency: agencyById[j.agencyId]?.name || '(unknown)',
      reconstructedAgencyId: distinct.length === 1 ? distinct[0] : (distinct.length ? 'CONFLICT' : 'none'),
      reconstructedAgency: distinct.length === 1 ? (agencyById[distinct[0]]?.name || '(unknown)') : (distinct.length ? 'CONFLICT' : '-'),
      estimateSentDate: j.estimateSentDate || '',
      estimateRefNo: j.estimateRefNo || '',
      billNo: j.billNo || '',
      billSentDate: j.billSentDate || '',
      challanNo: j.challanNo || '',
    };
  }));

  // Spread the sample across the list rather than taking the first N - three consecutive
  // jobs are likely to share one MR and one AT, which would test the same evidence
  // three times and read as three confirmations.
  const corroborated = issued.filter(j => {
    const w = witnesses(j);
    const distinct = [...new Set([w.wAt, w.wInsp, w.wOil].filter(Boolean))];
    return distinct.length === 1 && [w.wAt, w.wInsp, w.wOil].filter(Boolean).length > 1 && distinct[0] !== j.agencyId;
  });
  const step = Math.max(1, Math.floor(corroborated.length / SAMPLE_COUNT));
  const sample = [];
  for (let i = 0; i < corroborated.length && sample.length < SAMPLE_COUNT; i += step) sample.push(corroborated[i]);

  hdr(`SAMPLE - ${sample.length} corroborated jobs with issued documents, spread across the set`);
  sample.forEach(j => {
    const w = witnesses(j);
    const distinct = [...new Set([w.wAt, w.wInsp, w.wOil].filter(Boolean))];
    console.log(`\n${'-'.repeat(100)}`);
    console.log(`JOB ${j.jobNo}   (doc ${j.id})   MR ${j.mrNo || '-'}   ${j.make || ''} ${j.capacityKva || ''} KVA  sr ${j.serialNo || '-'}`);
    console.log(`  currently        : ${label(j.agencyId)}`);
    console.log(`  reconstructed    : ${distinct.length === 1 ? label(distinct[0]) : '(not single-valued)'}`);
    console.log('  ISSUED DOCUMENTS RECORDED ON THIS JOB:');
    console.log(`    estimateSentDate ${j.estimateSentDate || '-'}    estimateRefNo ${j.estimateRefNo || '-'}    estimateAmount ${j.estimateAmount ?? '-'}`);
    console.log(`    billNo           ${j.billNo || '-'}    billRefNo ${j.billRefNo || '-'}    billSentDate ${j.billSentDate || '-'}    billAmount ${j.billAmount ?? '-'}`);
    console.log(`    challanNo        ${j.challanNo || '-'}    challanDate ${j.challanDate || '-'}`);
    console.log(`    billStatus ${j.billStatus || '-'}   paymentStatus ${j.paymentStatus || '-'}   paidAmount ${j.paidAmount ?? '-'}`);
    console.log('  ISSUING AGENCY RECORDED ON THE DOCUMENT FIELDS: none. No field above names an agency.');
    console.log('  WITNESSES (records the bulk move never touched):');
    console.log(`    atId ${j.atId || '(none)'} -> ${w.wAt ? label(w.wAt) : '(unresolved)'}${j.atId && atById[j.atId] ? `  [AT ${atById[j.atId].atNumber || ''}]` : ''}`);
    w.insps.forEach(i => console.log(`    inspection ${i.id} (${i.type || '?'}, ${i.inspectionDate || 'no date'}) -> ${label(String(i.agencyId ?? '').trim())}`));
    if (!w.insps.length) console.log('    inspection (none)');
    w.txs.forEach(t => console.log(`    oilTx ${t.id} mr="${t.mrNo}" div="${t.division || '-'}" -> ${label(String(t.agencyId ?? '').trim())}`));
    if (!w.txs.length) console.log('    oilTx (none)');
    console.log('  TO CHECK AGAINST PAPER: find the estimate or bill with the ref/number above');
    console.log('  and read the letterhead. Do NOT reprint - the letterhead comes from the');
    console.log('  agency active in the session, not from anything stored on this job.');
  });

  hdr('WHAT THIS SAMPLE CAN AND CANNOT SETTLE');
  console.log('It shows every field the job carries about its issued documents, and that none');
  console.log('of them names an agency. So the reconstruction is not the best of several');
  console.log('available records - it is the only one, because the field that held the answer');
  console.log('is the field that was overwritten.');
  console.log('');
  console.log('One printed document settles the direction for the whole set: if the letterhead');
  console.log('on a sampled job reads the reconstructed agency, the witnesses are confirmed');
  console.log('against an independent artefact that no write in this database can alter.');

  window.__docProvenance = { issued, sample, corroboratedCount: corroborated.length };
  console.log('\nFull results: window.__docProvenance');
})();
