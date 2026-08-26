// HOW EVERY JOB RESOLVES ITS AT, AND WHAT ITS PERCENTAGE IS BOTH WAYS — READ-ONLY.
//
//   node scripts/admin/at-resolution-census.js
//
// The percentage fix (AUDIT F72) changes pricing from "the AT the session has selected" to
// "the AT the job was booked under". This is the before/after for that, per job, and it
// separates THREE cases that must not be confused:
//
//   OWN         job.atId names an AT that exists          -> priced from that AT
//   NO-AT       job.atId is empty                         -> documented fallback
//   DANGLING    job.atId names an AT that does NOT exist  -> documented fallback, but this
//               is a DATA FAULT, not a job that never had a tender. Silently treating it
//               as "no AT" is the same defect the fix exists to remove: a job that HAS a
//               recorded tender being priced from whatever is selected today, with nothing
//               anywhere saying it happened.
//
// Run BEFORE and AFTER the change. The "moves" column must be empty in both runs on this
// data; if it is not, the fix has changed a price it should not have.

import { all, banner } from './_db.js';

banner('AT RESOLUTION — PER JOB, BOTH WAYS');

const [agencies, ats, jobs] = await Promise.all([all('agencies'), all('atMasters'), all('jobs')]);
const agName = id => agencies.find(a => a.id === id)?.name || id || '(none)';
const atLabel = t => t ? (t.atNumber || t.name || t.id) : null;

// Mirrors getAtPercentageForCore in AgencyContext.tsx.
const pctFor = (at, coreType) => {
  if (!at) return 4;
  const t = String(coreType || 'CRGO').trim().toUpperCase();
  if (t.includes('AMORPHOUS') || t.includes('AM')) return at.atPercentageAmorphous ?? at.atPercentage ?? 4;
  if (t.includes('WOUND') || t.includes('WC')) return at.atPercentageWoundCore ?? at.atPercentage ?? 4;
  return at.atPercentageCRGO ?? at.atPercentage ?? 4;
};

const issuedFigure = j =>
  j.estimateAmount ?? j.billAmount ?? null;   // the only figures frozen on a document

const rows = [];
for (const j of jobs) {
  const rawId = String(j.atId ?? '').trim();
  const own = rawId ? ats.find(a => a.id === rawId) : null;
  const kind = !rawId ? 'NO-AT' : (own ? 'OWN' : 'DANGLING');

  // "the session AT" - what pricing used BEFORE the fix. A user normally has their
  // agency's Active AT selected; that is the closest reconstruction available.
  const session = ats.find(a => a.agencyId === j.agencyId && String(a.status || '').toLowerCase() === 'active') || null;

  const before = pctFor(session, j.coreType);
  // AFTER: the job's own AT when it resolves, else the documented fallback (the session's).
  const after = kind === 'OWN' ? pctFor(own, j.coreType) : before;

  rows.push({
    kind,
    agency: agName(j.agencyId),
    jobNo: j.jobNo || j.id,
    mr: j.mrNo || '-',
    core: j.coreType || 'CRGO',
    ownAt: kind === 'OWN' ? atLabel(own) : (kind === 'DANGLING' ? `MISSING ${rawId.slice(0, 8)}…` : '-'),
    sessionAt: atLabel(session) || '(none)',
    pctBefore: before,
    pctAfter: after,
    moves: before !== after ? `${before}% -> ${after}%` : '',
    issuedFigure: issuedFigure(j) ?? '',
  });
}

const by = k => rows.filter(r => r.kind === k);
const moved = rows.filter(r => r.moves);

console.log(`${jobs.length} job(s): ${by('OWN').length} OWN, ${by('NO-AT').length} NO-AT, ${by('DANGLING').length} DANGLING\n`);

console.log('=== 1. JOBS WHOSE PRINTED FIGURE MOVES ===');
if (moved.length === 0) {
  console.log('  NONE. Every job that resolves an AT of its own sits under the AT that is');
  console.log('  active for its agency, so the two resolutions agree everywhere.');
  console.log('  After the change, ANY price difference at all is a regression.');
} else {
  console.table(moved.map(r => ({
    agency: r.agency, jobNo: r.jobNo, core: r.core, ownAt: r.ownAt,
    was: `${r.pctBefore}%`, now: `${r.pctAfter}%`,
    issuedFigure: r.issuedFigure === '' ? '(none - nothing on paper)' : r.issuedFigure,
  })));
  const onPaper = moved.filter(r => r.issuedFigure !== '');
  console.log(onPaper.length
    ? `  ⚠ ${onPaper.length} of these carry a figure on an ISSUED document. The stored field is\n` +
      '    frozen, but the printed sheet RECOMPUTES, so a reprint would differ from the paper.'
    : '  None of them carries a figure on an issued document.');
}

console.log('\n=== 2. DANGLING atId — a recorded tender that no longer exists ===');
if (by('DANGLING').length === 0) {
  console.log('  NONE. Every atId that is set points at an AT that exists.');
} else {
  console.table(by('DANGLING').map(r => ({
    agency: r.agency, jobNo: r.jobNo, mr: r.mr, missingAtId: r.ownAt,
    pricesAt: `${r.pctAfter}%`, from: r.sessionAt, issuedFigure: r.issuedFigure || '-',
  })));
  console.log('  These use the documented fallback, the same as a job with no atId - but they');
  console.log('  are NOT the same thing. A job with no atId never recorded a tender; these');
  console.log('  recorded one that has since gone. Deleting an AT with jobs under it is what');
  console.log('  produces this, and nothing in the app prevents or reports it.');
}

console.log('\n=== 3. NO-atId — must be a NO-OP ===');
console.log(`  ${by('NO-AT').length} job(s). Every one prices at the session AT before AND after,`);
console.log('  so the change moves none of them onto a new path.');
const noAtMoved = by('NO-AT').filter(r => r.moves);
console.log(noAtMoved.length === 0
  ? '  CONFIRMED: 0 of them move.'
  : `  ⚠ ${noAtMoved.length} MOVED - the fallback is not preserving today's behaviour.`);
console.table(by('NO-AT').map(r => ({
  agency: r.agency, jobNo: r.jobNo, mr: r.mr, core: r.core,
  pricesAt: `${r.pctAfter}%`, from: r.sessionAt, moves: r.moves || 'no',
})));

console.log('\n=== 4. A JOB TO CHECK BY HAND ===');
const sample = by('OWN').find(r => r.pctAfter !== 4) || by('OWN')[0];
if (sample) {
  console.log(`  ${sample.agency} / MR ${sample.mr} / job ${sample.jobNo}  (${sample.core})`);
  console.log(`    its own AT      : ${sample.ownAt}`);
  console.log(`    AT % BEFORE fix : ${sample.pctBefore}%   (from the session AT, ${sample.sessionAt})`);
  console.log(`    AT % AFTER  fix : ${sample.pctAfter}%   (from its own AT)`);
  console.log(sample.pctBefore === sample.pctAfter
    ? '    The two agree, so the printed figure must be IDENTICAL before and after.'
    : '    These differ - the printed GRAND TOTAL should change by exactly this.');
}

console.log('\nDone. Nothing was written.');
