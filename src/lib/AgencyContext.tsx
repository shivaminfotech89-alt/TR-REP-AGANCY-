import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { db, auth, handleFirestoreError, OperationType } from './firebase';
import { collection, query, where, getDocs, doc, setDoc, updateDoc } from 'firebase/firestore';

export interface Agency {
  id: string;
  name: string;
  letterheadUrl: string;
  prefixes: Record<string, string>;
  lastJobNumbers: Record<string, number>;
  gstNo?: string;
  panNo?: string;
  address?: string;
  phone?: string;
  email?: string;
  bankName?: string;
  bankAccNo?: string;
  bankIfsc?: string;
  orderNo?: string;
  /** Capacity(kva)->circle office estimate passing power; overrides defaults when set */
  circleOfficeLimits?: Record<string, number>;
  lastEstimateNo?: number;
  lastBillNo?: number;
  lastChallanNo?: number;
  lastExtInspNo?: number;
  lastIntInspNo?: number;
  ownerId?: string;
}

interface AgencyContextType {
  agencies: Agency[];
  activeAgency: Agency | null;
  setActiveAgencyId: (id: string) => void;
  loading: boolean;
  addAgency: (agencyData: Omit<Agency, 'id'>) => Promise<void>;
  updateAgency: (id: string, agencyData: Partial<Agency>) => Promise<void>;
  getNextJobNoInfo: (division: string) => { prefix: string; nextNum: number };
  incrementJobNoCounter: (division: string, count: number) => Promise<void>;
  nextSequence: (field: 'lastEstimateNo' | 'lastBillNo' | 'lastChallanNo' | 'lastExtInspNo' | 'lastIntInspNo') => Promise<number>;
}

const AgencyContext = createContext<AgencyContextType | undefined>(undefined);

export function AgencyProvider({ children }: { children: ReactNode }) {
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [activeAgencyId, setActiveAgencyId] = useState<string | null>(
    () => localStorage.getItem('activeAgencyId')
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAgencies() {
      if (!auth.currentUser) {
        setAgencies([]);
        setLoading(false);
        return;
      }
      try {
        const q = query(collection(db, 'agencies'), where('ownerId', '==', auth.currentUser.uid));
        const snapshot = await getDocs(q);
        const fetchedAgencies = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Agency));
        setAgencies(fetchedAgencies);
        if (fetchedAgencies.length > 0) {
          const stored = localStorage.getItem('activeAgencyId');
          const valid = fetchedAgencies.find((a) => a.id === stored);
          setActiveAgencyId(valid ? valid.id : fetchedAgencies[0].id);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'agencies');
      } finally {
        setLoading(false);
      }
    }

    const unsub = auth.onAuthStateChanged(() => {
      setLoading(true);
      fetchAgencies();
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (activeAgencyId) localStorage.setItem('activeAgencyId', activeAgencyId);
  }, [activeAgencyId]);

  const activeAgency = agencies.find((a) => a.id === activeAgencyId) || null;

  const addAgency = async (agencyData: Omit<Agency, 'id'>) => {
    if (!auth.currentUser) return;
    try {
      const newRef = doc(collection(db, 'agencies'));
      const newAgency = {
        letterheadUrl: '',
        lastEstimateNo: 0,
        lastBillNo: 0,
        lastChallanNo: 0,
        lastExtInspNo: 0,
        lastIntInspNo: 0,
        ...agencyData,
        ownerId: auth.currentUser.uid,
      };
      await setDoc(newRef, newAgency);
      setAgencies((prev) => [...prev, { id: newRef.id, ...newAgency }]);
      if (!activeAgencyId) setActiveAgencyId(newRef.id);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'agencies');
      throw err;
    }
  };

  const updateAgency = async (id: string, agencyData: Partial<Agency>) => {
    try {
      const ref = doc(db, 'agencies', id);
      // strip id if present
      const { id: _ignore, ...rest } = agencyData as Agency;
      await updateDoc(ref, rest);
      setAgencies((prev) => prev.map((a) => (a.id === id ? { ...a, ...rest } : a)));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'agencies');
      throw err;
    }
  };

  const getNextJobNoInfo = (division: string) => {
    if (!activeAgency) return { prefix: 'JOB', nextNum: 1 };
    const prefix = activeAgency.prefixes[division] || 'JOB';
    const lastNum = (activeAgency.lastJobNumbers && activeAgency.lastJobNumbers[division]) || 0;
    return { prefix, nextNum: lastNum + 1 };
  };

  const incrementJobNoCounter = async (division: string, count: number) => {
    if (!activeAgency) return;
    const currentLastNum = (activeAgency.lastJobNumbers && activeAgency.lastJobNumbers[division]) || 0;
    const newLastJobNumbers = {
      ...(activeAgency.lastJobNumbers || {}),
      [division]: currentLastNum + count,
    };
    await updateAgency(activeAgency.id, { lastJobNumbers: newLastJobNumbers });
  };

  const nextSequence = async (
    field: 'lastEstimateNo' | 'lastBillNo' | 'lastChallanNo' | 'lastExtInspNo' | 'lastIntInspNo'
  ) => {
    if (!activeAgency) throw new Error('No active agency');
    const current = (activeAgency[field] as number | undefined) || 0;
    const next = current + 1;
    await updateAgency(activeAgency.id, { [field]: next });
    return next;
  };

  return (
    <AgencyContext.Provider
      value={{
        agencies,
        activeAgency,
        setActiveAgencyId,
        loading,
        addAgency,
        updateAgency,
        getNextJobNoInfo,
        incrementJobNoCounter,
        nextSequence,
      }}
    >
      {children}
    </AgencyContext.Provider>
  );
}

export function useAgency() {
  const context = useContext(AgencyContext);
  if (context === undefined) {
    throw new Error('useAgency must be used within an AgencyProvider');
  }
  return context;
}
