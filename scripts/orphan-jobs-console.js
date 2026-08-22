// READ-ONLY: jobs that belong to no visible agency.
//
// WHY: the "Move ALL My Data To Active Agency" button is being removed. It is unscoped -
// it reassigns EVERY job of the signed-in owner to whichever agency happens to be active,
// irreversibly - while its label describes a narrow symptom ("older jobs not showing up").
// But it is currently the ONLY thing in the app that can rescue a job whose agencyId is
// empty or points at an agency that no longer exists: such a job is invisible in every
// agency-scoped view, so no screen can reach it to correct it.
//
// This counts that population. If it is zero, the button has no legitimate case left and
// removing it costs nothing. If it is not zero, the remedy is a TARGETED repair naming
// those jobs, not a bulk move - and this script is what names them.
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

  // Scoped by ownerId only - deliberately NOT by agencyId, since the whole point is to
  // find records an agency-scoped query cannot see.
  const [agencies, atMasters, jobs] = await Promise.all([
    snap('agencies', where('ownerId', '==', uid)),
    snap('atMasters', where('ownerId', '==', uid)),
    snap('jobs', where('ownerId', '==', uid)),
  ]);

  const hdr = t => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
  const agencyById = Object.fromEntries(agencies.map(a => [a.id, a]));
  const atById = Object.fromEntries(atMasters.map(a => [a.id, a]));

  const noAgencyId = jobs.filter(j => !String(j.agencyId ?? '').trim());
  const danglingAgencyId = jobs.filter(j => {
    const id = String(j.agencyId ?? '').trim();
    return id && !agencyById[id];
  });
  const orphans = [...noAgencyId, ...danglingAgencyId];

  hdr(`ORPHANED JOBS - ${orphans.length} of ${jobs.length}`);
  console.log(`  no agencyId at all            : ${noAgencyId.length}`);
  console.log(`  agencyId matches no agency    : ${danglingAgencyId.length}`);
  console.log(`  agencies visible to this user : ${agencies.length}`);

  if (orphans.length === 0) {
    console.log('');
    console.log('NOTHING IS STRANDED. Every job resolves to an existing agency, so the bulk');
    console.log('move has no case left to serve and removing it loses no remedy.');
    window.__orphanJobs = { orphans: [], noAgencyId: [], danglingAgencyId: [] };
    console.log('\nFull results: window.__orphanJobs');
    return;
  }

  // For a TARGETED repair the question is not "where shall we put it" but "where does the
  // evidence say it belongs". The job's own atId is the strongest signal available: an AT
  // belongs to exactly one agency, and NewJob stamps atId from the same active AT it
  // stamps agencyId from. Where that resolves, the correct agency is not a guess.
  const inferAgency = j => {
    const at = j.atId ? atById[j.atId] : null;
    if (at && agencyById[at.agencyId]) {
      return { id: at.agencyId, name: agencyById[at.agencyId].name || at.agencyId, basis: `atId -> AT ${at.atNumber || at.id}` };
    }
    // Second signal: another job on the same MR. MRs do not span agencies.
    if (j.mrNo) {
      const sibling = jobs.find(o =>
        o.id !== j.id && o.mrNo === j.mrNo && agencyById[String(o.agencyId ?? '').trim()]
      );
      if (sibling) {
        return { id: sibling.agencyId, name: agencyById[sibling.agencyId].name || sibling.agencyId, basis: `same MR as job ${sibling.jobNo}` };
      }
    }
    // Third, and only when there is exactly one agency - then there is no ambiguity to
    // resolve. With several, the data does not say, and a human must.
    if (agencies.length === 1) {
      return { id: agencies[0].id, name: agencies[0].name || agencies[0].id, basis: 'only one agency exists' };
    }
    return { id: '', name: '(UNKNOWN - needs a human)', basis: 'no evidence in the record' };
  };

  const rows = orphans.map(j => {
    const inferred = inferAgency(j);
    return {
      jobNo: j.jobNo || '(none)',
      docId: j.id,
      problem: String(j.agencyId ?? '').trim() ? `agencyId ${j.agencyId} not found` : 'no agencyId',
      mrNo: j.mrNo || '',
      division: j.division || '',
      coreType: j.coreType || '',
      repairType: j.repairType || '',
      make: j.make || '',
      serialNo: j.serialNo || '',
      status: j.status || '',
      createdAt: j.createdAt || '(none)',
      belongsTo: inferred.name,
      basis: inferred.basis,
      // Whether anything has been issued against it - decides repair vs delete.
      hasIssuedDocuments: Boolean(j.estimateSentDate || j.billNo || j.challanNo || j.billSentDate),
    };
  });

  console.table(rows);

  const resolvable = rows.filter(r => r.basis !== 'no evidence in the record');
  const unresolvable = rows.filter(r => r.basis === 'no evidence in the record');
  const withDocs = rows.filter(r => r.hasIssuedDocuments);

  hdr('WHAT A TARGETED REPAIR WOULD LOOK LIKE');
  console.log(`  resolvable from the record : ${resolvable.length}  (atId, sibling MR, or a single agency)`);
  console.log(`  needs a human decision     : ${unresolvable.length}`);
  console.log(`  have issued documents      : ${withDocs.length}  <- repair these, never delete them`);
  console.log('');
  console.log('The repair is per job, to the agency the EVIDENCE names, with the job number');
  console.log('and target shown for confirmation - not a bulk move to whichever agency is');
  console.log('active. Where the basis reads "no evidence in the record", nothing should be');
  console.log('written automatically: the data cannot distinguish the right answer, and a');
  console.log('confident wrong reassignment is worse than a visible gap.');
  console.log('');
  console.log('NOTE the difference from the button being removed: it moved EVERY job of the');
  console.log('owner, including ones already correctly assigned to another agency.');

  window.__orphanJobs = { orphans, noAgencyId, danglingAgencyId, rows, resolvable, unresolvable, withDocs };
  console.log('\nFull results: window.__orphanJobs');
})();
