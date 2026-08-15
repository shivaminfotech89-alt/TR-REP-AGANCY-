import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, doc, query, where, getDocs, runTransaction } from 'firebase/firestore';
import { 
  Loader2, 
  ArrowLeft, 
  Plus, 
  Trash2, 
  Zap, 
  Search, 
  CheckCircle2, 
  History, 
  X, 
  Sparkles,
  ShieldCheck,
  Calendar,
  Building2,
  Hash,
  FileText,
  Printer,
  Clock,
  AlertTriangle,
  Layers,
  Copy,
  RotateCcw,
  Check,
  PackageCheck,
  AlertCircle,
  ArrowRight,
  Info,
  Tag
} from 'lucide-react';
import { useAgency } from '../lib/AgencyContext';
import { LetterheadHeader } from './LetterheadHeader';
import { formatDDMMYYYY } from '../lib/utils';
import appLogo from '../assets/images/transformer_app_logo_1786648240128.jpg';

interface TransformerEntry {
  jobNo: string;
  capacityKva: string;
  make: string;
  serialNo: string;
  coreType: string;
  autoFilledFrom?: string;
  prevAtNo?: string;
  prevJobNo?: string;
  prevDeliveryDate?: string;
  gpReason?: string;
}

const COMMON_KVA_OPTIONS = ['10', '16', '25', '63', '100', '200', '250', '315', '500'];
const COMMON_GP_REASONS = ['HT Coil Burn', 'LT Coil Burn', 'Oil Leakage', 'Flashover / Bushing', 'High Temperature', 'Core Damage', 'Tripping on Load'];
const COMMON_GP_TERMS = [
  { months: 12, label: '12 Mos (1 Yr)' },
  { months: 18, label: '18 Mos (1.5 Yrs)' },
  { months: 24, label: '24 Mos (2 Yrs)' },
  { months: 36, label: '36 Mos (3 Yrs)' },
  { months: 60, label: '60 Mos (5 Yrs)' }
];

export interface GpCalculationResult {
  isValidDate: boolean;
  repairedDateStr: string;
  inwardDateStr: string;
  guaranteeMonths: number;
  expiryDateStr: string;
  elapsedDays: number;
  elapsedMonthsText: string;
  remainingDays: number;
  remainingMonthsText: string;
  isWithinWarranty: boolean;
  statusText: string;
  statusType: 'valid' | 'expired' | 'future' | 'invalid';
}

export function calculateGpWarranty(
  lastRepairedDateStr: string,
  inwardDateStr: string,
  guaranteeMonths: number = 18
): GpCalculationResult | null {
  if (!lastRepairedDateStr) return null;
  const repairedDate = new Date(lastRepairedDateStr);
  const inwardDate = inwardDateStr ? new Date(inwardDateStr) : new Date();
  
  if (isNaN(repairedDate.getTime()) || isNaN(inwardDate.getTime())) {
    return {
      isValidDate: false,
      repairedDateStr: lastRepairedDateStr,
      inwardDateStr,
      guaranteeMonths,
      expiryDateStr: '',
      elapsedDays: 0,
      elapsedMonthsText: '',
      remainingDays: 0,
      remainingMonthsText: '',
      isWithinWarranty: false,
      statusText: 'Invalid Date',
      statusType: 'invalid'
    };
  }

  // Calculate Expiry Date = repairedDate + guaranteeMonths
  const expiryDate = new Date(repairedDate);
  expiryDate.setMonth(expiryDate.getMonth() + guaranteeMonths);

  const diffMs = inwardDate.getTime() - repairedDate.getTime();
  const elapsedDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (elapsedDays < 0) {
    return {
      isValidDate: true,
      repairedDateStr: lastRepairedDateStr,
      inwardDateStr,
      guaranteeMonths,
      expiryDateStr: expiryDate.toISOString().split('T')[0],
      elapsedDays,
      elapsedMonthsText: 'Future Date',
      remainingDays: 0,
      remainingMonthsText: '',
      isWithinWarranty: false,
      statusText: 'Last repair date cannot be after current inward date',
      statusType: 'future'
    };
  }

  // Calculate elapsed text (months and days)
  let months = (inwardDate.getFullYear() - repairedDate.getFullYear()) * 12 + (inwardDate.getMonth() - repairedDate.getMonth());
  let dayDiff = inwardDate.getDate() - repairedDate.getDate();
  if (dayDiff < 0) {
    months -= 1;
    const prevMonthLastDay = new Date(inwardDate.getFullYear(), inwardDate.getMonth(), 0).getDate();
    dayDiff += prevMonthLastDay;
  }
  const elapsedMonthsText = `${months > 0 ? `${months} mo${months > 1 ? 's' : ''} ` : ''}${dayDiff} day${dayDiff !== 1 ? 's' : ''} (${elapsedDays} days)`;

  const remainingMs = expiryDate.getTime() - inwardDate.getTime();
  const remainingDays = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
  
  let remMonths = (expiryDate.getFullYear() - inwardDate.getFullYear()) * 12 + (expiryDate.getMonth() - inwardDate.getMonth());
  let remDayDiff = expiryDate.getDate() - inwardDate.getDate();
  if (remDayDiff < 0) {
    remMonths -= 1;
    const prevMonthLastDay = new Date(expiryDate.getFullYear(), expiryDate.getMonth(), 0).getDate();
    remDayDiff += prevMonthLastDay;
  }
  const remainingMonthsText = remainingDays >= 0 
    ? `${remMonths > 0 ? `${remMonths} mo${remMonths > 1 ? 's' : ''} ` : ''}${remDayDiff} day${remDayDiff !== 1 ? 's' : ''} remaining`
    : `${Math.abs(remainingDays)} days overdue`;

  const isWithinWarranty = inwardDate.getTime() <= expiryDate.getTime();

  return {
    isValidDate: true,
    repairedDateStr: lastRepairedDateStr,
    inwardDateStr,
    guaranteeMonths,
    expiryDateStr: expiryDate.toISOString().split('T')[0],
    elapsedDays,
    elapsedMonthsText,
    remainingDays,
    remainingMonthsText,
    isWithinWarranty,
    statusText: isWithinWarranty 
      ? `Within ${guaranteeMonths}-Month GP Warranty (${remainingMonthsText})`
      : `Exceeded standard ${guaranteeMonths}-month GP period (${Math.abs(remainingDays)} days beyond warranty)`,
    statusType: isWithinWarranty ? 'valid' : 'expired'
  };
}

export default function NewJob() {
  const navigate = useNavigate();
  const { activeAgency, activeAtMaster, atMasters, getNextJobNoInfo, syncCountersState } = useAgency();
  const gpValidationMonths = activeAgency?.gpValidationMonths ?? 18;
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [autoFillNotice, setAutoFillNotice] = useState<string | null>(null);

  // Past jobs cache across ALL user data / ATs for instant global lookup
  const [pastJobs, setPastJobs] = useState<any[]>([]);
  const [pastJobsLoading, setPastJobsLoading] = useState(false);
  const [showPastPickerRowIndex, setShowPastPickerRowIndex] = useState<number | null>(null);
  const [pastSearchTerm, setPastSearchTerm] = useState('');

  // Receipt Print Modal State
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [savedJobsForReceipt, setSavedJobsForReceipt] = useState<any[] | null>(null);

  const [commonData, setCommonData] = useState({
    mrNo: '',
    dateOfIssue: new Date().toISOString().split('T')[0],
    type: 'Distribution',
    repairType: 'OGP', // OGP, GP
    division: 'SABARMATI',
  });

  const [transformers, setTransformers] = useState<TransformerEntry[]>([
    { 
      jobNo: '', 
      capacityKva: '63', 
      make: '', 
      serialNo: '', 
      coreType: 'CRGO',
      prevAtNo: '',
      prevJobNo: '',
      prevDeliveryDate: '',
      gpReason: ''
    }
  ]);

  // Derived available divisions from active AT / Agency
  const availableDivisions = useMemo(() => {
    const currentPrefixes = (activeAtMaster && activeAtMaster.prefixes && Object.keys(activeAtMaster.prefixes).length > 0) 
        ? activeAtMaster.prefixes 
        : (activeAgency?.prefixes || {});
    const keys = Object.keys(currentPrefixes);
    return keys.length > 0 ? keys : ['SABARMATI', 'GANDHINAGAR', 'AHMEDABAD'];
  }, [activeAtMaster, activeAgency]);

  // Initialize initial division & first Job No
  useEffect(() => {
    if (availableDivisions.length > 0 && (!commonData.division || !availableDivisions.includes(commonData.division))) {
      const firstDiv = availableDivisions[0];
      setCommonData(prev => ({ ...prev, division: firstDiv }));
      
      const { prefix, nextNum } = getNextJobNoInfo(firstDiv, 'CRGO', commonData.repairType);
      setTransformers(prev => {
        if (prev.length === 1 && (!prev[0].jobNo || prev[0].jobNo.startsWith('JOB'))) {
          return [{ ...prev[0], jobNo: `${prefix}-${nextNum}` }];
        }
        return prev;
      });
    }
  }, [availableDivisions, activeAgency, activeAtMaster]);

  // Load past jobs across ALL saved ATs & historical records in user profile
  useEffect(() => {
    if (auth.currentUser) {
      const loadPastJobs = async () => {
        setPastJobsLoading(true);
        try {
          const q = query(
            collection(db, 'jobs'),
            where('ownerId', '==', auth.currentUser!.uid)
          );
          const snap = await getDocs(q);
          const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          list.sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));
          setPastJobs(list);
        } catch (err) {
          console.error('Error loading past jobs across all ATs for GP lookup:', err);
        } finally {
          setPastJobsLoading(false);
        }
      };
      loadPastJobs();
    }
  }, [auth.currentUser]);

  const handleCommonChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setCommonData(prev => ({ ...prev, [name]: value }));

    if (name === 'division' && activeAgency) {
      const oldDivision = commonData.division;
      
      setTransformers(prev => prev.map((t, idx) => {
        const oldInfo = getNextJobNoInfo(oldDivision, t.coreType, commonData.repairType);
        const newInfo = getNextJobNoInfo(value, t.coreType, commonData.repairType);
        
        if (t.jobNo && t.jobNo.startsWith(oldInfo.prefix + '-')) {
          return { ...t, jobNo: t.jobNo.replace(oldInfo.prefix + '-', newInfo.prefix + '-') };
        } else if (!t.jobNo) {
          return { ...t, jobNo: `${newInfo.prefix}-${newInfo.nextNum + idx}` };
        }
        return t;
      }));
    } else if (name === 'repairType' && activeAgency) {
      const oldRepairType = commonData.repairType;
      
      setTransformers(prev => prev.map((t, idx) => {
        const oldInfo = getNextJobNoInfo(commonData.division, t.coreType, oldRepairType);
        const newInfo = getNextJobNoInfo(commonData.division, t.coreType, value);
        
        if (t.jobNo && t.jobNo.startsWith(oldInfo.prefix + '-')) {
          return { ...t, jobNo: t.jobNo.replace(oldInfo.prefix + '-', newInfo.prefix + '-') };
        } else if (!t.jobNo) {
          return { ...t, jobNo: `${newInfo.prefix}-${newInfo.nextNum + idx}` };
        }
        return t;
      }));
    }
  };

  const handleRepairTypeSelect = (type: 'OGP' | 'GP') => {
    if (commonData.repairType === type) return;
    setCommonData(prev => ({ ...prev, repairType: type }));
    
    if (type === 'OGP') {
      // Regenerate sequential job numbers for fresh OGP repairs
      setTransformers(prev => prev.map((t, idx) => {
        const info = getNextJobNoInfo(commonData.division, t.coreType, 'OGP');
        return { ...t, jobNo: `${info.prefix}-${info.nextNum + idx}` };
      }));
    } else {
      // For GP: Keep existing original job numbers or clear for past link / manual original job no entry
      setTransformers(prev => prev.map(t => ({
        ...t,
        jobNo: t.prevJobNo || t.autoFilledFrom || t.jobNo || '',
      })));
    }
  };

  const applyPastJobToRow = (index: number, pastJob: any) => {
    let matchedAtNo = pastJob.prevAtNo || '';
    if (!matchedAtNo && pastJob.atId) {
      const foundAt = atMasters.find(a => a.id === pastJob.atId);
      if (foundAt) matchedAtNo = foundAt.atNumber || foundAt.name;
    }

    const prevDelDate = pastJob.deliveryDate || pastJob.challanDate || pastJob.dateOfIssue || '';
    const originalJobNo = pastJob.jobNo || '';

    setTransformers(prev => {
      const updated = [...prev];
      const targetRow = updated[index];
      const targetCoreType = pastJob.coreType || targetRow.coreType || 'CRGO';

      updated[index] = {
        ...targetRow,
        jobNo: originalJobNo || targetRow.jobNo, // Reuses same original Job No from 1st repair
        capacityKva: String(pastJob.capacityKva || targetRow.capacityKva),
        make: pastJob.make || targetRow.make,
        serialNo: pastJob.serialNo || targetRow.serialNo,
        coreType: targetCoreType,
        autoFilledFrom: pastJob.jobNo || pastJob.serialNo,
        prevJobNo: pastJob.jobNo || '',
        prevAtNo: matchedAtNo,
        prevDeliveryDate: prevDelDate,
        gpReason: targetRow.gpReason || pastJob.gpReason || 'GP Warranty'
      };
      return updated;
    });

    setAutoFillNotice(`✓ GP Transformer linked: Using original Job #${originalJobNo || 'Record'} (${pastJob.capacityKva} KVA, Make: ${pastJob.make}, S/N: ${pastJob.serialNo}) to track guarantee period.`);
    setTimeout(() => setAutoFillNotice(null), 5000);
    setShowPastPickerRowIndex(null);
  };

  const unlinkPastJobFromRow = (index: number) => {
    setTransformers(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        autoFilledFrom: undefined,
        prevJobNo: '',
        prevAtNo: '',
        prevDeliveryDate: ''
      };
      return updated;
    });
    setAutoFillNotice(`Unlinked unit #${index + 1} from past job reference.`);
    setTimeout(() => setAutoFillNotice(null), 4000);
  };

  const handleGpAutoLookup = async (index: number, lookupField: 'serialNo' | 'jobNo', queryVal: string) => {
    if (commonData.repairType !== 'GP' || !queryVal.trim() || !auth.currentUser) return;
    
    const trimmed = queryVal.trim().toLowerCase();
    
    // Check in-memory list first
    const match = pastJobs.find(j => {
      if (lookupField === 'serialNo') {
        return j.serialNo && j.serialNo.toLowerCase() === trimmed;
      } else {
        return j.jobNo && j.jobNo.toLowerCase() === trimmed;
      }
    });

    if (match) {
      applyPastJobToRow(index, match);
      return;
    }

    try {
      const q = query(
        collection(db, 'jobs'),
        where('ownerId', '==', auth.currentUser.uid),
        where(lookupField, '==', queryVal.trim().toUpperCase())
      );
      
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const jobsList = snapshot.docs.map(d => d.data() as any).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        const latestJob = jobsList[0];
        applyPastJobToRow(index, latestJob);
      }
    } catch (err) {
      console.error(`Error fetching GP job details by ${lookupField}:`, err);
    }
  };

  const handleJobNoBlur = async (index: number, jobNo: string) => {
    if (commonData.repairType !== 'GP' || !jobNo.trim()) return;
    // Only auto-suggest if row is not already linked
    if (!transformers[index]?.autoFilledFrom && !transformers[index]?.prevJobNo) {
      await handleGpAutoLookup(index, 'jobNo', jobNo);
    }
  };

  const handleSerialNoBlur = async (index: number, serialNo: string) => {
    if (commonData.repairType !== 'GP' || !serialNo.trim()) return;
    // Only auto-suggest if row is not already linked
    if (!transformers[index]?.autoFilledFrom && !transformers[index]?.prevJobNo) {
      await handleGpAutoLookup(index, 'serialNo', serialNo);
    }
  };

  const handleTransformerChange = (index: number, field: keyof TransformerEntry, value: string) => {
    const newTransformers = [...transformers];
    newTransformers[index][field] = value;
    
    // Auto-update jobNo if coreType changes
    if (field === 'coreType' && activeAgency) {
      const newCoreType = value;
      const info = getNextJobNoInfo(commonData.division, newCoreType, commonData.repairType);
      
      let highestNum = info.nextNum - 1;
      newTransformers.forEach((t, i) => {
        if (i === index) return;
        const tInfo = getNextJobNoInfo(commonData.division, t.coreType, commonData.repairType);
        if (tInfo.counterKey === info.counterKey) {
          const parts = t.jobNo.split('-');
          if (parts.length > 1) {
            const num = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(num) && num > highestNum) highestNum = num;
          }
        }
      });
      newTransformers[index].jobNo = `${info.prefix}-${highestNum + 1}`;
    }
    
    setTransformers(newTransformers);
  };

  const addTransformer = () => {
    let nextJobNo = '';
    const lastCoreType = transformers.length > 0 ? transformers[transformers.length - 1].coreType : 'CRGO';
    const lastKva = transformers.length > 0 ? transformers[transformers.length - 1].capacityKva : '63';
    
    // Only generate new sequence Job No for fresh OGP repairs. GP reuses original Job No from 1st repair.
    if (commonData.repairType === 'OGP' && activeAgency) {
      const info = getNextJobNoInfo(commonData.division, lastCoreType, 'OGP');
      let highestNum = info.nextNum - 1;
      transformers.forEach(t => {
        const tInfo = getNextJobNoInfo(commonData.division, t.coreType, 'OGP');
        if (tInfo.counterKey === info.counterKey) {
          const parts = t.jobNo.split('-');
          if (parts.length > 1) {
            const num = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(num) && num > highestNum) highestNum = num;
          }
        }
      });
      nextJobNo = `${info.prefix}-${highestNum + 1}`;
    }

    setTransformers([
      ...transformers, 
      { 
        jobNo: nextJobNo, 
        capacityKva: lastKva, 
        make: '', 
        serialNo: '', 
        coreType: lastCoreType,
        prevAtNo: '',
        prevJobNo: '',
        prevDeliveryDate: '',
        gpReason: ''
      }
    ]);
  };

  const duplicateTransformer = (index: number) => {
    const source = transformers[index];
    let nextJobNo = '';
    
    // Only generate new sequence Job No for OGP repairs
    if (commonData.repairType === 'OGP') {
      const info = getNextJobNoInfo(commonData.division, source.coreType, 'OGP');
      let highestNum = info.nextNum - 1;
      transformers.forEach(t => {
        const tInfo = getNextJobNoInfo(commonData.division, t.coreType, 'OGP');
        if (tInfo.counterKey === info.counterKey) {
          const parts = t.jobNo.split('-');
          if (parts.length > 1) {
            const num = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(num) && num > highestNum) highestNum = num;
          }
        }
      });
      nextJobNo = `${info.prefix}-${highestNum + 1}`;
    }

    const newEntry: TransformerEntry = {
      ...source,
      jobNo: nextJobNo,
      serialNo: '',
      autoFilledFrom: undefined
    };

    const next = [...transformers];
    next.splice(index + 1, 0, newEntry);
    setTransformers(next);
  };

  const removeTransformer = (index: number) => {
    if (transformers.length === 1) return;
    const newTransformers = [...transformers];
    newTransformers.splice(index, 1);
    setTransformers(newTransformers);
  };

  const handleAutoFillEmptyJobNos = () => {
    if (!activeAgency) {
      setErrorMsg("Please configure and select an agency in Settings first.");
      return;
    }
    
    const nextNums: Record<string, number> = {};
    
    transformers.forEach(t => {
      const info = getNextJobNoInfo(commonData.division, t.coreType, commonData.repairType);
      if (!nextNums[info.counterKey]) {
        nextNums[info.counterKey] = info.nextNum;
      }
      const parts = t.jobNo.split('-');
      if (parts.length > 1) {
        const num = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(num) && num >= nextNums[info.counterKey]) {
          nextNums[info.counterKey] = num + 1;
        }
      }
    });
    
    const newTransformers = transformers.map(t => {
      if (!t.jobNo.trim()) {
        const info = getNextJobNoInfo(commonData.division, t.coreType, commonData.repairType);
        if (!nextNums[info.counterKey]) nextNums[info.counterKey] = info.nextNum;
        
        const jobNo = `${info.prefix}-${nextNums[info.counterKey]}`;
        nextNums[info.counterKey]++;
        return { ...t, jobNo };
      }
      return t;
    });
    
    setTransformers(newTransformers);
  };

  // Derived Totals
  const totalKva = useMemo(() => {
    return transformers.reduce((sum, t) => sum + (Number(t.capacityKva) || 0), 0);
  }, [transformers]);

  const coreTypeSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    transformers.forEach(t => {
      const ct = t.coreType || 'CRGO';
      counts[ct] = (counts[ct] || 0) + 1;
    });
    return counts;
  }, [transformers]);

  // Allotment balance summary for current division
  const divisionAllotmentInfo = useMemo(() => {
    if (!activeAtMaster && !activeAgency) return null;
    const div = commonData.division;
    const allotments = activeAtMaster?.allotments?.[div] || activeAgency?.allotments?.[div] || {};
    return allotments;
  }, [activeAtMaster, activeAgency, commonData.division]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !activeAgency) return;
    
    setLoading(true);
    try {
      const now = Date.now();

      // Check MR No duplication
      const mrQuery = query(
        collection(db, 'jobs'), 
        where('ownerId', '==', auth.currentUser.uid), 
        where('mrNo', '==', commonData.mrNo)
      );
      const mrDocs = await getDocs(mrQuery);
      
      let isDuplicateMR = false;
      mrDocs.forEach(docSnap => {
         const d = docSnap.data();
         if (d.ownerId === auth.currentUser.uid && d.division === commonData.division && d.agencyId === activeAgency.id) {
            isDuplicateMR = true;
         }
      });
      
      if (isDuplicateMR) {
         setErrorMsg(`MR No "${commonData.mrNo}" already exists for division ${commonData.division}. Duplicate MR within same division is not allowed.`);
         setLoading(false);
         return;
      }

      // Check Allotment limits ONLY for OGP (Out of Guarantee) jobs!
      // GP repairs (guarantee rework from current or previous AT) are exempt and do not deduct fresh quota!
      if (activeAtMaster && activeAgency && commonData.repairType === 'OGP') {
        const countsToAdd: Record<string, number> = {};
        for (const t of transformers) {
          const cType = t.coreType || 'CRGO';
          if (cType === 'OH') continue;
          countsToAdd[cType] = (countsToAdd[cType] || 0) + 1;
        }
        
        const snap = await getDocs(query(
            collection(db, 'jobs'),
            where('ownerId', '==', auth.currentUser.uid),
            where('atId', '==', activeAtMaster.id)
        ));
        
        const existingJobsData = snap.docs.map(d => d.data());

        for (const [cType, countToAdd] of Object.entries(countsToAdd)) {
          let allowed = Number(activeAtMaster.allotments?.[commonData.division]?.[cType]);
          
          if (!allowed || allowed === 0) {
             allowed = Number(activeAgency.allotments?.[commonData.division]?.[cType]) || 0;
          }
          
          allowed = allowed || 0;
          
          if (allowed > 0) {
            let used = 0;
            existingJobsData.forEach(data => {
              if (data.ownerId !== auth.currentUser.uid || data.division !== commonData.division) return;
              if (data.repairType === 'OH' || data.repairType === 'GP') return;
              
              const docType = data.coreType || 'CRGO';
              if (docType === 'OH') return;
              if (docType === cType) {
                used++;
              }
            });
            
            if (used + countToAdd > allowed) {
              setErrorMsg(`Cannot receive job. ${cType} allotment exceeded for ${commonData.division}.\nAllowed Allotment: ${allowed}\nAlready Used: ${used}\nAttempting to Add: ${countToAdd}`);
              setLoading(false);
              return;
            }
          }
        }
      }

      // Check local Job No duplicates
      const jobNos = transformers.map(t => t.jobNo).filter(j => j);
      if (jobNos.length > 0) {
        const uniqueJobNos = new Set(jobNos);
        if (uniqueJobNos.size !== jobNos.length) {
           setErrorMsg("Duplicate Job Numbers detected in the transformer list.");
           setLoading(false);
           return;
        }

        // Check active jobs in database
        for (const jn of jobNos) {
           const jnQuery = query(
             collection(db, 'jobs'), 
             where('ownerId', '==', auth.currentUser.uid), 
             where('jobNo', '==', jn)
           );
           const jnDocs = await getDocs(jnQuery);
           
           if (!jnDocs.empty) {
             const jnDocsFiltered = jnDocs.docs.filter(d => {
               const data = d.data();
               return data.ownerId === auth.currentUser.uid && data.agencyId === activeAgency.id && data.atId === (activeAtMaster?.id || '');
             });
             if (jnDocsFiltered.length > 0) {
                 const activeCycles = jnDocsFiltered.filter(d => d.data().isClosed !== true);
                 if (activeCycles.length > 0) {
                   setErrorMsg(`Job No "${jn}" already exists and is active. Please enter or generate a new unique Job Number.`);
                   setLoading(false);
                   return;
                 }
             }
           }
        }
      }

      let updatedLastJobNumbers: Record<string, number> | null = null;
      let targetDocId: string | null = null;
      let isAtMasterTarget = false;

      const createdJobsList: any[] = [];

      await runTransaction(db, async (transaction) => {
        // 1. Reads
        let currentCounters: Record<string, number> = {};
        let masterDocRef: any = null;

        if (activeAtMaster) {
          masterDocRef = doc(db, 'atMasters', activeAtMaster.id);
          const atDocSnap = await transaction.get(masterDocRef);
          if (atDocSnap.exists()) {
            const data = atDocSnap.data() as Record<string, any>;
            currentCounters = { ...(data?.lastJobNumbers || {}) };
          }
          isAtMasterTarget = true;
          targetDocId = activeAtMaster.id;
        } else if (activeAgency) {
          masterDocRef = doc(db, 'agencies', activeAgency.id);
          const agencyDocSnap = await transaction.get(masterDocRef);
          if (agencyDocSnap.exists()) {
            const data = agencyDocSnap.data() as Record<string, any>;
            currentCounters = { ...(data?.lastJobNumbers || {}) };
          }
          isAtMasterTarget = false;
          targetDocId = activeAgency.id;
        }

        // 2. Calculations
        const maxJobNoMap: Record<string, number> = {};
        const jobEntries: { ref: any; data: any }[] = [];

        for (const t of transformers) {
          if (!t.jobNo) continue;

          // Only update sequence counter for OGP repairs. GP warranty repairs reuse the original Job Number from 1st repair.
          if (commonData.repairType !== 'GP') {
            const info = getNextJobNoInfo(commonData.division, t.coreType, 'OGP');
            const counterKey = info.counterKey;

            const parts = t.jobNo.split('-');
            if (parts.length > 1) {
              const num = parseInt(parts[parts.length - 1], 10);
              if (!isNaN(num)) {
                if (!maxJobNoMap[counterKey] || num > maxJobNoMap[counterKey]) {
                  maxJobNoMap[counterKey] = num;
                }
              }
            }
          }

          const newJobRef = doc(collection(db, 'jobs'));
            // Previous AT & GP Warranty Metadata (Computed directly from row's Last Repaired Date & Agency GP Validation setting)
            const rowGpCalc = (commonData.repairType === 'GP' && t.prevDeliveryDate) 
              ? calculateGpWarranty(t.prevDeliveryDate, commonData.dateOfIssue, gpValidationMonths) 
              : null;

            const jobData = {
              mrNo: commonData.mrNo.trim(),
              dateOfIssue: commonData.dateOfIssue,
              type: commonData.type,
              repairType: commonData.repairType,
              isGp: commonData.repairType === 'GP',
              division: commonData.division,
              jobNo: t.jobNo.trim(),
              capacityKva: Number(t.capacityKva),
              make: t.make.trim().toUpperCase(),
              serialNo: t.serialNo.trim().toUpperCase(),
              coreType: t.coreType,
              status: 'Received',
              isClosed: false,
              atId: activeAtMaster ? activeAtMaster.id : '',
              
              // Previous AT & Auto-Calculated GP Warranty Metadata
              gpGuaranteeMonths: commonData.repairType === 'GP' ? gpValidationMonths : null,
              lastRepairedDate: t.prevDeliveryDate || '',
              prevDeliveryDate: t.prevDeliveryDate || '',
              gpExpiryDate: rowGpCalc?.expiryDateStr || '',
              gpElapsedDays: rowGpCalc?.elapsedDays || 0,
              gpStatus: rowGpCalc 
                ? (rowGpCalc.isWithinWarranty ? 'Within GP Warranty' : 'GP Period Exceeded') 
                : (commonData.repairType === 'GP' ? 'GP Warranty' : ''),
              prevAtNo: t.prevAtNo || '',
              prevJobNo: t.prevJobNo || (commonData.repairType === 'GP' ? t.jobNo : ''),
              gpReason: t.gpReason || '',
              autoFilledFrom: t.autoFilledFrom || '',

              createdAt: now,
              updatedAt: now,
              ownerId: auth.currentUser.uid,
              agencyId: activeAgency.id,
            };
          
          jobEntries.push({ ref: newJobRef, data: jobData });
          createdJobsList.push({ id: newJobRef.id, ...jobData });
        }

        const nextCounters = { ...currentCounters };
        let hasCounterChange = false;

        for (const [counterKey, maxNum] of Object.entries(maxJobNoMap)) {
          const currentLast = currentCounters[counterKey] || 0;
          if (maxNum > currentLast) {
            nextCounters[counterKey] = maxNum;
            hasCounterChange = true;
          }
        }

        // 3. Writes
        for (const entry of jobEntries) {
          transaction.set(entry.ref, entry.data);
        }

        if (masterDocRef && hasCounterChange) {
          transaction.update(masterDocRef, { lastJobNumbers: nextCounters });
          updatedLastJobNumbers = nextCounters;
        }
      });

      if (updatedLastJobNumbers && targetDocId) {
        syncCountersState(isAtMasterTarget, targetDocId, updatedLastJobNumbers);
      }

      setSavedJobsForReceipt(createdJobsList);
      setShowReceiptModal(true);

    } catch (err) {
      console.error("Submission Error", err);
      setErrorMsg("Submission Error: " + (err instanceof Error ? err.message : String(err)));
      handleFirestoreError(err, OperationType.CREATE, 'jobs');
    } finally {
      setLoading(false);
    }
  };

  const handlePrintReceipt = () => {
    window.print();
  };

  return (
    <div className="w-full max-w-full overflow-x-hidden space-y-4 pb-24 sm:pb-16 print:m-0 print:p-0">
      
      {/* ERROR MODAL */}
      {errorMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-5 sm:p-6 max-w-md w-full border border-rose-200 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center gap-3 mb-3 text-rose-600">
              <div className="bg-rose-100 p-2.5 rounded-xl shrink-0">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Attention Required</h3>
                <p className="text-xs text-rose-600 font-medium">Please review the following issue</p>
              </div>
            </div>
            <p className="text-slate-700 text-xs sm:text-sm whitespace-pre-wrap mb-5 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200">
              {errorMsg}
            </p>
            <div className="flex justify-end">
              <button 
                type="button"
                onClick={() => setErrorMsg(null)} 
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors shadow-xs cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOP HEADER & AGENCY INFO */}
      <div className="bg-slate-900 rounded-xl sm:rounded-2xl p-3 sm:p-4 text-white shadow-md border border-slate-800 print:hidden w-full">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          
          <div className="flex items-center gap-3 min-w-0">
            <Link 
              to="/" 
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition-colors shrink-0"
              title="Back to Dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <img 
              src={appLogo} 
              alt="Logo" 
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl border border-blue-400/40 object-cover shrink-0" 
              referrerPolicy="no-referrer"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <h1 className="text-sm sm:text-base md:text-lg font-black text-white truncate tracking-tight">
                  New Transformer Inward Entry
                </h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 shrink-0">
                  {activeAtMaster ? `AT: ${activeAtMaster.atNumber || activeAtMaster.name}` : 'Agency Mode'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                Material Receipt (MR) Inward & Transformer Job Numbering
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleAutoFillEmptyJobNos}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold transition-all cursor-pointer"
              title="Auto-calculate next available job numbers"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Auto Job Nos</span>
            </button>
            
            <button
              type="button"
              onClick={addTransformer}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Transformer</span>
            </button>
          </div>

        </div>
      </div>

      {/* AUTO-FILL TOAST NOTICE */}
      {autoFillNotice && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold rounded-xl flex items-center justify-between gap-2 shadow-xs animate-in fade-in print:hidden">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{autoFillNotice}</span>
          </div>
          <button 
            type="button"
            onClick={() => setAutoFillNotice(null)}
            className="text-emerald-700 hover:text-emerald-950 p-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* MAIN INTAKE FORM */}
      <form onSubmit={handleSubmit} className="space-y-4 print:hidden">
        
        {/* ========================================================================= */}
        {/* SECTION 1: MR / CHALLAN & INTAKE DETAILS */}
        {/* ========================================================================= */}
        <div className="bg-white border border-slate-200 rounded-xl sm:rounded-2xl p-3.5 sm:p-5 shadow-xs">
          
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-xs sm:text-sm font-bold text-slate-900">
                  Step 1: MR & Inward Information
                </h2>
                <p className="text-[11px] text-slate-500">
                  Enter MR number, date, division office, and category
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            
            {/* MR NUMBER */}
            <div>
              <label className="block text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                MR / Challan No. <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Hash className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input 
                  required
                  type="text" 
                  name="mrNo"
                  value={commonData.mrNo} 
                  onChange={handleCommonChange} 
                  className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-xs sm:text-sm font-mono font-bold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-slate-50/50 focus:bg-white transition-colors" 
                  placeholder="e.g. 5933 / MR-104" 
                />
              </div>
            </div>

            {/* MR RECEIVE DATE */}
            <div>
              <label className="block text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                MR Receive Date <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input 
                  required
                  type="date" 
                  name="dateOfIssue"
                  value={commonData.dateOfIssue} 
                  onChange={handleCommonChange} 
                  className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-xs sm:text-sm font-mono font-bold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-slate-50/50 focus:bg-white transition-colors" 
                />
              </div>
            </div>

            {/* DIVISION OFFICE */}
            <div>
              <label className="block text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                Division Office <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <select
                  name="division"
                  value={commonData.division}
                  onChange={handleCommonChange}
                  className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-xs sm:text-sm font-bold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-slate-50/50 focus:bg-white transition-colors cursor-pointer"
                >
                  {availableDivisions.map(div => (
                    <option key={div} value={div}>{div}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* REPAIR TYPE / CATEGORY SWITCHER */}
            <div>
              <label className="block text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                Repair Category <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => handleRepairTypeSelect('OGP')}
                  className={`py-2 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    commonData.repairType === 'OGP'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>OGP (Normal)</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleRepairTypeSelect('GP')}
                  className={`py-2 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    commonData.repairType === 'GP'
                      ? 'bg-amber-600 text-white shadow-xs ring-2 ring-amber-400/40'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>GP (Warranty)</span>
                </button>
              </div>
            </div>

          </div>

          {/* ALLOTMENT STATUS BADGE STRIP (FOR OGP) */}
          {commonData.repairType === 'OGP' && divisionAllotmentInfo && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                <Info className="w-3.5 h-3.5 text-blue-500" />
                <span>Current Allotment for <strong>{commonData.division}</strong>:</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {Object.entries(divisionAllotmentInfo).map(([core, count]) => (
                  <span key={core} className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg font-mono font-bold text-[11px] border border-slate-200">
                    {core}: {String(count)} Max
                  </span>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* ========================================================================= */}
        {/* SECTION 2: TRANSFORMER UNITS INTAKE GRID */}
        {/* ========================================================================= */}
        <div className="bg-white border border-slate-200 rounded-xl sm:rounded-2xl overflow-hidden shadow-xs">
          
          <div className="p-3.5 sm:p-4 bg-slate-50/80 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" />
                <span>Step 2: Transformer Units ({transformers.length})</span>
              </h2>
              <p className="text-[11px] text-slate-500">
                {commonData.repairType === 'GP' 
                  ? `Enter technical specs & Last Repaired Date for GP warranty tracking (MR #${commonData.mrNo || '...'})`
                  : `Enter technical specifications for each unit received under MR #${commonData.mrNo || '...'}`}
              </p>
            </div>

            {/* SUMMARY STATS PILLS */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold font-mono text-slate-800">
                Total: {transformers.length} Unit(s)
              </span>
              <span className="px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-lg text-xs font-bold font-mono text-blue-800">
                {totalKva} KVA
              </span>
              {Object.entries(coreTypeSummary).map(([ct, cnt]) => (
                <span key={ct} className="px-2 py-1 bg-slate-100 border border-slate-200 rounded-lg text-[11px] font-bold text-slate-700">
                  {ct}: {cnt}
                </span>
              ))}
            </div>
          </div>

          {/* TRANSFORMER ROWS CONTAINER */}
          <div className="p-3 sm:p-4 space-y-3">
            {transformers.map((t, index) => (
              <div 
                key={index} 
                className={`p-3 sm:p-4 rounded-xl border transition-all ${
                  commonData.repairType === 'GP' 
                    ? 'border-amber-200 bg-amber-50/30' 
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                
                {/* ROW TOP BAR */}
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 pb-2 border-b border-slate-100">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-slate-900 text-white font-mono text-xs font-bold flex items-center justify-center">
                      {index + 1}
                    </span>
                    <span className="text-xs font-bold text-slate-800">
                      Transformer #{index + 1}
                    </span>
                    {commonData.repairType === 'GP' && (t.prevJobNo || t.autoFilledFrom) ? (
                      <div className="flex items-center gap-1.5 bg-emerald-100/90 text-emerald-900 px-2 py-0.5 rounded-md text-[10px] font-bold">
                        <Check className="w-3 h-3 text-emerald-700" />
                        <span>Reusing 1st Repair Job #{t.jobNo}</span>
                        <button
                          type="button"
                          onClick={() => unlinkPastJobFromRow(index)}
                          className="ml-1 text-[9px] text-emerald-800 hover:text-rose-700 underline font-semibold cursor-pointer"
                          title="Unlink past job reference"
                        >
                          Unlink
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {commonData.repairType === 'GP' && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowPastPickerRowIndex(index);
                          setPastSearchTerm('');
                        }}
                        className="text-[11px] font-bold text-amber-900 hover:text-amber-950 bg-amber-200/90 hover:bg-amber-300 px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                        title="Pick past transformer from database to auto-fill technical details"
                      >
                        <History className="w-3.5 h-3.5 text-amber-800" />
                        <span>{t.prevJobNo ? 'Change Past TR' : 'Pick Past TR'}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => duplicateTransformer(index)}
                      className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                      title="Duplicate row"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>

                    {transformers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeTransformer(index)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        title="Remove row"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* ROW INPUTS GRID */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
                  
                  {/* JOB NUMBER */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center justify-between">
                      <span>
                        {commonData.repairType === 'GP' ? 'Original Job No. *' : 'Job No. *'}
                      </span>
                      {commonData.repairType === 'GP' && (
                        <span className="text-[9px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.2 rounded font-sans lowercase">
                          same as 1st repair
                        </span>
                      )}
                    </label>
                    <input
                      required
                      type="text"
                      list={commonData.repairType === 'GP' ? `past-job-suggestions-${index}` : undefined}
                      value={t.jobNo}
                      onChange={(e) => {
                        const val = e.target.value;
                        handleTransformerChange(index, 'jobNo', val);
                        if (commonData.repairType === 'GP' && val.trim()) {
                          const exactMatch = pastJobs.find(j => j.jobNo && j.jobNo.toUpperCase() === val.trim().toUpperCase());
                          if (exactMatch && !t.autoFilledFrom) {
                            applyPastJobToRow(index, exactMatch);
                          }
                        }
                      }}
                      onBlur={() => handleJobNoBlur(index, t.jobNo)}
                      className={`w-full px-3 py-2 text-xs sm:text-sm font-mono font-bold border rounded-lg focus:ring-1 bg-white ${
                        commonData.repairType === 'GP'
                          ? 'border-amber-300 focus:ring-amber-500 focus:border-amber-500 text-amber-950'
                          : 'border-slate-200 focus:ring-blue-500 focus:border-blue-500 text-slate-900'
                      }`}
                      placeholder={commonData.repairType === 'GP' ? 'Select or Type Orig Job #' : 'e.g. 21 IS-48'}
                    />
                    {commonData.repairType === 'GP' && (
                      <datalist id={`past-job-suggestions-${index}`}>
                        {pastJobs.slice(0, 100).map(pj => (
                          <option key={pj.id || pj.jobNo} value={pj.jobNo}>
                            Job #{pj.jobNo} — {pj.capacityKva} KVA {pj.make} (S/N: {pj.serialNo})
                          </option>
                        ))}
                      </datalist>
                    )}
                  </div>

                  {/* CAPACITY (KVA) WITH ALL QUICK PRESET PILLS */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Capacity (KVA) <span className="text-red-500">*</span>
                    </label>
                    <div className="space-y-1">
                      <input
                        required
                        type="number"
                        value={t.capacityKva}
                        onChange={(e) => handleTransformerChange(index, 'capacityKva', e.target.value)}
                        className="w-full px-3 py-2 text-xs sm:text-sm font-mono font-bold border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        placeholder="e.g. 200"
                      />
                      <div className="flex items-center gap-1 overflow-x-auto py-0.5 scrollbar-none no-scrollbar">
                        {COMMON_KVA_OPTIONS.map(kva => (
                          <button
                            key={kva}
                            type="button"
                            onClick={() => handleTransformerChange(index, 'capacityKva', kva)}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold shrink-0 transition-colors cursor-pointer ${
                              t.capacityKva === kva 
                                ? 'bg-blue-600 text-white shadow-2xs' 
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {kva}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* MAKE */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Make / Manufacturer <span className="text-red-500">*</span>
                    </label>
                    <input
                      required
                      type="text"
                      value={t.make}
                      onChange={(e) => handleTransformerChange(index, 'make', e.target.value.toUpperCase())}
                      className="w-full px-3 py-2 text-xs sm:text-sm font-bold border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white uppercase"
                      placeholder="e.g. NJA / VOLTAMP"
                    />
                  </div>

                  {/* SERIAL NUMBER */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Serial No. <span className="text-red-500">*</span>
                    </label>
                    <input
                      required
                      type="text"
                      value={t.serialNo}
                      onChange={(e) => handleTransformerChange(index, 'serialNo', e.target.value.toUpperCase())}
                      onBlur={() => handleSerialNoBlur(index, t.serialNo)}
                      className="w-full px-3 py-2 text-xs sm:text-sm font-mono font-bold border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white uppercase"
                      placeholder="e.g. 13602"
                    />
                  </div>

                  {/* CORE TYPE */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Core / Job Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={t.coreType}
                      onChange={(e) => handleTransformerChange(index, 'coreType', e.target.value)}
                      className="w-full px-3 py-2 text-xs sm:text-sm font-bold border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white cursor-pointer"
                    >
                      <option value="CRGO">CRGO</option>
                      <option value="Amorphous">Amorphous</option>
                      <option value="Wound Core">Wound Core</option>
                      <option value="LSTC">LSTC</option>
                      <option value="OH">OH (Overhauling)</option>
                    </select>
                  </div>

                </div>

                {/* ROW GP SECTION: AUTO-VERIFIED IF SELECTED/SAVED, OR MANUAL DATE INPUT IF UNSAVED */}
                {commonData.repairType === 'GP' && (() => {
                  const isLinkedFromSaved = Boolean(t.autoFilledFrom || (t.prevJobNo && t.prevDeliveryDate));
                  const rowGpCalc = t.prevDeliveryDate
                    ? calculateGpWarranty(t.prevDeliveryDate, commonData.dateOfIssue, gpValidationMonths)
                    : null;

                  if (isLinkedFromSaved) {
                    // 1. AUTO-VERIFIED PAST JOB (NO NEED TO ASK FOR LAST REPAIRED DATE)
                    return (
                      <div className={`mt-3 pt-2.5 px-3 py-2.5 rounded-lg border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-2xs ${
                        rowGpCalc?.isWithinWarranty
                          ? 'bg-emerald-50/90 border-emerald-300 text-emerald-950'
                          : 'bg-amber-50/90 border-amber-300 text-amber-950'
                      }`}>
                        <div className="flex items-start sm:items-center gap-2 min-w-0">
                          {rowGpCalc?.isWithinWarranty ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5 sm:mt-0" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5 sm:mt-0" />
                          )}
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-bold">
                                {rowGpCalc?.isWithinWarranty
                                  ? `✓ Auto-Verified: Within ${gpValidationMonths}-Month GP Warranty`
                                  : `⚠️ Auto-Verified: Exceeded ${gpValidationMonths}-Month GP Period`}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.2 bg-white/80 font-mono font-bold rounded border border-black/10">
                                Job #{t.prevJobNo || t.jobNo}
                              </span>
                              {t.prevAtNo && (
                                <span className="text-[10px] px-1.5 py-0.2 bg-white/80 font-mono rounded border border-black/10">
                                  AT: {t.prevAtNo}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] opacity-85 mt-0.5">
                              Last Dispatched: <strong className="font-mono">{t.prevDeliveryDate ? formatDDMMYYYY(t.prevDeliveryDate) : 'N/A'}</strong>
                              {rowGpCalc?.isValidDate && (
                                <> &bull; Expiry: <strong className="font-mono">{formatDDMMYYYY(rowGpCalc.expiryDateStr)}</strong> ({rowGpCalc.isWithinWarranty ? rowGpCalc.remainingMonthsText : `${rowGpCalc.elapsedMonthsText} elapsed`})</>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setShowPastPickerRowIndex(index);
                              setPastSearchTerm('');
                            }}
                            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-[10px] font-bold shadow-2xs cursor-pointer transition-colors"
                            title="Choose a different past job"
                          >
                            Change TR
                          </button>
                          <button
                            type="button"
                            onClick={() => unlinkPastJobFromRow(index)}
                            className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-[10px] font-bold cursor-pointer transition-colors"
                            title="Switch to manual date entry for unsaved job"
                          >
                            Enter Manually
                          </button>
                        </div>
                      </div>
                    );
                  }

                  // 2. UNSAVED JOB / MANUAL ENTRY: ASK FOR LAST REPAIRED DATE ONLY
                  return (
                    <div className="mt-3 pt-3 border-t border-amber-200/80 bg-amber-50/70 p-3 rounded-lg space-y-2.5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-amber-950 flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>Manual Entry (Unsaved Past Job): Enter Last Repaired Date to Verify GP Period ({gpValidationMonths} Mos)</span>
                        </span>

                        <button
                          type="button"
                          onClick={() => {
                            setShowPastPickerRowIndex(index);
                            setPastSearchTerm('');
                          }}
                          className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold text-[10px] shadow-2xs flex items-center justify-center gap-1 transition-colors cursor-pointer w-fit"
                          title="Pick from saved ATs in your account"
                        >
                          <History className="w-3 h-3" />
                          <span>Pick from Saved AT / Past TR</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                        {/* LAST DATE OF REPAIRED */}
                        <div>
                          <label className="block text-[10px] font-bold uppercase text-amber-950 mb-0.5">
                            Last Date of Repaired <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="date"
                            value={t.prevDeliveryDate || ''}
                            onChange={(e) => handleTransformerChange(index, 'prevDeliveryDate', e.target.value)}
                            className="w-full px-2.5 py-1.5 border border-amber-300 rounded-lg text-xs font-mono font-bold bg-white text-amber-950 outline-none focus:ring-1 focus:ring-amber-500"
                            required={commonData.repairType === 'GP'}
                          />
                        </div>

                        {/* PREVIOUS AT REF (OPTIONAL/MANUAL) */}
                        <div>
                          <label className="block text-[10px] font-bold uppercase text-amber-950 mb-0.5">
                            Previous AT / Tender Ref (Optional):
                          </label>
                          <input
                            type="text"
                            list="prev-at-suggestions"
                            value={t.prevAtNo || ''}
                            onChange={(e) => handleTransformerChange(index, 'prevAtNo', e.target.value)}
                            placeholder="e.g. Past Tender / AT No"
                            className="w-full px-2.5 py-1.5 border border-amber-300 rounded-lg text-xs font-mono bg-white text-amber-950 outline-none focus:ring-1 focus:ring-amber-500"
                          />
                          <datalist id="prev-at-suggestions">
                            {atMasters.map(at => (
                              <option key={at.id} value={at.atNumber || at.name}>
                                {at.name} {at.id === activeAtMaster?.id ? '(Current AT)' : `(${at.status})`}
                              </option>
                            ))}
                          </datalist>
                        </div>

                        {/* GP DEFECT / REASON */}
                        <div>
                          <label className="block text-[10px] font-bold uppercase text-amber-950 mb-0.5">
                            GP Failure / Defect Reason:
                          </label>
                          <input
                            type="text"
                            value={t.gpReason || ''}
                            onChange={(e) => handleTransformerChange(index, 'gpReason', e.target.value)}
                            placeholder="e.g. Coil Burn, Leakage"
                            className="w-full px-2.5 py-1.5 border border-amber-300 rounded-lg text-xs bg-white text-amber-950 outline-none focus:ring-1 focus:ring-amber-500"
                          />
                        </div>
                      </div>

                      {/* LIVE GP CALCULATION STATUS BADGE / BANNER */}
                      {rowGpCalc && rowGpCalc.isValidDate && (
                        <div className={`px-3 py-2 rounded-lg border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 ${
                          rowGpCalc.isWithinWarranty
                            ? 'bg-emerald-100/80 border-emerald-300 text-emerald-950'
                            : 'bg-amber-100 border-amber-400 text-amber-950'
                        }`}>
                          <div className="flex items-center gap-1.5 font-bold">
                            {rowGpCalc.isWithinWarranty ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0" />
                            )}
                            <span>
                              {rowGpCalc.isWithinWarranty
                                ? `🟢 Within ${gpValidationMonths}-Month GP Warranty (${rowGpCalc.remainingMonthsText})`
                                : `🟠 ${gpValidationMonths}-Month GP Period Exceeded (${rowGpCalc.elapsedMonthsText} elapsed)`}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-700">
                            Last Repaired: <span className="font-bold">{formatDDMMYYYY(rowGpCalc.repairedDateStr)}</span> → Expiry: <span className="font-bold">{formatDDMMYYYY(rowGpCalc.expiryDateStr)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

              </div>
            ))}
          </div>

          {/* BOTTOM CONTROLS & SUBMIT BUTTONS */}
          <div className="p-3.5 sm:p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              type="button"
              onClick={addTransformer}
              className="w-full sm:w-auto px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4 text-blue-600" />
              <span>Add Another Transformer</span>
            </button>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="w-1/2 sm:w-auto px-5 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={loading}
                className="w-1/2 sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 min-h-[42px] cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving Entry...</span>
                  </>
                ) : (
                  <>
                    <PackageCheck className="w-4 h-4" />
                    <span>Save {transformers.length} Inward Job(s)</span>
                  </>
                )}
              </button>
            </div>
          </div>

        </div>

      </form>

      {/* ========================================================================= */}
      {/* PAST TRANSFORMER QUICK-PICKER MODAL FOR GP AUTO-FILL */}
      {/* ========================================================================= */}
      {showPastPickerRowIndex !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-500 text-slate-950 rounded-xl shrink-0">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">
                    Pick Past Transformer for Unit #{showPastPickerRowIndex + 1}
                  </h3>
                  <p className="text-[11px] text-slate-300">
                    Auto-fills Make, S/N, KVA, Core Type, Previous AT, and Delivery Date
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPastPickerRowIndex(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Explanatory Banner */}
            <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs flex items-start gap-2">
              <span className="text-amber-700 font-bold shrink-0">ℹ️ Note:</span>
              <span>
                For <strong>GP Warranty Repairs</strong>, no new Job Number is created. Selecting a past transformer reuses its <strong>same original Job Number</strong> (<span className="font-mono font-bold text-amber-950">from 1st time repair as OGP</span>) to track its entire guarantee period lifecycle.
              </span>
            </div>

            <div className="p-3 sm:p-4 border-b border-slate-100 bg-slate-50 shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={pastSearchTerm}
                  onChange={(e) => setPastSearchTerm(e.target.value)}
                  placeholder="Search by Serial No, Past Job No, Make, KVA (e.g. 200), MR No, or Division..."
                  className="w-full pl-9 pr-4 py-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-amber-500 focus:outline-hidden"
                  autoFocus
                />
              </div>
            </div>

            <div className="overflow-y-auto p-3 sm:p-4 space-y-2.5 flex-1 bg-slate-50/50">
              {pastJobsLoading ? (
                <div className="py-12 text-center text-slate-500 text-xs flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-amber-600" />
                  <span>Searching all saved ATs & historical transformer database...</span>
                </div>
              ) : pastJobs.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs space-y-2">
                  <p className="font-bold text-slate-700">No previous transformer database records found.</p>
                  <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                    No problem! You can directly enter the <strong>Last Repaired Date</strong> manually in Step 2 without needing any previous database.
                  </p>
                </div>
              ) : (
                (() => {
                  const filtered = pastJobs.filter(j => {
                    if (!pastSearchTerm.trim()) return true;
                    const term = pastSearchTerm.toLowerCase();
                    const atName = j.atId ? (atMasters.find(a => a.id === j.atId)?.name || atMasters.find(a => a.id === j.atId)?.atNumber || '').toLowerCase() : '';
                    return (
                      (j.jobNo && j.jobNo.toLowerCase().includes(term)) ||
                      (j.serialNo && j.serialNo.toLowerCase().includes(term)) ||
                      (j.make && j.make.toLowerCase().includes(term)) ||
                      (String(j.capacityKva).includes(term)) ||
                      (j.mrNo && j.mrNo.toLowerCase().includes(term)) ||
                      (j.division && j.division.toLowerCase().includes(term)) ||
                      (j.prevAtNo && j.prevAtNo.toLowerCase().includes(term)) ||
                      atName.includes(term)
                    );
                  });

                  if (filtered.length === 0) {
                    return (
                      <div className="py-12 text-center text-slate-500 text-xs space-y-1.5">
                        <p className="font-bold text-slate-700">No matching past transformers found for "{pastSearchTerm}".</p>
                        <p className="text-[11px] text-slate-500">
                          You can freely enter the technical details and Last Repaired Date manually.
                        </p>
                      </div>
                    );
                  }

                  return filtered.map((pj) => {
                    const delivDateRaw = pj.deliveryDate || pj.challanDate || pj.dateOfIssue || '';
                    const delivStr = pj.deliveryDate || pj.challanDate ? formatDDMMYYYY(pj.deliveryDate || pj.challanDate) : (pj.dateOfIssue ? formatDDMMYYYY(pj.dateOfIssue) : 'Delivered');
                    const atInfo = pj.prevAtNo 
                      ? pj.prevAtNo 
                      : (pj.atId ? (atMasters.find(a => a.id === pj.atId)?.atNumber || atMasters.find(a => a.id === pj.atId)?.name) : '');
                    const pjCalc = delivDateRaw ? calculateGpWarranty(delivDateRaw, commonData.dateOfIssue, gpValidationMonths) : null;

                    return (
                      <div
                        key={pj.id}
                        onClick={() => applyPastJobToRow(showPastPickerRowIndex, pj)}
                        className="p-3.5 bg-white hover:bg-amber-50/60 border border-slate-200 hover:border-amber-400 rounded-xl cursor-pointer transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs group"
                      >
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono font-bold text-xs bg-slate-900 text-white px-2 py-0.5 rounded">
                              Past Job #{pj.jobNo || 'Record'}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 bg-blue-100 text-blue-900 rounded font-bold font-mono">
                              {pj.capacityKva} KVA
                            </span>
                            <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-800 rounded font-bold">
                              {pj.coreType || 'CRGO'}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold">
                              Div: {pj.division || '-'}
                            </span>
                            {atInfo && (
                              <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-900 rounded font-bold font-mono border border-amber-200">
                                AT: {atInfo}
                              </span>
                            )}
                            {pjCalc && pjCalc.isValidDate && (
                              <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                                pjCalc.isWithinWarranty ? 'bg-emerald-100 text-emerald-900 border border-emerald-300' : 'bg-amber-100 text-amber-900 border border-amber-300'
                              }`}>
                                {pjCalc.isWithinWarranty ? `✓ Within ${gpValidationMonths}M Warranty` : `⚠️ Exceeded ${gpValidationMonths}M`}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-600">
                            Make: <strong className="text-slate-900">{pj.make || '-'}</strong> &bull; S/N: <strong className="text-slate-900 font-mono">{pj.serialNo || '-'}</strong> &bull; MR No: <strong className="text-slate-800">{pj.mrNo || '-'}</strong>
                          </div>
                          <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3">
                            <span>Last Delivery / Outward: <strong className="text-slate-700">{delivStr}</strong></span>
                            {pj.prevAtNo && <span>Prev AT: <strong className="text-slate-700">{pj.prevAtNo}</strong></span>}
                          </div>
                        </div>

                        <button
                          type="button"
                          className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 group-hover:bg-amber-600 text-white font-bold text-xs rounded-xl transition-all shadow-xs shrink-0 self-end sm:self-center cursor-pointer flex items-center gap-1.5"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Select & Use Job #{pj.jobNo || 'Record'}</span>
                        </button>
                      </div>
                    );
                  });
                })()
              )}
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setShowPastPickerRowIndex(null)}
                className="px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* RECEIPT / INWARD CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {showReceiptModal && savedJobsForReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-150">
            
            <div className="p-4 bg-emerald-700 text-white flex items-center justify-between shrink-0 print:hidden">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-200" />
                <div>
                  <h3 className="font-bold text-sm">Jobs Successfully Created & Saved!</h3>
                  <p className="text-[11px] text-emerald-100">
                    {savedJobsForReceipt.length} Transformer(s) logged under MR #{commonData.mrNo}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowReceiptModal(false);
                  navigate('/');
                }}
                className="p-1.5 text-emerald-200 hover:text-white rounded-lg hover:bg-emerald-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* PRINTABLE RECEIPT CONTENT */}
            <div className="overflow-y-auto p-4 sm:p-6 flex-1 bg-white text-slate-900" id="printable-mr-receipt">
              <LetterheadHeader 
                agency={activeAgency}
                documentTitle="MATERIAL INWARD / JOB RECEIPT SLIP" 
                subtitle={`DIVISION: ${commonData.division} | MR NO: ${commonData.mrNo} | CATEGORY: ${commonData.repairType}`} 
              />

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs my-4">
                <div>
                  <span className="text-slate-500 block text-[10px] font-bold uppercase">MR Number</span>
                  <span className="font-bold font-mono text-sm text-slate-900">{commonData.mrNo}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] font-bold uppercase">Receive Date</span>
                  <span className="font-bold font-mono text-slate-900">{formatDDMMYYYY(commonData.dateOfIssue)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] font-bold uppercase">Division</span>
                  <span className="font-bold text-slate-900">{commonData.division}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] font-bold uppercase">Category</span>
                  <span className="font-bold text-blue-700">{commonData.repairType === 'GP' ? 'GP (Guarantee Period)' : 'OGP (Out of Guarantee)'}</span>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden mb-6">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3 font-mono">Job No</th>
                      <th className="py-2.5 px-3">Capacity (KVA)</th>
                      <th className="py-2.5 px-3">Make</th>
                      <th className="py-2.5 px-3 font-mono">Serial No</th>
                      <th className="py-2.5 px-3">Job / Core Type</th>
                      {commonData.repairType === 'GP' && <th className="py-2.5 px-3">Prev AT / Ref</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {savedJobsForReceipt.map((job, idx) => (
                      <tr key={job.id || idx} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-bold text-slate-500">{idx + 1}</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-blue-700">{job.jobNo}</td>
                        <td className="py-2.5 px-3 font-bold font-mono">{job.capacityKva} KVA</td>
                        <td className="py-2.5 px-3 font-semibold uppercase">{job.make || '-'}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-800">{job.serialNo || '-'}</td>
                        <td className="py-2.5 px-3 font-bold">{job.coreType || 'CRGO'}</td>
                        {commonData.repairType === 'GP' && (
                          <td className="py-2.5 px-3 text-[11px] text-amber-800 font-mono">
                            {job.prevAtNo || job.prevJobNo || 'GP Warranty'}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-2 gap-8 pt-8 mt-6 border-t border-slate-200 text-xs">
                <div className="text-center">
                  <div className="h-12"></div>
                  <div className="border-t border-slate-300 pt-1 font-bold text-slate-700">
                    DISCOM Representative / Driver Signature
                  </div>
                </div>
                <div className="text-center">
                  <div className="h-12"></div>
                  <div className="border-t border-slate-300 pt-1 font-bold text-slate-700">
                    Authorized Agency Receiver Signature
                  </div>
                </div>
              </div>

            </div>

            {/* MODAL BOTTOM ACTION BUTTONS */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0 print:hidden">
              <button
                type="button"
                onClick={() => {
                  setShowReceiptModal(false);
                  navigate('/');
                }}
                className="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl transition-colors cursor-pointer"
              >
                Go to Dashboard
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintReceipt}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Inward Receipt</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
