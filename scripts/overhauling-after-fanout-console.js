// DID THE FAN-OUT REPLACE A HAND-MAINTAINED OVERHAULING OR CIRCLE LIMITS SECTION?
//
// READ-ONLY. No set/update/delete/batch anywhere in this file.
//
// Paste into the browser console on a DEV build, signed in. Run once per account.
//
// THE LIMIT OF THIS CHECK, STATED FIRST
// -------------------------------------
// The prior value is GONE. `updateDoc` replaced each section array outright and the app
// keeps no history, so nothing here can say what MEGHA held before. What it CAN establish
// is the shape of the aftermath, and two of the three possible answers are conclusive:
//
//   - all agencies now identical AND equal to the source's section
//         -> they were homogenised by the write. Whether that lost anything is unknowable.
//   - an agency still differs from the source
//         -> it was NOT overwritten; its own section survived.
//   - all identical AND equal to the SHIPPED SHELL
//         -> the source stored nothing, the fallback was resolved on screen and written
//            out as if it were data. This is the case the publish guard was meant to stop
//            and does not, because it exempts CIRCLE_LIMITS and treats an empty
//            Overhauling as normal.
//
// "Equal to the shipped shell" is the strong signal: a section someone maintained by hand
// matching the shell in every cell would be a coincidence.

(async () => {
  const { collection, query, where, getDocs } = window.__fs;
  const db = window.__db, uid = window.__auth.currentUser?.uid;
  const defs = window.__defaults;
  if (!db || !uid) { console.error('Sign in first - window.__db / __auth not ready.'); return; }
  if (!defs) {
    console.error('window.__defaults is missing - update src/lib/firebase.ts, and run on a DEV build.');
    return;
  }

  const KVA = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'];
  const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);

  // A stable fingerprint of a section: codes, names and every rate, order-independent.
  const fingerprint = (list) => {
    if (!Array.isArray(list) || list.length === 0) return '(nothing stored)';
    return list
      .map(it => {
        const code = String(it?.itemCode ?? '').trim().toLowerCase();
        const rates = KVA.map(k => `${k}:${num(it?.rates?.[k])}`).join(',');
        return `${code}|${num(it?.fixedRate)}|${rates}`;
      })
      .sort()
      .join(' || ');
  };

  const SECTIONS = [
    ['OVERHAULING', 'estimateMasterOverhauling', defs.defaultOverhaulingEstimateData],
    ['CIRCLE_LIMITS', 'estimateMasterCircleLimits', defs.defaultCircleLimitsEstimateData],
  ];

  const snap = await getDocs(query(collection(db, 'agencies'), where('ownerId', '==', uid)));
  const agencies = [];
  snap.forEach(d => agencies.push({ id: d.id, ...d.data() }));

  for (const [label, field, shell] of SECTIONS) {
    console.log(`\n=== ${label} ===`);
    const shellPrint = fingerprint(shell);
    const rows = agencies.map(a => {
      const fp = fingerprint(a[field]);
      return {
        agency: a.name || a.id,
        rows: Array.isArray(a[field]) ? a[field].length : 0,
        matchesShippedShell: fp === shellPrint ? 'YES' : 'no',
        _fp: fp,
      };
    });
    const distinct = [...new Set(rows.map(r => r._fp))];
    rows.forEach(r => delete r._fp);
    console.table(rows);

    if (distinct.length === 1) {
      console.log(`  All ${rows.length} agencies hold an IDENTICAL ${label} section.`);
      if (distinct[0] === shellPrint) {
        console.log('  And it is the SHIPPED SHELL exactly.');
        console.log('  That is the fallback-written-as-data case: the source stored nothing,');
        console.log('  the screen resolved the shell, and the fan-out wrote it to every target.');
        console.log('  Any agency that previously held its own rates here has lost them.');
      } else if (distinct[0] === '(nothing stored)') {
        console.log('  And it is empty everywhere - nothing was written, nothing was lost.');
      } else {
        console.log('  It is NOT the shipped shell, so real data was propagated from the source.');
        console.log('  Whether a target had different rates before cannot be recovered.');
      }
    } else {
      console.log(`  ${distinct.length} distinct versions across ${rows.length} agencies -`);
      console.log('  they were NOT all homogenised, so at least some sections survived intact.');
    }
  }

  console.log('\nNothing was written. The prior values are not recoverable from the app.');
})();
