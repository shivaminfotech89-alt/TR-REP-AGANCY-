// READ-ONLY blast-radius report: which already-submitted estimates were priced off
// capacity defaults instead of real inspection data, and where that flipped the
// Clause 4.0 circle-limit verdict.
//
// HOW TO RUN
//   1. Start the dev server (npm run dev) and log in to the app in the browser.
//   2. Select the agency you want to audit (it audits the ACTIVE agency).
//   3. Open DevTools console, paste this whole file, press Enter.
//
// Reads only - no set/update/delete/batch anywhere.
//
// THE PRE-FIX FIGURE IS COMPUTED EXPLICITLY, NOT BY RE-RUNNING THE OLD CODE PATH.
// computeLegacyEstimate() below restates, as literal constants, the quantities
// buildSingleJobEstimateData used to produce when externalData and internalData were
// both undefined. Each constant is annotated with the line it mirrors, so the two can
// be diffed by eye. Nothing here depends on tricking current code into a branch it
// now blocks.

// Firebase comes from the app's already-initialised instance via the dev-only
// handles in src/lib/firebase.ts - the console cannot resolve bare specifiers like
// 'firebase/firestore'. The app's own modules below load fine by /src/ path, since
// Vite serves those transformed.
(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) {
    console.error('window.__db / window.__fs missing. Run against the dev server (npm run dev) with the app loaded in this tab.');
    return;
  }
  const { collection, query, where, getDocs } = fs;

  const { buildSingleJobEstimateData, classifyCoreType } = await import('/src/components/SingleJobEstimateReport.tsx');
  const { getCircleLimitsEstimateMaster, getEstimateMasterForCore, getAtPercentageForCore } = await import('/src/lib/AgencyContext.tsx');
  const { getCircleLimitForJob } = await import('/src/lib/estimateData.ts');
  const { bandForKva, SCHEDULE_A } = await import('/src/lib/ugvclSchedule2020.ts');

  const uid = auth?.currentUser?.uid;
  if (!uid) { console.error('Not signed in - log in to the app first.'); return; }
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
  const circleLimits = getCircleLimitsEstimateMaster(agency);

  const jobIds = new Set(jobs.map(j => j.id));
  const extMap = {}, intMap = {};
  allInspections.filter(i => i.jobId && jobIds.has(i.jobId)).forEach(i => {
    const t = (i.type || '').toLowerCase();
    if (t === 'external') extMap[i.jobId] = i.data || i;
    if (t === 'internal') intMap[i.jobId] = i.data || i;
  });

  // --- The pre-fix estimate, stated explicitly ------------------------------------
  // Mirrors buildSingleJobEstimateData (SingleJobEstimateReport.tsx) evaluated with
  // externalData === undefined and internalData === undefined. With internalData
  // absent, winding fell back to 'Aluminium', so the Aluminium rate variants are the
  // only ones the old path could reach.
  function computeLegacyEstimate(job) {
    const kva = String(job.capacityKva || '25').trim();
    const kvaNum = Number(kva) || 0;
    const band = bandForKva(kvaNum);
    const coreType = (job.coreType || 'CRGO').trim().toUpperCase();
    const masterList = getEstimateMasterForCore(agency, coreType);
    const atPercentage = getAtPercentageForCore(atMaster, coreType);
    // internalData?.condition was undefined, so only the job's own fields decided this
    const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';

    const scheduleRate = sr => SCHEDULE_A.find(i => i.sr === sr)?.rates[band];
    const resolveRate = (masterCode, scheduleValue) => {
      const found = masterList.find(m => m.itemCode?.toLowerCase() === masterCode.toLowerCase());
      const masterVal = found?.rates?.[kva];
      if (masterVal !== undefined && masterVal !== null && !isNaN(Number(masterVal)) && Number(masterVal) > 0) {
        return Number(masterVal);
      }
      return (scheduleValue !== undefined && scheduleValue > 0) ? scheduleValue : null;
    };

    // Per-capacity coil defaults - the constants at the heart of this bug
    const hvCoilWeight = isScrap ? 0
      : (kvaNum === 63 ? 47.00 : kvaNum === 25 ? 15.54 : kvaNum === 100 ? 55.00 : 14.00);
    const reInsWeight = isScrap ? 0
      : (kvaNum === 63 ? 24.30 : kvaNum === 25 ? 15.54 : kvaNum === 100 ? 35.00 : 12.00);

    // [master code, Schedule-A sr, quantity] - quantity is what the absent-record
    // path produced. 'Y/N' items are quantity 1 or 0.
    const lines = [
      // PHYSICAL
      ['16',  '16',  1],                          // Name Plating - undefined !== 'N'/'0'/'-' so applied
      ['2b',  '2b',  1],                          // Spray painting - applied
      ['4',   '18b', 0],                          // Conservator Tank - Number(undefined)||0
      ['21',  '20',  0],                          // Radiator Replacement - Number(undefined)||0
      ['1c',  '1c',  7],                          // Rod Gasket - hardcoded 7
      ['1e',  '1e',  1],                          // M/S Bolt Nuts - applied
      ['1b',  '1b',  kvaNum >= 63 ? 3 : 1],       // Top Cover Gasket - capacity default
      ['5',   '5',   1],                          // Oil Guage Glass - applied
      ['6',   '6',   1],                          // Breather - applied
      ['8',   '8-A', isScrap ? 0 : 3],            // HV Bushing - hardcoded 3
      ['9A',  '9A',  isScrap ? 0 : 2],            // HV Metal Parts - hardcoded 2
      ['9B',  '9B',  0],                          // HV Connectors - default 0
      ['10',  '10',  isScrap ? 0 : 1],            // LV Bushing - hardcoded 1
      ['11A', '11A', isScrap ? 0 : 4],            // LV Metal Parts - hardcoded 4
      ['11B', '11B', 0],                          // LV Connectors - default 0
      ['17',  '17',  0],                          // Sealed to Bolted - sealType undefined => not bolted
      // INTERNAL
      ['3',   '3',   1],                          // Inside Painting - applied
      ['1d',  '1d',  isScrap ? 0 : 1],            // Insulating Material
      ['15',  '15',  isScrap ? 0 : 6],            // Washer Ring - hardcoded 6
      ['12A', '12A-b1', hvCoilWeight],            // HV Coil - Aluminium S.E. variant
      ['13A', '13A-b', 0],                        // LV Coil - totWtLv absent => 0
      ['14',  '14-ii', reInsWeight],              // Re-insulation LV Coil - Aluminium
      // LABOUR
      ['1a',  '1a',  1],                          // Labour Charge - always applies
      ['2a',  '2a',  1],                          // Cleaning dirty tank - applied
      ['1f',  '1f',  isScrap ? 0 : 1],            // Drying of active parts
      ['19',  undefined, isScrap ? 1 : 0],        // Scrap - agency master only, no Schedule-A
      ['20',  '19',  isScrap ? 0 : 1],            // Testing Charge
      ['12C', '12C-b', isScrap ? 0 : hvCoilWeight], // Labour HV Coil - reuses hvCoilWeight
      ['13C', '13C-b', 0],                        // Labour LV Coil - lvCoilWeight 0
    ];

    let baseTotal = 0;
    for (const [code, sr, qty] of lines) {
      if (!qty) continue;
      const rate = resolveRate(code, sr === undefined ? undefined : scheduleRate(sr));
      baseTotal += qty * (rate ?? 0);   // a null rate contributed 0, same as before
    }
    const percentageAmount = Number((baseTotal * (atPercentage / 100)).toFixed(2));
    return Number((baseTotal + percentageAmount).toFixed(2));   // lessAmount was always 0
  }

  const rows = [], skipped = [];
  for (const job of jobs) {
    const ext = extMap[job.id];
    const int = intMap[job.id];
    if (!ext && !int) continue;                       // only jobs that DO have an inspection

    const coreClass = classifyCoreType(job.coreType || 'CRGO');
    if (coreClass === 'AMORPHOUS' || coreClass === 'WOUND_CORE') {
      skipped.push({ job: job.jobNo, core: job.coreType, why: 'fixed-rate by capacity - never used inspection data' });
      continue;
    }

    const real = buildSingleJobEstimateData(job, agency, atMaster, ext, int);
    const submittedAmt = computeLegacyEstimate(job);
    const correctAmt = real.finalAmount;

    const ratingKey = job.starRating || job.ratingLevel || '3 Star & other';
    const { limit, hasLimit, ratingLabel } = getCircleLimitForJob(job.capacityKva, ratingKey, circleLimits);
    const verdictBefore = !hasLimit ? 'no limit' : (submittedAmt > limit ? 'EXCEEDS' : 'within');
    const verdictNow = !hasLimit ? 'no limit' : (correctAmt > limit ? 'EXCEEDS' : 'within');

    const difference = Number((correctAmt - submittedAmt).toFixed(2));
    if (difference === 0 && verdictBefore === verdictNow) continue;

    rows.push({
      job: job.jobNo, mr: job.mrNo, kva: job.capacityKva, core: job.coreType || 'CRGO',
      hasExt: !!ext, hasInt: !!int,
      submittedAmt, correctAmt, difference,
      limit, ratingLabel,
      verdictBefore, verdictNow,
      verdictFlipped: verdictBefore !== verdictNow,
      estimateSentDate: job.estimateSentDate || '',
      estimateAmountOnJob: job.estimateAmount ?? '',   // what was actually saved/sent
      blockedNow: real.rateErrors.length ? real.rateErrors.join(' | ') : '',
    });
  }

  rows.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  console.log(`\n=== BLAST RADIUS - agency ${agency?.name || agencyId} ===`);
  console.log(`${jobs.length} jobs, ${rows.length} differ from what the pre-fix screen produced.`);
  console.table(rows);

  const flipped = rows.filter(r => r.verdictFlipped);
  console.log(`\n--- CIRCLE-LIMIT VERDICT CHANGED: ${flipped.length} job(s) ---`);
  if (flipped.length) console.table(flipped);

  const submitted = rows.filter(r => r.estimateSentDate);
  console.log(`\n--- ALREADY SUBMITTED (estimateSentDate set) AND WRONG: ${submitted.length} job(s) ---`);
  if (submitted.length) console.table(submitted);

  if (skipped.length) {
    console.log(`\n--- SKIPPED (unaffected by this bug): ${skipped.length} ---`);
    console.table(skipped);
  }

  // ---------------------------------------------------------------------------
  // SECTION 4 - GUARANTEE (GP) CLOCK
  // ---------------------------------------------------------------------------
  // Dashboard measured the 18-month guarantee window from `j.dispatchDate`, which
  // nothing has ever written, so it fell through to `j.updatedAt` - the last time
  // the record was touched for ANY reason (bill sent, payment marked, re-inspection).
  //
  // The bias runs one way only: updatedAt moves forward, never back, so the window
  // was only ever EXTENDED. The resulting error is GP work done free that could
  // legitimately have been charged - not valid claims wrongly rejected.
  //
  // The true dispatch stamp survives on every job (deliveryDate / challanDate), so
  // the correct verdict is recoverable. Read-only: nothing below writes.
  const GP_MONTHS = 18;
  const GP_WINDOW_MS = GP_MONTHS * 30.4375 * 24 * 60 * 60 * 1000;
  const NOW = Date.now();

  const ms = v => {
    if (!v) return null;
    const t = new Date(v).getTime();
    return isNaN(t) ? null : t;
  };

  const gpRows = [];
  jobs.filter(j => j.status === 'Dispatched').forEach(job => {
    const trueStamp = job.deliveryDate || job.challanDate;
    const trueTime = ms(trueStamp);
    // Exactly what Dashboard did before the fix
    const buggyTime = ms(job.dispatchDate) ?? ms(job.updatedAt) ?? NOW;
    if (trueTime === null) return;   // no recoverable dispatch stamp - report separately

    const inGuaranteeBefore = (NOW - buggyTime) <= GP_WINDOW_MS;
    const inGuaranteeNow = (NOW - trueTime) <= GP_WINDOW_MS;
    if (inGuaranteeBefore === inGuaranteeNow) return;

    gpRows.push({
      job: job.jobNo,
      mr: job.mrNo,
      kva: job.capacityKva,
      trueDispatch: trueStamp,
      measuredFrom: job.updatedAt || '(none)',
      daysSinceTrueDispatch: Math.floor((NOW - trueTime) / 86400000),
      daysSinceUpdatedAt: Math.floor((NOW - buggyTime) / 86400000),
      windowExtendedByDays: Math.floor((buggyTime - trueTime) / 86400000),
      verdictBefore: inGuaranteeBefore ? 'IN guarantee' : 'expired',
      verdictNow: inGuaranteeNow ? 'IN guarantee' : 'expired',
      repairType: job.repairType || '',
    });
  });

  gpRows.sort((a, b) => b.windowExtendedByDays - a.windowExtendedByDays);

  const noStamp = jobs.filter(j => j.status === 'Dispatched' && !j.deliveryDate && !j.challanDate);

  console.log(`\n=== GP CLOCK: ${gpRows.length} dispatched job(s) whose in-guarantee verdict changes ===`);
  console.log('Bias is one-way: updatedAt only moves forward, so windows were only ever');
  console.log('extended. The error is GP work done free that could have been charged,');
  console.log('not valid claims rejected.');
  if (gpRows.length) console.table(gpRows);
  if (noStamp.length) {
    console.log(`\n-- Dispatched with NO deliveryDate or challanDate (verdict unrecoverable): ${noStamp.length} --`);
    console.table(noStamp.map(j => ({ job: j.jobNo, mr: j.mrNo, status: j.status, updatedAt: j.updatedAt || '' })));
  }

  // ---------------------------------------------------------------------------
  // SECTION 5 - SCRAP ESTIMATE EXPOSURE
  // ---------------------------------------------------------------------------
  // Scrap transformers were estimated as full repairs (AUDIT.md F7): CRGO appended the
  // Rs 500 scrap line to a repair estimate, and Amorphous/Wound Core returned the full
  // Schedule-B repair rate with no scrap charge at all. No scrap job was ever BILLED
  // (F3), but an estimate is a separate document with its own estimateSentDate - and a
  // sent estimate is an approval sought from the SE against a wrong figure.
  //
  // `sentAmount` is job.estimateAmount, the figure actually written when the estimate
  // was sent - authoritative for what went out. `correctAmount` is what
  // buildSingleJobEstimateData produces now that scrap short-circuits.
  const scrapJobs = jobs.filter(j => j.status === 'Scrap' || j.condition === 'Scrap');

  const scrapRows = scrapJobs.map(job => {
    const est = buildSingleJobEstimateData(job, agency, atMaster, extMap[job.id], intMap[job.id]);
    const correct = est.rateErrors.length ? null : est.finalAmount;
    const sent = typeof job.estimateAmount === 'number' ? job.estimateAmount : null;
    return {
      job: job.jobNo,
      mr: job.mrNo,
      kva: job.capacityKva,
      core: job.coreType || 'CRGO',
      estimateSentDate: job.estimateSentDate || '(not sent)',
      estimateRefNo: job.estimateRefNo || '',
      sentAmount: sent ?? '(none stored)',
      correctAmount: correct ?? `blocked: ${est.rateErrors.join(' | ')}`,
      overstatedBy: (sent !== null && correct !== null) ? Number((sent - correct).toFixed(2)) : '',
      wasSent: Boolean(job.estimateSentDate),
    };
  });

  hdr(`SCRAP ESTIMATE EXPOSURE - ${scrapRows.length} scrap job(s)`);
  console.table(scrapRows);
  const sentScrap = scrapRows.filter(r => r.wasSent);
  console.log(`${sentScrap.length} of ${scrapRows.length} scrap estimates were SENT (estimateSentDate set).`);
  if (sentScrap.length) {
    const totalOver = sentScrap.reduce((a, r) => a + (Number(r.overstatedBy) || 0), 0);
    console.log(`Total overstated across sent scrap estimates: ${totalOver.toFixed(2)}`);
  }

  // MR-level totals - a forwarding letter is addressed per MR to the Superintending
  // Engineer, so the letter's TOTAL is what was actually put in front of them.
  const affectedMrs = [...new Set(scrapRows.map(r => r.mr))].filter(Boolean);
  const mrRows = affectedMrs.map(mr => {
    const mrJobs = jobs.filter(j => j.mrNo === mr);
    let sentTot = 0, correctTot = 0, blocked = 0;
    mrJobs.forEach(j => {
      const e = buildSingleJobEstimateData(j, agency, atMaster, extMap[j.id], intMap[j.id]);
      if (e.rateErrors.length) blocked++; else correctTot += e.finalAmount;
      if (typeof j.estimateAmount === 'number') sentTot += j.estimateAmount;
    });
    return {
      mr,
      jobsInMr: mrJobs.length,
      scrapJobsInMr: mrJobs.filter(j => j.status === 'Scrap' || j.condition === 'Scrap').length,
      letterTotalSent: Number(sentTot.toFixed(2)),
      letterTotalCorrect: Number(correctTot.toFixed(2)),
      overstatedBy: Number((sentTot - correctTot).toFixed(2)),
      jobsBlocked: blocked,
      anyEstimateSent: mrJobs.some(j => j.estimateSentDate),
      estimateRefNo: mrJobs.find(j => j.estimateRefNo)?.estimateRefNo || '',
    };
  });
  hdr(`FORWARDING LETTER TOTALS - MRs containing scrap (${mrRows.length})`);
  console.table(mrRows);
  console.log('A letter whose anyEstimateSent is true went to the Superintending Engineer');
  console.log('with letterTotalSent on it. Where overstatedBy is material, that letter');
  console.log('needs withdrawing and reissuing at letterTotalCorrect.');

  window.__blastRadius = { rows, flipped, submitted, skipped, gpRows, gpNoStamp: noStamp, scrapRows, mrRows };
  console.log('\nFull results: window.__blastRadius');
})();
