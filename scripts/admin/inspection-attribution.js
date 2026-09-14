// CAN THE 59 INSPECTIONS WITH NO agencyId BE ATTRIBUTED TO ONE? — READ-ONLY.
//
//     node scripts/admin/inspection-attribution.js
//
// agency-scope-coverage.js found 59 of 144 inspections carry no agencyId, so an agency-scoped
// load in the data layer would hide 41% of them. That leaves three ways forward, and which one
// is available is a question about the data rather than a preference:
//
//   BACKFILL      every orphan resolves to exactly one job, so its agency is knowable.
//   OWNER-SCOPED  some cannot be resolved, so inspections stay owner-scoped in the data layer
//                 and are filtered in memory - no record disappears, less is saved.
//   SPLIT         jobs and oil are scoped now (both 100% covered); inspections wait.
//
// This reports which. It resolves an orphan by trying, in order: an explicit job reference, then
// jobNo within the same owner, then serialNo within the same owner. An orphan that resolves to
// TWO agencies is counted as ambiguous, not attributed - guessing which is the F1 shape.
//
// Nothing is written.

import { all, banner } from './_db.js';

banner('INSPECTION ATTRIBUTION — can the orphans be placed?');

const [agencies, jobs, inspections] = await Promise.all([
  all('agencies'), all('jobs'), all('inspections'),
]);

const has = v => String(v ?? '').trim() !== '';
const norm = v => String(v ?? '').trim().toUpperCase();
const agName = id => agencies.find(a => a.id === id)?.name || `(unknown ${String(id).slice(0, 6)})`;

const orphans = inspections.filter(i => !has(i.agencyId));
console.log(`${inspections.length} inspection(s), ${orphans.length} with no agencyId\n`);

// ---------------------------------------------------------------- what shape are they?

const fieldCounts = new Map();
for (const i of orphans) {
  for (const k of Object.keys(i)) fieldCounts.set(k, (fieldCounts.get(k) ?? 0) + 1);
}
console.log('FIELDS PRESENT ON THE ORPHANS (field: how many of them have it)');
const fields = [...fieldCounts].sort((a, b) => b[1] - a[1]);
for (const [k, n] of fields) console.log(`  ${k.padEnd(28)} ${n}/${orphans.length}`);

// ---------------------------------------------------------------- try to place each one

const agenciesOf = list => [...new Set(list.map(j => j.agencyId).filter(has))];

function resolve(insp) {
  const sameOwner = jobs.filter(j => j.ownerId === insp.ownerId);

  // 1. An explicit job reference, whatever it is called on this record.
  for (const key of ['jobId', 'jobDocId', 'jobRef']) {
    if (has(insp[key])) {
      const j = jobs.find(x => x.id === insp[key]);
      if (j && has(j.agencyId)) return { route: key, agencies: [j.agencyId] };
    }
  }
  // 2. Job number within the same owner.
  if (has(insp.jobNo)) {
    const hits = sameOwner.filter(j => norm(j.jobNo) === norm(insp.jobNo));
    const ags = agenciesOf(hits);
    if (ags.length > 0) return { route: 'jobNo+owner', agencies: ags };
  }
  // 3. Serial number within the same owner.
  if (has(insp.serialNo)) {
    const hits = sameOwner.filter(j => norm(j.serialNo) === norm(insp.serialNo));
    const ags = agenciesOf(hits);
    if (ags.length > 0) return { route: 'serialNo+owner', agencies: ags };
  }
  // 4. MR number within the same owner - weakest, an MR spans jobs.
  if (has(insp.mrNo)) {
    const hits = sameOwner.filter(j => norm(j.mrNo) === norm(insp.mrNo));
    const ags = agenciesOf(hits);
    if (ags.length > 0) return { route: 'mrNo+owner', agencies: ags };
  }
  return { route: null, agencies: [] };
}

const byRoute = new Map();
const unresolved = [];
const ambiguous = [];
const resolved = [];

for (const insp of orphans) {
  const r = resolve(insp);
  if (r.agencies.length === 1) {
    resolved.push({ insp, agencyId: r.agencies[0], route: r.route });
    byRoute.set(r.route, (byRoute.get(r.route) ?? 0) + 1);
  } else if (r.agencies.length > 1) {
    ambiguous.push({ insp, agencies: r.agencies, route: r.route });
  } else {
    unresolved.push(insp);
  }
}

console.log('\n\nRESOLUTION');
console.log(`  attributed to exactly one agency : ${resolved.length}`);
console.log(`  ambiguous (more than one)        : ${ambiguous.length}`);
console.log(`  not resolvable at all            : ${unresolved.length}`);
if (byRoute.size > 0) {
  console.log('\n  by route:');
  for (const [route, n] of byRoute) console.log(`    ${String(route).padEnd(18)} ${n}`);
}

if (resolved.length > 0) {
  const spread = new Map();
  for (const r of resolved) spread.set(r.agencyId, (spread.get(r.agencyId) ?? 0) + 1);
  console.log('\n  where the attributable ones would land:');
  for (const [ag, n] of spread) console.log(`    ${agName(ag).padEnd(32)} ${n}`);
}

if (ambiguous.length > 0) {
  console.log('\n  ⚠ AMBIGUOUS - these match jobs in more than one agency, so a backfill would be a guess:');
  for (const a of ambiguous.slice(0, 15)) {
    console.log(`    ${a.insp.id}  via ${a.route}  ->  ${a.agencies.map(agName).join(' | ')}`);
  }
}

if (unresolved.length > 0) {
  console.log('\n  ⚠ NOT RESOLVABLE - nothing on these points at a job:');
  for (const u of unresolved.slice(0, 20)) {
    const label = [u.type, u.jobNo, u.serialNo, u.mrNo].filter(has).join(' / ') || '(no identifying field)';
    console.log(`    ${u.id}  ${label.slice(0, 52).padEnd(52)} owner=${String(u.ownerId).slice(0, 10)}`);
  }
}

console.log('\n=== VERDICT ===');
if (orphans.length === 0) {
  console.log('  Nothing to place.');
} else if (unresolved.length === 0 && ambiguous.length === 0) {
  console.log(`  All ${orphans.length} orphans resolve to exactly one agency. A BACKFILL is possible,`);
  console.log('  and after it inspections can be loaded agency-scoped like jobs and oil.');
} else {
  console.log(`  ${unresolved.length + ambiguous.length} of ${orphans.length} orphan(s) cannot be placed without guessing.`);
  console.log('  ⚠ So inspections must NOT be loaded agency-scoped yet. Either keep them owner-scoped');
  console.log('     in the data layer and filter in memory, or ship jobs and oil first and hold');
  console.log('     inspections until these are resolved by someone who knows the paperwork.');
}
console.log('\nDone. Nothing was written.');
