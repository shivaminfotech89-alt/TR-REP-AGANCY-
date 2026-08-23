// READ-ONLY: which agency's estimate master needs the least repair?
//
// The plan is to correct ONE agency's sections by hand and publish from there, so the
// question is which one starts closest. This scores every agency x every section against
// what the resolver actually requires, and separates the repairs by COST - because "wrong
// schedule" and "missing one row" are not the same amount of work.
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

  // The identity test the app itself uses, so this cannot drift from what the screen says.
  const { checkMasterSection } = await import('/src/lib/estimateMasterHealth.ts');

  const snap = async (col, ...c) =>
    (await getDocs(query(collection(db, col), ...c))).docs.map(d => ({ id: d.id, ...d.data() }));
  const agencies = await snap('agencies', where('ownerId', '==', uid));

  const hdr = t => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
  const FIELD = {
    CRGO: 'estimateMasterCRGO',
    AMORPHOUS: 'estimateMasterAmorphous',
    WOUND_CORE: 'estimateMasterWoundCore',
    OVERHAULING: 'estimateMasterOverhauling',
  };

  // Repair cost, not a pass/fail. The distinction is the whole point of the exercise.
  //   3 = wrong schedule entirely   - the section must be replaced
  //   2 = empty                     - the schedule must be entered (a reset-to-default may do it)
  //   1 = right schedule, scrap code missing or foreign - one row to add or one code to change
  //   0 = correct
  const scoreOf = h => {
    if (h.blocking) return 3;
    if (h.isEmpty) return 2;
    if (h.problems.length > 0) return 1;
    return 0;
  };
  const LABEL = ['correct', 'one row / one code', 'empty - schedule needed', 'WRONG SCHEDULE'];

  const rows = [];
  const perAgency = {};
  agencies.forEach(a => {
    const name = a.name || a.id;
    perAgency[name] = { agency: name, correct: 0, minorFixes: 0, empty: 0, wrongSchedule: 0, totalCost: 0 };
    Object.entries(FIELD).forEach(([section, field]) => {
      const h = checkMasterSection(section, a[field]);
      const score = scoreOf(h);
      perAgency[name].totalCost += score;
      if (score === 0) perAgency[name].correct++;
      else if (score === 1) perAgency[name].minorFixes++;
      else if (score === 2) perAgency[name].empty++;
      else perAgency[name].wrongSchedule++;
      rows.push({
        agency: name,
        section: h.label,
        items: h.itemCount,
        verdict: LABEL[score],
        requiredScrapCode: h.requiredScrapCode ?? '-',
        scrapCodePresent: h.requiredScrapCode === null ? '-' : h.scrapCodePresent,
        foreignScrapCodes: h.foreignScrapCodes.join(', ') || '-',
        ownScorePct: Math.round(h.ownScore * 100),
        crgoScorePct: Math.round(h.crgoScore * 100),
        problems: h.problems.join(' | ') || '(none)',
      });
    });
  });

  hdr('SECTION SCORECARD - every agency, every section');
  console.table(rows.map(({ problems, ...r }) => r));

  hdr('REPAIR COST BY AGENCY - lowest totalCost needs the least work');
  const ranked = Object.values(perAgency).sort((a, b) => a.totalCost - b.totalCost);
  console.table(ranked);

  console.log('');
  console.log('totalCost weights each section: 0 correct, 1 one row/code, 2 empty, 3 wrong schedule.');
  console.log('It is a rough ordering, not a verdict - an "empty" section may be one click if the');
  console.log('shipped default is the right schedule for it, while a "wrong schedule" section');
  console.log('always needs someone to decide what belongs there.');
  if (ranked.length) {
    console.log('');
    console.log(`START WITH: ${ranked[0].agency} - ${ranked[0].correct} section(s) already correct, ` +
      `${ranked[0].minorFixes} needing one row or code, ${ranked[0].empty} empty, ${ranked[0].wrongSchedule} holding the wrong schedule.`);
  }

  hdr('PROBLEMS IN FULL');
  rows.filter(r => r.problems !== '(none)').forEach(r =>
    console.log(`  ${r.agency} / ${r.section}: ${r.problems}`));

  console.log('');
  console.log('REMINDER: publishing from the chosen agency writes its sections into EVERY');
  console.log('agency and into public_config. Correct all of its sections FIRST - the publish');
  console.log('path now refuses while any section is showing fallback content (AUDIT F29),');
  console.log('but it cannot tell a correct schedule from a plausible wrong one.');

  window.__masterScorecard = { rows, ranked };
  console.log('\nFull results: window.__masterScorecard');
})();
