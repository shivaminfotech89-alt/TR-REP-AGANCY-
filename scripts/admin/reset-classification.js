// WHAT CAN BE DELETED AND WHAT MUST STAY — a partial-reset classification
//
// READ-ONLY.   node scripts/admin/reset-classification.js
//
// It classifies; it does not act, and it must not be turned into something that does
// without the review below. Security rules do not apply to the Admin SDK - see _db.js.
//
// WHY THE ADMIN PORT
// ------------------
// The browser version could only ever see the signed-in user's own agencies, so a reset
// spanning three owners had to be assembled from three separate runs and reconciled by
// hand - which is how a job on one account can look like debris while its guarantee
// predecessor sits on another and never appears in the same output.
//
// THE QUESTION
// ------------
// One AT is live and generating estimates, so the reset is partial: it and everything under
// it stays, and only debris goes. A half-cleared database is worse than either extreme - a
// deleted job leaves its inspections behind (O33), the only delete path is MR-scoped, and a
// guarantee claim that loses its predecessor silently stops being a guarantee claim.

import { all, banner, fmtDate, toMillis } from './_db.js';

const TEST_MAKE_PATTERNS = [/^WNP$/i, /^SS$/i, /^NJA$/i];
const TEST_JOBNO_PATTERN = /^\d+$/;   // a bare number, no division prefix

banner('PARTIAL RESET — CLASSIFICATION');

const [agencies, ats, jobs, inspections, oilTx] = await Promise.all([
  all('agencies'), all('atMasters'), all('jobs'), all('inspections'), all('oilTransactions'),
]);

const agName = id => agencies.find(a => a.id === id)?.name || id || '(none)';
const atLabel = a => a.atNumber || a.name || a.id;
const owners = [...new Set(agencies.map(a => a.ownerId))];

console.log(`${agencies.length} agencies · ${owners.length} owners · ${ats.length} ATs · ${jobs.length} jobs`);
console.log(`${inspections.length} inspections · ${oilTx.length} oil transactions\n`);

// ---------- 1. the live AT ----------
console.log('================ 1. AT RECORDS ================');
console.table(ats.map(a => ({
  at: atLabel(a),
  status: a.status || '(blank)',
  agency: agName(a.agencyId),
  owner: String(a.ownerId || '').slice(0, 8),
  start: fmtDate(a.startDate).split(',')[0],
  end: fmtDate(a.endDate).split(',')[0],
  jobs: jobs.filter(j => j.atId === a.id).length,
})));

const active = ats.filter(a => String(a.status || '').toLowerCase() === 'active');
console.log(active.length === 1
  ? `  ACTIVE: "${atLabel(active[0])}" on ${agName(active[0].agencyId)}`
  : active.length === 0
    ? '  NO AT IS MARKED ACTIVE — which is live cannot be read from the data. Confirm by hand.'
    : `  ${active.length} ATs marked Active. Only one can be the live one; confirm which.`);

// ---------- 2. dependencies ----------
console.log('\n================ 2. DEPENDENCIES OF EACH ACTIVE AT ================');
for (const a of (active.length ? active : ats)) {
  const ag = agencies.find(x => x.id === a.agencyId);
  console.log(`\n  AT "${atLabel(a)}" -> agency ${agName(a.agencyId)}`);
  if (!ag) { console.log('    AGENCY NOT FOUND — this AT already points at nothing.'); continue; }
  console.log(`    agency doc         ${ag.id}   MUST STAY`);
  console.log(`    prefixes on AT     ${Object.keys(a.prefixes || {}).length} division(s)`);
  console.log(`    prefixes on agency ${Object.keys(ag.prefixes || {}).length} division(s)`);
  console.log(`    allotments         ${Object.keys(a.allotments || {}).length} division(s), ${(a.allotmentHistory || []).length} history record(s)`);
  console.log(`    counters           ${JSON.stringify(a.lastJobNumbers || {})}`);
  console.log(`    CRGO master        ${Array.isArray(ag.estimateMasterCRGO) ? ag.estimateMasterCRGO.length + ' rows' : 'ABSENT'}`);
}
console.log('\n  Allotment CONSUMPTION is counted live by querying jobs, not stored, so deleting');
console.log('  jobs lowers it on its own. Counters are stored and are NOT rewound - numbering');
console.log('  continues past the gap rather than reusing a number. Neither needs action.');

// ---------- 3. jobs under the live ATs ----------
const liveIds = new Set(active.map(a => a.id));
const stageOf = j => {
  if (j.status === 'Scrap' || j.condition === 'Scrap') return 'scrap';
  const s = String(j.status || '').trim();
  return s === '' || s === 'Received' ? 'intake'
       : s === 'External Done' ? 'external done'
       : s === 'Internal Done' ? 'internal done'
       : s.startsWith('Tested') ? 'tested'
       : s === 'Dispatched' ? 'dispatched' : s;
};
const MID = ['intake', 'external done', 'internal done', 'tested'];
const issuedOf = j => [
  j.estimateSentDate && 'est sent', j.billNo && 'billed',
  j.paymentStatus === 'Paid' && 'PAID', j.challanNo && 'challan',
].filter(Boolean).join(', ');

console.log('\n================ 3. JOBS UNDER A LIVE AT — ALL MUST STAY ================');
const under = jobs.filter(j => liveIds.has(j.atId));
console.log(`  ${under.length} job(s)`);
if (under.length) {
  console.table(under.map(j => ({
    agency: agName(j.agencyId), jobNo: j.jobNo || j.id, mr: j.mrNo || '-',
    make: j.make || '', kva: j.capacityKva || '', stage: stageOf(j),
    midCycle: MID.includes(stageOf(j)) ? 'YES' : '', issued: issuedOf(j) || '-',
  })));
  console.log(`  ${under.filter(j => MID.includes(stageOf(j))).length} are MID-CYCLE — work in progress.`);
}

// ---------- 4. candidates ----------
console.log('\n================ 4. DELETION CANDIDATES ================');
const byNo = {};
jobs.forEach(j => { (byNo[`${j.agencyId}|${String(j.jobNo ?? '').trim()}`] ||= []).push(j); });
const dupKeys = new Set(Object.entries(byNo).filter(([k, v]) => k.split('|')[1] && v.length > 1).map(([k]) => k));

const looksLikeDebris = j => {
  if (liveIds.has(j.atId)) return false;
  const make = String(j.make || '').trim();
  return TEST_MAKE_PATTERNS.some(re => re.test(make))
      || TEST_JOBNO_PATTERN.test(String(j.jobNo ?? '').trim())
      || dupKeys.has(`${j.agencyId}|${String(j.jobNo ?? '').trim()}`)
      || !j.atId;
};

// AN ISSUED DOCUMENT DISQUALIFIES A JOB OUTRIGHT, whatever it looks like.
//
// The first version of this classifier did not test for one, and put MSBT-12 - the C3
// refund job, carrying `est sent, billed, PAID, challan` - in the deletion list, because it
// has no atId and therefore matched the debris shape. That is precisely the hazard O33
// records: deleting an MR with a sent and paid bill leaves the bill referenced by nothing,
// and `issuedByAgencyId` lives on the job document.
//
// A test-looking record that has produced a document is not a test record. It is a real
// document with a bad-looking job number.
const hasIssuedDocument = j => Boolean(
  j.estimateSentDate || j.estimateStatus === 'Sent' ||
  j.billNo || j.billSentDate || j.billAmount ||
  j.paymentStatus === 'Paid' || j.paidAmount || j.paymentRefNo ||
  j.challanNo || j.deliveryDate || j.issuedByAgencyId
);

const protectedByDocument = jobs.filter(j => looksLikeDebris(j) && hasIssuedDocument(j));
const candidates = jobs.filter(j => looksLikeDebris(j) && !hasIssuedDocument(j));
if (protectedByDocument.length) {
  console.log(`  ⚠ ${protectedByDocument.length} job(s) match the debris shape but CARRY ISSUED DOCUMENTS.`);
  console.log('  These are NOT candidates. A test-looking record that produced a document is a');
  console.log('  real document with a bad-looking job number, and deleting it leaves that');
  console.log('  document referenced by nothing (O33).');
  console.table(protectedByDocument.map(j => ({
    agency: agName(j.agencyId), jobNo: j.jobNo || j.id, mr: j.mrNo || '-',
    why: [!j.atId && 'no atId', TEST_JOBNO_PATTERN.test(String(j.jobNo ?? '').trim()) && 'bare number',
          TEST_MAKE_PATTERNS.some(re => re.test(String(j.make || '').trim())) && 'test make'].filter(Boolean).join(', '),
    issued: issuedOf(j) || '(field set)',
  })));
  console.log('');
}

console.log(`  ${candidates.length} candidate(s), none referencing a live AT, none carrying a document`);
console.table(candidates.map(j => ({
  owner: String(j.ownerId || '').slice(0, 8),
  agency: agName(j.agencyId), jobNo: j.jobNo || j.id, mr: j.mrNo || '-',
  make: j.make || '', serial: j.serialNo || '', date: fmtDate(j.dateOfIssue).split(',')[0],
  atId: j.atId ? 'set' : '(EMPTY)', stage: stageOf(j), issued: issuedOf(j) || '-',
  insp: inspections.filter(i => i.jobId === j.id).length,
})));

// ---------- 5. what a partial reset would break ----------
console.log('\n================ 5. WHAT A PARTIAL RESET WOULD BREAK ================');
const candIds = new Set(candidates.map(j => j.id));
const candMrs = new Set(candidates.map(j => `${j.agencyId}|${String(j.mrNo ?? '').trim()}`));
const mixed = jobs.filter(j => !candIds.has(j.id) && candMrs.has(`${j.agencyId}|${String(j.mrNo ?? '').trim()}`));

if (mixed.length) {
  console.log(`  MIXED MRs — ${mixed.length} job(s) you are KEEPING share an MR with a candidate.`);
  console.log('  The only delete path is MR-SCOPED (O33): deleting that MR takes these too.');
  console.table(mixed.map(j => ({ keep: j.jobNo || j.id, mr: j.mrNo, agency: agName(j.agencyId), stage: stageOf(j) })));
  console.log('  -> Leave those MRs, or delete the individual job documents directly, which');
  console.log('     the app cannot do.');
} else {
  console.log('  No MR contains both a candidate and a job you are keeping — MR-scoped deletion');
  console.log('  can remove the candidates without touching anything else.');
}

const orphanInsp = candidates.reduce((n, j) => n + inspections.filter(i => i.jobId === j.id).length, 0);
console.log(`\n  ORPHANED INSPECTIONS: ${orphanInsp} record(s) would be stranded. Nothing deletes them (O33).`);

const candMrNos = new Set(candidates.map(j => String(j.mrNo ?? '').trim()).filter(Boolean));
console.log(`  STRANDED OIL TRANSACTIONS: ${oilTx.filter(t => candMrNos.has(String(t.mrNo ?? '').trim())).length} record(s) key on an MR whose jobs would be gone.`);

// CROSS-OWNER guarantee history - the check the browser version could not perform, because
// a predecessor on another account was never in the same result set.
const candSerials = new Map();
candidates.forEach(j => {
  const s = String(j.serialNo ?? '').trim().toUpperCase();
  if (s) candSerials.set(s, j);
});
const gpRisk = jobs.filter(j => !candIds.has(j.id)
  && candSerials.has(String(j.serialNo ?? '').trim().toUpperCase()));
console.log(`\n  GUARANTEE HISTORY: ${gpRisk.length} kept job(s) share a serial with a candidate.`);
gpRisk.forEach(j => {
  const cand = candSerials.get(String(j.serialNo ?? '').trim().toUpperCase());
  const cross = cand.ownerId !== j.ownerId;
  console.log(`    keep ${agName(j.agencyId)}/${j.jobNo} <- predecessor ${agName(cand.agencyId)}/${cand.jobNo}`
    + (cross ? '   ** DIFFERENT OWNER — invisible to any single-account check **' : ''));
});
if (gpRisk.length) {
  console.log('    Deleting the candidate removes the record a GP claim matches against, so a');
  console.log('    guarantee repair silently becomes a chargeable one.');
}

console.log('\nDone. Nothing was written.');
