/**
 * WHICH NUMBER TO OFFER NEXT - ONE ANSWER, FOR THE PREFILL AND FOR THE CLASH OFFER (AUDIT G107).
 *
 * ⚠ THERE WERE TWO, AND THEY DISAGREED EXACTLY AT THE TENDER BOUNDARY.
 *
 *   - the **prefill** (`getAutoJobNo`) took the highest number already carrying this prefix anywhere in the agency,
 *     ignoring the tender entirely;
 *   - the **clash offer** read the AT's `lastJobNumbers` counter.
 *
 * On an established tender they agree. On the first MR of a NEW tender the counter is at its own starting number -
 * 0, or whatever O89 seeded - while the agency maximum sits wherever the previous tender left it. ADMIN's new AT
 * would have been prefilled `SU-25` and offered `SU-1` on a clash, with `SU-1`...`SU-24` already issued.
 *
 * ⚠⚠ AND O89'S RULE CANNOT BE DELIVERED BY THE COUNTER ALONE, WHICH IS WHY THIS SKIPS.
 *
 * O89 made a new tender start its own series, defaulting to 1. Where the new tender REUSES the division's prefix
 * that number is already taken: MEGHA's MSBT-1 exists twice and both copies carry a challan number and date. O89
 * names the duplicate guard as what catches a collision now - but the collision its own rule produces is the one the
 * guard forbids, and the guard is agency-wide (`agencyId` only, no `atId`). So a prefill that offered `MSBT-1` would
 * offer a number that cannot be saved, and the clash offer - counter-based too - would offer it again: a refusal
 * loop at the boundary.
 *
 * So the counter decides where to START, and anything already in use is skipped. The tender's own series is honoured
 * wherever the prefix leaves room for it, and a number on an issued challan is never offered. Where the prefix is
 * shared the result lands back at the agency maximum, which is what the prefill already did - **O89's rule is then
 * honoured only because the prefix differs, and nothing yet requires that it does.** Making the prefix per tender a
 * precondition of creating an AT is the remaining half, recorded as the next change rather than assumed here.
 */

/** Trailing number of a job number under `prefix`, or 0 if it is not one of them. */
export function jobNumberTail(jobNo: unknown, prefix: string): number {
  const head = `${String(prefix).toUpperCase()}-`;
  const raw = String(jobNo ?? '').trim().toUpperCase();
  if (!raw.startsWith(head)) return 0;
  const n = parseInt(raw.slice(head.length), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** True for a job whose number is spoken for. Cancelled jobs are excluded - their numbers are freed for reuse. */
function holdsANumber(job: any): boolean {
  if (job?.status === 'Cancelled' || job?.isCancelled || job?.mrStatus === 'Cancelled') return false;
  // GP repairs reuse the original number from a previous repair, so they do not reserve one of their own.
  if (String(job?.repairType ?? '').toUpperCase() === 'GP' || job?.isGp) return false;
  return true;
}

/**
 * Every trailing number under `prefix` that is already spoken for, across the agency.
 *
 * ⚠ AGENCY-WIDE, BECAUSE THE DUPLICATE GUARD IS. A per-tender set would offer numbers the save then refuses, which
 * is the disagreement this module exists to end. If job numbers ever become unique per tender rather than per agency,
 * this is the one place that changes - and the guard in NewJob has to change with it, in the same commit.
 */
export function takenJobNumbers(jobs: readonly any[], prefix: string): Set<number> {
  const taken = new Set<number>();
  if (!prefix) return taken;
  for (const job of jobs) {
    if (!holdsANumber(job)) continue;
    const n = jobNumberTail(job?.jobNo, prefix);
    if (n > 0) taken.add(n);
  }
  return taken;
}

/**
 * The `skip + 1`-th free number at or after `lastUsed + 1`.
 *
 * `lastUsed` is the tender's counter - `lastJobNumbers` holds the LAST USED number, so the first candidate is one
 * past it. `skip` lets a multi-row intake allocate down the rows without any row offering a number an earlier row
 * has already been given.
 *
 * ⚠ IT ALWAYS RETURNS A NUMBER. A bounded walk, because an unbounded one over a corrupt `taken` set would hang the
 * screen that is only trying to suggest something. Past the bound it returns the next candidate even if taken - the
 * duplicate guard at save is what must refuse a collision, and a suggestion that is wrong is recoverable where a
 * frozen intake form is not.
 */
export function nextFreeJobNumber(lastUsed: number, taken: ReadonlySet<number>, skip = 0): number {
  const start = Math.max(0, Math.floor(Number(lastUsed) || 0)) + 1;
  const wanted = Math.max(0, Math.floor(Number(skip) || 0));
  let found = -1;
  let seen = 0;
  const limit = start + taken.size + wanted + 1000;
  for (let n = start; n <= limit; n++) {
    if (taken.has(n)) continue;
    if (seen === wanted) { found = n; break; }
    seen += 1;
  }
  return found > 0 ? found : start + wanted;
}

/** The number to offer, as the operator sees it. Empty when there is no prefix to build one from. */
export function nextJobNoFor(
  prefix: string | null | undefined,
  lastUsed: number,
  taken: ReadonlySet<number>,
  skip = 0,
): string {
  if (!prefix) return '';
  return `${prefix}-${nextFreeJobNumber(lastUsed, taken, skip)}`;
}
