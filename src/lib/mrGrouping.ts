/**
 * AN MR'S JOBS, GROUPED AND ORDERED - ONE DEFINITION (AUDIT G104).
 *
 * Every surface that lists the transformers of one MR has to agree about which job is first, because operators
 * reconcile them against each other: the multi-job estimate sheet reads its COLUMNS from this order, the covering
 * forwarding letter reads its ROWS from it, and the MR register prints a sequence number beside each job.
 *
 * ⚠ WHAT WENT WRONG WITHOUT IT. Two screens grouped jobs by MR with their own inline loops and neither sorted. The
 * job list comes from a Firestore query with NO `orderBy`, so the order is simply UNSPECIFIED - whatever the read
 * hands back. Measured against the live database on 2026-10-01 it is **not** ascending document-id order either (a
 * first pass here asserted that it was, from a JS string sort standing in for Firestore's, and the real read
 * disproved it); it is an order nothing in the app chooses and nothing an operator can predict. It differed from
 * job-number order in 18 of the 20 MRs with more than one job. The estimate's letter and Excel export sorted; the
 * sheet they cover did not, so row 3 of the letter and column 3 of the sheet were different transformers in the same
 * envelope.
 *
 * ⚠ NOT `jobNoSequence`, WHICH LOOKS LIKE THE RIGHT PARSER AND IS NOT. It takes the integer after the last dash and
 * DISCARDS THE PREFIX, so `AMSBT-1` and `MWSBT-1` both parse to 1 - two jobs of one MR with the same sort key, and the
 * order left arbitrary again. Three of the 42 live MRs collide that way: 85558 (`AMSBT-1`/`MWSBT-1`,
 * `AMSBT-2`/`MWSBT-2`), 1234 (`ASU-3`/`SU-3`, `OH21 IS-1`/`WSU-1`) and 3929 (`ZKAP-1`/`ZK-1`, `ZKAP-2`/`ZK-2`).
 * `jobNoSequence` is correct where it is used - a per-division, per-core high-water mark, where the prefix is exactly
 * what should be dropped - and is deliberately untouched.
 *
 * ⚠ AND IT IS IMPORTED BY print-check, NOT RE-IMPLEMENTED THERE. The harness used to substitute its own
 * `const mrGroups = { [mrNo]: jobs }`, which reproduced the defect faithfully and was blind to any fix of it: the
 * comparison reported "nothing changed on paper" for a change that reorders every column. A check that cannot see its
 * subject is the pattern this file opens with, and that was the first time it had applied to the print harness.
 */

/** Numeric-aware job-number order - the comparator every other surface in the app already uses. */
export const byJobNo = (a: { jobNo?: string | null }, b: { jobNo?: string | null }): number =>
  String(a?.jobNo ?? '').localeCompare(String(b?.jobNo ?? ''), undefined, { numeric: true });

/** The same list in job-number order. A new array; the input is not touched. */
export function sortJobsByNo<T extends { jobNo?: string | null }>(jobs: readonly T[]): T[] {
  return [...jobs].sort(byJobNo);
}

/**
 * Jobs grouped by `mrNo`, each group in job-number order. Jobs with no `mrNo` are left out, as every caller did.
 *
 * ⚠ THE ORDER OF THE GROUPS THEMSELVES IS NOT INSERTION ORDER, AND NEVER WAS. An MR number is a numeric string, and
 * a JavaScript object orders integer-like keys numerically ascending ahead of any other key - so `Object.keys` gives
 * MR 12 before MR 77 whichever was seen first. A first draft of this note claimed insertion order; a test disproved
 * it. The inline loops this replaces used a plain object keyed the same way, so **group order is unchanged** by the
 * extraction: only the order WITHIN a group is fixed here. Callers that care sort the groups themselves - the MR
 * register by date descending.
 */
export function groupJobsByMr<T extends { mrNo?: string | null; jobNo?: string | null }>(
  jobs: readonly T[],
): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const job of jobs) {
    const mr = job?.mrNo;
    if (!mr) continue;
    (groups[mr] ||= []).push(job);
  }
  for (const key of Object.keys(groups)) groups[key].sort(byJobNo);
  return groups;
}
