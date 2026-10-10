/**
 * CORRECTING AN ALLOTMENT LETTER - EDIT AND DELETE (AUDIT G72).
 *
 * An allotment arrives as a letter from the division. The panel adds letters and adds their quantity to a cumulative
 * quota map. Until this file there was no way back: an agency that typed 30 for a letter that said 13 could only add
 * more.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ THE MAP IS ADJUSTED BY THE DELTA. IT IS NEVER REBUILT FROM THE LETTERS. ⚠⚠
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A future reader will notice that `allotments[division][coreType]` ought to equal the sum of that division's letters,
 * find live data where it does not, and reach for the obvious fix - recompute the map from the history. DO NOT. On
 * 2026-09-12, two of the eight ATs carrying quotas disagreed with their own letters:
 *
 *   ADMIN 2026_27      SABARMATI/CRGO       map 35   letters 15   booked 0
 *                      SABARMATI/Amorphous  map 30   letters 15   booked 0
 *                      SABARMATI/Wound Core map 10   letters 0    booked 0
 *   MEGHA AT 26-27     SABARMATI/CRGO       map 30   letters 25   booked 21
 *                      SABARMATI/Amorphous  map 10   letters 0    booked 3
 *                      KALOL/Amorphous      map 10   letters 0    booked 1
 *                      KALOL/Wound Core     map 10   letters 0    booked 0
 *
 * A rebuild would silently cut MEGHA's CRGO quota from 30 to 25 with 21 jobs already booked against it, and ADMIN's
 * from 35 to 15. WHICH FIGURE IS RIGHT CANNOT BE DECIDED FROM THE DATABASE - only the paper letters say whether the
 * map is right and letters are missing, or the map was inflated and those jobs sit under a quota nobody issued. That
 * is an owner's question, held open in AUDIT G72, and a recompute would answer it by accident in one direction.
 *
 * HOW THE DISAGREEMENT AROSE, so the edit path does not repeat it: `AtAllotments` initialised its local quota state
 * to `at.allotments || activeAgency?.allotments` - the AGENCY's fallback map - and the first "Add letter" save wrote
 * that inherited map onto the AT along with the increment. ADMIN's AT map is its agency map exactly (35/30/10), under
 * a different division name. Every function here therefore takes the AT's OWN stored map and returns it changed by
 * the delta: it never reads the agency, and never reconstructs.
 *
 * ⚠ THE FLOOR: a correction may not leave a quota below what is already booked against it. Deleting an AT refuses
 * when any job references it, because the jobs would be orphaned; that rule does not transfer here, since no job
 * references a letter and refusing on "any job exists" would make correction impossible on exactly the tenders that
 * need it. The analogue that protects something is per division and core type - and it names both figures, because
 * "cannot delete" without the numbers leaves the operator guessing what to do next.
 */

import { isScrapJob } from './scrapState';
import { isOverhauledJob } from './inspectionCondition';

export interface AllotmentLetter {
  id: string;
  date: string;
  letterNo: string;
  division: string;
  coreType: string;
  quantity: number;
  addedAt?: number;
}

/** division -> coreType -> cumulative quota. */
export type QuotaMap = Record<string, Record<string, number>>;

export interface QuotaJob {
  /** Needed to match an inspection that declares this job scrap - see `drawsOnAllotment`. */
  id?: string;
  division?: string;
  coreType?: string;
  repairType?: string;
  condition?: string;
  status?: string;
  agencyId?: string;
}

/**
 * WHETHER A JOB DRAWS ON AN ALLOTMENT - the one definition, so no two screens can disagree.
 *
 * ⚠ THIS EXISTS BECAUSE THEY DID (AUDIT G72). New Job excluded GP rework and Overhauling; the Dashboard widget
 * excluded only Overhauling, and counted GP jobs as quota used. MEGHA's SABARMATI/CRGO row read 21 used at intake and
 * 25 on the Dashboard - one quantity, two counts, the shape this audit keeps finding. New Job's rule is the correct
 * one: a guarantee repair is rework on a job the quota already paid for.
 *
 * ⚠⚠ AND G72's CLAIM TO BE "the one definition" WAS NOT TRUE UNTIL G115. Two of the three count sites
 * imported this. The third - `NewJob`, the one that BLOCKS an intake - re-implemented it inline:
 *
 *       if (data.repairType === 'OH' || data.repairType === 'GP') return;
 *       const docType = data.coreType || 'CRGO';
 *       if (docType === 'OH') return;
 *
 * A hand-rolled copy in the enforcement path is worse than one in a display, because the direction of the
 * disagreement is "the screen says allowed and the save refuses". All three sites now call this.
 *
 * ⚠⚠ WHAT THE ALLOTMENT ACTUALLY MEASURES IS JOBS THE AGENCY REPAIRED (AUDIT G115), from the operator:
 *
 *   > "IF REPAIRER AGANCIES GET 10 NO OF JOB FROM SU-1 TO SU-10 AND GOUND 2 NOS OF JO SU-9 AND SU-10 'OH' ...
 *   >  FURTHER JOB NO WIL CONTINUE FROM SU-11 ... THEN AGANCIES GET 2 MORE JOB FOR REPAIRE AGAINST 'OH' JOB
 *   >  ... SO TOTAL ALLOTMENT FOR CRGO JOB IS 10 NOS AND AGANCIES JOB NO UPTO 13"
 *
 * A unit the agency did not repair - because it was overhauled or scrapped - consumed none of the quota. So a
 * 10-unit allotment legitimately carries job numbers up to `SU-13`: ten repaired, two OH, one scrap. Job numbers
 * are never reused, renumbered or backfilled; the series simply continues.
 *
 * ⚠ THE SCRAP TEST IS `scrapState`'s, NOT A FOURTH ONE. O80 found four disagreeing scrap tests spanning more
 * than half the population, and the narrow ones each miss a real scrapped unit: six of the 36 live scrap jobs are
 * findable only by `status`, and `ASU-2` is scrap ONLY in its internal inspection, with an empty `condition` on the
 * job. That is why `inspections` is a parameter rather than something a caller may omit - a count that quietly
 * used the narrow test would overstate usage by exactly the units the rule is about.
 *
 * ⚠ A REPLACEMENT JOB DRAWS NORMALLY. `issuedAgainstJobId` records WHY the series ran past the quota; it does
 * not exempt. The replacement is work the agency did do, and it takes the slot the OH or scrap unit left. That is
 * what keeps the arithmetic closed: ten drawing jobs against a quota of ten, whatever the highest job number is.
 */
export function drawsOnAllotment(job: QuotaJob, inspections: readonly any[] = []): boolean {
  // Guarantee rework: the quota already paid for the job being reworked.
  if (String(job.repairType || '') === 'GP') return false;

  /**
   * ⚠ THE SEPARATELY-ISSUED OVERHAULING MR - a DIFFERENT FACT from a unit declared overhauled, kept as its
   * own test. Such an MR carries no allotment at all (the owner's rule: "not 0 consumed, but not counted"), it
   * prices on Schedule-A sr 21, and six agencies have prefixes configured for it.
   */
  if (String(job.coreType || 'CRGO') === 'OH') return false;

  /**
   * ⚠⚠ THREE ARMS, NOT `repairType` ALONE (AUDIT G122). This line used to be `repair === 'OH'`, which
   * read one of the three places a declaration lives - and missing one is exactly the defect O80 found for
   * scrap, where ASU-2's declaration survives only in its inspection. Understating here makes an overhauled
   * unit consume quota it did not earn, so the agency silently loses a job it was entitled to.
   */
  if (isOverhauledJob(job, inspections)) return false;

  return !isScrapJob(job, inspections as any[]);
}

/**
 * WHICH DIVISION, CORE TYPE AND AGENCY A BOOKED COUNT IS FOR.
 *
 * ⚠⚠ `agencyId` IS REQUIRED, AND THAT IS THE FIX RATHER THAN A TIDY-UP (AUDIT G116). All three count
 * sites scoped their query by `ownerId` + `atId` and nothing else. An owner's two agencies on one tender
 * therefore counted against each other's quota, and one live job proves it: AARATI's `MSBT-5` carries MEGHA's AT
 * (the G107 mis-stamp), so MEGHA's SABARMATI/CRGO read 21 of 30 with the 21st belonging to another agency.
 *
 * Required rather than optional, so tsc names every call site instead of letting one silently keep the old scope.
 */
export interface BookedScope {
  division: string;
  coreType: string;
  agencyId: string;
  /** Internal inspections, for the scrap declarations that never reached the job - see `drawsOnAllotment`. */
  inspections?: readonly any[];
}

/** How many of `jobs` are booked against one division, core type and agency. Jobs must already be scoped to the AT. */
export function bookedFor(jobs: readonly QuotaJob[], scope: BookedScope): number {
  const agency = String(scope.agencyId ?? '');
  return jobs.filter(j => drawsOnAllotment(j, scope.inspections)
    && String(j.division || '') === scope.division
    && String(j.coreType || 'CRGO') === scope.coreType
    && String(j.agencyId ?? '') === agency).length;
}

/** What this division and core's letters add up to. NOT the quota - see the header. */
export function lettersTotal(history: AllotmentLetter[], division: string, coreType: string): number {
  return history
    .filter(r => r.division === division && r.coreType === coreType)
    .reduce((n, r) => n + (Number(r.quantity) || 0), 0);
}

export function quotaFor(allotments: QuotaMap, division: string, coreType: string): number {
  return Number(allotments?.[division]?.[coreType] || 0);
}

/** The map with one division/core changed by `delta`. A copy - the caller's map is never mutated. */
function withDelta(allotments: QuotaMap, division: string, coreType: string, delta: number): QuotaMap {
  const next: QuotaMap = {};
  for (const [div, byCore] of Object.entries(allotments || {})) next[div] = { ...byCore };
  if (!next[division]) next[division] = {};
  next[division][coreType] = quotaFor(allotments, division, coreType) + delta;
  return next;
}

export type Correction =
  | { ok: true; allotmentHistory: AllotmentLetter[]; allotments: QuotaMap; summary: string }
  | { ok: false; reason: string };

export interface LetterPatch {
  letterNo?: string;
  date?: string;
  division?: string;
  coreType?: string;
  quantity?: number;
}

/** What a booked figure looks up. Supplied by the caller so this file reads no database. */
export type BookedLookup = (division: string, coreType: string) => number;

function refuseBelowBooked(division: string, coreType: string, resulting: number, booked: number): string {
  return `That would leave the ${coreType} quota for ${division} at ${resulting}, but ${booked} `
    + `${booked === 1 ? 'job is' : 'jobs are'} already booked against it. `
    + `Reduce it to ${booked} or more, or cancel the jobs first.`;
}

function validate(letter: AllotmentLetter): string | null {
  if (!String(letter.letterNo || '').trim()) return 'A letter reference number is required.';
  if (!String(letter.date || '').trim()) return 'A letter date is required.';
  if (!String(letter.division || '').trim()) return 'A division is required.';
  if (!String(letter.coreType || '').trim()) return 'A core type is required.';
  const q = Number(letter.quantity);
  if (!Number.isFinite(q) || !Number.isInteger(q) || q < 1) return 'The quantity must be a whole number of 1 or more.';
  return null;
}

/**
 * CORRECT ONE LETTER. The quota moves by the DIFFERENCE this edit makes - see the header.
 *
 * Moving a letter to another division or core type removes its quantity from the old pair and adds it to the new one.
 * The floor is checked on the pair that LOSES quota; the pair that gains cannot fall below anything.
 */
export function editLetter(args: {
  history: AllotmentLetter[];
  allotments: QuotaMap;
  id: string;
  patch: LetterPatch;
  booked: BookedLookup;
}): Correction {
  const { history, allotments, id, patch, booked } = args;
  const index = history.findIndex(r => r.id === id);
  if (index < 0) return { ok: false, reason: 'That allotment letter is no longer in the list. Reload and try again.' };

  const before = history[index];
  const after: AllotmentLetter = {
    ...before,
    letterNo: patch.letterNo !== undefined ? String(patch.letterNo).trim() : before.letterNo,
    date: patch.date !== undefined ? String(patch.date) : before.date,
    division: patch.division !== undefined ? String(patch.division) : before.division,
    coreType: patch.coreType !== undefined ? String(patch.coreType) : before.coreType,
    quantity: patch.quantity !== undefined ? Number(patch.quantity) : Number(before.quantity),
  };

  const invalid = validate(after);
  if (invalid) return { ok: false, reason: invalid };

  const moved = after.division !== before.division || after.coreType !== before.coreType;
  const oldQty = Number(before.quantity) || 0;
  let allotmentsNext: QuotaMap;

  if (!moved) {
    const delta = after.quantity - oldQty;
    if (delta === 0 && after.letterNo === before.letterNo && after.date === before.date) {
      return { ok: false, reason: 'Nothing was changed.' };
    }
    const resulting = quotaFor(allotments, after.division, after.coreType) + delta;
    if (resulting < 0) {
      return { ok: false, reason: `The stored ${after.coreType} quota for ${after.division} is lower than this letter, so this edit cannot be applied to it. Report this - the quota and the letters disagree.` };
    }
    const isBooked = booked(after.division, after.coreType);
    if (resulting < isBooked) return { ok: false, reason: refuseBelowBooked(after.division, after.coreType, resulting, isBooked) };
    allotmentsNext = withDelta(allotments, after.division, after.coreType, delta);
  } else {
    // The old pair loses the whole letter; the new pair gains the new quantity.
    const resultingOld = quotaFor(allotments, before.division, before.coreType) - oldQty;
    if (resultingOld < 0) {
      return { ok: false, reason: `The stored ${before.coreType} quota for ${before.division} is lower than this letter, so it cannot be moved. Report this - the quota and the letters disagree.` };
    }
    const bookedOld = booked(before.division, before.coreType);
    if (resultingOld < bookedOld) return { ok: false, reason: refuseBelowBooked(before.division, before.coreType, resultingOld, bookedOld) };
    allotmentsNext = withDelta(allotments, before.division, before.coreType, -oldQty);
    allotmentsNext = withDelta(allotmentsNext, after.division, after.coreType, after.quantity);
  }

  const historyNext = history.slice();
  historyNext[index] = after;

  const parts: string[] = [];
  if (after.letterNo !== before.letterNo) parts.push(`letter ${before.letterNo} -> ${after.letterNo}`);
  if (after.date !== before.date) parts.push(`date ${before.date} -> ${after.date}`);
  if (moved) parts.push(`${before.division}/${before.coreType} -> ${after.division}/${after.coreType}`);
  if (after.quantity !== oldQty) parts.push(`quantity ${oldQty} -> ${after.quantity}`);

  return { ok: true, allotmentHistory: historyNext, allotments: allotmentsNext, summary: parts.join(', ') };
}

/** REMOVE ONE LETTER - for a quota recorded against the wrong division, which correcting cannot fix. */
export function deleteLetter(args: {
  history: AllotmentLetter[];
  allotments: QuotaMap;
  id: string;
  booked: BookedLookup;
}): Correction {
  const { history, allotments, id, booked } = args;
  const index = history.findIndex(r => r.id === id);
  if (index < 0) return { ok: false, reason: 'That allotment letter is no longer in the list. Reload and try again.' };

  const letter = history[index];
  const qty = Number(letter.quantity) || 0;
  const resulting = quotaFor(allotments, letter.division, letter.coreType) - qty;
  if (resulting < 0) {
    return { ok: false, reason: `The stored ${letter.coreType} quota for ${letter.division} is lower than this letter, so removing it cannot be applied. Report this - the quota and the letters disagree.` };
  }
  const isBooked = booked(letter.division, letter.coreType);
  if (resulting < isBooked) return { ok: false, reason: refuseBelowBooked(letter.division, letter.coreType, resulting, isBooked) };

  const historyNext = history.slice();
  historyNext.splice(index, 1);
  return {
    ok: true,
    allotmentHistory: historyNext,
    allotments: withDelta(allotments, letter.division, letter.coreType, -qty),
    summary: `removed ${letter.letterNo} (${letter.division}/${letter.coreType}, -${qty})`,
  };
}
