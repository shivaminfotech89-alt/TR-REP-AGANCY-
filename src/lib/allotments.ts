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
  division?: string;
  coreType?: string;
  repairType?: string;
}

/**
 * WHETHER A JOB DRAWS ON AN ALLOTMENT - the one definition, so two screens cannot disagree.
 *
 * ⚠ THIS EXISTS BECAUSE THEY DID (AUDIT G72). New Job excluded GP rework and Overhauling; the Dashboard widget
 * excluded only Overhauling, and counted GP jobs as quota used. MEGHA's SABARMATI/CRGO row read 21 used at intake and
 * 25 on the Dashboard - one quantity, two counts, the shape this audit keeps finding. New Job's rule is the correct
 * one: a guarantee repair is rework on a job the quota already paid for.
 */
export function drawsOnAllotment(job: QuotaJob): boolean {
  const core = String(job.coreType || 'CRGO');
  const repair = String(job.repairType || '');
  if (repair === 'GP' || repair === 'OH') return false;
  return core !== 'OH';
}

/** How many of `jobs` are booked against one division and core type. Jobs must already be scoped to the AT. */
export function bookedFor(jobs: QuotaJob[], division: string, coreType: string): number {
  return jobs.filter(j => drawsOnAllotment(j)
    && String(j.division || '') === division
    && String(j.coreType || 'CRGO') === coreType).length;
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
