// Pure estimate-cost calculation, usable anywhere a job's estimate or its Clause 4.0
// circle-limit standing needs to be known - not just EstimateGenerate.tsx. Everything
// needed is passed in as an argument; no component state, no hooks, no context reads.
import { buildSingleJobEstimateData, classifyCoreType } from '../components/SingleJobEstimateReport';
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
      error: `Scrap charge item code "${code}" is missing from the ${coreClass} estimate master. Add item "${code}" (inspection & dismantling charges of damaged transformer declared as scrap by E.E. (TR), Rs 500 flat for all capacities) to the ${coreClass} master before billing scrap.`,
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
      error: `Scrap charge item "${code}" in the ${coreClass} estimate master has no rate for ${kvaStr || 'this'} KVA. Set its rate (Rs 500) before billing scrap.`,
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
export function coreTypeHasCircleLimit(coreType: string | undefined): boolean {
  const cls = classifyCoreType(coreType || 'CRGO');
  return cls !== 'AMORPHOUS' && cls !== 'WOUND_CORE';
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
  const finalAmt = est.finalAmount;
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
  if (!coreTypeHasCircleLimit(job?.coreType)) {
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
