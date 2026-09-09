import { getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { app } from './firebase';

/**
 * CREATING AN AGENCY THROUGH THE GATE (AUDIT G33).
 *
 * ⚠ THE CLIENT DOES NOT DECIDE WHETHER IT MAY CREATE ONE, and does not say whether the caller
 * is the vendor. It asks; the function decides. The entitlement check, the slot decrement and
 * the admin exemption all live server-side, and a caller reaching the function directly is
 * refused by exactly the same tests as one coming through this file.
 *
 * ⚠ SO THERE IS NO `isAdmin` FLAG IN THIS REQUEST, deliberately. A boolean the browser sets and
 * the server trusts is not an exemption, it is a request to be exempted - and it is the shape
 * every "admin mode" vulnerability takes. The function reads the verified auth token's email.
 */

/** Must match the region the functions are deployed to - see functions/index.js. */
const REGION = 'us-central1';

let fns: Functions | null = null;
const functionsClient = () => (fns ??= getFunctions(app, REGION));

export type CreatedAgency = {
  id: string;
  /** The assembled document, so local state needs no re-read. Carries no `createdAt`. */
  document: Record<string, unknown>;
  /** True when the vendor exemption applied. Reported by the server, never asserted by us. */
  admin: boolean;
  /** Slots left after this one, or null when no slot was consumed. */
  slotsRemaining: number | null;
};

/** A refusal a person can act on, rather than a Firebase error code. */
export class AgencyCreateError extends Error {
  readonly kind: 'no-slots' | 'not-deployed' | 'denied' | 'invalid' | 'unknown';
  constructor(kind: AgencyCreateError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

function translate(err: any): AgencyCreateError {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');

  // ⚠ 'not-found' HERE MEANS THE FUNCTION IS NOT DEPLOYED, not that an agency is missing - the
  // callable name did not resolve. Reported plainly, because during rollout this is the most
  // likely failure and it looks identical to a permissions problem otherwise.
  if (code.includes('not-found') && !msg.trim()) {
    return new AgencyCreateError('not-deployed',
      'Agency creation is not available yet: the server function has not been deployed.');
  }
  if (code.includes('failed-precondition')) return new AgencyCreateError('no-slots', msg);
  if (code.includes('permission-denied') || code.includes('unauthenticated')) {
    return new AgencyCreateError('denied', msg || 'You are not allowed to create an agency.');
  }
  if (code.includes('invalid-argument')) return new AgencyCreateError('invalid', msg);
  return new AgencyCreateError('unknown', msg || 'The agency could not be created.');
}

export async function createAgencyViaFunction(
  agencyData: Record<string, unknown>,
): Promise<CreatedAgency> {
  try {
    const call = httpsCallable(functionsClient(), 'createAgency');
    const res: any = await call({ agencyData });
    const d = res?.data || {};
    if (!d.id) throw new AgencyCreateError('unknown', 'The server did not return a new agency.');
    return {
      id: String(d.id),
      document: (d.document || {}) as Record<string, unknown>,
      admin: !!d.admin,
      slotsRemaining: d.slotsRemaining ?? null,
    };
  } catch (err) {
    if (err instanceof AgencyCreateError) throw err;
    throw translate(err);
  }
}
