// DOES EVERY MR AGREE WITH ITSELF ABOUT WHICH TENDER IT BELONGS TO?
//
// READ-ONLY. No set/update/delete/batch anywhere in this file.
//
// Paste into the browser console on a DEV build, signed in as the OWNER. Owner-scoped
// (AUDIT F59) - run once per account.
//
// WHY
// ---
// A transformer added to an existing MR belongs to the tender that MR was issued under, not
// to whichever AT the session happens to have selected months later: allotments count per
// AT and the AT percentage prices the job. So MrLedger must draw its job number from - and
// stamp - the MR's OWN AT.
//
// That only works if an MR HAS one AT. This counts the three cases:
//
//   AGREED     every job on the MR carries the same non-empty atId  -> usable
//   MISSING    no job on the MR carries an atId                     -> nothing to draw from
//   SPLIT      the MR's jobs disagree                               -> a data fault
//
// The last two are what a block would refuse. The count decides whether blocking is a
// footnote or an obstacle.

(async () => {
  const { collection, query, where, getDocs } = window.__fs;
  const db = window.__db, uid = window.__auth.currentUser?.uid;
  const fdm = window.__utils?.formatDDMMYYYY;
  if (!db || !uid) { console.error('Sign in first - window.__db / __auth not ready.'); return; }
  if (!fdm) { console.error('window.__utils is missing - update src/lib/firebase.ts, run a DEV build.'); return; }

  const [agSnap, atSnap, jobSnap] = await Promise.all([
    getDocs(query(collection(db, 'agencies'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'atMasters'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'jobs'), where('ownerId', '==', uid))),
  ]);
  const grab = s => { const o = []; s.forEach(d => o.push({ id: d.id, ...d.data() })); return o; };
  const agencies = grab(agSnap), ats = grab(atSnap), jobs = grab(jobSnap);
  const agName = id => (agencies.find(a => a.id === id) || {}).name || id || '(none)';
  const atName = id => {
    const a = ats.find(x => x.id === id);
    return a ? (a.atNumber || a.name || a.id) : `(unknown AT ${String(id).slice(0, 6)}…)`;
  };

  // group by agency + MR number, which is how an MR is identified everywhere else
  const mrs = {};
  jobs.forEach(j => {
    const key = `${j.agencyId}|${String(j.mrNo ?? '').trim()}`;
    (mrs[key] ||= []).push(j);
  });

  const rows = [];
  let agreed = 0, missing = 0, split = 0;

  Object.entries(mrs).forEach(([key, list]) => {
    const [agencyId, mrNo] = key.split('|');
    const ids = [...new Set(list.map(j => String(j.atId ?? '').trim()).filter(Boolean))];
    const withoutAt = list.filter(j => !String(j.atId ?? '').trim()).length;

    let verdict;
    if (ids.length === 1 && withoutAt === 0) { verdict = 'AGREED'; agreed++; }
    else if (ids.length === 0) { verdict = 'MISSING - no job carries an atId'; missing++; }
    else if (ids.length === 1) { verdict = `PARTIAL - ${withoutAt} of ${list.length} job(s) have no atId`; split++; }
    else { verdict = `SPLIT - ${ids.length} different ATs`; split++; }

    rows.push({
      agency: agName(agencyId),
      mrNo: mrNo || '(blank)',
      jobs: list.length,
      ats: ids.length ? ids.map(atName).join(' | ') : '(none)',
      jobsWithoutAt: withoutAt,
      verdict,
    });
  });

  rows.sort((a, b) => (a.verdict === 'AGREED' ? 1 : 0) - (b.verdict === 'AGREED' ? 1 : 0));
  console.log(`\n${rows.length} MR(s) across ${agencies.length} agency(ies)\n`);
  console.table(rows);

  console.log('=== VERDICT ===');
  console.log(`  AGREED  (one AT, every job)  : ${agreed}`);
  console.log(`  PARTIAL / SPLIT              : ${split}`);
  console.log(`  MISSING (no atId anywhere)   : ${missing}`);
  const blocked = split + missing;
  if (blocked === 0) {
    console.log('\n  Every MR agrees with itself. Drawing the job number and the atId from the');
    console.log("  MR's own AT works for all of them, and a block would never fire.");
  } else {
    console.log(`\n  ${blocked} MR(s) could not have a transformer added under the new rule, and`);
    console.log("  would be refused with a named error rather than silently taking the session's AT.");
    console.log('  PARTIAL is the mild case - one AT is known, some jobs simply lack the stamp,');
    console.log('  so backfilling those jobs fixes it. SPLIT and MISSING need a decision per MR.');
  }
  console.log('\nDone. Nothing was written.');
})();
