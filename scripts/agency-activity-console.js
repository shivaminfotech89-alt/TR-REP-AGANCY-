// READ-ONLY: is this agency doing real work, or is it a test record?
//
// The question that decides whether an agency needs the estimate-master repair. An agency
// that has issued estimates, bills or challans is committed to documents naming it as
// supplier; one with no jobs at all has committed to nothing and can be left or deleted.
//
// Reports evidence, not a verdict. "Looks like a test record" is a judgement about a
// business, and the data can only say what was done under it.
//
// Prints the OWNER uid beside every agency, because agency NAMES are not unique across
// owners - two different agencies named "suchit" exist under two accounts, which is how a
// repair was once verified against the wrong document (AUDIT F36).
//
// It WRITES NOTHING. It reports.
//
// HOW TO RUN: npm run dev, log in, reload the tab, paste into the DevTools console.

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs } = fs;

  const user = auth?.currentUser;
  if (!user) { console.error('Not signed in.'); return; }

  const hdr = t => console.log(`\n${'='.repeat(96)}\n${t}\n${'='.repeat(96)}`);
  const snap = async (col, ...c) =>
    (await getDocs(query(collection(db, col), ...c))).docs.map(d => ({ id: d.id, ...d.data() }));

  const [agencies, jobs, atMasters, oilTx, inspections] = await Promise.all([
    snap('agencies', where('ownerId', '==', user.uid)),
    snap('jobs', where('ownerId', '==', user.uid)),
    snap('atMasters', where('ownerId', '==', user.uid)),
    snap('oilTransactions', where('ownerId', '==', user.uid)),
    snap('inspections', where('ownerId', '==', user.uid)),
  ]);

  console.log(`Signed in as ${user.email} (uid ${user.uid})`);
  console.log('This lists ONLY agencies owned by this account. Another account may own');
  console.log('agencies with the same names - check the ownerId column before acting.');

  const jobIdsByAgency = {};
  jobs.forEach(j => { (jobIdsByAgency[j.agencyId] ||= []).push(j); });

  const rows = agencies.map(a => {
    const js = jobIdsByAgency[a.id] || [];
    const jobIds = new Set(js.map(j => j.id));
    const issued = js.filter(j => j.estimateSentDate || j.billNo || j.billSentDate || j.challanNo);
    const dispatched = js.filter(j => j.status === 'Dispatched');
    const mrs = new Set(js.map(j => j.mrNo).filter(Boolean));
    const insp = inspections.filter(i => i.jobId && jobIds.has(i.jobId));
    const oil = oilTx.filter(t => t.mrNo && mrs.has(String(t.mrNo).trim()));
    const dates = js.map(j => j.createdAt).filter(Boolean).map(v => Number(v) || Date.parse(v)).filter(n => !isNaN(n));

    return {
      name: a.name || '(unnamed)',
      docId: a.id,
      ownerId: a.ownerId || '(none)',
      jobs: js.length,
      mrs: mrs.size,
      inspections: insp.length,
      oilTransactions: oil.length,
      atMasters: atMasters.filter(m => m.agencyId === a.id).length,
      withIssuedDocuments: issued.length,
      dispatched: dispatched.length,
      billNos: [...new Set(issued.map(j => j.billNo).filter(Boolean))].slice(0, 4).join(', ') || '-',
      firstJob: dates.length ? new Date(Math.min(...dates)).toISOString().split('T')[0] : '-',
      lastJob: dates.length ? new Date(Math.max(...dates)).toISOString().split('T')[0] : '-',
      hasGstin: Boolean(String(a.gstin ?? '').trim()),
    };
  });

  hdr(`AGENCY ACTIVITY - ${agencies.length} agencies owned by this account`);
  console.table(rows);

  hdr('READING THIS');
  console.log('withIssuedDocuments > 0  -> an estimate, bill or challan names this agency as');
  console.log('    supplier. It is committed to paperwork and needs the estimate-master repair,');
  console.log('    whatever its name suggests.');
  console.log('');
  console.log('jobs = 0 and atMasters = 0  -> nothing has ever been booked under it. Nothing');
  console.log('    downstream depends on its master, so repairing it is optional - but note a');
  console.log('    NEW job could be created under it tomorrow, and it would price from whatever');
  console.log('    its sections hold.');
  console.log('');
  console.log('jobs > 0 with withIssuedDocuments = 0  -> real intake, nothing issued yet. This');
  console.log('    is the case where repairing FIRST is cheapest: the master is read the moment');
  console.log('    the first estimate is produced.');
  console.log('');
  console.log('None of this decides whether an agency is "real" - only someone who knows the');
  console.log('business can. It reports what has been done under each one.');

  window.__agencyActivity = { rows, signedInAs: user.email, uid: user.uid };
  console.log('\nFull results: window.__agencyActivity');
})();
