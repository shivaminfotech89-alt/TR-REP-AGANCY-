// READ-ONLY: which agencies still carry the seeded UGVCL identity? (AUDIT O7)
//
// AgencySettings seeded every new agency with one DISCOM's registration details. Because
// they were WRITTEN to the agency document they are truthy, so nothing marks them as
// unchosen - they are indistinguishable from values an agency deliberately entered.
//
// This reports which agencies hold values exactly equal to the seed, so they can be
// asked to confirm. It does NOT decide whether they are wrong, and it changes nothing.
//
// HOW TO RUN: npm run dev, log in, reload the tab, paste into the DevTools console.

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) { console.error('window.__db / window.__fs missing. Reload the tab.'); return; }
  const { collection, query, where, getDocs } = fs;

  const uid = auth?.currentUser?.uid;
  if (!uid) { console.error('Not signed in.'); return; }

  // The exact values AgencySettings wrote into every new agency.
  const SEED = {
    discomName: 'Uttar Gujarat Vij Company Ltd.',
    discomGstin: '24AAACU6551F1ZI',
    discomPan: 'AAACU6551F',
    discomAddress: 'Registered Office: Sardar Patel Vidyut Bhavan, Race Course, Vadodara - 390007',
    circleOfficeName: 'SABARMATI',
    serviceSacCode: '998719',
  };

  const agencies = (await getDocs(query(collection(db, 'agencies'), where('ownerId', '==', uid))))
    .docs.map(d => ({ id: d.id, ...d.data() }));

  const hdr = t => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
  hdr(`AGENCY IDENTITY vs SEEDED VALUES - ${agencies.length} agency(ies)`);

  const rows = agencies.map(a => {
    const stillSeeded = Object.keys(SEED).filter(k => (a[k] ?? '') === SEED[k]);
    const changed = Object.keys(SEED).filter(k => (a[k] ?? '') !== SEED[k] && (a[k] ?? '') !== '');
    const empty = Object.keys(SEED).filter(k => (a[k] ?? '') === '');

    // The SABARMATI / '21 IS' division seed, separate from the DISCOM block.
    const prefixes = a.prefixes || {};
    const divisionNames = Object.keys(prefixes);
    const seededDivisionOnly = divisionNames.length === 1 && divisionNames[0] === 'SABARMATI';
    const sabPrefix = prefixes.SABARMATI;
    const seededPrefix = sabPrefix === '21 IS'
      || (sabPrefix && typeof sabPrefix === 'object' && sabPrefix.CRGO === '21 IS');

    return {
      agency: a.name || a.id,
      agencyCode: a.agencyCode || '',
      discomName: a.discomName ?? '(empty)',
      discomGstin: a.discomGstin ?? '(empty)',
      discomPan: a.discomPan ?? '(empty)',
      circleOfficeName: a.circleOfficeName ?? '(empty)',
      seededFieldCount: stillSeeded.length,
      stillSeeded: stillSeeded.join(', ') || '(none)',
      changedByUser: changed.join(', ') || '(none)',
      emptyFields: empty.join(', ') || '(none)',
      onlySabarmatiDivision: seededDivisionOnly,
      sabarmatiPrefixIs21IS: Boolean(seededPrefix),
      // The question a human has to answer for each.
      VERDICT: stillSeeded.length === 0
        ? 'clean - nothing matches the seed'
        : changed.length > 0
          ? 'MIXED - some fields edited, some still seeded. Ask which are intended.'
          : 'ALL SEEDED - never edited. Ask whether this agency is UGVCL.',
    };
  });

  console.table(rows);

  const affected = rows.filter(r => r.seededFieldCount > 0);
  console.log('');
  console.log(`${affected.length} of ${agencies.length} agency(ies) hold at least one seeded value.`);
  if (affected.length) {
    console.log('');
    console.log('These CANNOT be resolved from the data: a UGVCL agency that never needed to');
    console.log('change the value looks identical to a non-UGVCL agency that never noticed it.');
    console.log('Flag each for its agency to confirm. Do not clear automatically.');
    affected.forEach(r => console.log(`  ${r.agency}: ${r.VERDICT}`));
  }
  if (agencies.length === 1) {
    console.log('');
    console.log('Single agency - this is a conversation, not a migration.');
  }

  window.__agencyIdentity = { agencies, rows, affected, SEED };
  console.log('\nFull results: window.__agencyIdentity');
})();
