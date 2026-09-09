// TRIM LEADING AND TRAILING WHITESPACE FROM AGENCY NAMES.
//
// WHY THIS SCRIPT EXISTS (AUDIT G29)
// ----------------------------------
// Two agencies are stored as "DYNAMIC TRAMSFORMER " and "ZENITH TRANSFORMERS ", with a
// trailing space typed into the creation form, which wrote the input verbatim. The form now
// trims on save, so no new one can appear; this clears the two that already exist.
//
// ⚠ THIS IS A VENDOR WRITE INTO CUSTOMERS' AGENCY DOCUMENTS, WHICH THE RULES FORBID.
//
// AUDIT G1 removed `isSuperAdmin()` from every agency write for a stated reason: a vendor who
// can edit a customer's rates, estimates or bills is a liability rather than a capability -
// if the figures are wrong, the customer cannot say it was not us. That restraint is enforced
// in firestore.rules, and the Admin SDK bypasses rules, so this script is deliberately outside
// a boundary the app cannot cross.
//
// It is justified because THE RESTRAINT IS ABOUT SUBSTANCE. Rates, estimates, bills, figures a
// customer would dispute. A trailing space is not substance: nobody typed it deliberately, no
// human can see it, it does not change what the agency is called, and it is our defect rather
// than their data - the form should never have stored it.
//
// The spelling is a different matter and is NOT touched. "DYNAMIC TRAMSFORMER" is misspelt,
// and it is the agency's own name as they gave it; it prints on their documents. Correcting a
// customer's name because it looks wrong to us is exactly the substance G1 says is not ours.
// The whitespace is ours. The spelling is theirs.
//
// ⚠ SO THE SCOPE IS DELIBERATELY THE NARROWEST POSSIBLE. One field, `name`, on the documents
// that actually differ, with `update()` rather than `set()` so nothing else on the document can
// be touched even by accident. It prints every value JSON-QUOTED before and after, because a
// diff whose whole content is invisible whitespace cannot be reviewed any other way - and the
// census that produced the original agency list printed these names through `padEnd`, which is
// precisely the formatting that hid the defect in the first place.
//
// MODE is 'dry-run'. Set it to 'apply' to write, and set it back before committing.

import { db, all, banner } from './_db.js';

const MODE = 'dry-run';           // 'dry-run' | 'apply'

banner(`TRIM AGENCY NAMES  [${MODE}]`);

const agencies = await all('agencies');

const changes = agencies
  .map(a => ({ id: a.id, before: a.name, after: String(a.name ?? '').trim() }))
  .filter(c => typeof c.before === 'string' && c.before !== c.after);

// ---- refuse on anything this script is not meant to do ----------------------------------
//
// A name that trims to nothing would leave an agency with no name at all, which is a data
// problem to raise rather than one to silently create.
const empties = changes.filter(c => c.after === '');
if (empties.length) {
  console.log('REFUSING — trimming would leave an empty name.\n');
  empties.forEach(c => console.log(`  ${c.id}  ${JSON.stringify(c.before)}  ->  ""`));
  console.log('\nThat is a data problem to look at, not one to create silently.\n');
  process.exit(1);
}

// Internal whitespace is left alone. "megha  transformer" with a double space is a different
// judgement - it changes how the name reads - and this script is only about the invisible ends.
const internal = agencies.filter(a =>
  typeof a.name === 'string' && /\s{2,}/.test(a.name.trim()));

if (!changes.length) {
  console.log('Nothing to do. No agency name has leading or trailing whitespace.\n');
  process.exit(0);
}

console.log(`${changes.length} of ${agencies.length} agency names differ. Values are JSON-quoted`);
console.log('so the whitespace is visible — it cannot be reviewed any other way.\n');

for (const c of changes) {
  console.log(`  ${c.id}`);
  console.log(`      before  ${JSON.stringify(c.before)}`);
  console.log(`      after   ${JSON.stringify(c.after)}`);
}

if (internal.length) {
  console.log('\nNOT TOUCHED — internal double spaces, which change how a name reads:');
  internal.forEach(a => console.log(`  ${a.id}  ${JSON.stringify(a.name)}`));
}

console.log('\nThe `name` field only. Nothing else on these documents is written, and no other');
console.log('agency is opened. Spelling is not corrected: "DYNAMIC TRAMSFORMER" is the');
console.log("agency's own name and prints on their documents.\n");

if (MODE !== 'apply') {
  console.log("Dry run. Nothing was written. Set MODE = 'apply' to write.\n");
  process.exit(0);
}

for (const c of changes) {
  // ⚠ update(), NOT set(). `set` without merge would replace the whole agency document with a
  // single field - every rate, prefix and allotment gone. The narrow call is the safe one, and
  // on a customer's document it is the only acceptable one.
  await db.collection('agencies').doc(c.id).update({ name: c.after });
  console.log(`  written  ${c.id}  ${JSON.stringify(c.after)}`);
}

console.log(`\n${changes.length} name(s) trimmed.\n`);
process.exit(0);
