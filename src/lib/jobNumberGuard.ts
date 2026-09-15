/**
 * IS THIS JOB NUMBER FREE? — ONE DEFINITION, TWO INTAKE PATHS (AUDIT G92).
 *
 * A job number identifies one physical transformer. It may legitimately repeat in exactly ONE
 * case: the SAME unit returning under a new MR as a GP repair after failing within its guarantee
 * period. The test is the TRANSFORMER, not the repair type — serial number, make and capacity
 * must all match.
 *
 * ⚠ THIS EXISTS BECAUSE THERE WERE TWO INTAKE PATHS AND ONLY ONE GUARD. New Job has refused
 * duplicates since 2026-08-21 (AUDIT G92). MrLedger's Full Edit "add transformer" writes jobs
 * through the same collection and checked nothing — it validated that a job number was non-empty
 * and wrote it. So the rule was enforced at one door and not the other, which is the F87 shape
 * applied to a guard rather than to a number.
 *
 * The predicate lives here so the two doors cannot drift. A second copy is how a guard comes to
 * agree with its sibling only by coincidence.
 *
 * ⚠ CANCELLED JOBS DO NOT HOLD THEIR NUMBERS. A cancelled MR frees its numbers for reuse, so they
 * are excluded from the comparison — matching what New Job has always done.
 */

/** Compared as typed but matched case- and whitespace-insensitively. */
export const normKey = (v: unknown): string => String(v ?? '').trim().toUpperCase();

/** A job is still holding its number unless its MR or the job itself was cancelled. */
export function holdsItsNumber(job: any): boolean {
  return !(job?.status === 'Cancelled' || job?.isCancelled === true || job?.mrStatus === 'Cancelled');
}

/**
 * THE SAME PHYSICAL TRANSFORMER — serial, make and capacity, all three.
 *
 * ⚠ NOT THE REPAIR TYPE. A GP job and an OGP job can be the same unit; what makes a repeat
 * legitimate is that the metal is the same, not that someone typed 'GP'.
 */
export function isSameTransformer(a: any, b: any): boolean {
  return normKey(a?.serialNo) === normKey(b?.serialNo)
    && normKey(a?.make) === normKey(b?.make)
    && Number(a?.capacityKva) === Number(b?.capacityKva);
}

export interface JobNumberClash {
  /** The row being added, as the caller supplied it. */
  row: any;
  /** Live jobs already holding this number in the same agency. Never empty. */
  existing: any[];
  /** True when the row is a GP repair, which changes what the refusal may offer. */
  isGp: boolean;
}

/**
 * Which of `rows` carry a job number already held by a DIFFERENT transformer.
 *
 * `rows` are the entries being ADDED. `existingJobs` is the agency's jobs, read fresh by the
 * caller — see the call sites for why a cached list cannot answer this.
 *
 * A row clashes unless either no live job holds its number, or it is a GP repair and one of the
 * holders is the same physical transformer.
 */
export function jobNumberClashes(rows: any[], existingJobs: any[]): JobNumberClash[] {
  const byNumber: Record<string, any[]> = {};
  for (const job of existingJobs) {
    if (!holdsItsNumber(job)) continue;
    const key = normKey(job?.jobNo);
    if (key) (byNumber[key] ||= []).push(job);
  }

  const out: JobNumberClash[] = [];
  for (const row of rows) {
    const key = normKey(row?.jobNo);
    if (!key) continue;
    const existing = byNumber[key];
    if (!existing || existing.length === 0) continue;

    const isGp = normKey(row?.repairType) === 'GP';
    // The one legitimate repeat: this unit coming back under guarantee.
    if (isGp && existing.some(e => isSameTransformer(e, row))) continue;

    out.push({ row, existing, isGp });
  }
  return out;
}

/** One existing job, in the words an operator checks against the paperwork in front of them. */
export function describeHolder(job: any): string {
  return `MR ${job?.mrNo || '-'} — Serial ${job?.serialNo || '-'}, ${job?.capacityKva || '-'} KVA, Make ${job?.make || '-'}`;
}

/** The same number typed onto two rows of one save. Not offerable — see the caller. */
export function duplicateWithinBatch(rows: any[]): { first: number; second: number; jobNo: string } | null {
  const seen: Record<string, number> = {};
  for (let i = 0; i < rows.length; i++) {
    const key = normKey(rows[i]?.jobNo);
    if (!key) continue;
    if (seen[key] !== undefined) {
      return { first: seen[key], second: i, jobNo: String(rows[i]?.jobNo ?? '').trim() };
    }
    seen[key] = i;
  }
  return null;
}
