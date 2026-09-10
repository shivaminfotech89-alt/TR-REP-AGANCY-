// A MODEL OF THE AGENCY ACCESS RULES, NOT A TEST OF THEM (AUDIT G37).
//
// ⚠ READ THIS BEFORE TRUSTING THE OUTPUT. This file re-implements the predicates from
// firestore.rules in JavaScript and runs a case matrix against them. It validates THE LOGIC -
// whether the conditions as written say what they are meant to say. It does NOT validate
// Firestore's evaluation of them: the real semantics of `get(key, default)`, `.lower()` on an
// absent field, list equality, or short-circuit order are Firestore's, and only the emulator
// can confirm those.
//
// The emulator needs Java, which is not installed on this machine. So this is the strongest
// verification available here, and its limit is stated rather than left to be assumed - a
// harness that overstates what it checked is the failure this audit keeps recording (G33).
//
// ⚠ IF THE PREDICATES BELOW ARE EDITED WITHOUT firestore.rules BEING EDITED TO MATCH, THIS
// PROVES NOTHING. They are a transcription, and a transcription is a second source of truth.
// It is worth the copy only because the alternative here is no check at all.
//
//     node scripts/admin/model-agency-rules.js

// ---- the predicates, transcribed from firestore.rules ------------------------------------

const get = (obj, key, dflt) => (obj && key in obj && obj[key] !== undefined ? obj[key] : dflt);

const callerEmailLower = auth =>
  (auth && typeof auth.email === 'string') ? auth.email.toLowerCase() : '';

const isOwnerOf = (agency, auth) => !!auth && agency.ownerId === auth.uid;

const emailGrants = (agency, auth) => {
  const c = callerEmailLower(auth);
  return c !== ''
    && typeof get(agency, 'email', '') === 'string'
    && get(agency, 'email', '').toLowerCase() === c;
};

const sharedGrants = (agency, auth) => {
  const c = callerEmailLower(auth);
  const list = get(agency, 'sharedWithEmails', []);
  return c !== ''
    && Array.isArray(list)
    && (list.includes(c) || list.includes(auth.email));
};

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const grantsUnchanged = (incoming, existing) =>
  get(incoming, 'email', '') === get(existing, 'email', '')
  && eq(get(incoming, 'sharedWithEmails', []), get(existing, 'sharedWithEmails', []));

const SUPER = 'shivaminfotech89@gmail.com';
const isSuperAdmin = auth => !!auth && auth.email === SUPER;

const canRead = (agency, auth) =>
  !!auth && (isOwnerOf(agency, auth) || isSuperAdmin(auth)
             || emailGrants(agency, auth) || sharedGrants(agency, auth));

const canUpdate = (existing, incoming, auth) =>
  !!auth
  && (isOwnerOf(existing, auth) || emailGrants(existing, auth) || sharedGrants(existing, auth))
  && (get(incoming, 'ownerId', null) === get(existing, 'ownerId', null) || !('ownerId' in existing))
  && (isOwnerOf(existing, auth) || grantsUnchanged(incoming, existing))
  && true; // isValidAgency is type-checking, out of scope here

// ---- the live shapes ----------------------------------------------------------------------

const OWNER = { uid: 'owner-uid', email: 'owner@example.com' };
const DELEGATE = { uid: 'delegate-uid', email: 'dynamictransformer@gmail.com' };
const DELEGATE_UPPER = { uid: 'delegate-uid', email: 'UTPAREKH@GMAIL.COM' };
const DELEGATE_LOWER = { uid: 'delegate-uid', email: 'utparekh@gmail.com' };
const STRANGER = { uid: 'stranger-uid', email: 'stranger@example.com' };
const NO_EMAIL = { uid: 'noemail-uid' };
const VENDOR = { uid: 'vendor-uid', email: SUPER };

const agency = extra => ({ ownerId: 'owner-uid', name: 'DYNAMIC TRAMSFORMER', ...extra });

const A_GRANTED = agency({ email: 'dynamictransformer@gmail.com' });
const A_UPPER   = agency({ email: 'UTPAREKH@GMAIL.COM' });
const A_NONE    = agency({});                       // six of twelve look like this
const A_SHARED  = agency({ sharedWithEmails: ['helper@example.com'] });

const edit = (base, patch) => ({ ...base, ...patch });

let fails = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(66)} ${actual ? 'allow' : 'deny'}`);
}

console.log('\nREAD\n');
check('owner reads own agency', canRead(A_GRANTED, OWNER), true);
check('delegate reads via exact-case email', canRead(A_GRANTED, DELEGATE), true);
check('delegate reads UPPERCASE grant with lowercase token  <- was DENIED before',
      canRead(A_UPPER, DELEGATE_LOWER), true);
check('delegate reads UPPERCASE grant with uppercase token', canRead(A_UPPER, DELEGATE_UPPER), true);
check('stranger cannot read', canRead(A_GRANTED, STRANGER), false);
check('vendor reads (support)', canRead(A_GRANTED, VENDOR), true);
check('token with NO email cannot read an agency with no grant',
      canRead(A_NONE, NO_EMAIL), false);
check('stranger cannot read an agency with no grant', canRead(A_NONE, STRANGER), false);
check('shared list grants read', canRead(A_SHARED, { uid: 'h', email: 'helper@example.com' }), true);

console.log('\nUPDATE — ordinary saves that must keep working\n');
check('owner edits the name', canUpdate(A_GRANTED, edit(A_GRANTED, { name: 'NEW' }), OWNER), true);
check('delegate edits the name (grant untouched)',
      canUpdate(A_GRANTED, edit(A_GRANTED, { name: 'NEW' }), DELEGATE), true);
check('delegate advances lastJobNumbers (merge write)',
      canUpdate(A_GRANTED, edit(A_GRANTED, { lastJobNumbers: { X: 4 } }), DELEGATE), true);
check('delegate on an UPPERCASE grant edits the name',
      canUpdate(A_UPPER, edit(A_UPPER, { name: 'NEW' }), DELEGATE_LOWER), true);

console.log('\nUPDATE — what the new constraint refuses\n');
check('delegate changes the access email          <- NEWLY REFUSED',
      canUpdate(A_GRANTED, edit(A_GRANTED, { email: 'someone@else.com' }), DELEGATE), false);
check('delegate clears the access email           <- NEWLY REFUSED',
      canUpdate(A_GRANTED, edit(A_GRANTED, { email: '' }), DELEGATE), false);
check('delegate appends to sharedWithEmails       <- NEWLY REFUSED',
      canUpdate(A_SHARED, edit(A_SHARED, { sharedWithEmails: ['helper@example.com', 'x@y.com'] }),
                { uid: 'h', email: 'helper@example.com' }), false);
check('owner changes the access email (re-grant)',
      canUpdate(A_GRANTED, edit(A_GRANTED, { email: 'someone@else.com' }), OWNER), true);
check('owner clears the access email (revoke)',
      canUpdate(A_GRANTED, edit(A_GRANTED, { email: '' }), OWNER), true);
check('owner adds a shared email',
      canUpdate(A_NONE, edit(A_NONE, { sharedWithEmails: ['new@x.com'] }), OWNER), true);

console.log('\nUPDATE — unchanged guarantees\n');
check('stranger cannot update', canUpdate(A_GRANTED, edit(A_GRANTED, { name: 'X' }), STRANGER), false);
check('vendor cannot update (G1 holds)', canUpdate(A_GRANTED, edit(A_GRANTED, { name: 'X' }), VENDOR), false);
check('delegate cannot change ownerId', canUpdate(A_GRANTED, edit(A_GRANTED, { ownerId: 'delegate-uid' }), DELEGATE), false);
check('owner cannot change ownerId either', canUpdate(A_GRANTED, edit(A_GRANTED, { ownerId: 'x' }), OWNER), false);

console.log(`\n${fails === 0 ? 'All cases behave as intended.' : fails + ' CASE(S) WRONG.'}`);
console.log('Model only — Firestore evaluation is not verified here. See the header.\n');
process.exit(fails === 0 ? 0 : 1);
