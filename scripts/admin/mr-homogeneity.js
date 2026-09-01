/**
 * IS ANY MR MIXED? (AUDIT G11)
 *
 * READ-ONLY. Nothing here writes.
 *
 * `MrLedger` groups jobs by MR and takes `repairType` and `division` from WHICHEVER JOB IS
 * ENCOUNTERED FIRST, then prints that one value as the MR's. If an MR holds more than one
 * value the chip is not merely imprecise - GP means repaired under guarantee AT NO COST, so an
 * MR showing GP while three of its four jobs are OGP is materially wrong.
 *
 * This says whether that is happening in live data, and whether a mix looks legitimate or like
 * a data fault. It does not change anything: a GP job sitting on an OGP MR is a question for
 * someone with the paperwork.
 */
import { all, banner } from './_db.js';

banner('MR HOMOGENEITY — repairType, division, coreType per MR');

const [agencies, jobs] = await Promise.all(['agencies', 'jobs'].map(all));
const agName = id => agencies.find(a => a.id === id)?.name || id;

// Grouped exactly as MrLedger groups: by mrNo, within one agency's fetch.
const byAgencyMr = {};
for (const j of jobs) {
  const key = `${j.agencyId}||${j.mrNo || 'UNKNOWN-MR'}`;
  (byAgencyMr[key] ??= []).push(j);
}

const norm = v => String(v ?? '').trim().toUpperCase();
let mixedRepair = 0, mixedDiv = 0, mixedCore = 0, total = 0;

for (const [key, group] of Object.entries(byAgencyMr)) {
  total++;
  const [agencyId, mrNo] = key.split('||');
  const repair = [...new Set(group.map(j => norm(j.repairType) || 'OGP'))];
  const divs   = [...new Set(group.map(j => norm(j.division)   || '(none)'))];
  const cores  = [...new Set(group.map(j => norm(j.coreType)   || '(none)'))];

  const bad = repair.length > 1 || divs.length > 1 || cores.length > 1;
  if (repair.length > 1) mixedRepair++;
  if (divs.length > 1) mixedDiv++;
  if (cores.length > 1) mixedCore++;
  if (!bad) continue;

  console.log(`\n  MR ${String(mrNo).padEnd(9)} ${agName(agencyId)}   ${group.length} job(s)`);
  const count = (vals, pick) => vals.map(v =>
    `${v} ${group.filter(j => (norm(pick(j)) || (v === 'OGP' ? 'OGP' : '(none)')) === v).length}`).join(' · ');
  if (repair.length > 1) console.log(`     ⚠ repairType MIXED : ${count(repair, j => j.repairType)}   <- MrLedger shows only "${norm(group[0].repairType) || 'OGP'}"`);
  if (divs.length > 1)   console.log(`     ⚠ division   MIXED : ${count(divs, j => j.division)}   <- MrLedger shows only "${norm(group[0].division)}"`);
  if (cores.length > 1)  console.log(`       coreType   mixed : ${count(cores, j => j.coreType)}`);
  group.forEach(j => console.log(`        ${String(j.jobNo || j.id).padEnd(10)} ${String(norm(j.repairType) || 'OGP').padEnd(4)} ${String(norm(j.division)).padEnd(10)} ${norm(j.coreType) || '(no core)'}`));
}

console.log(`\n${'='.repeat(70)}`);
console.log(`  MRs examined            : ${total}`);
console.log(`  mixed repairType (GP/OGP): ${mixedRepair}${mixedRepair ? '   <- the chip is WRONG on these' : ''}`);
console.log(`  mixed division           : ${mixedDiv}${mixedDiv ? '   <- the chip is WRONG on these' : ''}`);
console.log(`  mixed coreType           : ${mixedCore}${mixedCore ? '   (legitimate: one MR can hold both)' : ''}`);
