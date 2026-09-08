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

/**
 * THE SCRAP CODE FOLLOWS THE MASTER THE JOB READS, WHICH IS THE PRICING MODEL.
 *
 * Rs 500 is the charge under both tenders - that is settled and is not what varies. What
 * varies is the ITEM CODE, because the code is a lookup key into a specific master section
 * and the sections hold different rows: '0' exists in the Amorphous and Wound Core masters,
 * '22' in the CRGO master, and neither holds the other.
 *
 * Under an itemised tender an Amorphous job reads the CRGO master (see
 * getEstimateMasterForCore), where '0' is absent - so it must resolve through '22'.
 *
 * ⚠ KEYED ON THE PRICING MODEL, NOT ON THE SCHEDULE ID. "'0' under 2020, '22' under 2026"
 * is true today and is the wrong rule: it would need editing for every tender after 2026,
 * and a future tender that restores a Schedule-B would silently get the wrong code. The
 * real reason is that the job reads the CRGO master, and the predicate that CHOSE that
 * master is the one that should choose the code - then the two cannot disagree.
 *
 * OH IS DELIBERATELY ABSENT AND STAYS ABSENT. The Overhauling master holds codes 7, 3, 4,
 * 5 and 6 - there is NO scrap row in it, and 6 is "sealing of uneconomical unit", which is
 * a different thing (see AUDIT O45). Mapping OH to '22' would send it to a row in a section
 * it does not read; mapping it to '0' would do the same. So a scrapped OH job returns null
 * and blocks with "no scrap charge item code is mapped", which is the honest answer until
 * the tender says what a scrapped OH unit is charged. AUDIT O48.
 */
export function scrapItemCodeForJob(coreType: string | undefined, at?: any): string | null {
  const cls = classifyCoreType(coreType || 'CRGO');
  if (cls === 'OH') return null;                       // no scrap row in the OH master
  return pricingModelForJob(at, cls) === 'ITEMISED'
    ? SCRAP_ITEM_CODE_BY_CORE_CLASS.CRGO               // reads the CRGO master -> '22'
    : SCRAP_ITEM_CODE_BY_CORE_CLASS[cls] ?? null;      // reads its own section -> '0'
}

/**
 * Mapped scrap item code for a job's core type.
 *
 * ⚠ PASS THE AT. Without it the job resolves against the DEFAULT schedule, which is 2020 -
 * right for existing records and wrong for anything under a tender with no Schedule-B.
 */
export function getScrapItemCodeForCore(coreType: string, at?: any): string | null {
  return scrapItemCodeForJob(coreType, at);
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
  masterList: EstimateItem[] | undefined,
  at?: any
): ScrapChargeResolution {
  const coreClass = classifyCoreType(coreType || 'CRGO');
  const code = scrapItemCodeForJob(coreType, at);

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
  /**
   * ⚠ THE CLAUSE 4.0 FIGURE, NOT THE ESTIMATE TOTAL. Renamed from `comparisonAmt`, which stopped
   * being true the moment the tank / conservator / radiator exclusion landed: it carries
   * `comparisonTotal`, and a reader comparing it against the estimate's Final Amount would
   * find two different numbers with nothing saying why. A name that no longer describes its
   * value is the defect this codebase keeps finding; it was not left in place.
   */
  comparisonAmt: number;
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

/**
 * THE 25%-TO-30% BAND, AS A BOUNDARY ON ASKING A QUESTION - NOT AS A FIGURE.
 *
 * Clause 4.0 routes an estimate three ways by its proportion of a new transformer's cost:
 * up to 25% to SE (O&M), over 25% and up to 30% to CE (OP), and OVER 30% TO SCRAP. Consent
 * to repair within the limit belongs to the middle band. Offering it on a job the tender
 * says must be scrapped would be worse than offering nothing.
 *
 * The app holds ONE figure per rating and capacity - the 25% threshold - so it cannot see
 * where 30% falls. This constant is the stand-in, and the reason it is defensible here and
 * would not be elsewhere is worth being exact about:
 *
 *   ⚠ NOTHING IS CHARGED FROM THIS NUMBER AND NOTHING IS APPROVED BY IT. It decides only
 *   whether a QUESTION IS ASKED. The claim is capped at the stored 25% limit, never at
 *   limit x 1.2; the excluded items are claimed at their own rates; no document prints it.
 *   Used as a boundary on offering consent it is a weak claim - at worst it declines to
 *   offer consent slightly early, or offers it slightly late, and in both cases a person
 *   decides. Used to price or to approve, it would be a fabricated threshold.
 *
 *   ⚠ AND THE 25% FIGURES ARE DEMONSTRABLY COPIED, NOT DERIVED. In the shipped table,
 *   11 KV "3 Star & other" prices 10 KVA at 8716 and 16 KVA at 8696 - the larger unit
 *   cheaper than the smaller - and 4 Star prices 10 KVA at 7707 against 3 Star's 8716, a
 *   higher-rated unit cheaper than a lower one. Neither can come from applying 25% to a
 *   coherent cost basis. They are transcriptions of UGVCL's own table, artefacts included
 *   (see AUDIT O43). Multiplying an artefact by 1.2 does not correct it; it propagates it
 *   into a second threshold AND LENDS IT THE APPEARANCE OF CORROBORATION, which is the
 *   specific harm. That is the reason this is a gate on a question rather than a computed
 *   30% limit presented as one.
 *
 * A PUBLISHED 30% TABLE REPLACES THIS ENTIRELY, and is five more rows in a master that
 * already has the shape - one per rating, priced per capacity, exactly like the 25% rows.
 * If that table is found, delete this constant rather than keeping both.
 */
export const CONSENT_BAND_MULTIPLIER = 1.2;   // 30% / 25%, exact only if both are clean

export type ConsentEligibility =
  /** At or under the 25% threshold. No consent is needed and none should be offered. */
  | 'NOT_NEEDED'
  /** Over 25%, within the stand-in 30% boundary. Consent to repair within the limit applies. */
  | 'OFFER'
  /** Past the boundary. Clause 4.0 routes this to scrap; consent must NOT be offered. */
  | 'SCRAP'
  /** No sanction limit applies to this job at all - fixed-rate core, or no published figure. */
  | 'NO_LIMIT';

/** Why consent is not on offer, in the words to show the operator. Null when it is. */
export function consentRefusalReason(e: ConsentEligibility): string | null {
  if (e === 'SCRAP') {
    return 'This exceeds the 25% threshold by more than the 30% band allows; Clause 4.0 routes it to scrap. '
         + 'The app holds only the 25% figure, so the 30% point is approximated - if the estimate is genuinely '
         + 'within the CE (OP) band, the published 30% table has to be entered before consent can be offered.';
  }
  return null;
}

/**
 * Whether consent to repair within the limit is available for this job.
 *
 * Measured on `comparisonTotal` - the Clause 4.0 figure - never on the estimate total.
 */
export function consentEligibility(check: CircleLimitCheck): ConsentEligibility {
  if (!check.hasLimit || !(check.limit > 0)) return 'NO_LIMIT';
  if (!check.exceeds) return 'NOT_NEEDED';
  return check.comparisonAmt <= check.limit * CONSENT_BAND_MULTIPLIER ? 'OFFER' : 'SCRAP';
}

/**
 * A RECORDED DECISION, NOT A COMPUTED ONE.
 *
 * ⚠ `limitAtConsent` IS STORED RATHER THAN RECOMPUTED. The circle-limit figures live in an
 * editable master and are versioned per tender. A bill reissued from an old consent must
 * reproduce the amount that was actually agreed, not whatever the table says today - the
 * same reasoning as the oil carry-forward, and the same failure if it is skipped: a
 * document that silently disagrees with the one it replaces.
 */
export interface RepairWithinLimitConsent {
  /** Who accepted repairing within the sanction limit. */
  consentedBy: string;
  /** When, epoch ms. */
  consentedAt: number;
  /** The 25% figure at that moment. The claim is capped at THIS, not at a recomputed one. */
  limitAtConsent: number;
  /** The assessed Clause 4.0 figure at that moment, for reconciliation. */
  comparisonTotalAtConsent: number;
}

/**
 * WHAT THE BILL CLAIMS - three figures, and only the third is money asked for.
 *
 *   finalAmount      what the work is assessed at. Shown on the estimate IN FULL.
 *   comparisonTotal  labour + material, the figure Clause 4.0 measures against the limit.
 *   claimedAmount    the capped claim: the limit, PLUS the excluded items at their own rates.
 *
 * ⚠ THE EXCLUDED ITEMS ARE CLAIMED IN FULL ON TOP, NOT CAPPED WITH THE REST. Clause 4.0
 * excludes tank, conservator tank and radiator from the computation, so they were never part
 * of what the limit measured. Applying the ceiling to them would impose a cap derived from a
 * figure they were explicitly kept out of.
 *
 * The cap can only ever REDUCE the claim: consent arises only when comparisonTotal exceeds
 * the limit, so limit + excluded is necessarily below finalAmount.
 */
export function claimedAmountForJob(
  est: { finalAmount: number; excludedBase?: number; atPercentage: number; comparisonTotal?: number },
  consent: RepairWithinLimitConsent | null | undefined
): number {
  if (!consent) return Number(est.finalAmount);
  const excludedWithPct = Number(est.excludedBase || 0) * (1 + Number(est.atPercentage || 0) / 100);
  return Number((consent.limitAtConsent + excludedWithPct).toFixed(2));
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
  const comparisonAmt = typeof est.comparisonTotal === 'number' ? est.comparisonTotal : est.finalAmount;
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
      comparisonAmt,
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
  const exceeds = limitInfo.hasLimit && comparisonAmt > limitInfo.limit;
  const diff = comparisonAmt - limitInfo.limit;
  const diffPct = limitInfo.limit > 0 ? ((diff / limitInfo.limit) * 100) : 0;
  return {
    comparisonAmt,
    limit: limitInfo.limit,
    ratingLabel: limitInfo.ratingLabel,
    ratingCode: limitInfo.ratingCode,
    hasLimit: limitInfo.hasLimit,
    exceeds,
    diff,
    diffPct
  };
}
