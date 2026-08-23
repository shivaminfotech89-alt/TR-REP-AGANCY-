// READ-ONLY, CROSS-OWNER: every Amorphous or Wound Core job with a bill number, what it was
// ISSUED at, and what BillingSystem.calculateJobTotal would produce for it TODAY against the
// corrected master.
//
// WHY: those bills are priced by walking the estimate master (BillingSystem has no core-type
// branch - AUDIT O16), and the agencies holding the 10-item placeholder had every rate null
// or zero. calculateJobTotal only accumulates where `rate > 0`, so a repairable Amorphous
// bill under those agencies totalled ZERO. A zero-value bill sent to UGVCL is a commercial
// problem regardless of what is decided about the pricing model.
//
// `billAmount` on the job is FROZEN at bill time - it is what was issued. The recomputation
// below is what the same job would bill now. The two differing is the point, not an error.
//
// YOU SHOULD BE SIGNED IN AS THE SUPER ADMIN so this covers every owner. As anyone else it
// silently narrows to your own agencies, which would look like a complete answer and would
// not be one (AUDIT F36). The script reports which it got.
//
// It WRITES NOTHING. It reports.
//
// HOW TO RUN: npm run dev, sign in as super admin, reload the tab, paste in the console.

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, getDocs, doc, getDoc } = fs;

  const user = auth?.currentUser;
  if (!user) { console.error('Not signed in.'); return; }

  const { getEstimateMasterForCore, getAtPercentageForCore } = await import('/src/lib/AgencyContext.tsx');
  const { resolveScrapCharge, getScrapItemCodeForCore } = await import('/src/lib/estimateCalc.ts');
  const { classifyCoreType } = await import('/src/components/SingleJobEstimateReport.tsx');

  const hdr = t => console.log(`\n${'='.repeat(110)}\n${t}\n${'='.repeat(110)}`);

  let agencies = [], jobs = [], atMasters = [];
  try {
    [agencies, jobs, atMasters] = await Promise.all([
      getDocs(collection(db, 'agencies')).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))),
      getDocs(collection(db, 'jobs')).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))),
      getDocs(collection(db, 'atMasters')).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))),
    ]);
  } catch (e) {
    console.error('Could not read across owners:', e?.message || e);
    console.error('Sign in as the super admin. Signed in as:', user.email);
    return;
  }

  let globalDefault = null;
  try {
    const sn = await getDoc(doc(db, 'public_config', 'estimate_master'));
    globalDefault = sn.exists() ? sn.data() : null;
  } catch (e) { console.warn('public_config unreadable - fallbacks will use shipped defaults:', e?.message || e); }

  const owners = [...new Set(agencies.map(a => a.ownerId || '(none)'))];
  const agencyById = Object.fromEntries(agencies.map(a => [a.id, a]));
  const atById = Object.fromEntries(atMasters.map(a => [a.id, a]));

  hdr('SCOPE');
  console.log(`signed in as   : ${user.email}`);
  console.log(`agencies read  : ${agencies.length} across ${owners.length} owner(s)`);
  console.log(`jobs read      : ${jobs.length}`);
  if (owners.length === 1) {
    console.warn('*** Only one owner visible. If others exist, this listing was owner-scoped');
    console.warn('*** and the counts below are incomplete. Check you are the super admin.');
  }

  // BillingSystem.calculateJobTotal, reproduced exactly - including the hardcoded quantity
  // rules. Copied rather than imported because it is a component-local closure over
  // activeAgency/activeAtMaster; any drift between this and the original is a defect in
  // this script, so it is written to mirror the source line for line.
  const billTotal = (job, agency, atMaster) => {
    const kva = String(job.capacityKva);
    const isScrapJob = job.status === 'Scrap' || job.condition === 'Scrap';
    const master = getEstimateMasterForCore(agency, job.coreType, globalDefault);
    const atPct = getAtPercentageForCore(atMaster, job.coreType);

    if (isScrapJob) {
      const sc = resolveScrapCharge(job.coreType, kva, master);
      if (sc.rate === null) return { base: 0, withAt: 0, atPct, note: `scrap unresolved: ${sc.error}` };
      return { base: sc.rate, withAt: sc.rate * (1 + atPct / 100), atPct, note: 'scrap flat charge' };
    }

    const scrapItemCode = getScrapItemCodeForCore(job.coreType || 'CRGO');
    let base = 0;
    const contributing = [];
    master.forEach(item => {
      if (scrapItemCode && (item.itemCode || '').trim() === scrapItemCode) return;
      const rawRate = item.rates[kva] || 0;
      const rate = typeof rawRate === 'string' ? parseFloat(rawRate) : Number(rawRate);
      let qty = 0;
      if (rate > 0) {
        if (item.unit === 'Y') qty = 1;
        else if (item.unit === 'QTY') {
          qty = 1;
          if (item.itemCode === '1c') qty = 7;
          if (item.itemCode === '8' || item.itemCode === '9A' || item.itemCode === '9B') qty = 3;
          if (item.itemCode === '10' || item.itemCode === '11A' || item.itemCode === '11B') qty = 4;
          if (item.itemCode === '15') qty = 6;
        } else if (item.unit === 'KG') {
          qty = kva === '10' || kva === '16' ? 14 : kva === '25' ? 15.54 : 45.36;
        }
      }
      if (item.unit === 'N') qty = 0;
      if (qty * rate > 0) contributing.push(`${item.itemCode}x${qty}@${rate}`);
      base += (qty * rate);
    });
    return { base, withAt: base * (1 + atPct / 100), atPct, note: contributing.join(' + ') || 'no row had a rate > 0' };
  };

  const isFixedRateCore = j => {
    const c = classifyCoreType(j.coreType || 'CRGO');
    return c === 'AMORPHOUS' || c === 'WOUND_CORE';
  };
  const hasBillNo = j => Boolean(String(j.billNo ?? '').trim());

  const target = jobs.filter(j => isFixedRateCore(j) && hasBillNo(j));

  const rows = target.map(j => {
    const agency = agencyById[j.agencyId] || null;
    // The job's OWN AT, not a session-active one - BillingSystem uses activeAtMaster, which
    // is a per-session choice and cannot be reconstructed. Stated because it affects only
    // the AT percentage, never whether the base total is zero.
    const at = j.atId ? atById[j.atId] : null;
    const calc = billTotal(j, agency, at);
    const issued = j.billAmount;
    return {
      jobNo: j.jobNo,
      agency: agency?.name || '(unknown)',
      owner: agency?.ownerId || '(none)',
      coreType: j.coreType || 'CRGO',
      kva: j.capacityKva ?? '',
      isScrap: j.status === 'Scrap' || j.condition === 'Scrap',
      billNo: j.billNo,
      billSentDate: j.billSentDate || '-',
      issuedBillAmount: issued === undefined || issued === null ? '(not stored)' : issued,
      issuedAtZero: !(Number(issued) > 0),
      wouldBillTodayBase: Number(calc.base.toFixed(2)),
      wouldBillTodayWithAt: Number(calc.withAt.toFixed(2)),
      atPct: calc.atPct,
      paymentStatus: j.paymentStatus || '-',
      paidAmount: j.paidAmount ?? '-',
      basis: calc.note.slice(0, 60),
    };
  });

  hdr(`AMORPHOUS / WOUND CORE JOBS WITH A BILL NUMBER - ${rows.length}`);
  if (rows.length === 0) console.log('(none - no fixed-rate-core job has ever been billed)');
  else console.table(rows);

  const repairable = rows.filter(r => !r.isScrap);
  const zeroIssued = rows.filter(r => r.issuedAtZero);
  const zeroRepairable = repairable.filter(r => r.issuedAtZero);
  const paidAtZero = zeroIssued.filter(r => String(r.paymentStatus).toLowerCase().includes('paid'));

  hdr('THE NUMBERS');
  console.log(`issued at all (billNo set)              : ${rows.length}`);
  console.log(`  repairable (not scrap)                : ${repairable.length}`);
  console.log(`  scrap                                 : ${rows.length - repairable.length}`);
  console.log(`ISSUED AT ZERO (billAmount 0 / missing)  : ${zeroIssued.length}`);
  console.log(`  of those, repairable                  : ${zeroRepairable.length}   <- the exposure`);
  console.log(`  of those, marked paid                 : ${paidAtZero.length}`);

  if (zeroRepairable.length) {
    console.log('');
    console.log('*** REPAIRABLE FIXED-RATE BILLS ISSUED AT ZERO ***');
    zeroRepairable.forEach(r => console.log(
      `  ${r.jobNo}  ${r.agency}  ${r.coreType} ${r.kva}KVA  billNo ${r.billNo}  sent ${r.billSentDate}  ` +
      `issued ${r.issuedBillAmount}  would bill today ${r.wouldBillTodayWithAt}  payment ${r.paymentStatus}`
    ));
    console.log('');
    console.log('Each needs checking against the printed copy: billAmount is what the app');
    console.log('stored, not necessarily what the document showed. Whether a zero-value bill');
    console.log('actually left the building is a question for the paper and the division');
    console.log('office, not for this database.');
  }

  hdr('READING THE RECOMPUTATION');
  console.log('wouldBillTodayBase is BillingSystem.calculateJobTotal reproduced against the');
  console.log('corrected master. It is NOT what the tender says these jobs are worth: the');
  console.log('tender prices Amorphous and Wound Core at a FIXED RATE, which is what the');
  console.log('ESTIMATE produces via Schedule-B. The bill walks the master instead (O16).');
  console.log('');
  console.log('So a large gap between issuedBillAmount and wouldBillTodayWithAt is evidence');
  console.log('about the master repair; a gap between either of them and the estimate is');
  console.log('evidence about O16. They are different questions and this reports only the');
  console.log('first. `basis` shows which item codes and quantities produced the figure.');

  window.__amorphousBillExposure = { rows, repairable, zeroIssued, zeroRepairable, paidAtZero, owners };
  console.log('\nFull results: window.__amorphousBillExposure');
})();
