// Pure estimate-cost calculation, usable anywhere a job's estimate or its Clause 4.0
// circle-limit standing needs to be known - not just EstimateGenerate.tsx. Everything
// needed is passed in as an argument; no component state, no hooks, no context reads.
import { buildSingleJobEstimateData } from '../components/SingleJobEstimateReport';
import { getCircleLimitForJob, EstimateItem } from './estimateData';

export function getJobFullEstimate(job: any, externalData: any, internalData: any, agency: any, atMaster: any) {
  return buildSingleJobEstimateData(job, agency, atMaster, externalData, internalData);
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
