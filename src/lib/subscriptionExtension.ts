/**
 * WHAT ADDING DAYS TO A SUBSCRIPTION WILL DO - SHOWN BEFORE IT IS WRITTEN (AUDIT G100).
 *
 * ⚠ THIS EXISTS BECAUSE THREE YEARS WERE ADDED AND NO SCREEN EVER SHOWED THE DATE. ZENITH
 * TRANSFORMERS went from an expiry of 10 Mar 2028 to 10 Mar 2031 through a grant and a mark-paid
 * made 82 seconds apart. Each form showed only a "Days" box; the success message showed only the
 * amount; the one number on screen afterwards was "1636 days left" - a span from today, which read
 * as the days that had been applied. A form that says "current expiry 10 Mar 2028 -> new expiry
 * 10 Mar 2029" makes that visible before it is written rather than after.
 *
 * ⚠ THE SERVER IS THE AUTHORITY; THIS IS A MIRROR OF ITS RULE, AND IT SAYS SO. The rule lives in
 * `functions/adminSubscription.js` (and, for paid renewals, `functions/subscription.js`): extend
 * from the existing expiry while it is still ahead, otherwise from now. The functions are plain JS
 * in a separate package and cannot import this file. So the screen shows this PREVIEW before the
 * write, and the success message shows the dates the SERVER returned after it - if the two ever
 * disagree, the disagreement is on screen rather than in the data.
 *
 * Extending (rather than replacing) is the owner's decision, restated in G100: silently removing
 * months a customer was told were free is the harder mistake to explain.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface ExtensionPreview {
  /** The expiry now on the record, or null if there is none. */
  currentExpiry: number | null;
  /** True when the new period starts from the existing expiry; false when it starts from now. */
  extendsFromExisting: boolean;
  newExpiry: number;
}

/** Same rule as the server: `base = expiry > now ? expiry : now`, then `base + round(days) * DAY`. */
export function previewExtension(
  currentExpiry: number | null | undefined,
  days: number,
  now: number,
): ExtensionPreview | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  const cur = Number(currentExpiry || 0) > 0 ? Number(currentExpiry) : null;
  const extendsFromExisting = cur !== null && cur > now;
  const base = extendsFromExisting ? (cur as number) : now;
  return { currentExpiry: cur, extendsFromExisting, newExpiry: base + Math.round(days) * DAY_MS };
}

/**
 * "10 Mar 2028". A written month, deliberately: 10/03/2028 and 03/10/2028 are both plausible to
 * someone checking a date in a hurry, and a hurried check is the situation this is for.
 */
export function formatExpiry(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(Number(ms))) return 'none';
  return new Date(Number(ms)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
