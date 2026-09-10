import type { AtMaster } from './AgencyContext';

/**
 * HOW LONG A REPAIR IS GUARANTEED FOR (AUDIT G42).
 *
 * ⚠ ONE RESOLVER, BECAUSE THERE USED TO BE THREE ANSWERS AND THEY DISAGREED. The certificate
 * printed a free-text "Twelve/Eighteen" an operator typed; the Guarantee Card printed the
 * agency's `gpValidationMonths`; and the Dashboard counted a hardcoded eighteen months. Two of
 * those appeared on the same bill. A number that decides whether a repair is free is not a
 * number three screens should each have their own opinion about.
 *
 * ⚠ THE TENDER DECIDES, NOT THE AGENCY. A/T 1819 clause 38.2 sets the period, and a different
 * A/T may set another - so it lives on the AT. An agency-level figure would survive a rollover
 * and quietly apply the previous tender's terms to this tender's work.
 */

/**
 * ⚠ THE DEFAULT IS 18 FOR EVERY CORE TYPE THE APP CAN EXPRESS, and that is the whole of what
 * clause 38.2 says about 11 KV CRGO and amorphous work.
 *
 * ⚠ LSTC / PAT IS DELIBERATELY ABSENT. Clause 38.2 gives SDT/PAT six months, and this app has
 * no such core type: LSTC exists only as a job-number prefix, there is no `prefixLSTC` on a live
 * division, and not one of the 64 live jobs carries it. A six-month default keyed to a core type
 * nothing can select would be a setting that does nothing - which is the exact shape the
 * stale-truth sweep exists to remove, arriving new.
 *
 * WHAT IT WOULD TAKE, so this is a decision rather than an omission: LSTC as a real core type in
 * the intake form and the pricing paths, a prefix field on the division form beside the existing
 * three, and then a six-month default follows from the core type it attaches to.
 */
export const DEFAULT_GUARANTEE_MONTHS = 18;

/** Core types the app can actually express, in the spelling jobs store. */
export const GUARANTEED_CORE_TYPES = ['CRGO', 'Amorphous', 'Wound Core', 'OH'] as const;

/**
 * The guarantee period for a job of this core type under this tender.
 *
 * ⚠ A JOB THAT ALREADY STORES ONE WINS, ALWAYS. `gpGuaranteeMonths` is stamped at save, so a
 * unit dispatched under a closed tender keeps that tender's terms rather than acquiring the
 * current one's. Callers holding a job should pass it.
 */
export function guaranteeMonthsFor(
  at: Pick<AtMaster, 'guaranteeMonths'> | null | undefined,
  coreType: string | null | undefined,
  storedOnJob?: number | null,
): number {
  if (typeof storedOnJob === 'number' && storedOnJob > 0) return storedOnJob;
  const key = String(coreType || 'CRGO');
  const v = at?.guaranteeMonths?.[key];
  return typeof v === 'number' && v > 0 ? v : DEFAULT_GUARANTEE_MONTHS;
}

/**
 * A COUNTER VALUE FROM A STARTING NUMBER. The one place the -1 lives.
 *
 * ⚠ `lastJobNumbers` HOLDS THE LAST USED NUMBER, NOT THE NEXT ONE. `predictNextJobNo` returns
 * `last + 1`, and an absent counter reads 0 so the first job is 1. An agency joining a tender
 * part-way and starting at 47 therefore seeds 46. Storing 47 directly would make its first job
 * 48, which is the off-by-one this function exists to have exactly once.
 */
export function seedFromStartingNumber(startingNumber: number): number {
  return Math.max(0, Math.floor(startingNumber) - 1);
}

/** The inverse, for showing a stored seed back as the number a person typed. */
export function startingNumberFromSeed(seed: number): number {
  return Math.max(1, Math.floor(seed) + 1);
}
