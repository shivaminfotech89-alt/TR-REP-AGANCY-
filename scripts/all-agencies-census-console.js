// READ-ONLY: every agency in the database, across ALL owners, and whether its estimate
// master carries the fault.
//
// The app's own queries are owner-scoped (`where('ownerId','==',uid)`), so no screen can
// show this. firestore.rules:254 lets a SUPER ADMIN list every agency, and :240 every job,
// so a script signed in as admin can count what the app cannot.
//
// YOU MUST BE SIGNED IN AS THE SUPER ADMIN. As anyone else the listing returns only your
// own agencies - which would look like a complete census and would not be one. The script
// says which it got.
//
// It WRITES NOTHING. It reports.
//
// HOW TO RUN: npm run dev, sign in as the super admin, reload the tab, paste in console.

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs, doc, getDoc } = fs;

  const user = auth?.currentUser;
  if (!user) { console.error('Not signed in.'); return; }

  const { checkMasterSection } = await import('/src/lib/estimateMasterHealth.ts');

  const hdr = t => console.log(`\n${'='.repeat(104)}\n${t}\n${'='.repeat(104)}`);
  const codesOf = list => (list || []).map(it => String(it.itemCode ?? '').trim());

  let agencies = [], jobs = [];
  try {
    agencies = (await getDocs(collection(db, 'agencies'))).docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('Could not list all agencies:', e?.message || e);
    console.error('This requires the super-admin account. Signed in as:', user.email);
    return;
  }
  try {
    jobs = (await getDocs(collection(db, 'jobs'))).docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('Could not list all jobs (age proxy unavailable):', e?.message || e);
  }

  const owners = [...new Set(agencies.map(a => a.ownerId || '(none)'))];
  const ownAgencies = agencies.filter(a => a.ownerId === user.uid).length;

  hdr('SCOPE OF THIS CENSUS');
  console.log(`signed in as        : ${user.email}  uid=${user.uid}`);
  console.log(`agencies listed     : ${agencies.length}`);
  console.log(`of which yours      : ${ownAgencies}`);
  console.log(`distinct owners     : ${owners.length}`);
  if (agencies.length === ownAgencies) {
    console.warn('');
    console.warn('*** Every agency listed belongs to you. Either you are the only owner, or the');
    console.warn('*** listing was owner-scoped because this account is not super admin. Check the');
    console.warn('*** distinct-owner count before treating this as a complete census.');
  }

  // public_config carries an updatedAt; agencies do NOT carry a createdAt (AUDIT A4), so
  // "created before the correction" cannot be answered directly. Reported anyway, because
  // the timestamp is the reference point for the job-date proxy below.
  let pub = null;
  try {
    const sn = await getDoc(doc(db, 'public_config', 'estimate_master'));
    pub = sn.exists() ? sn.data() : null;
  } catch (e) { console.warn('public_config unreadable:', e?.message || e); }
  const correctedAt = pub?.updatedAt ? Number(pub.updatedAt) : null;
  console.log(`public_config updatedAt : ${correctedAt ? new Date(correctedAt).toISOString() : '(none)'} by ${pub?.updatedBy || '(none)'}`);

  const jobsByAgency = {};
  jobs.forEach(j => { (jobsByAgency[j.agencyId] ||= []).push(j); });
  const ms = v => { const n = Number(v) || Date.parse(v); return isNaN(n) ? null : n; };

  const rows = agencies.map(a => {
    const secs = {
      CRGO: checkMasterSection('CRGO', a.estimateMasterCRGO),
      AMORPHOUS: checkMasterSection('AMORPHOUS', a.estimateMasterAmorphous),
      WOUND_CORE: checkMasterSection('WOUND_CORE', a.estimateMasterWoundCore),
    };
    const faults = Object.entries(secs).filter(([, h]) => h.problems.length > 0).map(([k]) => k);
    const js = jobsByAgency[a.id] || [];
    const dates = js.map(j => ms(j.createdAt)).filter(Boolean);
    const earliest = dates.length ? Math.min(...dates) : null;

    return {
      owner: a.ownerId || '(none)',
      isYours: a.ownerId === user.uid,
      name: a.name || '(unnamed)',
      docId: a.id,
      crgo: secs.CRGO.problems.length === 0 ? 'ok' : (secs.CRGO.isEmpty ? 'EMPTY' : 'FAULT'),
      crgo_22: codesOf(a.estimateMasterCRGO).includes('22'),
      amorph: secs.AMORPHOUS.problems.length === 0 ? 'ok' : (secs.AMORPHOUS.isEmpty ? 'EMPTY' : 'FAULT'),
      amorph_0: codesOf(a.estimateMasterAmorphous).includes('0'),
      wound: secs.WOUND_CORE.blocking ? 'CRGO CARD' : (secs.WOUND_CORE.problems.length === 0 ? 'ok' : (secs.WOUND_CORE.isEmpty ? 'EMPTY' : 'FAULT')),
      wound_0: codesOf(a.estimateMasterWoundCore).includes('0'),
      placeholderAmorph: codesOf(a.estimateMasterAmorphous).includes('1d'),
      faultySections: faults.length,
      jobs: js.length,
      issuedDocs: js.filter(j => j.estimateSentDate || j.billNo || j.billSentDate || j.challanNo).length,
      firstJob: earliest ? new Date(earliest).toISOString().split('T')[0] : '-',
      predatesCorrection: (earliest && correctedAt) ? (earliest < correctedAt) : null,
    };
  });

  hdr(`ALL AGENCIES - ${agencies.length} across ${owners.length} owner(s)`);
  console.table(rows);

  const faulty = rows.filter(r => r.faultySections > 0);
  const faultyOthers = faulty.filter(r => !r.isYours);
  const faultyOwners = [...new Set(faulty.map(r => r.owner))];
  const faultyInUse = faulty.filter(r => r.jobs > 0);
  const faultyWithDocs = faulty.filter(r => r.issuedDocs > 0);

  hdr('THE NUMBERS THAT DECIDE THE APPROACH');
  console.log(`agencies total                          : ${agencies.length}`);
  console.log(`distinct owners                         : ${owners.length}`);
  console.log(`agencies with a faulty master section   : ${faulty.length}`);
  console.log(`  of those, NOT owned by you            : ${faultyOthers.length}`);
  console.log(`  spread across owners                  : ${faultyOwners.length}`);
  console.log(`  with at least one job                 : ${faultyInUse.length}`);
  console.log(`  with at least one issued document     : ${faultyWithDocs.length}   <- these are consequential`);
  console.log(`agencies already correct                : ${rows.length - faulty.length}`);

  hdr('ON "CREATED BEFORE THE CORRECTION" - IT CANNOT BE ANSWERED DIRECTLY');
  console.log('`addAgency` writes no createdAt, and neither does anything else - agencies carry');
  console.log('no creation timestamp at all (AUDIT A4). Firestore auto-ids are not chronological');
  console.log('in any documented way, so they cannot substitute.');
  console.log('');
  console.log('`predatesCorrection` above is a PROXY: the earliest job createdAt under that');
  console.log('agency, compared with public_config.updatedAt. It is a lower bound on the');
  console.log("agency age, and says nothing about agencies with no jobs (shown as null).");
  console.log('');
  console.log('But the proxy is not the question that matters. Whether an agency was created');
  console.log('before the correction only PREDICTS whether it carries the fault; the `crgo`,');
  console.log('`amorph` and `wound` columns MEASURE it. An agency created before but repaired');
  console.log('by hand reads ok; one created after from a stale cached default reads faulty.');
  console.log('Work from the measurement, not from the date.');

  window.__agencyCensus = { rows, faulty, faultyOthers, faultyOwners, owners, correctedAt };
  console.log('\nFull results: window.__agencyCensus');
})();
