// WHY DOES NO AT COVER THIS DATE? - AT ranges, gaps, and which of three causes it is
//
// READ-ONLY. No set/update/delete/batch anywhere in this file.
//
// Paste into the browser console on a DEV build, signed in as the agency's OWNER.
//
// THE QUESTION
// ------------
// Five jobs report "no AT covers this date". That has three quite different causes, and the
// cheapest fix depends entirely on which:
//
//   1. AN AT EXISTS BUT ITS RANGE IS WRONG OR NARROW - correcting one date range fixes
//      every affected job at once, and fixes the cause rather than the symptom.
//   2. NO AT EXISTED FOR THAT PERIOD - one needs creating, and every job in the gap
//      inherits it.
//   3. THE JOBS ARE DATED WRONG - the AT records are right and the job dates are the
//      outlier. Backfilling atId would then paper over a bad date.
//
// The third is the one a coverage check alone cannot see, so this also plots where the
// agency's OTHER jobs fall. If 40 jobs sit inside an AT range and 5 sit outside it by a
// wide margin, the 5 are suspect. If the 5 sit in a plausible gap between two ATs, they
// are not.

const AGENCY_NAME_CONTAINS = 'AARATI';   // '' for every agency you own
const FOCUS_DATE = '2026-08-11';         // the date the census flagged

(async () => {
  const { collection, query, where, getDocs } = window.__fs;
  const db = window.__db, uid = window.__auth.currentUser?.uid;
  const toMs = window.__utils?.toMillis, fdm = window.__utils?.formatDDMMYYYY;
  if (!db || !uid) { console.error('Sign in first - window.__db / __auth not ready.'); return; }
  if (!toMs || !fdm) { console.error('window.__utils is missing - update src/lib/firebase.ts, run a DEV build.'); return; }

  const focus = Date.parse(FOCUS_DATE);
  const day = 86400000;

  const [agSnap, atSnap, jobSnap] = await Promise.all([
    getDocs(query(collection(db, 'agencies'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'atMasters'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'jobs'), where('ownerId', '==', uid))),
  ]);
  const agencies = [], ats = [], jobs = [];
  agSnap.forEach(d => agencies.push({ id: d.id, ...d.data() }));
  atSnap.forEach(d => ats.push({ id: d.id, ...d.data() }));
  jobSnap.forEach(d => jobs.push({ id: d.id, ...d.data() }));

  const wanted = agencies.filter(a =>
    !AGENCY_NAME_CONTAINS || String(a.name || '').toUpperCase().includes(AGENCY_NAME_CONTAINS.toUpperCase()));
  if (!wanted.length) { console.error(`No owned agency matches "${AGENCY_NAME_CONTAINS}".`); return; }

  for (const ag of wanted) {
    const agAts = ats.filter(a => a.agencyId === ag.id);
    const agJobs = jobs.filter(j => j.agencyId === ag.id);
    console.log(`\n================ ${ag.name || ag.id} ================`);
    console.log(`  ${agAts.length} AT record(s), ${agJobs.length} job(s)`);

    if (!agAts.length) {
      console.log('  NO AT RECORDS AT ALL - cause 2 by definition. One must be created.');
      continue;
    }

    console.table(agAts.map(a => {
      const s = toMs(a.startDate), e = toMs(a.endDate);
      return {
        atNumber: a.atNumber || a.name || '(blank)',
        status: a.status || '(blank)',
        start: s === null ? '(unset)' : fdm(s),
        end: e === null ? '(unset)' : fdm(e),
        spanDays: (s === null || e === null) ? '-' : Math.round((e - s) / day),
        coversFocus: (s !== null && e !== null && focus >= s && focus <= e) ? 'YES' : 'no',
        missBy: (s === null || e === null) ? '-'
              : focus < s ? `${Math.ceil((s - focus) / day)} d before start`
              : focus > e ? `${Math.ceil((focus - e) / day)} d after end`
              : 'covers',
      };
    }));

    // ---- where the agency's other jobs actually fall ----
    const dated = agJobs
      .map(j => ({ j, ms: toMs(j.dateOfIssue) ?? toMs(j.mrDate) ?? toMs(j.createdAt) }))
      .filter(x => x.ms !== null);
    const inSome = dated.filter(x => agAts.some(a => {
      const s = toMs(a.startDate), e = toMs(a.endDate);
      return s !== null && e !== null && x.ms >= s && x.ms <= e;
    }));
    const outside = dated.filter(x => !inSome.includes(x));
    console.log(`\n  jobs with a usable date : ${dated.length}`);
    console.log(`  inside some AT range    : ${inSome.length}`);
    console.log(`  outside every AT range  : ${outside.length}`);
    if (outside.length) {
      console.log('  the ones outside:');
      console.table(outside.map(x => ({
        jobNo: x.j.jobNo || x.j.id,
        mrNo: x.j.mrNo || '-',
        date: fdm(x.ms),
        atId: x.j.atId ? 'set' : '(EMPTY)',
        status: x.j.status || '',
      })));
    }

    // ---- the verdict ----
    const withRange = agAts.map(a => ({ a, s: toMs(a.startDate), e: toMs(a.endDate) }))
      .filter(x => x.s !== null && x.e !== null);
    const nearest = withRange
      .map(x => ({ ...x, gap: focus < x.s ? x.s - focus : focus > x.e ? focus - x.e : 0 }))
      .sort((p, q) => p.gap - q.gap)[0];

    console.log(`\n  === VERDICT for ${fdm(focus)} ===`);
    if (!nearest) {
      console.log('  No AT has usable start and end dates. The ranges are unset, not wrong -');
      console.log('  fill them in before concluding anything about coverage.');
    } else if (nearest.gap === 0) {
      console.log(`  An AT DOES cover this date (${nearest.a.atNumber || nearest.a.name}).`);
      console.log('  If the census said otherwise, the census read a different date field.');
    } else {
      const days = Math.ceil(nearest.gap / day);
      console.log(`  Nearest AT: "${nearest.a.atNumber || nearest.a.name}" ${fdm(nearest.s)} - ${fdm(nearest.e)}`);
      console.log(`  The date misses it by ${days} day(s).`);
      if (days <= 60) {
        console.log('  -> CAUSE 1 is likely: a range that is slightly wrong or narrow. Correcting');
        console.log('     one AT\'s dates fixes every job in the gap at once, and fixes the cause.');
      } else if (outside.length === dated.length) {
        console.log('  -> CAUSE 3 is likely: EVERY dated job falls outside every AT range, so the');
        console.log('     AT dates are the outlier, not the jobs.');
      } else if (outside.length <= 5 && days > 60) {
        console.log('  -> CAUSE 3 is possible: a handful of jobs sit far outside ranges that hold');
        console.log('     the rest. Check those job dates against the intake register before');
        console.log('     backfilling - an atId written over a wrong date hides the wrong date.');
      } else {
        console.log('  -> CAUSE 2 is likely: a genuine uncovered period. An AT covering it would');
        console.log('     give every job in the gap a home.');
      }
    }
  }
  console.log('\nDone. Nothing was written.');
})();
