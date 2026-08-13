import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { db, auth, handleFirestoreError, OperationType } from './firebase';
import { collection, query, where, getDocs, doc, setDoc, updateDoc } from 'firebase/firestore';
import { EstimateItem } from './estimateData';

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
  allotments?: Record<string, Record<string, number>>;
  allotmentHistory?: AllotmentRecord[];
  prefixes?: Record<string, string | Record<string, string>>;
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
    if (!activeAgency) return { prefix: 'JOB', nextNum: 1 };
    
    const currentPrefixes = (activeAtMaster && activeAtMaster.prefixes && Object.keys(activeAtMaster.prefixes).length > 0) 
        ? activeAtMaster.prefixes 
        : activeAgency.prefixes || {};
        
    const divPrefixInfo = currentPrefixes[division];
    let prefix = 'JOB';
    if (typeof divPrefixInfo === 'string') prefix = divPrefixInfo;
    else if (divPrefixInfo && typeof divPrefixInfo === 'object') {
      if (coreType === 'OH' && (divPrefixInfo as any)['OH']) {
        prefix = (divPrefixInfo as any)['OH'];
      } else {
        prefix = (divPrefixInfo as any)[coreType] || (divPrefixInfo as any)['CRGO'] || 'JOB';
      }
    } else if (divPrefixInfo) prefix = String(divPrefixInfo);
    
    let lastNum = 0;
    const counterKey = coreType === 'OH' ? `${division}_OH` : division;
    
    if (activeAtMaster && activeAtMaster.lastJobNumbers) {
      lastNum = activeAtMaster.lastJobNumbers[counterKey] || 0;
    } else if (activeAgency.lastJobNumbers) {
      lastNum = activeAgency.lastJobNumbers[counterKey] || 0;
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
