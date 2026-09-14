// CAN JOBS, INSPECTIONS AND OIL BE LOADED PER AGENCY WITHOUT LOSING RECORDS? — READ-ONLY.
//
//     node scripts/admin/agency-scope-coverage.js
//
// Half B loads the ACTIVE AGENCY's jobs, inspections and oil once in the data layer, and the
// screens read from it. That is only safe if every existing record can be found by agencyId.
//
// ⚠ THE RISK THIS MEASURES. O71 recorded that inspections are read today by OWNER - or owner and
// type - and never by agency, while new ones are written with an agencyId
// (ExternalInspection.tsx:580). If older records have no agencyId, an agency-scoped load returns
// FEWER records than the per-screen owner-scoped fetch it replaces, and the screens go quiet
// about work that is still there. That is a data-loss shape produced by a performance fix, which
// is worse than the cost it removes.
//
// Also measures what one sign-in actually reads, because Enterprise bills by BYTES: the
// letterhead images live inside the agency documents and no screen displays them at sign-in.
//
// Nothing is written.

import { all, banner } from './_db.js';

banner('AGENCY SCOPE COVERAGE — can these be loaded per agency?');

const [agencies, jobs, inspections, oil] = await Promise.all([
  all('agencies'), all('jobs'), all('inspections'), all('oilTransactions'),
]);

const has = v => String(v ?? '').trim() !== '';
const agName = id => agencies.find(a => a.id === id)?.name || '(unknown)';

// ---------------------------------------------------------------- the decisive question

const sets = [
  ['jobs', jobs],
  ['inspections', inspections],
  ['oilTransactions', oil],
];

console.log('COVERAGE — a record with no agencyId cannot be found by an agency-scoped load\n');
console.table(sets.map(([name, rows]) => ({
  collection: name,
  total: rows.length,
  withAgencyId: rows.filter(r => has(r.agencyId)).length,
  MISSING_agencyId: rows.filter(r => !has(r.agencyId)).length,
  withOwnerId: rows.filter(r => has(r.ownerId)).length,
  MISSING_ownerId: rows.filter(r => !has(r.ownerId)).length,
})));

let blocking = 0;
for (const [name, rows] of sets) {
  const orphans = rows.filter(r => !has(r.agencyId));
  if (orphans.length === 0) {
    console.log(`  ${name}: every record carries an agencyId — safe to scope.`);
    continue;
  }
  blocking += orphans.length;
  console.log(`\n  ⚠ ${name}: ${orphans.length} record(s) carry NO agencyId and would VANISH from an`);
  console.log('     agency-scoped load. Listing up to 20:');
  for (const r of orphans.slice(0, 20)) {
    const label = r.jobNo || r.mrNo || r.serialNo || r.type || r.date || '(no label)';
    console.log(`       ${r.id}  ${String(label).slice(0, 40).padEnd(40)} ownerId=${r.ownerId || '(none)'}`);
  }
}

// ---------------------------------------------------------------- what one load costs

console.log('\n\nPER-AGENCY VOLUME — what the data layer would load when an agency is selected\n');
const rows = agencies.map(a => ({
  agency: String(a.name || a.id).slice(0, 30),
  jobs: jobs.filter(j => j.agencyId === a.id).length,
  inspections: inspections.filter(i => i.agencyId === a.id).length,
  oil: oil.filter(o => o.agencyId === a.id).length,
}));
rows.sort((x, y) => (y.jobs + y.inspections + y.oil) - (x.jobs + x.inspections + x.oil));
console.table(rows);
const worst = rows[0];
if (worst) {
  console.log(`  Largest agency: ${worst.agency} — ${worst.jobs + worst.inspections + worst.oil} document(s) in one load.`);
}

// ---------------------------------------------------------------- what sign-in reads today

console.log('\n\nWHAT SIGN-IN READS — Enterprise bills by BYTES, and agencies load on every sign-in\n');
const KIB = 1024;
const agRows = agencies.map(a => {
  const whole = Buffer.byteLength(JSON.stringify(a), 'utf8');
  const letterhead = Buffer.byteLength(String(a.letterheadUrl ?? ''), 'utf8');
  return {
    agency: String(a.name || a.id).slice(0, 30),
    docKiB: +(whole / KIB).toFixed(1),
    letterheadKiB: +(letterhead / KIB).toFixed(1),
    letterheadPct: whole > 0 ? `${Math.round((letterhead / whole) * 100)}%` : '—',
  };
});
agRows.sort((x, y) => y.letterheadKiB - x.letterheadKiB);
console.table(agRows);

const totalDoc = agencies.reduce((n, a) => n + Buffer.byteLength(JSON.stringify(a), 'utf8'), 0);
const totalLh = agencies.reduce((n, a) => n + Buffer.byteLength(String(a.letterheadUrl ?? ''), 'utf8'), 0);
console.log(`  Every agency document together: ${(totalDoc / KIB).toFixed(1)} KiB`);
console.log(`  Of which letterhead images:     ${(totalLh / KIB).toFixed(1)} KiB  (${totalDoc ? Math.round((totalLh / totalDoc) * 100) : 0}%)`);
console.log('  ⚠ A sign-in reads only the agencies it OWNS, so the figure a single customer pays is');
console.log('     their own rows above, not this total. The per-owner figure:');
const byOwner = new Map();
for (const a of agencies) {
  const k = a.ownerId || '(none)';
  const b = Buffer.byteLength(JSON.stringify(a), 'utf8');
  const l = Buffer.byteLength(String(a.letterheadUrl ?? ''), 'utf8');
  const cur = byOwner.get(k) ?? { agencies: 0, docBytes: 0, lhBytes: 0 };
  byOwner.set(k, { agencies: cur.agencies + 1, docBytes: cur.docBytes + b, lhBytes: cur.lhBytes + l });
}
console.table([...byOwner].map(([owner, v]) => ({
  owner: owner.slice(0, 12),
  agencies: v.agencies,
  signInKiB: +(v.docBytes / KIB).toFixed(1),
  ofWhichLetterheadKiB: +(v.lhBytes / KIB).toFixed(1),
})));

console.log('\n=== VERDICT ===');
if (blocking === 0) {
  console.log('  Every job, inspection and oil record carries an agencyId.');
  console.log('  An agency-scoped load in the data layer loses nothing.');
} else {
  console.log(`  ⚠ ${blocking} record(s) have no agencyId. An agency-scoped load would hide them.`);
  console.log('  Half B must either backfill agencyId first, or keep those reads owner-scoped.');
}
console.log('\nDone. Nothing was written.');
