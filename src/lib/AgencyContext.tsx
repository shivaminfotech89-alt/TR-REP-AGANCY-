import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { db, auth, handleFirestoreError, OperationType } from './firebase';
import { collection, query, where, getDocs, doc, setDoc, updateDoc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
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

  predictNextJobNo: (division: string, coreType?: string, repairType?: string) => { prefix: string, nextNum: number, counterKey: string };
  getJobNoPrefix: (division: string, coreType?: string, atMasterId?: string) => { prefix: string; counterKey: string };
  reserveJobNos: (division: string, coreType?: string, count?: number, atMasterId?: string) => Promise<string[]>;
  incrementJobNoCounter: (counterKey: string, count: number) => Promise<void>;
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
      // `else if` was never reached, while incrementJobNoCounter branches on
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
      //   - `incrementJobNoCounter` looks like the allocator and has zero call sites (A2).
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
   * PAIRED PRECONDITION - read this together with incrementJobNoCounter below.
   *
   * These two functions decide WHICH DOCUMENT holds the counter, and they test different
   * things to decide it:
   *
   *     getNextJobNoInfo      if (activeAtMaster && activeAtMaster.lastJobNumbers)
   *     incrementJobNoCounter if (activeAtMaster)
   *
   * They agree today only because an AT is never left with an empty `lastJobNumbers`
   * (addAtMaster seeds the first AT from the agency; later ATs start their own series and
   * are incremented into existence). Change EITHER test alone and they disagree for a
   * newly created AT: the number issued comes from one document and the increment lands on
   * the other, so job 1 is numbered from the agency and job 2 from the AT - duplicate job
   * numbers, one job later and quieter than the bug the seeding fixed.
   *
   * If this needs changing, change both, and check what happens on the FIRST job of a new
   * AT specifically. See AUDIT.md A6.
   */
  /**
   * THE ONE TEST for which document owns the job-number counters.
   *
   * `getNextJobNoInfo` used to branch on `activeAtMaster && activeAtMaster.lastJobNumbers`
   * while `incrementJobNoCounter` branched on `activeAtMaster` alone - a read and a write
   * disagreeing about the same field, held together only by an AT never being left with an
   * empty counter map (AUDIT A6). They now share this, so they cannot drift.
   *
   * THE AT'S COUNTER IS AUTHORITATIVE whenever an AT is active. The agency's exists for the
   * no-AT case and is legacy: `EditAgencyForm` backfills its keys to 0 so they exist, and
   * `AgencySettings` seeds them at creation, but nothing ADVANCES it while an AT is active
   * and nothing reads it in that state. It is not kept in step, deliberately.
   */
  /** ⚠ TEMPORARY — sequence counter for the reserveJobNos instrumentation. Remove with it. */
  const reserveCallSeq = useRef(0);

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
   * The prefix and counter key for a division/core type. NO NUMBER - see reserveJobNos.
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
    let prefix = 'JOB';
    const typeUpper = (coreType || 'CRGO').trim().toUpperCase();

    if (typeof divPrefixInfo === 'string') {
      prefix = divPrefixInfo;
    } else if (divPrefixInfo && typeof divPrefixInfo === 'object') {
      if (typeUpper === 'OH') {
        prefix = (divPrefixInfo as any)['OH'] || (divPrefixInfo as any)['CRGO'] || 'JOB';
      } else if (typeUpper.includes('AMORPHOUS') || typeUpper.includes('AM')) {
        prefix = (divPrefixInfo as any)['Amorphous'] || (divPrefixInfo as any)['CRGO'] || 'JOB';
      } else if (typeUpper.includes('WOUND') || typeUpper.includes('WC')) {
        prefix = (divPrefixInfo as any)['Wound Core'] || (divPrefixInfo as any)['CRGO'] || 'JOB';
      } else {
        prefix = (divPrefixInfo as any)['CRGO'] || (divPrefixInfo as any)[coreType] || 'JOB';
      }
    } else if (divPrefixInfo) {
      prefix = String(divPrefixInfo);
    }
    return { prefix, counterKey: getCounterKey(division, coreType) };
  };

  /**
   * RESERVE job numbers atomically. Returns the composed numbers, in order.
   *
   * The counter is advanced INSIDE the transaction, so two operators cannot draw the same
   * number: Firestore retries the loser, which then reads the advanced value.
   *
   * A RESERVATION IS PERMANENT. There is no expiry and nothing reclaims an abandoned
   * number, because the app cannot know whether the operator has already written it on the
   * transformer - and handing a marked number to someone else is the exact failure this
   * prevents. An abandoned number is burned, and a gap in the sequence is correct: the job
   * number is the agency's internal reference, and the counter is already never rewound
   * when a job is deleted.
   */
  const reserveJobNos = async (
    division: string,
    coreType: string = 'CRGO',
    count: number = 1,
    atMasterId?: string,
  ): Promise<string[]> => {
    // ⚠ TEMPORARY INSTRUMENTATION — REMOVE ONCE THE BURNING PATH IS IDENTIFIED.
    //
    // Four fixes have been aimed at call sites found by READING the code, and numbers are
    // still being drawn on a dropdown flip. The stack is printed HERE, inside the
    // allocator, rather than at the call sites, precisely because the call sites are what
    // has been guessed wrong four times: whatever calls this appears in the trace whether
    // or not it was in the list.
    //
    // Sequential call ids so the console shows how many fired and in what order, even
    // where React batches and the timestamps collapse.
    reserveCallSeq.current += 1;
    const __seq = reserveCallSeq.current;
    console.log(
      `%c[RESERVE #${__seq}] division=${division} coreType=${coreType} count=${count}` +
      ` atMasterId=${atMasterId ?? '(active)'}`,
      'background:#7f1d1d;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold',
    );
    console.log(new Error(`reserveJobNos call #${__seq} — stack`).stack);

    if (count <= 0) { console.log(`[RESERVE #${__seq}] count<=0, returning without allocating`); return []; }
    const target = jobNoCounterTarget(atMasterId);
    const { prefix, counterKey } = getJobNoPrefix(division, coreType, atMasterId);
    console.log(`[RESERVE #${__seq}] -> counterKey=${counterKey} prefix=${prefix} target=${target ? (target.isAtMaster ? 'AT ' : 'AGENCY ') + target.id : 'NONE'}`);
    if (!target) throw new Error('No agency is selected, so a job number cannot be reserved.');

    const allocated = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(target.ref);
      const counters: Record<string, number> = { ...((snap.data() as any)?.lastJobNumbers || {}) };
      // CRGO is counted under either `${div}_CRGO` or a bare `${div}` key - same fallback
      // the seeding uses, so the two cannot disagree about where CRGO's sequence lives.
      const bare = division;
      const current = Math.max(
        Number(counters[counterKey] ?? 0) || 0,
        counterKey.endsWith('_CRGO') ? (Number(counters[bare] ?? 0) || 0) : 0,
      );
      const nums: number[] = [];
      for (let i = 1; i <= count; i++) nums.push(current + i);
      counters[counterKey] = current + count;
      if (counterKey.endsWith('_CRGO')) counters[bare] = current + count;
      transaction.update(target.ref, { lastJobNumbers: counters });
      return nums;
    });

    // Local mirror so the next reservation in the same session does not re-read a stale
    // context value. The transaction is authoritative either way.
    if (target.isAtMaster) {
      setAtMasters(prev => prev.map(a => a.id === target.id
        ? { ...a, lastJobNumbers: { ...(a.lastJobNumbers || {}), [counterKey]: allocated[allocated.length - 1] } }
        : a));
    } else {
      setAgencies(prev => prev.map(a => a.id === target.id
        ? { ...a, lastJobNumbers: { ...(a.lastJobNumbers || {}), [counterKey]: allocated[allocated.length - 1] } }
        : a));
    }
    const __out = allocated.map(n => `${prefix}-${n}`);
    console.log(
      `%c[RESERVE #${__seq}] ALLOCATED ${counterKey}: ${__out.join(', ')}`,
      'background:#065f46;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold',
    );
    return __out;
  };

  /**
   * PREDICTS the next job number from the CONTEXT SNAPSHOT. It does not allocate.
   *
   * Renamed from `getNextJobNoInfo`, which is how it came to be used as an allocator: a
   * function whose name says "next job no" sitting beside the real allocator is how someone
   * wires up the wrong one. Its only legitimate caller is the renumber prompt, which shows
   * the operator what a replacement WOULD be before they accept - a prediction that
   * `reserveJobNos` then makes real, and which may differ if another operator got there
   * first (AUDIT F60, F64).
   *
   * Never use this to fill a job-number field. The number in that field is written on the
   * transformer, so it must come from a reservation.
   */
  const predictNextJobNo = (division: string, coreType: string = 'CRGO', repairType: string = 'OGP') => {
    if (!activeAgency) return { prefix: 'JOB', nextNum: 1, counterKey: 'JOB' };
    
    const currentPrefixes = (activeAtMaster && activeAtMaster.prefixes && Object.keys(activeAtMaster.prefixes).length > 0) 
        ? activeAtMaster.prefixes 
        : activeAgency.prefixes || {};
        
    const divPrefixInfo = currentPrefixes[division];
    let prefix = 'JOB';
    const typeUpper = (coreType || 'CRGO').trim().toUpperCase();

    if (typeof divPrefixInfo === 'string') {
      prefix = divPrefixInfo;
    } else if (divPrefixInfo && typeof divPrefixInfo === 'object') {
      if (typeUpper === 'OH') {
        prefix = (divPrefixInfo as any)['OH'] || (divPrefixInfo as any)['CRGO'] || 'JOB';
      } else if (typeUpper.includes('AMORPHOUS') || typeUpper.includes('AM')) {
        prefix = (divPrefixInfo as any)['Amorphous'] || (divPrefixInfo as any)['CRGO'] || 'JOB';
      } else if (typeUpper.includes('WOUND') || typeUpper.includes('WC')) {
        prefix = (divPrefixInfo as any)['Wound Core'] || (divPrefixInfo as any)['CRGO'] || 'JOB';
      } else {
        prefix = (divPrefixInfo as any)['CRGO'] || (divPrefixInfo as any)[coreType] || 'JOB';
      }
    } else if (divPrefixInfo) {
      prefix = String(divPrefixInfo);
    }
    
    let lastNum = 0;
    const counterKey = getCounterKey(division, coreType);
    
    if (activeAtMaster && activeAtMaster.lastJobNumbers) {
      if (activeAtMaster.lastJobNumbers[counterKey] !== undefined) {
        lastNum = activeAtMaster.lastJobNumbers[counterKey];
      } else if (typeUpper.includes('CRGO') && activeAtMaster.lastJobNumbers[division] !== undefined) {
        lastNum = activeAtMaster.lastJobNumbers[division];
      }
    } else if (activeAgency && activeAgency.lastJobNumbers) {
      if (activeAgency.lastJobNumbers[counterKey] !== undefined) {
        lastNum = activeAgency.lastJobNumbers[counterKey];
      } else if (typeUpper.includes('CRGO') && activeAgency.lastJobNumbers[division] !== undefined) {
        lastNum = activeAgency.lastJobNumbers[division];
      }
    }
    
    return { prefix, nextNum: lastNum + 1, counterKey };
  };

  /**
   * PAIRED PRECONDITION - see the note on getNextJobNoInfo above. This branches on
   * `activeAtMaster` alone; the read branches on `activeAtMaster.lastJobNumbers` as well.
   * They must be changed together. AUDIT.md A6.
   */
  const incrementJobNoCounter = async (counterKey: string, count: number) => {
    try {
      if (activeAtMaster) {
        const atRef = doc(db, 'atMasters', activeAtMaster.id);
        let updatedLastJobNumbers: Record<string, number> = {};
        await runTransaction(db, async (transaction) => {
          const atDoc = await transaction.get(atRef);
          if (!atDoc.exists()) throw new Error("Active AT Master document not found");
          const data = atDoc.data() as AtMaster;
          const currentLastNum = (data.lastJobNumbers && data.lastJobNumbers[counterKey]) || 0;
          updatedLastJobNumbers = { ...(data.lastJobNumbers || {}), [counterKey]: currentLastNum + count };
          transaction.update(atRef, { lastJobNumbers: updatedLastJobNumbers });
        });
        setAtMasters(prev => prev.map(a => a.id === activeAtMaster.id ? { ...a, lastJobNumbers: updatedLastJobNumbers } : a));
      } else if (activeAgency) {
        const agencyRef = doc(db, 'agencies', activeAgency.id);
        let updatedLastJobNumbers: Record<string, number> = {};
        await runTransaction(db, async (transaction) => {
          const agDoc = await transaction.get(agencyRef);
          if (!agDoc.exists()) throw new Error("Active Agency document not found");
          const data = agDoc.data() as Agency;
          const currentLastNum = (data.lastJobNumbers && data.lastJobNumbers[counterKey]) || 0;
          updatedLastJobNumbers = { ...(data.lastJobNumbers || {}), [counterKey]: currentLastNum + count };
          transaction.update(agencyRef, { lastJobNumbers: updatedLastJobNumbers });
        });
        setAgencies(prev => prev.map(a => a.id === activeAgency.id ? { ...a, lastJobNumbers: updatedLastJobNumbers } : a));
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, activeAtMaster ? 'atMasters' : 'agencies');
      throw err;
    }
  };

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
      predictNextJobNo, getJobNoPrefix, reserveJobNos, incrementJobNoCounter, syncCountersState
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

