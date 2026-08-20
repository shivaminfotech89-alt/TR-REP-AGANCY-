// READ-ONLY diagnostic for the scrap-identity bug.
//
// HOW TO RUN
//   1. npm run dev, log in, select the agency to inspect.
//   2. DevTools console, paste this whole file, Enter.
//
// Reads only - no set/update/delete/batch anywhere. Nothing is modified.

(async () => {
  const { db, auth } = await import('/src/lib/firebase.ts');
  const { collection, query, where, getDocs } = await import('firebase/firestore');

  const uid = auth.currentUser?.uid;
  if (!uid) { console.error('Not signed in - log in to the app first.'); return; }
  const agencyId = localStorage.getItem('activeAgencyId');
  if (!agencyId) { console.error('No active agency selected.'); return; }

  const snap = async (col, ...clauses) =>
    (await getDocs(query(collection(db, col), ...clauses))).docs.map(d => ({ id: d.id, ...d.data() }));

  const [jobs, allInspections] = await Promise.all([
    snap('jobs', where('ownerId', '==', uid), where('agencyId', '==', agencyId)),
    snap('inspections', where('ownerId', '==', uid)),
  ]);

  const jobIds = new Set(jobs.map(j => j.id));
  const internalByJob = {};
  allInspections
    .filter(i => i.jobId && jobIds.has(i.jobId) && (i.type || '').toLowerCase() === 'internal')
    .forEach(i => { internalByJob[i.jobId] = i; });

  // ---- STEP 1: the reported job -------------------------------------------------
  const TARGET = 'MSBT-9';
  const target = jobs.find(j => (j.jobNo || '').trim().toUpperCase() === TARGET);
  console.log(`\n=== STEP 1: ${TARGET} ===`);
  if (!target) {
    console.log(`No job named ${TARGET} in this agency.`);
  } else {
    const insp = internalByJob[target.id];
    console.log({
      jobNo: target.jobNo,
      status: target.status,
      condition: target.condition,                 // undefined => scrap identity lost
      conditionOnJob: 'condition' in target,
      challanNo: target.challanNo,
      challanDate: target.challanDate,
      deliveryDate: target.deliveryDate,
      dispatchDate: target.dispatchDate,           // note: nothing writes this field
      isClosed: target.isClosed,
      coreType: target.coreType,
      mrNo: target.mrNo,
      // What the internal inspection RECORD says - the only place 'Scrap' was stored
      internalInspectionId: insp?.id,
      internalRecordCondition: insp?.data?.condition,
      // The two tests the app actually uses
      passesScrapCheck: target.status === 'Scrap' || target.condition === 'Scrap',
      passesDispatchedTabFilter: target.status === 'Dispatched' && Boolean(target.challanNo),
    });
  }

  // ---- STEP 2: how many dispatched jobs have lost scrap identity ----------------
  const dispatched = jobs.filter(j => j.status === 'Dispatched');
  const dispatchedNoCondition = dispatched.filter(j => !j.condition);
  const dispatchedNoChallan = dispatched.filter(j => !j.challanNo);

  // Recoverable: the job has no condition, but its internal inspection record still
  // says Scrap. That record is the surviving evidence of what the unit actually was.
  const recoverableScrap = dispatchedNoCondition.filter(
    j => internalByJob[j.id]?.data?.condition === 'Scrap'
  );

  console.log(`\n=== STEP 2: dispatched jobs, scrap identity ===`);
  console.log({
    totalJobs: jobs.length,
    dispatched: dispatched.length,
    dispatchedWithNoConditionField: dispatchedNoCondition.length,
    ofThoseWhoseInternalRecordSaysScrap: recoverableScrap.length,
    dispatchedMissingChallanNo: dispatchedNoChallan.length,
  });

  console.log('\n-- Dispatched jobs whose internal record says Scrap but job.condition is unset --');
  console.table(recoverableScrap.map(j => ({
    jobNo: j.jobNo, mrNo: j.mrNo, status: j.status,
    condition: j.condition ?? '(unset)',
    challanNo: j.challanNo ?? '(none)',
    challanDate: j.challanDate ?? '',
    internalRecordCondition: internalByJob[j.id]?.data?.condition,
  })));

  if (dispatchedNoChallan.length) {
    console.log('\n-- Dispatched but NO challanNo (invisible in the Dispatched tab) --');
    console.table(dispatchedNoChallan.map(j => ({
      jobNo: j.jobNo, mrNo: j.mrNo, status: j.status,
      condition: j.condition ?? '(unset)',
      challanDate: j.challanDate ?? '', deliveryDate: j.deliveryDate ?? '',
      isClosed: j.isClosed,
    })));
  }

  // ---- STEP 3: what "Scrap Delivered" currently matches -------------------------
  const scrapByCurrentTest = jobs.filter(j => j.status === 'Scrap' || j.condition === 'Scrap');
  const scrapDelivered = scrapByCurrentTest.filter(j => j.status === 'Dispatched' && j.challanNo);
  console.log(`\n=== STEP 3: scrap billing scope ===`);
  console.log({
    matchedByCurrentScrapTest: scrapByCurrentTest.length,
    ofThoseActuallyDelivered: scrapDelivered.length,
    notYetDelivered: scrapByCurrentTest.length - scrapDelivered.length,
  });
  console.table(scrapByCurrentTest.map(j => ({
    jobNo: j.jobNo, mrNo: j.mrNo, status: j.status,
    condition: j.condition ?? '(unset)',
    challanNo: j.challanNo ?? '(none)',
    delivered: j.status === 'Dispatched' && Boolean(j.challanNo),
  })));

  window.__scrapIdentity = { target, dispatched, dispatchedNoCondition, recoverableScrap, dispatchedNoChallan, scrapByCurrentTest };
  console.log('\nFull results: window.__scrapIdentity');
})();
