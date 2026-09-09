/**
 * WHO THE VENDOR IS — ONE DEFINITION, USED BY EVERY FUNCTION THAT ASKS (AUDIT G33).
 *
 * ⚠ THE EMAIL IS THE IDENTITY, NOT A UID, AND NOT ANYTHING THE SCREEN SAYS. It mirrors
 * `isSuperAdmin()` in firestore.rules, which compares `request.auth.token.email`. Two places
 * already had this constant written out - `deleteIfEmpty` in index.js and the rules - and a
 * third copy in createAgency would be the point at which they start to disagree. A vendor
 * exemption that is true in one function and false in another is the worst kind of drift,
 * because both halves look right in isolation.
 *
 * ⚠ NORMALISED BEFORE COMPARING. An auth token's email arrives with whatever case the provider
 * gives it, and Google's does vary. `Shivaminfotech89@Gmail.com` is the same account and would
 * fail a naive `===`, silently denying the vendor their own exemption - or, if the constant
 * were the odd-cased one, silently granting it to nobody. Both failures are quiet.
 */

/** The one account with the vendor exemption. Mirrors isSuperAdmin() in firestore.rules. */
export const SUPER_ADMIN_EMAIL = 'shivaminfotech89@gmail.com';

/** Normalise an auth token's email the same way every caller must. */
export function normaliseEmail(raw) {
  return String(raw || '').toLowerCase().trim();
}

/**
 * Is this caller the vendor?
 *
 * ⚠ TAKES THE EMAIL FROM THE VERIFIED TOKEN, NEVER FROM THE REQUEST BODY. Callers must pass
 * `request.auth.token.email`. A function that accepted an email as an argument would be
 * accepting a claim of identity from the party making it.
 */
export function isSuperAdmin(tokenEmail) {
  return normaliseEmail(tokenEmail) === SUPER_ADMIN_EMAIL;
}
