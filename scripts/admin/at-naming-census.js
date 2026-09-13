// WHAT EVERY AT AND EVERY TEMPLATE IS ACTUALLY CALLED — READ-ONLY.
//
//   node scripts/admin/at-naming-census.js
//
// Three fields are routinely confused, and the difference decides whether inconsistent
// naming is untidiness or a defect:
//
//   atNumber  the REQUIRED identifier on the Add AT form ("e.g. AT-2026-27"). Typed per
//             agency. AUDIT O61 found it is a label on five of the eight 2020 ATs.
//   name      the OPTIONAL "Description" field ("e.g. Annual Tender").
//   orderNo   the A/T letter's own reference, added by G63, entered per agency and never
//             taken from a template - two agencies adopting one template each have their
//             own A/T letter.
//
// This prints all three for every AT, and what the published templates carry, so a
// proposal to auto-fill from a template is argued against the live values rather than
// against a memory of them. Nothing is written.

import { all, banner } from './_db.js';

banner('AT NAMING — atNumber vs name vs orderNo');

const [agencies, ats, templates] = await Promise.all([
  all('agencies'), all('atMasters'), all('published_ats'),
]);

const agName = id => agencies.find(a => a.id === id)?.name || id || '(none)';
const show = v => {
  const s = String(v ?? '').trim();
  return s === '' ? '—' : s;
};

console.log(`${templates.length} published template(s)\n`);
console.table(templates.map(t => ({
  id: String(t.id).slice(0, 8),
  name: show(t.name),
  atNumber: show(t.atNumber),
  scheduleId: show(t.scheduleId),
  atPercentage: t.atPercentage ?? '—',
  version: t.version ?? '—',
  startDate: t.startDate ? new Date(t.startDate).toISOString().slice(0, 10) : '—',
  endDate: t.endDate ? new Date(t.endDate).toISOString().slice(0, 10) : '—',
})));

console.log(`\n${ats.length} AT(s)\n`);
const rows = ats.map(a => ({
  agency: agName(a.agencyId),
  atNumber: show(a.atNumber),
  name: show(a.name),
  orderNo: show(a.orderNo),
  orderDate: show(a.orderDate),
  status: show(a.status),
  ratesSource: show(a.ratesSource),
}));
rows.sort((x, y) => x.agency.localeCompare(y.agency) || x.atNumber.localeCompare(y.atNumber));
console.table(rows);

// ---------------------------------------------------------------- what this means

console.log('=== WHICH ATs ADOPTED A TEMPLATE ===');
for (const t of templates) {
  const adopters = ats.filter(a => String(a.ratesSource || '') === `published:${t.id}`);
  console.log(`\n  Template ${show(t.name)} (atNumber ${show(t.atNumber)}) — ${adopters.length} adopter(s):`);
  for (const a of adopters) {
    console.log(`    ${agName(a.agencyId).padEnd(28)} atNumber=${show(a.atNumber).padEnd(42)} orderNo=${show(a.orderNo)}`);
  }
  const distinct = new Set(adopters.map(a => String(a.atNumber ?? '').trim()));
  if (adopters.length > 1) {
    console.log(`    -> ${distinct.size} DISTINCT atNumber(s) across ${adopters.length} agencies on this one tender.`);
  }
}

console.log('\n=== DUPLICATE / NEAR-DUPLICATE atNumbers ===');
const byNorm = new Map();
for (const a of ats) {
  const norm = String(a.atNumber ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!norm) continue;
  if (!byNorm.has(norm)) byNorm.set(norm, []);
  byNorm.get(norm).push(a);
}
let clusters = 0;
for (const [norm, group] of byNorm) {
  if (group.length < 2) continue;
  clusters++;
  console.log(`  "${norm}" — ${group.length} ATs:`);
  for (const a of group) console.log(`    ${agName(a.agencyId).padEnd(28)} "${show(a.atNumber)}"`);
}
if (clusters === 0) console.log('  None — every atNumber is distinct once punctuation and case are ignored.');

console.log('\n=== HOW MANY ATs COULD A TEMPLATE PREFILL HAVE HELPED ===');
const withTemplate = ats.filter(a => String(a.ratesSource || '').startsWith('published:'));
console.log(`  ${withTemplate.length} of ${ats.length} AT(s) adopted a template at all.`);
console.log(`  ${ats.length - withTemplate.length} were created without one, so a template prefill would never have`);
console.log('     reached them - they are the "Enter rates myself later" path.');

console.log('\n=== orderNo COVERAGE (G63) ===');
const withOrder = ats.filter(a => String(a.orderNo ?? '').trim());
console.log(`  ${withOrder.length} of ${ats.length} AT(s) have an orderNo entered.`);
console.log('  Every estimate under an AT without one refuses to print or send.');

console.log('\nDone. Nothing was written.');
