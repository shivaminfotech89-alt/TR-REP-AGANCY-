// BACKFILL job.condition from the Internal inspection record.
//
// WHY: scrap identity used to live only in `job.status`, and dispatch overwrites
// status with 'Dispatched' - erasing it. `job.condition` now carries that identity
// independently, but it is only written when an internal inspection is SAVED, so
// every job inspected before that fix has no condition field. This restores it from
// the Internal inspection record, which is untouched evidence of what each unit was.
//
// HOW TO RUN
//   1. npm run dev, log in, select the agency, RELOAD the tab.
//   2. DevTools console, paste this whole file, Enter.
//
//   MODE is 'dry-run' below. It reads and prints only - it writes NOTHING.
//   Change MODE to 'write' ONLY after the dry-run output has been reviewed
//   and authorised.
//
// THE WRITE SETS `condition` AND NOTHING ELSE. status, dates, challan fields,
// bill fields and everything else are never touched.

const MODE ='write';   // 'dry-run' | 'write'

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) {
    console.error('window.__db / window.__fs missing. Run against the dev server with the app loaded, and reload the tab.');
    return;
  }
  const { collection, query, where, getDocs, doc, writeBatch } = fs;
  if (MODE === 'write' && !writeBatch) {
    console.error('writeBatch handle missing - reload the tab so the dev handles refresh.');
    return;
  }

  const { resolveScrapCharge } = await import('/src/lib/estimateCalc.ts');
  const { getEstimateMasterForCore, getAtPercentageForCore } = await import('/src/lib/AgencyContext.tsx');

  const uid = auth?.currentUser?.uid;
  if (!uid) { console.error('Not signed in.'); return; }
  const agencyId = localStorage.getItem('activeAgencyId');
  if (!agencyId) { console.error('No active agency selected.'); return; }
  const atMasterId = localStorage.getItem(`activeAtMasterId_${agencyId}`) || localStorage.getItem('activeAtMasterId');

  const snap = async (col, ...clauses) =>
    (await getDocs(query(collection(db, col), ...clauses))).docs.map(d => ({ id: d.id, ...d.data() }));

  const [agencies, atMasters, jobs, allInspections] = await Promise.all([
    snap('agencies', where('ownerId', '==', uid)),
    snap('atMasters', where('ownerId', '==', uid)),
    snap('jobs', where('ownerId', '==', uid), where('agencyId', '==', agencyId)),
    snap('inspections', where('ownerId', '==', uid)),
  ]);

  const agency = agencies.find(a => a.id === agencyId) || null;
  const atMaster = atMasters.find(a => a.id === atMasterId) || null;

  // All Internal records per job - plural on purpose, duplicates are a finding.
  const jobIds = new Set(jobs.map(j => j.id));
  const internalByJob = {};
  allInspections
    .filter(i => i.jobId && jobIds.has(i.jobId) && (i.type || '').toLowerCase() === 'internal')
    .forEach(i => { (internalByJob[i.jobId] ||= []).push(i); });

  // A job at or past internal inspection is expected to have an internal record.
  const PAST_INTERNAL = new Set(['Internal Done', 'Tested - Ready for Dispatch', 'Dispatched', 'Scrap']);
  const reachedInternal = j => PAST_INTERNAL.has(j.status) || j.isClosed === true;

  const group1 = [];        // dispatched, no condition        -> WRITE
  const group2 = [];        // not dispatched, no condition    -> WRITE
  const group3 = [];        // record says Scrap, status isn't -> LIST ONLY
  const group4 = [];        // ambiguous / anomalous           -> NEVER WRITE
  const notYetInspected = []; // benign: no internal inspection yet, nothing to restore
  const alreadySet = [];    // condition present - immutable, left alone

  for (const job of jobs) {
    const existing = (job.condition || '').trim();
    if (existing) { alreadySet.push({ job: job.jobNo, condition: existing, status: job.status }); continue; }

    const records = internalByJob[job.id] || [];
    const base = { job: job.jobNo, mr: job.mrNo, status: job.status, challanNo: job.challanNo || '', id: job.id };

    if (records.length === 0) {
      if (reachedInternal(job)) {
        group4.push({ ...base, reason: 'No Internal inspection record, but job is at/past internal inspection' });
      } else {
        notYetInspected.push({ ...base, reason: 'Not yet internally inspected - condition will be set at inspection' });
      }
      continue;
    }

    if (records.length > 1) {
      const values = records.map(r => (r.data?.condition || '(unset)').trim());
      group4.push({
        ...base,
        reason: `${records.length} Internal records (${values.join(' / ')}) - ${new Set(values).size === 1 ? 'agreeing, but still needs a human look' : 'DISAGREEING'}`,
      });
      continue;
    }

    const cond = (records[0].data?.condition || '').trim();
    if (cond !== 'Scrap' && cond !== 'Repairable') {
      group4.push({ ...base, reason: `Internal record condition is "${cond || '(empty)'}" - not an unambiguous Scrap/Repairable` });
      continue;
    }

    const row = { ...base, wouldWrite: cond, fromInspectionId: records[0].id };

    if (job.status === 'Dispatched') {
      group1.push(row);
    } else if (cond === 'Scrap' && job.status !== 'Scrap') {
      // Scrap unit that did NOT stop at Scrap status - it carried on through the
      // stages it should have bypassed. That is a judgement about a physical
      // transformer, not a data repair: listed, never written.
      group3.push({ ...base, internalRecordSays: cond, reason: 'Internal record says Scrap but status is neither Scrap nor Dispatched - unit went through stages it should have bypassed' });
    } else {
      group2.push(row);
    }
  }

  const writeSet = [...group1, ...group2];

  const hdr = t => console.log(`\n${'='.repeat(72)}\n${t}\n${'='.repeat(72)}`);

  hdr(`BACKFILL job.condition - MODE: ${MODE.toUpperCase()}   agency: ${agency?.name || agencyId}`);
  console.log({
    totalJobs: jobs.length,
    alreadyHaveCondition: alreadySet.length,
    group1_dispatched_wouldWrite: group1.length,
    group2_notDispatched_wouldWrite: group2.length,
    group3_stageAnomaly_listedOnly: group3.length,
    group4_manualReview_neverWritten: group4.length,
    notYetInspected_nothingToRestore: notYetInspected.length,
    TOTAL_WOULD_WRITE: writeSet.length,
  });

  hdr(`GROUP 1 - dispatched, no condition -> WOULD WRITE (${group1.length})`);
  if (group1.length) console.table(group1); else console.log('(none)');

  hdr(`GROUP 2 - not dispatched, no condition -> WOULD WRITE (${group2.length})`);
  if (group2.length) console.table(group2); else console.log('(none) - confirmed empty');

  hdr(`GROUP 3 - stage anomaly, LISTED ONLY, never written (${group3.length})`);
  if (group3.length) console.table(group3); else console.log('(none)');

  hdr(`GROUP 4 - manual review, NEVER written (${group4.length})`);
  if (group4.length) console.table(group4); else console.log('(none) - confirmed empty');

  if (notYetInspected.length) {
    hdr(`INFO - not yet internally inspected, nothing to restore (${notYetInspected.length})`);
    console.table(notYetInspected);
  }

  // Exactly what each group-4 record HOLDS. Listed, never interpreted: a record with
  // real coil/damage data but no condition may be inferable by someone who knows the
  // unit, but that is a judgement about a physical transformer, not a data repair.
  if (group4.length) {
    hdr(`GROUP 4 DETAIL - what each record actually contains (${group4.length})`);
    const { hasInspectionData } = await import('/src/lib/inspectionStage.ts');
    const detail = [];
    group4.forEach(g => {
      const records = internalByJob[g.id] || [];
      if (records.length === 0) {
        detail.push({ job: g.job, record: '(none)', note: g.reason });
        return;
      }
      records.forEach((r, idx) => {
        const d = r.data || {};
        const anyValue = (...keys) => keys.map(k => d[k]).some(v => v !== undefined && v !== null && String(v).trim() !== '');
        detail.push({
          job: g.job,
          status: g.status,
          record: records.length > 1 ? `${idx + 1}/${records.length}` : r.id,
          inspDate: r.inspectionDate || d.inspectionDate || '',
          condition: d.condition === undefined ? '(field absent)' : `"${d.condition}"`,
          windingType: d.windingType ?? '',
          hvLimb: d.hvCoilLimb ?? '',
          damR: d.damR ?? '', damY: d.damY ?? '', damB: d.damB ?? '',
          totCoil: d.totCoil ?? '', wtOfCoil: d.wtOfCoil ?? '', totWt: d.totWt ?? '',
          lvR: d.lvCoilR ?? '', lvY: d.lvCoilY ?? '', lvB: d.lvCoilB ?? '',
          wtOfCoilLv: d.wtOfCoilLv ?? '', totWtLv: d.totWtLv ?? '',
          wasring: d.wasring ?? '', inPnt: d.inPnt ?? '', tstTrn: d.tstTrn ?? '',
          dc: d.dc ?? '', insula: d.insula ?? '',
          // The app's own test for "this record has real data in it"
          hasRealData: hasInspectionData(r),
          hasCoilWeights: anyValue('totWt', 'wtOfCoil', 'totWtLv', 'wtOfCoilLv'),
          hasDamageNotes: anyValue('damR', 'damY', 'damB'),
          storedFieldCount: Object.keys(d).length,
        });
      });
    });
    console.table(detail);
    console.log('hasRealData uses hasInspectionData() from lib/inspectionStage.ts - the same');
    console.log('test the app uses to decide whether an internal inspection is a blank shell.');
    console.log('false across the board = genuinely blank records. true = data present with');
    console.log('only condition unset, which a human may be able to resolve.');
    window.__group4Detail = detail;
  }

  // ---------------------------------------------------------------------------
  // BILLING EXPOSURE - were any recovered-scrap jobs already billed?
  // ---------------------------------------------------------------------------
  // A job billed while its scrap identity was lost was priced as a repair, not as
  // the flat Rs 500 scrap charge.
  const scrapWrites = writeSet.filter(r => r.wouldWrite === 'Scrap');
  const cgstRate = typeof agency?.cgstPercent === 'number' ? agency.cgstPercent : 9;
  const sgstRate = typeof agency?.sgstPercent === 'number' ? agency.sgstPercent : 9;

  const billed = scrapWrites.map(r => {
    const job = jobs.find(j => j.id === r.id);
    const master = getEstimateMasterForCore(agency, job.coreType);
    const { rate, error } = resolveScrapCharge(job.coreType, String(job.capacityKva), master);
    const atPct = getAtPercentageForCore(atMaster, job.coreType);

    // What a correct scrap bill would charge for this unit, GST inclusive.
    const correctTaxed = rate === null ? null
      : Math.round(rate * (1 + atPct / 100) * (1 + (cgstRate + sgstRate) / 100));

    const chargedTaxed = job.billAmount ?? null;
    return {
      job: job.jobNo, mr: job.mrNo, kva: job.capacityKva, core: job.coreType || 'CRGO',
      billNo: job.billNo || '(not billed)',
      billSentDate: job.billSentDate || '',
      billStatus: job.billStatus || '',
      paymentStatus: job.paymentStatus || '',
      billedAmount: chargedTaxed ?? '(none)',
      correctScrapAmount: correctTaxed ?? `unresolved: ${error}`,
      overchargedBy: (chargedTaxed !== null && correctTaxed !== null)
        ? Number((chargedTaxed - correctTaxed).toFixed(2)) : '',
      wasBilled: Boolean(job.billNo || job.billSentDate || job.billAmount),
    };
  });

  hdr(`BILLING EXPOSURE - recovered-scrap jobs (${billed.length})`);
  console.table(billed);
  const actuallyBilled = billed.filter(b => b.wasBilled);
  console.log(`${actuallyBilled.length} of ${billed.length} were already billed while their scrap identity was lost.`);
  console.log('NOTE: `billAmount` stored on the job applies the AT percentage TWICE');
  console.log('(BillingSystem.calculateJobTotal already applies AT, then handleConfirmSendBill');
  console.log('multiplies by AT again), so it reads higher than the printed bill total.');
  console.log('Treat billedAmount as indicative; the printed document is the authority.');

  // ---------------------------------------------------------------------------
  if (MODE !== 'write') {
    hdr('DRY RUN - NOTHING WAS WRITTEN');
    console.log(`Would set condition on ${writeSet.length} job(s), and nothing else on any document.`);
    console.log("To apply: change MODE to 'write' at the top and re-paste.");
    window.__backfill = { group1, group2, group3, group4, notYetInspected, alreadySet, writeSet, billed };
    console.log('Full results: window.__backfill');
    return;
  }

  hdr(`WRITING condition on ${writeSet.length} job(s)`);
  let written = 0;
  for (let i = 0; i < writeSet.length; i += 400) {   // well under Firestore's 500 cap
    const slice = writeSet.slice(i, i + 400);
    const batch = writeBatch(db);
    slice.forEach(r => batch.update(doc(db, 'jobs', r.id), { condition: r.wouldWrite }));
    await batch.commit();
    written += slice.length;
    console.log(`  committed ${written}/${writeSet.length}`);
  }
  console.log(`\nDONE. condition written on ${written} job(s). No other field was modified.`);
  window.__backfill = { group1, group2, group3, group4, notYetInspected, alreadySet, writeSet, billed, written };
})();
