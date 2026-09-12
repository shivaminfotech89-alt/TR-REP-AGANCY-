/**
 * RENAMING AN MR, AND THE RECORDS THAT DO NOT FOLLOW BY THEMSELVES (AUDIT G74).
 *
 * There is no MR document. An MR is a GROUPING OF JOBS SHARING AN `mrNo` STRING - so renaming one means writing the
 * new number onto every job in the group, which `handleSaveFullMr` does. Two things do not follow from that, and
 * both are silent:
 *
 * ⚠ 1. OIL TRANSACTIONS ARE NOT JOBS. `oilTransactions` is its own collection carrying its own `mrNo` field, and it
 *      is matched to an MR by plain string equality - `getMrDateIso` and `computeOilBalance` both do exactly that.
 *      Rename the jobs and the oil row keeps the old number: the litres the division issued detach from the MR, the
 *      balance stops pairing shortage against receipt, and nothing anywhere says so. A rename that silently detaches
 *      a record of received oil is a data-detaching operation, so the rename moves them in the same batch.
 *
 * ⚠ 2. NOTHING REFUSED A MERGE. Renaming MR 1234 to 5555 where 5555 already has jobs silently folded two MRs into
 *      one - they regroup by string on the next fetch, with no record of which jobs came from which. New Job checks
 *      for a duplicate MR at intake; the rename had no such check.
 *
 * ⚠ AND AN OIL ROW CAN MATCH NO MR AT ALL. Measured 2026-09-12: the single live oil transaction is MR 5585, 2,110
 * litres, DEESA - and no job anywhere carries that number. That is not a bug to fix in code: either the receipt was
 * entered against the wrong MR or the jobs were booked under a different one, and only the agency's paper says which.
 * It is surfaced on the Oil Account so an operator sees it, rather than being found by a census.
 */

export interface RenameJobLike {
  id?: string;
  mrNo?: string;
  agencyId?: string;
  jobNo?: string;
  division?: string;
  status?: string;
  isCancelled?: boolean;
  mrStatus?: string;
}

export interface OilRowLike {
  id?: string;
  mrNo?: string;
  agencyId?: string;
  division?: string;
  netLiters?: number;
  mrDate?: string;
}

/** The same test the ledger and New Job use: a cancelled job holds its number but claims nothing. */
export function isCancelledJob(job: RenameJobLike): boolean {
  return job.status === 'Cancelled' || job.isCancelled === true || job.mrStatus === 'Cancelled';
}

const sameMr = (a: unknown, b: unknown) => String(a ?? '').trim() === String(b ?? '').trim();

/**
 * JOBS THAT ALREADY CARRY THE NEW NUMBER, and are not the ones being renamed.
 *
 * Scoped to the agency, because an MR number is the division's and two agencies may legitimately hold the same one.
 * Cancelled jobs are ignored - their numbers are released for reuse, which is what cancelling is for.
 */
export function collisionJobs(args: {
  newMrNo: string;
  agencyId: string;
  jobs: RenameJobLike[];
  /** Ids of the jobs being renamed - the group itself is never a collision with itself. */
  movingJobIds: string[];
}): RenameJobLike[] {
  const { newMrNo, agencyId, jobs, movingJobIds } = args;
  const moving = new Set(movingJobIds.filter(Boolean));
  return jobs.filter(j =>
    sameMr(j.mrNo, newMrNo)
    && String(j.agencyId ?? '') === agencyId
    && !moving.has(String(j.id ?? ''))
    && !isCancelledJob(j));
}

/** The oil rows that must move with a rename. Scoped to the agency, for the same reason. */
export function oilRowsForMr(mrNo: string, agencyId: string, transactions: OilRowLike[]): OilRowLike[] {
  return transactions.filter(t => sameMr(t.mrNo, mrNo) && String(t.agencyId ?? '') === agencyId);
}

export type UnmatchedReason = 'no-mr-number' | 'no-jobs';

export interface UnmatchedOil {
  tx: OilRowLike;
  reason: UnmatchedReason;
}

/**
 * OIL RECEIVED AGAINST AN MR THE APP CANNOT FIND.
 *
 * ⚠ A CANCELLED MR STILL COUNTS AS MATCHED. Its jobs exist and carry the number; the receipt belongs to it whatever
 * became of the work. Only "no job carries this number at all" is unmatched - that is the case nobody can explain
 * from inside the app.
 */
export function unmatchedOilRows(transactions: OilRowLike[], jobs: RenameJobLike[], agencyId?: string): UnmatchedOil[] {
  const scoped = (t: OilRowLike) => agencyId === undefined || String(t.agencyId ?? '') === agencyId;
  const numbers = new Set(
    jobs
      .filter(j => agencyId === undefined || String(j.agencyId ?? '') === agencyId)
      .map(j => String(j.mrNo ?? '').trim())
      .filter(Boolean));
  const out: UnmatchedOil[] = [];
  for (const tx of transactions) {
    if (!scoped(tx)) continue;
    const n = String(tx.mrNo ?? '').trim();
    if (!n) { out.push({ tx, reason: 'no-mr-number' }); continue; }
    if (!numbers.has(n)) out.push({ tx, reason: 'no-jobs' });
  }
  return out;
}

/** Litres across a set of oil rows, for a sentence that has to state the quantity. */
export function litresOf(rows: OilRowLike[]): number {
  return rows.reduce((n, t) => n + (Number(t.netLiters) || 0), 0);
}

/** What a rename is about to do, in one sentence an operator can check against the screen. */
export function describeRename(args: {
  fromMrNo: string;
  toMrNo: string;
  jobCount: number;
  oilRows: OilRowLike[];
}): string {
  const { fromMrNo, toMrNo, jobCount, oilRows } = args;
  const litres = litresOf(oilRows);
  const oilPart = oilRows.length === 0
    ? 'No oil record carries this MR number.'
    : `${oilRows.length} oil record${oilRows.length === 1 ? '' : 's'} (${litres.toLocaleString('en-IN')} litres) `
      + `will be renumbered with it, so the oil stays attached to this MR.`;
  return `Rename MR ${fromMrNo} to ${toMrNo}?\n\n`
    + `${jobCount} transformer${jobCount === 1 ? '' : 's'} will carry the new number. ${oilPart}`;
}
