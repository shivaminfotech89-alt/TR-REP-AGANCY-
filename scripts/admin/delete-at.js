// DELETE AN AT — the guarded path, and the only one there is.
//
//   node scripts/admin/delete-at.js                     <- list every AT and whether it can go
//   node scripts/admin/delete-at.js <atId>              <- DRY RUN for one AT
//   node scripts/admin/delete-at.js <atId> --apply      <- deletes, after MODE is changed
//
// ⚠ MODE MUST BE 'dry-run' IN THE REPOSITORY. Change it to run, change it back before
// committing. Security rules do NOT apply to the Admin SDK - see _db.js.
//
// WHY A SCRIPT AND NOT A BUTTON (AUDIT F76)
// -----------------------------------------
// `firestore.rules` carries `allow delete: if false` on atMasters, and that stays. The
// guard that matters is "no job carries this atId", and a Firestore rule CANNOT express it:
// rules have `get()` and `exists()` on a known document path and no query at all. So a
// delete button would need the rule to permit any owner delete, with the guard living in
// the UI - where the console, the SDK, or a bug in that screen all walk straight past it.
//
// THE ASYMMETRY IS WHAT DECIDES IT. Deleting a typo AT is rare, never urgent, and always
// done by someone who has just noticed the mistake. Deleting a LIVE tender is catastrophic
// and silent: every job under it becomes `at-missing`, prices from whatever AT is selected
// today, and the printed estimate recomputes - so the paper in the file stops matching the
// screen with nothing announcing it (F72). Paying a minute on the harmless case to make the
// dangerous one impossible BY RULE rather than by UI convention is the right trade.
//
// Here the guard is enforced by the same thing that performs the delete, which is the one
// arrangement where it cannot be walked around.

import { all, banner, db } from './_db.js';

const MODE = 'dry-run';   // 'dry-run' | 'apply'
const APPLY = MODE === 'apply' && process.argv.includes('--apply');

const atId = process.argv.find(a => !a.startsWith('--') && !a.endsWith('.js') && !a.includes('node'));

banner('DELETE AN AT — GUARDED');
console.log(`MODE = '${MODE}'${APPLY ? '   ** WRITING **' : '   (dry run - nothing will be deleted)'}\n`);

const [agencies, ats, jobs] = await Promise.all([all('agencies'), all('atMasters'), all('jobs')]);
const agName = id => agencies.find(a => a.id === id)?.name || id || '(no agency)';
const label = t => t.atNumber || t.name || t.id;
const jobsUnder = t => jobs.filter(j => String(j.atId ?? '').trim() === t.id);

// ---------------------------------------------------------------- no id: list everything
if (!atId) {
  console.log('Every AT, and whether it can be deleted:\n');
  console.table(ats.map(t => {
    const under = jobsUnder(t);
    return {
      atId: t.id,
      at: label(t),
      agency: agName(t.agencyId),
      status: t.status || '(blank)',
      jobs: under.length,
      ratesSource: t.ratesSource || '(none)',
      deletable: under.length === 0 ? 'YES' : `NO - ${under.length} job(s)`,
    };
  }));
  console.log('\nPass an atId to see exactly what would be deleted.');
  process.exit(0);
}

// ---------------------------------------------------------------- one AT
const at = ats.find(t => t.id === atId);
if (!at) {
  console.error(`No AT with id ${atId}. Run without arguments to list them.`);
  process.exit(1);
}

const under = jobsUnder(at);

console.log('================ THE DOCUMENT ================\n');
console.log(`  atMasters/${at.id}`);
console.log(`    AT              ${label(at)}`);
console.log(`    agency          ${agName(at.agencyId)}   (agencies/${at.agencyId})`);
console.log(`    status          ${at.status || '(blank)'}`);
console.log(`    period          ${at.startDate ? new Date(at.startDate).toLocaleDateString('en-IN') : '?'} to ${at.endDate ? new Date(at.endDate).toLocaleDateString('en-IN') : '?'}`);
console.log(`    ownerId         ${at.ownerId || '(none)'}`);
console.log(`    ratesSource     ${at.ratesSource || '(none - no rates were ever entered)'}`);
if (at.publishedAtVersion) console.log(`    fromTemplate    v${at.publishedAtVersion}`);

const SECTIONS = ['estimateMasterCRGO','estimateMasterAmorphous','estimateMasterWoundCore','estimateMasterOverhauling','estimateMasterCircleLimits'];
const held = SECTIONS.filter(k => Array.isArray(at[k]) && at[k].length);
console.log(`    rate sections   ${held.length ? held.map(k => `${k.replace('estimateMaster','')} (${at[k].length})`).join(', ') : 'none'}`);

const prefixCount = Object.keys(at.prefixes || {}).length;
console.log(`    prefixes        ${prefixCount ? `${prefixCount} division(s): ${Object.keys(at.prefixes).join(', ')}` : 'none'}`);
console.log(`    counters        ${Object.keys(at.lastJobNumbers || {}).length ? JSON.stringify(at.lastJobNumbers) : 'none'}`);

const allotDivs = Object.keys(at.allotments || {});
console.log(`    allotments      ${allotDivs.length ? `${allotDivs.length} division(s): ${allotDivs.join(', ')}` : 'none'}`);
console.log(`    allotmentHistory ${(at.allotmentHistory || []).length} record(s)`);

// ---------------------------------------------------------------- the guard
console.log('\n================ THE GUARD ================\n');
if (under.length > 0) {
  console.log(`  ⛔ REFUSED. ${under.length} job(s) carry this atId.\n`);
  console.table(under.slice(0, 20).map(j => ({
    jobNo: j.jobNo || j.id, mr: j.mrNo || '-', agency: agName(j.agencyId),
    core: j.coreType || 'CRGO', status: j.status || '(blank)',
    issued: [j.estimateSentDate && 'est', j.billNo && 'bill', j.challanNo && 'challan'].filter(Boolean).join(', ') || '-',
  })));
  if (under.length > 20) console.log(`  … and ${under.length - 20} more`);
  console.log('\n  Deleting this AT would leave every one of them naming a tender that no longer');
  console.log('  exists. They would price from whichever AT is selected at the time, and the');
  console.log('  printed estimate RECOMPUTES - so the paper in the file would stop matching the');
  console.log('  screen, with nothing announcing it (AUDIT F72).');
  console.log('\n  This is not overridable here. If the tender is genuinely finished, set its');
  console.log("  status to 'Closed' in the app - that is what Closed is for.");
  process.exit(1);
}

console.log('  ✓ No job carries this atId, so there is no history to protect.');
console.log('    An AT nobody has booked against is a record of an intention, not of work.');

// ---------------------------------------------------------------- apply
console.log('\n================ WHAT WOULD BE DELETED ================\n');
console.log(`  atMasters/${at.id}   "${label(at)}" [${agName(at.agencyId)}]`);
console.log('\n  ONE DOCUMENT. Nothing else references an AT: jobs would (none do), and');
console.log('  allotments, prefixes and counters all live ON this document rather than');
console.log('  beside it, so they go with it and leave nothing stranded.');

if (!APPLY) {
  console.log("\nDRY RUN - nothing was deleted.");
  console.log("To apply: set MODE = 'apply' in this file AND pass --apply, then set it back.");
  process.exit(0);
}

// Re-read immediately before deleting: the job list above came from a snapshot taken at
// the start of this run, and an intake saved in between would be orphaned silently.
const fresh = await db.collection('jobs').where('atId', '==', at.id).limit(1).get();
if (!fresh.empty) {
  console.error('\n⛔ ABORTED. A job carrying this atId appeared since the check above ran.');
  console.error('   Nothing was deleted. Re-run the dry run to see it.');
  process.exit(1);
}

await db.collection('atMasters').doc(at.id).delete();
console.log(`\nDeleted atMasters/${at.id}. Re-run without arguments to confirm it is gone.`);
