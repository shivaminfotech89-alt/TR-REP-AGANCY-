// HAS THE CONSERVATOR TANK LINE EVER BEEN CHARGED?
//
// READ-ONLY. No set/update/delete/batch anywhere in this file.
//
// Paste into the browser console with the app open and signed in.
//
// THE QUESTION
// ------------
// Estimate item '4' (Conservator Tank Replacement) prices at Schedule-A '18b', Rs 54 PER
// KILOGRAM. It takes its quantity from `damCtTank`, which is an integer COUNT of damaged
// conservator tanks - so a flagged conservator bills 1 x 54 = Rs 54 where a real one weighs
// tens of kilograms.
//
// Before building a weight-capture UI for that line, the thing worth knowing is whether the
// line has ever been claimed at all. If no issued estimate or bill has ever carried it, the
// under-charge is theoretical and the fix is documentation, not a field.
//
// This reports, per job with damCtTank > 0:
//   - the flagged count
//   - whether an estimate was sent, a bill was sent, or payment recorded
//   - what the conservator line would have totalled at the rate that agency resolves
//
// It does NOT re-derive the estimate. It reads the flag and the agency's rate for item '4',
// falling back to Schedule-A 18b (Rs 54/kg) exactly as resolveRate does. That is enough to
// answer "was anything claimed", which is the decision this is for.

(async () => {
  const { collection, query, where, getDocs } = window.__fs;
  const db = window.__db, uid = window.__auth.currentUser?.uid;
  if (!db || !uid) { console.error('Sign in first - window.__db / __auth not ready.'); return; }

  const SCHEDULE_18B = 54;   // Schedule-A '18b', flat across all bands

  const agSnap = await getDocs(query(collection(db, 'agencies'), where('ownerId', '==', uid)));
  const agencies = [];
  agSnap.forEach(d => agencies.push({ id: d.id, ...d.data() }));

  let grandFlagged = 0, grandIssued = 0, grandValue = 0;

  for (const ag of agencies) {
    const jobsSnap = await getDocs(query(collection(db, 'jobs'), where('agencyId', '==', ag.id)));
    const jobs = [];
    jobsSnap.forEach(d => jobs.push({ id: d.id, ...d.data() }));

    // external inspections, keyed by job
    const inspSnap = await getDocs(query(collection(db, 'inspections'), where('agencyId', '==', ag.id)));
    const ext = {};
    inspSnap.forEach(d => {
      const v = d.data();
      if (String(v.type || '').toLowerCase() === 'external' && v.jobId) ext[v.jobId] = v.data || v;
    });

    // the agency's own rate for item '4', per capacity, else Schedule-A
    const master = ag.estimateMasterCRGO || [];
    const row4 = master.find(m => String(m.itemCode || '').trim() === '4');
    const rateFor = kva => {
      const r = row4?.rates?.[String(kva)];
      return (r !== null && r !== undefined && Number(r) > 0) ? Number(r) : SCHEDULE_18B;
    };

    const flagged = jobs
      .map(j => ({ j, ct: Number(ext[j.id]?.damCtTank) || 0 }))
      .filter(x => x.ct > 0);

    console.log(`\n=== ${ag.name || ag.id} - ${jobs.length} jobs, ${flagged.length} with damCtTank > 0 ===`);
    if (flagged.length === 0) { console.log('  None. The conservator line has never had a quantity on this agency.'); continue; }

    let issued = 0, value = 0;
    flagged.forEach(({ j, ct }) => {
      const estSent = j.estimateStatus === 'Sent' || !!j.estimateSentDate;
      const billSent = j.billStatus === 'Sent' || !!j.billSentDate;
      const paid = j.paymentStatus === 'Paid';
      const wasIssued = estSent || billSent || paid;
      const amt = ct * rateFor(j.capacityKva);
      if (wasIssued) { issued++; value += amt; }
      const marks = [estSent && 'estimate sent', billSent && 'bill sent', paid && 'PAID'].filter(Boolean).join(', ');
      console.log(`  JOB ${j.jobNo || j.id}  ${j.capacityKva} kVA  MR ${j.mrNo || '-'}  damCtTank=${ct}`);
      console.log(`     conservator line: ${ct} x ${rateFor(j.capacityKva).toFixed(2)} = Rs ${amt.toFixed(2)}`);
      console.log(`     ${wasIssued ? 'ISSUED -> ' + marks : 'not issued (no estimate or bill sent)'}`);
    });
    console.log(`  -> ${issued} of ${flagged.length} issued, Rs ${value.toFixed(2)} of conservator charge on issued documents.`);
    grandFlagged += flagged.length; grandIssued += issued; grandValue += value;
  }

  console.log('\n=== VERDICT ===');
  console.log(`  jobs with a conservator flagged : ${grandFlagged}`);
  console.log(`  of those, issued               : ${grandIssued}`);
  console.log(`  conservator charge on issued    : Rs ${grandValue.toFixed(2)}`);
  if (grandIssued === 0) {
    console.log('\n  NOTHING HAS EVER BEEN CLAIMED ON THIS LINE.');
    console.log('  The count-priced-as-kilograms defect is real but has produced no wrong');
    console.log('  document. Fixing it with a capture UI would be building a field for work');
    console.log('  nobody bills. Record it instead, and revisit if a conservator is ever flagged.');
  } else {
    console.log('\n  The line HAS been claimed. Each issued document under-charged by');
    console.log('  (actual weight in kg - flagged count) x rate - i.e. by roughly the whole');
    console.log('  line, since a conservator weighs tens of kg and was billed as 1.');
  }
  console.log('\nDone. Nothing was written.');
})();
