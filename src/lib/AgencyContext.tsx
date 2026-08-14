import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { db, auth, handleFirestoreError, OperationType } from './firebase';
import { collection, query, where, getDocs, doc, setDoc, updateDoc } from 'firebase/firestore';
import { defaultEstimateData, defaultAmorphousEstimateData, EstimateItem } from './estimateData';

export interface Agency {
  id: string;
  name: string;
  letterheadUrl: string;
  prefixes: Record<string, string | Record<string, string>>;
  lastJobNumbers: Record<string, number>;
  allotments?: Record<string, Record<string, number>>;
  gpValidationMonths?: number;
  forwardingToText?: string;
  forwardingSubject?: string;
  forwardingCcText?: string;
  estimateMaster?: EstimateItem[];
  estimateMasterCRGO?: EstimateItem[];
  estimateMasterAmorphous?: EstimateItem[];
  estimateMasterWoundCore?: EstimateItem[];
  address?: string;
  gstin?: string;
  pan?: string;
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  email?: string;
  phone?: string;
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
  
  atMasters: AtMaster[];
  activeAtMaster: AtMaster | null;
  setActiveAtMasterId: (id: string) => void;
  addAtMaster: (atData: Omit<AtMaster, 'id' | 'ownerId'>) => Promise<void>;
  updateAtMaster: (id: string, atData: Partial<AtMaster>) => Promise<void>;

  getNextJobNoInfo: (division: string, coreType?: string, repairType?: string) => { prefix: string, nextNum: number, counterKey: string };
  incrementJobNoCounter: (counterKey: string, count: number) => Promise<void>;
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
      const newAgency = { ...agencyData, ownerId: auth.currentUser.uid };
      await setDoc(newRef, newAgency);
      setAgencies(prev => [...prev, { id: newRef.id, ...agencyData }]);
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
    if (activeAtMaster) {
      const currentLastNum = (activeAtMaster.lastJobNumbers && activeAtMaster.lastJobNumbers[counterKey]) || 0;
      const newLastJobNumbers = { ...activeAtMaster.lastJobNumbers, [counterKey]: currentLastNum + count };
      await updateAtMaster(activeAtMaster.id, { lastJobNumbers: newLastJobNumbers });
    } else if (activeAgency) {
      const currentLastNum = (activeAgency.lastJobNumbers && activeAgency.lastJobNumbers[counterKey]) || 0;
      const newLastJobNumbers = { ...activeAgency.lastJobNumbers, [counterKey]: currentLastNum + count };
      await updateAgency(activeAgency.id, { lastJobNumbers: newLastJobNumbers });
    }
  };

  return (
    <AgencyContext.Provider value={{
      agencies, activeAgency, setActiveAgencyId,
      atMasters, activeAtMaster, setActiveAtMasterId,
      loading, addAgency, updateAgency, addAtMaster, updateAtMaster,
      getNextJobNoInfo, incrementJobNoCounter
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
