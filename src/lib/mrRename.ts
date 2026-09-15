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
 * ⚠ AN OIL ROW WHOSE MR CARRIES NO JOBS IS NORMAL BUSINESS, AND THIS FILE USED TO SAY OTHERWISE (AUDIT O78).
 *
 * The paragraph that stood here read: "either the receipt was entered against the wrong MR or the jobs were booked
 * under a different one, and only the agency's paper says which." It admitted exactly two explanations and left out
 * the true one - THE DIVISION RAISES AN MR FOR OIL ISSUE ALONE, WITH NO TRANSFORMERS ON IT. MR 5585 with 2,110
 * litres was cited here as the evidence of a fault; it is a correctly recorded oil-only MR.
 *
 * The premise was never stated as a claim to be checked, and the data contradicted it from the first day: the
 * detector fired on 100% of live oil, 2 receipts of 2, and that was written down as a check that had been run
 * rather than read as evidence about the check. `unmatchedOilRows` and its 'no-jobs' reason are gone with it.
 *
 * ⚠ WHAT REMAINS IS A DIFFERENT QUESTION. A receipt naming NO MR at all is still worth finding - not because the
 * division issues against some other reference (it does not; an oil row carries no challan, letter or order
 * number) but because `computeOilBalance` SKIPS a row with a blank `mrNo`, so its litres drop out of the figure
 * the DISCOM is settled against while still showing in the register's own sub-total.
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

/**
 * OIL ROWS ALREADY CARRYING THE NEW NUMBER — the other half of a collision (AUDIT O78).
 *
 * ⚠ `collisionJobs` ANSWERS FOR JOBS ONLY, AND THAT WAS SUFFICIENT ONLY WHILE AN MR WITH NO TRANSFORMERS COULD
 * NOT BE OPENED. The division raises MRs for oil issue alone; once the register lists them and Full Edit can
 * rename one, renaming it onto a number another oil-only MR holds would fold two oil groups into one, with
 * nothing afterwards able to say which litres came from which. That is precisely the merge G74 exists to refuse,
 * reached through a door G74 never had to consider.
 *
 * ⚠ NO EXTRA READ. The rename already fetches the agency's oil to find the rows that must MOVE; this filters the
 * same snapshot for the rows that would be MERGED INTO.
 */
export function collisionOilRows(args: {
  newMrNo: string;
  agencyId: string;
  transactions: OilRowLike[];
  /** Ids of the oil rows moving with this rename - they are never a collision with themselves. */
  movingOilIds: string[];
}): OilRowLike[] {
  const { newMrNo, agencyId, transactions, movingOilIds } = args;
  const moving = new Set(movingOilIds.filter(Boolean));
  return transactions.filter(t =>
    sameMr(t.mrNo, newMrNo)
    && String(t.agencyId ?? '') === agencyId
    && !moving.has(String(t.id ?? '')));
}

/** The oil rows that must move with a rename. Scoped to the agency, for the same reason. */
export function oilRowsForMr(mrNo: string, agencyId: string, transactions: OilRowLike[]): OilRowLike[] {
  return transactions.filter(t => sameMr(t.mrNo, mrNo) && String(t.agencyId ?? '') === agencyId);
}

/**
 * OIL RECEIPTS NAMING NO MR AT ALL — which the balance silently drops (AUDIT O78).
 *
 * ⚠ THIS DELIBERATELY DOES NOT LOOK AT JOBS. Its predecessor did, and reported every receipt whose MR carried no
 * transformers as a fault; the division raises MRs for oil alone, so that flagged correct data 100% of the time.
 * The `jobs` parameter went with the rule - a function that still accepted it would invite the join back.
 *
 * ⚠ WHY A BLANK NUMBER IS STILL WORTH FINDING. `computeOilBalance` skips a row with no `mrNo` (oilBalance.ts:191),
 * and so does the MR-wise summary (OilInward) - so the litres vanish from the Dashboard, the printed statement,
 * the closing offer and the carried opening balance, while the transactions tab still shows them. One screen, two
 * received totals, and the difference is invisible.
 *
 * ⚠ THE REACHABLE CASE IS WHITESPACE, NOT EMPTY. An empty `mrNo` is refused twice - the form's `required` and
 * `firestore.rules` `size() >= 1`. A rule cannot trim, and nothing in the form does, so `" "` passes end-to-end
 * and every consumer that trims then reads it as blank. That is what the trim below catches.
 */
export function oilRowsMissingMrNumber(transactions: OilRowLike[], agencyId?: string): OilRowLike[] {
  return transactions.filter(tx =>
    (agencyId === undefined || String(tx.agencyId ?? '') === agencyId)
    && !String(tx.mrNo ?? '').trim());
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
