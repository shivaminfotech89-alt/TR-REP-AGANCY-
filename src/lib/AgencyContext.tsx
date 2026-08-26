import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { db, auth, handleFirestoreError, OperationType } from './firebase';
import { collection, query, where, getDocs, doc, setDoc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { 
  defaultEstimateData, 
  defaultAmorphousEstimateData, 
  defaultWoundCoreEstimateData, 
  defaultOverhaulingEstimateData, 
  defaultCircleLimitsEstimateData,
  withMissingDefaults,
  EstimateItem
} from './estimateData';
import { checkMasterSection } from './estimateMasterHealth';

export interface GlobalDefaultEstimateMaster {
  estimateMasterCRGO?: EstimateItem[];
  estimateMasterAmorphous?: EstimateItem[];
  estimateMasterWoundCore?: EstimateItem[];
  estimateMasterOverhauling?: EstimateItem[];
  estimateMasterCircleLimits?: EstimateItem[];
  estimateMaster?: EstimateItem[];
  updatedAt?: number;
  updatedBy?: string;
}

let cachedGlobalDefaultEstimateMaster: GlobalDefaultEstimateMaster | null = null;
try {
  const localCached = localStorage.getItem('cached_global_estimate_master');
  if (localCached) {
    cachedGlobalDefaultEstimateMaster = JSON.parse(localCached);
  }
} catch (e) {
  // ignore storage error
}

export interface Agency {
  id: string;
  name: string;
  letterheadUrl: string;
  letterheadMode?: 'full_a4' | 'header_only' | 'standard';
  letterheadHeaderHeightMm?: number;
  letterheadFooterHeightMm?: number;
  letterheadMarginLeftMm?: number;
  letterheadMarginRightMm?: number;
  showPageNumbers?: boolean; // Default true when undefined; turn off if the letterhead already prints page numbers
  prefixes: Record<string, string | Record<string, string>>;
  lastJobNumbers: Record<string, number>;
  allotments?: Record<string, Record<string, number>>;
  gpValidationMonths?: number;
  
  // Agency / Supplier Profile (Tax & Identity)
  /**
   * Registered business name, as it appears on the GST registration. Printed on the TAX
   * INVOICE ONLY - every other screen keeps using `name`, the short working name.
   *
   * Optional, and falls back to `name` wherever it is read, so an agency that has never
   * set it prints exactly what it printed before. Absent means "not distinguished yet",
   * not "blank" - it is never written as an empty string by the form.
   */
  legalName?: string;
  address?: string;
  agencyState?: string; // e.g. "Gujarat"
  agencyStateCode?: string; // e.g. "24"
  gstin?: string; // e.g. "24ABCDE1234F1Z5"
  pan?: string; // e.g. "ABCDE1234F"
  phone?: string;
  email?: string;
  msmeNo?: string; // e.g. "UDYAM-GJ-01-XXXXXXX"

  // Bank & Payment Details
  bankName?: string;
  bankBranch?: string;
  accountNumber?: string;
  ifscCode?: string;

  // DISCOM / Client (Buyer) & Tax Details
  discomName?: string; // e.g. "Uttar Gujarat Vij Company Ltd."
  discomGstin?: string; // e.g. "24AAACU6551F1ZI"
  discomPan?: string; // e.g. "AAACU6551F"
  discomAddress?: string; // e.g. "Registered Office: Sardar Patel Vidyut Bhavan, Race Course, Vadodara - 390007"
  discomState?: string; // e.g. "Gujarat"
  discomStateCode?: string; // e.g. "24"
  serviceSacCode?: string; // e.g. "998719"

  // Authority & Document Routing
  circleOfficeName?: string; // e.g. "SABARMATI"
  circleAuthority?: string; // e.g. "Superintending Engineer (O & M)"
  divisionAuthority?: string; // e.g. "The Executive Engineer"
  estimateCcTemplate?: string; // e.g. "E. E. (O & M) DIVISION - {division}"
  billCcTemplate?: string;

  divisionCircles?: Record<string, string>;
  forwardingToText?: string;
  forwardingSubject?: string;
  forwardingCcText?: string;

  // Amorphous / CRGO Wound Core fixed-rate estimate report text (Schedule-B tender
  // clause + notes). Defaults live in ugvclSchedule2020.ts; overridden per-agency here
  // since another DISCOM's tender wording may differ.
  amorphousClauseText?: string;
  amorphousNoteLtCoil?: string;
  amorphousNoteRadiator?: string;
  estimateMaster?: EstimateItem[];
  estimateMasterCRGO?: EstimateItem[];
  estimateMasterAmorphous?: EstimateItem[];
  estimateMasterWoundCore?: EstimateItem[];
  estimateMasterOverhauling?: EstimateItem[];
  estimateMasterCircleLimits?: EstimateItem[];

  /**
   * GST RATES. Read at fourteen sites each in BillingSystem and declared nowhere until
   * now, so every use was unchecked (AUDIT F65).
   *
   * Each is read as `activeAgency?.cgstPercent !== undefined ? … : 9`. The 9+9 default is
   * the correct CGST/SGST split for an 18% supply and produces a valid invoice, so it is
   * not urgent - but an agency that never configures them issues invoices at a rate nobody
   * chose. Gating the invoice on them belongs with the IGST work (O9), not with a types
   * pass. Recorded, deliberately not changed here.
   */
  cgstPercent?: number;
  sgstPercent?: number;

  /** Printed on documents. Undeclared until now. */
  agencyCode?: string;

  /**
   * SUBSCRIPTION FIELDS - written by AdminPanel, read by almost nothing (AUDIT O34).
   * Declared so the write is type-checked; their emptiness as a feature is a separate item.
   */
  subscriptionStatus?: 'active' | 'trial' | 'expired' | 'suspended';
  subscriptionPlanAmount?: number;
  subscriptionLastPaid?: number;
  subscriptionExpiryDate?: number;
}

export function getEstimateCircleRecipient(agency?: Agency | null, circleOrDivision?: string): string {
  // NO FALLBACK. It used to default to UGVCL's wording, applied to whichever of the four
  // DISCOMs the agency had chosen - so an unset field printed a plausible title nobody
  // had entered. missingForEstimate now gates on it, so an empty value cannot reach a
  // document; if one ever does, a visible blank is the correct symptom (AUDIT O7).
  const authority = agency?.circleAuthority || '';
  const company = agency?.discomName || 'DISCOM';
  let circle = circleOrDivision;
  if (circleOrDivision && agency?.divisionCircles?.[circleOrDivision]) {
    circle = agency.divisionCircles[circleOrDivision];
  } else if (!circle) {
    circle = agency?.circleOfficeName || 'CIRCLE OFFICE';
  }
  return `TO, ${authority},\n${company}\nCircle Office : ${circle}`;
}

export function getEstimateCcText(agency?: Agency | null, division?: string): string {
  const div = division || 'DIVISION';
  const circle = (division && agency?.divisionCircles?.[division]) || agency?.circleOfficeName || div;
  if (agency?.estimateCcTemplate && agency.estimateCcTemplate.trim()) {
    return agency.estimateCcTemplate.replace(/{division}/gi, div).replace(/{circle}/gi, circle);
  }
  if (agency?.forwardingCcText && agency.forwardingCcText.trim()) {
    return agency.forwardingCcText.replace(/{division}/gi, div);
  }
  // NO HARDCODED TAIL. The CC line is a courtesy copy rather than a required field, so
  // it is not gated - but an unset template must produce NO CC line rather than
  // UGVCL's. An empty string is rendered as an omitted line by both callers.
  return '';
}

export function getBillDivisionRecipient(agency?: Agency | null, division?: string): string {
  const div = division || 'DIVISION';
  // NO FALLBACK - see getEstimateCircleRecipient above. Gated by missingForTaxInvoice.
  const authority = agency?.divisionAuthority || '';
  const company = agency?.discomName || 'DISCOM';
  return `To\n${authority}\n${company}\nDivision Office : ${div}`;
}

export interface AllotmentRecord {
  id: string;
  date: string;
  letterNo: string;
  division: string;
  coreType: string;
  quantity: number;
  addedAt: number;
}

/**
 * What seeding a new AT actually found. Returned to the caller so the OPERATOR sees it -
 * a console log reaches the wrong person entirely.
 */
export interface AtSeedReport {
  /** Counter keys and the starting number seeded for each. */
  counters: Record<string, number>;
  /** Job numbers whose numeric tail could not be read, verbatim. */
  unparsed: string[];
  /** Counter keys affected by an unparseable job number. */
  unparsedKeys: string[];
  jobsScanned: number;
}

export interface AtMaster {
  id: string;
  atNumber: string;
  name: string;
  startDate: number;
  endDate: number;
  status: 'Active' | 'Closed';
  agencyId: string;
  lastJobNumbers: Record<string, number>;
  ownerId?: string;
  atPercentage?: number;
  atPercentageCRGO?: number;
  atPercentageAmorphous?: number;
  atPercentageWoundCore?: number;
  allotments?: Record<string, Record<string, number>>;
  allotmentHistory?: AllotmentRecord[];
  prefixes?: Record<string, string | Record<string, string>>;
}

export function getCounterKey(division: string, coreType: string = 'CRGO'): string {
  const div = (division || '').trim();
  const type = (coreType || 'CRGO').trim().toUpperCase();
  if (type === 'OH') {
    return `${div}_OH`;
  } else if (type.includes('AMORPHOUS') || type.includes('AM')) {
    return `${div}_AMORPHOUS`;
  } else if (type.includes('WOUND') || type.includes('WC')) {
    return `${div}_WOUND_CORE`;
  } else {
    return `${div}_CRGO`;
  }
}

/**
 * THE HIGH-WATER MARK OF A SET OF JOB NUMBERS, per counter key.
 *
 * ONE PARSING RULE, used by every screen that saves job numbers (AUDIT F70). The counter is
 * no longer an allocator - it records the highest number actually written - so how a number
 * is read back off the field is now load-bearing, and a second copy of "split on the last
 * dash and parse the tail" that drifted would let a screen quietly stop advancing it.
 *
 * Callers APPLY the result inside whatever transaction they own, advancing only upward.
 * NewJob does it inside the transaction that writes the jobs; MrLedger in its own after the
 * batch. Deliberately not merged into one applier: NewJob's atomicity with the job writes
 * is worth more than sharing five lines.
 */
export function highWaterJobNos(
  rows: { jobNo?: string | null; coreType?: string | null; repairType?: string | null; isGp?: boolean }[],
  division: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if ((r.repairType || '').toUpperCase() === 'GP' || r.isGp) continue;
    const raw = String(r.jobNo ?? '').trim();
    if (!raw) continue;
    // The tail after the LAST dash - prefixes themselves may contain one ("21 IS", "OH-A").
    const dash = raw.lastIndexOf('-');
    if (dash < 0) continue;
    const num = parseInt(raw.slice(dash + 1), 10);
    if (!Number.isFinite(num) || num <= 0) continue;
    const key = getCounterKey(division, r.coreType || 'CRGO');
    if (!out[key] || num > out[key]) out[key] = num;
  }
  return out;
}

export function getAtPercentageForCore(at: AtMaster | null | undefined, coreType: string = 'CRGO'): number {
  if (!at) return 4;
  const type = (coreType || 'CRGO').trim().toUpperCase();
  if (type.includes('AMORPHOUS') || type.includes('AM')) {
    if (at.atPercentageAmorphous !== undefined && !isNaN(Number(at.atPercentageAmorphous))) {
      return Number(at.atPercentageAmorphous);
    }
  } else if (type.includes('WOUND') || type.includes('WC')) {
    if (at.atPercentageWoundCore !== undefined && !isNaN(Number(at.atPercentageWoundCore))) {
      return Number(at.atPercentageWoundCore);
    }
  } else {
    if (at.atPercentageCRGO !== undefined && !isNaN(Number(at.atPercentageCRGO))) {
      return Number(at.atPercentageCRGO);
    }
  }
  return at.atPercentage !== undefined && !isNaN(Number(at.atPercentage)) ? Number(at.atPercentage) : 4;
}

export function getEstimateMasterForCore(
  agency: Agency | null | undefined, 
  coreType: string = 'CRGO',
  fallbackDefaults?: GlobalDefaultEstimateMaster | null
): EstimateItem[] {
  const globalDef = fallbackDefaults || cachedGlobalDefaultEstimateMaster;
  const type = (coreType || 'CRGO').trim().toUpperCase();

  const normalizeUnits = (list: EstimateItem[]) => list.map(item => ({
    ...item,
    unit: (item.unit || '').toLowerCase().includes('each') || (item.unit || '').toLowerCase().includes('transformer') ? 'QTY' : (item.unit || 'QTY')
  }));

  if (type === 'OH' || type.includes('OVERHAUL')) {
    if (agency?.estimateMasterOverhauling && agency.estimateMasterOverhauling.length > 0) {
      return withMissingDefaults(normalizeUnits(agency.estimateMasterOverhauling), defaultOverhaulingEstimateData);
    }
    if (globalDef?.estimateMasterOverhauling && globalDef.estimateMasterOverhauling.length > 0) {
      return withMissingDefaults(normalizeUnits(globalDef.estimateMasterOverhauling), defaultOverhaulingEstimateData);
    }
    return defaultOverhaulingEstimateData;
  }

  if (type.includes('AMORPHOUS') || type.includes('AM')) {
    if (agency?.estimateMasterAmorphous && agency.estimateMasterAmorphous.length > 0) {
      return withMissingDefaults(normalizeUnits(agency.estimateMasterAmorphous), defaultAmorphousEstimateData);
    }
    if (globalDef?.estimateMasterAmorphous && globalDef.estimateMasterAmorphous.length > 0) {
      return withMissingDefaults(normalizeUnits(globalDef.estimateMasterAmorphous), defaultAmorphousEstimateData);
    }
    return defaultAmorphousEstimateData;
  }

  if (type.includes('WOUND') || type.includes('WC')) {
    // Was a blacklist of four item-name substrings. Now a POSITIVE identity test: do this
    // section's item codes belong to the CRGO card rather than to Schedule-B? The
    // blacklist produced a confident verdict from an incomplete test - a CRGO card
    // without those exact words passed as a valid Wound Core master and priced Wound Core
    // jobs from CRGO item rates (AUDIT F27).
    //
    // The signature names are folded into the score rather than dropped, so relative to
    // the blacklist this can only newly REJECT a CRGO card, never newly accept anything.
    // No job's price changes. The fallback below is deliberately untouched - it is what
    // keeps pricing correct while the stored data is wrong. What was missing was not a
    // better fallback but any way to SAY it had happened: that is validateEstimateMaster
    // in lib/estimateMasterHealth.ts, which the pricing screens now block on.
    const isLegacy = (arr?: EstimateItem[]) =>
      arr !== undefined && checkMasterSection('WOUND_CORE', arr).holdsCrgoCard;

    if (agency?.estimateMasterWoundCore && agency.estimateMasterWoundCore.length > 0 && !isLegacy(agency.estimateMasterWoundCore)) {
      return withMissingDefaults(normalizeUnits(agency.estimateMasterWoundCore), defaultWoundCoreEstimateData);
    }
    if (globalDef?.estimateMasterWoundCore && globalDef.estimateMasterWoundCore.length > 0 && !isLegacy(globalDef.estimateMasterWoundCore)) {
      return withMissingDefaults(normalizeUnits(globalDef.estimateMasterWoundCore), defaultWoundCoreEstimateData);
    }
    if (agency?.estimateMasterAmorphous && agency.estimateMasterAmorphous.length > 0 && !isLegacy(agency.estimateMasterAmorphous)) {
      return withMissingDefaults(normalizeUnits(agency.estimateMasterAmorphous), defaultWoundCoreEstimateData);
    }
    if (globalDef?.estimateMasterAmorphous && globalDef.estimateMasterAmorphous.length > 0 && !isLegacy(globalDef.estimateMasterAmorphous)) {
      return withMissingDefaults(normalizeUnits(globalDef.estimateMasterAmorphous), defaultWoundCoreEstimateData);
    }
    return defaultWoundCoreEstimateData;
  }

  // CRGO
  if (agency?.estimateMasterCRGO && agency.estimateMasterCRGO.length > 0) {
    return withMissingDefaults(agency.estimateMasterCRGO, defaultEstimateData);
  }
  if (globalDef?.estimateMasterCRGO && globalDef.estimateMasterCRGO.length > 0) {
    return withMissingDefaults(globalDef.estimateMasterCRGO, defaultEstimateData);
  }
  // STEPS 3 AND 4 ARE UNREACHABLE TODAY. DO NOT DELETE THEM AS DEAD CODE.
  //
  // `estimateMaster` is the pre-sections CRGO field. Nothing writes it any more (AUDIT D4)
  // and no agency needs it, because step 1 or step 2 always answers first: every agency is
  // created with `estimateMasterCRGO`, and `public_config` holds a CRGO section that step 2
  // finds. So these two lines cannot currently be reached.
  //
  // They stay because "cannot currently be reached" is a statement about DATA, not about
  // code. They become live the moment BOTH are true: an agency's own CRGO section is empty,
  // AND public_config's CRGO section is empty or failed to load. In that state an agency
  // that has never been migrated still prices from its own stored card instead of falling
  // to the shipped defaults, which is a different set of rates.
  //
  // Removing them is a behaviour change in a path no test covers, for no benefit - the
  // stored data is inert either way now that nothing refreshes it. When the field is
  // eventually cleared from every document, these go with it, and not before.
  if (agency?.estimateMaster && agency.estimateMaster.length > 0) {
    return withMissingDefaults(agency.estimateMaster, defaultEstimateData);
  }
  if (globalDef?.estimateMaster && globalDef.estimateMaster.length > 0) {
    return withMissingDefaults(globalDef.estimateMaster, defaultEstimateData);
  }
  return defaultEstimateData;
}

export function getCircleLimitsEstimateMaster(
  agency: Agency | null | undefined,
  fallbackDefaults?: GlobalDefaultEstimateMaster | null
): EstimateItem[] {
  const globalDef = fallbackDefaults || cachedGlobalDefaultEstimateMaster;
  if (agency?.estimateMasterCircleLimits && agency.estimateMasterCircleLimits.length > 0) {
    return agency.estimateMasterCircleLimits;
  }
  if (globalDef?.estimateMasterCircleLimits && globalDef.estimateMasterCircleLimits.length > 0) {
    return globalDef.estimateMasterCircleLimits;
  }
  return defaultCircleLimitsEstimateData;
}

interface AgencyContextType {
  agencies: Agency[];
  activeAgency: Agency | null;
  setActiveAgencyId: (id: string) => void;
  loading: boolean;
  isSuperAdmin: boolean;
  globalDefaultEstimateMaster: GlobalDefaultEstimateMaster | null;
  globalConfigError: string | null;
  globalConfigLoaded: boolean;
  dismissGlobalConfigError: () => void;
  /** Returns the new agency's id so the caller can select it (F30). */
  addAgency: (agencyData: Omit<Agency, 'id'>) => Promise<string | undefined>;
  updateAgency: (id: string, agencyData: Partial<Agency>) => Promise<void>;
  updateAllAgenciesEstimateMaster: (payload: {
    estimateMasterCRGO?: EstimateItem[];
    estimateMasterAmorphous?: EstimateItem[];
    estimateMasterWoundCore?: EstimateItem[];
    estimateMasterOverhauling?: EstimateItem[];
    estimateMasterCircleLimits?: EstimateItem[];
    estimateMaster?: EstimateItem[];
  }) => Promise<void>;
  countOverridesForApply: (
    payload: Record<string, EstimateItem[] | undefined>,
    targetAgencyIds: string[],
  ) => Promise<Array<{ id: string; name: string; overrides: number; inheritingCellsFrozen: number; sections: Record<string, number>; sectionWrites: Array<{ field: string; rowsBefore: number; rowsAfter: number; added: number; removed: number }> }>>;
  applyEstimateMasterToOwnAgencies: (
    payload: Record<string, EstimateItem[] | undefined>,
    targetAgencyIds: string[],
  ) => Promise<void>;
  saveGlobalDefaultEstimateMaster: (payload: {
    estimateMasterCRGO?: EstimateItem[];
    estimateMasterAmorphous?: EstimateItem[];
    estimateMasterWoundCore?: EstimateItem[];
    estimateMasterOverhauling?: EstimateItem[];
    estimateMasterCircleLimits?: EstimateItem[];
    estimateMaster?: EstimateItem[];
  }) => Promise<void>;
  
  atMasters: AtMaster[];
  activeAtMaster: AtMaster | null;
  setActiveAtMasterId: (id: string) => void;
  addAtMaster: (atData: Omit<AtMaster, 'id' | 'ownerId'>) => Promise<{ id: string; seed: AtSeedReport } | undefined>;
  updateAtMaster: (id: string, atData: Partial<AtMaster>) => Promise<void>;

  predictNextJobNo: (division: string, coreType?: string, repairType?: string, atMasterId?: string) => { prefix: string | null, nextNum: number, counterKey: string };
  getJobNoPrefix: (division: string, coreType?: string, atMasterId?: string) => { prefix: string | null; counterKey: string };
  syncCountersState: (isAtMaster: boolean, id: string, newCounters: Record<string, number>) => void;
}

const AgencyContext = createContext<AgencyContextType | undefined>(undefined);

export function AgencyProvider({ children }: { children: ReactNode }) {
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [activeAgencyId, setActiveAgencyIdState] = useState<string | null>(localStorage.getItem('activeAgencyId') || null);
  
  const [atMasters, setAtMasters] = useState<AtMaster[]>([]);
  
  const getInitialAtId = () => {
    const agId = localStorage.getItem('activeAgencyId');
    // ONLY the agency-scoped key. The legacy global `activeAtMasterId` is no longer
    // read, written or listened to: a selection stored with no agency attached cannot be
    // restored correctly to anything - restoring it applied one agency's AT to whichever
    // agency loaded first, which is the cross-agency leak this whole change closes.
    return (agId && localStorage.getItem(`activeAtMasterId_${agId}`)) || null;
  };

  const [activeAtMasterId, setActiveAtMasterIdState] = useState<string | null>(getInitialAtId());
  
  const [globalDefaultEstimateMaster, setGlobalDefaultEstimateMaster] = useState<GlobalDefaultEstimateMaster | null>(cachedGlobalDefaultEstimateMaster);
  const [globalConfigError, setGlobalConfigError] = useState<string | null>(null);
  const [globalConfigLoaded, setGlobalConfigLoaded] = useState<boolean>(!!cachedGlobalDefaultEstimateMaster);
  const [loading, setLoading] = useState(true);

  const dismissGlobalConfigError = () => setGlobalConfigError(null);

  const setActiveAgencyId = (id: string | null) => {
    setActiveAgencyIdState(id);
    if (id) {
      localStorage.setItem('activeAgencyId', id);
      const scopedAtId = localStorage.getItem(`activeAtMasterId_${id}`);
      if (scopedAtId) {
        setActiveAtMasterIdState(scopedAtId);
      } else {
        const agencyAts = atMasters.filter(at => at.agencyId === id);
        const activeAts = agencyAts.filter(at => at.status === 'Active');
        const chosenAt = activeAts.length > 0 ? activeAts[0] : agencyAts[0];
        if (chosenAt) {
          setActiveAtMasterIdState(chosenAt.id);
          localStorage.setItem(`activeAtMasterId_${id}`, chosenAt.id);
        }
      }
    } else {
      localStorage.removeItem('activeAgencyId');
    }
  };

  const setActiveAtMasterId = (id: string | null) => {
    setActiveAtMasterIdState(id);
    // Persist ONLY against an agency. With no active agency the selection is held in
    // state but not written: a global-only record cannot be attributed to anything, so
    // restoring it later means guessing which agency it belonged to. Not persisting is
    // better than persisting something unattributable.
    if (!activeAgencyId) return;
    if (id) {
      localStorage.setItem(`activeAtMasterId_${activeAgencyId}`, id);
    } else {
      localStorage.removeItem(`activeAtMasterId_${activeAgencyId}`);
    }
  };

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'activeAgencyId') {
        setActiveAgencyIdState(e.newValue);
        if (e.newValue) {
          const scopedAt = localStorage.getItem(`activeAtMasterId_${e.newValue}`);
          if (scopedAt) setActiveAtMasterIdState(scopedAt);
        }
      }
      // Scoped key only. Listening to the global key let another tab push a FOREIGN
      // agency's AT id into this tab's state - the same leak as the initial read.
      if (activeAgencyId && e.key === `activeAtMasterId_${activeAgencyId}`) {
        setActiveAtMasterIdState(e.newValue);
      }
      if (e.key === 'cached_global_estimate_master' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          setGlobalDefaultEstimateMaster(parsed);
          cachedGlobalDefaultEstimateMaster = parsed;
        } catch (_) {}
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [activeAgencyId]);

  useEffect(() => {
    async function fetchData() {
      if (!auth.currentUser) return;
      try {
        // 1. Fetch Global System Default Estimate Rates from Firestore public_config
        let fetchedGlobalMaster: GlobalDefaultEstimateMaster | null = null;
        try {
          const publicConfigRef = doc(db, 'public_config', 'estimate_master');
          const publicConfigSnap = await getDoc(publicConfigRef);
          if (publicConfigSnap.exists()) {
            fetchedGlobalMaster = publicConfigSnap.data() as GlobalDefaultEstimateMaster;
            setGlobalDefaultEstimateMaster(fetchedGlobalMaster);
            cachedGlobalDefaultEstimateMaster = fetchedGlobalMaster;
            localStorage.setItem('cached_global_estimate_master', JSON.stringify(fetchedGlobalMaster));
            setGlobalConfigError(null);
            setGlobalConfigLoaded(true);
          } else {
            const globalConfigRef = doc(db, 'system_config', 'estimate_master');
            const globalConfigSnap = await getDoc(globalConfigRef);
            if (globalConfigSnap.exists()) {
              fetchedGlobalMaster = globalConfigSnap.data() as GlobalDefaultEstimateMaster;
              setGlobalDefaultEstimateMaster(fetchedGlobalMaster);
              cachedGlobalDefaultEstimateMaster = fetchedGlobalMaster;
              localStorage.setItem('cached_global_estimate_master', JSON.stringify(fetchedGlobalMaster));
              setGlobalConfigError(null);
              setGlobalConfigLoaded(true);
            } else {
              setGlobalConfigError('Global estimate defaults (public_config/estimate_master) could not be loaded: document not found in database. Local defaults are currently in use.');
              setGlobalConfigLoaded(false);
            }
          }
        } catch (e: any) {
          const errDetail = e?.message || 'Access error';
          console.warn('Could not fetch global public_config/estimate_master:', e);
          setGlobalConfigError(`Global estimate defaults could not be loaded (${errDetail}). Local application defaults are currently in use.`);
          setGlobalConfigLoaded(false);
        }

        // 2. Fetch Agencies
        const agQ = query(collection(db, 'agencies'), where('ownerId', '==', auth.currentUser.uid));
        const agSnapshot = await getDocs(agQ);
        const fetchedAgencies = agSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Agency));
        
        // If agencies don't have rates or have empty rates, populate with global defaults.
        //
        // NOTE WHAT THIS COSTS, because a check shipped in F27 was reading the wrong thing
        // because of it: after enrichment NO agency object in memory has an empty section.
        // `activeAgency.estimateMasterWoundCore` is the RESOLVED value, never the stored
        // one, so anything asking "what does this agency actually have stored" and reading
        // the context gets the fallback's output and concludes all is well.
        //
        // The enrichment itself is left alone - pricing reads these fields and changing
        // that would change prices. The raw values are carried alongside instead, under
        // __storedMasters, so a health check can see what Firestore really holds.
        const rawMasters = (ag: any) => ({
          CRGO: ag.estimateMasterCRGO,
          AMORPHOUS: ag.estimateMasterAmorphous,
          WOUND_CORE: ag.estimateMasterWoundCore,
          OVERHAULING: ag.estimateMasterOverhauling,
          CIRCLE_LIMITS: ag.estimateMasterCircleLimits,
        });

        // `arr || fallback` is wrong for arrays: [] is TRUTHY, so an empty section stored
        // in public_config would be used in place of the shipped default. Same bug as the
        // one fixed in addAgency below.
        const nonEmpty = <T,>(arr: T[] | undefined, fallback: T[]): T[] =>
          (arr && arr.length > 0) ? arr : fallback;

        const enrichedAgencies = fetchedAgencies.map(ag => ({
          ...ag,
          __storedMasters: rawMasters(ag),
          estimateMasterCRGO: (ag.estimateMasterCRGO && ag.estimateMasterCRGO.length > 0) 
            ? ag.estimateMasterCRGO 
            : nonEmpty(fetchedGlobalMaster?.estimateMasterCRGO, defaultEstimateData),
          estimateMaster: (ag.estimateMaster && ag.estimateMaster.length > 0) 
            ? ag.estimateMaster 
            : nonEmpty(fetchedGlobalMaster?.estimateMasterCRGO, defaultEstimateData),
          estimateMasterAmorphous: (ag.estimateMasterAmorphous && ag.estimateMasterAmorphous.length > 0) 
            ? ag.estimateMasterAmorphous 
            : nonEmpty(fetchedGlobalMaster?.estimateMasterAmorphous, defaultAmorphousEstimateData),
          estimateMasterWoundCore: (ag.estimateMasterWoundCore && ag.estimateMasterWoundCore.length > 0) 
            ? ag.estimateMasterWoundCore 
            : nonEmpty(fetchedGlobalMaster?.estimateMasterWoundCore, defaultWoundCoreEstimateData),
          estimateMasterOverhauling: (ag.estimateMasterOverhauling && ag.estimateMasterOverhauling.length > 0) 
            ? ag.estimateMasterOverhauling 
            : nonEmpty(fetchedGlobalMaster?.estimateMasterOverhauling, defaultOverhaulingEstimateData),
          estimateMasterCircleLimits: (ag.estimateMasterCircleLimits && ag.estimateMasterCircleLimits.length > 0) 
            ? ag.estimateMasterCircleLimits 
            : nonEmpty(fetchedGlobalMaster?.estimateMasterCircleLimits, defaultCircleLimitsEstimateData),
        }));

        setAgencies(enrichedAgencies);
        
        let currentActiveAgId = activeAgencyId;
        if (enrichedAgencies.length > 0 && !enrichedAgencies.find(a => a.id === activeAgencyId)) {
          currentActiveAgId = enrichedAgencies[0].id;
          setActiveAgencyId(currentActiveAgId);
        }

        // 3. Fetch AT Masters
        const atQ = query(collection(db, 'atMasters'), where('ownerId', '==', auth.currentUser.uid));
        const atSnapshot = await getDocs(atQ);
        const fetchedAts = atSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as AtMaster));
        setAtMasters(fetchedAts);
        
        const targetAgId = currentActiveAgId || (enrichedAgencies[0]?.id);
        const agencyAts = targetAgId ? fetchedAts.filter(at => at.agencyId === targetAgId) : fetchedAts;
        const scopedStoredAt = targetAgId ? localStorage.getItem(`activeAtMasterId_${targetAgId}`) : null;

        if (scopedStoredAt && agencyAts.some(at => at.id === scopedStoredAt)) {
          setActiveAtMasterIdState(scopedStoredAt);
        } else if (agencyAts.length > 0 && !agencyAts.find(a => a.id === activeAtMasterId)) {
          const activeAts = agencyAts.filter(at => at.status === 'Active');
          const chosen = activeAts.length > 0 ? activeAts[0] : agencyAts[0];
          setActiveAtMasterId(chosen.id);
        // Safe, but only because the branch above already handled the agency-scoped
        // case: this one searches UNFILTERED `fetchedAts`, so an id from another agency
        // IS found and the branch is skipped. It is reachable only when `agencyAts` is
        // empty - an agency with no ATs - where skipping is correct because there is
        // nothing to activate. If the condition above ever changes, re-check this one:
        // matching against the unfiltered list is not agency-scoped on its own.
        } else if (fetchedAts.length > 0 && !fetchedAts.find(a => a.id === activeAtMasterId)) {
          const activeAts = fetchedAts.filter(at => at.status === 'Active');
          setActiveAtMasterId(activeAts.length > 0 ? activeAts[0].id : fetchedAts[0].id);
        }
      } catch (err) {
        console.error('Error fetching context data:', err);
      } finally {
        setLoading(false);
      }
    }
    if (auth.currentUser) {
      fetchData();
    } else {
      setAgencies([]);
      setAtMasters([]);
      setActiveAgencyId(null);
      setActiveAtMasterId(null);
      setLoading(false);
    }
  }, [auth.currentUser]);

  const activeAgency = agencies.find(a => a.id === activeAgencyId) || null;
  const activeAtMaster = atMasters.find(a => a.id === activeAtMasterId && a.agencyId === activeAgencyId) || null;

  const isSuperAdmin = auth.currentUser?.email?.toLowerCase().trim() === 'shivaminfotech89@gmail.com';

  const saveGlobalDefaultEstimateMaster = async (payload: {
    estimateMasterCRGO?: EstimateItem[];
    estimateMasterAmorphous?: EstimateItem[];
    estimateMasterWoundCore?: EstimateItem[];
    estimateMasterOverhauling?: EstimateItem[];
    estimateMasterCircleLimits?: EstimateItem[];
    estimateMaster?: EstimateItem[];
  }) => {
    if (!isSuperAdmin) {
      throw new Error('Permission denied: Only system administrators can publish global default estimate rates.');
    }
    try {
      const globalPayload = {
        ...payload,
        updatedAt: Date.now(),
        updatedBy: auth.currentUser?.email || auth.currentUser?.uid || 'superadmin'
      };

      const publicRef = doc(db, 'public_config', 'estimate_master');
      await setDoc(publicRef, globalPayload, { merge: true });

      // Also mirror to system_config for backwards compatibility
      try {
        const globalRef = doc(db, 'system_config', 'estimate_master');
        await setDoc(globalRef, globalPayload, { merge: true });
      } catch (_) {}

      setGlobalDefaultEstimateMaster(prev => ({
        ...(prev || {}),
        ...globalPayload
      }));
      cachedGlobalDefaultEstimateMaster = {
        ...(cachedGlobalDefaultEstimateMaster || {}),
        ...globalPayload
      };
      localStorage.setItem('cached_global_estimate_master', JSON.stringify(cachedGlobalDefaultEstimateMaster));

      // NO FAN-OUT HERE ANY MORE - see applyEstimateMasterToOwnAgencies below.
      //
      // This used to also loop the caller's agencies and updateDoc each one, which made one
      // button do two things with very different reach: writing public_config seeds every
      // future agency for every user and cannot be undone by the actor for anyone else,
      // while writing your own agencies is owner-scoped and repeatable. Naming one of those
      // two is how someone publishes a baseline meaning to update their own agencies.
      //
      // Splitting them also exposes an effect the bundle hid: `getEstimateMasterForCore`
      // checks `agency.estimateMasterCRGO` BEFORE `globalDef.estimateMasterCRGO`, so
      // publishing never changed the prices of an agency that has its own CRGO section. The
      // fan-out was doing the entire visible half of this button's job.
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'public_config');
      throw err;
    }
  };

  /**
   * What applying `payload` to the caller's OTHER agencies would destroy, counted from a
   * FRESH read of each target document.
   *
   * WHY IT RE-READS RATHER THAN USING `agencies`. The in-memory copy is from page load. A
   * confirmation dialog is a safety claim, and a claim that was true when the page loaded
   * and false when the button was pressed is worse than no claim - another tab, another
   * session, or an edit made twenty minutes ago all falsify it silently. Four documents is
   * nothing against saying a true number.
   *
   * WHAT COUNTS AS AN OVERRIDE. A target cell holding a non-null value that differs from
   * what the source would write. A null target cell is INHERITING - it resolves through
   * Schedule-A at estimate time and loses nothing it had chosen. An equal value changes
   * nothing. A non-null target against a null source counts too: the cell stops being a
   * fixed rate and reverts to inheriting, which is just as much a decision undone.
   *
   * The read is deliberately of the RAW document, never of the enriched context object.
   * Enrichment fills every empty section from public_config or the shipped defaults, so an
   * agency storing nothing would report hundreds of overrides about to be destroyed - the
   * same trap the F27 health check fell into.
   */
  const countOverridesForApply = async (
    payload: Record<string, EstimateItem[] | undefined>,
    targetAgencyIds: string[],
  ): Promise<Array<{ id: string; name: string; overrides: number; inheritingCellsFrozen: number; sections: Record<string, number>; sectionWrites: Array<{ field: string; rowsBefore: number; rowsAfter: number; added: number; removed: number }> }>> => {
    const KVA_KEYS = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'];
    const num = (v: any): number | null =>
      (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);

    const results = [];
    for (const id of targetAgencyIds) {
      const snap = await getDoc(doc(db, 'agencies', id));
      if (!snap.exists()) continue;
      const stored: any = snap.data();
      let overrides = 0;
      let inheritingCellsFrozen = 0;
      const sections: Record<string, number> = {};

      // EVERY SECTION THE WRITE TOUCHES, whether or not any cell differs.
      //
      // The cell count below iterates the INCOMING rows and looks each up in the target, so
      // a row present in the target and absent from the payload is never visited and never
      // counted. That made an entire section being replaced invisible whenever the values
      // happened to match - and a section replaced wholesale with the same row count looked
      // like no change at all (AUDIT O31). Rows added and removed are counted here, from
      // both directions, and reported even when the count is zero: "this will also write
      // Overhauling (5 rows)" is the sentence that was missing.
      const sectionWrites: Array<{ field: string; rowsBefore: number; rowsAfter: number; added: number; removed: number }> = [];
      for (const [field, incoming] of Object.entries(payload)) {
        if (!Array.isArray(incoming)) continue;
        const existing: any[] = Array.isArray(stored[field]) ? stored[field] : [];
        const codeOf = (it: any) => String(it?.itemCode ?? '').trim().toLowerCase();
        const before = new Set(existing.map(codeOf).filter(Boolean));
        const after = new Set(incoming.map(codeOf).filter(Boolean));
        sectionWrites.push({
          field,
          rowsBefore: existing.length,
          rowsAfter: incoming.length,
          added: [...after].filter(c => !before.has(c)).length,
          removed: [...before].filter(c => !after.has(c)).length,
        });
      }

      for (const [field, incoming] of Object.entries(payload)) {
        if (!Array.isArray(incoming)) continue;
        const existing: any[] = Array.isArray(stored[field]) ? stored[field] : [];
        if (existing.length === 0) continue;   // nothing stored: nothing to lose
        const byCode = new Map<string, any>();
        existing.forEach(it => byCode.set(String(it?.itemCode ?? '').trim().toLowerCase(), it));

        let sectionCount = 0;
        for (const item of incoming) {
          const target = byCode.get(String(item?.itemCode ?? '').trim().toLowerCase());
          if (!target) continue;               // row absent from the target: nothing to lose
          for (const k of KVA_KEYS) {
            const was = num(target.rates?.[k]);
            const will = num((item as any).rates?.[k]);
            if (was === null && will !== null) inheritingCellsFrozen++;
            else if (was !== null && was !== will) sectionCount++;
          }
        }
        if (sectionCount > 0) sections[field] = sectionCount;
        overrides += sectionCount;
      }
      results.push({ id, name: stored.name || id, overrides, inheritingCellsFrozen, sections, sectionWrites });
    }
    return results;
  };

  /**
   * Apply an estimate-master payload to the signed-in user's OWN agencies.
   *
   * NOT PRIVILEGED, and it does not need to be. `firestore.rules:256` allows an agencies
   * update when `existing().ownerId == request.auth.uid`, and `isValidAgency` does not
   * inspect the estimateMaster* fields at all - so this passes the rules exactly as they
   * are written. Nothing here touches public_config or system_config, which is the only
   * part of the old combined action that ever required admin rights.
   */
  const applyEstimateMasterToOwnAgencies = async (
    payload: Record<string, EstimateItem[] | undefined>,
    targetAgencyIds: string[],
  ) => {
    if (!auth.currentUser) throw new Error('Not signed in.');
    const owned = new Set(agencies.map(a => a.id));
    // The rules would refuse a foreign id anyway; refusing here means the failure names
    // itself instead of arriving as a permission error from four parallel writes.
    const targets = targetAgencyIds.filter(id => owned.has(id));
    if (targets.length === 0) return;
    try {
      // STAMPED, like the per-agency save. Omitting it was an oversight, and a bulk write
      // is the case where the stamp matters most - it is the one where nobody is looking at
      // each agency as it changes. Without it, agencies rewritten seconds ago read as
      // "never edited", which is an assertion rather than silence (AUDIT D5).
      const stamp = {
        estimateMasterEditedAt: serverTimestamp(),
        estimateMasterEditedBy: auth.currentUser?.email || auth.currentUser?.uid || '',
      };
      await Promise.all(targets.map(id => updateDoc(doc(db, 'agencies', id), { ...payload, ...stamp } as any)));
      const targetSet = new Set(targets);
      setAgencies(prev => prev.map(a => a.id === undefined || !targetSet.has(a.id) ? a : ({
        ...a,
        ...payload,
        // A local Date, not the serverTimestamp sentinel - that is a write instruction, not
        // a value, and putting it in React state would render as an unparseable object
        // until the next reload. The server's own timestamp replaces this on refetch.
        estimateMasterEditedAt: new Date(),
        estimateMasterEditedBy: auth.currentUser?.email || auth.currentUser?.uid || '',
        // Keep the raw-value shadow in step with the write, or the next health check and
        // the next override count both read a stale picture of what is stored.
        __storedMasters: {
          ...((a as any).__storedMasters || {}),
          ...(payload.estimateMasterCRGO ? { CRGO: payload.estimateMasterCRGO } : {}),
          ...(payload.estimateMasterAmorphous ? { AMORPHOUS: payload.estimateMasterAmorphous } : {}),
          ...(payload.estimateMasterWoundCore ? { WOUND_CORE: payload.estimateMasterWoundCore } : {}),
          ...(payload.estimateMasterOverhauling ? { OVERHAULING: payload.estimateMasterOverhauling } : {}),
          ...(payload.estimateMasterCircleLimits ? { CIRCLE_LIMITS: payload.estimateMasterCircleLimits } : {}),
        },
      } as any)));
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'agencies');
      throw err;
    }
  };

  /** Returns the new agency's id so the caller can select it. */
  const addAgency = async (agencyData: Omit<Agency, 'id'>): Promise<string | undefined> => {
    if (!auth.currentUser) return undefined;
    try {
      const newRef = doc(collection(db, 'agencies'));
      
      // SEEDING A NEW AGENCY'S ESTIMATE MASTER.
      //
      // TWO BUGS FIXED HERE, both of which propagated bad data into every agency created
      // afterwards (AUDIT F30).
      //
      // 1. It seeded from `activeAgency` - whichever agency happened to be selected at the
      //    moment of creation. That is how three of four agencies came to hold IDENTICAL
      //    32-item CRGO cards in their Wound Core section: one agency acquired it from a
      //    pre-6282d3f fallback, and every agency created while it was active inherited it
      //    verbatim. Nothing recorded which agency was the template, so the provenance is
      //    unrecoverable - the same class as the seeded DISCOM identity in O7. A new
      //    agency now inherits the published shared default or the shipped defaults, and
      //    never another agency's data.
      //
      //    (It was reading the ENRICHED `activeAgency` besides, so even an agency with
      //    nothing stored handed over its fallback content as though it were configured.)
      //
      // 2. `arr || fallback` is wrong for arrays: `[]` is TRUTHY in JavaScript, so an
      //    empty stored section was used instead of falling through to the shipped
      //    default. Everywhere else in this file the test is `arr && arr.length > 0`; here
      //    it was not, which is a plausible route by which empty sections spread.
      const seed = <T,>(published: T[] | undefined, shipped: T[]): T[] =>
        (published && published.length > 0) ? published : shipped;

      const defaultCRGO = seed(globalDefaultEstimateMaster?.estimateMasterCRGO, defaultEstimateData);
      const defaultAmorphous = seed(globalDefaultEstimateMaster?.estimateMasterAmorphous, defaultAmorphousEstimateData);
      const defaultWoundCore = seed(globalDefaultEstimateMaster?.estimateMasterWoundCore, defaultWoundCoreEstimateData);
      const defaultOverhauling = seed(globalDefaultEstimateMaster?.estimateMasterOverhauling, defaultOverhaulingEstimateData);
      const defaultCircleLimits = seed(globalDefaultEstimateMaster?.estimateMasterCircleLimits, defaultCircleLimitsEstimateData);

      const newAgency = { 
        estimateMasterCRGO: defaultCRGO,
        // No `estimateMaster` mirror - a new agency has no legacy to support, and being
        // born with an unread duplicate is how every existing agency acquired one. D4.
        estimateMasterAmorphous: defaultAmorphous,
        estimateMasterWoundCore: defaultWoundCore,
        estimateMasterOverhauling: defaultOverhauling,
        estimateMasterCircleLimits: defaultCircleLimits,
        ...agencyData, 
        ownerId: auth.currentUser.uid 
      };
      // CREATION TIME, FROM THE SERVER CLOCK (AUDIT A4 -> F38).
      //
      // Agencies and ATs recorded no creation timestamp at all, which has now blocked two
      // separate questions: "which AT is the newest" while diagnosing a misattached one,
      // and "which agencies predate the public_config correction" during the census. Both
      // had to fall back to proxies - startDate, which is a tender date an operator types,
      // and the earliest job under an agency, which says nothing about agencies with no
      // jobs.
      //
      // Not retroactive: existing documents stay undated forever. This stops the gap
      // widening, which is the only thing still available.
      //
      // serverTimestamp() rather than Date.now() for the reason recorded in A5: a stamp
      // from the same browser clock as everything else it would corroborate cannot
      // corroborate anything. formatDDMMYYYY already reads Timestamps (F23).
      //
      // Deliberately NOT added to the local state object below: serverTimestamp() is a
      // sentinel, not a value, and storing it in React state would put a FieldValue where
      // a date is expected. Absent locally until the next fetch is the honest state.
      await setDoc(newRef, { ...newAgency, createdAt: serverTimestamp() });
      setAgencies(prev => [...prev, { id: newRef.id, ...newAgency }]);
      // Activate the agency just created. The old guard was `if (!activeAgencyId)` -
      // "is anything stored" where it meant "is this the one being worked on". Creating
      // a second agency while another was active left the first one active, so an AT
      // added next was written with the WRONG agencyId: a successful write, filtered out
      // of the new agency's list and appearing under the old one. Same guard shape as
      // F20 in atMasters (see the pattern note on scope-specific guards).
      setActiveAgencyId(newRef.id);
      return newRef.id;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'agencies');
      throw err;
    }
  };

  const updateAgency = async (id: string, agencyData: Partial<Agency>) => {
    try {
      const ref = doc(db, 'agencies', id);
      await updateDoc(ref, agencyData);
      setAgencies(prev => prev.map(a => a.id === id ? { ...a, ...agencyData } : a));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'agencies');
      throw err;
    }
  };

  const updateAllAgenciesEstimateMaster = async (payload: {
    estimateMasterCRGO?: EstimateItem[];
    estimateMasterAmorphous?: EstimateItem[];
    estimateMasterWoundCore?: EstimateItem[];
    estimateMasterOverhauling?: EstimateItem[];
    estimateMasterCircleLimits?: EstimateItem[];
    estimateMaster?: EstimateItem[];
  }) => {
    // Automatically save as global default in system_config too!
    await saveGlobalDefaultEstimateMaster(payload);
  };

  /** Returns the new AT's id so the caller can activate it (AtSettings does). */
  const addAtMaster = async (atData: Omit<AtMaster, 'id' | 'ownerId'>): Promise<{ id: string; seed: AtSeedReport } | undefined> => {
    if (!auth.currentUser) return undefined;
    try {
      // Refuse to write an AT with no agency. `agencyId: ''` produces a document that is
      // read back (the fetch filters on ownerId) but excluded from every per-agency list,
      // so it looks exactly like the bug this replaces - a write that silently vanishes.
      // THROWN, not returned: the caller's catch already surfaces failures, and a silent
      // refusal would be indistinguishable from the old behaviour.
      if (!String(atData.agencyId ?? '').trim()) {
        throw new Error('Cannot create an AT with no agency. Select an agency first - an AT with no agencyId is invisible to every agency-scoped view.');
      }
      const newRef = doc(collection(db, 'atMasters'));

      // SEED THE COUNTERS FROM THE AGENCY, BUT ONLY FOR ITS FIRST AT.
      //
      // Before this, a new AT was written with `lastJobNumbers: {}` and job numbering
      // silently restarted at 1. The cause is that the read and the write test different
      // things: getNextJobNoInfo branches on `activeAtMaster && activeAtMaster.lastJobNumbers`
      // - and `{}` is TRUTHY - so the populated `activeAgency.lastJobNumbers` in its
      // `else if` was never reached, while the counter-writer of the day branched on
      // `activeAtMaster` alone. An agency that had been numbering off its own counters
      // returned to 1 the moment its first AT existed, producing duplicate job numbers
      // immediately (AUDIT O2/C1). That sits on the path the agency form now recommends
      // for fixing prefixes, which is how it was found.
      //
      // WHY SEEDING RATHER THAN TESTING THE READ FOR A NON-EMPTY OBJECT: the read alone
      // does not fix it. Job 1 would be numbered from the agency (47), the increment
      // would still write to the AT starting from ITS zero (1), and job 2 would be
      // numbered from the AT (2) - the same collision, one job later and quieter. Fixing
      // it at the read means fixing the write too, and the consistent version of that
      // keeps writing to the agency while an AT is active, so the AT's map never becomes
      // non-empty and the handover never happens. Seeding puts read and write on the same
      // document from the first job.
      //
      // ONLY THE FIRST AT. Once an AT exists, every increment goes to it and the agency
      // map freezes, so copying that frozen map into a second AT would start a new tender
      // from an arbitrary old number. A new tender starts its own series - which is what
      // per-AT counters are for. Staleness only exists from the second AT onward, and
      // that is exactly where this does not seed.
      // SEED THIS AT'S JOB-NUMBER COUNTERS FROM THE HIGHEST NUMBER THE AGENCY HAS
      // ACTUALLY ISSUED - every AT, not only the first (AUDIT F42, closing O2).
      //
      // WHY EVERY AT. Prefixes belong to the DIVISION and the agency, not to the tender
      // period: "21 IS" is the same before and after a rollover. So a new AT that starts
      // its counters at zero reissues "21 IS-1" for a different physical transformer -
      // which is exactly how C1's collisions arose. Continuation is already the behaviour
      // at the FIRST AT boundary and was absent at every later one; that asymmetry was a
      // bug, not a design.
      //
      // WHY FROM JOBS AND NOT FROM COUNTERS. `lastJobNumbers` is a CACHE of a fact that
      // lives in the jobs collection, and it can sit low in ways the cache cannot see:
      //   - the real allocator (NewJob's save transaction) only moves a counter UP to the
      //     highest number in that intake - it reconciles, it does not allocate;
      //   - it writes only when an AT or agency doc resolved, so jobs saved with no active
      //     AT advanced nothing;
      //   - a second counter-writer looked like the allocator and had zero call sites (A2).
      // (Both writers are since deleted - the save path is the only one left - but the gaps
      // this seeding covers are in the DATA those writers left behind, so it still applies.)
      // Seeding from the cache would inherit every one of those gaps, and the failure is
      // the precise one this exists to prevent. So: the max of BOTH - actual job numbers
      // and every stored counter - which can never be lower than either alone.
      const agencyIdForSeed = String(atData.agencyId).trim();
      const callerCounters = (atData as any).lastJobNumbers;
      const seededCounters: Record<string, number> = { ...(callerCounters || {}) };
      const seedUnparsed: string[] = [];
      const seedUnparsedKeys = new Set<string>();
      let seedJobsScanned = 0;

      const bump = (key: string, value: number) => {
        if (!key || !Number.isFinite(value) || value <= 0) return;
        if (!seededCounters[key] || value > seededCounters[key]) seededCounters[key] = value;
      };

      try {
        // Every stored counter for this agency - all its ATs, plus the agency record.
        // Read from state rather than re-queried: these are already agency-scoped here.
        atMasters
          .filter(a => a.agencyId === agencyIdForSeed)
          .forEach(a => Object.entries(a.lastJobNumbers || {}).forEach(([k, v]) => bump(k, Number(v))));
        const agencyDoc = agencies.find(a => a.id === agencyIdForSeed);
        Object.entries(agencyDoc?.lastJobNumbers || {}).forEach(([k, v]) => bump(k, Number(v)));

        // The authority: the numbers actually on jobs.
        const jobSnap = await getDocs(query(
          collection(db, 'jobs'),
          where('ownerId', '==', auth.currentUser.uid),
          where('agencyId', '==', agencyIdForSeed)
        ));
        jobSnap.docs.forEach(d => {
          const j: any = d.data();
          // DO NOT consider GP jobs or Cancelled jobs for seeding last job number counters
          if ((j.repairType || '').toUpperCase() === 'GP' || j.isGp || j.status === 'Cancelled' || j.isCancelled || j.mrStatus === 'Cancelled') {
            return;
          }
          seedJobsScanned++;
          const division = String(j.division ?? '').trim();
          if (!division) return;
          const key = getCounterKey(division, j.coreType || 'CRGO');
          // The numeric TAIL. "21 IS-40" -> 40. A number that does not end in digits
          // cannot be continued from and is reported rather than guessed at.
          const raw = String(j.jobNo ?? '').trim();
          const m = raw.match(/(\d+)\s*$/);
          if (!m) {
            if (raw) { seedUnparsed.push(raw); seedUnparsedKeys.add(key); }
            return;
          }
          const n = Number(m[1]);
          bump(key, n);
          // CRGO is counted under EITHER `${div}_CRGO` or a bare `${div}` key, and
          // getNextJobNoInfo reads one and falls back to the other. Seeding only one lets
          // CRGO restart independently while every other core type continues.
          if (key.endsWith('_CRGO')) bump(division, n);
        });
      } catch (seedErr) {
        // A failed seed must not block a tender rollover. The AT is still created; the
        // counters simply start from whatever the caller supplied, and a duplicate is
        // refused at save rather than issued.
        console.warn('Could not seed job-number counters from existing jobs:', seedErr);
      }

      const seedReport: AtSeedReport = {
        counters: seededCounters,
        unparsed: [...new Set(seedUnparsed)],
        unparsedKeys: [...seedUnparsedKeys],
        jobsScanned: seedJobsScanned,
      };

      const newAt = { ...atData, lastJobNumbers: seededCounters, ownerId: auth.currentUser.uid };
      // Creation time from the server clock - see the note in addAgency. `startDate` is the
      // TENDER period start, a business date the operator types; two ATs created a month
      // apart can carry the same one, and one created later can start earlier. It was never
      // a creation order and scripts had to say so rather than imply it.
      await setDoc(newRef, { ...newAt, createdAt: serverTimestamp() });
      setAtMasters(prev => [...prev, { id: newRef.id, ...newAt }]);
      // Activate the new AT when nothing is active FOR THIS AGENCY - not merely when
      // the stored id is empty. `activeAtMasterId` is a bare id while `activeAtMaster`
      // is agency-scoped (see its derivation below), so an id belonging to another
      // agency is truthy here yet resolves to null there: the guard passed, nothing was
      // activated, and the AT's Divisions/Allotments panel never appeared. The guard was
      // asking "is anything stored" when it meant "is anything active for this agency".
      const activeForThisAgency = atMasters.some(
        a => a.id === activeAtMasterId && a.agencyId === newAt.agencyId
      );
      if (!activeForThisAgency) setActiveAtMasterId(newRef.id);
      return { id: newRef.id, seed: seedReport };
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'atMasters');
      throw err;
    }
  };

  const updateAtMaster = async (id: string, atData: Partial<AtMaster>) => {
    try {
      const ref = doc(db, 'atMasters', id);
      await updateDoc(ref, atData);
      setAtMasters(prev => prev.map(a => a.id === id ? { ...a, ...atData } : a));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'atMasters');
      throw err;
    }
  };

  /**
   * THE ONE TEST for which document owns the job-number counters.
   *
   * The prediction and the allocator once branched differently on the same field - one on
   * `activeAtMaster && activeAtMaster.lastJobNumbers`, the other on `activeAtMaster` alone
   * - a read and a write disagreeing, held together only by an AT never being left with an
   * empty counter map (AUDIT A6). Both now come through here. The allocator is since gone
   * entirely (F70); this remains the single answer to which document holds a counter, for
   * the prediction that suggests numbers and for the save that advances them.
   *
   * THE AT'S COUNTER IS AUTHORITATIVE whenever an AT is active. The agency's exists for the
   * no-AT case and is legacy: `EditAgencyForm` backfills its keys to 0 so they exist, and
   * `AgencySettings` seeds them at creation, but nothing ADVANCES it while an AT is active
   * and nothing reads it in that state. It is not kept in step, deliberately.
   */
  const jobNoCounterTarget = (atMasterId?: string): { ref: any; isAtMaster: boolean; id: string } | null => {
    // An EXPLICIT AT wins over the session's. MrLedger adds a transformer to an MR issued
    // under some tender, and that job belongs to THAT tender - it consumes its allotment
    // and prices at its percentage - regardless of which AT is selected months later
    // (AUDIT F66).
    if (atMasterId) return { ref: doc(db, 'atMasters', atMasterId), isAtMaster: true, id: atMasterId };
    if (activeAtMaster) return { ref: doc(db, 'atMasters', activeAtMaster.id), isAtMaster: true, id: activeAtMaster.id };
    if (activeAgency) return { ref: doc(db, 'agencies', activeAgency.id), isAtMaster: false, id: activeAgency.id };
    return null;
  };

  /**
   * The prefix and counter key for a division/core type. NO NUMBER: nothing allocates
   * one - see the note above predictNextJobNo (AUDIT F70).
   *
   * ⚠ `prefix` IS null WHEN NOTHING IS CONFIGURED. It used to be the string 'JOB'.
   *
   * That sentinel caused two separate faults at once (AUDIT F71). It made the
   * missing-prefix case UNDETECTABLE - `if (!prefix)` never fired, because 'JOB' is
   * truthy - and it shipped a plausible wrong value in place of failing, so an
   * unconfigured division produced "JOB-1" in a job-number box rather than a message
   * saying no prefix was set up. An absence dressed as a fact.
   *
   * null cannot be concatenated into a job number by accident and cannot pass a truthiness
   * check, so every caller has to decide what to do when there is no prefix. The one place
   * that still WANTS a display string builds its own; nothing reconstructs the sentinel.
   *
   * Split out of `getNextJobNoInfo` because composing a number from a client-side snapshot
   * is what let two operators draw the same one (AUDIT O2). Prefix resolution is pure and
   * stays synchronous; the number now comes from a transaction.
   */
  const getJobNoPrefix = (division: string, coreType: string = 'CRGO', atMasterId?: string) => {
    const empty = { prefix: 'JOB', counterKey: getCounterKey(division, coreType) };
    if (!activeAgency) return empty;

    // Prefixes follow the SAME AT the number is drawn from - a job added to an older MR
    // must carry that tender's prefix as well as its sequence, or the number would be
    // half from one tender and half from another (F66).
    const sourceAt = atMasterId ? atMasters.find(a => a.id === atMasterId) : activeAtMaster;
    const currentPrefixes = (sourceAt && sourceAt.prefixes && Object.keys(sourceAt.prefixes).length > 0)
        ? sourceAt.prefixes
        : activeAgency.prefixes || {};

    const divPrefixInfo = currentPrefixes[division];
    let prefix: string | null = null;
    const typeUpper = (coreType || 'CRGO').trim().toUpperCase();

    if (typeof divPrefixInfo === 'string') {
      prefix = divPrefixInfo;
    } else if (divPrefixInfo && typeof divPrefixInfo === 'object') {
      if (typeUpper === 'OH') {
        prefix = (divPrefixInfo as any)['OH'] || (divPrefixInfo as any)['CRGO'] || null;
      } else if (typeUpper.includes('AMORPHOUS') || typeUpper.includes('AM')) {
        prefix = (divPrefixInfo as any)['Amorphous'] || (divPrefixInfo as any)['CRGO'] || null;
      } else if (typeUpper.includes('WOUND') || typeUpper.includes('WC')) {
        prefix = (divPrefixInfo as any)['Wound Core'] || (divPrefixInfo as any)['CRGO'] || null;
      } else {
        prefix = (divPrefixInfo as any)['CRGO'] || (divPrefixInfo as any)[coreType] || null;
      }
    } else if (divPrefixInfo) {
      prefix = String(divPrefixInfo);
    }
    // An empty or whitespace-only string is not a prefix either - a settings field that was
    // opened and cleared reads as configured otherwise, which is the same fault one layer in.
    if (typeof prefix === 'string' && !prefix.trim()) prefix = null;
    return { prefix, counterKey: getCounterKey(division, coreType) };
  };

  /**
   * ⚠ THE ALLOCATOR IS DELETED. Nothing in this app draws a job number (AUDIT F70).
   *
   * `reserveJobNos` advanced a counter inside a transaction and handed back numbers, and
   * `incrementJobNoCounter` did the same by counter key. Both are gone rather than left
   * unused, because an unused allocator is an invitation: five separate fixes went into
   * guarding the calls to it, and the sixth would have been written by whoever found it
   * sitting here looking useful.
   *
   * Job numbers come from the division on the MR. The operator types them, the app suggests
   * the next one via `predictNextJobNo` (which READS and never writes), and the counter is
   * advanced at save to the highest number actually recorded - by the screen doing the
   * saving, sharing one parsing rule in `highWaterJobNos`.
   *
   * If a future requirement really does need app-allocated numbers, write it deliberately
   * and read AUDIT F70 first - the failure was never in the guards.
   */


  /**
   * ⚠ NO CALLERS. Do not wire this up to a job-number field (AUDIT F70).
   *
   * It predicts from `lastJobNumbers`, and a suggestion must NOT come from there any more.
   * The counter records what has been ISSUED and only ever rises. Suggestions now continue
   * from the highest job number actually SAVED for that prefix, which is a record of what
   * EXISTS and can fall - so an abandoned intake offers the same number again, and a
   * deleted or cancelled job frees its number. Reading the counter instead would quietly
   * undo both, and would look right while doing it.
   *
   * NewJob and MrLedger both compute their own from jobs they already hold; neither needs
   * an extra read. What survives here is the counter LOOKUP, which nothing consults.
   *
   * Kept rather than deleted only because removing it was out of scope for the change that
   * orphaned it. It is a deletion candidate: the last function in this file that looked
   * useful and had no callers was `incrementJobNoCounter`, and it sat here long enough to
   * be documented as a hazard twice (A2) before it went.
   */
  const predictNextJobNo = (
    division: string,
    coreType: string = 'CRGO',
    _repairType: string = 'OGP',
    atMasterId?: string,
  ) => {
    if (!activeAgency) return { prefix: null, nextNum: 1, counterKey: 'JOB' };

    // ONE PREFIX RESOLVER, not two. This function used to carry its own copy of
    // getJobNoPrefix's division/core-type resolution - the same string-matching cascade,
    // written out twice, which is the parallel-implementation shape this audit has now hit
    // in estimates, in job numbering and here. Delegated, so a change to how a prefix is
    // chosen cannot apply to the number that is issued but not to the one that is shown.
    const { prefix, counterKey } = getJobNoPrefix(division, coreType, atMasterId);

    // WHICH COUNTER TO READ. An MR belongs to the tender it was issued under, so a caller
    // adding to an existing MR passes that AT explicitly rather than taking the session's
    // (AUDIT F66). Falls back to the active AT, then the agency, for callers with no
    // particular AT in mind.
    const source = atMasterId ? atMasters.find(a => a.id === atMasterId) : activeAtMaster;
    const counters = (source?.lastJobNumbers) || (source ? {} : activeAgency.lastJobNumbers) || {};

    // CRGO is counted under either `<div>_CRGO` or a bare `<div>` - the same fallback pair
    // the save advances together, so a prediction cannot sit below a real number.
    const bare = counterKey.endsWith('_CRGO') ? Number(counters[division] ?? 0) || 0 : 0;
    const lastNum = Math.max(Number(counters[counterKey] ?? 0) || 0, bare);

    return { prefix, nextNum: lastNum + 1, counterKey };
  };

  /**
   * Mirror a counter map the SAVE has already written into context state, so the next
   * suggestion in the same session does not read a stale value. It writes nothing to
   * Firestore - the caller's transaction has already committed.
   *
   * (The paired-precondition note that used to sit here belonged to incrementJobNoCounter,
   * which is deleted. This function has no such pairing: the caller tells it which document
   * was written.)
   */
  const syncCountersState = (isAtMaster: boolean, id: string, newCounters: Record<string, number>) => {
    if (isAtMaster) {
      setAtMasters(prev => prev.map(a => a.id === id ? { ...a, lastJobNumbers: newCounters } : a));
    } else {
      setAgencies(prev => prev.map(a => a.id === id ? { ...a, lastJobNumbers: newCounters } : a));
    }
  };

  return (
    <AgencyContext.Provider value={{
      agencies, activeAgency, setActiveAgencyId,
      atMasters, activeAtMaster, setActiveAtMasterId,
      loading, isSuperAdmin, globalDefaultEstimateMaster,
      globalConfigError, globalConfigLoaded, dismissGlobalConfigError,
      addAgency, updateAgency, updateAllAgenciesEstimateMaster, 
      saveGlobalDefaultEstimateMaster, countOverridesForApply, applyEstimateMasterToOwnAgencies,
      addAtMaster, updateAtMaster,
      predictNextJobNo, getJobNoPrefix, syncCountersState
    }}>
      {children}
    </AgencyContext.Provider>
  );
}

export function useAgency() {
  const context = useContext(AgencyContext);
  if (context === undefined) throw new Error('useAgency must be used within an AgencyProvider');
  return context;
}

