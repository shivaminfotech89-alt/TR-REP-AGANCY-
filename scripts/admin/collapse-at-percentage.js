// COLLAPSE THE THREE PER-CORE-TYPE PERCENTAGES TO ONE.
//
// A/T 1819 clause 2.0 accepts "7.00% above the estimated rate of UGVCL for CRGO / Amorphous
// core" - ONE figure for every core type, which is what a tender quotes. The three fields
// were built on live data that turned out to be test values typed to exercise the estimate
// and billing paths.
//
// ⚠ NO VALUE IS WRITTEN. Every AT already carries `atPercentage`, and on all ten it already
// EQUALS `atPercentageCRGO`. So this only DELETES the three per-core-type fields; the figure
// that survives is the one already stored. That was checked before the script was written,
// not assumed - if any AT disagrees, this refuses rather than choosing for you.
//
// CRGO's value is the one kept. It is load-bearing on 46 of 61 jobs, and on the two real
// (1819) ATs all three are 7, so the choice costs nothing where it matters.
//
// MODE is 'dry-run'. Set it to 'apply' to write, and set it back before committing.

import { db, all, banner } from './_db.js';

const MODE = 'dry-run';           // 'dry-run' | 'apply'
const DROP = ['atPercentageCRGO', 'atPercentageAmorphous', 'atPercentageWoundCore'];

banner(`COLLAPSE AT PERCENTAGES TO ONE  [${MODE}]`);

const [ats, agencies, jobs] = await Promise.all([all('atMasters'), all('agencies'), all('jobs')]);
const agName = id => (agencies.find(a => a.id === id) || {}).name || '?';

const cls = c => {
  const u = String(c || 'CRGO').toUpperCase();
  if (u.includes('AMORPH')) return 'AMORPHOUS';
  if (u.includes('WOUND') || u === 'WC') return 'WOUND_CORE';
  if (u.includes('OVERHAUL') || u === 'OH') return 'OH';
  return 'CRGO';
};

let refuse = 0;
const planned = [];

for (const at of ats) {
  const keep = Number(at.atPercentageCRGO);
  const single = at.atPercentage;
  const label = `${agName(at.agencyId)}  ${at.atNumber || at.name}`.slice(0, 44);

  // ⚠ THE PRECONDITION, CHECKED PER AT. If `atPercentage` is absent or disagrees with the
  // CRGO figure, deleting the three fields would change what this AT prices at - silently.
  // Refuse and name it rather than pick a winner.
  if (!Number.isFinite(keep)) {
    console.log(`  SKIP   ${label.padEnd(46)} no atPercentageCRGO`);
    continue;
  }
  if (!Number.isFinite(Number(single)) || Number(single) !== keep) {
    refuse++;
    console.log(`  REFUSE ${label.padEnd(46)} atPercentage=${single} but CRGO=${keep} - would change this AT's price`);
    continue;
  }

  const present = DROP.filter(k => at[k] !== undefined);
  if (!present.length) {
    console.log(`  ok     ${label.padEnd(46)} already collapsed`);
    continue;
  }

  // What moves: jobs whose core type had a DIFFERENT figure from CRGO's.
  const moving = jobs.filter(j => j.atId === at.id).filter(j => {
    const k = cls(j.coreType);
    if (k === 'CRGO' || k === 'OH') return false;
    const was = k === 'AMORPHOUS' ? Number(at.atPercentageAmorphous) : Number(at.atPercentageWoundCore);
    return Number.isFinite(was) && was !== keep;
  });

  planned.push({ at, present, moving });
  console.log(`  ${MODE === 'apply' ? 'DROP  ' : 'would '} ${label.padEnd(46)} keeps ${keep}%  drops ${present.length} field(s)`
    + (moving.length ? `  -> ${moving.length} job(s) reprice` : ''));
  for (const j of moving) {
    const k = cls(j.coreType);
    const was = k === 'AMORPHOUS' ? Number(at.atPercentageAmorphous) : Number(at.atPercentageWoundCore);
    console.log(`             ${String(j.jobNo).padEnd(12)} ${String(j.coreType).padEnd(11)} ${String(was).padStart(4)}% -> ${String(keep).padStart(3)}%`);
  }
}

const totalMoving = planned.reduce((n, p) => n + p.moving.length, 0);
console.log(`\n  ${planned.length} AT(s) to change, ${totalMoving} job(s) reprice, ${refuse} refused.`);

if (refuse > 0) {
  console.error('\n  REFUSED AT(s) PRESENT - nothing written. Settle those by hand first.');
  process.exit(1);
}

if (MODE !== 'apply') {
  console.log('\n  DRY RUN - nothing was written.');
} else {
  const { FieldValue } = await import('firebase-admin/firestore');
  for (const { at, present } of planned) {
    const patch = {};
    for (const k of present) patch[k] = FieldValue.delete();
    patch.atPercentageCollapsedAt = Date.now();
    await db.collection('atMasters').doc(at.id).update(patch);
  }
  console.log(`\n  Wrote ${planned.length} AT(s).`);
}
