/**
 * WHICH MR ROW AN OIL RECEIPT BELONGS ON - BY IDENTIFIER, NOT BY MR NUMBER (AUDIT G124).
 *
 * ⚠⚠ THE JOIN USED TO BE `summary[tx.mrNo]`, AND THE TWO SIDES WERE SCOPED DIFFERENTLY. In
 * `BillingSystem`, `jobs` is agency AND tender scoped (`matchesAtScope`); `oilTransactions` is `agencyOil`,
 * agency scoped only. So a tender-scoped job list was joined to an unscoped oil list on a human-facing string -
 * and every live transaction carries `atId`, while seven of ten carry `jobId`. The identifiers were on both
 * sides and the code keyed on the number anyway.
 *
 * The consequence was measured, not theorised: MEGHA's 420 L receipt on `AT 26-27` appeared on the statement
 * for MEGHA's 1819 tender as well, and ADMIN's 2,110 L appeared on BOTH of ADMIN's statements. Oil counted
 * twice, each time in the agency's favour, on a page the division reconciles.
 *
 * THE ORDER, STRONGEST FIRST:
 *
 *   1. `jobId`       the receipt names a job. If that job is in scope, its `mrNo` is the row - the receipt
 *                    cannot be misplaced, whatever either MR number says.
 *   2. `atId`+`mrNo` no job reference, but the tender is known. Included only when the tender matches the one
 *                    being viewed - the asymmetry this removes.
 *   3. `mrNo` alone  neither identifier present. Included, and MARKED.
 *   4. unplaced      nothing can place it. Kept in its own group, never dropped.
 *
 * ⚠⚠ RULE 3 MUST NEVER BE SILENT, and rule 4 must never drop litres. A receipt included on the strength of a
 * string is a claim the app cannot stand behind; and oil vanishing from a statement that is settled against is
 * worse than oil shown as unplaced. 0 litres going missing quietly is the worse failure.
 *
 * ⚠⚠ AND A BROKEN REFERENCE IS NOT DEMOTED TO A WEAKER JOIN. An `atId` that resolves to no `atMasters`
 * document goes to `at-missing` - never to the `mrNo`-only path. Falling back would be the
 * sentinel-disables-a-check pattern wearing a different hat: the strong identifier is present and broken, and
 * treating "present but unresolvable" as "absent" would let a dangling reference buy a weaker join and then
 * pass as an ordinary string match. One live receipt is in exactly that state (ADMIN MR 5585, `atId`
 * `NpJKH9fZpMoijypO1GZr`, no such document) and it is worth Rs 260,386.50 of deduction.
 *
 * No React, no Firebase - so it is reachable from src/ AND from scripts/admin/ under tsx.
 */

const norm = (v: unknown): string => String(v ?? '').trim();

/** How a receipt was placed. `mrNo-only` is the one that must show on the page. */
export type OilPlacedBy = 'jobId' | 'atId+mrNo' | 'mrNo-only';

/** Why a receipt could not be placed. Each phrase is printed verbatim, so each must be true. */
export type OilUnplacedReason = 'job-out-of-scope' | 'other-tender' | 'at-missing' | 'no-identifiers';

export const OIL_UNPLACED_TEXT: Record<OilUnplacedReason, string> = {
  'job-out-of-scope': 'names a job that is not on this tender',
  'other-tender': 'belongs to another tender',
  /**
   * ⚠ ITS OWN REASON, NOT "another tender". The tender does not exist, which is a different fact and a
   * different action: another tender is a filing question, a missing one is a broken reference someone has to
   * repair before the litres can land anywhere.
   */
  'at-missing': 'belongs to a tender that no longer exists',
  'no-identifiers': 'has no job, tender or MR reference',
};

export type OilPlacement =
  | {
      placed: true;
      mrNo: string;
      by: OilPlacedBy;
      /**
       * ⚠ TRUE WHEN THE MR HAS NO TRANSFORMERS BEHIND IT (AUDIT G124). The receipt is placed - the tender
       * reference is sound - but the MR it names carries no jobs on this statement, so the litres sit against
       * nothing. ADMIN's MR 5585 is exactly that: 2,110 L of fresh oil against an MR no transformer was ever
       * entered under.
       *
       * It is NOT a reason to exclude the receipt. The oil arrived and the division issued it; what is open is
       * which work it was issued FOR. So it is placed, counted, and MARKED - the same principle as the four
       * unplaced phrases: the sheet states what it knows and what it does not.
       */
      mrHasNoJobs: boolean;
    }
  | { placed: false; reason: OilUnplacedReason };

export interface OilTx {
  jobId?: unknown;
  atId?: unknown;
  mrNo?: unknown;
}

export interface OilScope {
  /** The jobs on the statement - already agency and tender scoped by the caller. */
  scopedJobs: ReadonlyArray<{ id?: unknown; mrNo?: unknown }>;
  /** The tender being viewed, or '' when viewing all tenders. */
  atId: string;
  viewingAllTenders: boolean;
  /** Every tender id the account holds, so a dangling `atId` can be told from a foreign one. */
  knownAtIds: ReadonlySet<string>;
}

/** Does any job on this statement sit under that MR? */
function mrHasJobs(mrNo: string, scope: OilScope): boolean {
  return scope.scopedJobs.some(j => norm(j.mrNo) === mrNo);
}

export function placeOilTransaction(tx: OilTx, scope: OilScope): OilPlacement {
  const jobId = norm(tx?.jobId);
  if (jobId) {
    const job = scope.scopedJobs.find(j => norm(j.id) === jobId);
    /**
     * ⚠ NOT FOUND MEANS OUT OF SCOPE, NOT "fall back to the number". Falling back here would reintroduce
     * exactly the cross-tender leak the `jobId` exists to prevent.
     */
    // ⚠ A jobId placement can never have "no jobs" - the job IS the evidence.
    return job
      ? { placed: true, mrNo: norm(job.mrNo), by: 'jobId', mrHasNoJobs: false }
      : { placed: false, reason: 'job-out-of-scope' };
  }

  const mrNo = norm(tx?.mrNo);
  const atId = norm(tx?.atId);

  if (atId) {
    // The broken reference is named as broken - see the note at the top of this file.
    if (!scope.knownAtIds.has(atId)) return { placed: false, reason: 'at-missing' };
    const inScope = scope.viewingAllTenders || atId === scope.atId;
    if (!inScope) return { placed: false, reason: 'other-tender' };
    if (!mrNo) return { placed: false, reason: 'no-identifiers' };
    return { placed: true, mrNo, by: 'atId+mrNo', mrHasNoJobs: !mrHasJobs(mrNo, scope) };
  }

  if (!mrNo) return { placed: false, reason: 'no-identifiers' };
  return { placed: true, mrNo, by: 'mrNo-only', mrHasNoJobs: !mrHasJobs(mrNo, scope) };
}
