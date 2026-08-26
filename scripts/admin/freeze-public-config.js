// STAMP public_config AS FROZEN — the one write, and it is additive.
//
//   node scripts/admin/freeze-public-config.js            <- DRY RUN
//   node scripts/admin/freeze-public-config.js --apply    <- writes, after MODE is changed
//
// ⚠ MODE MUST BE 'dry-run' IN THE REPOSITORY.
//
// WHY
// ---
// public_config/estimate_master had THREE writers and now has none (AUDIT F73). Publishing
// is one action, "Publish this AT as a template", which writes published_ats. public_config
// stays as the resolution fallback for agencies with no AT rates.
//
// Only ONE agency can still reach it - IDEAL ENGINEERING COMPANY, which has no sections and
// no ATs. Everything else answers from its AT or its own sections first.
//
// So the risk is not drift. The drift already happened and is already unreachable: this
// document holds two 100-KVA rates that NO agency has - "1f" Drying of active parts at 230
// and "11B" LV Connector at 148.99, where every agency but SUCHIT has null. The risk is that
// a document labelled "the shared baseline", which nothing reads and nothing updates, is
// mistaken in a year for a source of truth.
//
// This adds three fields and changes no rate. It does not delete, reorder or normalise
// anything - a rate in here is still what it was, and still what IDEAL resolves.

import { banner, db } from './_db.js';

const MODE = 'dry-run';   // 'dry-run' | 'apply'
const APPLY = MODE === 'apply' && process.argv.includes('--apply');

banner('FREEZE public_config/estimate_master');
console.log(`MODE = '${MODE}'${APPLY ? '   ** WRITING **' : '   (dry run - nothing will be written)'}\n`);

const ref = db.collection('public_config').doc('estimate_master');
const snap = await ref.get();
if (!snap.exists) { console.log('public_config/estimate_master does not exist. Nothing to do.'); process.exit(0); }

const data = snap.data();
const SECTIONS = ['estimateMasterCRGO','estimateMasterAmorphous','estimateMasterWoundCore','estimateMasterOverhauling','estimateMasterCircleLimits','estimateMaster'];
const n = v => Array.isArray(v) ? v.length : 0;

console.log('CURRENT CONTENT (unchanged by this script):');
SECTIONS.forEach(k => console.log(`  ${k.padEnd(30)} ${n(data[k])} item(s)`));
console.log(`  ${'frozenAt'.padEnd(30)} ${data.frozenAt ? new Date(data.frozenAt).toLocaleString('en-IN') : '(not set)'}`);

if (data.frozenAt) {
  console.log('\nAlready stamped. Nothing to do - this never re-stamps.');
  process.exit(0);
}

const payload = {
  frozenAt: Date.now(),
  frozenReason:
    'Superseded by published_ats (AUDIT F73). Publishing is now "Publish this AT as a template". '
  + 'This document is READ-ONLY in practice: it remains the resolution fallback for an agency with no AT rates '
  + 'and no sections of its own, and nothing in the app writes to it. '
  + 'It is NOT current - it holds two 100-KVA rates no agency has (1f Drying of active parts 230, 11B LV Connector 148.99).',
  frozenBy: 'scripts/admin/freeze-public-config.js',
};

console.log('\nWHAT WOULD BE WRITTEN:');
console.log(`  public_config/estimate_master`);
Object.entries(payload).forEach(([k, v]) => console.log(`    ${k.padEnd(14)} <- ${String(v).slice(0, 90)}${String(v).length > 90 ? '…' : ''}`));
console.log('\n  THREE ADDITIVE FIELDS. No rate, section, order or existing field is touched.');

if (!APPLY) {
  console.log("\nDRY RUN - nothing was written.\nTo apply: set MODE = 'apply' AND pass --apply, then set it back.");
  process.exit(0);
}

await ref.set(payload, { merge: true });
console.log('\nStamped. Re-running now reports "already stamped".');
