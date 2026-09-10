// AGENCY NAME RULES — one implementation, used by both creation paths (AUDIT G38).
//
// Agencies arrive two ways: bought (createSubscriptionOrder / verifySubscriptionPayment) and
// created by the vendor (createAgency). Both must apply the same naming rules, or the same name
// would be refused on one path and accepted on the other - and the one that accepted it would
// produce two agencies a switcher cannot tell apart.

import { HttpsError } from 'firebase-functions/v2/https';

/**
 * ⚠ A BLAST-RADIUS LIMIT, NOT A TECHNICAL ONE. Ten agencies is ~150 KiB across 22 writes,
 * nowhere near Firestore's 500-write or 10 MiB transaction limits. The cap exists because a
 * single payment of Rs 59,000 is already a large thing to get wrong, and because someone typing
 * thirty names has misunderstood what this does and should meet a refusal rather than a bill.
 */
export const MAX_AGENCIES_PER_ORDER = 10;

/**
 * NORMALISE A NAME FOR COMPARISON — never for storage.
 *
 * ⚠ STORAGE KEEPS WHAT THE OPERATOR TYPED, minus surrounding whitespace. This form exists only
 * to answer "are these the same name". Writing it would rewrite "IDEAL ENGINEERING COMPANY" as
 * lower case on the documents it prints on.
 *
 * It collapses internal runs of whitespace too, because "PATEL  ELECTRICALS" and "PATEL
 * ELECTRICALS" are the same name to every human who reads them and the difference is invisible
 * on screen — the same class of defect as the trailing spaces in G29.
 */
export function nameKey(raw) {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Validate a batch of names against each other and against what this owner already has.
 *
 * ⚠ UNIQUENESS IS PER OWNER, NOT GLOBAL. Two unrelated contractors may both legitimately be
 * "PATEL ELECTRICALS", and refusing the second because a stranger got there first would be
 * refusing a real customer for someone else's reason. Within one owner's list, two identical
 * names are indistinguishable in the switcher — there is nothing to tell the rows apart, and
 * their monograms collide too — so that is the collision worth refusing.
 *
 * Pass `readOwned` so the caller decides HOW the existing agencies are read: outside a
 * transaction for the pre-payment courtesy check, and inside one where it has to be atomic.
 */
export async function validateNames(rawNames, readOwned) {
  if (!Array.isArray(rawNames) || rawNames.length === 0) {
    throw new HttpsError('invalid-argument', 'No agency names were given.');
  }
  if (rawNames.length > MAX_AGENCIES_PER_ORDER) {
    throw new HttpsError('invalid-argument',
      `One request can cover at most ${MAX_AGENCIES_PER_ORDER} agencies. `
      + `That request named ${rawNames.length}.`);
  }

  const names = rawNames.map(x => String(x || '').trim());
  const blank = names.findIndex(x => x === '');
  if (blank !== -1) {
    throw new HttpsError('invalid-argument', `Agency ${blank + 1} has no name.`);
  }
  if (names.some(x => x.length > 200)) {
    throw new HttpsError('invalid-argument', 'That name is too long.');
  }

  // Within the batch.
  const seen = new Map();
  for (const nm of names) {
    const k = nameKey(nm);
    if (seen.has(k)) {
      throw new HttpsError('invalid-argument',
        `"${nm}" is named twice in this request. Each agency needs a distinct name — they are `
        + 'told apart by name everywhere in the app.');
    }
    seen.set(k, nm);
  }

  // Against what this owner already has.
  const owned = await readOwned();
  for (const d of owned.docs) {
    const k = nameKey((d.data() || {}).name);
    if (seen.has(k)) {
      throw new HttpsError('already-exists',
        `You already have an agency called "${seen.get(k)}". Give this one a different name.`);
    }
  }
  return names;
}
