/**
 * "RECEIVED AGAINST OH SU-9" - WHY THE SERIES RUNS PAST THE QUOTA (AUDIT G115).
 *
 * A 10-unit CRGO allotment legitimately carries job numbers up to `SU-13`: ten repaired, two overhauled, one
 * scrapped. Nothing is renumbered and nothing is reused - the series just continues.
 *
 * ⚠ SO THE OVERRUN HAS TO BE EXPLAINED ON THE RECORD, NOT LEFT TO BE INFERRED. A count of 13 against a quota of
 * 10 with nothing recorded is indistinguishable from an over-allotment error. The division will ask, and the
 * agency has to be able to point at which two were OH and which one was scrap. The owner's decision, 2026-10-09:
 * unrecorded is not acceptable here.
 *
 *     issuedAgainstJobId    the OH or Scrap job this one replaces
 *     issuedAgainstReason   'OH' | 'Scrap' - WHICH, because the two are read differently by the division
 *
 * ⚠ BOTH OPTIONAL, AND ABSENT ON ALL 246 EXISTING JOBS. No migration: nothing to backfill, because no such
 * pairing exists yet. A replacement issued before this field existed is simply unexplained, and inventing a
 * pairing for it from job numbers and dates would be a guess written into the record as a fact.
 *
 * ⚠ THE REASON IS STORED RATHER THAN DERIVED, DELIBERATELY - and it is the one thing here that is. The
 * replaced job's condition can still move afterwards (OH -> Scrap is permitted), and this field records what
 * the replacement was issued FOR at the time it was issued. Deriving it later would silently rewrite the
 * agency's own account of why it took an eleventh job.
 *
 * ⚠ A REPLACEMENT DRAWS ON THE ALLOTMENT NORMALLY. See `drawsOnAllotment` - this marker explains the series,
 * it does not exempt anything. The replacement is work the agency did do.
 *
 * No React, no Firebase - so it is reachable from src/ AND from scripts/admin/ under tsx.
 */
import { isScrapJob } from './scrapState';
import { isOverhauledJob } from './inspectionCondition';
import { drawsOnAllotment } from './allotments';

export type ReplacementReason = 'OH' | 'Scrap';

/** The two fields, as they sit on a job. */
export interface ReplacementMarker {
  issuedAgainstJobId?: string | null;
  issuedAgainstReason?: ReplacementReason | null;
}

export interface CandidateJob extends ReplacementMarker {
  id?: string;
  jobNo?: string;
  division?: string;
  coreType?: string;
  repairType?: string;
  condition?: string;
  status?: string;
  agencyId?: string;
  isCancelled?: boolean;
  mrStatus?: string;
}

const norm = (v: unknown): string => String(v ?? '').trim();

/**
 * WHY THIS JOB FREED A SLOT, OR NULL IF IT DID NOT.
 *
 * ⚠ SCRAP IS ASKED FIRST, BECAUSE A JOB CAN BE BOTH AND SCRAP IS THE TERMINAL ONE. `OH -> Scrap` is a permitted
 * transition, and a unit that went that way is scrap now - calling it OH would describe the earlier reading.
 */
export function freedSlotReason(job: CandidateJob, inspections: readonly any[] = []): ReplacementReason | null {
  if (isScrapJob(job, inspections as any[])) return 'Scrap';
  // ⚠ THE SHARED THREE-ARM PREDICATE (AUDIT G122), not the two-arm test that used to be inline here. A unit
  // whose declaration reached only its inspection freed a slot exactly as one with `repairType: 'OH'` did, and
  // a replacement must be offerable against it.
  if (isOverhauledJob(job, inspections)) return 'OH';
  return null;
}

export interface ReplaceableScope {
  division: string;
  coreType: string;
  agencyId: string;
  inspections?: readonly any[];
}

/**
 * THE JOBS A NEW UNIT MAY BE ISSUED AGAINST - OH or Scrap, same division, core type and agency, not already
 * replaced.
 *
 * ⚠ "NOT ALREADY REPLACED" IS THE PART THAT MATTERS. Two replacements against one OH unit would take two slots
 * for one freed slot, which is the over-allotment the whole rule exists to avoid - and it would do it while
 * looking fully documented.
 *
 * ⚠ CANCELLED JOBS ARE NOT CANDIDATES AND DO NOT CONSUME A CANDIDATE. A cancelled replacement releases the unit
 * it was issued against, so the slot can be used again; a cancelled OH job never freed a slot in the first
 * place, because a cancelled job draws nothing either way.
 */
export function replaceableJobs(
  jobs: readonly CandidateJob[],
  scope: ReplaceableScope,
): CandidateJob[] {
  const agency = norm(scope.agencyId);
  const live = jobs.filter(j => !isCancelled(j));
  const taken = new Set(
    live.map(j => norm(j.issuedAgainstJobId)).filter(Boolean)
  );
  return live.filter(j =>
    norm(j.division) === scope.division
    && norm(j.coreType || 'CRGO') === scope.coreType
    && norm(j.agencyId) === agency
    && !taken.has(norm(j.id))
    && freedSlotReason(j, scope.inspections) !== null);
}

function isCancelled(job: CandidateJob): boolean {
  return job.isCancelled === true || norm(job.status) === 'Cancelled' || norm(job.mrStatus) === 'Cancelled';
}

/**
 * THE LINE SHOWN BESIDE A REPLACEMENT'S JOB NUMBER, or null when the job is not one.
 *
 * `lookup` resolves the replaced job's id to its number; a replacement whose target has been deleted still says
 * what it was issued for rather than falling silent, because the reason is the part the division asks about.
 */
export function receivedAgainstLabel(
  job: ReplacementMarker,
  lookup: (id: string) => string | undefined,
): string | null {
  const againstId = norm(job.issuedAgainstJobId);
  if (!againstId) return null;
  const reason = norm(job.issuedAgainstReason) || 'OH';
  const against = norm(lookup(againstId));
  return against
    ? `Received against ${reason} ${against}`
    : `Received against a ${reason} unit`;
}

/**
 * HOW A DIVISION/CORE ROW'S FIGURES RECONCILE - for the allotment widget's overrun line.
 *
 * ⚠ IT COUNTS JOBS, NOT MARKERS, AND THE TWO ARE DIFFERENT. `freed` is every non-consuming job in the row;
 * `replaced` is how many of those a replacement was actually issued against. An agency with two OH units and
 * one replacement is entitled to another job, and a line that reported only the marker count would say the
 * overrun was fully explained when one slot is still open.
 */
export function allotmentOverrun(
  jobs: readonly CandidateJob[],
  scope: ReplaceableScope,
): { total: number; drawing: number; freedOh: number; freedScrap: number; replacements: number } {
  const agency = norm(scope.agencyId);
  const inRow = jobs.filter(j => !isCancelled(j)
    && norm(j.division) === scope.division
    && norm(j.coreType || 'CRGO') === scope.coreType
    && norm(j.agencyId) === agency);

  let freedOh = 0, freedScrap = 0, replacements = 0, drawing = 0;
  for (const j of inRow) {
    const reason = freedSlotReason(j, scope.inspections);
    if (reason === 'Scrap') freedScrap += 1;
    else if (reason === 'OH') freedOh += 1;
    if (norm(j.issuedAgainstJobId)) replacements += 1;
    // ⚠ THROUGH THE SHARED PREDICATE, NOT `total - freed`. Subtracting would have been a second count
    // definition - and a wrong one, because GP rework and `coreType: 'OH'` draw nothing either and are not
    // "freed slots". The widget's bar and this line have to agree with the gate that refuses an intake.
    if (drawsOnAllotment(j, scope.inspections)) drawing += 1;
  }
  return { total: inRow.length, drawing, freedOh, freedScrap, replacements };
}
