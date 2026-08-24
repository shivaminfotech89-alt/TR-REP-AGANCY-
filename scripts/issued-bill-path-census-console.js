// WHICH CODE PATH COMPUTED EACH ISSUED BILL?
//
// READ-ONLY. No set/update/delete/batch anywhere in this file.
//
// Paste into the browser console with the app open and signed in.
//
// THE QUESTION
// ------------
// `BillingSystem.calculateJobTotal` has three branches:
//
//   scrap      -> resolveScrapCharge          (shared helper - correct)
//   amorphous  -> getJobFullEstimate          (the real builder - correct)
//   itemised   -> its own item loop           (CRGO + Overhauling - the parallel engine)
//
// Only the third is being consolidated. So the question that decides whether consolidation
// is safe is not "how many bills exist" but "how many ISSUED bills went through the
// ITEMISED branch" - those are the ones whose stored billAmount was computed by rules the
// estimate does not use.
//
// A job is counted as issued if it carries billStatus 'Sent', a billSentDate, or a billNo.
// GP jobs are excluded, exactly as jobsForBillType does, because they are never billed.

(async () => {
  const { collection, query, where, getDocs } = window.__fs;
  const db = window.__db, uid = window.__auth.currentUser?.uid;
  if (!db || !uid) { console.error('Sign in first - window.__db / __auth not ready.'); return; }

  // mirrors classifyCoreType / isGpJob without importing them
  const branchFor = (job) => {
    if (job.status === 'Scrap' || job.condition === 'Scrap') return 'scrap';
    const t = String(job.coreType || 'CRGO').trim().toUpperCase();
    if (t.includes('AMORPHOUS') || t.includes('AM') || t.includes('WOUND') || t.includes('WC')) return 'amorphous';
    return 'ITEMISED';
  };
  const isGp = (job) =>
    String(job.repairType || '').trim().toUpperCase() === 'GP' || job.isGp === true;
  const issued = (job) =>
    job.billStatus === 'Sent' || !!job.billSentDate || (!!job.billNo && String(job.billNo).trim() !== '');

  const agSnap = await getDocs(query(collection(db, 'agencies'), where('ownerId', '==', uid)));
  const agencies = [];
  agSnap.forEach(d => agencies.push({ id: d.id, ...d.data() }));

  const grand = { scrap: 0, amorphous: 0, ITEMISED: 0 };
  let grandValue = 0;
  const itemisedJobs = [];

  for (const ag of agencies) {
    const jobsSnap = await getDocs(query(collection(db, 'jobs'), where('agencyId', '==', ag.id)));
    const jobs = [];
    jobsSnap.forEach(d => jobs.push({ id: d.id, ...d.data() }));

    const billed = jobs.filter(j => issued(j) && !isGp(j));
    const counts = { scrap: 0, amorphous: 0, ITEMISED: 0 };
    let value = 0;

    billed.forEach(j => {
      const b = branchFor(j);
      counts[b]++;
      if (b === 'ITEMISED') {
        value += Number(j.billAmount) || 0;
        itemisedJobs.push({
          agency: ag.name || ag.id,
          jobNo: j.jobNo || j.id,
          kva: j.capacityKva,
          coreType: j.coreType || 'CRGO',
          billNo: j.billNo || '-',
          billAmount: Number(j.billAmount) || 0,
          billSentDate: j.billSentDate || '-',
          paid: j.paymentStatus === 'Paid',
        });
      }
    });

    console.log(`\n=== ${ag.name || ag.id} - ${billed.length} issued, non-GP bills ===`);
    console.log(`   scrap branch      (resolveScrapCharge) : ${counts.scrap}`);
    console.log(`   amorphous branch  (getJobFullEstimate) : ${counts.amorphous}`);
    console.log(`   ITEMISED branch   (parallel engine)    : ${counts.ITEMISED}   <-- the ones that matter`);
    if (counts.ITEMISED > 0) console.log(`   billAmount on itemised-branch bills     : Rs ${value.toFixed(2)}`);
    grand.scrap += counts.scrap; grand.amorphous += counts.amorphous; grand.ITEMISED += counts.ITEMISED;
    grandValue += value;
  }

  if (itemisedJobs.length) {
    console.log('\n=== ISSUED BILLS COMPUTED BY THE PARALLEL ENGINE ===');
    console.table(itemisedJobs);
  }

  console.log('\n=== VERDICT ===');
  console.log(`  issued bills via scrap branch     : ${grand.scrap}`);
  console.log(`  issued bills via amorphous branch : ${grand.amorphous}`);
  console.log(`  issued bills via ITEMISED branch  : ${grand.ITEMISED}`);
  if (grand.ITEMISED === 0) {
    console.log('\n  NO ISSUED BILL WENT THROUGH THE ITEMISED BRANCH.');
    console.log('  Consolidating it changes no document that has already been sent.');
    console.log('  Every issued bill was computed by resolveScrapCharge or getJobFullEstimate,');
    console.log('  both of which the consolidation leaves untouched.');
  } else {
    console.log(`\n  ${grand.ITEMISED} ISSUED BILL(S) WERE COMPUTED BY THE PARALLEL ENGINE,`);
    console.log(`  carrying Rs ${grandValue.toFixed(2)} of stored billAmount.`);
    console.log('  Consolidating changes what a REPRINT or a re-send of those would produce.');
    console.log('  The stored billAmount is not rewritten by the change - but it will no longer');
    console.log('  match what the screen computes, and that difference needs a decision:');
    console.log('  coil-heavy jobs were UNDER-billed (a 47 kg coil billed as qty 1), while jobs');
    console.log('  needing little were OVER-billed (every unit:Y item charged regardless of');
    console.log('  what the inspection found). The two do not cancel.');
  }
  console.log('\nDone. Nothing was written.');
})();
