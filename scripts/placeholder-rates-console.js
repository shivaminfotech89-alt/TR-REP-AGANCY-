// READ-ONLY: do the placeholder Amorphous sections carry any USABLE rate?
//
// resolveRate (SingleJobEstimateReport) accepts a master rate only when it is > 0, and
// otherwise falls through to UGVCL Schedule-A. So the question is not "are there numbers"
// but "is any number greater than zero".
//
//   all null / all zero -> nothing was ever priced from these labels. Cleanup only.
//   any value > 0       -> that rate priced an Amorphous job under a placeholder label
//                          meaning a DIFFERENT capacity. Mispricing exposure.
//
// Output is plain console.log, one line per item. Deliberately NOT console.table: with a
// fixedRate column plus ten capacities DevTools truncates the columns, which is how this
// question came back unanswered the first time.
//
// Sections are selected by FINGERPRINT, not by agency name: a bare item code "1d" exists
// only in the 10-item placeholder (the real Schedule-B default uses 1d-1 and 1d-2). So
// this finds them regardless of which agencies turn out to be affected.
//
// It WRITES NOTHING. It reports.
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
  const agencies = await snap('agencies', where('ownerId', '==', uid));

  const KVA = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'];
  const hdr = t => console.log(`\n${'='.repeat(96)}\n${t}\n${'='.repeat(96)}`);

  // null and 0 are both unusable, but they are not the same fact: null is "never set",
  // 0 is "set to zero". Printed differently so the distinction survives.
  const show = v => {
    if (v === undefined) return '   --';   // field absent
    if (v === null) return ' null';
    const n = Number(v);
    if (isNaN(n)) return '  NaN';
    if (n === 0) return '    0';
    return String(n).padStart(5);
  };
  const usable = v => v !== null && v !== undefined && !isNaN(Number(v)) && Number(v) > 0;

  const isPlaceholder = list =>
    (list || []).some(it => String(it.itemCode ?? '').trim() === '1d');

  const targets = agencies
    .map(a => ({ name: a.name || a.id, items: a.estimateMasterAmorphous || [] }))
    .filter(s => isPlaceholder(s.items));

  if (targets.length === 0) {
    console.log('No section carries the placeholder fingerprint (a bare item code "1d").');
    console.log('Either they have already been repaired, or the sections are stored elsewhere.');
    return;
  }

  let grandTotalUsable = 0;
  const offenders = [];

  targets.forEach(src => {
    hdr(`AMORPHOUS (placeholder) - ${src.name}   ${src.items.length} item(s)`);
    console.log(
      'code'.padEnd(7) + 'fixedRate'.padStart(10) + '  ' +
      KVA.map(k => k.padStart(5)).join(' ') + '   usable  description'
    );
    console.log('-'.repeat(96));

    src.items.forEach(it => {
      const code = String(it.itemCode ?? '').trim();
      const live = KVA.filter(k => usable(it.rates?.[k]));
      const fixedLive = usable(it.fixedRate);
      if (live.length || fixedLive) {
        grandTotalUsable += live.length + (fixedLive ? 1 : 0);
        offenders.push({
          agency: src.name,
          itemCode: code,
          description: String(it.itemName ?? '').slice(0, 44),
          fixedRate: fixedLive ? it.fixedRate : '',
          liveCapacities: live.map(k => `${k}=${it.rates[k]}`).join(', '),
        });
      }
      console.log(
        code.padEnd(7) +
        show(it.fixedRate).padStart(10) + '  ' +
        KVA.map(k => show(it.rates?.[k])).join(' ') +
        '   ' + String(live.length + (fixedLive ? 1 : 0)).padStart(5) + '  ' +
        String(it.itemName ?? '').slice(0, 40)
      );
    });
  });

  hdr('VERDICT');
  console.log(`Sections examined            : ${targets.length}  (${targets.map(t => t.name).join(', ')})`);
  console.log(`Values greater than zero     : ${grandTotalUsable}`);
  console.log('');
  if (grandTotalUsable === 0) {
    console.log('NOTHING WAS EVER MISPRICED FROM THESE SECTIONS.');
    console.log('');
    console.log('Every rate is null or zero, and resolveRate accepts a master rate only when');
    console.log('it is > 0. So every Amorphous line on every estimate and bill was drawn from');
    console.log('UGVCL Schedule-A, regardless of what these placeholder labels say.');
    console.log('');
    console.log('The placeholder text is therefore a DISPLAY and CLEANUP problem, not a money');
    console.log('problem: it would have become a money problem the moment anyone typed a rate');
    console.log('into a row whose label names the wrong capacity.');
  } else {
    console.log('*** MISPRICING EXPOSURE - these rates were live under placeholder labels ***');
    console.log('');
    console.table(offenders);
    console.log('');
    console.log('Each of these was preferred over Schedule-A by resolveRate. The placeholder');
    console.log('numbering assigns different capacities to the same item codes than');
    console.log('Schedule-B does (placeholder 1a = 25 KVA; Schedule-B 1a = 10 KVA), so a rate');
    console.log('entered against one meaning was applied under the other.');
    console.log('');
    console.log('Trace which jobs are affected before repairing the section - once the section');
    console.log('is replaced, the evidence of what was charged goes with it. The printed');
    console.log('estimate or bill is the authority for what the customer was actually told.');
  }

  window.__placeholderRates = { targets, offenders, grandTotalUsable };
  console.log('\nFull results: window.__placeholderRates');
})();
