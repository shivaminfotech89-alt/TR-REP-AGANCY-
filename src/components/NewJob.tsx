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
  Tag,
  Scale
} from 'lucide-react';
import { useAgency, getCircleLimitsEstimateMaster } from '../lib/AgencyContext';
import { LetterheadHeader } from './LetterheadHeader';
import { formatDDMMYYYY } from '../lib/utils';
import appLogo from '../assets/images/transformer_app_logo_1786648240128.jpg';
import { getCircleLimitForJob, RATING_LEVEL_OPTIONS } from '../lib/estimateData';

interface TransformerEntry {
  jobNo: string;
  capacityKva: string;
  make: string;
  serialNo: string;
  coreType: string;
  starRating?: string;
  ratingLevel?: string;
  autoFilledFrom?: string;
  prevAtNo?: string;
  prevJobNo?: string;
  prevDeliveryDate?: string;
  gpReason?: string;
  /** 'linked' = matched an existing job; 'legacy' = no record found, date typed from
   *  the paper job card. Set only once a lookup has actually run. */
  gpSource?: 'linked' | 'legacy';
  /** Firestore doc id of the matched prior job. null/undefined for legacy. */
  gpPriorJobId?: string | null;
  /** The job number a lookup ran for and found nothing. Drives the legacy panel, so
   *  it appears only after a miss - never as a permanent section on the form. */
  gpLookupMissFor?: string;
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
  // More than one past job matched the value typed - the operator must choose which
  // physical transformer this is. Never auto-applied: job numbers are not uniquely
  // allocated, so "the newest match" is a guess, not an answer.
  /** Row index whose GP job-number suggestion list is open, or null. */
  const [jobNoSuggestFor, setJobNoSuggestFor] = useState<number | null>(null);
  const [ambiguousMatch, setAmbiguousMatch] = useState<{
    index: number;
    field: 'jobNo' | 'serialNo';
    value: string;
    candidates: any[];
  } | null>(null);
  const [pastSearchTerm, setPastSearchTerm] = useState('');

  // Receipt Print Modal State
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [savedJobsForReceipt, setSavedJobsForReceipt] = useState<any[] | null>(null);
  const [modalAlertMessage, setModalAlertMessage] = useState<string | null>(null);
  const [showSaveConfirmModal, setShowSaveConfirmModal] = useState<boolean>(false);

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
      starRating: '3 Star & other',
      ratingLevel: '3 Star & other',
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

  // Initialize initial division
  useEffect(() => {
    if (availableDivisions.length > 0 && (!commonData.division || !availableDivisions.includes(commonData.division))) {
      const firstDiv = availableDivisions[0];
      setCommonData(prev => ({ ...prev, division: firstDiv }));
    }
  }, [availableDivisions, activeAgency, activeAtMaster]);

  // Fill any blank / placeholder job numbers once agency & division context are ready.
  // Only touches rows the user (or GP auto-fill) hasn't already set a real job number on.
  //
  // NEVER runs for GP. A GP repair REUSES the original job number from the previous
  // repair - it does not draw a new one from the counter, and the number may carry a
  // completely different prefix from a previous AT. Auto-numbering GP rows made the
  // field impossible to use: clearing it to type the original number immediately
  // refilled it with the next sequential number.
  useEffect(() => {
    if (!activeAgency || !commonData.division) return;
    if (commonData.repairType === 'GP') return;

    setTransformers(prev => {
      let changed = false;
      const updated = prev.map((t, idx) => {
        if (t.jobNo && !t.jobNo.startsWith('JOB')) return t;
        const { prefix, nextNum } = getNextJobNoInfo(commonData.division, t.coreType, commonData.repairType);
        const newJobNo = `${prefix}-${nextNum + idx}`;
        if (newJobNo === t.jobNo) return t;
        changed = true;
        return { ...t, jobNo: newJobNo };
      });
      return changed ? updated : prev;
    });
  }, [activeAgency, activeAtMaster, commonData.division, commonData.repairType, transformers]);

  // Past jobs for the GP lookup: across all AT masters of the CURRENT AGENCY.
  //
  // Deliberately agency-scoped. Previously this queried on ownerId alone, so a job
  // number duplicated in a different agency could be matched and its make, serial,
  // kVA and prevDeliveryDate applied to this row - assessing a guarantee claim
  // against a transformer belonging to another agency entirely. Job numbers are not
  // unique across agencies and are not uniquely allocated within one either, so this
  // list may still contain more than one candidate for a number; the caller must not
  // assume the first match is the right one.
  useEffect(() => {
    if (auth.currentUser && activeAgency) {
      const loadPastJobs = async () => {
        setPastJobsLoading(true);
        try {
          const q = query(
            collection(db, 'jobs'),
            where('ownerId', '==', auth.currentUser!.uid),
            where('agencyId', '==', activeAgency.id)
          );
          const snap = await getDocs(q);
          const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          list.sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));
          setPastJobs(list);
        } catch (err) {
          console.error('Error loading past jobs for GP lookup:', err);
        } finally {
          setPastJobsLoading(false);
        }
      };
      loadPastJobs();
    }
  }, [auth.currentUser, activeAgency?.id]);

  const handleCommonChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setCommonData(prev => ({ ...prev, [name]: value }));

    // A GP row's job number is the ORIGINAL number from the previous repair. Nothing
    // may regenerate or re-prefix it - not a division change, not a core-type change,
    // not the Auto Job Nos button. It is set ONLY by the operator typing it, by picking
    // a suggestion, or by the disambiguation chooser.
    if (commonData.repairType === 'GP' && (name === 'division' || name === 'repairType')) {
      return;
    }

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
      // Switching OGP -> GP CLEARS any auto-generated number. Only a genuine prior
      // link survives. Previously this fell through to `t.jobNo`, leaving the OGP
      // sequential number sitting in "Original Job No" - so saving would book a GP job
      // against a number matching no prior repair, and the duplicate guard would then
      // record it as legacy with a fabricated original number.
      setTransformers(prev => prev.map(t => ({
        ...t,
        jobNo: t.prevJobNo || t.autoFilledFrom || '',
        gpSource: undefined,
        gpPriorJobId: null,
        gpLookupMissFor: undefined,
      })));
    }
  };

  const applyPastJobToRow = (index: number, pastJob: any) => {
    let matchedAtNo = pastJob.prevAtNo || '';
    if (!matchedAtNo && pastJob.atId) {
      const foundAt = atMasters.find(a => a.id === pastJob.atId);
      if (foundAt) matchedAtNo = foundAt.atNumber || foundAt.name;
    }

    // deliveryDate then challanDate ONLY - both written by the dispatch batch. NOT
    // dateOfIssue, which is when the unit was RECEIVED for the previous repair, not
    // when it went back; measuring a guarantee window from it is wrong. And never
    // updatedAt - that was the GP clock bug (AUDIT.md F6).
    const prevDelDate = pastJob.deliveryDate || pastJob.challanDate || '';
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
        starRating: pastJob.starRating || pastJob.ratingLevel || targetRow.starRating || '3 Star & other',
        ratingLevel: pastJob.starRating || pastJob.ratingLevel || targetRow.ratingLevel || '3 Star & other',
        autoFilledFrom: pastJob.jobNo || pastJob.serialNo,
        prevJobNo: pastJob.jobNo || '',
        prevAtNo: matchedAtNo,
        prevDeliveryDate: prevDelDate,
        gpReason: targetRow.gpReason || pastJob.gpReason || 'GP Warranty',
        gpSource: 'linked',
        gpPriorJobId: pastJob.id ?? null,
        gpLookupMissFor: undefined
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
        prevDeliveryDate: '',
        gpSource: undefined,
        gpPriorJobId: null,
        gpLookupMissFor: undefined
      };
      return updated;
    });
    setAutoFillNotice(`Unlinked unit #${index + 1} from past job reference.`);
    setTimeout(() => setAutoFillNotice(null), 4000);
  };

  const clearTransformerRow = (index: number) => {
    setTransformers(prev => {
      const updated = [...prev];
      updated[index] = {
        jobNo: '',
        capacityKva: '',
        make: '',
        serialNo: '',
        coreType: 'CRGO',
        prevAtNo: '',
        prevJobNo: '',
        prevDeliveryDate: '',
        gpReason: '',
        autoFilledFrom: undefined,
        gpSource: undefined,
        gpPriorJobId: null,
        gpLookupMissFor: undefined
      };
      return updated;
    });
    setAutoFillNotice(`Cleared transformer row #${index + 1}.`);
    setTimeout(() => setAutoFillNotice(null), 3000);
  };

  /** Whole months between two dates, calendar-accurate (not days/30). Frozen at save
   *  as gpVerifiedMonths so reopening the job later cannot change what was true at
   *  intake. */
  const elapsedMonthsBetween = (fromStr: string, toStr: string): number | null => {
    if (!fromStr) return null;
    const from = new Date(fromStr);
    const to = toStr ? new Date(toStr) : new Date();
    if (isNaN(from.getTime()) || isNaN(to.getTime())) return null;
    let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    if (to.getDate() < from.getDate()) months -= 1;
    return months;
  };

  /** CASE B: no record found for this job number - switch the row to legacy entry. */
  const markRowLegacy = (index: number, jobNo: string) => {
    setTransformers(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        gpSource: 'legacy',
        gpPriorJobId: null,
        gpLookupMissFor: jobNo,
      };
      return updated;
    });
  };

  /** Partial, case-insensitive, anywhere-in-string matches for the type-ahead list.
   *  pastJobs is already agency-scoped and sorted newest first.
   *
   *  Only DELIVERED, REPAIRED transformers are GP candidates:
   *  - `status === 'Dispatched'` — a unit still in repair, testing or awaiting dispatch
   *    has not been delivered, so it cannot yet return under guarantee.
   *  - not scrap — a scrapped transformer was returned to the division rather than
   *    repaired, so there is no repair to guarantee. Note the scrap test is needed on
   *    top of the status test, not instead of it: scrap units ARE dispatched back, so
   *    they carry status 'Dispatched' and would otherwise still be listed. They are
   *    identifiable by `condition === 'Scrap'`. */
  const suggestGpJobs = (queryVal: string, limit = 8) => {
    const q = queryVal.trim().toLowerCase();
    if (!q) return [];
    return pastJobs
      .filter(j => j.status === 'Dispatched')
      .filter(j => !(j.status === 'Scrap' || j.condition === 'Scrap'))
      .filter(j => (j.jobNo || '').toLowerCase().includes(q))
      .slice(0, limit);
  };

  /** Every past job matching this value, newest first. Callers must handle >1. */
  const findGpCandidates = (lookupField: 'serialNo' | 'jobNo', queryVal: string) => {
    const trimmed = queryVal.trim().toLowerCase();
    if (!trimmed) return [];
    return pastJobs.filter(j => {
      const val = lookupField === 'serialNo' ? j.serialNo : j.jobNo;
      return val && String(val).toLowerCase() === trimmed;
    });
  };

  const handleGpAutoLookup = async (index: number, lookupField: 'serialNo' | 'jobNo', queryVal: string) => {
    if (commonData.repairType !== 'GP' || !queryVal.trim() || !auth.currentUser) return;
    
    // ALL matches, not the first. A job number can legitimately repeat (the same
    // transformer returning as GP) and can also collide (two different units sharing
    // a number), and only the operator can tell those apart.
    const matches = findGpCandidates(lookupField, queryVal);

    if (matches.length === 1) {
      applyPastJobToRow(index, matches[0]);
      return;
    }
    if (matches.length > 1) {
      setAmbiguousMatch({ index, field: lookupField, value: queryVal.trim(), candidates: matches });
      return;
    }

    try {
      const q = query(
        collection(db, 'jobs'),
        where('ownerId', '==', auth.currentUser.uid),
        where('agencyId', '==', activeAgency?.id || ''),
        where(lookupField, '==', queryVal.trim().toUpperCase())
      );

      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const jobsList = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        if (jobsList.length === 1) {
          applyPastJobToRow(index, jobsList[0]);
        } else {
          // Same rule as above - never silently take jobsList[0].
          setAmbiguousMatch({ index, field: lookupField, value: queryVal.trim(), candidates: jobsList });
        }
      } else if (lookupField === 'jobNo') {
        // CASE B - nothing in the database for this job number. The transformer was
        // repaired under an earlier AT, before this system. Mark the row legacy so the
        // manual date field appears - and ONLY now, never before a lookup has run.
        markRowLegacy(index, queryVal.trim());
      }
    } catch (err) {
      console.error(`Error fetching GP job details by ${lookupField}:`, err);
    }
  };

  const handleJobNoBlur = async (index: number, jobNo: string) => {
    if (commonData.repairType !== 'GP' || !jobNo.trim()) return;
    const row = transformers[index];
    // Look up unless this row is already linked to THIS number. Previously any linked
    // row was skipped outright, so editing the Job No never refreshed the auto-fill.
    const linkedToThis = (row?.prevJobNo || '').trim().toUpperCase() === jobNo.trim().toUpperCase()
      && Boolean(row?.prevDeliveryDate);
    if (linkedToThis) return;
    await handleGpAutoLookup(index, 'jobNo', jobNo);
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

    // Changing the Job No on a GP row that is linked to a DIFFERENT number drops the
    // linkage, so the row cannot keep one transformer's make/serial/kVA/delivery date
    // under another's job number. Clearing it also re-arms the lookup, which
    // handleJobNoBlur otherwise skips for an already-linked row.
    if (field === 'jobNo' && commonData.repairType === 'GP') {
      const row = newTransformers[index];
      const linkedTo = (row.prevJobNo || row.autoFilledFrom || '').trim().toUpperCase();
      if (linkedTo && linkedTo !== value.trim().toUpperCase()) {
        newTransformers[index] = {
          ...row,
          autoFilledFrom: undefined,
          prevJobNo: '',
          prevAtNo: '',
          prevDeliveryDate: '',
          gpSource: undefined,
          gpPriorJobId: null,
          gpLookupMissFor: undefined,
        };
      } else if (row.gpSource === 'legacy' && (row.gpLookupMissFor || '').trim().toUpperCase() !== value.trim().toUpperCase()) {
        // A miss recorded against a different number must not keep showing.
        newTransformers[index] = { ...row, gpSource: undefined, gpLookupMissFor: undefined };
      }
    }
    
    // Auto-update jobNo if coreType changes.
    // NEVER for GP: core type is part of counterKey, so this recomputed the number and
    // wiped an original job number the operator had typed. A GP job reuses its number
    // from the previous repair and never draws a new one.
    if (field === 'coreType' && activeAgency && commonData.repairType !== 'GP') {
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
    const lastStar = transformers.length > 0 ? (transformers[transformers.length - 1].starRating || '3 Star & other') : '3 Star & other';
    
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
        starRating: lastStar,
        ratingLevel: lastStar,
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
    if (commonData.repairType === 'GP') {
      const err = 'Job numbers cannot be auto-generated for GP repairs. A GP job reuses the original number from its previous repair - type it, or pick the past job from the suggestions.';
      setErrorMsg(err);
      setModalAlertMessage(err);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) {
      setModalAlertMessage("You must be logged in to save a job.");
      return;
    }
    if (!activeAgency) {
      setModalAlertMessage("Please select or create an active agency in Agency Settings before saving jobs.");
      return;
    }
    if (commonData.repairType === 'OGP') {
      for (const t of transformers) {
        const info = getNextJobNoInfo(commonData.division, t.coreType, 'OGP');
        if (!t.jobNo || !t.jobNo.startsWith(info.prefix + '-')) {
          const err = `Invalid Job Number prefix for OGP job "${t.jobNo || 'Empty'}". Expected prefix starting with "${info.prefix}-". Please enter a valid job number or use auto-generate.`;
          setErrorMsg(err);
          setModalAlertMessage(err);
          return;
        }
      }
    }

    if (commonData.repairType === 'GP') {
      for (let i = 0; i < transformers.length; i++) {
        const t = transformers[i];
        if (!t.jobNo || !t.jobNo.trim()) {
          const err = `Please enter the Original Job Number for Transformer #${i + 1}.`;
          setErrorMsg(err);
          setModalAlertMessage(err);
          return;
        }
        if (!t.prevDeliveryDate || !t.prevDeliveryDate.trim()) {
          // Safety net: the manual date field only appears once a lookup has run and
          // missed. If the operator typed a Job No and saved without ever blurring the
          // field, no lookup ran, so there was no panel to enter a date into and no
          // visible reason why. Run the lookup now and open the right path.
          if (!t.gpSource) {
            const candidates = findGpCandidates('jobNo', t.jobNo);
            if (candidates.length === 1) {
              applyPastJobToRow(i, candidates[0]);
              const err = `Job #${t.jobNo} matched an earlier record - its details have been filled in for Transformer #${i + 1}. Please review and save again.`;
              setErrorMsg(err);
              setModalAlertMessage(err);
              return;
            }
            if (candidates.length > 1) {
              setAmbiguousMatch({ index: i, field: 'jobNo', value: t.jobNo.trim(), candidates });
              const err = `More than one earlier job matches #${t.jobNo}. Choose which transformer Transformer #${i + 1} is, then save again.`;
              setErrorMsg(err);
              setModalAlertMessage(err);
              return;
            }
            markRowLegacy(i, t.jobNo.trim());
          }
          const err = `No earlier job found for #${t.jobNo} (Transformer #${i + 1}). If this transformer was repaired under an earlier AT, enter the delivery date written on the job card in the "Last Repaired / Delivered Date" field now shown on that row.`;
          setErrorMsg(err);
          setModalAlertMessage(err);
          return;
        }
        const gpCalc = calculateGpWarranty(t.prevDeliveryDate, commonData.dateOfIssue, gpValidationMonths);
        if (!gpCalc || !gpCalc.isValidDate) {
          const err = `Invalid Last Date of Repaired for GP Transformer #${i + 1} (Job #${t.jobNo}). Please enter a valid date.`;
          setErrorMsg(err);
          setModalAlertMessage(err);
          return;
        }
        if (!gpCalc.isWithinWarranty) {
          const err = `Cannot Save GP Job! Transformer #${i + 1} (Job #${t.jobNo}) was last repaired on ${formatDDMMYYYY(gpCalc.repairedDateStr)} and expired on ${formatDDMMYYYY(gpCalc.expiryDateStr)} (${gpCalc.elapsedMonthsText} elapsed). It exceeds the ${gpValidationMonths}-month Guarantee Period and cannot be booked as a GP repair.`;
          setErrorMsg(err);
          setModalAlertMessage(err);
          return;
        }
      }
    }
    setShowSaveConfirmModal(true);
  };

  const confirmSaveJob = async () => {
    setShowSaveConfirmModal(false);
    setLoading(true);
    try {
      const now = Date.now();

      // Check OGP prefix validation
      if (commonData.repairType === 'OGP') {
        for (const t of transformers) {
          const info = getNextJobNoInfo(commonData.division, t.coreType, 'OGP');
          if (!t.jobNo || !t.jobNo.startsWith(info.prefix + '-')) {
            const err = `Invalid Job Number prefix for OGP job "${t.jobNo || 'Empty'}". Expected prefix starting with "${info.prefix}-". Please enter a valid job number or use auto-generate.`;
            setErrorMsg(err);
            setModalAlertMessage(err);
            setLoading(false);
            return;
          }
        }
      }

      // Check GP validation
      if (commonData.repairType === 'GP') {
        for (let i = 0; i < transformers.length; i++) {
          const t = transformers[i];
          if (!t.jobNo || !t.jobNo.trim()) {
            const err = `Please enter the Original Job Number for Transformer #${i + 1}.`;
            setErrorMsg(err);
            setModalAlertMessage(err);
            setLoading(false);
            return;
          }
          if (!t.prevDeliveryDate || !t.prevDeliveryDate.trim()) {
            const err = `Last Date of Repaired is required for GP Transformer #${i + 1} (Job #${t.jobNo}). Please enter the Last Repaired Date to verify the ${gpValidationMonths}-Month Guarantee Period before saving.`;
            setErrorMsg(err);
            setModalAlertMessage(err);
            setLoading(false);
            return;
          }
          const gpCalc = calculateGpWarranty(t.prevDeliveryDate, commonData.dateOfIssue, gpValidationMonths);
          if (!gpCalc || !gpCalc.isValidDate) {
            const err = `Invalid Last Date of Repaired for GP Transformer #${i + 1} (Job #${t.jobNo}). Please enter a valid date.`;
            setErrorMsg(err);
            setModalAlertMessage(err);
            setLoading(false);
            return;
          }
          if (!gpCalc.isWithinWarranty) {
            const err = `Cannot Save GP Job! Transformer #${i + 1} (Job #${t.jobNo}) was last repaired on ${formatDDMMYYYY(gpCalc.repairedDateStr)} and expired on ${formatDDMMYYYY(gpCalc.expiryDateStr)} (${gpCalc.elapsedMonthsText} elapsed). It exceeds the ${gpValidationMonths}-month Guarantee Period and cannot be booked as a GP repair.`;
            setErrorMsg(err);
            setModalAlertMessage(err);
            setLoading(false);
            return;
          }
        }
      }

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

      // ---------------------------------------------------------------------
      // DUPLICATE JOB NUMBER GUARD
      // ---------------------------------------------------------------------
      // A job number identifies one physical transformer. It may legitimately repeat
      // in exactly one case: the SAME unit returning under a new MR as a GP repair
      // after failing within the guarantee period. The test is the TRANSFORMER, not
      // the repair type - serialNo, make and capacityKva must all match.
      //
      // Checked across the whole agency and every AT master under it, because job
      // numbers are not uniquely allocated: counters live per AT master while
      // prefixes are shared per division, so a new AT master reissues numbers that
      // already exist (AUDIT.md O2, path 4). Without this, a duplicate silently makes
      // every later reference to that number ambiguous - including the GP lookup,
      // which would then price a guarantee claim against the wrong unit's history.
      const normKey = (v: any) => String(v ?? '').trim().toUpperCase();
      const isSameTransformer = (a: any, b: any) =>
        normKey(a.serialNo) === normKey(b.serialNo) &&
        normKey(a.make) === normKey(b.make) &&
        Number(a.capacityKva) === Number(b.capacityKva);

      const agencyJobsSnap = await getDocs(query(
        collection(db, 'jobs'),
        where('ownerId', '==', auth.currentUser.uid),
        where('agencyId', '==', activeAgency.id)
      ));
      const existingByJobNo: Record<string, any[]> = {};
      agencyJobsSnap.docs.forEach(d => {
        const data = d.data() as any;
        const key = normKey(data.jobNo);
        if (key) (existingByJobNo[key] ||= []).push(data);
      });

      const describe = (j: any) =>
        `MR ${j.mrNo || '-'} - Serial ${j.serialNo || '-'}, ${j.capacityKva || '-'} KVA, Make ${j.make || '-'}`;

      const seenInBatch: Record<string, number> = {};
      for (let i = 0; i < transformers.length; i++) {
        const t = transformers[i];
        const key = normKey(t.jobNo);
        if (!key) continue;

        // Same number twice inside this one intake.
        if (seenInBatch[key] !== undefined) {
          const err = `Duplicate Job Number "${t.jobNo.trim()}" appears twice in this intake (Transformer #${seenInBatch[key] + 1} and #${i + 1}). A job number identifies one physical transformer.`;
          setErrorMsg(err);
          setModalAlertMessage(err);
          setLoading(false);
          return;
        }
        seenInBatch[key] = i;

        const clashes = existingByJobNo[key] || [];
        if (clashes.length === 0) continue;

        const isGp = commonData.repairType === 'GP';
        const sameUnit = clashes.find(c => isSameTransformer(c, t));
        if (isGp && sameUnit) continue;   // same transformer returning under guarantee

        const others = clashes.map(describe).join('\n  ');
        const err = isGp
          ? `Job Number "${t.jobNo.trim()}" already exists in this agency, but for a DIFFERENT transformer.\n\n` +
            `Existing record${clashes.length > 1 ? 's' : ''}:\n  ${others}\n\n` +
            `This intake - Serial ${t.serialNo || '-'}, ${t.capacityKva || '-'} KVA, Make ${t.make || '-'}.\n\n` +
            `A GP repair may only reuse a job number when it is the same physical transformer - serial number, make and capacity must all match.`
          : `Job Number "${t.jobNo.trim()}" is already used in this agency and cannot be reused for a new OGP intake.\n\n` +
            `Existing record${clashes.length > 1 ? 's' : ''}:\n  ${others}\n\n` +
            `This intake - Serial ${t.serialNo || '-'}, ${t.capacityKva || '-'} KVA, Make ${t.make || '-'}.\n\n` +
            `A job number identifies one physical transformer. Use the next free number, or book this as a GP repair if it is the same unit returning under guarantee.`;
        setErrorMsg(err);
        setModalAlertMessage(err);
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
              starRating: t.starRating || t.ratingLevel || '3 Star & other',
              ratingLevel: t.starRating || t.ratingLevel || '3 Star & other',
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

              // GP provenance. Kept distinguishable because it matters commercially:
              // 'legacy' marks a job accepted on an operator's reading of a paper job
              // card rather than on system data. If a guarantee claim is ever disputed,
              // that distinction is the first thing anyone asks for.
              gpSource: commonData.repairType === 'GP' ? (t.gpSource || 'legacy') : null,
              gpPriorJobId: commonData.repairType === 'GP' ? (t.gpPriorJobId ?? null) : null,
              // Epoch ms - fetched from the prior job in Case A, typed in Case B.
              gpDeliveredDate: commonData.repairType === 'GP' && t.prevDeliveryDate
                ? (isNaN(new Date(t.prevDeliveryDate).getTime()) ? null : new Date(t.prevDeliveryDate).getTime())
                : null,
              // FROZEN at intake. Deliberately stored rather than recomputed, so
              // reopening the job later cannot change what was true when it was booked.
              gpVerifiedMonths: commonData.repairType === 'GP'
                ? elapsedMonthsBetween(t.prevDeliveryDate || '', commonData.dateOfIssue)
                : null,

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
            {/* Hidden for GP - a GP job reuses its original number and never draws a
                new one. handleAutoFillEmptyJobNos also refuses, in case it is reached
                another way. */}
            {commonData.repairType !== 'GP' && (
              <button
                type="button"
                onClick={handleAutoFillEmptyJobNos}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold transition-all cursor-pointer"
                title="Auto-calculate next available job numbers"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Auto Job Nos</span>
              </button>
            )}
            
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
                    <div className="relative">
                      <input
                        required
                        type="text"
                        autoComplete="off"
                        value={t.jobNo}
                        onChange={(e) => {
                          const val = e.target.value;
                          handleTransformerChange(index, 'jobNo', val);
                          // GP: NEVER auto-apply while typing. Do not reinstate this as
                          // a "convenience" - it was removed deliberately.
                          //
                          // The old onChange auto-applied on an exact single match and
                          // popped the disambiguation modal on multiple, both mid-
                          // keystroke. Two problems. First it fights the operator: a
                          // partial number can exactly equal a shorter real job number
                          // on the way to a longer one, so passing through "MSBT-1" en
                          // route to "MSBT-12" silently overwrote make, serial, kVA and
                          // prevDeliveryDate with the wrong transformer's - and
                          // prevDeliveryDate is what the guarantee window is measured
                          // from. Second, a modal opening on a keystroke is an
                          // interruption the operator did not ask for.
                          //
                          // Selection is explicit: pick from the suggestion list, or get
                          // the manual date panel when nothing matches. The blur lookup
                          // and the save-time safety net cover typing a full number and
                          // moving on without clicking.
                          //
                          // Any prefix is accepted - a unit repaired under an earlier AT
                          // may carry a completely different one.
                          if (commonData.repairType === 'GP') {
                            setJobNoSuggestFor(val.trim() ? index : null);
                          }
                        }}
                        onFocus={() => {
                          if (commonData.repairType === 'GP' && t.jobNo.trim()) setJobNoSuggestFor(index);
                        }}
                        onBlur={() => {
                          // Delay so a click on a suggestion registers before the list closes.
                          setTimeout(() => setJobNoSuggestFor(cur => (cur === index ? null : cur)), 150);
                          handleJobNoBlur(index, t.jobNo);
                        }}
                        className={`w-full px-3 py-2 text-xs sm:text-sm font-mono font-bold border rounded-lg focus:ring-1 bg-white ${
                          commonData.repairType === 'GP'
                            ? 'border-amber-300 focus:ring-amber-500 focus:border-amber-500 text-amber-950'
                            : 'border-slate-200 focus:ring-blue-500 focus:border-blue-500 text-slate-900'
                        }`}
                        placeholder={commonData.repairType === 'GP' ? 'Type original Job No (any prefix)' : 'e.g. 21 IS-48'}
                      />

                      {/* GP SUGGESTION DROPDOWN - partial, case-insensitive, anywhere in
                          the string; agency-scoped pastJobs, most recent first. */}
                      {commonData.repairType === 'GP' && jobNoSuggestFor === index && t.jobNo.trim() && (() => {
                        const matches = suggestGpJobs(t.jobNo);
                        if (matches.length === 0) {
                          return (
                            <div className="absolute z-30 mt-1 w-full bg-white border border-amber-300 rounded-lg shadow-lg p-2.5 text-[11px] text-amber-900">
                              No matching job — enter the delivery date below to verify the guarantee period.
                            </div>
                          );
                        }
                        return (
                          <div className="absolute z-30 mt-1 w-full bg-white border border-slate-300 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                            {matches.map(pj => {
                              const d = pj.deliveryDate || pj.challanDate || '';
                              return (
                                <button
                                  key={pj.id || `${pj.jobNo}-${pj.serialNo}`}
                                  type="button"
                                  onMouseDown={(ev) => ev.preventDefault()}
                                  onClick={() => {
                                    applyPastJobToRow(index, pj);
                                    setJobNoSuggestFor(null);
                                  }}
                                  className="w-full text-left px-2.5 py-1.5 hover:bg-amber-50 border-b border-slate-100 last:border-b-0"
                                >
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span className="font-mono font-bold text-slate-900 text-xs">{pj.jobNo}</span>
                                    <span className="text-[10px] font-bold text-slate-500">MR {pj.mrNo || '-'}</span>
                                  </div>
                                  <div className="text-[10px] text-slate-600 flex flex-wrap gap-x-2">
                                    <span>{pj.make || '-'}</span>
                                    <span className="font-mono">S/N {pj.serialNo || '-'}</span>
                                    <span className="font-mono">{pj.capacityKva} KVA</span>
                                    <span className="font-mono">Del {d ? formatDDMMYYYY(d) : '-'}</span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
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
                  const isLinkedFromSaved = t.gpSource === 'linked' || Boolean(t.autoFilledFrom || (t.prevJobNo && t.prevDeliveryDate));
                  // CASE B panel appears ONLY once we know there is nothing to match:
                  // either a lookup ran and missed (gpSource 'legacy'), or the typed
                  // number matches no past job. Derived, not stored, so it disappears
                  // again if the operator keeps typing toward a number that does match.
                  // It is never a permanent section on the form.
                  const noSuggestions = Boolean(t.jobNo.trim()) && suggestGpJobs(t.jobNo, 1).length === 0;
                  const isLegacyEntry = !isLinkedFromSaved && (t.gpSource === 'legacy' || noSuggestions);
                  const monthsElapsed = elapsedMonthsBetween(t.prevDeliveryDate || '', commonData.dateOfIssue);
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
                                  ? `Within guarantee period. Delivered ${formatDDMMYYYY(t.prevDeliveryDate || '')}, ${monthsElapsed ?? 0} months ago. Guarantee period is ${gpValidationMonths} months.`
                                  : `Delivered ${formatDDMMYYYY(t.prevDeliveryDate || '')}, ${monthsElapsed ?? 0} months ago. Guarantee period is ${gpValidationMonths} months, so this must be booked as OGP, not GP.`}
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
                            onClick={() => unlinkPastJobFromRow(index)}
                            className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded-lg text-[10px] font-bold shadow-2xs cursor-pointer transition-colors"
                            title="Deselect or clear this job selection"
                          >
                            Deselect Job
                          </button>
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

                  // 2. CASE B - legacy job, no record found. Manual date entry.
                  if (!isLegacyEntry) return null;
                  return (
                    <div className="mt-3 pt-3 border-t border-amber-200/80 bg-amber-50/70 p-3 rounded-lg space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-amber-950 flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>No earlier job found for {t.gpLookupMissFor || t.jobNo} — enter the delivery date from the job card</span>
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => clearTransformerRow(index)}
                            className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-[10px] font-bold cursor-pointer transition-colors"
                            title="Clear job entry"
                          >
                            Clear Entry
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                        {/* LAST DATE OF REPAIRED */}
                        <div>
                          <label className="block text-[10px] font-bold uppercase text-amber-950 mb-0.5">
                            Last Repaired / Delivered Date <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="date"
                            value={t.prevDeliveryDate || ''}
                            onChange={(e) => handleTransformerChange(index, 'prevDeliveryDate', e.target.value)}
                            className="w-full px-2.5 py-1.5 border border-amber-300 rounded-lg text-xs font-mono font-bold bg-white text-amber-950 outline-none focus:ring-1 focus:ring-amber-500"
                            required={commonData.repairType === 'GP'}
                          />
                        </div>
                      </div>

                      {/* LIVE GP CALCULATION STATUS BADGE / BANNER */}
                      {!t.prevDeliveryDate ? (
                        <div className="px-3 py-2 bg-amber-100/90 border border-amber-300 rounded-lg text-xs text-amber-950 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                          <span>
                            No earlier job found for <strong className="font-mono">{t.gpLookupMissFor || t.jobNo}</strong>. If this transformer was repaired under an earlier AT, enter the delivery date written on the job card. Make, serial and kVA must be entered manually - there is no record to copy.
                          </span>
                        </div>
                      ) : rowGpCalc && rowGpCalc.isValidDate ? (
                        <div className={`px-3 py-2 rounded-lg border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 ${
                          rowGpCalc.isWithinWarranty
                            ? 'bg-emerald-100/90 border-emerald-300 text-emerald-950 font-medium'
                            : 'bg-red-50 border-red-300 text-red-950'
                        }`}>
                          <div className="flex items-center gap-1.5 font-bold">
                            {rowGpCalc.isWithinWarranty ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                            ) : (
                              <X className="w-4 h-4 text-red-600 shrink-0" />
                            )}
                            <span>
                              {rowGpCalc.isWithinWarranty
                                ? `Within guarantee period. Delivered ${formatDDMMYYYY(t.prevDeliveryDate || '')}, ${monthsElapsed ?? 0} months ago. Guarantee period is ${gpValidationMonths} months.`
                                : `Delivered ${formatDDMMYYYY(t.prevDeliveryDate || '')}, ${monthsElapsed ?? 0} months ago. Guarantee period is ${gpValidationMonths} months, so this must be booked as OGP, not GP.`}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono opacity-90">
                            Last Repaired: <span className="font-bold">{formatDDMMYYYY(rowGpCalc.repairedDateStr)}</span> → Expired: <span className="font-bold">{formatDDMMYYYY(rowGpCalc.expiryDateStr)}</span>
                          </div>
                        </div>
                      ) : null}
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
      {/* AMBIGUOUS GP MATCH - OPERATOR MUST CHOOSE THE TRANSFORMER */}
      {/* ========================================================================= */}
      {ambiguousMatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-4 bg-amber-600 text-white flex items-center justify-between shrink-0">
              <div className="min-w-0">
                <h3 className="font-bold text-sm sm:text-base flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span className="truncate">
                    {ambiguousMatch.candidates.length} transformers share {ambiguousMatch.field === 'jobNo' ? 'Job No' : 'Serial No'} “{ambiguousMatch.value}”
                  </span>
                </h3>
                <p className="text-[11px] text-amber-100 mt-0.5">
                  Nothing has been filled in. Choose the transformer this GP repair is for - the guarantee period is calculated from its delivery date.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAmbiguousMatch(null)}
                className="text-amber-100 hover:text-white p-1 rounded shrink-0"
                title="Cancel - fill this row manually"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto p-3 sm:p-4 space-y-2">
              {ambiguousMatch.candidates.map((pj: any) => {
                const delDate = pj.deliveryDate || pj.challanDate || pj.dateOfIssue || '';
                return (
                  <button
                    key={pj.id || `${pj.mrNo}-${pj.serialNo}`}
                    type="button"
                    onClick={() => {
                      applyPastJobToRow(ambiguousMatch.index, pj);
                      setAmbiguousMatch(null);
                    }}
                    className="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-amber-500 hover:bg-amber-50/60 transition-colors"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono font-bold text-slate-900 text-sm">{pj.jobNo}</span>
                      <span className="text-[11px] font-bold text-slate-500 uppercase">MR {pj.mrNo || '-'}</span>
                    </div>
                    <div className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[11px]">
                      <div><span className="text-slate-500">Make: </span><span className="font-semibold text-slate-800">{pj.make || '-'}</span></div>
                      <div><span className="text-slate-500">Serial: </span><span className="font-mono font-semibold text-slate-800">{pj.serialNo || '-'}</span></div>
                      <div><span className="text-slate-500">Capacity: </span><span className="font-mono font-semibold text-slate-800">{pj.capacityKva} KVA</span></div>
                      <div><span className="text-slate-500">Delivered: </span><span className="font-mono font-semibold text-slate-800">{delDate ? formatDDMMYYYY(delDate) : '-'}</span></div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="p-3 border-t border-slate-200 bg-slate-50 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setAmbiguousMatch(null)}
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg border border-slate-300"
              >
                None of these - fill manually
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Save Confirmation Modal */}
      {showSaveConfirmModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-sm w-full p-6 text-center animate-in fade-in zoom-in-95 duration-200">
            <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mx-auto mb-4">
              <FileText className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">Confirm Job Save</h3>
            <p className="text-sm text-slate-600 mb-6">Are you sure you want to save this new job entry?</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowSaveConfirmModal(false)}
                className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSaveJob}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors text-sm shadow-sm"
              >
                Yes, Save Job
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Alert Message */}
      {modalAlertMessage && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-amber-200 max-w-sm w-full p-6 text-center animate-in fade-in zoom-in-95 duration-200">
            <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto mb-4">
              <X className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">Notice</h3>
            <p className="text-sm text-slate-600 mb-6">{modalAlertMessage}</p>
            <button
              type="button"
              onClick={() => setModalAlertMessage(null)}
              className="w-full px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl transition-colors text-sm shadow-sm"
            >
              OK
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
