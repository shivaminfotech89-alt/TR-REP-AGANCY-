// Pure estimate-cost calculation, usable anywhere a job's estimate or its Clause 4.0
// circle-limit standing needs to be known - not just EstimateGenerate.tsx. Everything
// needed is passed in as an argument; no component state, no hooks, no context reads.
import { buildSingleJobEstimateData, classifyCoreType } from '../components/SingleJobEstimateReport';
import { getCircleLimitForJob, EstimateItem, EstimateRates } from './estimateData';

export function getJobFullEstimate(job: any, externalData: any, internalData: any, agency: any, atMaster: any) {
  return buildSingleJobEstimateData(job, agency, atMaster, externalData, internalData);
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
