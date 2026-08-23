// Does an estimate master section actually contain the schedule it is filed under?
//
// WHY THIS EXISTS (AUDIT F27). Two agencies were found with their masters misfiled:
// AARATI's Wound Core section held a copy of the CRGO card (32 items, scrap at "18");
// MEGHA's held Schedule-B while its Amorphous section was an empty skeleton with scrap
// at "1". Pricing was nonetheless CORRECT, because both the resolver and the master
// screen quietly skipped a Wound Core section that "looked legacy" and fell back to
// Amorphous. The repair worked so well that nobody could see the cause.
//
// The old test was a blacklist of four item-name substrings - 'dismental', 'washer
// ring', 'hv metal', 'lv metal'. That is a confident VERDICT produced from an incomplete
// test: a CRGO card that happens not to contain those words passes as a valid Wound Core
// master and prices Wound Core jobs from CRGO item rates.
//
// This module replaces it with a POSITIVE identity test - "which schedule do these item
// codes actually belong to" - measured against the shipped defaults, which are the
// definition of each schedule.
//
// IT REPORTS. It repairs nothing and prices nothing.

import {
  EstimateItem,
  defaultEstimateData,
  defaultAmorphousEstimateData,
  defaultWoundCoreEstimateData,
  defaultOverhaulingEstimateData,
} from './estimateData';
import { SCRAP_ITEM_CODE_BY_CORE_CLASS } from './estimateCalc';

export type MasterSection = 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING';

export const SECTION_LABEL: Record<MasterSection, string> = {
  CRGO: 'CRGO',
  AMORPHOUS: 'Amorphous',
  WOUND_CORE: 'Wound Core',
  OVERHAULING: 'Overhauling',
};

const REFERENCE: Record<MasterSection, EstimateItem[]> = {
  CRGO: defaultEstimateData,
  AMORPHOUS: defaultAmorphousEstimateData,
  WOUND_CORE: defaultWoundCoreEstimateData,
  OVERHAULING: defaultOverhaulingEstimateData,
};

/**
 * The CRGO card's signature item names. Kept as ONE INPUT to the identity score, not as
 * a standalone verdict - which is the whole difference from the blacklist this replaces.
 * A CRGO card missing these words is still caught by code overlap; a Schedule-B section
 * that happens to contain one of them is not condemned by it alone.
 */
const CRGO_SIGNATURE_NAMES = ['dismental', 'washer ring', 'hv metal', 'lv metal'];

const codesOf = (list?: EstimateItem[]): string[] =>
  (list || []).map(i => String(i.itemCode ?? '').trim()).filter(Boolean);

/** Fraction of this section's item codes that appear in a reference schedule. 0..1 */
function codeOverlap(list: EstimateItem[] | undefined, reference: EstimateItem[]): number {
  const mine = codesOf(list);
  if (mine.length === 0) return 0;
  const ref = new Set(codesOf(reference));
  return mine.filter(c => ref.has(c)).length / mine.length;
}

function hasCrgoSignatureNames(list?: EstimateItem[]): boolean {
  return (list || []).some(it => {
    const name = String(it.itemName ?? '').toLowerCase();
    return CRGO_SIGNATURE_NAMES.some(sig => name.includes(sig));
  });
}

export interface MasterHealth {
  section: MasterSection;
  label: string;
  itemCount: number;
  isEmpty: boolean;
  /** Scrap item code this section is required to carry, or null if none is mapped. */
  requiredScrapCode: string | null;
  scrapCodePresent: boolean;
  /** Scrap codes actually present that are NOT the required one - the misfiling signal. */
  foreignScrapCodes: string[];
  /** 0..1 overlap with this section's own reference schedule. */
  ownScore: number;
  /** 0..1 overlap with the CRGO card. */
  crgoScore: number;
  /**
   * TRUE only when the section identifies more strongly as the CRGO card than as its own
   * schedule. Deliberately narrow - see `holdsWrongSchedule` note below.
   */
  holdsCrgoCard: boolean;
  /** Named, user-facing problems. Empty means nothing detected. */
  problems: string[];
  /** Whether pricing for this core type should be blocked until a human fixes it. */
  blocking: boolean;
  /** Overhauling: an empty section is the normal state, not a gap. */
  emptyIsNormalHere: boolean;
}

/**
 * WHY `holdsCrgoCard` IS NARROW, AND WHY THAT IS DELIBERATE.
 *
 * It fires only when a section looks MORE like the CRGO card than like its own schedule.
 * It does not fire merely because a section is unfamiliar or heavily customised - an
 * agency is entitled to its own items, and rejecting those would change prices that are
 * correct today.
 *
 * The practical consequence, stated because it is the safety argument: relative to the
 * blacklist it replaces this test can only ever newly-REJECT a section (the CRGO card
 * without the signature words), never newly-ACCEPT one - the signature names are folded
 * into the score rather than dropped. So no job's price changes as a result of it.
 *
 * A Wound Core section that equals Amorphous is NOT a finding. Wound Core's shipped
 * default IS a clone of Amorphous (estimateData.ts), and the resolver falls back Wound
 * Core -> Amorphous by design, so "equals Amorphous" cannot distinguish a deliberate sync
 * from a misfiling. The data does not carry that distinction and this does not invent it.
 */
export function checkMasterSection(section: MasterSection, list: EstimateItem[] | undefined): MasterHealth {
  const items = list || [];
  const itemCount = items.length;
  const isEmpty = itemCount === 0;

  const requiredScrapCode = SCRAP_ITEM_CODE_BY_CORE_CLASS[section] ?? null;
  const presentCodes = new Set(codesOf(items));
  const scrapCodePresent = requiredScrapCode !== null && presentCodes.has(requiredScrapCode);

  // Codes used elsewhere in the app for scrap. One of these sitting in a section that
  // requires a different one is the signature of a section filed under the wrong core
  // type - it is how this whole class of defect surfaced.
  const knownScrapCodes = [...new Set(Object.values(SCRAP_ITEM_CODE_BY_CORE_CLASS))];
  const foreignScrapCodes = requiredScrapCode === null
    ? []
    : knownScrapCodes.filter(c => c !== requiredScrapCode && presentCodes.has(c));

  const ownScore = codeOverlap(items, REFERENCE[section]);
  const crgoScore = codeOverlap(items, REFERENCE.CRGO);
  const signatureNames = hasCrgoSignatureNames(items);

  const holdsCrgoCard =
    section !== 'CRGO' &&
    !isEmpty &&
    // Either the codes say CRGO more loudly than they say this section's own schedule,
    // or the CRGO card's signature items are present with a weak own-schedule match.
    ((crgoScore > ownScore && crgoScore >= 0.5) || (signatureNames && ownScore < 0.5));

  // OVERHAULING is exempt from the empty check, and the exemption is not a special case -
  // it is what the section IS. There is no separate Overhauling schedule: an OH job prices
  // through `resolveRate` (SingleJobEstimateReport), which reads the master by item code
  // and otherwise falls through to UGVCL Schedule-A. The shipped default is five items
  // with every rate null - a rate-OVERRIDE shell, not a schedule. Empty is therefore the
  // normal, correct state, and reporting it as a problem trains operators to ignore this
  // panel on the one section where it is always wrong.
  const emptyIsNormal = section === 'OVERHAULING';

  const problems: string[] = [];
  if (holdsCrgoCard) {
    problems.push(
      `The ${SECTION_LABEL[section]} section holds the CRGO card, not the ${SECTION_LABEL[section]} schedule ` +
      `(${itemCount} items; ${Math.round(crgoScore * 100)}% of their codes belong to CRGO, ` +
      `${Math.round(ownScore * 100)}% to ${SECTION_LABEL[section]}).`
    );
  }
  if (isEmpty && !emptyIsNormal) {
    problems.push(`The ${SECTION_LABEL[section]} section is empty - nothing is configured for this core type.`);
  }
  if (requiredScrapCode !== null && !isEmpty && !scrapCodePresent) {
    problems.push(
      `Scrap item code "${requiredScrapCode}" is missing from the ${SECTION_LABEL[section]} section, ` +
      `so a scrap ${SECTION_LABEL[section]} transformer cannot be billed.`
    );
  }
  if (foreignScrapCodes.length > 0) {
    problems.push(
      `The ${SECTION_LABEL[section]} section carries scrap code ${foreignScrapCodes.map(c => `"${c}"`).join(', ')}, ` +
      `which belongs to another core type. This section requires "${requiredScrapCode}".`
    );
  }

  return {
    section,
    label: SECTION_LABEL[section],
    itemCount,
    isEmpty,
    requiredScrapCode,
    scrapCodePresent,
    foreignScrapCodes,
    ownScore,
    crgoScore,
    holdsCrgoCard,
    problems,
    /**
     * Overhauling only. True when the section is empty and that is correct - the caller
     * can then say so positively rather than showing nothing, which reads as "not checked".
     */
    emptyIsNormalHere: emptyIsNormal,
    // ONLY a wrong schedule blocks. A missing scrap code is reported here and already
    // blocks at the point it matters - resolveScrapCharge refuses to bill scrap without
    // it - so blocking every estimate for that would stop correct work over a fault that
    // does not affect it.
    blocking: holdsCrgoCard,
  };
}

/** Section a core type prices from. Mirrors classifyCoreType's classes. */
export function sectionForCoreType(coreType: string): MasterSection {
  const type = String(coreType || 'CRGO').trim().toUpperCase();
  if (type === 'OH' || type.includes('OVERHAUL')) return 'OVERHAULING';
  if (type.includes('AMORPHOUS') || type.includes('AM')) return 'AMORPHOUS';
  if (type.includes('WOUND') || type.includes('WC')) return 'WOUND_CORE';
  return 'CRGO';
}

const STORED: Record<MasterSection, string> = {
  CRGO: 'estimateMasterCRGO',
  AMORPHOUS: 'estimateMasterAmorphous',
  WOUND_CORE: 'estimateMasterWoundCore',
  OVERHAULING: 'estimateMasterOverhauling',
};

/**
 * THE ERROR CHANNEL. `getEstimateMasterForCore` returns `EstimateItem[]` and has nowhere
 * to say "the section I was asked for is wrong, so I used another one" - which is exactly
 * why it fell back silently for however long AARATI has been in this state. This is that
 * missing return value, separated so the pricing path is unchanged.
 *
 * Reads the STORED section, not the resolved one: the resolved list is the fallback's
 * output and looks healthy by construction.
 */
export function storedSection(agency: any, section: MasterSection): EstimateItem[] | undefined {
  // `__storedMasters` is the raw Firestore value, carried alongside by AgencyContext's
  // enrichment. Without it this reads the ENRICHED field, which is never empty and never
  // misfiled - the fallback's output, which is exactly what this check exists to see past.
  // The `??` fallback is for callers holding an agency object from before enrichment.
  return agency?.__storedMasters?.[section] ?? agency?.[STORED[section]];
}

export function validateEstimateMaster(agency: any, coreType: string): MasterHealth {
  const section = sectionForCoreType(coreType);
  return checkMasterSection(section, storedSection(agency, section));
}

/** Every section of an agency's master, for the health line on the master screen. */
export function checkAllMasterSections(agency: any): MasterHealth[] {
  return (Object.keys(STORED) as MasterSection[]).map(s => checkMasterSection(s, storedSection(agency, s)));
}
