// WHO SET THIS RATE, AND WHEN - provenance for one master cell across every agency
//
// READ-ONLY. No set/update/delete/batch anywhere in this file.
//
// Paste into the browser console with the app open and signed in. Run it ONCE PER ACCOUNT -
// it can only see agencies owned by the signed-in user, so utparekh007's agencies need a
// second run signed in as that account.
//
// WHY
// ---
// A stored rate that differs from Schedule-A is either a slip or a decision, and the cell
// itself cannot tell you which. `estimateMasterEditedAt` / `estimateMasterEditedBy` can:
// an edit made minutes ago by the person now surprised by it reads differently from one
// made months ago by someone else.
//
// It reads the RAW stored section, never the enriched context object - an agency with
// nothing stored must report "inheriting", not the fallback's output (the F27 trap).

const ITEM_CODE = '1b';    // change these two to inspect a different cell
const KVA       = '100';

(async () => {
  const { collection, query, where, getDocs } = window.__fs;
  const db = window.__db, uid = window.__auth.currentUser?.uid;
  const email = window.__auth.currentUser?.email || '(unknown)';
  if (!db || !uid) { console.error('Sign in first - window.__db / __auth not ready.'); return; }

  // DATES GO THROUGH THE APP'S OWN HELPER, not a local reimplementation.
  //
  // The first version of this script hand-rolled `Number(x) || Date.parse(x)`, which
  // handles numbers and ISO strings and NOT a Firestore Timestamp - the shape
  // `estimateMasterEditedAt` actually has, since it is written with serverTimestamp().
  // It printed a confident, wrong date. `formatDDMMYYYY` already knew about Timestamps;
  // it was written earlier in this same audit for exactly this hazard, and reimplementing
  // it badly rather than reusing it is the third pattern note applied to a diagnostic
  // instead of to the app (AUDIT F58).
  //
  // It is now on the dev handles as `window.__utils`, so no script needs its own copy.
  const fdm = window.__utils?.formatDDMMYYYY;
  if (!fdm) {
    console.error('window.__utils.formatDDMMYYYY is missing - update src/lib/firebase.ts.');
    console.error('Refusing to hand-roll a date parser here; that is what produced the wrong date before.');
    return;
  }
  const fmt = (v) => (v === null || v === undefined || v === '') ? '(never recorded)' : fdm(v);

  // The raw shape, printed beside the formatted value so a wrong-looking date can be
  // diagnosed from the table instead of guessed at.
  const describe = (v) => {
    if (v === null || v === undefined) return String(v);
    if (typeof v === 'object') {
      if (typeof v.toDate === 'function') return `Timestamp(seconds=${v.seconds})`;
      return `object ${JSON.stringify(v).slice(0, 50)}`;
    }
    return `${typeof v} ${String(v).slice(0, 30)}`;
  };

  // Schedule-A band for this capacity, so "inherited" can be shown as a figure
  const band = k => k <= 5 ? 'B5' : k <= 16 ? 'B10_16' : k <= 25 ? 'B25'
                  : k <= 75 ? 'B50_63_75' : k <= 100 ? 'B100' : 'B_ABOVE_100';

  // THE SHARED BASELINE, read first - correcting the agencies without correcting this
  // undoes itself: a new agency is seeded from public_config, and "Reload Global Rates"
  // restores it into the editor on demand.
  const { doc, getDoc } = window.__fs;
  const pubSnap = await getDoc(doc(db, 'public_config', 'estimate_master'));
  const pub = pubSnap.exists() ? pubSnap.data() : null;
  const pubSection = Array.isArray(pub?.estimateMasterCRGO) ? pub.estimateMasterCRGO : [];
  const pubItem = pubSection.find(i => String(i?.itemCode ?? '').trim().toLowerCase() === ITEM_CODE.toLowerCase());
  const pubRaw = pubItem?.rates?.[KVA];
  console.log('=== public_config/estimate_master ===');
  console.log(`  CRGO section        : ${pubSection.length ? pubSection.length + ' items' : '(absent)'}`);
  console.log(`  '${ITEM_CODE}' at ${KVA} kVA     : ${pubRaw === null || pubRaw === undefined ? '(null - inherits Schedule-A)' : pubRaw}`);
  console.log(`  last published      : ${fmt(pub?.updatedAt)} by ${pub?.updatedBy || '(not recorded)'}`);
  console.log(`  updatedAt raw shape : ${describe(pub?.updatedAt)}`);
  console.log('');

  const snap = await getDocs(query(collection(db, 'agencies'), where('ownerId', '==', uid)));
  const rows = [];
  snap.forEach(d => rows.push({ id: d.id, ...d.data() }));

  console.log(`\nSigned in as ${email} - ${rows.length} agencies owned`);
  console.log(`Inspecting item '${ITEM_CODE}' at ${KVA} kVA (Schedule-A band ${band(Number(KVA))})\n`);

  const out = [];
  rows.forEach(a => {
    // raw stored section only - NOT the enriched field
    const section = Array.isArray(a.estimateMasterCRGO) ? a.estimateMasterCRGO : [];
    const item = section.find(i => String(i?.itemCode ?? '').trim().toLowerCase() === ITEM_CODE.toLowerCase());
    const raw = item?.rates?.[KVA];
    const stored = (raw !== null && raw !== undefined && raw !== '' && !isNaN(Number(raw)) && Number(raw) > 0)
      ? Number(raw) : null;

    out.push({
      agency: a.name || a.id,
      agencyId: a.id,
      cell: stored === null ? (section.length ? 'INHERITING (nothing stored)' : 'no CRGO section stored') : stored.toFixed(2),
      ratesEditedAt: fmt(a.estimateMasterEditedAt),
      editedAtRaw: describe(a.estimateMasterEditedAt),
      ratesEditedBy: a.estimateMasterEditedBy || '(not recorded)',
      agencyCreated: fmt(a.createdAt),
    });
  });

  console.table(out);

  const withStored = out.filter(r => r.cell !== 'INHERITING (nothing stored)' && r.cell !== 'no CRGO section stored');
  console.log(`\n${withStored.length} of ${out.length} agencies store a value in this cell.`);
  if (withStored.length) {
    const distinct = [...new Set(withStored.map(r => r.cell))];
    console.log(`Distinct stored values: ${distinct.join(', ')}`);
    if (distinct.length > 1) {
      console.log('MORE THAN ONE VALUE STORED - these agencies already disagree with each other,');
      console.log('so whatever is decided has to be applied deliberately, not assumed uniform.');
    }
  }

  console.log('\nCAVEAT, and it is the important one: estimateMasterEditedAt/By are stamped per');
  console.log('AGENCY, not per cell. They say when the master was last saved and by whom - not');
  console.log('that THIS cell was the thing that changed. A recent timestamp is evidence the');
  console.log('value could be recent; an old one is stronger evidence it is not this session\'s.');
  console.log('\nDone. Nothing was written.');
})();
