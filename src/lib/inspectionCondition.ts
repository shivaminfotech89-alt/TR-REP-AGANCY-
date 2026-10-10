/**
 * WHAT THE INTERNAL INSPECTION MAY DECLARE, AND WHICH DECLARATIONS CANNOT BE TAKEN BACK (AUDIT G114).
 *
 * The condition column used to offer two values. It now offers three, and the third is the operator's:
 *
 *   > "DURING INTERNAL SOME JOB SEEN OK SO INSPECTION RENGINEER CONSIDER AS 'OVERHOWLING' SERVICABLE SO ADD
 *   >  STATU IN INTERNAL INSPECTION REPORT IN 'CONDITION' COLUMN SO REPAIRER SELECT WHICH JOB DECLARED AS 'OH',
 *   >  DONT CHANGE JOB NO WHICH ACTUALLY CREATED"
 *
 * ⚠⚠ THE TRANSITIONS ARE ASYMMETRIC AND THAT IS THE WHOLE POINT. `condition` records what the unit WAS, not
 * where it is - it exists because scrap identity used to live in `status`, and dispatch overwrites status. A
 * determination made with the unit open on the bench can be discovered late but it cannot be undiscovered.
 *
 *     unset       -> Repairable / Scrap / OH   allowed   first determination
 *     Repairable  -> Scrap                     allowed   discovered late
 *     Repairable  -> OH                        allowed   opened and found serviceable
 *     OH          -> Scrap                     allowed   found worse on a second look; both are
 *                                                        non-consuming, so no quota inconsistency
 *     Scrap       -> OH                        NEVER     matches Scrap's existing terminality
 *     Scrap       -> Repairable                NEVER
 *     OH          -> Repairable                CONDITIONAL - see below
 *     anything    -> empty / cleared           NEVER
 *
 * ⚠ `OH -> Repairable` IS THE ONE CONDITIONAL, BECAUSE REVERTING RE-CONSUMES QUOTA. An OH job draws no
 * allotment, so a replacement job may already have been issued against it (`issuedAgainstJobId`). Letting the
 * OH job become Repairable again would make both of them consume quota - the agency would silently be one over
 * its allotment, and the figure the division queries would be the app's fault rather than the paperwork's.
 *
 * So it is refused only when a replacement EXISTS, and the refusal names it and the route out. Refusing
 * unconditionally would be wrong the other way: an engineer who mis-clicked OH before any replacement was
 * issued has done nothing that needs protecting against.
 *
 * No React, no Firebase - so it is reachable from src/ AND from scripts/admin/ under tsx.
 */

export const CONDITION_REPAIRABLE = 'Repairable';
export const CONDITION_SCRAP = 'Scrap';

/**
 * ⚠ THE STORED VALUE IS `OH`, MATCHING `repairType`. The column shows a longer label; the stored string is the
 * same two letters the rest of the app already tests for, so `drawsOnAllotment` and `hasNoGuarantee` need no
 * translation layer between the declaration and the rules it drives.
 */
export const CONDITION_OH = 'OH';

/** What the dropdown offers, in the order it offers them. */
export const CONDITION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: CONDITION_REPAIRABLE, label: 'Repairable' },
  { value: CONDITION_OH, label: 'OH (Overhauling - serviceable)' },
  { value: CONDITION_SCRAP, label: 'Scrap' },
];

const norm = (v: unknown): string => String(v ?? '').trim();

/** True when this condition means the agency did not repair the unit, so it consumed no quota. */
export function conditionIsNonConsuming(condition: unknown): boolean {
  const c = norm(condition);
  return c === CONDITION_SCRAP || c === CONDITION_OH;
}

/** One replacement job, as much of one as this decision needs. */
export interface ReplacementJob {
  jobNo?: string;
  issuedAgainstJobId?: string | null;
}

export type ConditionChange =
  | { ok: true; changed: boolean }
  | { ok: false; reason: string };

/**
 * MAY THIS JOB'S CONDITION MOVE FROM `from` TO `to`?
 *
 * `replacements` is every job that might have been issued against this one - the whole agency list is fine, it
 * is filtered here on `issuedAgainstJobId`, so a caller cannot forget to.
 */
export function conditionChange(args: {
  jobId: string;
  jobNo?: string;
  from: unknown;
  to: unknown;
  replacements?: readonly ReplacementJob[];
  /**
   * What the sheet records about coils. Present only on the `conditionSaveCheck` path; the transition arms below
   * never read it, so this signature stays answerable by a caller that holds no inspection data.
   */
  coil?: CoilObservation | null;
}): ConditionChange {
  const from = norm(args.from);
  const to = norm(args.to);
  const label = norm(args.jobNo) || 'This transformer';

  // ⚠ CLEARING IS REFUSED BEFORE ANYTHING ELSE. A determination that can be blanked is not a determination,
  // and a blank would also make every rule below read the unit as never assessed.
  if (!to) {
    return { ok: false, reason: `${label}: the condition cannot be cleared once it has been recorded. It is what the unit was found to be, not where it is in the workflow.` };
  }

  if (from === to) return { ok: true, changed: false };

  // First determination - any of the three.
  if (!from) return { ok: true, changed: true };

  if (from === CONDITION_SCRAP) {
    return {
      ok: false,
      reason: `${label} is already declared Scrap, and that cannot be reversed. Scrap is a determination made with the unit open on the bench: it can be discovered late, but it cannot be undiscovered.\n\nIf the wrong transformer was declared, the declaration has to be corrected in the record by an administrator - no screen can un-condemn a unit.`,
    };
  }

  if (from === CONDITION_OH && to === CONDITION_REPAIRABLE) {
    /**
     * ⚠ THE QUOTA IS THE REASON, SO THE REFUSAL SAYS SO. An OH job drew no allotment; a replacement was issued
     * in its place. Both consuming would put the agency over its allotment through no act of the operator's.
     */
    const taken = (args.replacements || []).filter(r => norm(r.issuedAgainstJobId) === norm(args.jobId));
    if (taken.length > 0) {
      const names = taken.map(r => norm(r.jobNo) || '(unnumbered)').join(', ');
      return {
        ok: false,
        reason: `${label} cannot return to Repairable: ${names} ${taken.length === 1 ? 'was' : 'were'} issued against it.\n\n`
          + `While it was OH it drew no allotment, and ${names} took the quota in its place. Both drawing on the allotment would put the agency over its quota.\n\n`
          + `Cancel ${names} first, then this declaration can be changed.`,
      };
    }
    return { ok: true, changed: true };
  }

  // Repairable -> Scrap, Repairable -> OH, OH -> Scrap.
  return { ok: true, changed: true };
}

/**
 * WHAT TO WRITE ON THE JOB FOR A DECLARED CONDITION.
 *
 * ⚠ IT NEVER TOUCHES `coreType`, `jobNo`, `mrNo` OR ANYTHING ELSE. The operator was explicit:
 * "DONT CHANGE JOB NO WHICH ACTUALLY CREATED". A job issued on a division MR as `SU-9` stays `SU-9` - the MR
 * cannot be rewritten and the declaration is not about identity. The core type is untouched too: the unit's
 * core did not change, only what was found when it was opened, which is why this is reading (a) and not the
 * `coreType: 'OH'` path (AUDIT G114).
 *
 * ⚠⚠ IT ONLY EVER MOVES `repairType` BETWEEN 'OGP' AND 'OH', AND A GP JOB IS LEFT ALONE.
 *
 * Overwriting `repairType: 'GP'` would erase the fact that the job is guarantee rework - a fact that comes from
 * the intake paperwork, is older than this declaration, and drives whether the job is billed at all. A GP job
 * also already draws no allotment and is already excluded from the bill, so there is nothing the promotion
 * would achieve. The declaration is still recorded in `condition`; only `repairType` is withheld.
 *
 * That also means the reverse is exact rather than guessed: OH is only ever reached FROM 'OGP', so leaving OH
 * returns to 'OGP' and needs no stored memory of what it was before. A third field to remember it would have
 * been the obvious way, and it would have been a field that exists only because this function was careless.
 */
export function jobUpdatesForCondition(args: {
  condition: unknown;
  currentRepairType?: unknown;
}): { condition: string; repairType?: string } {
  const condition = norm(args.condition);
  const current = norm(args.currentRepairType);

  if (condition === CONDITION_OH) {
    return current === 'OGP' ? { condition, repairType: CONDITION_OH } : { condition };
  }

  // Leaving OH - and OH is only ever reached from OGP, so that is where it goes back to.
  if (current === CONDITION_OH) return { condition, repairType: 'OGP' };

  return { condition };
}

// ---------------------------------------------------------------------------------------------------------------
// OH AND RECORDED COIL REPLACEMENT ARE MUTUALLY EXCLUSIVE (AUDIT G114, amended)
// ---------------------------------------------------------------------------------------------------------------

/**
 * ⚠⚠ THE OPERATOR'S DEFINITION OF OH IS A DEFINITION, NOT A DESCRIPTION OF A TYPICAL CASE:
 *
 *   > "WHILE SUPPLING 'OGP' JOB TO AGANCY AND FOUND 'OH' (NO REQUIRED TO CHANGE COILS AND INTERNAL PARTS)"
 *
 * A unit with 15.21 kg of HV coil recorded against it has had coils changed, so it is a repair. A record that
 * asserts both "overhauled, nothing replaced" and "15.21 kg of HV coil replaced" is not a display problem to warn
 * about - it is simply wrong, and one of the two halves has to go.
 *
 * ⚠ WHY REFUSE RATHER THAN WARN OR CLEAR. A warning lets that record reach a signed estimate at a division
 * office, which is not a control. Clearing the weight on declaration destroys an engineer's measurement because of
 * a dropdown. Refusing keeps both the record and the definition honest, and the escape is in the engineer's hands:
 * remove the coil weight if the coils were not replaced, or leave the condition as Repairable because they were.
 *
 * ⚠⚠ AND THE REFUSAL IS WHAT MAKES READING (a) CORRECT. G114 chose the service-type reading over Schedule-A sr 21
 * partly on the reasoning that "an OH job replaces no coils, so on the itemised path it has no coil lines and the
 * estimate falls by itself". NOTHING IN THE CODE ENFORCED THAT INVARIANT - measured on ZB-1, a declared-OH job
 * still priced Rs 3,787.29 of coil work, 48% of its base. So (a) is right CONDITIONAL ON THIS RULE EXISTING: the
 * pricing model needs no OH branch precisely because an OH job cannot carry coil lines. Without it, (a) prices an
 * overhaul as a full repair - the opposite of the error (b) was rejected for.
 *
 * ⚠ BIDIRECTIONAL, BECAUSE THE WEIGHT VALIDATION ONLY WATCHES ONE DOOR. `InternalInspection` requires a coil
 * weight when `condition === 'Repairable'`, so declaring OH FIRST and entering the weight SECOND produces the same
 * contradictory record through a door a one-way check never sees. Both directions are the same state test; only
 * the wording differs, and which wording is right is decided by what was already stored.
 */

/** The estimate items this rule is about. Coils only, for now - see the audit entry on "internal parts". */
export const COIL_ITEM_CODES = ['12A', '12B', '12C', '13A', '13B', '13C', '14'] as const;

/**
 * The internal-inspection fields that drive those items.
 *
 * ⚠⚠ THIS IS A SECOND READING OF THE SAME FIELDS, AND IT IS THE RISK IN THIS FILE. The charge is computed in
 * `buildSingleJobEstimateData`; this module cannot import it, because that file pulls in `pdfjs-dist` and needs a
 * DOM - which is also why no unit test in this repo imports the estimate builder. So the quantities below are
 * MIRRORED, deliberately and visibly:
 *
 *   12A / 12C  HV   totWt, else wtOfCoil * (damR + damY + damB)
 *   13A / 13C  LV   totWtLv                                        (DAM states: lvCoilR / lvCoilY / lvCoilB)
 *   14         RI   totWtLvReIns, else (RI count) * wtOfCoilLv
 *
 * ⚠ IT IS DELIBERATELY WIDER THAN THE CHARGE. The estimate prices only when a WEIGHT exists, and raises a
 * `missing-input` error when damage is recorded without one. For this rule a damage COUNT alone is already a
 * record of coils changed - refusing only once the weight is typed would let the contradiction be saved and then
 * block it on the estimate, which is the wrong screen and the wrong person.
 *
 * `scripts/admin/coil-predicate-vs-estimate.js` cross-checks this against the real builder over every live job.
 */
export interface CoilObservation {
  damR?: unknown; damY?: unknown; damB?: unknown;
  wtOfCoil?: unknown; totWt?: unknown;
  lvCoilR?: unknown; lvCoilY?: unknown; lvCoilB?: unknown;
  wtOfCoilLv?: unknown; totWtLv?: unknown; totWtLvReIns?: unknown;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface CoilFinding {
  /** True when anything on the sheet records a coil having been replaced or re-insulated. */
  recorded: boolean;
  /** One phrase per finding, for the refusal: "15.21 kg of HV coil replacement (12A/12C)". */
  parts: string[];
}

/** WHAT THE SHEET SAYS ABOUT COILS. Empty `parts` means nothing was recorded. */
export function coilReplacementRecorded(d: CoilObservation | null | undefined): CoilFinding {
  const parts: string[] = [];
  if (!d) return { recorded: false, parts };

  // --- HV: items 12A / 12C ---
  const hvDamaged = num(d.damR) + num(d.damY) + num(d.damB);
  const hvWeight = num(d.totWt) > 0
    ? num(d.totWt)
    : (num(d.wtOfCoil) > 0 && hvDamaged > 0 ? num(d.wtOfCoil) * hvDamaged : 0);
  if (hvWeight > 0) parts.push(`${hvWeight.toFixed(2)} kg of HV coil replacement (12A/12C)`);
  else if (hvDamaged > 0) parts.push(`${hvDamaged} HV coil(s) marked damaged (12A/12C)`);

  // --- LV: items 13A / 13C ---
  const lvStates = [d.lvCoilR, d.lvCoilY, d.lvCoilB].map(v => String(v ?? '').trim().toUpperCase());
  const lvDam = lvStates.filter(v => v === 'DAM').length;
  const lvWeight = num(d.totWtLv);
  if (lvWeight > 0) parts.push(`${lvWeight.toFixed(2)} kg of LV coil replacement (13A/13C)`);
  else if (lvDam > 0) parts.push(`${lvDam} LV coil(s) marked damaged (13A/13C)`);

  // --- 14: re-insulation, an alternative to replacement on the same limb ---
  const lvRi = lvStates.filter(v => v === 'RI').length;
  const reIns = num(d.totWtLvReIns) > 0 ? num(d.totWtLvReIns) : lvRi * num(d.wtOfCoilLv);
  if (reIns > 0) parts.push(`${reIns.toFixed(2)} kg of LV coil re-insulation (14)`);
  else if (lvRi > 0) parts.push(`${lvRi} LV coil(s) marked for re-insulation (14)`);

  return { recorded: parts.length > 0, parts };
}

/** Which way round the operator arrived at the contradiction. It changes the wording, not the test. */
export type CoilConflictDirection = 'declaring-oh' | 'recording-coil';

/**
 * THE REFUSAL, OR null WHEN THE TWO HALVES AGREE.
 *
 * `direction` is decided by what was ALREADY STORED, not by what the form holds: a job that is not yet OH is
 * being declared one; a job that is already OH is having coil work recorded onto it.
 */
export function coilConflict(args: {
  jobNo?: string;
  /** The condition being saved. */
  condition: unknown;
  coil: CoilObservation | null | undefined;
  direction: CoilConflictDirection;
}): string | null {
  if (norm(args.condition) !== CONDITION_OH) return null;
  const finding = coilReplacementRecorded(args.coil);
  if (!finding.recorded) return null;

  const label = norm(args.jobNo) || 'This transformer';
  const records = finding.parts.join(', ');

  if (args.direction === 'declaring-oh') {
    return `${label} records ${records}. A unit with coils replaced is a repair, not an overhaul.\n\n`
      + 'Overhauling means no coils and no internal parts were changed. Clear the coil weight if the coils were '
      + 'not replaced, or leave the condition as Repairable because they were.';
  }

  return `${label} is declared OH, and OH means no coils were changed - so ${records} cannot be recorded `
    + 'against it.\n\n'
    + 'Change the condition to Repairable first if the coils were replaced, or clear the coil entry if they were '
    + 'not.';
}

/**
 * THE WHOLE SAVE-TIME QUESTION FOR ONE JOB: may this condition stand, with this sheet, on this stored job?
 *
 * ⚠ ONE ENTRY POINT, SO A SCREEN CANNOT ASK HALF OF IT. `conditionChange` answers the transition and
 * `coilConflict` answers the mutual exclusion; a caller that remembered one and forgot the other is exactly how
 * the back door stays open. The direction is derived here from the stored condition rather than passed in.
 */
export function conditionSaveCheck(args: {
  jobId: string;
  jobNo?: string;
  /** The condition as stored on the JOB - '' when never determined. */
  from: unknown;
  /** The condition being saved. */
  to: unknown;
  coil?: CoilObservation | null;
  replacements?: readonly ReplacementJob[];
}): ConditionChange {
  const transition = conditionChange(args);
  if ('reason' in transition) return transition;

  // ⚠ THE DIRECTION IS WHAT WAS ALREADY TRUE. A job not yet OH is being DECLARED one; a job already OH is having
  // coil work recorded ONTO it. Same state test, opposite wording - and the second is the door the
  // `condition === 'Repairable'` weight validation never watched.
  const direction: CoilConflictDirection =
    norm(args.from) === CONDITION_OH ? 'recording-coil' : 'declaring-oh';
  const conflict = coilConflict({ jobNo: args.jobNo, condition: args.to, coil: args.coil, direction });
  if (conflict) return { ok: false, reason: conflict };

  return transition;
}

// ---------------------------------------------------------------------------------------------------------------
// IS THIS JOB OVERHAULED? - THREE ARMS, LIKE SCRAP'S, AND FOR THE SAME REASON (AUDIT G122)
// ---------------------------------------------------------------------------------------------------------------

/**
 * ⚠⚠ `drawsOnAllotment` RECOGNISED AN OVERHAUL BY `repairType` ALONE, WHICH IS THE HOLE O80 FOUND FOR SCRAP.
 *
 * O80's finding was that one declaration can live in more than one place and the narrow test misses a real unit:
 * `ASU-2` is scrap ONLY in its internal inspection, with an empty `condition` on the job, and every census that
 * tested the job document alone understated by its 90 litres. `isScrapJob` therefore has three arms.
 *
 * The OH exclusion had one. It read `job.repairType === 'OH'` and nothing else - not `job.condition`, which is
 * the field the declaration always writes, and not the inspection, which is the audit trail. Two shapes reach
 * that gap:
 *
 *   - **`jobUpdatesForCondition` withholds `repairType` unless the job is currently `'OGP'`**, by design, so a
 *     declaration on any other repair type records `condition: 'OH'` and leaves `repairType` alone. GP is
 *     already excluded from the allotment so it costs nothing there - but the exclusion was relying on a
 *     coincidence rather than on reading the field that was written.
 *   - **ASU-2's shape.** A job document restored, migrated or re-written without `condition` leaves the
 *     declaration surviving only in the inspection. That is not hypothetical: it has already happened once in
 *     this database, for scrap.
 *
 * ⚠ MEASURED BEFORE BUILDING: zero live jobs carry `repairType: 'OH'`, `condition: 'OH'`, or an inspection
 * declaring OH, because none of this is deployed yet. The count that matters is the forward one, and it is why
 * the arm goes in before the feature ships rather than after a census finds the first miss.
 *
 * ⚠ `coreType === 'OH'` IS NOT ONE OF THESE ARMS, DELIBERATELY. That is the separately-issued overhauling MR -
 * the Schedule-A sr 21 path, six agencies using it - and the owner's rule is that such MRs **carry no allotment
 * at all**, "not 0 consumed, but not counted". It is a different fact from a unit declared overhauled on an
 * allotted MR, so `drawsOnAllotment` keeps its own separate test for it and a coreType-OH job is never offered
 * as a freed slot.
 */

/**
 * The condition an Internal inspection records for this job, or '' when there is none.
 *
 * ⚠ THIS WALK EXISTS TWICE - here and inside `scrapState.scrapEvidence` - AND THAT IS A KNOWN PAIR. Reconciling
 * them means changing `scrapEvidence`'s contract, which four callers and the oil census depend on, so it is
 * listed rather than done (pair 1c). Both match on `jobId` and require `type === 'Internal'`; if they ever
 * disagree about which inspection is authoritative, that is the defect to look for.
 */
export function internalDeclaredCondition(job: any, inspections: readonly any[] = []): string {
  const jobId = norm(job?.id);
  if (!jobId) return '';
  const found = (inspections || []).find((i: any) =>
    norm(i?.jobId) === jobId && norm(i?.type) === 'Internal');
  return norm(found?.data?.condition);
}

export interface OverhaulEvidence {
  /** `job.repairType` says OH - what the declaration writes on an OGP job. */
  byRepairType: boolean;
  /** `job.condition` says OH - what the declaration always writes. */
  byCondition: boolean;
  /** The Internal inspection says OH, whatever the job document says. */
  byInspection: boolean;
  /** True when ANY of the above did. */
  isOverhauled: boolean;
  /** Which ones, for a caller that must show provenance. Empty when not overhauled. */
  matched: Array<'repairType' | 'condition' | 'inspection'>;
}

/** Every test, kept apart so a disagreement between them stays visible - `scrapEvidence`'s shape exactly. */
export function overhaulEvidence(job: any, inspections: readonly any[] = []): OverhaulEvidence {
  const byRepairType = norm(job?.repairType) === CONDITION_OH;
  const byCondition = norm(job?.condition) === CONDITION_OH;
  const byInspection = internalDeclaredCondition(job, inspections) === CONDITION_OH;

  const matched: Array<'repairType' | 'condition' | 'inspection'> = [];
  if (byRepairType) matched.push('repairType');
  if (byCondition) matched.push('condition');
  if (byInspection) matched.push('inspection');

  return { byRepairType, byCondition, byInspection, isOverhauled: matched.length > 0, matched };
}

/**
 * THE WIDEST TEST - a job is overhauled if ANY evidence says so.
 *
 * ⚠ WIDEST ON PURPOSE, AND THE SAFE DIRECTION IS THE OPPOSITE OF SCRAP'S. For an oil figure an understatement
 * hides litres the DISCOM settles against. Here an understatement makes an overhauled unit CONSUME quota it did
 * not earn - the agency loses a job it was entitled to, quietly, and the figure the division queries is the
 * app's fault. A caller needing a narrower answer should read `overhaulEvidence` and say which arm it used.
 */
export function isOverhauledJob(job: any, inspections: readonly any[] = []): boolean {
  return overhaulEvidence(job, inspections).isOverhauled;
}
