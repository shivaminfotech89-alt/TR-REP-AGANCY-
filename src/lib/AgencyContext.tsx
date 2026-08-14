import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { db, auth, handleFirestoreError, OperationType } from './firebase';
import { collection, query, where, getDocs, doc, setDoc, updateDoc, runTransaction } from 'firebase/firestore';
import { defaultEstimateData, defaultAmorphousEstimateData, EstimateItem } from './estimateData';

export interface Agency {
  id: string;
  name: string;
  letterheadUrl: string;
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

  forwardingToText?: string;
  forwardingSubject?: string;
  forwardingCcText?: string;
  estimateMaster?: EstimateItem[];
  estimateMasterCRGO?: EstimateItem[];
  estimateMasterAmorphous?: EstimateItem[];
  estimateMasterWoundCore?: EstimateItem[];
}

export function getEstimateCircleRecipient(agency?: Agency | null, circleOrDivision?: string): string {
  const authority = agency?.circleAuthority || 'Superintending Engineer (O & M)';
  const company = agency?.discomName || 'Uttar Gujarat Vij Company Ltd.';
  const circle = agency?.circleOfficeName || circleOrDivision || 'SABARMATI';
  return `TO, ${authority},\n${company}\nCircle Office : ${circle}`;
}

export function getEstimateCcText(agency?: Agency | null, division?: string): string {
  const div = division || agency?.circleOfficeName || 'SABARMATI';
  if (agency?.estimateCcTemplate && agency.estimateCcTemplate.trim()) {
    return agency.estimateCcTemplate.replace(/{division}/gi, div).replace(/{circle}/gi, agency.circleOfficeName || div);
  }
  if (agency?.forwardingCcText && agency.forwardingCcText.trim()) {
    return agency.forwardingCcText.replace(/{division}/gi, div);
  }
  return `E. E. (O & M) DIVISION - ${div}`;
}

export function getBillDivisionRecipient(agency?: Agency | null, division?: string): string {
  const div = division || agency?.circleOfficeName || 'SABARMATI';
  const authority = agency?.divisionAuthority || 'The Executive Engineer ,';
  const company = agency?.discomName || 'Uttar Gujarat Vij Company Ltd.';
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

export function getEstimateMasterForCore(agency: Agency | null | undefined, coreType: string = 'CRGO'): EstimateItem[] {
  if (!agency) return defaultEstimateData;
  const type = (coreType || 'CRGO').trim().toUpperCase();

  if (type.includes('AMORPHOUS') || type.includes('AM')) {
    if (agency.estimateMasterAmorphous && agency.estimateMasterAmorphous.length > 0) {
      return agency.estimateMasterAmorphous;
    }
    return defaultAmorphousEstimateData;
  }

  if (type.includes('WOUND') || type.includes('WC')) {
    if (agency.estimateMasterWoundCore && agency.estimateMasterWoundCore.length > 0) {
      return agency.estimateMasterWoundCore;
    }
    if (agency.estimateMasterCRGO && agency.estimateMasterCRGO.length > 0) {
      return agency.estimateMasterCRGO;
    }
    if (agency.estimateMaster && agency.estimateMaster.length > 0) {
      return agency.estimateMaster;
    }
    return defaultEstimateData;
  }

  // CRGO
  if (agency.estimateMasterCRGO && agency.estimateMasterCRGO.length > 0) {
    return agency.estimateMasterCRGO;
  }
  if (agency.estimateMaster && agency.estimateMaster.length > 0) {
    return agency.estimateMaster;
  }
  return defaultEstimateData;
}

interface AgencyContextType {
  agencies: Agency[];
  activeAgency: Agency | null;
  setActiveAgencyId: (id: string) => void;
  loading: boolean;
  addAgency: (agencyData: Omit<Agency, 'id'>) => Promise<void>;
  updateAgency: (id: string, agencyData: Partial<Agency>) => Promise<void>;
  updateAllAgenciesEstimateMaster: (payload: {
    estimateMasterCRGO?: EstimateItem[];
    estimateMasterAmorphous?: EstimateItem[];
    estimateMasterWoundCore?: EstimateItem[];
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
  const [activeAtMasterId, setActiveAtMasterIdState] = useState<string | null>(localStorage.getItem('activeAtMasterId') || null);
  
  const [loading, setLoading] = useState(true);

  const setActiveAgencyId = (id: string | null) => {
    setActiveAgencyIdState(id);
    if (id) localStorage.setItem('activeAgencyId', id);
    else localStorage.removeItem('activeAgencyId');
  };

  const setActiveAtMasterId = (id: string | null) => {
    setActiveAtMasterIdState(id);
    if (id) localStorage.setItem('activeAtMasterId', id);
    else localStorage.removeItem('activeAtMasterId');
  };

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'activeAgencyId') setActiveAgencyIdState(e.newValue);
      if (e.key === 'activeAtMasterId') setActiveAtMasterIdState(e.newValue);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    async function fetchData() {
      if (!auth.currentUser) return;
      try {
        const agQ = query(collection(db, 'agencies'), where('ownerId', '==', auth.currentUser.uid));
        const agSnapshot = await getDocs(agQ);
        const fetchedAgencies = agSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Agency));
        setAgencies(fetchedAgencies);
        
        if (fetchedAgencies.length > 0 && !fetchedAgencies.find(a => a.id === activeAgencyId)) {
          setActiveAgencyId(fetchedAgencies[0].id);
        }

        const atQ = query(collection(db, 'atMasters'), where('ownerId', '==', auth.currentUser.uid));
        const atSnapshot = await getDocs(atQ);
        const fetchedAts = atSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as AtMaster));
        setAtMasters(fetchedAts);
        
        if (fetchedAts.length > 0 && !fetchedAts.find(a => a.id === activeAtMasterId)) {
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
  }, [auth.currentUser, activeAgencyId, activeAtMasterId]);

  const activeAgency = agencies.find(a => a.id === activeAgencyId) || null;
  const activeAtMaster = atMasters.find(a => a.id === activeAtMasterId) || null;

  const addAgency = async (agencyData: Omit<Agency, 'id'>) => {
    if (!auth.currentUser) return;
    try {
      const newRef = doc(collection(db, 'agencies'));
      // Inherit estimate master from active agency or existing agencies if not provided
      const existingWithCRGO = agencies.find(a => a.estimateMasterCRGO && a.estimateMasterCRGO.length > 0);
      const existingWithAm = agencies.find(a => a.estimateMasterAmorphous && a.estimateMasterAmorphous.length > 0);
      const existingWithWC = agencies.find(a => a.estimateMasterWoundCore && a.estimateMasterWoundCore.length > 0);

      const defaultCRGO = activeAgency?.estimateMasterCRGO || existingWithCRGO?.estimateMasterCRGO || activeAgency?.estimateMaster || defaultEstimateData;
      const defaultAmorphous = activeAgency?.estimateMasterAmorphous || existingWithAm?.estimateMasterAmorphous || defaultAmorphousEstimateData;
      const defaultWoundCore = activeAgency?.estimateMasterWoundCore || existingWithWC?.estimateMasterWoundCore || defaultEstimateData;

      const newAgency = { 
        estimateMasterCRGO: defaultCRGO,
        estimateMaster: defaultCRGO,
        estimateMasterAmorphous: defaultAmorphous,
        estimateMasterWoundCore: defaultWoundCore,
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
    estimateMaster?: EstimateItem[];
  }) => {
    if (!auth.currentUser || agencies.length === 0) return;
    try {
      const updatePromises = agencies.map(async (agency) => {
        const ref = doc(db, 'agencies', agency.id);
        await updateDoc(ref, payload);
      });
      await Promise.all(updatePromises);

      setAgencies(prev => prev.map(a => ({
        ...a,
        ...payload
      })));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'agencies');
      throw err;
    }
  };

  const addAtMaster = async (atData: Omit<AtMaster, 'id' | 'ownerId'>) => {
    if (!auth.currentUser) return;
    try {
      const newRef = doc(collection(db, 'atMasters'));
      const newAt = { ...atData, ownerId: auth.currentUser.uid };
      await setDoc(newRef, newAt);
      setAtMasters(prev => [...prev, { id: newRef.id, ...newAt }]);
      if (!activeAtMasterId) setActiveAtMasterId(newRef.id);
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
      loading, addAgency, updateAgency, updateAllAgenciesEstimateMaster, addAtMaster, updateAtMaster,
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
