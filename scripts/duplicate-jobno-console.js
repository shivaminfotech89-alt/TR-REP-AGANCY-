// READ-ONLY report on duplicated job numbers.
//
// A job number is supposed to identify one physical transformer. Two exceptions and
// one defect produce duplicates, and they must not be confused:
//
//   LEGITIMATE - a GP (warranty) repair deliberately REUSES the original job number
//   from the first repair (NewJob.tsx skips the counter for repairType 'GP' and sets
//   prevJobNo to the original). Same physical unit, same serial, second visit.
//
//   COLLISION - two different physical transformers ended up with the same number.
//   Distinguished by serial number: same serial => same unit; different serials =>
//   genuinely ambiguous.
//
// Scope deliberately matches the GP lookup's own scope: ownerId only, NO agency or
// AT-master filter, because NewJob loads pastJobs the same way and can therefore
// match a job in another agency entirely.
//
// HOW TO RUN: npm run dev, log in, reload the tab, paste into the DevTools console.
// Reads only - no set/update/delete/batch anywhere.

(async () => {
  const db = window.__db, auth = window.__auth, fs = window.__fs;
  if (!db || !fs) {
    console.error('window.__db / window.__fs missing. Reload the tab against the dev server.');
    return;
  }
  const { collection, query, where, getDocs } = fs;

  const uid = auth?.currentUser?.uid;
  if (!uid) { console.error('Not signed in.'); return; }

  // Same query NewJob.tsx uses to build pastJobs for the GP lookup.
  const jobs = (await getDocs(query(collection(db, 'jobs'), where('ownerId', '==', uid))))
    .docs.map(d => ({ id: d.id, ...d.data() }));

  const [agencies, atMasters] = await Promise.all([
    getDocs(query(collection(db, 'agencies'), where('ownerId', '==', uid))).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))),
    getDocs(query(collection(db, 'atMasters'), where('ownerId', '==', uid))).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))),
  ]);
  const agencyName = id => agencies.find(a => a.id === id)?.name || id || '(none)';
  const atName = id => { const a = atMasters.find(x => x.id === id); return a ? (a.atNumber || a.name || id) : (id || '(none)'); };

  const byNo = {};
  jobs.forEach(j => {
    const key = (j.jobNo || '').trim().toUpperCase();
    if (!key) return;
    (byNo[key] ||= []).push(j);
  });

  const dupGroups = Object.entries(byNo).filter(([, list]) => list.length > 1);

  const hdr = t => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
  hdr(`DUPLICATE JOB NUMBERS - ${dupGroups.length} number(s) used more than once (${jobs.length} jobs scanned, all agencies)`);

  const legit = [], collisions = [];

  dupGroups
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([jobNo, list]) => {
      const sorted = [...list].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
      const serials = new Set(sorted.map(j => (j.serialNo || '').trim().toUpperCase()).filter(Boolean));
      const ogpCount = sorted.filter(j => j.repairType !== 'GP').length;
      const gpCount = sorted.filter(j => j.repairType === 'GP').length;

      // Legitimate GP repeat: one original OGP plus GP repairs of the SAME unit.
      const isGpRepeat = gpCount > 0 && ogpCount <= 1 && serials.size <= 1;

      const rows = sorted.map(j => ({
        jobNo,
        mr: j.mrNo,
        status: j.status,
        createdAt: j.createdAt || '',
        repairType: j.repairType || '',
        isGp: j.isGp === true,
        prevJobNo: j.prevJobNo || '',
        serialNo: j.serialNo || '(blank)',
        make: j.make || '',
        kva: j.capacityKva,
        core: j.coreType || '',
        division: j.division || '',
        agency: agencyName(j.agencyId),
        atMaster: atName(j.atId),
        docId: j.id,
      }));

      const verdict = isGpRepeat
        ? 'LEGITIMATE - GP repeat repair, same unit'
        : serials.size > 1
          ? `COLLISION - ${serials.size} DIFFERENT serial numbers share this job number`
          : `COLLISION - ${ogpCount} separate OGP intakes share this job number`;

      console.log(`\n--- ${jobNo}  (${sorted.length} jobs)  ${verdict} ---`);
      console.table(rows);

      (isGpRepeat ? legit : collisions).push({ jobNo, count: sorted.length, verdict, rows });
    });

  hdr('SUMMARY');
  console.log({
    jobsScanned: jobs.length,
    duplicatedNumbers: dupGroups.length,
    legitimateGpRepeats: legit.length,
    trueCollisions: collisions.length,
  });
  if (collisions.length) {
    console.log('\nTrue collisions (each is an ambiguous reference to a physical transformer):');
    console.table(collisions.map(c => ({ jobNo: c.jobNo, jobs: c.count, verdict: c.verdict })));
  }

  // Which duplicates would actually mislead the GP lookup. NewJob sorts pastJobs by
  // createdAt DESC then uses .find(), so the MOST RECENTLY CREATED duplicate wins -
  // regardless of which physical unit is in front of the operator.
  hdr('GP LOOKUP EXPOSURE - which record .find() would return');
  const exposure = collisions.map(c => {
    const newest = [...c.rows].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
    return {
      jobNo: c.jobNo,
      gpLookupWouldReturn: `${newest.mr} / ${newest.serialNo} / ${newest.make} ${newest.kva}kVA`,
      createdAt: newest.createdAt,
      otherCandidates: c.rows.filter(r => r.docId !== newest.docId)
        .map(r => `${r.mr} / ${r.serialNo}`).join('  |  '),
    };
  });
  if (exposure.length) console.table(exposure); else console.log('(no true collisions - GP lookup unambiguous)');

  window.__dupJobNos = { legit, collisions, exposure };
  console.log('\nFull results: window.__dupJobNos');
})();
