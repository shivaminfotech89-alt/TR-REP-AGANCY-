// "COULD NOT LOAD" IS NOT "NOTHING THERE" (AUDIT G70, O71).
//
// On 2026-09-12 the database refused every read for a day. The agency load failed, its catch logged to the console,
// the agency list stayed empty - and every screen told the customer "No Active Agency - Create one to start", with
// Settings listing "No agencies yet". Their agencies, jobs and documents were intact and unreachable, and the app
// rendered a failure to read exactly like an absence of data, then chose the alarming reading: the sentinel shape at
// its most damaging, and an invitation to create a duplicate of an agency they already had.
//
// So a load says which of three things is true, and the screens ask it before they say anything about emptiness.

export type LoadStatus = 'loading' | 'loaded' | 'failed';

export interface AgenciesLoad {
  status: LoadStatus;
  /** Plain-language reason when `status` is 'failed'; null otherwise. */
  error: string | null;
  /**
   * When this read last SUCCEEDED, as epoch ms, or null if it never has (AUDIT G110).
   *
   * ⚠ IT RECORDS WHEN THIS TAB READ, NOT WHETHER THE SERVER HAS CHANGED SINCE. "Data read 2 minutes ago" is
   * answerable from here; "your data is stale" is not, and must not be implied from it. The two facts a refresh
   * control can honestly state are this one and whether a NEWER BUNDLE is deployed (lib/deployedVersion) - they are
   * different facts and are deliberately shown as separate lines.
   *
   * Left unchanged by a failed read, so a failure does not read as a fresh load. It is the age of the data in hand.
   */
  loadedAt: number | null;
}

/** What the app shell may say about the agency, in the order the facts decide it. */
export type AgencyGate = 'ready' | 'loading' | 'failed' | 'no-agency';

/**
 * An agency in hand is ready whatever happened since. Without one: a failed load is a failure - never "no agency";
 * a load still running says nothing yet; only a load that SUCCEEDED and found nothing is "no agency".
 */
export function agencyGate(load: AgenciesLoad, hasActiveAgency: boolean): AgencyGate {
  if (hasActiveAgency) return 'ready';
  if (load.status === 'failed') return 'failed';
  if (load.status === 'loading') return 'loading';
  return 'no-agency';
}

/** Why a read failed, in words an operator can act on. Never "something went wrong". */
export function describeLoadFailure(err: unknown): string {
  const code = String((err as any)?.code ?? '').toLowerCase().replace(/^firestore\//, '');
  if (code === 'resource-exhausted') {
    return "The database's daily usage limit has been reached, so nothing can be read until it resets.";
  }
  if (code === 'unavailable' || code === 'deadline-exceeded') {
    return 'The database could not be reached. Check the internet connection, then try again.';
  }
  if (code === 'permission-denied' || code === 'unauthenticated') {
    return "The database refused to read this account's data. Signing out and back in may help.";
  }
  const message = (err as any)?.message ? String((err as any).message) : String(err ?? '');
  return `The database returned an error${code ? ` (${code})` : ''}${message ? `: ${message.slice(0, 160)}` : ''}.`;
}
