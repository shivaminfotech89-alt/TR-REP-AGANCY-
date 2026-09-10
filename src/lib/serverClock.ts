/**
 * SERVER TIME, FOR DECISIONS THE CUSTOMER'S CLOCK MUST NOT MAKE (AUDIT G49).
 *
 * ⚠ WHY THIS EXISTS AT ALL. A trial is 72 hours. `Date.now()` is the device's clock, so a
 * machine an hour fast ends the trial an hour early - 1.4% of it - and the customer has no way
 * to know why. For an eighteen-month grant that is noise; for three days it is the difference
 * between a prospect who finished evaluating and one who was cut off mid-task.
 *
 * ⚠ THERE IS NO SERVER TIME ALREADY ON HAND, which is worth stating because the obvious
 * candidates all fail:
 *
 *   - `serverTimestamp()` is a WRITE-ONLY sentinel. It resolves on the server during a write and
 *     is not readable as a value without performing one.
 *   - A subscription's `expiryDate` IS server-derived - the function computed it from its own
 *     clock - so the ENDPOINT is trustworthy. It is the comparison that is not.
 *   - Firestore snapshots carry no server time in their metadata.
 *   - The auth token has server-issued `issuedAtTime`, but reading it does not tell you when it
 *     was issued relative to now unless you force a refresh, which is a network call.
 *
 * So the cheapest anchor is the one every HTTP response already carries: the `Date` header. It is
 * CORS-safelisted, so it is readable, and one HEAD request at startup is enough to measure the
 * offset between this device and the server. Measured against the live site while writing this,
 * the difference on a correctly-set machine was one second.
 *
 * ⚠ AND WHEN IT IS UNAVAILABLE, ROUND IN THE CUSTOMER'S FAVOUR. If the probe fails the offset is
 * zero and `Date.now()` is used, with `FAVOUR_MS` subtracted from every comparison - so a device
 * of unknown accuracy gets a slightly longer trial rather than a slightly shorter one. Erring
 * towards a free hour costs nothing; erring the other way costs the customer.
 */

/** How much slack a comparison gets when the server offset is unknown. One hour. */
export const FAVOUR_MS = 60 * 60 * 1000;

let offsetMs = 0;
let anchored = false;

/** True once the offset has been measured against a server response. */
export function clockIsAnchored(): boolean {
  return anchored;
}

/**
 * Measure the offset between this device and the server, once.
 *
 * ⚠ IT ASKS THE APP'S OWN ORIGIN, not a time service. A third-party time API is another
 * dependency, another failure mode and another thing to explain in a privacy policy, to learn
 * something the origin already tells us on every response.
 */
export async function anchorClock(): Promise<void> {
  if (anchored) return;
  try {
    const before = Date.now();
    const res = await fetch('/', { method: 'HEAD', cache: 'no-store' });
    const after = Date.now();
    const header = res.headers.get('date');
    if (!header) return;
    const serverMs = Date.parse(header);
    if (!Number.isFinite(serverMs)) return;
    // The header names a moment somewhere inside the round trip; the midpoint is the best
    // single guess, and the residual error is half the latency - milliseconds, against a
    // 72-hour window.
    offsetMs = serverMs - (before + (after - before) / 2);
    anchored = true;
  } catch {
    // Offline, blocked, or a proxy that strips the header. Leave the offset at zero; every
    // comparison then leans the customer's way by FAVOUR_MS.
  }
}

/** The best available "now". Server-anchored when possible, the device's clock otherwise. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/**
 * Has this moment passed?
 *
 * ⚠ THE FAVOUR IS APPLIED ONLY WHEN THE CLOCK IS NOT ANCHORED. With a measured offset the
 * comparison is honest in both directions; without one it leans towards not-yet-expired. A
 * blanket hour of grace on an anchored clock would just be a 73-hour trial described as 72.
 */
export function hasPassed(whenMs: number | null | undefined): boolean {
  if (!whenMs) return false;
  const slack = anchored ? 0 : FAVOUR_MS;
  return serverNow() - slack >= whenMs;
}
