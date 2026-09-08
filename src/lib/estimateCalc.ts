// Pure estimate-cost calculation, usable anywhere a job's estimate or its Clause 4.0
// circle-limit standing needs to be known - not just EstimateGenerate.tsx. Everything
// needed is passed in as an argument; no component state, no hooks, no context reads.
import { buildSingleJobEstimateData, classifyCoreType } from '../components/SingleJobEstimateReport';
import { pricingModelForJob } from './ugvclSchedules';
import { getCircleLimitForJob, EstimateItem, EstimateRates } from './estimateData';

export function getJobFullEstimate(job: any, externalData: any, internalData: any, agency: any, atMaster: any) {
  return buildSingleJobEstimateData(job, agency, atMaster, externalData, internalData);
}

/**
 * A GP (guarantee) repair carries NO charge: the agency redoes the work at its own
 * expense within the guarantee period. GP jobs are excluded from every money path -
 * estimates, forwarding letters, and bills of both types. Oil accounting is NOT
 * affected: oil is consumed regardless of who pays for the repair.
 *
 * Keyed on `repairType` / `isGp`, which exist on EVERY job. Deliberately NOT on
 * `gpSource`, which was added later and therefore exists only on jobs saved since -
 * keying off it would leave the entire pre-existing GP population billable.
 */
export function isGpJob(job: any): boolean {
  return job?.repairType === 'GP' || job?.isGp === true;
}

// ---------------------------------------------------------------------------
// SCRAP FLAT CHARGE - single source of truth
// ---------------------------------------------------------------------------
// A transformer declared scrap bills one flat "inspection & dismantling charges"
// line (Rs 500) regardless of capacity. The item code differs per core type and
// that is legitimate per-core-type data, not something to unify: CRGO uses '22'
// (moved off '18', which collides with "Repl. Of Tank"), Amorphous and Wound Core
// use '0'.
//
// Both the estimate and the bill resolve through here so they cannot drift apart
// again. Never match on itemName substrings - "dismental"/"scrap" matching pulled
// in CRGO's '1a' Labour Charge (Rs 2,061) as though it were the scrap item - and
// never fall back to a hardcoded 500: an unresolved rate blocks with a named error.
/**
 * THE SCRAP ITEM CODE, BY CORE CLASS - AND NOW BY PRICING MODEL.
 *
 * Row '0' lives in the Amorphous/Wound Core master; row '22' lives in the CRGO master. The
 * code has to match the LIST that will be searched, and under UGVCL-2026 an itemised
 * Amorphous job reads the CRGO master, which has no row '0'.
 *
 * ⚠ '0' IS LEFT IN PLACE FOR ITEMISED TENDERS DELIBERATELY, PENDING THE TENDER'S ANSWER.
 * Looking up '0' in the CRGO list finds nothing and returns a NAMED REFUSAL - the estimate
 * withholds its total and the bill refuses to issue. It blocks; it cannot misprice. Nothing
 * happens at all until someone scraps an Amorphous unit under an 1819 AT, and if the answer
 * turns out to be '22' this is one line.
 */
export const SCRAP_ITEM_CODE_BY_CORE_CLASS: Record<string, string> = {
  CRGO: '22',
  AMORPHOUS: '0',
  WOUND_CORE: '0',
};

/** Mapped scrap item code for a job's core type, or null if none is defined. */
export function getScrapItemCodeForCore(coreType: string): string | null {
  return SCRAP_ITEM_CODE_BY_CORE_CLASS[classifyCoreType(coreType || 'CRGO')] ?? null;
}

export interface ScrapChargeResolution {
  /** The mapped item code, or null when the core type has no scrap code defined. */
  code: string | null;
  /** Resolved flat rate, or null when it could not be resolved (see error). */
  rate: number | null;
  /** Named, user-facing reason the charge could not be resolved. */
  error: string | null;
}

export function resolveScrapCharge(
  coreType: string,
  capacityKva: string | number,
  masterList: EstimateItem[] | undefined
): ScrapChargeResolution {
  const coreClass = classifyCoreType(coreType || 'CRGO');
  const code = SCRAP_ITEM_CODE_BY_CORE_CLASS[coreClass] ?? null;

  if (!code) {
    return {
      code: null,
      rate: null,
      error: `No scrap charge item code is mapped for core type "${coreType || 'CRGO'}" (${coreClass}). Scrap cannot be billed for this core type until a code is mapped.`,
    };
  }

  const kvaStr = String(capacityKva || '').trim();
  const item = (masterList || []).find(m => (m.itemCode || '').trim() === code);
  if (!item) {
    return {
      code,
      rate: null,
      // NAMES THE LIST ACTUALLY SEARCHED, not the core class. Under an itemised tender an
      // Amorphous job reads the CRGO master, and saying "missing from the AMORPHOUS estimate
      // master" sends someone to a screen where the row is present and correct.
      error: `Scrap charge item code "${code}" is missing from the estimate master section this job prices from (core type ${coreClass}, ${(masterList || []).length} rows). Add item "${code}" (inspection & dismantling charges of damaged transformer declared as scrap by E.E. (TR), Rs 500 flat for all capacities) to that section before billing scrap.`,
    };
  }

  const raw = item.rates ? item.rates[kvaStr as keyof EstimateRates] : undefined;
  let rate: number | null =
    raw !== undefined && raw !== null && !isNaN(Number(raw)) && Number(raw) > 0 ? Number(raw) : null;
  if (rate === null && item.fixedRate !== undefined && item.fixedRate !== null && Number(item.fixedRate) > 0) {
    rate = Number(item.fixedRate);
  }

  if (rate === null) {
    return {
      code,
      rate: null,
      error: `Scrap charge item "${code}" (core type ${coreClass}) has no rate for ${kvaStr || 'this'} KVA in the section this job prices from. Set its rate (Rs 500) before billing scrap.`,
    };
  }

  return { code, rate, error: null };
}

export interface CircleLimitCheck {
  finalAmt: number;
  limit: number;
  ratingLabel: string;
  ratingCode: string;
  hasLimit: boolean;
  exceeds: boolean;
  diff: number;
  diffPct: number;
}

// Evaluates a job against Clause 4.0 Circle Estimate Power Limit. circleLimitsData is
// the agency's "Circle Authority Estimate Approval Limit" master, resolved by the
// caller (via getCircleLimitsEstimateMaster) rather than looked up in here, so this
// stays free of any AgencyContext dependency.
/**
 * WHICH CORE TYPES THE CLAUSE 4.0 CIRCLE APPROVAL LIMIT APPLIES TO.
 *
 * The limit caps a repair at 25% of the cost of a NEW transformer, so it only means
 * anything where the repair cost is itemised and can vary. Amorphous and CRGO Wound Core
 * are priced from `SCHEDULE_B` at a fixed rate per capacity: the figure is the tender's,
 * nothing observed on the bench can move it, and there is no cap on it to breach.
 *
 * ⚠ OVERHAULING KEEPS ITS LIMIT, AND THE DISTINCTION IS THE POINT OF THIS FUNCTION.
 * `classifyCoreType` returns 'OH' separately, so "not CRGO" would have excluded it too -
 * and that would be this same defect pointing the other way. Overhauling is a SERVICE
 * TYPE, not a core material: an overhauled unit is still a CRGO transformer. The tender
 * clause names "CRGO (STACK/DRY/PAT/SDT) Transformers", which are CRGO core sub-types; it
 * excludes Amorphous and Wound Core because those are different core materials, not
 * because of how the work is priced. OH is itemised from Schedule-A sr 21 with physical
 * damages "charged extra at above rates", so its cost varies and the cap is real.
 *
 * The old inline guard in InternalInspection excluded OH as well, but for a DIFFERENT
 * stated reason - "OH cannot realistically approach the limit". That is a practical
 * observation, and the data supports it (the one OH job uses 17.9% of its limit). It is
 * not the same claim as "no limit applies", and only the second belongs in `hasLimit`.
 */
/**
 * WHETHER A SANCTION LIMIT APPLIES. SCHEDULE-DEPENDENT SINCE A/T 1819.
 *
 * The exclusion was never about the core type. It was that a FIXED-RATE job has no itemised
 * estimate for Clause 4.0 to measure - the 25% figure is a proportion of a new transformer's
 * cost, computed from repair work, and a flat Schedule-B charge is not that. Under a tender
 * with a Schedule-B that reads as "Amorphous and Wound Core are excluded"; under one without,
 * it does not.
 *
 * So UNDER UGVCL-2026 AN AMORPHOUS JOB IS CIRCLE-LIMIT CHECKED FOR THE FIRST TIME - it is
 * itemised, and Clause 4.0 applies to it exactly as to CRGO. That reaches paper: the printed
 * estimate's Condition column can now say "> CIRCLE LIMIT" on an Amorphous sheet sent to the
 * circle office. And the figures it is checked against are 2020's, borrowed - if 2026 raised
 * the limits, those jobs flag over-limit slightly early.
 *
 * Passing the AT is required, not optional. A caller with no AT gets the DEFAULT schedule,
 * which is 2020 - the right answer for existing records, and the reason the parameter is not
 * silently defaulted here.
 */
export function coreTypeHasCircleLimit(coreType: string | undefined, at?: any): boolean {
  return pricingModelForJob(at, classifyCoreType(coreType || 'CRGO')) !== 'FIXED_RATE';
}

export function checkJobCircleLimit(
  job: any,
  externalData: any,
  internalData: any,
  agency: any,
  atMaster: any,
  circleLimitsData: EstimateItem[] | undefined
): CircleLimitCheck {
  const est = getJobFullEstimate(job, externalData, internalData, agency, atMaster);

  /**
   * ⚠ THE COMPARISON IS NOT THE ESTIMATE TOTAL, AND NEVER WAS.
   *
   * Clause 4.0: "Tank, conservator tank and radiator damage charges are excluded from the
   * 25% / 30% computation." This measured `finalAmount` - the whole estimate - so a job over
   * its limit only because of tank or radiator work was reported over limit when the circle
   * office's own arithmetic puts it inside. That assertion reaches paper, in the Condition
   * column of the printed estimate, addressed to the officer whose sanction power it is
   * describing.
   *
   * NOT SCHEDULE-DEPENDENT, unlike the pricing model. This is how Clause 4.0 has always
   * worked, in both tenders, so it changes results for existing CRGO jobs - and that
   * movement is the fix rather than a regression. See the baseline note in
   * scripts/admin/pricing-model-regression.js.
   *
   * Falls back to `finalAmount` where the path does not compute a comparison figure - the
   * scrap, fixed-rate and OH branches, none of which can carry a tank or radiator line.
   */
  const finalAmt = typeof est.comparisonTotal === 'number' ? est.comparisonTotal : est.finalAmount;
  const ratingKey = job.starRating || job.ratingLevel || '3 Star & other';

  // THE GUARD LIVES HERE, NOT AT THE CALL SITES.
  //
  // It used to live in exactly one of the six places that check - the Internal Inspection
  // indicator - and that was the only one which never reached paper. The other five
  // measured a fixed-rate job against a CRGO limit: the MR badge, the "OVER LIMIT" banner,
  // `mrHasExceededCircleLimit`, `exceedingJobsInSelectedMr`, and - the one that matters -
  // the Condition column of the PRINTED ESTIMATE (EstimateGenerate:1007), which asserted
  // "REPAIRABLE (> CIRCLE LIMIT)" on a document sent to the circle office, about a sanction
  // limit that does not exist for that core type.
  //
  // Two live Amorphous jobs were flagged when this was written: 21PS-AP-4 (100 KVA copper,
  // Rs 63,966.24 against a 24,609 limit, +160%) and ASU-4 (63 KVA copper, +10%). Both are
  // copper, and that is not a coincidence - the copper Schedule-B rows are per-coil times
  // three plus labour, which lands far above a cap derived from CRGO repair costs.
  //
  // `limit` is 0 rather than the CRGO figure on purpose: returning a number that does not
  // apply, next to `hasLimit: false`, invites exactly the reading this fix removes.
  if (!coreTypeHasCircleLimit(job?.coreType, atMaster)) {
    const rating = getCircleLimitForJob(job.capacityKva, ratingKey, circleLimitsData);
    return {
      finalAmt,
      limit: 0,
      ratingLabel: rating.ratingLabel,
      ratingCode: rating.ratingCode,
      hasLimit: false,
      exceeds: false,
      diff: 0,
      diffPct: 0
    };
  }

  const limitInfo = getCircleLimitForJob(job.capacityKva, ratingKey, circleLimitsData);
  const exceeds = limitInfo.hasLimit && finalAmt > limitInfo.limit;
  const diff = finalAmt - limitInfo.limit;
  const diffPct = limitInfo.limit > 0 ? ((diff / limitInfo.limit) * 100) : 0;
  return {
    finalAmt,
    limit: limitInfo.limit,
    ratingLabel: limitInfo.ratingLabel,
    ratingCode: limitInfo.ratingCode,
    hasLimit: limitInfo.hasLimit,
    exceeds,
    diff,
    diffPct
  };
}
