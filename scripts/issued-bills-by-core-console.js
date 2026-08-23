// READ-ONLY: which bills have actually been ISSUED, for which core types, and at what
// amount - with the zero-value ones called out.
//
// THE QUESTION: Amorphous and Wound Core bills were computed by walking the estimate master
// (BillingSystem.calculateJobTotal has no core-type branch), and the three agencies holding
// the 10-item placeholder had every rate null or zero. calculateJobTotal only accumulates
// where `rate > 0`, so a repairable Amorphous bill under those agencies totalled ZERO.
//
// If such a bill was SENT, that is a bill issued to UGVCL for nothing - a commercial
// problem independent of what is decided about the pricing model (AUDIT O16).
//
// `billAmount` is frozen on the job at bill time, so this reports what was actually issued,
// not what the app would compute today.
//
// It WRITES NOTHING. It reports.
//
// HOW TO RUN: sign in as the owner, reload the tab, paste into the DevTools console.

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs } = fs;

  const user = auth?.currentUser;
  if (!user) { console.error('Not signed in.'); return; }

  const { classifyCoreType } = await import('/src/components/SingleJobEstimateReport.tsx');

  const hdr = t => console.log(`\n${'='.repeat(104)}\n${t}\n${'='.repeat(104)}`);
  const snap = async (col, ...c) =>
    (await getDocs(query(collection(db, col), ...c))).docs.map(d => ({ id: d.id, ...d.data() }));

  const [agencies, jobs] = await Promise.all([
    snap('agencies', where('ownerId', '==', user.uid)),
    snap('jobs', where('ownerId', '==', user.uid)),
  ]);
  const agencyName = id => agencies.find(a => a.id === id)?.name || id || '(none)';

  // Issued = a bill number exists. billSentDate alone is weaker (it can be entered from the
  // Reports lifecycle-dates modal without a number), so both are reported.
  const billed = jobs.filter(j => String(j.billNo ?? '').trim() || String(j.billSentDate ?? '').trim());

  const rows = billed.map(j => {
    const cls = classifyCoreType(j.coreType || 'CRGO');
    const amt = j.billAmount;
    return {
      jobNo: j.jobNo,
      agency: agencyName(j.agencyId),
      coreType: j.coreType || 'CRGO',
      coreClass: cls,
      isScrap: j.status === 'Scrap' || j.condition === 'Scrap',
      billNo: j.billNo || '(none - date only)',
      billSentDate: j.billSentDate || '-',
      billStatus: j.billStatus || '-',
      billAmount: amt === undefined || amt === null ? '(not stored)' : amt,
      zeroOrMissing: !(Number(amt) > 0),
      paymentStatus: j.paymentStatus || '-',
      paidAmount: j.paidAmount ?? '-',
      mrNo: j.mrNo || '-',
    };
  });

  hdr(`ISSUED BILLS - ${rows.length} job(s) carry a billNo or billSentDate`);
  if (rows.length === 0) { console.log('(none)'); }
  else console.table(rows);

  const fixedRate = rows.filter(r => r.coreClass === 'AMORPHOUS' || r.coreClass === 'WOUND_CORE');
  const fixedRepairable = fixedRate.filter(r => !r.isScrap);
  const zeroed = fixedRepairable.filter(r => r.zeroOrMissing);

  hdr('THE ANSWER');
  console.log(`bills issued, all core types            : ${rows.length}`);
  console.log(`  Amorphous or Wound Core               : ${fixedRate.length}`);
  console.log(`    of those, repairable (not scrap)    : ${fixedRepairable.length}   <- priced by the master walk`);
  console.log(`    of those, billAmount 0 or missing   : ${zeroed.length}   <- ISSUED FOR NOTHING if sent`);
  console.log('');
  if (zeroed.length === 0) {
    console.log('No Amorphous or Wound Core repair bill was issued at zero. Either none was');
    console.log('issued at all, or those that were carried a real amount - check the coreClass');
    console.log('column above to see which.');
  } else {
    console.log('*** BILLS ISSUED AT ZERO - each of these needs checking against the paper ***');
    zeroed.forEach(r => console.log(
      `  ${r.jobNo}  ${r.agency}  ${r.coreType}  billNo ${r.billNo}  sent ${r.billSentDate}  ` +
      `amount ${r.billAmount}  payment ${r.paymentStatus}`
    ));
    console.log('');
    console.log('billAmount is what the app stored at bill time. A zero here means the bill');
    console.log('total computed to nothing - the master it walked had no rate above zero for');
    console.log('that capacity. Whether a zero-value document actually left the building is a');
    console.log('question for the printed copy and the division office, not for this database.');
  }

  hdr('WHAT THIS DOES NOT TELL YOU');
  console.log('- Whether the printed bill matched billAmount. The document is rendered');
  console.log('  separately from this stored figure; the paper is the authority.');
  console.log('- What the same job would bill today. The master repair changed the inputs, so');
  console.log('  a recomputation now would differ - that is O16, not a fault in these rows.');
  console.log('- Anything about estimates. Amorphous and Wound Core ESTIMATES never read the');
  console.log('  master; they price from the hardcoded Schedule-B table and were unaffected.');

  window.__issuedBills = { rows, fixedRate, fixedRepairable, zeroed };
  console.log('\nFull results: window.__issuedBills');
})();
