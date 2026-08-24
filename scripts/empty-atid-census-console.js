// JOBS WITH NO AT, AND WHETHER THEIR AT COULD BE DERIVED
//
// READ-ONLY. No set/update/delete/batch anywhere in this file.
//
// Paste into the browser console on a DEV build, signed in. Run once per account.
//
// WHY
// ---
// If the estimate master moves to the AT, a job's rates would resolve through its own
// `atId`. A job with no `atId` then has no rate source, and what to do about that is
// either a footnote or the main design constraint depending on one number.
//
// It also asks the more useful question: for each job missing an `atId`, is there exactly
// ONE AT of that agency whose date range covers the job? If so the value is DERIVABLE and
// the gap is a backfill rather than a design problem. If several ATs overlap, or none does,
// it is not derivable and someone has to decide per job.
//
// The job date used is the MR date, falling back to createdAt - the same date the job was
// booked under, which is what determines the tender it was worked under.

(async () => {
  const { collection, query, where, getDocs } = window.__fs;
  const db = window.__db, uid = window.__auth.currentUser?.uid;
  const email = window.__auth.currentUser?.email || '(unknown)';
  const toMs = window.__utils?.toMillis;
  if (!db || !uid) { console.error('Sign in first - window.__db / __auth not ready.'); return; }
  if (!toMs) {
    console.error('window.__utils.toMillis is missing - update src/lib/firebase.ts, run on a DEV build.');
    console.error('Refusing to hand-roll a date parser; that is what produced a wrong date in F58.');
    return;
  }

  const issued = j =>
    j.estimateStatus === 'Sent' || !!j.estimateSentDate ||
    j.billStatus === 'Sent' || !!j.billSentDate ||
    (!!j.billNo && String(j.billNo).trim() !== '') ||
    j.paymentStatus === 'Paid';

  const agSnap = await getDocs(query(collection(db, 'agencies'), where('ownerId', '==', uid)));
  const agencies = [];
  agSnap.forEach(d => agencies.push({ id: d.id, ...d.data() }));

  const atSnap = await getDocs(query(collection(db, 'atMasters'), where('ownerId', '==', uid)));
  const ats = [];
  atSnap.forEach(d => ats.push({ id: d.id, ...d.data() }));

  console.log(`\nSigned in as ${email} - ${agencies.length} agencies, ${ats.length} AT records\n`);

  // The AT NUMBER as typed, per agency. This is the free-text join key the design question
  // turns on: if one tender appears under several spellings, a normalising key would have
  // to reconcile them.
  const spellings = {};
  ats.forEach(a => {
    const k = String(a.atNumber ?? a.name ?? '').trim();
    (spellings[k] ||= []).push(a.agencyId);
  });
  console.log('=== AT NUMBERS AS TYPED (the join-key question) ===');
  Object.entries(spellings).forEach(([k, ids]) =>
    console.log(`  "${k}"  -  ${ids.length} record(s)`));
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const collapsed = {};
  Object.keys(spellings).forEach(k => { (collapsed[norm(k)] ||= []).push(k); });
  const variants = Object.entries(collapsed).filter(([, v]) => v.length > 1);
  console.log(variants.length
    ? `  ${variants.length} tender(s) spelled more than one way: ` +
      variants.map(([, v]) => v.map(x => `"${x}"`).join(' / ')).join('; ')
    : '  No tender is spelled two ways today. That is luck, not a constraint.');

  let grandMissing = 0, grandIssued = 0, grandDerivable = 0, grandTotal = 0;
  const undecidable = [];

  for (const ag of agencies) {
    const jSnap = await getDocs(query(collection(db, 'jobs'), where('agencyId', '==', ag.id)));
    const jobs = [];
    jSnap.forEach(d => jobs.push({ id: d.id, ...d.data() }));
    const agAts = ats.filter(a => a.agencyId === ag.id);

    const missing = jobs.filter(j => !j.atId || String(j.atId).trim() === '');
    grandTotal += jobs.length;
    grandMissing += missing.length;

    console.log(`\n=== ${ag.name || ag.id} ===`);
    console.log(`  ${jobs.length} jobs, ${missing.length} with no atId, ${agAts.length} AT record(s)`);
    if (missing.length === 0) continue;

    const rows = missing.map(j => {
      // `dateOfIssue` is the MR's date of issue - the date the unit was received under
      // that tender, which is what decides which AT the job belongs to. `mrDate` is
      // accepted as a second name because some records carry it. createdAt is the last
      // resort and is weaker evidence: it is when the row was typed, not when the unit
      // arrived, and backdated entry is normal here.
      const when = toMs(j.dateOfIssue) ?? toMs(j.mrDate) ?? toMs(j.createdAt);
      const covering = when === null ? [] : agAts.filter(a => {
        const s = toMs(a.startDate), e = toMs(a.endDate);
        return s !== null && e !== null && when >= s && when <= e;
      });
      const wasIssued = issued(j);
      if (wasIssued) grandIssued++;
      if (covering.length === 1) grandDerivable++;
      else undecidable.push(`${ag.name || ag.id}/${j.jobNo || j.id}`);
      return {
        jobNo: j.jobNo || j.id,
        mrNo: j.mrNo || '-',
        date: when === null ? '(no date)' : new Date(when).toLocaleDateString('en-IN'),
        issued: wasIssued ? 'ISSUED' : 'no',
        coveringAts: covering.length,
        derivable: covering.length === 1
          ? `YES -> ${covering[0].atNumber || covering[0].name || covering[0].id}`
          : covering.length === 0 ? 'no AT covers this date' : `${covering.length} ATs overlap`,
      };
    });
    console.table(rows);
  }

  console.log('\n=== VERDICT ===');
  console.log(`  jobs total                      : ${grandTotal}`);
  console.log(`  with no atId                    : ${grandMissing}`);
  console.log(`  of those, with issued documents : ${grandIssued}`);
  console.log(`  of those, AT derivable by date  : ${grandDerivable}`);
  console.log(`  not derivable                   : ${grandMissing - grandDerivable}`);
  if (grandMissing === 0) {
    console.log('\n  Every job records its AT. An AT-keyed master has a source for every job,');
    console.log('  and the empty-atId fallback is a footnote rather than a design constraint.');
  } else if (grandMissing === grandDerivable) {
    console.log('\n  Every missing atId is derivable from the job date and a single covering AT.');
    console.log('  This is a BACKFILL, not a design problem - but the backfill has to happen');
    console.log('  before rates move, or those jobs lose their rate source at the switch.');
  } else {
    console.log('\n  Some jobs cannot have their AT derived:');
    undecidable.slice(0, 25).forEach(x => console.log(`    ${x}`));
    if (undecidable.length > 25) console.log(`    ... and ${undecidable.length - 25} more`);
    console.log('  These need a decided fallback, per job or as a rule. The count above is what');
    console.log('  decides whether that rule is a footnote or the main constraint.');
  }
  console.log('\nDone. Nothing was written.');
})();
