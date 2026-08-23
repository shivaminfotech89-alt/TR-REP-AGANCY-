// REVERSE the "Move ALL My Data To Active Agency" bulk move.
//
// WHAT IT UNDOES: the removed button ran `where('ownerId','==',uid)` over the JOBS
// collection with NO agency filter and set `agencyId` on every job that did not already
// match the active agency. Four agencies collapsed into AARATI TRANSFORMER. It wrote no
// log, so this is a RECONSTRUCTION FROM SIDE EVIDENCE, not an undo.
//
// WHY RECONSTRUCTION IS POSSIBLE: the move touched only `jobs`. Three other records were
// never rewritten and each independently names the original agency -
//   1. `inspections.agencyId`     - per job, linked by jobId
//   2. `oilTransactions.agencyId` - linked by mrNo
//   3. `job.atId` -> AT -> agencyId  (an AT belongs to exactly one agency)
//   4. the job number's PREFIX, issued from one tender's divisions (corroborating)
//
// HOW TO RUN
//   1. npm run dev, log in, RELOAD the tab.
//   2. DevTools console, paste this whole file, Enter.
//
//   MODE is 'dry-run' below. It reads and prints only - it writes NOTHING.
//   Change MODE to 'write' ONLY after the dry-run output has been reviewed and
//   authorised, and set it BACK to 'dry-run' before committing.
//
// THE WRITE SETS `agencyId` AND NOTHING ELSE. Not status, not atId, not any date, not
// any bill or challan field. The move corrupted exactly one field and only that field is
// restored - a reversal that "tidies" anything else is a second unscoped bulk write.

const MODE = 'dry-run';   // 'dry-run' | 'write'

// Groups written in write mode. SINGLE WITNESS is separate and explicitly enabled,
// because one witness is weak evidence even when it is not arbitrary: a prefix is issued
// from one tender's divisions and an atId names one agency, but neither is corroborated.
const WRITE_CORROBORATED = true;
const WRITE_SINGLE_WITNESS = true;

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

  const uid = auth?.currentUser?.uid;
  if (!uid) { console.error('Not signed in.'); return; }

  const snap = async (col, ...c) =>
    (await getDocs(query(collection(db, col), ...c))).docs.map(d => ({ id: d.id, ...d.data() }));

  // ownerId only. Deliberately NOT agency-scoped: the jobs being repaired are currently
  // under the wrong agency, so an agency-scoped read would only see the damage.
  const [agencies, atMasters, jobs, inspections, oilTx] = await Promise.all([
    snap('agencies', where('ownerId', '==', uid)),
    snap('atMasters', where('ownerId', '==', uid)),
    snap('jobs', where('ownerId', '==', uid)),
    snap('inspections', where('ownerId', '==', uid)),
    snap('oilTransactions', where('ownerId', '==', uid)),
  ]);

  const hdr = t => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
  const agencyById = Object.fromEntries(agencies.map(a => [a.id, a]));
  const atById = Object.fromEntries(atMasters.map(a => [a.id, a]));
  // Name AND id, always. Agency names are not unique across owners - two agencies named
  // "suchit" exist under two accounts (AUDIT F36). This script never RESOLVES by name (every
  // identity here is an agency id carried by a witness record), but a log line reading
  // "suchit -> suchit" would be unreadable, and the whole point of the printout is that a
  // human can check it. Identity in the log is the id; the name is the label.
  const nameOf = id => {
    if (!id) return '(none)';
    const a = agencyById[id];
    return a ? `${a.name || '(unnamed)'} [${id}]` : `${id} (unknown - not visible to this account)`;
  };

  const inspByJobId = {};
  inspections.forEach(i => { if (i.jobId) (inspByJobId[i.jobId] ||= []).push(i); });
  const oilByMr = {};
  oilTx.forEach(t => { if (t.mrNo) (oilByMr[String(t.mrNo).trim()] ||= []).push(t); });

  // Prefix ownership - longest match wins so "AM21 IS" is not shadowed by "21 IS".
  const prefixOwners = {};
  const addPrefixOwner = (p, agId) => {
    const key = String(p ?? '').trim().toUpperCase();
    if (!key || !agId) return;
    (prefixOwners[key] ||= new Set()).add(agId);
  };
  agencies.forEach(a => Object.values(a.prefixes || {}).forEach(v => {
    if (typeof v === 'string') addPrefixOwner(v, a.id);
    else Object.values(v || {}).forEach(p => addPrefixOwner(p, a.id));
  }));
  atMasters.forEach(at => Object.values(at.prefixes || {}).forEach(v => {
    if (typeof v === 'string') addPrefixOwner(v, at.agencyId);
    else Object.values(v || {}).forEach(p => addPrefixOwner(p, at.agencyId));
  }));
  const ownerFromJobNo = jobNo => {
    const s = String(jobNo ?? '').trim().toUpperCase();
    if (!s) return null;
    let best = null;
    Object.keys(prefixOwners).forEach(p => { if (s.startsWith(p) && (!best || p.length > best.length)) best = p; });
    if (!best) return null;
    const owners = [...prefixOwners[best]];
    return owners.length === 1 ? { agencyId: owners[0], prefix: best } : null;
  };

  const classify = j => {
    const current = String(j.agencyId ?? '').trim();
    const at = j.atId ? atById[j.atId] : null;
    const wAt = at && agencyById[at.agencyId] ? at.agencyId : '';

    const insps = inspByJobId[j.id] || [];
    const inspAg = [...new Set(insps.map(i => String(i.agencyId ?? '').trim()).filter(Boolean))];
    const wInsp = inspAg.length === 1 ? inspAg[0] : '';

    const txs = j.mrNo ? (oilByMr[String(j.mrNo).trim()] || []) : [];
    const txAg = [...new Set(txs.map(t => String(t.agencyId ?? '').trim()).filter(Boolean))];
    const wOil = txAg.length === 1 ? txAg[0] : '';

    const pref = ownerFromJobNo(j.jobNo);
    const wPrefix = pref ? pref.agencyId : '';

    const witnesses = [wAt, wInsp, wOil, wPrefix].filter(Boolean);
    const distinct = [...new Set(witnesses)];
    let verdict;
    if (distinct.length === 0) verdict = 'NO EVIDENCE';
    else if (distinct.length > 1) verdict = 'CONFLICTING';
    else verdict = witnesses.length > 1 ? 'CORROBORATED' : 'SINGLE WITNESS';

    return {
      job: j, current, verdict,
      origin: distinct.length === 1 ? distinct[0] : '',
      wAt, wInsp, wOil, wPrefix, insps, txs,
      witnessNames: [
        wAt ? `AT=${nameOf(wAt)}` : null,
        wInsp ? `inspection=${nameOf(wInsp)}` : null,
        wOil ? `oil=${nameOf(wOil)}` : null,
        wPrefix ? `prefix "${pref.prefix}"=${nameOf(wPrefix)}` : null,
      ].filter(Boolean).join(', '),
    };
  };

  const all = jobs.map(classify);

  const rowOf = c => ({
    jobNo: c.job.jobNo || '(none)',
    mrNo: c.job.mrNo || '',
    status: c.job.status || '',
    currentAgency: nameOf(c.current),
    targetAgency: c.origin ? nameOf(c.origin) : '(unestablished)',
    witnesses: c.witnessNames,
    hasIssuedDocuments: Boolean(c.job.estimateSentDate || c.job.billNo || c.job.challanNo || c.job.billSentDate),
    billNo: c.job.billNo || '',
  });

  // Only jobs whose evidence names a DIFFERENT agency need writing. A corroborated job
  // already sitting in the right place is correct and is not rewritten - a no-op write
  // is still a write, and would put this script's fingerprints on documents it did not
  // need to touch.
  const corroborated = all.filter(c => c.verdict === 'CORROBORATED' && c.origin && c.origin !== c.current);
  const singleWitness = all.filter(c => c.verdict === 'SINGLE WITNESS' && c.origin && c.origin !== c.current);
  const conflicting = all.filter(c => c.verdict === 'CONFLICTING');
  const noEvidence = all.filter(c => c.verdict === 'NO EVIDENCE');
  const alreadyCorrect = all.filter(c => c.origin && c.origin === c.current);

  const writeSet = [
    ...(WRITE_CORROBORATED ? corroborated : []),
    ...(WRITE_SINGLE_WITNESS ? singleWitness : []),
  ];

  hdr(`REVERSE BULK MOVE - MODE: ${MODE.toUpperCase()}`);
  console.log({
    totalJobs: jobs.length,
    corroborated_wouldWrite: corroborated.length,
    singleWitness_wouldWrite: singleWitness.length,
    conflicting_listedOnly: conflicting.length,
    noEvidence_listedOnly: noEvidence.length,
    alreadyInTheRightPlace_notTouched: alreadyCorrect.length,
    TOTAL_WOULD_WRITE: writeSet.length,
  });

  hdr(`GROUP A - CORROBORATED (2+ independent witnesses) -> WOULD WRITE (${corroborated.length})`);
  if (corroborated.length) console.table(corroborated.map(rowOf)); else console.log('(none)');

  hdr(`GROUP B - SINGLE WITNESS -> WOULD WRITE, APPROVE SEPARATELY (${singleWitness.length})`);
  if (singleWitness.length) {
    console.table(singleWitness.map(rowOf));
    console.log('');
    console.log('One witness only. Not arbitrary - a prefix is issued from one tender\'s');
    console.log('divisions and an atId names exactly one agency - but nothing corroborates');
    console.log('it. Set WRITE_SINGLE_WITNESS to false at the top to write GROUP A alone.');
  } else console.log('(none)');

  hdr(`GROUP C - CONFLICTING - LISTED ONLY, NEVER WRITTEN (${conflicting.length})`);
  if (conflicting.length) {
    console.table(conflicting.map(rowOf));
    // The witnesses disagree, so the evidence itself is what needs examining. Print the
    // underlying records rather than a verdict about them.
    console.log('');
    console.log('THE DISAGREEING RECORDS IN FULL:');
    conflicting.forEach(c => {
      console.log(`\n  ${c.job.jobNo}  (MR ${c.job.mrNo || '-'})  currently ${nameOf(c.current)}`);
      console.log(`    atId      -> ${c.wAt ? nameOf(c.wAt) : '(none)'}${c.job.atId ? ` [AT ${atById[c.job.atId]?.atNumber || c.job.atId}]` : ''}`);
      console.log(`    prefix    -> ${c.wPrefix ? nameOf(c.wPrefix) : '(no single owner)'}`);
      c.insps.forEach(i => console.log(`    inspection ${i.id} (${i.type || '?'}, ${i.inspectionDate || 'no date'}) -> ${nameOf(String(i.agencyId ?? '').trim())}`));
      if (!c.insps.length) console.log('    inspection -> (none)');
      // Oil is the witness most likely to be wrong: it is linked by mrNo, so a
      // transaction logged against the wrong MR attributes to the wrong agency without
      // anything looking broken.
      c.txs.forEach(t => console.log(`    oilTx ${t.id}: mrNo="${t.mrNo}" division="${t.division || '-'}" oilType="${t.oilType || '-'}" date=${t.date ? new Date(t.date).toISOString().split('T')[0] : '-'} -> ${nameOf(String(t.agencyId ?? '').trim())}`));
      if (!c.txs.length) console.log('    oilTx -> (none)');
      const sameMrJobs = jobs.filter(x => x.mrNo && x.mrNo === c.job.mrNo);
      console.log(`    other jobs on MR ${c.job.mrNo || '-'}: ${sameMrJobs.filter(x => x.id !== c.job.id).map(x => x.jobNo).join(', ') || '(none)'}`);
    });
    console.log('');
    console.log('An oil transaction is linked by mrNo alone. If one was logged against the');
    console.log('wrong MR it attributes to the wrong agency with nothing looking broken -');
    console.log('check its division and date against the job before trusting it. Nothing');
    console.log('here is written either way.');
  } else console.log('(none)');

  hdr(`GROUP D - NO EVIDENCE - LISTED ONLY, NEVER WRITTEN (${noEvidence.length})`);
  if (noEvidence.length) {
    console.table(noEvidence.map(c => ({
      ...rowOf(c),
      atId: c.job.atId || '(none)',
      inspectionCount: (c.insps || []).length,
      oilTxOnMr: (c.txs || []).length,
      createdAt: c.job.createdAt || '(none)',
      make: c.job.make || '',
      serialNo: c.job.serialNo || '',
      capacityKva: c.job.capacityKva ?? '',
    })));
    const withDocs = noEvidence.filter(c =>
      c.job.estimateSentDate || c.job.billNo || c.job.challanNo || c.job.billSentDate);
    console.log('');
    console.log(`OF THESE, ${withDocs.length} HAVE ISSUED DOCUMENTS:`);
    if (withDocs.length === 0) {
      console.log('  (none) - all are unbilled, un-estimated, undispatched.');
    } else {
      withDocs.forEach(c => {
        console.log(`  ${c.job.jobNo}  MR ${c.job.mrNo || '-'}  status ${c.job.status || '-'}`);
        console.log(`      estimateSentDate: ${c.job.estimateSentDate || '-'}`);
        console.log(`      billNo: ${c.job.billNo || '-'}   billSentDate: ${c.job.billSentDate || '-'}`);
        console.log(`      challanNo: ${c.job.challanNo || '-'}`);
        console.log(`      -> A document naming a supplier was issued for this unit, and the`);
        console.log(`         record no longer says which supplier. That is the one in this`);
        console.log(`         group that matters; the rest carry no external commitment.`);
      });
    }
    console.log('');
    console.log('No atId, no inspection, no oil transaction, no owned prefix. Nothing in the');
    console.log('data says where these came from, so nothing is written. They stay where the');
    console.log('move put them until someone who knows the work says otherwise.');
  } else console.log('(none)');

  if (alreadyCorrect.length) {
    hdr(`INFO - evidence agrees with where they already sit, not touched (${alreadyCorrect.length})`);
    console.table(alreadyCorrect.map(rowOf));
  }

  // ---------------------------------------------------------------------------
  // DOWNSTREAM: did anything derive a value from the WRONG agency during the window?
  // ---------------------------------------------------------------------------
  // The move rewrote jobs.agencyId. Anything computed from the agency AFTER that and
  // stored would carry the wrong basis, and reversing agencyId would not correct it.
  hdr('DOWNSTREAM EXPOSURE - values derived from an agency, stored on a job');

  const movedIds = new Set(writeSet.map(c => c.job.id));
  const suspectDerived = jobs.filter(j => movedIds.has(j.id)).map(j => ({
    jobNo: j.jobNo,
    targetAgency: nameOf(all.find(c => c.job.id === j.id)?.origin || ''),
    // Bill numbers: issued from a series. If one was issued while the job sat under the
    // wrong agency, the number came from the wrong series.
    billNo: j.billNo || '',
    billSentDate: j.billSentDate || '',
    // Estimates carry the agency's letterhead and circle routing.
    estimateSentDate: j.estimateSentDate || '',
    challanNo: j.challanNo || '',
    challanDate: j.challanDate || '',
  })).filter(r => r.billNo || r.estimateSentDate || r.challanNo);

  console.log(`Jobs being reversed that carry an issued document number: ${suspectDerived.length}`);
  if (suspectDerived.length) console.table(suspectDerived);
  console.log('');
  console.log('READ THIS AS A QUESTION, NOT A VERDICT. These numbers are only wrong if they');
  console.log('were ISSUED AFTER the bulk move. Compare each date against when the move ran:');
  console.log('  - issued BEFORE the move  -> correct, drawn from the right agency. No action.');
  console.log('  - issued AFTER the move   -> drawn while the job sat under AARATI. Reversing');
  console.log('                               agencyId does NOT correct an already-issued');
  console.log('                               number, and the printed document is authority.');
  console.log('');
  console.log('WHAT IS NOT AT RISK, checked rather than assumed:');
  console.log('  - job number counters: held on the AT (atMasters.lastJobNumbers) and on the');
  console.log('    agency, and the move did not touch atId - so numbering drew from the same');
  console.log('    AT throughout. Counters were never consulted for these jobs again.');
  console.log('  - allotment consumption: NOT stored. NewJob counts existing jobs live at');
  console.log('    intake, so a wrong agencyId changed what a FUTURE intake would count, not');
  console.log('    any stored value. Reversing agencyId restores the count by itself.');
  console.log('  - inspections / oilTransactions: never rewritten by the move, which is what');
  console.log('    made this reconstruction possible in the first place.');

  // ---------------------------------------------------------------------------
  if (MODE !== 'write') {
    hdr('DRY RUN - NOTHING WAS WRITTEN');
    console.log(`Would set agencyId on ${writeSet.length} job(s), and NOTHING else on any document.`);
    console.log(`  GROUP A corroborated  : ${WRITE_CORROBORATED ? corroborated.length : 0}`);
    console.log(`  GROUP B single witness: ${WRITE_SINGLE_WITNESS ? singleWitness.length : 0}`);
    console.log(`  GROUP C conflicting   : 0 (listed only)`);
    console.log(`  GROUP D no evidence   : 0 (listed only)`);
    console.log("To apply: change MODE to 'write' at the top and re-paste.");
    window.__reverseMove = { all, corroborated, singleWitness, conflicting, noEvidence, alreadyCorrect, writeSet };
    console.log('Full results: window.__reverseMove');
    return;
  }

  hdr(`WRITING agencyId on ${writeSet.length} job(s)`);
  // Printed before committing so the console itself is the record the move never kept.
  writeSet.forEach(c => console.log(`  ${c.job.jobNo}: ${nameOf(c.current)} -> ${nameOf(c.origin)}  [${c.verdict}]`));

  let written = 0;
  for (let i = 0; i < writeSet.length; i += 400) {   // well under Firestore's 500 cap
    const slice = writeSet.slice(i, i + 400);
    const batch = writeBatch(db);
    slice.forEach(c => batch.update(doc(db, 'jobs', c.job.id), { agencyId: c.origin }));
    await batch.commit();          // awaited - the bug in the button being reversed was not
    written += slice.length;
    console.log(`  committed ${written}/${writeSet.length}`);
  }
  console.log(`\nDONE. agencyId written on ${written} job(s). No other field was modified.`);
  console.log('Reload the tab and re-run scripts/reverse-bulk-move-console.js to verify.');
  window.__reverseMove = { all, corroborated, singleWitness, conflicting, noEvidence, alreadyCorrect, writeSet, written };
})();
