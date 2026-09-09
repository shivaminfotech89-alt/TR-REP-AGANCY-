// GRANT THE FOUNDING AGENCIES AN EIGHTEEN-MONTH SUBSCRIPTION.
//
// WHY A DATED GRANT AND NOT A PERMANENT ONE (AUDIT G28)
// -----------------------------------------------------
// These agencies predate any offer. Charging them retroactively for a period they have
// already used is a different transaction from selling them the next year, and it is the one
// that produces an awkward invoice. A dated grant gets a working renewal path and a real GST
// invoice at a natural moment, with no lockout of operators mid-tender.
//
// Eighteen months is chosen so the deadline is not the thing that decides whether the invoice
// numbering gets built carefully. A trial short enough to rush is worse than none.
//
// ⚠ THE EXCLUSIONS ARE AN INFERENCE FROM THE AGENCY NAME, AND THE OUTPUT SAYS SO.
//
// None of these records carries an email or a GSTIN, so there is nothing in the data that
// distinguishes a customer from a test record. The classification was read off the names -
// `ADMIN` is not a trading name, `suchit` is the operator's own first name, `MEGHA` is a bare
// given name whose AT percentages were already established as test values. That is a judgement
// about the world, not a fact from the database, and a script that presents a judgement as a
// finding is how a wrong one gets approved. So this PRINTS WHAT IT INFERRED AND WHY, for a
// person who knows these agencies to read against what they know.
//
// ⚠ KEYED BY AGENCY ID, NOT BY NAME - and the first draft was keyed by name, which is how
// this comment came to exist. Two agencies are stored as "DYNAMIC TRAMSFORMER " and
// "ZENITH TRANSFORMERS ", WITH A TRAILING SPACE typed into the creation form. Exact-matching
// the names refused both, and the refusal was confusing rather than clarifying: each appeared
// as UNCLASSIFIED and as NAMED-BUT-ABSENT at once, because the name in the database and the
// name in the script were different strings that look identical when printed.
//
// A display string a human typed is not an identifier. It has whitespace, case, and typos -
// note that DYNAMIC TRAMSFORMER is itself misspelt - and it can be edited later without
// anything noticing that a script somewhere depended on it. The document id cannot. Names are
// carried here only so the output is readable, and are re-read from the database rather than
// trusted from this file.
//
// ⚠ IT REFUSES ON AN ID IT HAS NOT SEEN. If an agency exists that is in neither list, this
// stops rather than guessing. An agency created between writing this and running it must be
// classified deliberately - defaulting it either way is the failure this guard exists for: a
// silent grant to a stranger, or a silent exclusion of a paying customer.
//
// ⚠ IT WRITES subscriptions/{agencyId}, WHICH NO CLIENT MAY WRITE. That is the point of the
// collection (firestore.rules). The Admin SDK bypasses rules, so this is one of exactly two
// writers that will ever exist; the other is the payment function.
//
// MODE is 'dry-run'. Set it to 'apply' to write, and set it back before committing.

import { db, all, banner, fmtDate } from './_db.js';

const MODE = 'dry-run';           // 'dry-run' | 'apply'

const MONTHS = 18;

/**
 * Not customers. Excluded by the operator, inferred from the name - see the note above.
 * The name beside each id is what the database held when this was written; it is printed
 * from the live record, so a rename shows up rather than being masked by this file.
 */
const EXCLUDE = {
  '9REEEUHthjCNs4sYVEmm': { was: 'ADMIN',   why: 'not a trading name' },
  'jbHxk62WV0ENsmZgrjZd': { was: 'suchit',  why: "the operator's own first name" },
  'Mc3OI4IkViEHlYdiBafA': { was: 'MEGHA',   why: 'bare given name; its AT percentages were test values' },
};

/** Confirmed by the operator as real agencies. */
const GRANT = {
  'OXWTCcj41mnDLzJdM20Z': 'DYNAMIC TRAMSFORMER',
  'Kz96S2CTwRrkz3tAi7HH': 'IDEAL ENGINEERING COMPANY',
  'tzXYihx5w9KClwmT0vF3': 'PATEL ELECTRICALS',
  'cF00GwhxgSbKQjAr3iL9': 'ZENITH TRANSFORMERS',
  'sqGhsXqIDiMIJqjSmn8m': 'UPENDRA',
  'LzwH6lYkhXYY3ZUPBM71': 'DRISHIV',
  'ZV64lXxcOk09lrAxre5L': 'AARATI TRANSFORMER',
  'rz9dWJmaF8em5BqhcRcj': 'megha transformer',
  'zT54N8IsciUzZbancxBy': 'GUJARAT ENERGY TRANSMISSION',
};

banner(`GRANT FOUNDING SUBSCRIPTIONS — ${MONTHS} months  [${MODE}]`);

const agencies = await all('agencies');

// ---- classify, refusing anything unrecognised ------------------------------------------
const unknown = agencies.filter(a => !(a.id in EXCLUDE) && !(a.id in GRANT));
const absent = Object.keys(GRANT).concat(Object.keys(EXCLUDE))
  .filter(id => !agencies.some(a => a.id === id));

if (unknown.length || absent.length) {
  console.log('REFUSING — the agency list does not match this script.\n');
  unknown.forEach(a => console.log(`  UNCLASSIFIED      ${a.id}  ${JSON.stringify(a.name)}`));
  absent.forEach(id => console.log(`  NAMED BUT ABSENT  ${id}  ${JSON.stringify(GRANT[id] || EXCLUDE[id]?.was)}`));
  console.log(
    '\nAn agency in neither list must be classified deliberately. Defaulting it either way'
  + '\nis the failure this guard exists for: a silent grant to a stranger, or a silent'
  + '\nexclusion of a paying customer. Edit GRANT or EXCLUDE, then run again.\n');
  process.exit(1);
}

// ---- the grant window ------------------------------------------------------------------
const start = Date.now();
const end = new Date(start);
end.setMonth(end.getMonth() + MONTHS);
const expiry = end.getTime();

const toGrant = agencies.filter(a => a.id in GRANT);
const excluded = agencies.filter(a => a.id in EXCLUDE);

// ---- report BEFORE writing --------------------------------------------------------------
console.log('⚠ THE CLASSIFICATION BELOW IS AN INFERENCE FROM THE AGENCY NAME, not a fact from');
console.log('  the database. No agency here records an email or a GSTIN, so nothing in the');
console.log('  data distinguishes a customer from a test record. Read this against what you');
console.log('  know about these agencies rather than approving the count.\n');

console.log(`GRANTING ${toGrant.length}  —  ${fmtDate(start)}  to  ${fmtDate(expiry)}\n`);
for (const a of toGrant) {
  const already = (await db.collection('subscriptions').doc(a.id).get()).exists;
  const renamed = String(a.name).trim() !== String(GRANT[a.id]).trim()
    ? `   RENAMED since this script was written — now ${JSON.stringify(a.name)}` : '';
  console.log(`  grant    ${String(a.name).trim().padEnd(30)} ${a.id}`
    + `${already ? '   ALREADY HAS ONE — would be left alone' : ''}${renamed}`);
}

console.log(`\nEXCLUDING ${excluded.length}  —  no subscription written, nothing changed\n`);
for (const a of excluded) {
  console.log(`  skip     ${String(a.name).trim().padEnd(30)} ${EXCLUDE[a.id].why}`);
}

// ---- write -------------------------------------------------------------------------------
if (MODE !== 'apply') {
  console.log('\nDry run. Nothing was written. Set MODE = \'apply\' to write.\n');
  process.exit(0);
}

let written = 0, skipped = 0;
for (const a of toGrant) {
  const ref = db.collection('subscriptions').doc(a.id);

  // ⚠ NEVER OVERWRITE AN EXISTING SUBSCRIPTION. If one exists it was written by a payment,
  // and a grant must not shorten or extend what somebody paid for. Re-running is safe.
  if ((await ref.get()).exists) { skipped++; continue; }

  await ref.set({
    agencyId: a.id,
    agencyName: String(a.name || '').trim(),
    ownerId: a.ownerId || '',
    ownerEmail: a.email || '',
    // ⚠ 'granted', NOT 'active'. A grant and a payment are different facts and must stay
    // distinguishable: a grant has no invoice behind it, so nothing should ever look for one.
    status: 'granted',
    planAmount: 0,
    currency: 'INR',
    startDate: start,
    expiryDate: expiry,
    grantReason: `Founding agency, predates billing. ${MONTHS}-month grant.`,
    grantedAt: start,
    grantedBy: 'scripts/admin/grant-founding-subscriptions.js',
  });
  written++;
  console.log(`  written  ${String(a.name).trim()}`);
}

console.log(`\n${written} written, ${skipped} left alone (already had a subscription).\n`);
process.exit(0);
