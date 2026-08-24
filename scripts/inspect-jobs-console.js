// WHAT ARE THESE JOBS? - full record plus every downstream reference
//
// READ-ONLY. No set/update/delete/batch anywhere in this file.
//
// Paste into the browser console on a DEV build, signed in as the OWNER of the agency
// holding these jobs (owner-scoped; see the permission note in AUDIT F59).
//
// WHY
// ---
// Before a design bends around a population, it is worth knowing whether the population is
// real. Five jobs with no AT, no prefix on the job number, one number used twice, and all
// dated the same day look like test records - but "looks like test data" is not evidence,
// and deleting real work because it looked disposable is unrecoverable.
//
// This prints the identifying fields and then counts EVERY downstream reference: inspections,
// oil transactions, and any document number that would mean the job left the building. A job
// with no inspection, no oil movement and no issued document is safe to treat as scratch. A
// job with any of those is not, whatever its job number looks like.

const JOB_NUMBERS = ['1', '2', '101', '102'];   // matched case-insensitively, trimmed
const AGENCY_NAME_CONTAINS = 'AARATI';          // '' to search every agency you own

(async () => {
  const { collection, query, where, getDocs } = window.__fs;
  const db = window.__db, uid = window.__auth.currentUser?.uid;
  const fdm = window.__utils?.formatDDMMYYYY;
  if (!db || !uid) { console.error('Sign in first - window.__db / __auth not ready.'); return; }
  if (!fdm) { console.error('window.__utils is missing - update src/lib/firebase.ts, run a DEV build.'); return; }

  const agSnap = await getDocs(query(collection(db, 'agencies'), where('ownerId', '==', uid)));
  const agencies = [];
  agSnap.forEach(d => agencies.push({ id: d.id, ...d.data() }));
  const wanted = agencies.filter(a =>
    !AGENCY_NAME_CONTAINS || String(a.name || '').toUpperCase().includes(AGENCY_NAME_CONTAINS.toUpperCase()));
  if (!wanted.length) { console.error(`No owned agency matches "${AGENCY_NAME_CONTAINS}".`); return; }

  // one read per collection, filtered by ownerId - the filter the rules require
  const [jobsSnap, inspSnap, oilSnap] = await Promise.all([
    getDocs(query(collection(db, 'jobs'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'inspections'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'oilTransactions'), where('ownerId', '==', uid))),
  ]);
  const jobs = [], insps = [], oils = [];
  jobsSnap.forEach(d => jobs.push({ id: d.id, ...d.data() }));
  inspSnap.forEach(d => insps.push({ id: d.id, ...d.data() }));
  oilSnap.forEach(d => oils.push({ id: d.id, ...d.data() }));

  const agIds = new Set(wanted.map(a => a.id));
  const want = new Set(JOB_NUMBERS.map(n => String(n).trim().toLowerCase()));
  const hits = jobs.filter(j => agIds.has(j.agencyId) && want.has(String(j.jobNo ?? '').trim().toLowerCase()));

  console.log(`\n${hits.length} job(s) matched ${JSON.stringify(JOB_NUMBERS)} in ${wanted.map(a => a.name).join(', ')}`);
  if (!hits.length) { console.log('Nothing matched - check the job numbers and the agency name.'); return; }

  const summary = [];
  for (const j of hits) {
    const jInsps = insps.filter(i => i.jobId === j.id);
    const jOil = oils.filter(t => t.mrNo && j.mrNo && String(t.mrNo).trim() === String(j.mrNo).trim());
    // any of these means the job produced something outside the app
    const docs = {
      estimateSentDate: j.estimateSentDate, estimateStatus: j.estimateStatus,
      approvalNo: j.approvalNo, approvedAmount: j.approvedAmount,
      billNo: j.billNo, billSentDate: j.billSentDate, billAmount: j.billAmount,
      paymentStatus: j.paymentStatus, paidAmount: j.paidAmount, paymentRefNo: j.paymentRefNo,
      challanNo: j.challanNo, deliveryDate: j.deliveryDate,
      issuedByAgencyId: j.issuedByAgencyId,
    };
    const issuedFields = Object.entries(docs)
      .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 0 && v !== 'Unpaid' && v !== 'Pending');

    console.log(`\n================ JOB ${j.jobNo || '(no number)'}  (doc ${j.id}) ================`);
    console.log(`  agency        : ${(agencies.find(a => a.id === j.agencyId) || {}).name || j.agencyId}`);
    console.log(`  make          : ${j.make || '(blank)'}`);
    console.log(`  serial no     : ${j.serialNo || '(blank)'}`);
    console.log(`  capacity      : ${j.capacityKva || '(blank)'} kVA   core: ${j.coreType || '(blank)'}   repairType: ${j.repairType || '(blank)'}`);
    console.log(`  MR / division : ${j.mrNo || '(blank)'} / ${j.division || '(blank)'}`);
    console.log(`  date of issue : ${fdm(j.dateOfIssue)}    created: ${fdm(j.createdAt)}`);
    console.log(`  status        : ${j.status || '(blank)'}   condition: ${j.condition || '(blank)'}`);
    console.log(`  atId          : ${j.atId ? j.atId : '(EMPTY)'}`);
    console.log(`  inspections   : ${jInsps.length}${jInsps.length ? ' -> ' + jInsps.map(i => i.type || '?').join(', ') : ''}`);
    console.log(`  oil txns (MR) : ${jOil.length}`);
    console.log(`  issued fields : ${issuedFields.length ? issuedFields.map(([k, v]) => `${k}=${v}`).join(', ') : 'NONE'}`);

    const disposable = jInsps.length === 0 && jOil.length === 0 && issuedFields.length === 0;
    console.log(`  -> ${disposable
      ? 'NO downstream reference of any kind. Consistent with a scratch record.'
      : 'HAS downstream references - this job produced something. NOT disposable on appearance.'}`);

    summary.push({
      jobNo: j.jobNo, make: j.make || '', serial: j.serialNo || '', kva: j.capacityKva || '',
      status: j.status || '', inspections: jInsps.length, oilTxns: jOil.length,
      issuedFields: issuedFields.length, verdict: disposable ? 'no references' : 'HAS REFERENCES',
    });
  }

  console.log('\n=== SUMMARY ===');
  console.table(summary);

  const dup = {};
  hits.forEach(j => { (dup[String(j.jobNo ?? '').trim()] ||= []).push(j.id); });
  Object.entries(dup).filter(([, ids]) => ids.length > 1).forEach(([n, ids]) =>
    console.log(`  Job number "${n}" is used by ${ids.length} documents: ${ids.join(', ')} - a real collision, not a display artefact.`));

  const safe = summary.filter(r => r.verdict === 'no references').length;
  console.log(`\n  ${safe} of ${summary.length} have no downstream reference of any kind.`);
  console.log('  Absence of references is evidence they are scratch records. It is not proof:');
  console.log('  a real transformer booked and never inspected would look identical. Match the');
  console.log('  make and serial against the physical intake register before deleting anything.');
  console.log('\nDone. Nothing was written.');
})();
