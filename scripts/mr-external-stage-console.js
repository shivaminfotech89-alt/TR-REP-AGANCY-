// READ-ONLY: why does this MR show External inspection PENDING?
//
// Answers, per job in the MR, exactly what isMrExternalComplete / isJobExternallyDone see:
// the record, its type, whether hasInspectionData accepts it, the job status, and when the
// record was written.
//
// It also tests the specific possibility that the data was never written at all. Between
// AUDIT F23 and F45, inspection creates were DENIED by firestore.rules (a serverTimestamp
// createdAt is neither number nor string, which isValidInspection requires) and the failure
// was silent - the screen showed no error. Saves in that window reached nothing. Edits to
// EXISTING records still worked, which is why it looked intermittent.
//
// It WRITES NOTHING. It reports.
//
// HOW TO RUN: set MR_NO below, npm run dev, sign in, reload the tab, paste in the console.

const MR_NO = '';          // e.g. 'MSBT-12'. Leave empty to scan every incomplete MR.

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs } = fs;

  const user = auth?.currentUser;
  if (!user) { console.error('Not signed in.'); return; }

  const { hasInspectionData, isJobExternallyDone, isMrExternalComplete } =
    await import('/src/lib/inspectionStage.ts');

  const hdr = t => console.log(`\n${'='.repeat(100)}\n${t}\n${'='.repeat(100)}`);
  const snap = async (col, ...c) =>
    (await getDocs(query(collection(db, col), ...c))).docs.map(d => ({ id: d.id, ...d.data() }));

  const [jobs, allInsp] = await Promise.all([
    snap('jobs', where('ownerId', '==', user.uid)),
    snap('inspections', where('ownerId', '==', user.uid)),
  ]);

  const when = v => {
    if (v === undefined || v === null || v === '') return '(none)';
    if (typeof v === 'object' && typeof v.seconds === 'number') return new Date(v.seconds * 1000).toISOString();
    const n = Number(v) || Date.parse(v);
    return isNaN(n) ? String(v) : new Date(n).toISOString();
  };

  // The list the SCREEN passes: External-type records only. isJobExternallyDone itself does
  // NOT filter by type - the caller does - so the same helper on an unfiltered list would
  // accept an Internal record as external evidence.
  const externalOnly = allInsp.filter(i => i.type === 'External');

  const mrsToCheck = MR_NO
    ? [MR_NO]
    : [...new Set(jobs.map(j => j.mrNo).filter(Boolean))]
        .filter(mr => !isMrExternalComplete(jobs.filter(j => j.mrNo === mr), externalOnly));

  if (mrsToCheck.length === 0) { console.log('Every MR is externally complete.'); return; }
  console.log(`MRs reported incomplete: ${mrsToCheck.join(', ')}`);

  mrsToCheck.forEach(mr => {
    const mrJobs = jobs.filter(j => j.mrNo === mr);
    hdr(`MR ${mr} - ${mrJobs.length} job(s)   isMrExternalComplete = ${isMrExternalComplete(mrJobs, externalOnly)}`);

    console.table(mrJobs.map(j => {
      const anyRec = allInsp.filter(i => i.jobId === j.id);
      const extRec = anyRec.filter(i => i.type === 'External');
      const rec = extRec[0];
      return {
        jobNo: j.jobNo,
        jobDocId: j.id,
        status: j.status || '(blank)',
        condition: j.condition || '-',
        isClosed: j.isClosed === true,
        externallyDone: isJobExternallyDone(j, externalOnly),
        extRecords: extRec.length,
        anyRecords: anyRec.length,
        recordTypes: [...new Set(anyRec.map(i => i.type ?? '(missing type)'))].join(',') || '-',
        hasData: rec ? hasInspectionData(rec) : '(no record)',
        dataKeys: rec ? Object.keys(rec.data || {}).length : '-',
        recordCreatedAt: rec ? when(rec.createdAt) : '-',
        recordUpdatedAt: rec ? when(rec.updatedAt) : '-',
      };
    }));

    const failing = mrJobs.filter(j => !isJobExternallyDone(j, externalOnly));
    console.log(`\nJobs failing isJobExternallyDone: ${failing.map(j => j.jobNo).join(', ') || 'none'}`);

    failing.forEach(j => {
      const anyRec = allInsp.filter(i => i.jobId === j.id);
      console.log(`\n  ${j.jobNo}:`);
      if (anyRec.length === 0) {
        console.log('    NO inspection record of any type exists for this job.');
        console.log('    -> Either it was never saved, or it was saved during the window when');
        console.log('       creates were denied (F23..F45) and nothing was written.');
      } else {
        anyRec.forEach(i => console.log(
          `    record ${i.id}  type=${JSON.stringify(i.type ?? null)}  dataKeys=${Object.keys(i.data || {}).length}` +
          `  hasInspectionData=${hasInspectionData(i)}  createdAt=${when(i.createdAt)}`));
        if (!anyRec.some(i => i.type === 'External')) {
          console.log('    -> Records exist but NONE has type "External", so the screen cannot see them.');
        }
        if (anyRec.some(i => i.type === 'External' && !i.data)) {
          console.log('    -> An External record exists with NO `data` object, which hasInspectionData rejects.');
        }
      }
      console.log(`    status=${JSON.stringify(j.status ?? null)} - counts as done only if one of:`);
      console.log('       External Done | Internal Done | Tested - Ready for Dispatch | Dispatched');
    });
  });

  // ---- was anything written at all in the outage window? ----
  hdr('WHEN EXTERNAL RECORDS WERE WRITTEN');
  const stamps = externalOnly
    .map(i => ({ id: i.id, jobId: i.jobId, createdAt: when(i.createdAt), updatedAt: when(i.updatedAt) }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  console.table(stamps.slice(0, 25));
  console.log('');
  console.log('A gap in createdAt covering the time the operator remembers inspecting is the');
  console.log('signature of the silent-denial window: nothing was written, so nothing is here');
  console.log('to find. Inspections saved then must be re-entered - the display is correct.');
  console.log('');
  console.log('Note the batch: one Save writes EVERY job in the MR together, so a denial loses');
  console.log('the whole MR rather than one job. An MR with zero external records, whose');
  console.log('operator recalls completing it, is that case.');

  window.__mrExternal = { jobs, allInsp, externalOnly, mrsToCheck };
  console.log('\nFull results: window.__mrExternal');
})();
