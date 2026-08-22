import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { db, auth, handleFirestoreError, OperationType } from './firebase';
import { collection, query, where, getDocs, doc, setDoc, updateDoc, getDoc, runTransaction } from 'firebase/firestore';
import { 
  defaultEstimateData, 
  defaultAmorphousEstimateData, 
  defaultWoundCoreEstimateData, 
  defaultOverhaulingEstimateData, 
  defaultCircleLimitsEstimateData,
  withMissingDefaults,
  EstimateItem
} from './estimateData';

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
}

export function getEstimateCircleRecipient(agency?: Agency | null, circleOrDivision?: string): string {
  const authority = agency?.circleAuthority || 'Superintending Engineer (O & M)';
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
  return `E. E. (O & M) DIVISION - ${div}`;
}

export function getBillDivisionRecipient(agency?: Agency | null, division?: string): string {
  const div = division || 'DIVISION';
  const authority = agency?.divisionAuthority || 'The Executive Engineer ,';
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
    const isLegacy = (arr?: EstimateItem[]) => arr && arr.some(it => {
      const name = (it.itemName || '').toLowerCase();
      return name.includes('dismental') || name.includes('washer ring') || name.includes('hv metal') || name.includes('lv metal');
    });

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
  addAgency: (agencyData: Omit<Agency, 'id'>) => Promise<void>;
  updateAgency: (id: string, agencyData: Partial<Agency>) => Promise<void>;
  updateAllAgenciesEstimateMaster: (payload: {
    estimateMasterCRGO?: EstimateItem[];
    estimateMasterAmorphous?: EstimateItem[];
    estimateMasterWoundCore?: EstimateItem[];
    estimateMasterOverhauling?: EstimateItem[];
    estimateMasterCircleLimits?: EstimateItem[];
    estimateMaster?: EstimateItem[];
  }) => Promise<void>;
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
  addAtMaster: (atData: Omit<AtMaster, 'id' | 'ownerId'>) => Promise<void>;
  updateAtMaster: (id: string, atData: Partial<AtMaster>) => Promise<void>;

  getNextJobNoInfo: (division: string, coreType?: string, repairType?: string) => { prefix: string, nextNum: number, counterKey: string };
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
        
        // If agencies don't have rates or have empty rates, populate with global defaults
        const enrichedAgencies = fetchedAgencies.map(ag => ({
          ...ag,
          estimateMasterCRGO: (ag.estimateMasterCRGO && ag.estimateMasterCRGO.length > 0) 
            ? ag.estimateMasterCRGO 
            : (fetchedGlobalMaster?.estimateMasterCRGO || defaultEstimateData),
          estimateMaster: (ag.estimateMaster && ag.estimateMaster.length > 0) 
            ? ag.estimateMaster 
            : (fetchedGlobalMaster?.estimateMasterCRGO || defaultEstimateData),
          estimateMasterAmorphous: (ag.estimateMasterAmorphous && ag.estimateMasterAmorphous.length > 0) 
            ? ag.estimateMasterAmorphous 
            : (fetchedGlobalMaster?.estimateMasterAmorphous || defaultAmorphousEstimateData),
          estimateMasterWoundCore: (ag.estimateMasterWoundCore && ag.estimateMasterWoundCore.length > 0) 
            ? ag.estimateMasterWoundCore 
            : (fetchedGlobalMaster?.estimateMasterWoundCore || defaultWoundCoreEstimateData),
          estimateMasterOverhauling: (ag.estimateMasterOverhauling && ag.estimateMasterOverhauling.length > 0) 
            ? ag.estimateMasterOverhauling 
            : (fetchedGlobalMaster?.estimateMasterOverhauling || defaultOverhaulingEstimateData),
          estimateMasterCircleLimits: (ag.estimateMasterCircleLimits && ag.estimateMasterCircleLimits.length > 0) 
            ? ag.estimateMasterCircleLimits 
            : (fetchedGlobalMaster?.estimateMasterCircleLimits || defaultCircleLimitsEstimateData),
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

      // Also update all current agencies in database so they reflect the new default immediately
      if (agencies.length > 0) {
        const updatePromises = agencies.map(async (agency) => {
          const ref = doc(db, 'agencies', agency.id);
          await updateDoc(ref, payload);
        });
        await Promise.all(updatePromises);

        setAgencies(prev => prev.map(a => ({
          ...a,
          ...payload
        })));
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'public_config');
      throw err;
    }
  };

  const addAgency = async (agencyData: Omit<Agency, 'id'>) => {
    if (!auth.currentUser) return;
    try {
      const newRef = doc(collection(db, 'agencies'));
      
      // Default to global default master if available, otherwise active agency or code default
      const defaultCRGO = globalDefaultEstimateMaster?.estimateMasterCRGO || 
                          activeAgency?.estimateMasterCRGO || 
                          defaultEstimateData;
      const defaultAmorphous = globalDefaultEstimateMaster?.estimateMasterAmorphous || 
                               activeAgency?.estimateMasterAmorphous || 
                               defaultAmorphousEstimateData;
      const defaultWoundCore = globalDefaultEstimateMaster?.estimateMasterWoundCore || 
                               activeAgency?.estimateMasterWoundCore || 
                               defaultWoundCoreEstimateData;
      const defaultOverhauling = globalDefaultEstimateMaster?.estimateMasterOverhauling || 
                                 activeAgency?.estimateMasterOverhauling || 
                                 defaultOverhaulingEstimateData;
      const defaultCircleLimits = globalDefaultEstimateMaster?.estimateMasterCircleLimits || 
                                  activeAgency?.estimateMasterCircleLimits || 
                                  defaultCircleLimitsEstimateData;

      const newAgency = { 
        estimateMasterCRGO: defaultCRGO,
        estimateMaster: defaultCRGO,
        estimateMasterAmorphous: defaultAmorphous,
        estimateMasterWoundCore: defaultWoundCore,
        estimateMasterOverhauling: defaultOverhauling,
        estimateMasterCircleLimits: defaultCircleLimits,
        ...agencyData, 
        ownerId: auth.currentUser.uid 
      };
      await setDoc(newRef, newAgency);
      setAgencies(prev => [...prev, { id: newRef.id, ...newAgency }]);
      if (!activeAgencyId) setActiveAgencyId(newRef.id);
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
  const addAtMaster = async (atData: Omit<AtMaster, 'id' | 'ownerId'>): Promise<string | undefined> => {
    if (!auth.currentUser) return undefined;
    try {
      const newRef = doc(collection(db, 'atMasters'));
      const newAt = { ...atData, ownerId: auth.currentUser.uid };
      await setDoc(newRef, newAt);
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
      return newRef.id;
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

  const getNextJobNoInfo = (division: string, coreType: string = 'CRGO', repairType: string = 'OGP') => {
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
      saveGlobalDefaultEstimateMaster, addAtMaster, updateAtMaster,
      getNextJobNoInfo, incrementJobNoCounter, syncCountersState
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

