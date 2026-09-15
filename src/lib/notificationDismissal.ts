/**
 * DISMISS UNTIL THE FACT CHANGES — SIGNATURES, NOT DISMISSALS (AUDIT G93).
 *
 * A notification is dismissed by recording a SIGNATURE of the data that produced it, never a
 * "hidden" flag. It comes back the moment the computed signature differs from the stored one.
 * So clearing the no-MR-number notice hides it until ANOTHER receipt is recorded without one,
 * and no per-item bookkeeping, expiry date or "hide forever" state exists to go stale.
 *
 * ⚠ WHY NOT FIRESTORE. There is no per-user document in this app — no `users/{uid}` match block
 * exists, and the catch-all in firestore.rules is `allow read, write: if false`, so a store would
 * need a new collection, a validator and a rules deploy, plus a billed write per dismissal for a
 * UI preference. Riding it on the agency document is mechanically possible (`isValidAgency` names
 * fields rather than using `keys().hasOnly`, so an unknown field passes) and is exactly wrong:
 * AGENCIES ARE DELEGATED TO OTHER ACCOUNTS (G37), so one person's dismissal would clear the
 * notice for everyone working that agency. Per-browser is the deliberate trade.
 *
 * ⚠ A STORAGE FAILURE MUST SHOW THE NOTIFICATION, NEVER HIDE IT. Every read and write here is
 * wrapped, and every failure path returns "not dismissed". Private windows and blocked site data
 * throw on access; the cost of that must be a notice the operator has already seen, not a notice
 * they never see.
 */

const PREFIX = 'notif-dismissed:';

/** localStorage, or null. Accessing it THROWS in some browsers - not merely returns null. */
function store(): any {
  try {
    return (globalThis as any).localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The fact, as one comparable string.
 *
 * ⚠ SORTED, so that the same set of facts arriving in a different order is the SAME fact. An
 * unsorted join would resurrect a dismissed notice whenever a query returned its rows in another
 * order — which looks exactly like a new fact and would teach the operator to ignore it.
 *
 * Blank parts are dropped; duplicates collapse. An EMPTY signature means "no fact", and a
 * notification with no fact is not shown at all, so there is nothing to dismiss.
 */
export function signatureOf(parts: unknown[]): string {
  const keys = (parts || [])
    .map(p => String(p ?? '').trim())
    .filter(p => p.length > 0);
  return Array.from(new Set(keys)).sort().join('|');
}

/** What was dismissed for this notification, or '' if nothing (including when storage is unusable). */
export function readDismissed(id: string): string {
  const s = store();
  if (!s || !id) return '';
  try {
    return String(s.getItem(PREFIX + id) ?? '');
  } catch {
    return '';
  }
}

/**
 * Is this notification dismissed AS IT CURRENTLY STANDS?
 *
 * False whenever the signature is empty (no fact), whenever nothing was stored, and whenever the
 * stored signature describes a different set of facts from the one in front of us now.
 */
export function isDismissed(id: string, signature: string): boolean {
  if (!signature) return false;
  return readDismissed(id) === signature;
}

/** Record that THIS set of facts was dismissed. A failure to store simply leaves it showing. */
export function dismiss(id: string, signature: string): void {
  const s = store();
  if (!s || !id || !signature) return;
  try {
    s.setItem(PREFIX + id, signature);
  } catch {
    /* Quota, private mode, blocked site data. The notice stays visible - see the header. */
  }
}

/** Undo a dismissal outright, so the notice returns even though the facts have not changed. */
export function undismiss(id: string): void {
  const s = store();
  if (!s || !id) return;
  try {
    s.removeItem(PREFIX + id);
  } catch {
    /* As above. */
  }
}
