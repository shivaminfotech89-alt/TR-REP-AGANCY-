// READ-ONLY: which agencies' job number prefixes come from the AGENCY record rather than
// from an AT - the legacy fallback case.
//
// WHY THIS MATTERS NOW: the Divisions & Prefixes section of the Agency form is read-only,
// because getNextJobNoInfo (AgencyContext) treats the AT as the authority:
//
//     activeAtMaster.prefixes   when the AT has any
//     activeAgency.prefixes     ONLY when it has none
//
// An agency whose prefixes live only on the agency record therefore has prefixes that ARE
// in use and can no longer be edited from the agency screen. This script counts exactly
// that population, so the decision about a one-time migration rests on numbers.
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

  const [agencies, atMasters, jobs] = await Promise.all([
    snap('agencies', where('ownerId', '==', uid)),
    snap('atMasters', where('ownerId', '==', uid)),
    snap('jobs', where('ownerId', '==', uid)),
  ]);

  const hdr = t => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
  const count = o => Object.keys(o || {}).length;

  // The app resolves prefixes against the ACTIVE AT, not against every AT the agency has.
  // Which AT is active is a per-browser localStorage choice, so it cannot be read for
  // other operators. Both are reported: the active one where knowable, and whether ANY
  // AT of that agency carries prefixes - the second is what a migration would key on.
  const activeAgencyId = localStorage.getItem('activeAgencyId') || '';
  const activeAtKey = activeAgencyId ? `activeAtMasterId_${activeAgencyId}` : '';
  const activeAtId = activeAtKey ? (localStorage.getItem(activeAtKey) || '') : '';

  const rows = agencies.map(a => {
    const ats = atMasters.filter(m => m.agencyId === a.id);
    const atsWithPrefixes = ats.filter(m => count(m.prefixes) > 0);
    const agencyDivs = count(a.prefixes);

    // What THIS browser would resolve right now, mirroring getNextJobNoInfo exactly.
    const activeAt = ats.find(m => m.id === activeAtId) || null;
    const resolvedFrom = !activeAt
      ? (agencyDivs > 0 ? 'agency (no active AT)' : 'nothing - JOB fallback')
      : (count(activeAt.prefixes) > 0 ? `AT ${activeAt.atNumber || activeAt.id}` : (agencyDivs > 0 ? 'agency (AT has none)' : 'nothing - JOB fallback'));

    // The classification a migration would use, independent of which AT is active.
    let state;
    if (ats.length === 0) state = agencyDivs > 0 ? 'LEGACY - prefixes on agency, NO AT AT ALL' : 'EMPTY - no AT, no prefixes';
    else if (atsWithPrefixes.length === ats.length) state = 'OK - every AT carries its own prefixes';
    else if (atsWithPrefixes.length > 0) state = `MIXED - ${atsWithPrefixes.length} of ${ats.length} ATs carry prefixes`;
    else state = agencyDivs > 0 ? 'LEGACY - prefixes on agency, no AT carries any' : 'EMPTY - AT exists, no prefixes anywhere';

    return {
      agency: a.name || a.id,
      agencyId: a.id,
      state,
      resolvedInThisBrowser: resolvedFrom,
      agencyDivisions: agencyDivs,
      agencyDivisionNames: Object.keys(a.prefixes || {}).join(', ') || '(none)',
      atCount: ats.length,
      atsWithPrefixes: atsWithPrefixes.length,
      atNumbersWithPrefixes: atsWithPrefixes.map(m => m.atNumber || m.id).join(', ') || '(none)',
      jobsCreated: jobs.filter(j => j.agencyId === a.id).length,
      // A flat string prefix is the oldest shape - one prefix used for every core type.
      hasFlatStringPrefix: Object.values(a.prefixes || {}).some(v => typeof v === 'string'),
    };
  });

  hdr(`PREFIX AUTHORITY BY AGENCY - ${agencies.length} agencies`);
  console.table(rows.map(({ agencyId, agencyDivisionNames, atNumbersWithPrefixes, ...r }) => r));

  const legacy = rows.filter(r => r.state.startsWith('LEGACY'));
  const mixed = rows.filter(r => r.state.startsWith('MIXED'));
  const empty = rows.filter(r => r.state.startsWith('EMPTY'));

  hdr('THE ANSWER');
  console.log(`Agencies whose prefixes live ONLY on the agency record : ${legacy.length}`);
  console.log(`Agencies where SOME ATs carry prefixes and some do not : ${mixed.length}`);
  console.log(`Agencies with no prefixes anywhere                     : ${empty.length}`);
  console.log(`Agencies fully on the AT                               : ${rows.length - legacy.length - mixed.length - empty.length}`);

  if (legacy.length) {
    console.log('');
    console.log('LEGACY agencies in detail - these are the ones the read-only section affects:');
    legacy.forEach(r => {
      console.log(`  ${r.agency}`);
      console.log(`      divisions on agency : ${r.agencyDivisionNames}`);
      console.log(`      ATs                 : ${r.atCount} (none carry prefixes)`);
      console.log(`      jobs created        : ${r.jobsCreated}`);
      console.log(`      flat string prefix  : ${r.hasFlatStringPrefix ? 'YES - one prefix for every core type' : 'no'}`);
    });
  }

  hdr('WHAT A MIGRATION WOULD DO, AND WHAT IT CANNOT DECIDE');
  console.log('Copying agency.prefixes onto an AT is only well defined when the agency has');
  console.log('EXACTLY ONE AT. With several, the prefixes belong to whichever tender issued');
  console.log('them, and the agency record does not say which - the data cannot distinguish');
  console.log('the right answer, so nothing should be copied automatically.');
  console.log('');
  const singleAt = legacy.filter(r => r.atCount === 1);
  const multiAt = legacy.filter(r => r.atCount > 1);
  const noAt = legacy.filter(r => r.atCount === 0);
  console.log(`  unambiguous (exactly one AT) : ${singleAt.length}`);
  console.log(`  ambiguous (several ATs)      : ${multiAt.length}  <- needs a human to say which tender`);
  console.log(`  no AT at all                 : ${noAt.length}  <- create the AT first; nothing to copy onto`);
  console.log('');
  console.log('NOTE: no migration may be needed at all. AtDivisions already writes prefixes');
  console.log('to BOTH the AT and the agency (AtDivisions.tsx:89-91), so the first save on');
  console.log('the AT screen ends the fallback for that agency by itself.');

  // ==========================================================================
  // RETROSPECTIVE: did the counter restart already happen?
  // ==========================================================================
  // Until it was fixed, `addAtMaster` wrote `lastJobNumbers: {}` on a new AT, and
  // `getNextJobNoInfo` branched on `activeAtMaster && activeAtMaster.lastJobNumbers` -
  // where `{}` is TRUTHY, so the agency's populated counters in the `else if` were never
  // reached. An agency numbering off its own counters silently restarted at 1 the moment
  // its first AT existed.
  //
  // The signature is an AT whose counters are EMPTY OR BELOW the agency's for the same
  // key, while the agency's map is populated and jobs exist. This may explain some of the
  // job-number collisions in AUDIT C1, which is worth knowing before renumbering.

  const maxVal = m => Object.values(m || {}).reduce((n, v) => Math.max(n, Number(v) || 0), 0);

  const suspects = [];
  agencies.forEach(a => {
    const agencyCounters = a.lastJobNumbers || {};
    const agencyMax = maxVal(agencyCounters);
    if (agencyMax === 0) return;                       // never numbered off the agency
    const agJobs = jobs.filter(j => j.agencyId === a.id);
    if (agJobs.length === 0) return;

    atMasters.filter(m => m.agencyId === a.id).forEach(at => {
      const atCounters = at.lastJobNumbers || {};
      // Per-key comparison, not just the maxima: a restart shows up key by key.
      const behind = Object.keys(agencyCounters).filter(k => {
        const ag = Number(agencyCounters[k]) || 0;
        const atv = Number(atCounters[k]) || 0;
        return ag > 0 && atv < ag;
      });
      if (behind.length === 0) return;
      suspects.push({
        agency: a.name || a.id,
        at: at.atNumber || at.id,
        atCounterKeys: Object.keys(atCounters).length,
        atIsEmpty: Object.keys(atCounters).length === 0,
        keysBehind: behind.length,
        worstGap: behind.reduce((n, k) =>
          Math.max(n, (Number(agencyCounters[k]) || 0) - (Number(atCounters[k]) || 0)), 0),
        detail: behind.map(k => `${k}: agency ${agencyCounters[k]} vs AT ${atCounters[k] ?? '(unset)'}`).join(' | '),
      });
    });
  });

  hdr(`COUNTER RESTART - SUSPECTED CASES: ${suspects.length}`);
  if (suspects.length === 0) {
    console.log('(none) - no AT sits behind its agency on any counter key.');
  } else {
    console.table(suspects.map(({ detail, ...s }) => s));
    console.log('');
    suspects.forEach(s => console.log(`  ${s.agency} / AT ${s.at}: ${s.detail}`));
    console.log('');
    console.log('atIsEmpty=true is the strongest signal: the AT has never been incremented,');
    console.log('so any job numbered under it started from 1 against an agency series that');
    console.log('had already reached the values listed.');
    console.log('');
    console.log('A gap alone is NOT proof. An AT legitimately starts its own series at 1 for');
    console.log('a new tender, which looks identical on these fields. The duplicates below');
    console.log('are the evidence that distinguishes them.');
  }

  // Realised collisions: the same jobNo twice within one agency.
  const byAgencyJobNo = {};
  jobs.forEach(j => {
    const key = `${j.agencyId}|${String(j.jobNo ?? '').trim()}`;
    if (!String(j.jobNo ?? '').trim()) return;
    (byAgencyJobNo[key] ||= []).push(j);
  });
  const collisions = Object.entries(byAgencyJobNo)
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => {
      const agencyId = key.split('|')[0];
      const ag = agencies.find(x => x.id === agencyId);
      // Did the duplicates land on DIFFERENT ATs? That is the restart signature - the
      // same number issued once from the agency series and once from a fresh AT.
      const atIds = [...new Set(list.map(j => j.atId || '(none)'))];
      return {
        agency: ag?.name || agencyId,
        jobNo: key.split('|')[1],
        copies: list.length,
        distinctAts: atIds.length,
        straddlesAts: atIds.length > 1,
        atIds: atIds.map(id => atMasters.find(m => m.id === id)?.atNumber || id).join(', '),
        mrNos: list.map(j => j.mrNo || '(none)').join(', '),
        createdAt: list.map(j => j.createdAt || '(none)').join(' | '),
      };
    });

  hdr(`REALISED JOB NUMBER COLLISIONS: ${collisions.length}`);
  if (collisions.length === 0) {
    console.log('(none) - no job number appears twice within one agency.');
  } else {
    console.table(collisions);
    const straddling = collisions.filter(c => c.straddlesAts);
    console.log('');
    console.log(`Of these, ${straddling.length} straddle DIFFERENT ATs (or an AT and none).`);
    console.log('Those are the ones the counter restart explains: the same number issued');
    console.log('once from the agency series and again from an AT that began at 1.');
    console.log('Collisions within a SINGLE AT have a different cause - see AUDIT O2, job');
    console.log('numbers are not uniquely allocated - and renumbering them is a separate');
    console.log('decision from this one.');
  }

  window.__prefixAuthority = {
    rows, legacy, mixed, empty, singleAt, multiAt, noAt,
    counterRestartSuspects: suspects, collisions,
  };
  console.log('\nFull results: window.__prefixAuthority');
})();
