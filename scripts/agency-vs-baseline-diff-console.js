// WHICH AGENCY IS SAFE TO PUBLISH FROM
//
// READ-ONLY. No set/update/delete/batch anywhere in this file.
//
// Paste into the browser console on a DEV build, signed in. Run once per account.
//
// WHY
// ---
// `public_config` cannot be edited directly. The only way to change the shared baseline is
// "Publish as shared default", which writes the ACTIVE AGENCY'S ENTIRE SECTIONS - all five
// of them, every row, every capacity. So correcting one cell in the baseline by publishing
// also pushes every other difference that agency has, silently.
//
// Before publishing to fix one cell, the question is therefore not "is this agency good"
// but "does this agency differ from the baseline ANYWHERE ELSE". This answers that, per
// agency, cell by cell.
//
// The agency with the fewest differences outside the cell being fixed is the safe source.
// An agency with zero other differences is the ideal one: publishing from it changes the
// baseline in exactly the way intended and in no other way.
//
// Reads RAW stored sections on both sides. An agency storing nothing for a section is
// reported as such rather than compared against the fallback it would resolve to.

const SECTIONS = [
  ['CRGO', 'estimateMasterCRGO'],
  ['AMORPHOUS', 'estimateMasterAmorphous'],
  ['WOUND_CORE', 'estimateMasterWoundCore'],
  ['OVERHAULING', 'estimateMasterOverhauling'],
  ['CIRCLE_LIMITS', 'estimateMasterCircleLimits'],
];

(async () => {
  const { collection, query, where, getDocs, doc, getDoc } = window.__fs;
  const db = window.__db, uid = window.__auth.currentUser?.uid;
  if (!db || !uid) { console.error('Sign in first - window.__db / __auth not ready.'); return; }

  const KVA = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'];
  const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
  const show = v => v === null ? '(inherits)' : v.toFixed(2);

  const pubSnap = await getDoc(doc(db, 'public_config', 'estimate_master'));
  if (!pubSnap.exists()) { console.error('public_config/estimate_master does not exist.'); return; }
  const pub = pubSnap.data();

  // ABSOLUTE BASELINE VALUES for the cells being corrected, printed before the diffs.
  //
  // A diff cannot answer "what does the baseline hold" - if an agency and the baseline are
  // BOTH wrong in the same cell they agree, and the cell does not appear in any table. That
  // is exactly the case for a value that propagated from the baseline outward: it is
  // invisible to a comparison and visible only to a direct read.
  const TARGETS = [
    ['1b', '100', 46], ['1d', '100', 286], ['1e', '100', 57],
    ['2a', '100', 34], ['2b', '100', 149], ['20', '100', 172],
    ['12A(b)', '10', 163], ['12A(b)', '16', 163],
  ];
  console.log('=== public_config: the cells being corrected ===');
  const pubCrgo = Array.isArray(pub.estimateMasterCRGO) ? pub.estimateMasterCRGO : [];
  console.table(TARGETS.map(([code, kva, tender]) => {
    const row = pubCrgo.find(i => String(i?.itemCode ?? '').trim().toLowerCase() === code.toLowerCase());
    const v = num(row?.rates?.[kva]);
    return {
      item: code, kva,
      baseline: row ? show(v) : '(row absent)',
      tender,
      verdict: !row ? 'row missing from baseline'
             : v === null ? 'inherits - nothing to fix here'
             : v === tender ? 'already correct'
             : `OVERRIDES TENDER by ${(v - tender).toFixed(2)} - clear it in step 2`,
    };
  }));
  console.log('');

  // keyed by item code so row ORDER never registers as a content difference
  const index = list => {
    const m = new Map();
    (Array.isArray(list) ? list : []).forEach(it => {
      const c = String(it?.itemCode ?? '').trim().toLowerCase();
      if (c) m.set(c, it);
    });
    return m;
  };

  const diffSection = (agencyList, baseList) => {
    const A = index(agencyList), B = index(baseList);
    const out = [];
    new Set([...A.keys(), ...B.keys()]).forEach(code => {
      const a = A.get(code), b = B.get(code);
      if (!a) { out.push({ code, kva: '-', agency: '(row absent)', baseline: 'present' }); return; }
      if (!b) { out.push({ code, kva: '-', agency: 'present', baseline: '(row absent)' }); return; }
      KVA.forEach(kva => {
        const av = num(a.rates?.[kva]), bv = num(b.rates?.[kva]);
        if (av !== bv) out.push({ code, kva, agency: show(av), baseline: show(bv) });
      });
    });
    return out;
  };

  const snap = await getDocs(query(collection(db, 'agencies'), where('ownerId', '==', uid)));
  const agencies = [];
  snap.forEach(d => agencies.push({ id: d.id, ...d.data() }));

  const summary = [];

  for (const a of agencies) {
    const name = a.name || a.id;
    console.log(`\n=== ${name} vs public_config ===`);
    let total = 0;
    for (const [label, field] of SECTIONS) {
      const mine = a[field];
      if (!Array.isArray(mine) || mine.length === 0) {
        console.log(`  ${label.padEnd(14)} (nothing stored - publishing would send the resolved fallback; the publish guard refuses this)`);
        continue;
      }
      const d = diffSection(mine, pub[field]);
      total += d.length;
      if (d.length === 0) {
        console.log(`  ${label.padEnd(14)} identical to baseline`);
      } else {
        console.log(`  ${label.padEnd(14)} ${d.length} differing cell(s):`);
        console.table(d);
      }
    }
    summary.push({ agency: name, differingCells: total });
  }

  console.log('\n=== SAFEST PUBLISH SOURCE ===');
  summary.sort((x, y) => x.differingCells - y.differingCells);
  console.table(summary);
  const best = summary[0];
  if (best && best.differingCells === 0) {
    console.log(`\n  ${best.agency} is identical to the baseline in every section.`);
    console.log('  Clear the target cell there, save, and publish: the baseline then changes in');
    console.log('  exactly that one cell and in no other way.');
  } else if (best) {
    console.log(`\n  No agency matches the baseline exactly. The closest is ${best.agency}`);
    console.log(`  with ${best.differingCells} differing cell(s) - publishing from it also pushes those.`);
    console.log('  Read its table above and decide whether each of those SHOULD become the baseline.');
    console.log('  A difference that is a deliberate agency rate must NOT be published: the baseline');
    console.log('  is what every new agency inherits, and an agency-specific rate does not belong in it.');
  }
  console.log('\nDone. Nothing was written.');
})();
