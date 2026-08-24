// READ-ONLY: what did the with-S.E. HV coil rate cost?
//
// The HV coil line resolved Schedule-A '12A-b1' (Aluminium WITH S.E., Rs 213/kg) when the
// applicable variant is '12A-b' (WITHOUT S.E., Rs 163/kg) - the agency does not use
// super-enamelled conductor. Difference: Rs 50/kg on every HV coil kilogram (AUDIT F47).
//
// LV was already correct at '13A-b' Rs 149/kg and is not affected.
//
// IMPORTANT about weights: until AUDIT F46 the HV weight ALSO fell back to a per-capacity
// constant (47.00 kg at 63 kVA) whenever none was recorded. Those lines carried both a
// fabricated quantity and the wrong rate. They are reported separately, because correcting
// the rate does not make a fabricated weight right.
//
// The rate applies only where the master had no HV rate of its own - the master wins over
// Schedule-A. Jobs whose agency master prices item '12A' were never exposed, and are
// counted separately rather than assumed.
//
// It WRITES NOTHING. It reports.
//
// HOW TO RUN: npm run dev, sign in, reload the tab, paste into the DevTools console.

const RATE_WRONG = 213, RATE_RIGHT = 163;

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs } = fs;

  const user = auth?.currentUser;
  if (!user) { console.error('Not signed in.'); return; }

  const { getEstimateMasterForCore } = await import('/src/lib/AgencyContext.tsx');
  const { classifyCoreType } = await import('/src/components/SingleJobEstimateReport.tsx');

  const hdr = t => console.log(`\n${'='.repeat(104)}\n${t}\n${'='.repeat(104)}`);
  const snap = async (col, ...c) =>
    (await getDocs(query(collection(db, col), ...c))).docs.map(d => ({ id: d.id, ...d.data() }));

  const [agencies, jobs, inspections] = await Promise.all([
    snap('agencies', where('ownerId', '==', user.uid)),
    snap('jobs', where('ownerId', '==', user.uid)),
    snap('inspections', where('ownerId', '==', user.uid)),
  ]);
  const agencyById = Object.fromEntries(agencies.map(a => [a.id, a]));
  const intByJob = {};
  inspections.filter(i => i.type === 'Internal').forEach(i => { if (i.jobId) intByJob[i.jobId] = i.data || {}; });

  const perCapDefault = kva => (Number(kva) === 63 ? 47.00 : Number(kva) === 25 ? 15.54 : Number(kva) === 100 ? 55.00 : 14.00);

  const rows = [];
  jobs.forEach(j => {
    if (classifyCoreType(j.coreType || 'CRGO') !== 'CRGO') return;   // Schedule-B never reaches 12A
    const int = intByJob[j.id];
    if (!int || Object.keys(int).length === 0) return;               // no record - was blocked, not priced

    // The weight the OLD code would have used, in its own precedence order.
    const dam = (Number(int.damR) || 0) + (Number(int.damY) || 0) + (Number(int.damB) || 0);
    let weight = 0, weightSource = '';
    if (Number(int.totWt) > 0) { weight = Number(int.totWt); weightSource = 'recorded totWt'; }
    else if (Number(int.wtOfCoil) > 0 && int.totCoil) { weight = Number(int.wtOfCoil) * Number(int.totCoil); weightSource = 'wtOfCoil x totCoil'; }
    else { weight = perCapDefault(j.capacityKva); weightSource = 'FABRICATED per-capacity constant'; }
    if (!(weight > 0)) return;

    // Did the agency master price '12A'? If so Schedule-A was never consulted and the
    // S.E. variant never applied to this job.
    const master = getEstimateMasterForCore(agencyById[j.agencyId], j.coreType);
    const mItem = (master || []).find(m => String(m.itemCode || '').trim().toLowerCase() === '12a');
    const mRate = mItem?.rates ? Number(mItem.rates[String(j.capacityKva)]) : 0;
    const masterPriced = Number(mRate) > 0;

    rows.push({
      jobNo: j.jobNo,
      agency: agencyById[j.agencyId]?.name || '(unknown)',
      kva: j.capacityKva,
      hvDamagedCoils: dam,
      weightKg: Number(weight.toFixed(2)),
      weightSource,
      rateUsed: masterPriced ? `master ${mRate}` : RATE_WRONG,
      exposureRs: masterPriced ? 0 : Number((weight * (RATE_WRONG - RATE_RIGHT)).toFixed(2)),
      issued: Boolean(j.estimateSentDate || j.billNo || j.billSentDate),
      estimateSent: j.estimateSentDate || '',
      billNo: j.billNo || '',
    });
  });

  const affected = rows.filter(r => r.exposureRs > 0);
  const issued = affected.filter(r => r.issued);
  const unissued = affected.filter(r => !r.issued);
  const fabricated = affected.filter(r => r.weightSource.startsWith('FABRICATED'));
  const sum = a => Number(a.reduce((t, r) => t + r.exposureRs, 0).toFixed(2));

  hdr(`HV COIL LINES WITH A NON-ZERO WEIGHT - ${rows.length} job(s)`);
  if (rows.length) console.table(rows);
  else console.log('(none)');

  hdr('EXPOSURE AT Rs 50/kg');
  console.log(`jobs priced from Schedule-A (exposed)    : ${affected.length}`);
  console.log(`jobs priced from the agency master        : ${rows.length - affected.length}   (never exposed)`);
  console.log('');
  console.log(`ISSUED   (estimate or bill sent)          : ${issued.length} job(s)   Rs ${sum(issued).toLocaleString('en-IN')}`);
  console.log(`UNISSUED (nothing sent yet)               : ${unissued.length} job(s)   Rs ${sum(unissued).toLocaleString('en-IN')}`);
  console.log(`TOTAL                                     : ${affected.length} job(s)   Rs ${sum(affected).toLocaleString('en-IN')}`);
  console.log('');
  console.log(`of which the WEIGHT was also fabricated   : ${fabricated.length} job(s)   Rs ${sum(fabricated).toLocaleString('en-IN')}`);
  console.log('  Those lines were wrong twice over - an invented quantity at the wrong rate.');
  console.log('  Correcting the rate does not make the quantity right; they need re-inspecting,');
  console.log('  not recomputing.');

  hdr('READING THIS');
  console.log('UNISSUED jobs simply price correctly from now on - nothing to do.');
  console.log('ISSUED jobs carry a figure on paper that UGVCL holds. The document is the');
  console.log('authority for what was claimed; this is what it should have been. Whether an');
  console.log('overcharge already accepted needs a credit is a commercial decision, not a');
  console.log('code one.');

  window.__seExposure = { rows, affected, issued, unissued, fabricated };
  console.log('\nFull results: window.__seExposure');
})();
