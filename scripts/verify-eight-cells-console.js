// VERIFY THE EIGHT CORRECTED CELLS, AND WHAT THE FAN-OUT LEFT IN THE OTHER SECTIONS
//
// READ-ONLY. No set/update/delete/batch anywhere in this file.
//
// Paste into the browser console on a DEV build, signed in. Owner-scoped: it sees only the
// agencies owned by the signed-in user, so run it as utparekh007 for MEGHA / AARATI /
// DRISHIV / suchit, and again as shivaminfotech89 for SUCHIT / UPENDRA.
//
// WHAT IT ANSWERS
// ---------------
// 1. Did all EIGHT cells clear on every agency, or only the one that was checked by eye?
//    A cleared cell stores nothing and RESOLVES through Schedule-A. Both are shown, because
//    "INHERITING" alone does not prove the resolved figure is the tender rate - and the
//    resolved figure alone does not prove nothing is stored.
//
// 2. What do Overhauling and Circle Limits hold after the five-section fan-out? Those two
//    sections were written from the source agency along with CRGO, and the confirmation
//    dialog counted changed CELLS, never rows added or removed (AUDIT O31). Row counts and
//    codes are listed so a section that arrived from somewhere else is visible.

const TARGETS = [
  // masterCode, kva, what the tender says for that band
  ['1b',     '100', 46],
  ['1d',     '100', 286],
  ['1e',     '100', 57],
  ['2a',     '100', 34],
  ['2b',     '100', 149],
  ['20',     '100', 172],   // master '20' Testing Of Trans. -> Schedule-A sr '19'
  ['12A(b)', '10',  163],   // aluminium HV coil, without S.E.
  ['12A(b)', '16',  163],
  // NOT targets - a discriminator. `addAgency` seeds a new agency's CRGO from
  // public_config, falling back to the shipped default, and the shipped default stores
  // 12A(b) at 163 for 10, 16, 25 AND 63. So if 25 and 63 also hold a stored 163 that
  // nobody touched, the pair at 10/16 is SEEDED data, not a clear that failed - the whole
  // row arrived stored and only the cells someone edited were ever going to change.
  // If 25 and 63 are INHERITING while 10/16 are stored, the row was edited and the clear
  // did not take on two cells.
  ['12A(b)', '25',  163],
  ['12A(b)', '63',  163],
];

(async () => {
  const { collection, query, where, getDocs } = window.__fs;
  const sch = window.__schedule;
  const db = window.__db, uid = window.__auth.currentUser?.uid;
  const email = window.__auth.currentUser?.email || '(unknown)';
  if (!db || !uid) { console.error('Sign in first - window.__db / __auth not ready.'); return; }
  if (!sch) {
    console.error('window.__schedule is missing - update src/lib/firebase.ts, and run on a DEV build.');
    console.error('Refusing to carry a second copy of Schedule-A in this script.');
    return;
  }
  const { SCHEDULE_A, bandForKva, scheduleSrForMasterCode } = sch;

  const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);

  // What the estimate would charge: master value when stored and > 0, else Schedule-A for
  // the band. This mirrors resolveRate's order - master first, schedule second - so the
  // "resolved" column is what a job actually prices at, not a restatement of the cell.
  const resolve = (stored, code, kva) => {
    if (stored !== null && stored > 0) return { value: stored, from: 'agency master' };
    const sr = scheduleSrForMasterCode(code);
    const entry = sr ? SCHEDULE_A.find(i => i.sr === sr) : null;
    const v = entry ? entry.rates[bandForKva(Number(kva) || 0)] : null;
    return (typeof v === 'number' && v > 0)
      ? { value: v, from: `Schedule-A ${sr}` }
      : { value: null, from: 'UNRESOLVED - would block' };
  };

  // THE SHARED BASELINE FIRST.
  //
  // Agencies and public_config are corrected by different actions - a per-agency save and a
  // publish - and only the second reaches the baseline. Reporting agencies alone answers
  // "are the agencies fixed" and leaves "did the publish land" open, which is the question
  // that actually decides whether a new agency inherits the typos.
  const { doc, getDoc } = window.__fs;
  const pubSnap = await getDoc(doc(db, 'public_config', 'estimate_master'));
  console.log('\n=== public_config/estimate_master (the shared baseline) ===');
  if (!pubSnap.exists()) {
    console.log('  Document does not exist - new agencies fall through to the shipped defaults.');
  } else {
    const pub = pubSnap.data();
    const pubCrgo = Array.isArray(pub.estimateMasterCRGO) ? pub.estimateMasterCRGO : [];
    console.log(`  CRGO section : ${pubCrgo.length ? pubCrgo.length + ' items' : '(absent)'}`);
    console.log(`  last written : ${window.__utils?.formatDDMMYYYY?.(pub.updatedAt) ?? '(unknown)'} by ${pub.updatedBy || '(not recorded)'}`);
    console.table(TARGETS.slice(0, 8).map(([code, kva, tender]) => {
      const row = pubCrgo.find(i => String(i?.itemCode ?? '').trim().toLowerCase() === code.toLowerCase());
      const v = row ? num(row.rates?.[kva]) : null;
      return {
        cell: `${code} @ ${kva} kVA`,
        baseline: !row ? '(row absent)' : v === null ? 'INHERITING' : v.toFixed(2),
        tender,
        verdict: !row ? 'row missing from baseline'
               : v === null ? 'cleared - new agencies inherit the tender rate'
               : v === tender ? 'holds the tender value (stored, not inherited)'
               : `STILL WRONG - holds ${v}, publish has not landed`,
      };
    }));
  }

  const snap = await getDocs(query(collection(db, 'agencies'), where('ownerId', '==', uid)));
  const agencies = [];
  snap.forEach(d => agencies.push({ id: d.id, ...d.data() }));

  console.log(`\nSigned in as ${email} - ${agencies.length} agencies owned\n`);

  let allClear = true;

  for (const a of agencies) {
    const name = a.name || a.id;
    console.log(`\n================ ${name} ================`);

    // raw stored CRGO only - the enriched context field is never empty and would report
    // the fallback's output as though it were stored (the F27 trap)
    const crgo = Array.isArray(a.estimateMasterCRGO) ? a.estimateMasterCRGO : [];

    const rows = TARGETS.map(([code, kva, tender], idx) => {
      const item = crgo.find(i => String(i?.itemCode ?? '').trim().toLowerCase() === code.toLowerCase());
      const stored = item ? num(item.rates?.[kva]) : null;
      const r = resolve(stored, code, kva);
      const cleared = stored === null;
      // Only the first eight are targets. The 25/63 probe rows are EXPECTED to be stored,
      // and letting them clear this flag would report a clean run as incomplete.
      if (!cleared && idx < 8) allClear = false;
      return {
        cell: `${code} @ ${kva} kVA`,
        stored: item ? (cleared ? 'INHERITING' : stored.toFixed(2)) : '(row absent)',
        resolvesTo: r.value === null ? '(none)' : r.value.toFixed(2),
        via: r.from,
        tender,
        verdict: cleared
          ? (r.value === tender ? 'cleared, resolves to tender' : `cleared but resolves ${r.value} - CHECK`)
          : `STILL STORED - not cleared`,
      };
    });
    console.table(rows);

    const targets = rows.slice(0, 8);
    const probe = rows.slice(8);
    const notCleared = targets.filter(r => r.verdict.startsWith('STILL STORED'));
    console.log(notCleared.length === 0
      ? '  All eight targeted cells cleared on this agency.'
      : `  ${notCleared.length} of 8 NOT cleared: ${notCleared.map(r => r.cell).join(', ')}`);

    // 12A(b) at 25/63 was never a target. What it holds separates "the clear failed" from
    // "the row was seeded stored and 10/16 were never cleared at all".
    const probeStored = probe.filter(r => r.stored !== 'INHERITING' && r.stored !== '(row absent)');
    if (probe.length) {
      console.log(`  12A(b) probe - 25 kVA: ${probe[0].stored}, 63 kVA: ${probe[1].stored}`);
      console.log(probeStored.length === probe.length
        ? '     -> whole row is stored, including capacities nobody edited: SEEDED, not a failed clear.'
        : probeStored.length === 0
          ? '     -> 25/63 inherit while 10/16 are stored: the row WAS edited and two cells did not clear.'
          : '     -> mixed; read the row values above before concluding either way.');
    }

    // ---- the two sections the fan-out also wrote ----
    const listCodes = (arr) => (Array.isArray(arr) ? arr : [])
      .map(i => String(i?.itemCode ?? '?').trim())
      .join(', ') || '(none)';

    const oh = a.estimateMasterOverhauling;
    const cl = a.estimateMasterCircleLimits;
    console.log(`  Overhauling   : ${Array.isArray(oh) ? oh.length : 0} row(s)  [${listCodes(oh)}]`);
    console.log(`  Circle Limits : ${Array.isArray(cl) ? cl.length : 0} row(s)  [${listCodes(cl)}]`);
    if (!Array.isArray(oh) || oh.length === 0) {
      console.log('     Overhauling empty - resolves to the shipped shell. Normal state, not a loss.');
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(allClear
    ? '  Every targeted cell is cleared on every agency owned by this account.'
    : '  At least one cell is still stored - see the per-agency tables above.');
  console.log('  Compare the Overhauling and Circle Limits row lists across agencies: if they are');
  console.log('  identical everywhere, the fan-out homogenised them. Whether a target held');
  console.log('  something different before is not recoverable from the app.');
  console.log('\nDone. Nothing was written.');
})();
