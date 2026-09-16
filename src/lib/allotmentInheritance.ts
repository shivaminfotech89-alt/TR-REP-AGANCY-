/**
 * WHICH TENDERS STILL INHERIT THEIR ALLOTMENT QUOTA FROM THE AGENCY - A CLOSING LIST (AUDIT G94).
 *
 * The rule from now on is: A TENDER'S QUOTA IS THE SUM OF ITS OWN ALLOTMENT LETTERS. A new AT
 * starts at `{}` and only letters add to it. That is the same shape as the job-number counters
 * in O89, one screen over, and for the same reason.
 *
 * ⚠ IT IS NOT APPLIED RETROSPECTIVELY, AND THAT IS A DELIBERATE REFUSAL. Removing the agency
 * fallback everywhere at once would be a CUSTOMER-FACING INTAKE STOP, mid-tender. `NewJob`
 * treats a missing quota as BLOCKING - "an allotment that was never recorded is not a quota of
 * zero and not a quota of infinity, it is missing data" (A3) - so three divisions with jobs
 * already booked and NO letter in the app would refuse the next intake:
 *
 *     MEGHA AT 26-27     KALOL / Amorphous       quota 10   letters 0   booked 1
 *     MEGHA AT 26-27     SABARMATI / Amorphous   quota 10   letters 0   booked 3
 *     UPENDRA ANNUAL     DEESA / Amorphous       quota 15   letters 0   booked 1
 *
 * A correct rule arriving as an outage is still an outage.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ THIS LIST MAY ONLY SHRINK. A TEST FAILS IF IT GROWS - see allotmentInheritance.test.ts.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * WHY A LIST AND NOT A FLAG OR A DATE. A `quotaFromLettersOnly` flag on new ATs makes the
 * ABSENCE of the flag trigger the old path, so any future write that forgets it silently
 * inherits the legacy behaviour - the defect comes back through the door marked "default". A
 * dated cutoff needs a clock at every read site and goes on working forever. An enumerated list
 * of ids that exist TODAY cannot admit a new tender at all: there is nothing to forget, because
 * nothing writes to it.
 *
 * HOW AN AT LEAVES THIS LIST - and it is a work queue, not an exemption:
 *
 *   1. Enter the tender's real allotment letters in Agency Settings -> the tender -> Allotment
 *      Quotas & Letters.
 *   2. Check it is ready: `node scripts/admin/allotment-vs-letters.mjs` reports "ready to leave
 *      LEGACY_QUOTA_ATS?" per tender.
 *   3. Delete its id from the array below.
 *
 * ⚠ READINESS IS NOT A JUDGEMENT CALL. For every division and core type with work booked, the
 * letters must total AT LEAST what is booked. Below that, removing the id would refuse the next
 * intake on a division that already has jobs - the same floor `lib/allotments.ts` enforces for a
 * single correction, applied to the whole tender.
 *
 * WHEN THE ARRAY IS EMPTY, delete this module and its three call sites. That is the finish line
 * and it is meant to be reached.
 */

/**
 * The tenders that existed when the rule changed, on 2026-09-16. Ids, not names: two agencies
 * have several unnamed ATs and a name would not identify one.
 */
export const LEGACY_QUOTA_ATS: readonly string[] = [
  'hzOnRqgOz37AF91dJiEn',   // GUJARAT ENERGY TRANSMISSION - quota matches its letters
  'Unu1F8JR9koc9gamfgfL',   // MEGHA AT 26-27 - 35 units unexplained; 2 rows have jobs and no letter
  'krdXRrzgCl0aTbJNTiL4',   // ADMIN 2026_27 (closed) - 45 unexplained, nothing booked
  'JhnC9WXc8WAW4AHKFehU',   // AARATI 11101 - quota matches its letters
  'hkT1Jcj3XUcjBE2PjPp5',   // UPENDRA ANNUAL - 45 unexplained; DEESA/Amorphous has 1 booked, 0 letters
  'Hw0QkzKmT3n6tmFwkl3H',   // UPENDRA - quota matches its letters
  'ZEM9a4sYdiRo9dpYcAb2',   // SAMOR - no jobs
  '6OJBh6WGntRPOzfnnBuj',   // ZENITH - quota matches its letters
  'vqwWgT7ieAXOOQ378zuz',   // PATEL ELECTRICALS - quota matches its letters
  'O141gDio6XTRyuMyZeQl',   // ADMIN (active) - no jobs
  'SJ4UH4oygwW9QPmngCrI',   // SAMOR (closed) - quota matches its letters
  'mwmx9Q2jWEymhor2j4NE',   // SAMOR (active) - no jobs
  '8gYhz4XZyTsyP7Cu6Wp2',   // BANAS TRANSFORMER - no jobs, no quota
  'ws859E4GQepVuYXHLdGi',   // UPENDRA PRIVIOUS YEAR - no jobs
  '5MQHD3fgetXdoBPxkdDj',   // suchit 1011 - no jobs
  'aRYrI319p5b3UWHs2WuH',   // megha transformer - no jobs
];

/**
 * THE FROZEN ORIGINAL - the upper bound the test checks against.
 *
 * ⚠ DO NOT EDIT THIS ONE. `LEGACY_QUOTA_ATS` shrinks as paperwork is entered; this records what
 * it was allowed to contain on the day the rule changed. An id that appears in the live list and
 * not here is a tender that was added AFTER the cutoff, which is exactly what must not happen.
 */
export const LEGACY_QUOTA_ATS_AT_CUTOFF: readonly string[] = [
  'hzOnRqgOz37AF91dJiEn', 'Unu1F8JR9koc9gamfgfL', 'krdXRrzgCl0aTbJNTiL4',
  'JhnC9WXc8WAW4AHKFehU', 'hkT1Jcj3XUcjBE2PjPp5', 'Hw0QkzKmT3n6tmFwkl3H',
  'ZEM9a4sYdiRo9dpYcAb2', '6OJBh6WGntRPOzfnnBuj', 'vqwWgT7ieAXOOQ378zuz',
  'O141gDio6XTRyuMyZeQl', 'SJ4UH4oygwW9QPmngCrI', 'mwmx9Q2jWEymhor2j4NE',
  '8gYhz4XZyTsyP7Cu6Wp2', 'ws859E4GQepVuYXHLdGi', '5MQHD3fgetXdoBPxkdDj',
  'aRYrI319p5b3UWHs2WuH',
];

/**
 * Does this tender still fall back to the agency's allotment map?
 *
 * ⚠ A MISSING OR EMPTY ID IS NOT LEGACY. `activeAtMaster` can be null and an unsaved AT has no
 * id; both must take the new rule rather than the old one, or "no tender selected" would quietly
 * inherit a quota.
 */
export function inheritsAgencyQuota(atId?: string | null): boolean {
  const id = String(atId ?? '').trim();
  if (!id) return false;
  return LEGACY_QUOTA_ATS.includes(id);
}
