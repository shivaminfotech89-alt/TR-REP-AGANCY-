// EVERY atId / agencyId / jobId THAT RESOLVES TO NOTHING — READ-ONLY (AUDIT G124).
//
//     node scripts/admin/dangling-references.js
//
// WHY
// ---
// ADMIN's MR 5585 oil receipt carries `atId: NpJKH9fZpMoijypO1GZr`, and no such `atMasters` document exists.
// The old oil join ignored the field, so the receipt landed on both of ADMIN's statements by MR number; the new
// one names it `at-missing` and leaves 2,110 L unplaced, worth Rs 260,386.50 of deduction.
//
// A dangling reference is worse than a missing one: a missing field announces itself at the first lookup, while
// a broken reference looks like a real link and fails only where something tries to resolve it. So this sweeps
// every collection for the same shape rather than fixing the one that was found.
//
// ⚠ IT REPORTS, IT DOES NOT REPAIR. Which document a broken reference SHOULD have pointed at is not recoverable
// from the reference itself, and inventing one is the fabricated-rate pattern this audit exists to prevent.

import { all, banner } from './_db.js';

banner('DANGLING REFERENCES - every collection, every id field');

const N = v => String(v ?? '').trim();
const COLLECTIONS = ['jobs', 'inspections', 'oilTransactions', 'atMasters', 'agencies'];

const loaded = {};
for (const c of COLLECTIONS) {
  try { loaded[c] = await all(c); } catch { loaded[c] = []; }
}
for (const [c, rows] of Object.entries(loaded)) console.log(`  ${c.padEnd(18)} ${rows.length} document(s)`);

const ids = {
  jobs: new Set(loaded.jobs.map(r => N(r.id))),
  atMasters: new Set(loaded.atMasters.map(r => N(r.id))),
  agencies: new Set(loaded.agencies.map(r => N(r.id))),
};

/** field -> which collection it must resolve into */
const FIELDS = {
  atId: 'atMasters',
  agencyId: 'agencies',
  jobId: 'jobs',
  issuedAgainstJobId: 'jobs',
  gpPriorJobId: 'jobs',
  issuedByAgencyId: 'agencies',
  openingOilBalanceFromAtId: 'atMasters',
};

const findings = [];
let checked = 0;
for (const [coll, rows] of Object.entries(loaded)) {
  for (const row of rows) {
    for (const [field, target] of Object.entries(FIELDS)) {
      const v = N(row[field]);
      if (!v) continue;
      // An agency's OWN id is its agencyId on some shapes; skip the self-reference on agencies.
      if (coll === 'agencies' && field === 'agencyId') continue;
      checked += 1;
      if (!ids[target].has(v)) {
        findings.push({
          coll, docId: N(row.id), field, value: v, target,
          label: N(row.jobNo) || N(row.mrNo) || N(row.atNumber) || N(row.name) || '',
          extra: coll === 'oilTransactions' ? `${Number(row.netLiters || 0).toFixed(1)} L, MR ${N(row.mrNo)}, div ${N(row.division)}`
            : coll === 'jobs' ? `MR ${N(row.mrNo)}, ${N(row.division)}, bill ${N(row.billNo) || '-'}, paid ${row.paidAmount ?? '-'}`
            : coll === 'inspections' ? `type ${N(row.type)}`
            : '',
        });
      }
    }
  }
}

console.log(`\nreferences checked : ${checked}`);
console.log(`\n⚠ DANGLING REFERENCES : ${findings.length}`);
if (!findings.length) console.log('   none');
for (const f of findings) {
  console.log(`   ${f.coll}/${f.docId}`);
  console.log(`      ${f.field} = ${f.value}  -> no such document in ${f.target}`);
  console.log(`      ${f.label ? f.label + '   ' : ''}${f.extra}`);
}

// The other half of the same question: a reference that is ABSENT rather than broken.
console.log('\nABSENT references, for comparison - these announce themselves at the first lookup');
const absent = {};
for (const [coll, rows] of Object.entries(loaded)) {
  for (const [field, target] of Object.entries(FIELDS)) {
    if (coll === 'agencies' && field === 'agencyId') continue;
    // only count a field the collection actually uses
    const uses = rows.some(r => r[field] !== undefined);
    if (!uses) continue;
    const missing = rows.filter(r => !N(r[field]));
    if (missing.length) {
      absent[`${coll}.${field}`] = missing.length;
      const names = missing.slice(0, 6).map(r => N(r.jobNo) || N(r.mrNo) || N(r.name) || N(r.id).slice(0, 8));
      console.log(`   ${(coll + '.' + field).padEnd(34)} ${String(missing.length).padStart(4)} of ${String(rows.length).padEnd(4)}  ${names.join(', ')}${missing.length > 6 ? ' …' : ''}`);
    }
  }
}

process.exit(findings.length ? 1 : 0);
