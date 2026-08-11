import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { db, auth, handleFirestoreError, OperationType } from './firebase';
import { collection, query, where, getDocs, doc, setDoc, updateDoc } from 'firebase/firestore';

export interface Agency {
  id: string;
  name: string;
  letterheadUrl: string; // Storing as base64 or external URL for simplicity
  prefixes: Record<string, string>; // Division name to Prefix mapping
  // Using a separate collection/document for sequence to handle concurrent access, but we'll simplify here
  // by keeping it in the agency doc for this prototype.
  lastJobNumbers: Record<string, number>; 
}

interface AgencyContextType {
  agencies: Agency[];
  activeAgency: Agency | null;
  setActiveAgencyId: (id: string) => void;
  loading: boolean;
  addAgency: (agencyData: Omit<Agency, 'id'>) => Promise<void>;
  updateAgency: (id: string, agencyData: Partial<Agency>) => Promise<void>;
  getNextJobNoInfo: (division: string) => { prefix: string, nextNum: number };
  incrementJobNoCounter: (division: string, count: number) => Promise<void>;
}

const AgencyContext = createContext<AgencyContextType | undefined>(undefined);

export function AgencyProvider({ children }: { children: ReactNode }) {
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [activeAgencyId, setActiveAgencyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAgencies() {
      if (!auth.currentUser) return;
      try {
        const q = query(collection(db, 'agencies'), where('ownerId', '==', auth.currentUser.uid));
        const snapshot = await getDocs(q);
        const fetchedAgencies = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Agency));
        
        setAgencies(fetchedAgencies);
        if (fetchedAgencies.length > 0 && !activeAgencyId) {
          setActiveAgencyId(fetchedAgencies[0].id);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'agencies');
      } finally {
        setLoading(false);
      }
    }

    if (auth.currentUser) {
      fetchAgencies();
    } else {
      setAgencies([]);
      setActiveAgencyId(null);
      setLoading(false);
    }
  }, [auth.currentUser]);

  const activeAgency = agencies.find(a => a.id === activeAgencyId) || null;

  const addAgency = async (agencyData: Omit<Agency, 'id'>) => {
    if (!auth.currentUser) return;
    try {
      const newRef = doc(collection(db, 'agencies'));
      const newAgency = { ...agencyData, ownerId: auth.currentUser.uid };
      await setDoc(newRef, newAgency);
      setAgencies(prev => [...prev, { id: newRef.id, ...agencyData }]);
      if (!activeAgencyId) {
        setActiveAgencyId(newRef.id);
      }
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
      [division]: currentLastNum + count 
    };
    await updateAgency(activeAgency.id, { lastJobNumbers: newLastJobNumbers });
  };

  return (
    <AgencyContext.Provider value={{
      agencies,
      activeAgency,
      setActiveAgencyId,
      loading,
      addAgency,
      updateAgency,
      getNextJobNoInfo,
      incrementJobNoCounter
    }}>
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
