import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useParams, useNavigate } from 'react-router-dom';
import { useAgency, getAtPercentageForCore, atForJob, getEstimateMasterForCore, getBillDivisionRecipient } from '../lib/AgencyContext';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { resolveScrapCharge, getScrapItemCodeForCore, isGpJob, getJobFullEstimate } from '../lib/estimateCalc';
import { classifyCoreType } from './SingleJobEstimateReport';
import { formatDDMMYYYY, byDateDesc, byNumericDesc, getMrDateIso, getAgencyStateCode } from '../lib/utils';
import SetupGapDialog, { SetupGap } from './SetupGapDialog';
import { validateEstimateMaster } from '../lib/estimateMasterHealth';
import { mrStageSummary } from '../lib/inspectionStage';
import { StageCell } from '../lib/jobDisplay';
import { missingForTaxInvoice } from '../lib/jobDisplay';
import { GP_TEXT_CLASS, GpChip, GP_FILTER_OPTIONS, matchesGpFilter, GpFilter } from '../lib/jobDisplay';
import { collection, query, where, getDocs, doc, writeBatch } from 'firebase/firestore';
import { 
  Loader2, Printer, Search, FileText, ArrowLeft, CheckCircle2, ShieldCheck, FileSpreadsheet, 
  Droplets, AlertTriangle, AlertCircle, X, Calendar, Save, Edit3, Check, Send,
  IndianRupee, Clock, CheckSquare, Eye, CreditCard, Banknote, Filter, ChevronDown, ChevronRight
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { LetterheadHeader, PrintableA4Page } from './LetterheadHeader';
import { downloadHtmlAsWord } from '../lib/wordExport';
import { triggerUniversalPrint } from '../lib/printUtils';

// Helper to convert number to Indian Rupees in words
export function numberToIndianWords(num: number): string {
  if (isNaN(num) || num === 0) return 'Zero Rupees Only';

  const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const parts = num.toFixed(2).split('.');
  const rupees = parseInt(parts[0], 10);
  const paisa = parseInt(parts[1], 10);

  function inWords(n: number): string {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + a[n % 10] : ' ');
    if (n < 1000) return a[Math.floor(n / 100)] + 'Hundred ' + (n % 100 !== 0 ? 'and ' + inWords(n % 100) : '');
    if (n < 100000) return inWords(Math.floor(n / 1000)) + 'Thousand ' + (n % 1000 !== 0 ? inWords(n % 1000) : '');
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + 'Lakh ' + (n % 100000 !== 0 ? inWords(n % 100000) : '');
    return inWords(Math.floor(n / 10000000)) + 'Crore ' + (n % 10000000 !== 0 ? inWords(n % 10000000) : '');
  }

  let str = 'Rupees ' + inWords(rupees);
  if (paisa > 0) {
    str += 'and ' + inWords(paisa) + 'Paisa ';
  }
  return str.trim() + ' Only';
}

export default function BillingSystem() {
  const { activeAgency, activeAtMaster, atMasters, updateAgency } = useAgency();
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useParams<{ mrNo?: string }>();
  const navigate = useNavigate();

  const [jobs, setJobs] = useState<any[]>([]);
  const [inspections, setInspections] = useState<any[]>([]);
  const [oilTransactions, setOilTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Tab State: 'generator' | 'sent' | 'payments'
  const [activeTab, setActiveTab] = useState<'generator' | 'sent' | 'payments'>('generator');

  // Filters
  const [selectedMrNo, setSelectedMrNo] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDivision, setSelectedDivision] = useState<string>('All');
  const [billTypeFilter, setBillTypeFilter] = useState<'repairable' | 'scrap'>('repairable');

  // Saving Bill State
  const [savingBillDates, setSavingBillDates] = useState(false);
  const [savedSuccessMsg, setSavedSuccessMsg] = useState('');

  // Send Bill Modal State
  const [showSendBillModal, setShowSendBillModal] = useState(false);
  const [sendTargetMr, setSendTargetMr] = useState<string>('');
  const [sendBillNo, setSendBillNo] = useState('');
  const [sendBillRefNo, setSendBillRefNo] = useState('');
  const [sendBillDate, setSendBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [sendBillRemarks, setSendBillRemarks] = useState('');
  const [submittingSendBill, setSubmittingSendBill] = useState(false);

  // Mark Bill Paid Modal State
  const [showPaidModal, setShowPaidModal] = useState(false);
  const [paidTargetMr, setPaidTargetMr] = useState<string>('');
  const [paymentMode, setPaymentMode] = useState('NEFT / RTGS');
  const [paymentRefNo, setPaymentRefNo] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paidAmount, setPaidAmount] = useState<number | string>('');
  const [paymentDeductions, setPaymentDeductions] = useState<number | string>('0');
  const [paymentBank, setPaymentBank] = useState('');
  const [paymentRemarks, setPaymentRemarks] = useState('');
  const [submittingPaid, setSubmittingPaid] = useState(false);

  // Sent Bills Filter & Search
  const [sentSearchQuery, setSentSearchQuery] = useState('');
  const [sentFilterDivision, setSentFilterDivision] = useState<string>('All');

  // Received Payments Filter & Search
  const [paidSearchQuery, setPaidSearchQuery] = useState('');
  const [paidFilterDivision, setPaidFilterDivision] = useState<string>('All');
  const [paidFilterMode, setPaidFilterMode] = useState<string>('All');

  // Active Document Tab for preview
  const [activeDocTab, setActiveDocTab] = useState<'all' | 'forwarding' | 'certificate' | 'invoice' | 'oil'>('all');

  // Editable Bill Meta Info
  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [apprNo, setApprNo] = useState('');
  const [apprDate, setApprDate] = useState('');
  const [divisionGstin, setDivisionGstin] = useState('');
  const [divisionPan, setDivisionPan] = useState('');
  const [serviceSacCode, setServiceSacCode] = useState('998719');

  // Customizable Forwarding & Letter Content
  const [forwardingTo, setForwardingTo] = useState('');
  const [forwardingSub, setForwardingSub] = useState('');
  const [forwardingCc, setForwardingCc] = useState('');
  const [certMonthsText, setCertMonthsText] = useState('Twelve/Eighteen');
  const [showEditLetterModal, setShowEditLetterModal] = useState(false);
  const [saveAsDefaultAgency, setSaveAsDefaultAgency] = useState(false);

  // Which MR rows have their per-job chip list expanded. Per MR, and deliberately
  // component state only - it isn't meant to survive a page load.
  const [expandedMrJobs, setExpandedMrJobs] = useState<Set<string>>(new Set());

  const toggleMrJobs = (mr: string) => {
    setExpandedMrJobs(prev => {
      const next = new Set(prev);
      if (next.has(mr)) next.delete(mr);
      else next.add(mr);
      return next;
    });
  };

  // Modal State for Pending Delivery Alert
  /** Blocking setup gap awaiting the operator's decision - see SetupGapDialog. */
  const [setupGap, setSetupGap] = useState<SetupGap | null>(null);

  const [pendingAlertModal, setPendingAlertModal] = useState<{
    isOpen: boolean;
    mrNo: string;
    totalCount: number;
    deliveredCount: number;
    pendingCount: number;
    /** Captured at open time so the wording can't shift if the filter changes later. */
    billType: 'repairable' | 'scrap';
  } | null>(null);

  // NOTE: there is deliberately no single "masterData" here. This screen prices jobs
  // of mixed core types, and the correct master is per job - calculateJobTotal already
  // resolves it via getEstimateMasterForCore({ at, agency }, job.coreType). A CRGO-only
  // `activeAgency.estimateMaster` used to sit here; it never fed pricing, only a
  // useMemo dependency, where it silently failed to invalidate when the Amorphous,
  // Wound Core or Overhauling master changed.

  useEffect(() => {
    async function fetchData() {
      if (!auth.currentUser || !activeAgency) { setLoading(false); return; }
      setLoading(true);
      try {
        const [jobsSnap, inspSnap, oilSnap] = await Promise.all([
          getDocs(query(
            collection(db, 'jobs'),
            where('ownerId', '==', auth.currentUser.uid),
            where('agencyId', '==', activeAgency.id)
          )),
          getDocs(query(
            collection(db, 'inspections'),
            where('ownerId', '==', auth.currentUser.uid)
          )),
          getDocs(query(
            collection(db, 'oilTransactions'),
            where('ownerId', '==', auth.currentUser.uid),
            where('agencyId', '==', activeAgency.id)
          ))
        ]);

        const fetchedJobs = jobsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const fetchedInsps = inspSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const fetchedOil = oilSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        setJobs(fetchedJobs);
        setInspections(fetchedInsps);
        setOilTransactions(fetchedOil);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'jobs');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [activeAgency]);

  // Dynamic divisions list
  const divisions = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach(j => {
      if (j.division) set.add(j.division);
    });
    return Array.from(set).sort();
  }, [jobs]);

  // Group all jobs by MR
  const mrGroups = useMemo(() => {
    const groups: Record<string, any[]> = {};
    jobs.forEach(j => {
      if (!j.mrNo) return;
      if (!groups[j.mrNo]) groups[j.mrNo] = [];
      groups[j.mrNo].push(j);
    });
    return groups;
  }, [jobs]);

  // Handle URL route or query param (e.g., /bills/:mrNo or /bills?mr=MR-101)
  useEffect(() => {
    const urlMr = params.mrNo || searchParams.get('mr') || searchParams.get('mrNo');
    if (urlMr && jobs.length > 0 && selectedMrNo !== urlMr) {
      handleSelectMr(urlMr);
    }
  }, [params.mrNo, searchParams, jobs.length]);

  // Jobs in an MR that belong to the CURRENT bill type. A bill is repairable-only or
  // scrap-only, never both: scrap returns on the scrap committee's timeline, so the
  // two are independent documents with their own bill numbers and dates.
  //
  // Defined here, above the memos that use it, because those run during render.
  const jobsForBillType = (mr: string) => {
    const groupJobs = mrGroups[mr] || [];
    const wantScrap = billTypeFilter === 'scrap';
    // Scrap is billable only once actually returned to the division on a challan -
    // same rule as selectedJobsData, so the summary, the document and the write all
    // agree on which jobs the bill covers.
    // GP is excluded from both bill types before anything else - see isGpJob.
    const billable = groupJobs.filter(j => !isGpJob(j));
    const typeJobs = wantScrap
      ? billable.filter(j => (j.status === 'Scrap' || j.condition === 'Scrap') && j.status === 'Dispatched' && Boolean(j.challanNo))
      : billable.filter(j => !(j.status === 'Scrap' || j.condition === 'Scrap'));
    const deliveredJobs = typeJobs.filter(j => j.status === 'Dispatched');
    return deliveredJobs.length > 0 ? deliveredJobs : typeJobs;
  };

  // Whether THIS bill type's bill has been sent for an MR. Computed over the jobs of
  // the current type only - never the whole MR. Sending the repair bill stamps only
  // repairable jobs, so measuring across every job made the MR look "sent" and
  // removed it from the generator entirely, leaving the scrap bill unraisable.
  const isBillSentForType = (mr: string) =>
    jobsForBillType(mr).some(j => j.billSentDate || j.billStatus === 'Sent' || (j.billNo && j.billNo !== ''));

  // Unsent bills count for stage tab
  const unsentBillCount = useMemo(() => {
    return Object.keys(mrGroups).filter(mr => !isBillSentForType(mr)).length;
  }, [mrGroups, billTypeFilter]);

  // Filter MRs matching search & division (STAGE 1: Bill Generator - Unsent Only)

  /** MR date for sorting: the date of issue recorded on the MR's jobs. MR NUMBERS ARE
   *  NOT CHRONOLOGICAL (MR 9344 predates MR 1563; MR 1 sits among five-digit numbers),
   *  so sorting by number would not be newest-first. Number is the tiebreak only. */
  const mrSortDate = (mr: string): string => {
    const g = mrGroups[mr] || [];
    for (const j of g) {
      const d = j.dateOfIssue || j.mrDate || '';
      if (d) return d;
    }
    return '';
  };

  const filteredMrNos = useMemo(() => {
    return Object.keys(mrGroups).filter(mr => {
      const groupJobs = mrGroups[mr] || [];
      // Remove from Bill Generator only if THIS TYPE's bill is already sent (it
      // advances to Stage 2). Scoped to the current bill type so the repair bill's
      // sent state has no effect on the scrap bill's visibility, and vice versa.
      if (isBillSentForType(mr)) return false;

      const matchesSearch = !searchQuery || mr.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesDivision = selectedDivision === 'All' || groupJobs.some(j => j.division === selectedDivision);

      // Deliberately the BROAD scrap test, not the delivered-only one: an MR whose
      // scrap is not yet returned still appears, showing "0 of N", so pending scrap
      // stays visible. The bill itself contains only delivered scrap, and the
      // nothing-to-bill modal handles the empty case.
      const hasMatchingType = groupJobs.some(j => {
        if (isGpJob(j)) return false;
        const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
        return billTypeFilter === 'scrap' ? isScrap : !isScrap;
      });

      return matchesSearch && matchesDivision && hasMatchingType;
    }).sort(byDateDesc(mr => mrSortDate(mr), byNumericDesc(mr => mr)));
  }, [mrGroups, searchQuery, selectedDivision, billTypeFilter]);

  // Selected jobs for the active bill (Resilient matching)
  // Two sets, deliberately distinct:
  //   selectedJobsWithGp - drives the OIL ACCOUNT sheet. Includes GP jobs: oil is
  //                        consumed regardless of who pays for the repair.
  //   selectedJobsData   - drives every MONEY path. GP excluded, no charge.
  const selectedJobsWithGp = useMemo(() => {
    if (!selectedMrNo) return [];
    const mrJobs = jobs.filter(j => j.mrNo === selectedMrNo);
    if (mrJobs.length === 0) return [];

    // Filter by type (repairable vs scrap). "Scrap Delivered" means exactly that: a
    // scrap unit only enters the scrap bill once it has physically gone back to the
    // division on a challan. Scrap at any earlier stage is not billable yet - the
    // pending ones are counted separately and surfaced as the scrap-committee warning.
    const matchingTypeJobs = mrJobs.filter(j => {
      const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
      if (billTypeFilter !== 'scrap') return !isScrap;
      return isScrap && j.status === 'Dispatched' && Boolean(j.challanNo);
    });

    // Check delivered / dispatched / billed / sent / paid jobs
    const deliveredOrBilled = matchingTypeJobs.filter(j => 
      j.status === 'Dispatched' || 
      j.challanNo || 
      j.deliveryDate || 
      j.billNo || 
      j.billSentDate || 
      j.paymentStatus === 'Paid'
    );

    // If delivered/billed jobs exist, use them, otherwise every job of this type in
    // the MR. Never fall back to `mrJobs` - that mixed scrap and repairable into one
    // bill whenever the selected type had no jobs. A bill is one type or the other.
    const targetList = deliveredOrBilled.length > 0
      ? deliveredOrBilled
      : matchingTypeJobs;

    // Belt and braces: a mixed set must be impossible even if something above changes.
    const wantScrap = billTypeFilter === 'scrap';
    const singleType = targetList.filter(j => ((j.status === 'Scrap' || j.condition === 'Scrap') === wantScrap));

    return [...singleType].sort((a, b) => (a.jobNo || '').localeCompare(b.jobNo || '', undefined, { numeric: true }));
  }, [jobs, selectedMrNo, billTypeFilter]);

  // GP repairs are done under guarantee at no cost - never billed, in either bill type.
  // Keyed on repairType/isGp so pre-existing GP jobs are covered too (isGpJob).
  const selectedJobsData = useMemo(
    () => selectedJobsWithGp.filter(j => !isGpJob(j)),
    [selectedJobsWithGp]
  );

  /** GP jobs in this MR - excluded from the bill, counted so the numbers reconcile. */
  const selectedMrGpJobs = useMemo(
    () => selectedJobsWithGp.filter(j => isGpJob(j)),
    [selectedJobsWithGp]
  );

  // Selected MR pending jobs count
  const selectedMrPendingCount = useMemo(() => {
    if (!selectedMrNo) return 0;
    const mrJobs = jobs.filter(j => j.mrNo === selectedMrNo);
    const targetJobs = mrJobs.filter(j => {
      if (isGpJob(j)) return false;
      const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
      return billTypeFilter === 'scrap' ? isScrap : !isScrap;
    });
    return targetJobs.filter(j => j.status !== 'Dispatched' && !j.challanNo && !j.deliveryDate).length;
  }, [jobs, selectedMrNo, billTypeFilter]);

  // Selected MR Division Name
  const currentDivision = useMemo(() => {
    if (selectedJobsData.length > 0) return selectedJobsData[0].division || 'SABARMATI';
    const mrJobs = jobs.filter(j => j.mrNo === selectedMrNo);
    if (mrJobs.length > 0) return mrJobs[0].division || 'SABARMATI';
    return 'SABARMATI';
  }, [selectedJobsData, jobs, selectedMrNo]);

  // Selected MR Date
  // Raw ISO, or '-' when the MR has no date. This was a third copy of getMrDate whose
  // only difference was falling back to the BILL date - putting a plausible but
  // fabricated date on the printed oil statement for an MR that has none (same shape as
  // O6). One implementation, one fallback: '-'.
  const selectedMrDate = useMemo(
    () => getMrDateIso(selectedMrNo, jobs, oilTransactions),
    [selectedMrNo, jobs, oilTransactions]
  );

  // Sync letter fields whenever activeAgency or currentDivision changes
  useEffect(() => {
    if (activeAgency) {
      setForwardingTo(getBillDivisionRecipient(activeAgency, currentDivision));
      setForwardingSub('Submission of Bill for Payment');
      setForwardingCc(activeAgency.billCcTemplate || '');
    }
  }, [activeAgency, currentDivision]);

  // Set bill metadata when an MR is picked
  const handleSelectMr = (mr: string) => {
    if (!mr) return;
    setSelectedMrNo(mr);
    setCustomOilUptoDate('');
    const mrJobs = jobs.filter(j => j.mrNo === mr);
    const billableJobs = mrJobs.filter(j => !isGpJob(j));
    const scrapCount = billableJobs.filter(j => j.status === 'Scrap' || j.condition === 'Scrap').length;
    const repairableCount = billableJobs.length - scrapCount;

    // A DEFAULT, not an override. This used to force 'repairable' whenever an MR had
    // any repairable job, which on a mixed MR silently moved the user off the Scrap
    // Delivered tab and made the scrap bill unreachable. Only switch when the tab the
    // user is actually on has nothing to show for this MR.
    const currentTabHasJobs = billTypeFilter === 'scrap' ? scrapCount > 0 : repairableCount > 0;
    if (!currentTabHasJobs) {
      if (scrapCount > 0 && repairableCount === 0) {
        setBillTypeFilter('scrap');
      } else if (repairableCount > 0) {
        setBillTypeFilter('repairable');
      }
    }

    const div = mrJobs[0]?.division || activeAgency?.circleOfficeName || 'SABARMATI';
    const orderNum = activeAtMaster?.atNumber || mrJobs[0]?.atNumber || '';
  // WAS: `|| activeAgency?.atNumber` - an AT number on the AGENCY, which no write path
  // has ever produced. It read as a fallback and could only ever be undefined, so the
  // expression was `atMaster.atNumber || undefined || ''`. Removed rather than declared
  // (AUDIT F65).
    
    // Check if bill details were already recorded for THIS BILL TYPE's jobs. Searching
    // every job in the MR prefilled a mixed MR's scrap bill with the repair bill's
    // number and date - the two are independent documents with their own.
    // Approval no./date are AT-level, not per bill type, so they stay MR-wide.
    const wantScrapNow = billTypeFilter === 'scrap';
    const typeJobsForPrefill = mrJobs.filter(j =>
      ((j.status === 'Scrap' || j.condition === 'Scrap') === wantScrapNow)
    );
    const prefillSource = typeJobsForPrefill.length > 0 ? typeJobsForPrefill : mrJobs;

    const savedJobWithBill = prefillSource.find(j => j.billNo);
    const savedJobWithDate = prefillSource.find(j => j.billSentDate || j.billDate);
    const savedJobWithAppr = mrJobs.find(j => j.apprNo || j.orderNo);
    const savedJobWithApprDate = mrJobs.find(j => j.apprDate || j.orderDate);

    const defaultBillNum = savedJobWithBill?.billNo || (activeAgency?.agencyCode ? `${activeAgency.agencyCode}/${new Date().getFullYear()}/${mr}` : `BILL/${mr}`);
    const defaultBillDate = savedJobWithDate?.billSentDate || savedJobWithDate?.billDate || new Date().toISOString().split('T')[0];

    setBillNo(defaultBillNum);
    setBillDate(defaultBillDate);
    setApprNo(savedJobWithAppr?.apprNo || savedJobWithAppr?.orderNo || orderNum);
    setApprDate(savedJobWithApprDate?.apprDate || savedJobWithApprDate?.orderDate || '02.03.2026');
    setDivisionGstin(mrJobs[0]?.divisionGstin || activeAgency?.discomGstin || '');
    setDivisionPan(mrJobs[0]?.divisionPan || activeAgency?.discomPan || '');
    setServiceSacCode(activeAgency?.serviceSacCode || '998719');
    setForwardingTo(getBillDivisionRecipient(activeAgency, div));
    setForwardingCc(activeAgency?.billCcTemplate || '');
  };

  const handleGenerateClick = (mr: string) => {
    const allMrJobs = jobs.filter(j => j.mrNo === mr);
    const targetJobs = allMrJobs.filter(j => {
      if (isGpJob(j)) return false;
      const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
      return billTypeFilter === 'scrap' ? isScrap : !isScrap;
    });
    const delJobs = targetJobs.filter(j => j.status === 'Dispatched' || j.challanNo || j.deliveryDate);
    const pendJobs = targetJobs.filter(j => j.status !== 'Dispatched' && !j.challanNo && !j.deliveryDate);

    if (delJobs.length === 0 && pendJobs.length > 0) {
      setPendingAlertModal({
        isOpen: true,
        mrNo: mr,
        totalCount: targetJobs.length,
        deliveredCount: 0,
        pendingCount: pendJobs.length,
        billType: billTypeFilter,
      });
      return;
    }

    if (pendJobs.length > 0) {
      setPendingAlertModal({
        isOpen: true,
        mrNo: mr,
        totalCount: targetJobs.length,
        deliveredCount: delJobs.length,
        pendingCount: pendJobs.length,
        billType: billTypeFilter,
      });
    } else {
      handleSelectMr(mr);
    }
  };

  // Inspection records keyed by job, in the same shape EstimateGenerate uses. Needed
  // because a fixed-rate estimate picks its Schedule-B row by winding type, which lives
  // on the internal inspection (`windingType` -> Aluminium or Copper).
  const externalInspMap = useMemo(() => {
    const map: Record<string, any> = {};
    inspections.filter(i => (i.type || '').toLowerCase() === 'external').forEach(i => {
      if (i.jobId) map[i.jobId] = i.data || i;
    });
    return map;
  }, [inspections]);

  const internalInspMap = useMemo(() => {
    const map: Record<string, any> = {};
    inspections.filter(i => (i.type || '').toLowerCase() === 'internal').forEach(i => {
      if (i.jobId) map[i.jobId] = i.data || i;
    });
    return map;
  }, [inspections]);

  // Calculate job estimate / bill amount
  //
  // BRANCHES ON CORE TYPE, matching buildSingleJobEstimateData (AUDIT F39).
  //
  // It used to walk the estimate master for EVERY core type, with hardcoded quantity
  // rules, and had no fixed-rate path at all. For Amorphous and CRGO Wound Core the tender
  // is a FIXED RATE (Internal & External) - one repairing charge plus a labour line - so
  // the itemised walk added tank replacement, conservator, radiator and sealing to every
  // such repair whether that work was done or not. The estimate and the bill computed the
  // same job by two different models and would have disagreed even with a perfect master.
  //
  // The fixed-rate branch DELEGATES to buildSingleJobEstimateData rather than reading
  // SCHEDULE_B here. A second implementation of one rate schedule is how the scrap charge
  // came to sit under four different codes across six agencies; there is one Schedule-B
  // reader in this codebase and this is not it.
  const calculateJobTotal = (job: any) => {
    const kva = String(job.capacityKva);
    const isScrapJob = job.status === 'Scrap' || job.condition === 'Scrap';
    const jobMasterData = getEstimateMasterForCore({ at: atForJob(job, atMasters) ?? activeAtMaster, agency: activeAgency }, job.coreType);
    const atPct = getAtPercentageForCore(atForJob(job, atMasters) ?? activeAtMaster, job.coreType);

    // A scrap transformer is ONE flat charge, resolved by the mapped scrap item code
    // for its core type (shared helper - see lib/estimateCalc.ts). It never walks the
    // repair item list. The old itemName substring matching ('scrap'/'dismental') plus
    // itemCode '1a' priced CRGO scrap off Labour Charge (Rs 2,061 at 25 KVA) instead.
    // An unresolvable rate contributes nothing and is reported - never a hardcoded 500.
    if (isScrapJob) {
      const scrapCharge = resolveScrapCharge(job.coreType, kva, jobMasterData);
      if (scrapCharge.rate === null) return 0;
      return scrapCharge.rate * (1 + atPct / 100);
    }

    // Fixed-rate cores, AFTER the scrap short-circuit above and in the same order as the
    // estimate: a scrap Amorphous unit is one flat charge, not a Schedule-B repair.
    // baseTotal is pre-AT; the AT uplift is applied by the caller exactly as on the
    // itemised path below, so the two branches remain comparable.
    const coreClass = classifyCoreType(job.coreType || 'CRGO');
    if (coreClass === 'AMORPHOUS' || coreClass === 'WOUND_CORE') {
      const est = getJobFullEstimate(
        job,
        externalInspMap[job.id],
        internalInspMap[job.id],
        activeAgency,
        atForJob(job, atMasters) ?? activeAtMaster
      );
      // `est.baseTotal` is pre-AT; the multiplication below adds the AT percentage, so
      // THIS FUNCTION RETURNS AN AT-INCLUSIVE FIGURE. The old comment here said it kept
      // "returning a pre-AT figure", which described baseTotal rather than the return
      // value - and every caller that believed it multiplied by the AT again (AUDIT O3).
      // Callers name the result `atInclusiveAmt` for the same reason.
      return est.baseTotal * (1 + atPct / 100);
    }

    // Repairable path - CRGO and Overhauling. THE SAME BUILDER as the two branches above.
    //
    // This was the third parallel implementation of one calculation (AUDIT F57), and the
    // last one. It walked the master applying quantity rules of its own invention and read
    // NO inspection data at all, so it and the estimate answered the same question
    // differently, in both directions at once:
    //
    //   - `unit === 'Y'` charged qty 1 ALWAYS, so every optional item was billed regardless
    //     of what the inspection found. F46 fixed that in the estimate; it never arrived
    //     here.
    //   - the coil rows are `unit: 'QTY'` in the master while being priced per KILOGRAM, so
    //     a 47 kg HV coil billed as 1 x Rs 163 = Rs 163 instead of Rs 7,661.
    //   - `unit === 'KG'` substituted an invented per-capacity weight (14 / 15.54 / 45.36),
    //     the same constant standing in for a main tank AND a conservator tank (O26).
    //   - bushing and metal-part counts were hardcoded by item code rather than read from
    //     the external inspection.
    //
    // Those do not cancel: a coil rewind under-billed by thousands while a job needing
    // almost nothing over-billed. Every fix this session - F44, F46, F47, F52, the
    // conservator block - landed in the builder and none of them here, which is exactly the
    // argument that retired the estimate engine in F55.
    //
    // The file had already made this argument for two of its three branches: see the note
    // above the scrap short-circuit, "there is one Schedule-B reader in this codebase and
    // this is not it". This is the third.
    //
    // baseTotal, not finalAmount: pre-AT, so the single uplift below stays the only one -
    // identical to what the Amorphous branch does ten lines up.
    const est = getJobFullEstimate(
      job,
      externalInspMap[job.id],
      internalInspMap[job.id],
      activeAgency,
      atForJob(job, atMasters) ?? activeAtMaster
    );
    return est.baseTotal * (1 + atPct / 100);
  };

  // Named, blocking errors for any selected scrap job whose flat charge cannot be
  // resolved from the master. Non-empty means the scrap bill must not be sent.
  const scrapChargeErrors = useMemo(() => {
    const seen = new Set<string>();
    const errors: string[] = [];
    selectedJobsData.forEach(job => {
      const isScrapJob = job.status === 'Scrap' || job.condition === 'Scrap';
      if (!isScrapJob) return;
      const master = getEstimateMasterForCore({ at: atForJob(job, atMasters) ?? activeAtMaster, agency: activeAgency }, job.coreType);
      const { error } = resolveScrapCharge(job.coreType, String(job.capacityKva), master);
      if (error && !seen.has(error)) {
        seen.add(error);
        errors.push(error);
      }
    });
    return errors;
  }, [selectedJobsData, activeAgency]);

  // Billing Financial Calculations
  const cgstRate = typeof activeAgency?.cgstPercent === 'number' ? activeAgency.cgstPercent : 9;
  const sgstRate = typeof activeAgency?.sgstPercent === 'number' ? activeAgency.sgstPercent : 9;

  const subTotal = useMemo(() => {
    return selectedJobsData.reduce((acc, job) => acc + calculateJobTotal(job), 0);
    // activeAgency/activeAtMaster cover every master calculateJobTotal reads - all
    // core types, not just CRGO - plus the AT percentage.
  }, [selectedJobsData, activeAgency, activeAtMaster]);

  const cgst = useMemo(() => subTotal * (cgstRate / 100), [subTotal, cgstRate]);
  const sgst = useMemo(() => subTotal * (sgstRate / 100), [subTotal, sgstRate]);
  const grandTotal = useMemo(() => subTotal + cgst + sgst, [subTotal, cgst, sgst]);

  // Oil Data Calculations for Oil Account Document (Page 4)
  // OIL ACCOUNTING - deliberately uses the GP-INCLUSIVE set. A GP transformer still
  // consumes oil and its shortage must still be accounted for; only the money paths
  // exclude it. Do not switch this to selectedJobsData.
  const jobOilDetails = useMemo(() => {
    return selectedJobsWithGp.map(job => {
      const insp = inspections.find(i => 
        (i.jobId === job.id || i.jobId === job.jobNo || i.id === job.inspectionId || (i.mrNo === job.mrNo && i.jobNo === job.jobNo)) &&
        (i.type === 'External' || !i.type || i.data?.oilCapLtrs !== undefined)
      ) || inspections.find(i => i.jobId === job.id);
      
      const rawOilCap = insp?.data?.oilCapLtrs ?? insp?.oilCapLtrs ?? job.externalDetails?.oilCapLtrs ?? job.oilCapLtrs ?? job.oilCapacity;
      const rawLessOil = insp?.data?.lessOilLtrs ?? insp?.lessOilLtrs ?? job.externalDetails?.lessOilLtrs ?? job.lessOilLtrs;
      const rawNetShortage = insp?.data?.netShortage ?? insp?.netShortage ?? job.externalDetails?.netShortage;

      const kva = Number(job.capacityKva) || 25;
      const defaultCap = kva <= 16 ? 140 : kva <= 25 ? 184 : kva <= 63 ? 240 : 323;

      // Exact values as per external report
      const oilCap = (rawOilCap !== undefined && rawOilCap !== null && String(rawOilCap).trim() !== '')
        ? Number(rawOilCap)
        : defaultCap;

      const lessOil = (rawLessOil !== undefined && rawLessOil !== null && String(rawLessOil).trim() !== '')
        ? Number(rawLessOil)
        : 0;

      const oilRecd = Math.max(0, oilCap - lessOil);
      const baseShortage = lessOil;
      const filterLoss = oilRecd * 0.05; // 5% filtration loss on received oil

      const netShortage = (typeof rawNetShortage === 'number')
        ? rawNetShortage
        : (baseShortage + filterLoss);

      return {
        job,
        oilCap,
        oilRecd,
        baseShortage,
        lessOil,
        filterLoss,
        netShortage
      };
    });
  }, [selectedJobsWithGp, inspections]);

  const totalOilCapacity = useMemo(() => jobOilDetails.reduce((a, b) => a + b.oilCap, 0), [jobOilDetails]);
  const totalOilReceived = useMemo(() => jobOilDetails.reduce((a, b) => a + b.oilRecd, 0), [jobOilDetails]);
  const totalBaseShortage = useMemo(() => jobOilDetails.reduce((a, b) => a + b.baseShortage, 0), [jobOilDetails]);
  const totalFilterLoss = useMemo(() => jobOilDetails.reduce((a, b) => a + b.filterLoss, 0), [jobOilDetails]);
  const totalNetShortage = useMemo(() => jobOilDetails.reduce((a, b) => a + b.netShortage, 0), [jobOilDetails]);

  // Helpers for date parsing and division filtering
  const parseDateToTimestamp = (dateVal: any): number => {
    if (!dateVal) return 0;
    if (typeof dateVal === 'number') return dateVal;
    if (dateVal instanceof Date) return dateVal.getTime();
    if (dateVal.seconds || dateVal._seconds) return (dateVal.seconds || dateVal._seconds) * 1000;
    if (typeof dateVal === 'string') {
      const s = dateVal.trim();
      if (!s || s === '-') return 0;
      // Format: YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
      if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(s)) {
        const parts = s.split('T')[0].split(/[-/.]/);
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const d = parseInt(parts[2], 10);
        return new Date(y, m, d, 23, 59, 59, 999).getTime();
      }
      // Format: DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
      if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}/.test(s)) {
        const parts = s.split(/[-/.]/);
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const y = parseInt(parts[2], 10);
        return new Date(y, m, d, 23, 59, 59, 999).getTime();
      }
      const parsed = new Date(s).getTime();
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  };

  const formatDateStr = (dateVal: any): string => {
    if (!dateVal) return '';
    if (typeof dateVal === 'string') return dateVal;
    if (typeof dateVal === 'number') {
      const d = new Date(dateVal);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
    if (dateVal?.seconds) {
      const d = new Date(dateVal.seconds * 1000);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
    return '';
  };

  /** Raw ISO (or '-'), shared with OilInward - see lib/utils getMrDateIso. */
  const getMrDate = (mrNo: string) => getMrDateIso(mrNo, jobs, oilTransactions);

  // Inspection Date for the selected MR
  const selectedMrInspectionDate = useMemo(() => {
    if (!selectedMrNo) return selectedMrDate;
    for (const job of selectedJobsData) {
      const insp = inspections.find(i => i.jobId === job.id);
      if (insp?.data?.dateOfInspection) return String(insp.data.dateOfInspection);
      if (job.externalDetails?.dateOfInspection) return String(job.externalDetails.dateOfInspection);
    }
    return selectedMrDate;
  }, [selectedMrNo, selectedJobsData, inspections, selectedMrDate]);

  // Master MR-wise Summary matching OilInward logic identically
  const allMrSummary = useMemo(() => {
    const summary: Record<
      string,
      {
        mrNo: string;
        mrDate: string;
        division: string;
        totalShortage: number;
        totalReceived: number;
      }
    > = {};

    // Group shortage from external inspections via jobs
    jobs.forEach((job) => {
      const mrNo = job.mrNo;
      if (!mrNo) return;
      const mrDate = job.dateOfIssue || job.mrDate || (job.createdAt ? formatDateStr(job.createdAt) : "-");
      if (!summary[mrNo]) {
        summary[mrNo] = {
          mrNo,
          mrDate,
          division: job.division || "",
          totalShortage: 0,
          totalReceived: 0,
        };
      } else if (summary[mrNo].mrDate === "-" && mrDate !== "-") {
        summary[mrNo].mrDate = mrDate;
      }

      const insp = inspections.find(i => 
        (i.jobId === job.id || i.jobId === job.jobNo || i.id === job.inspectionId || (i.mrNo === job.mrNo && i.jobNo === job.jobNo)) &&
        (i.type === 'External' || !i.type || i.data?.oilCapLtrs !== undefined)
      ) || inspections.find(i => i.jobId === job.id);

      const rawOilCap = insp?.data?.oilCapLtrs ?? insp?.oilCapLtrs ?? job.externalDetails?.oilCapLtrs ?? job.oilCapLtrs ?? job.oilCapacity;
      const rawLessOil = insp?.data?.lessOilLtrs ?? insp?.lessOilLtrs ?? job.externalDetails?.lessOilLtrs ?? job.lessOilLtrs;
      const rawNetShortage = insp?.data?.netShortage ?? insp?.netShortage ?? job.externalDetails?.netShortage;

      const kva = Number(job.capacityKva) || 25;
      const defaultCap = kva <= 16 ? 140 : kva <= 25 ? 184 : kva <= 63 ? 240 : 323;

      const oilCap = (rawOilCap !== undefined && rawOilCap !== null && String(rawOilCap).trim() !== '')
        ? Number(rawOilCap)
        : defaultCap;

      const lessOil = (rawLessOil !== undefined && rawLessOil !== null && String(rawLessOil).trim() !== '')
        ? Number(rawLessOil)
        : 0;

      const oilRecd = Math.max(0, oilCap - lessOil);
      const baseShortage = lessOil;
      const filterLoss = oilRecd * 0.05;
      const netShortage = (typeof rawNetShortage === "number")
        ? rawNetShortage
        : (baseShortage + filterLoss);

      summary[mrNo].totalShortage += netShortage;
    });

    // Group received oil from transactions
    oilTransactions.forEach((tx) => {
      const mrNo = tx.mrNo;
      if (!mrNo) return;
      const txMrDate = tx.mrDate || getMrDate(tx.mrNo);
      if (!summary[mrNo]) {
        summary[mrNo] = {
          mrNo,
          mrDate: txMrDate,
          division: tx.division || "",
          totalShortage: 0,
          totalReceived: 0,
        };
      } else if (summary[mrNo].mrDate === "-" && txMrDate !== "-") {
        summary[mrNo].mrDate = txMrDate;
      }
      summary[mrNo].totalReceived += Number(tx.netLiters || 0);
    });

    return Object.values(summary);
  }, [jobs, inspections, oilTransactions]);

  const [customOilUptoDate, setCustomOilUptoDate] = useState<string>('');

  const effectiveOilUptoDate = useMemo(() => {
    if (customOilUptoDate) return customOilUptoDate;
    if (selectedMrNo) {
      const derived = getMrDate(selectedMrNo);
      if (derived && derived !== '-') return derived;
    }
    // selectedMrDate can now be '-', which is TRUTHY - guard explicitly. This is a
    // filter bound (oil balance "up to"), not a claim about the MR, so falling back to
    // billDate here is a functional choice rather than a fabricated MR date.
    return (selectedMrDate && selectedMrDate !== '-') ? selectedMrDate : billDate;
  }, [customOilUptoDate, selectedMrNo, selectedMrDate, billDate, jobs, oilTransactions]);

  const formatToYyyyMmDd = (val: string): string => {
    if (!val) return '';
    const ts = parseDateToTimestamp(val);
    if (!ts) return '';
    const d = new Date(ts);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const mrOilTxList = useMemo(() => {
    if (!selectedMrNo) return [];
    const cleanSelectedMr = selectedMrNo.trim().toLowerCase();
    return oilTransactions.filter(t => {
      if (t.division && currentDivision) {
        const tDiv = t.division.trim().toUpperCase();
        const cDiv = currentDivision.trim().toUpperCase();
        if (tDiv !== cDiv && !tDiv.includes(cDiv) && !cDiv.includes(tDiv)) {
          if (!t.mrNo || t.mrNo.trim().toLowerCase() !== cleanSelectedMr) return false;
        }
      }

      if (t.mrNo && t.mrNo.trim().toLowerCase() === cleanSelectedMr) return true;

      if (!t.mrNo || t.mrNo.trim() === '') {
        const tDateStr = t.mrDate || formatDateStr(t.date);
        if (tDateStr && selectedMrDate && selectedMrDate !== '-' && tDateStr === selectedMrDate) return true;
      }
      return false;
    });
  }, [oilTransactions, selectedMrNo, currentDivision, selectedMrDate]);

  const mrInwardOilTotal = useMemo(() => {
    return mrOilTxList.reduce((acc, tx) => acc + (Number(tx.netLiters) || 0), 0);
  }, [mrOilTxList]);

  // Concern Division Cumulative Oil Shortage & Balance up to Inspection / MR Date
  const divisionOilStatement = useMemo(() => {
    if (!currentDivision) {
      return {
        divisionCumulativeShortage: totalNetShortage,
        divisionCumulativeInward: mrInwardOilTotal,
        divisionNetOilOnInspectionDate: totalNetShortage - mrInwardOilTotal,
        priorShortage: 0,
        priorInward: 0,
        priorNetBalance: 0
      };
    }

    const uptoTimestamp = parseDateToTimestamp(effectiveOilUptoDate);

    // Filter MR summary for concern division up to the effective MR date identically to OilInward
    const divisionMrList = allMrSummary.filter((s) => {
      if (currentDivision) {
        const sDiv = (s.division || "").trim().toUpperCase();
        const cDiv = currentDivision.trim().toUpperCase();
        if (sDiv && cDiv && sDiv !== cDiv && !sDiv.includes(cDiv) && !cDiv.includes(sDiv)) {
          return false;
        }
      }
      if (uptoTimestamp > 0) {
        const itemTimestamp = parseDateToTimestamp(s.mrDate);
        if (itemTimestamp > 0 && itemTimestamp > uptoTimestamp) {
          return false;
        }
      }
      return true;
    });

    const divisionCumulativeShortage = divisionMrList.reduce((sum, item) => sum + item.totalShortage, 0);
    const divisionCumulativeInward = divisionMrList.reduce((sum, item) => sum + item.totalReceived, 0);
    const divisionNetOilOnInspectionDate = divisionCumulativeShortage - divisionCumulativeInward;

    const priorShortage = Math.max(0, divisionCumulativeShortage - totalNetShortage);
    const priorInward = Math.max(0, divisionCumulativeInward - mrInwardOilTotal);
    const priorNetBalance = priorShortage - priorInward;

    return {
      divisionCumulativeShortage,
      divisionCumulativeInward,
      divisionNetOilOnInspectionDate,
      priorShortage,
      priorInward,
      priorNetBalance
    };
  }, [allMrSummary, currentDivision, effectiveOilUptoDate, selectedMrNo, totalNetShortage, mrInwardOilTotal]);

  const netOilDue = useMemo(() => {
    return divisionOilStatement.divisionNetOilOnInspectionDate;
  }, [divisionOilStatement]);

  // A charge that could not be resolved must never leave the building as a document.
  // The named error already blocked the Send Bill WRITE, but printing and exporting
  // were ungated - so an invoice went out showing 0.00 for an unresolvable scrap line
  // instead of refusing to generate. Every path that produces a document is gated.
  /**
   * The tax invoice prints the DISCOM's name, GSTIN and address. A tax invoice with no
   * buyer GSTIN is a document that cannot be issued, so this blocks - where previously
   * the fields were seeded with another company's registration and printed silently
   * (AUDIT O7). Gated on the fields THIS document carries, naming the missing one.
   */
  const blockIfDiscomIncomplete = (action: string) => {
    const missing = missingForTaxInvoice(activeAgency);
    if (missing.length === 0) return false;
    setSetupGap({
      title: 'DISCOM details incomplete',
      problem: `The tax invoice cannot be ${action} until the DISCOM's details are recorded for ${activeAgency?.name || 'this agency'}. It prints on the invoice as the buyer.`,
      position: `Missing: ${missing.join(', ')}`,
      detail: [
        'Enter these from your own tender paperwork - they are not pre-filled.',
        'A tax invoice without the buyer GSTIN cannot be issued.',
      ],
      actionLabel: 'Open Agency Settings',
      actionTo: '/agency-settings',
    });
    return true;
  };

  /**
   * Blocks when the estimate master section a billed job prices from does not hold that
   * section's schedule. Distinct from blockIfUnresolvedCharges, which fires when a
   * specific rate is missing: this fires when the whole SECTION is the wrong schedule,
   * which is a data fault the resolver hides by falling back (AUDIT F27).
   *
   * Keyed off selectedJobsData - the money path - so a GP transformer, which is never
   * billed, cannot block a bill over a master it does not price from.
   */
  const blockIfMasterMisfiled = (action: string) => {
    const cores: string[] = Array.from(new Set<string>(
      selectedJobsData.map((j: any) => String(j.coreType || 'CRGO'))
    ));
    for (const core of cores) {
      const health = validateEstimateMaster(activeAgency, core);
      if (!health.blocking) continue;
      setSetupGap({
        title: `${health.label} estimate master holds the wrong schedule`,
        problem: `This bill cannot be ${action}: it contains ${core} transformer(s), and the ${health.label} section of ${activeAgency?.name || 'this agency'}'s estimate master does not contain the ${health.label} schedule.`,
        position: `${health.label} section: ${health.itemCount} items, ${Math.round(health.crgoScore * 100)}% of their codes belong to the CRGO card`,
        detail: [
          ...health.problems,
          'Amounts come from a fallback section, so they are not wrong - but the stored master is, and a tax invoice should not be issued against a master nobody has confirmed.',
          'Nothing is repaired automatically: only someone with the tender can say which schedule belongs in this section.',
        ],
        actionLabel: 'Open Estimate Master',
        actionTo: '/estimate-master',
      });
      return true;
    }
    return false;
  };

  const blockIfUnresolvedCharges = (action: string) => {
    if (scrapChargeErrors.length === 0) return false;
    // Same block as before - now with a route to where the missing item is added.
    setSetupGap({
      title: 'Scrap charge not configured',
      problem: `This bill cannot be produced: a charge on it has no rate in the estimate master.`,
      position: `Blocked action: ${action}`,
      detail: scrapChargeErrors,
      actionLabel: 'Open Estimate Master',
      actionTo: '/estimate-master',
    });
    return true;
  };

  const handlePrint = () => {
    if (blockIfDiscomIncomplete('printed')) return;
    if (blockIfUnresolvedCharges('print this bill')) return;
    if (blockIfMasterMisfiled('printed')) return;
    if (selectedMrNo) {
      triggerUniversalPrint('printable-billing-container', `Tax Invoice & Letter Documents - MR ${selectedMrNo}`, `Bill_Package_MR_${selectedMrNo}.pdf`);
    } else {
      triggerUniversalPrint('printable-billing-container', 'Tax Invoice & Bill Documents', 'Bill_Package.pdf');
    }
  };

  const handleExportExcel = () => {
    if (!selectedMrNo || selectedJobsData.length === 0) return;
    if (blockIfDiscomIncomplete('exported')) return;
    if (blockIfUnresolvedCharges('export this bill')) return;
    if (blockIfMasterMisfiled('exported')) return;

    const wsData: any[][] = [];
    wsData.push([`TAX INVOICE / REPAIR BILL - MR NO: ${selectedMrNo}`]);
    wsData.push([`Bill No: ${billNo}`, `Bill Date: ${formatDDMMYYYY(billDate)}`, `Division: ${currentDivision}`]);
    wsData.push([`Appr No: ${apprNo}`, `Appr Date: ${formatDDMMYYYY(apprDate)}`, `Division GSTIN: ${divisionGstin}`]);
    wsData.push([]);

    // Table Header
    wsData.push(['SR.', 'JOB NO', 'KVA', 'MAKE', 'SERIAL NO', 'CORE TYPE', 'BASE COST', 'AT % RISE/FALL', 'TOTAL AMOUNT']);

    let subTotal = 0;
    selectedJobsData.forEach((job, idx) => {
      // calculateJobTotal ALREADY includes the AT percentage - see the comment on its
      // return. This used to multiply by it again, so every money figure in this file was
      // 4% high at a 4% AT: TOTAL AMOUNT, SUB TOTAL, CGST, SGST, GRAND TOTAL and the oil
      // deduction computed from them. The printed invoice was correct throughout; only
      // this export was wrong (AUDIT O3).
      const atInclusiveAmt = calculateJobTotal(job);
      const atPct = getAtPercentageForCore(atForJob(job, atMasters) ?? activeAtMaster, job.coreType);
      // BASE COST is a pre-AT column, so it is back-derived rather than relabelled: the
      // file must satisfy its own arithmetic, BASE COST x (1 + AT%) = TOTAL AMOUNT. It
      // previously printed the AT-inclusive figure under a heading that says base.
      const baseBeforeAt = atPct === -100 ? 0 : atInclusiveAmt / (1 + atPct / 100);
      subTotal += atInclusiveAmt;

      wsData.push([
        idx + 1,
        job.jobNo,
        `${job.capacityKva} KVA`,
        job.make,
        job.serialNo,
        job.coreType || 'CRGO',
        Number(baseBeforeAt.toFixed(2)),
        `${atPct >= 0 ? '+' : ''}${atPct.toFixed(2)}%`,
        Number(atInclusiveAmt.toFixed(2))
      ]);
    });

    const cgstRate = activeAgency?.cgstPercent !== undefined ? activeAgency.cgstPercent : 9;
    const sgstRate = activeAgency?.sgstPercent !== undefined ? activeAgency.sgstPercent : 9;
    const cgstAmount = subTotal * (cgstRate / 100);
    const sgstAmount = subTotal * (sgstRate / 100);
    const grandTotal = subTotal + cgstAmount + sgstAmount;

    wsData.push([]);
    wsData.push(['', '', '', '', '', '', 'SUB TOTAL', '', Number(subTotal.toFixed(2))]);
    wsData.push(['', '', '', '', '', '', `CGST (${cgstRate.toFixed(1)}%)`, '', Number(cgstAmount.toFixed(2))]);
    wsData.push(['', '', '', '', '', '', `SGST (${sgstRate.toFixed(1)}%)`, '', Number(sgstAmount.toFixed(2))]);
    wsData.push(['', '', '', '', '', '', 'GRAND TOTAL', '', Number(grandTotal.toFixed(2))]);
    
    if (netOilDue > 0) {
      const oilRatePerLtr = 110;
      const netOilCostDeduction = netOilDue * oilRatePerLtr;
      const netPayableAfterOil = grandTotal - netOilCostDeduction;
      wsData.push(['', '', '', '', '', '', 'LESS: OIL SHORTAGE DEDUCTION', '', Number(netOilCostDeduction.toFixed(2))]);
      wsData.push(['', '', '', '', '', '', 'NET PAYABLE AMOUNT', '', Number(netPayableAfterOil.toFixed(2))]);
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tax Invoice");
    XLSX.writeFile(wb, `Tax_Invoice_MR_${selectedMrNo}_Bill_${billNo}.xlsx`);
  };

  const handleSaveBillDates = async () => {
    if (!selectedMrNo || selectedJobsData.length === 0 || !auth.currentUser) return;
    setSavingBillDates(true);
    setSavedSuccessMsg('');
    try {
      const batch = writeBatch(db);
      const todayIso = billDate || new Date().toISOString().split('T')[0];

      selectedJobsData.forEach(job => {
        const atInclusiveAmt = calculateJobTotal(job);
        const atPct = getAtPercentageForCore(atForJob(job, atMasters) ?? activeAtMaster, job.coreType);
        const cgstRate = activeAgency?.cgstPercent !== undefined ? activeAgency.cgstPercent : 9;
        const sgstRate = activeAgency?.sgstPercent !== undefined ? activeAgency.sgstPercent : 9;
        const totalJobTaxedAmt = Math.round(atInclusiveAmt * (1 + (cgstRate + sgstRate) / 100));

        const jobRef = doc(db, 'jobs', job.id);
        batch.update(jobRef, {
          billSentDate: todayIso,
          // ISSUING AGENCY, STAMPED WITH THE DOCUMENT (AUDIT O14).
          //
          // Written in THIS batch, beside the document field, because a job carrying a
          // document number and no issuing agency is the state that cost an hour of
          // reconstruction after the bulk move: the supplier of an issued document used to
          // live only in `job.agencyId`, a mutable pointer that a later write moved.
          //
          // A document's supplier is a fact about the past. It does not change when the
          // job is later reassigned, so it is recorded here once and never rewritten.
          issuedByAgencyId: activeAgency?.id || '',
          issuedByAgencyName: activeAgency?.name || '',
          issuedByAgencyGstin: activeAgency?.gstin || '',
          billNo: billNo || `BILL/${selectedMrNo}`,
          billAmount: totalJobTaxedAmt,
          updatedAt: new Date().toISOString()
        });
      });

      await batch.commit();

      // Update local state
      setJobs(prev => prev.map(j => {
        if (selectedJobsData.some(sj => sj.id === j.id)) {
          const atInclusiveAmt = calculateJobTotal(j);
          const atPct = getAtPercentageForCore(atForJob(j, atMasters) ?? activeAtMaster, j.coreType);
          const cgstRate = activeAgency?.cgstPercent !== undefined ? activeAgency.cgstPercent : 9;
          const sgstRate = activeAgency?.sgstPercent !== undefined ? activeAgency.sgstPercent : 9;
          const totalJobTaxedAmt = Math.round(atInclusiveAmt * (1 + (cgstRate + sgstRate) / 100));
          return {
            ...j,
            billSentDate: todayIso,
            billNo: billNo || `BILL/${selectedMrNo}`,
            billAmount: totalJobTaxedAmt,
            // Mirrors the batch above, so the in-memory job matches what was written.
            issuedByAgencyId: activeAgency?.id || '',
            issuedByAgencyName: activeAgency?.name || '',
            issuedByAgencyGstin: activeAgency?.gstin || '',
          };
        }
        return j;
      }));

      setSavedSuccessMsg('Bill No & Bill Sent Date saved to all delivered jobs in this MR!');
      setTimeout(() => setSavedSuccessMsg(''), 4000);
    } catch (err: any) {
      console.error(err);
      alert('Error saving bill dates: ' + (err.message || err.toString()));
    } finally {
      setSavingBillDates(false);
    }
  };

  // Helper to compute bill summary for any MR

  const calculateMrBillSummary = (mr: string) => {
    const targetJobs = jobsForBillType(mr);

    let mrSubTotal = 0;
    targetJobs.forEach(job => {
      mrSubTotal += calculateJobTotal(job);
    });

    const cgstRate = activeAgency?.cgstPercent !== undefined ? activeAgency.cgstPercent : 9;
    const sgstRate = activeAgency?.sgstPercent !== undefined ? activeAgency.sgstPercent : 9;
    const cgstAmount = mrSubTotal * (cgstRate / 100);
    const sgstAmount = mrSubTotal * (sgstRate / 100);
    const mrGrandTotal = Math.round(mrSubTotal + cgstAmount + sgstAmount);

    return {
      subTotal: mrSubTotal,
      grandTotal: mrGrandTotal,
      jobCount: targetJobs.length
    };
  };

  // Open Send Bill Modal
  const handleOpenSendBillModal = (mr: string) => {
    setSendTargetMr(mr);
    // Defaults come from jobs of the CURRENT bill type only, so the repair bill and
    // the scrap bill for one MR keep their own numbers and dates.
    const groupJobs = jobsForBillType(mr);
    const sample = groupJobs[0] || {};
    const defaultBillNum = sample.billNo || (activeAgency?.agencyCode ? `${activeAgency.agencyCode}/${new Date().getFullYear()}/${mr}` : `BILL/${mr}`);
    const defaultRef = sample.billRefNo || `UGVCL/BILL-SUB/${mr}`;
    
    setSendBillNo(defaultBillNum);
    setSendBillRefNo(defaultRef);
    setSendBillDate(sample.billSentDate || new Date().toISOString().split('T')[0]);
    setSendBillRemarks(sample.billRemarks || '');
    setShowSendBillModal(true);
  };

  // Confirm Send Bill
  const handleConfirmSendBill = async () => {
    if (!sendTargetMr || !sendBillNo.trim() || !sendBillRefNo.trim() || !sendBillDate || !auth.currentUser) {
      alert('Please fill Bill No, Dispatch Reference No and Sent Date');
      return;
    }

    // Never send a scrap bill whose flat charge could not be resolved from the master.
    const unresolvedScrap: string[] = [];
    jobsForBillType(sendTargetMr).forEach(job => {
      if (!(job.status === 'Scrap' || job.condition === 'Scrap')) return;
      const master = getEstimateMasterForCore({ at: atForJob(job, atMasters) ?? activeAtMaster, agency: activeAgency }, job.coreType);
      const { error } = resolveScrapCharge(job.coreType, String(job.capacityKva), master);
      if (error && !unresolvedScrap.includes(error)) unresolvedScrap.push(error);
    });
    if (unresolvedScrap.length > 0) {
      alert(`⚠️ Scrap charge not configured - this bill cannot be sent.\n\n${unresolvedScrap.join('\n\n')}`);
      return;
    }
    setSubmittingSendBill(true);
    try {
      // Stamp bill data only on jobs of the current bill type. Writing to every job in
      // the MR conflated the repair bill and the scrap bill into one set of numbers.
      const groupJobs = jobsForBillType(sendTargetMr);
      const batch = writeBatch(db);
      const { grandTotal } = calculateMrBillSummary(sendTargetMr);

      groupJobs.forEach(job => {
        const atInclusiveAmt = calculateJobTotal(job);
        const atPct = getAtPercentageForCore(atForJob(job, atMasters) ?? activeAtMaster, job.coreType);
        const cgstRate = activeAgency?.cgstPercent !== undefined ? activeAgency.cgstPercent : 9;
        const sgstRate = activeAgency?.sgstPercent !== undefined ? activeAgency.sgstPercent : 9;
        const totalJobTaxedAmt = Math.round(atInclusiveAmt * (1 + (cgstRate + sgstRate) / 100));

        const jobRef = doc(db, 'jobs', job.id);
        batch.update(jobRef, {
          billNo: sendBillNo.trim(),
          // ISSUING AGENCY, STAMPED WITH THE DOCUMENT (AUDIT O14).
          //
          // Written in THIS batch, beside the document field, because a job carrying a
          // document number and no issuing agency is the state that cost an hour of
          // reconstruction after the bulk move: the supplier of an issued document used to
          // live only in `job.agencyId`, a mutable pointer that a later write moved.
          //
          // A document's supplier is a fact about the past. It does not change when the
          // job is later reassigned, so it is recorded here once and never rewritten.
          issuedByAgencyId: activeAgency?.id || '',
          issuedByAgencyName: activeAgency?.name || '',
          issuedByAgencyGstin: activeAgency?.gstin || '',
          billRefNo: sendBillRefNo.trim(),
          billSentDate: sendBillDate,
          billAmount: totalJobTaxedAmt,
          billTotalMrAmount: grandTotal,
          billStatus: 'Sent',
          paymentStatus: job.paymentStatus || 'Unpaid',
          billRemarks: sendBillRemarks || '',
          updatedAt: new Date().toISOString()
        });
      });

      await batch.commit();

      // Update local state
      setJobs(prev => prev.map(j => {
        if (j.mrNo === sendTargetMr) {
          const atInclusiveAmt = calculateJobTotal(j);
          const atPct = getAtPercentageForCore(atForJob(j, atMasters) ?? activeAtMaster, j.coreType);
          const cgstRate = activeAgency?.cgstPercent !== undefined ? activeAgency.cgstPercent : 9;
          const sgstRate = activeAgency?.sgstPercent !== undefined ? activeAgency.sgstPercent : 9;
          const totalJobTaxedAmt = Math.round(atInclusiveAmt * (1 + (cgstRate + sgstRate) / 100));
          return {
            ...j,
            billNo: sendBillNo.trim(),
            billRefNo: sendBillRefNo.trim(),
            billSentDate: sendBillDate,
            billAmount: totalJobTaxedAmt,
            billTotalMrAmount: grandTotal,
            billStatus: 'Sent',
            paymentStatus: j.paymentStatus || 'Unpaid',
            billRemarks: sendBillRemarks || '',
            // Mirrors the batch above, so the in-memory job matches what was written.
            issuedByAgencyId: activeAgency?.id || '',
            issuedByAgencyName: activeAgency?.name || '',
            issuedByAgencyGstin: activeAgency?.gstin || '',
          };
        }
        return j;
      }));

      setShowSendBillModal(false);
      setSavedSuccessMsg(`Bill ${sendBillNo} for MR ${sendTargetMr} successfully marked as Sent (Ref: ${sendBillRefNo})!`);
      setTimeout(() => setSavedSuccessMsg(''), 5000);
    } catch (err: any) {
      console.error('Error sending bill:', err);
      alert('Failed to save sent bill: ' + (err.message || err.toString()));
    } finally {
      setSubmittingSendBill(false);
    }
  };

  // Open Mark as Paid Modal
  const handleOpenPaidModal = (mr: string) => {
    setPaidTargetMr(mr);
    const groupJobs = mrGroups[mr] || [];
    const sample = groupJobs[0] || {};
    const { grandTotal } = calculateMrBillSummary(mr);

    setPaymentMode(sample.paymentMode || 'NEFT / RTGS');
    setPaymentRefNo(sample.paymentRefNo || `UTR/${new Date().getFullYear()}/${mr}`);
    setPaymentDate(sample.paymentDate || new Date().toISOString().split('T')[0]);
    setPaidAmount(sample.paidAmount || grandTotal);
    setPaymentDeductions(sample.paymentDeductions || '0');
    setPaymentBank(sample.paymentBank || '');
    setPaymentRemarks(sample.paymentRemarks || '');
    setShowPaidModal(true);
  };

  // Confirm Mark as Paid
  const handleConfirmPaid = async () => {
    if (!paidTargetMr || !paymentRefNo.trim() || !paymentDate || !auth.currentUser) {
      alert('Please fill Payment Reference / UTR No and Payment Date');
      return;
    }

    // A deduction is a PORTION WITHHELD from a payment - it can never equal or exceed
    // the payment itself. Nothing checked this, and MSBT-12 was recorded with
    // paidAmount, billTotalMrAmount and paymentDeductions all equal to 6,680 (AUDIT O5):
    // read literally, nothing was received. The two fields sit adjacent and identically
    // styled, with "Amount Received" pre-filled, so entering the same figure twice is an
    // easy slip.
    const paidNum = Number(paidAmount) || 0;
    const dedNum = Number(paymentDeductions) || 0;

    if (dedNum < 0 || paidNum < 0) {
      alert('⚠️ Amount Received and TDS / Deduction cannot be negative.');
      return;
    }

    if (paidNum > 0 && dedNum >= paidNum) {
      alert(
        `TDS / Deduction cannot be equal to or greater than the amount received.\n\n` +
        `Amount Received: Rs ${paidNum.toLocaleString('en-IN')}\n` +
        `TDS / Deduction: Rs ${dedNum.toLocaleString('en-IN')}\n\n` +
        `A deduction is the portion withheld from the payment, not the payment itself. ` +
        `If nothing was withheld, enter 0.`
      );
      return;
    }

    // WARN, don't block: a deduction that is a plausible TDS RATE of the gross is far
    // more likely than an arbitrary large figure. Suggesting the likely intent catches
    // a wrong figure that is still individually "valid", which the check above cannot.
    if (dedNum > 0 && paidNum > 0) {
      const grossGuess = paidNum + dedNum;   // if paidAmount is net of the deduction
      const ratePct = (dedNum / grossGuess) * 100;
      const COMMON_TDS = [1, 2, 5, 10];
      const looksLikeRate = COMMON_TDS.some(r => Math.abs(ratePct - r) < 0.15);
      if (!looksLikeRate && ratePct > 12) {
        const suggestions = COMMON_TDS
          .map(r => `${r}% = Rs ${Math.round(grossGuess * r / 100).toLocaleString('en-IN')}`)
          .join('\n  ');
        const proceed = window.confirm(
          `Rs ${dedNum.toLocaleString('en-IN')} is ${ratePct.toFixed(1)}% of the gross ` +
          `(Rs ${grossGuess.toLocaleString('en-IN')}) - unusually high for a TDS deduction.\n\n` +
          `At the usual rates that would be:\n  ${suggestions}\n\n` +
          `Check the figure against the payment advice. Record Rs ${dedNum.toLocaleString('en-IN')} anyway?`
        );
        if (!proceed) return;
      }
    }

    setSubmittingPaid(true);
    try {
      const groupJobs = mrGroups[paidTargetMr] || [];
      const batch = writeBatch(db);

      groupJobs.forEach(job => {
        const jobRef = doc(db, 'jobs', job.id);
        batch.update(jobRef, {
          paymentStatus: 'Paid',
          paymentMode: paymentMode,
          paymentRefNo: paymentRefNo.trim(),
          paymentDate: paymentDate,
          paidAmount: Number(paidAmount) || 0,
          paymentDeductions: Number(paymentDeductions) || 0,
          paymentBank: paymentBank.trim(),
          paymentRemarks: paymentRemarks.trim(),
          updatedAt: new Date().toISOString()
        });
      });

      await batch.commit();

      // Update local state
      setJobs(prev => prev.map(j => {
        if (j.mrNo === paidTargetMr) {
          return {
            ...j,
            paymentStatus: 'Paid',
            paymentMode: paymentMode,
            paymentRefNo: paymentRefNo.trim(),
            paymentDate: paymentDate,
            paidAmount: Number(paidAmount) || 0,
            paymentDeductions: Number(paymentDeductions) || 0,
            paymentBank: paymentBank.trim(),
            paymentRemarks: paymentRemarks.trim()
          };
        }
        return j;
      }));

      setShowPaidModal(false);
      setSavedSuccessMsg(`Payment recorded successfully for MR ${paidTargetMr} (Ref: ${paymentRefNo})!`);
      setTimeout(() => setSavedSuccessMsg(''), 5000);
    } catch (err: any) {
      console.error('Error saving payment:', err);
      alert('Failed to record payment: ' + (err.message || err.toString()));
    } finally {
      setSubmittingPaid(false);
    }
  };

  // Sent Bills List Memoized (All Sent Bills)
  const sentBillsList = useMemo(() => {
    const list: Array<{
      mrNo: string;
      mrDate: string;
      division: string;
      deliveredCount: number;
      totalCount: number;
      billNo: string;
      billRefNo: string;
      billSentDate: string;
      billAmount: number;
      isPaid: boolean;
      paymentMode?: string;
      paymentRefNo?: string;
      paymentDate?: string;
      paidAmount?: number;
      paymentDeductions?: number;
      paymentBank?: string;
      paymentRemarks?: string;
    }> = [];

    Object.keys(mrGroups).forEach(mr => {
      const groupJobs = mrGroups[mr] || [];
      const isSent = groupJobs.some(j => j.billSentDate || j.billStatus === 'Sent' || (j.billNo && j.billNo !== ''));
      if (isSent) {
        const sample = groupJobs[0] || {};
        const deliveredJobs = groupJobs.filter(j => j.status === 'Dispatched' && j.status !== 'Scrap' && j.condition !== 'Scrap');
        const isPaid = groupJobs.some(j => j.paymentStatus === 'Paid' || !!j.paymentRefNo);
        const { grandTotal } = calculateMrBillSummary(mr);

        list.push({
          mrNo: mr,
          mrDate: sample.dateOfIssue || sample.mrDate || '-',
          division: sample.division || 'SABARMATI',
          deliveredCount: deliveredJobs.length,
          totalCount: groupJobs.length,
          billNo: sample.billNo || `BILL/${mr}`,
          billRefNo: sample.billRefNo || `UGVCL/BILL/${mr}`,
          billSentDate: sample.billSentDate || '-',
          billAmount: grandTotal,
          isPaid,
          paymentMode: sample.paymentMode,
          paymentRefNo: sample.paymentRefNo,
          paymentDate: sample.paymentDate,
          paidAmount: Number(sample.paidAmount) || grandTotal,
          paymentDeductions: Number(sample.paymentDeductions) || 0,
          paymentBank: sample.paymentBank,
          paymentRemarks: sample.paymentRemarks
        });
      }
    });

    // Copy + undated-last. The old guard fell through to MR order whenever EITHER
    // side lacked a date, scattering undated rows through the list (AUDIT F17).
    return [...list].sort(byDateDesc(x => x.billSentDate, byNumericDesc(x => x.mrNo)));
  }, [mrGroups, activeAtMaster, activeAgency]);

  // Unpaid Sent Bills List (Awaiting Payment)
  const unpaidSentBills = useMemo(() => {
    return sentBillsList.filter(item => !item.isPaid);
  }, [sentBillsList]);

  // Paid Bills List (Payments Received)
  const paidBillsList = useMemo(() => {
    return sentBillsList
      .filter(item => item.isPaid)
      .sort(byDateDesc(x => x.paymentDate, byNumericDesc(x => x.mrNo)));
  }, [sentBillsList]);

  // Filtered Unpaid Sent Bills List (Stage 2: Sent Bills Awaiting Payment)
  const filteredUnpaidSentBills = useMemo(() => {
    return unpaidSentBills.filter(item => {
      const q = (sentSearchQuery || searchQuery).toLowerCase();
      const div = sentFilterDivision !== 'All' ? sentFilterDivision : selectedDivision;

      const matchesSearch = !q || 
        item.mrNo.toLowerCase().includes(q) ||
        item.billNo.toLowerCase().includes(q) ||
        item.billRefNo.toLowerCase().includes(q) ||
        item.division.toLowerCase().includes(q);
      
      const matchesDivision = div === 'All' || item.division === div;

      return matchesSearch && matchesDivision;
    });
  }, [unpaidSentBills, sentSearchQuery, searchQuery, sentFilterDivision, selectedDivision]);

  // Filtered Paid Bills List (Stage 3: Received Payments)
  const filteredPaidBills = useMemo(() => {
    return paidBillsList.filter(item => {
      const q = (paidSearchQuery || searchQuery).toLowerCase();
      const div = paidFilterDivision !== 'All' ? paidFilterDivision : selectedDivision;

      const matchesSearch = !q || 
        item.mrNo.toLowerCase().includes(q) ||
        item.billNo.toLowerCase().includes(q) ||
        item.billRefNo.toLowerCase().includes(q) ||
        (item.paymentRefNo && item.paymentRefNo.toLowerCase().includes(q)) ||
        (item.paymentBank && item.paymentBank.toLowerCase().includes(q)) ||
        item.division.toLowerCase().includes(q);
      
      const matchesDivision = div === 'All' || item.division === div;
      
      const matchesMode = paidFilterMode === 'All' || item.paymentMode === paidFilterMode;

      return matchesSearch && matchesDivision && matchesMode;
    });
  }, [paidBillsList, paidSearchQuery, searchQuery, paidFilterDivision, selectedDivision, paidFilterMode]);

  // Sent Bills Summary Stats
  const sentBillStats = useMemo(() => {
    const totalCount = sentBillsList.length;
    const totalValue = sentBillsList.reduce((sum, item) => sum + item.billAmount, 0);
    const paidCount = paidBillsList.length;
    const paidValue = paidBillsList.reduce((sum, item) => sum + (item.paidAmount || item.billAmount), 0);
    const totalDeductions = paidBillsList.reduce((sum, item) => sum + (item.paymentDeductions || 0), 0);
    const unpaidCount = unpaidSentBills.length;
    const unpaidValue = unpaidSentBills.reduce((sum, item) => sum + item.billAmount, 0);

    return {
      totalCount,
      totalValue,
      paidCount,
      paidValue,
      totalDeductions,
      unpaidCount,
      unpaidValue
    };
  }, [sentBillsList, paidBillsList, unpaidSentBills]);

  // Excel Export for Sent Bills
  const handleExportSentBillsExcel = () => {
    if (filteredUnpaidSentBills.length === 0) {
      alert('No sent bills to export matching current filters');
      return;
    }
    const data = filteredUnpaidSentBills.map((item, idx) => ({
      'Sr No': idx + 1,
      'MR No': item.mrNo,
      'MR Date': item.mrDate,
      'Division': item.division,
      'Delivered Jobs': item.deliveredCount,
      'Total Transformers': item.totalCount,
      'Bill No': item.billNo,
      'Dispatch Ref No': item.billRefNo,
      'Bill Sent Date': item.billSentDate,
      'Invoiced Amount (INR)': item.billAmount,
      'Status': 'Awaiting Payment',
      'Remarks': item.paymentRemarks || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sent_Bills');
    XLSX.writeFile(wb, `Sent_Bills_Register_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Excel Export for Received Payments
  const handleExportPaidBillsExcel = () => {
    if (filteredPaidBills.length === 0) {
      alert('No payment records to export matching current filters');
      return;
    }
    const data = filteredPaidBills.map((item, idx) => ({
      'Sr No': idx + 1,
      'MR No': item.mrNo,
      'MR Date': item.mrDate,
      'Division': item.division,
      'Bill No': item.billNo,
      'Dispatch Ref No': item.billRefNo,
      'Bill Sent Date': item.billSentDate,
      'Billed Amount (INR)': item.billAmount,
      'Payment Mode': item.paymentMode || 'NEFT / RTGS',
      'Payment Ref / UTR No': item.paymentRefNo || '',
      'Payment Date': item.paymentDate || '',
      'Realized Amount (INR)': item.paidAmount || item.billAmount,
      'TDS / Deductions (INR)': item.paymentDeductions || 0,
      'Bank': item.paymentBank || '',
      'Remarks': item.paymentRemarks || '',
      'Status': 'Paid & Settled'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Received_Payments');
    XLSX.writeFile(wb, `Received_Payments_Register_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    // ON-SCREEN width only. The print variants on this same element remove the max-width
    // entirely when printing, and PrintableA4Page pins each sheet to 210mm / 297mm in its
    // own inline style - so this class cannot reach an A4 document. Widening it changes the
    // MR list and nothing that goes to UGVCL.
    <div className="max-w-[1400px] mx-auto print:max-w-none print:w-full print:m-0 print:p-0">
      
      {!selectedMrNo ? (
        <div className="space-y-6 print:hidden">
          {/* Header Banner, Universal Filters & Stage Navigation Tabs */}
          <div className="bg-white p-4 sm:p-5 rounded-xl shadow-xs border border-slate-200 space-y-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h1 className="text-base sm:text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
                  <IndianRupee className="w-5 h-5 text-blue-600 shrink-0" />
                  <span>Billing & Payment Lifecycle</span>
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Stage 1: Generate & Send Bill &rarr; Stage 2: Sent Awaiting Payment &rarr; Stage 3: Paid & Settled
                </p>
              </div>

              {/* Universal Filters (Applies across all 3 tabs) */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full md:w-auto">
                <div className="relative flex-1 sm:w-60">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search MR, Bill, UTR, Ref..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full bg-white outline-none"
                  />
                </div>

                <div className="w-full sm:w-44">
                  <select
                    value={selectedDivision}
                    onChange={(e) => setSelectedDivision(e.target.value)}
                    className="py-2 px-3 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full bg-white text-slate-700 font-medium outline-none cursor-pointer"
                  >
                    <option value="All">All Divisions</option>
                    {divisions.map(div => (
                      <option key={div} value={div}>{div} Division</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Stage Tabs (Positioned BELOW the Universal Filters) */}
            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setActiveTab('generator')}
                className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
                  activeTab === 'generator'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>1. Bill Generator</span>
                <span className={`ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-black ${
                  activeTab === 'generator' ? 'bg-blue-800 text-blue-100' : 'bg-slate-200 text-slate-700'
                }`}>
                  {unsentBillCount} Unsent
                </span>
              </button>

              <button
                onClick={() => setActiveTab('sent')}
                className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
                  activeTab === 'sent'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                }`}
              >
                <Send className="w-3.5 h-3.5" />
                <span>2. Sent Bills</span>
                {sentBillStats.unpaidCount > 0 && (
                  <span className={`ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-black ${
                    activeTab === 'sent' ? 'bg-amber-800 text-amber-100' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {sentBillStats.unpaidCount} Awaiting Payment
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('payments')}
                className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
                  activeTab === 'payments'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                }`}
              >
                <Banknote className="w-3.5 h-3.5" />
                <span>3. Received Payments</span>
                {sentBillStats.paidCount > 0 && (
                  <span className={`ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-black ${
                    activeTab === 'payments' ? 'bg-emerald-800 text-emerald-100' : 'bg-emerald-100 text-emerald-800'
                  }`}>
                    {sentBillStats.paidCount} Paid
                  </span>
                )}
              </button>
            </div>

            {/* Notification message */}
            {savedSuccessMsg && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{savedSuccessMsg}</span>
              </div>
            )}
          </div>

          {activeTab === 'generator' ? (
            /* TAB 1: BILL GENERATOR */
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl w-full sm:w-auto">
                  <button
                    onClick={() => setBillTypeFilter('repairable')}
                    className={`flex-1 sm:flex-none px-3.5 py-2 rounded-lg text-xs font-bold uppercase transition-all ${
                      billTypeFilter === 'repairable' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Repairable Delivered
                  </button>
                  <button
                    onClick={() => setBillTypeFilter('scrap')}
                    className={`flex-1 sm:flex-none px-3.5 py-2 rounded-lg text-xs font-bold uppercase transition-all ${
                      billTypeFilter === 'scrap' ? 'bg-white text-red-600 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Scrap Delivered
                  </button>
                </div>
              </div>

              {/* Explanation Banner for Pending Delivery */}
              <div className="p-3.5 sm:p-4 bg-blue-50/90 border border-blue-200 rounded-xl text-blue-950 text-xs flex items-start gap-3 shadow-xs">
                <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-xs sm:text-sm text-blue-900">💡 Why do jobs show as "Pending" in Billing System?</p>
                  <p className="text-blue-800 leading-relaxed text-[11px] sm:text-xs">
                    Tax Invoices & Bills are <strong>ONLY</strong> generated for transformers that have been <strong>delivered/dispatched</strong> back to the division via a <strong>Delivery Challan</strong> (Status: <span className="font-bold text-emerald-800 bg-emerald-100 px-1 rounded">Dispatched</span>).
                    If a job has finished Inspection & Testing, dispatch it in the <strong>Delivery Challan</strong> tab first before generating its bill.
                  </p>
                </div>
              </div>

              {/* Delivered MR Table */}
              <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
                <div className="p-3.5 sm:p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                    <div>
                      <h2 className="text-xs sm:text-sm font-bold text-slate-700 uppercase tracking-wider">
                        Stage 1: Delivered MRs for Bill Generation ({filteredMrNos.length})
                      </h2>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Delivered jobs ready for official invoice creation. Once sent, items automatically advance to Stage 2.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Delivered MR Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm min-w-[680px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">MR No</th>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Division</th>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Delivered Jobs</th>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Challan Info</th>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Stage</th>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Bill & Payment Status</th>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px] text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredMrNos.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-12 text-center text-slate-500 text-xs sm:text-sm">
                            No delivered jobs found for this filter. Please dispatch jobs from <strong>Delivery Challans</strong> first.
                          </td>
                        </tr>
                      ) : (
                        filteredMrNos.map(mr => {
                          const groupJobs = mrGroups[mr] || [];
                          // GP jobs carry no charge and are excluded from every count
                          // below - but the count is SHOWN so the operator can see the
                          // numbers reconcile rather than silently not adding up.
                          // All four stages here: a bill DOES depend on dispatch, unlike an
                          // estimate. GP jobs are included - they are excluded from money,
                          // not from workflow - and scrap is excluded from the testing
                          // denominator only, per mrStageSummary.
                          const stages = mrStageSummary(groupJobs, inspections);
                          const gpJobs = groupJobs.filter(j => isGpJob(j));
                          const billableJobs = groupJobs.filter(j => !isGpJob(j));
                          const scrapJobs = billableJobs.filter(j => j.status === 'Scrap' || j.condition === 'Scrap');
                          const repairableJobs = billableJobs.filter(j => j.status !== 'Scrap' && j.condition !== 'Scrap');

                          const matchingJobs = billableJobs.filter(j => {
                            const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
                            return billTypeFilter === 'scrap' ? isScrap : !isScrap;
                          });
                          const deliveredJobs = matchingJobs.filter(j => j.status === 'Dispatched');
                          const pendingJobs = matchingJobs.filter(j => j.status !== 'Dispatched');

                          const deliveredScrap = scrapJobs.filter(j => j.status === 'Dispatched');
                          const allGroupDelivered = billableJobs.every(j => j.status === 'Dispatched');

                          const divName = groupJobs[0]?.division || '-';
                          const challans = Array.from(new Set(deliveredJobs.map(j => j.challanNo).filter(Boolean))).join(', ');
                          const dates = Array.from(new Set(deliveredJobs.map(j => j.deliveryDate || j.challanDate).filter(Boolean))).join(', ');

                          const isBillSent = groupJobs.some(j => j.billSentDate || j.billStatus === 'Sent');
                          const isPaid = groupJobs.some(j => j.paymentStatus === 'Paid');
                          const sampleJob = groupJobs[0] || {};

                          return (
                            <tr key={mr} className="hover:bg-slate-50/80 border-b border-slate-100">
                              <td className="px-4 py-3 font-mono font-bold text-blue-600 align-top text-xs sm:text-sm">{mr}</td>
                              <td className="px-4 py-3 font-medium text-slate-700 align-top text-xs sm:text-sm">{divName}</td>
                              <td className="px-4 py-3 font-semibold text-slate-700 align-top text-xs">
                                <div>
                                  <span className="font-bold text-slate-900">{deliveredJobs.length}</span> of {matchingJobs.length} {billTypeFilter === 'scrap' ? 'Scrap' : 'Repairable'} Delivered
                                </div>
                                {scrapJobs.length > 0 && billTypeFilter === 'repairable' && (
                                  <div className="text-[11px] text-rose-700 font-semibold mt-0.5">
                                    ({deliveredScrap.length} of {scrapJobs.length} Scrap Returned - No Repair Bill)
                                  </div>
                                )}
                                {gpJobs.length > 0 && (
                                  <div
                                    className={`text-[11px] font-semibold mt-0.5 ${GP_TEXT_CLASS}`}
                                    title="GP repairs are done under guarantee at no cost and are excluded from every bill"
                                  >
                                    {gpJobs.length} of {groupJobs.length} jobs are GP - not billable
                                  </div>
                                )}
                                {/* Detailed stage breakdown, collapsed by default - the
                                    summary above already tells the story, and one line
                                    per job made a large MR fill the screen. */}
                                {groupJobs.length > 0 && (() => {
                                  const isExpanded = expandedMrJobs.has(mr);

                                  // Dispatched first, then Tested, then Scrap, so the
                                  // outstanding ones sit together. Remaining stages keep
                                  // their existing relative order after those.
                                  const statusRank = (j: any) => {
                                    if (j.status === 'Dispatched') return 0;
                                    if (j.status === 'Tested - Ready for Dispatch') return 1;
                                    if (j.status === 'Scrap' || j.condition === 'Scrap') return 2;
                                    return 3;
                                  };
                                  const orderedJobs = isExpanded
                                    ? [...groupJobs].sort((a, b) => statusRank(a) - statusRank(b))
                                    : [];

                                  return (
                                    <div className="mt-2">
                                      <button
                                        type="button"
                                        onClick={() => toggleMrJobs(mr)}
                                        className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 hover:text-slate-900 transition-colors"
                                        aria-expanded={isExpanded}
                                      >
                                        {isExpanded
                                          ? <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                                          : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                                        <span>{isExpanded ? 'Hide jobs' : `Show ${groupJobs.length} job${groupJobs.length > 1 ? 's' : ''}`}</span>
                                      </button>

                                      {isExpanded && (
                                        <div className="mt-1.5 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-x-3 gap-y-1">
                                          {orderedJobs.map(j => {
                                            let badgeText = 'Received';
                                            let badgeClass = 'bg-slate-100 text-slate-700 border-slate-200';
                                            if (j.status === 'Dispatched') {
                                              badgeText = 'Dispatched (Delivered)';
                                              badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
                                            } else if (j.status === 'Tested - Ready for Dispatch') {
                                              badgeText = 'Tested (Awaiting Delivery Challan)';
                                              badgeClass = 'bg-blue-100 text-blue-800 border-blue-300';
                                            } else if (j.status === 'Scrap' || j.condition === 'Scrap') {
                                              badgeText = 'Scrap (Awaiting Return)';
                                              badgeClass = 'bg-rose-100 text-rose-800 border-rose-300';
                                            } else if (j.status === 'Internal Done') {
                                              badgeText = 'Internal Done (Pending Testing)';
                                              badgeClass = 'bg-amber-100 text-amber-800 border-amber-300';
                                            } else if (j.status === 'External Done') {
                                              badgeText = 'External Done (Pending Internal)';
                                              badgeClass = 'bg-amber-100 text-amber-800 border-amber-300';
                                            } else {
                                              badgeText = 'Received (Pending External)';
                                              badgeClass = 'bg-slate-100 text-slate-800 border-slate-300';
                                            }

                                            return (
                                              <div key={j.id} className="flex items-center gap-1.5 text-[11px] min-w-0">
                                                <span className={`font-mono font-bold shrink-0 flex items-center gap-1 ${isGpJob(j) ? GP_TEXT_CLASS : 'text-slate-800'}`}>
                                                  {j.jobNo}:
                                                  {isGpJob(j) && <GpChip />}
                                                </span>
                                                <span
                                                  className={`px-1.5 py-0.2 rounded text-[10px] font-semibold border truncate ${badgeClass}`}
                                                  title={badgeText}
                                                >
                                                  {badgeText}
                                                </span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </td>
                              <td className="px-4 py-3 text-xs text-slate-500 align-top">
                                <div><span className="font-bold text-slate-700">Challan:</span> {challans || (deliveredJobs.length > 0 ? 'Dispatched' : 'None')}</div>
                                <div><span className="font-bold text-slate-700">Date:</span> {dates || '-'}</div>
                              </td>
                              <td className="px-4 py-3 align-top">
                                <div className="space-y-0.5">
                                  <StageCell label="External" state={stages.external} />
                                  <StageCell label="Internal" state={stages.internal} />
                                  <StageCell label="Testing" state={stages.testing} />
                                  <StageCell label="Dispatch" state={stages.dispatch} notDoneLabel="not dispatched" />
                                </div>
                              </td>
                              <td className="px-4 py-3 align-top">
                                <div className="space-y-1.5">
                                  {isPaid ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                      <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600 shrink-0" />
                                      Paid
                                    </span>
                                  ) : isBillSent ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-300">
                                      <Send className="w-3 h-3 mr-1 text-blue-600 shrink-0" />
                                      Bill Sent (Ref: {sampleJob.billRefNo || 'Saved'})
                                    </span>
                                  ) : allGroupDelivered ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                      <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600 shrink-0" />
                                      Ready to Bill
                                    </span>
                                  ) : pendingJobs.length > 0 ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-300">
                                      <AlertTriangle className="w-3.5 h-3.5 mr-1 text-amber-600 shrink-0" />
                                      {deliveredJobs.length > 0 ? `${pendingJobs.length} Pending Delivery` : 'Pending Dispatch'}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      <CheckCircle2 className="w-3 h-3 mr-1 shrink-0" />
                                      Ready
                                    </span>
                                  )}

                                  {sampleJob.billSentDate && (
                                    <div className="text-[10px] text-slate-500">
                                      Sent: <span className="font-semibold text-slate-700">{formatDDMMYYYY(sampleJob.billSentDate)}</span>
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 align-top text-right">
                                <div className="flex flex-col sm:flex-row items-end sm:items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => handleGenerateClick(mr)}
                                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white rounded-lg transition-colors shadow-xs ${
                                      pendingJobs.length > 0 ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
                                    }`}
                                  >
                                    View / Bill
                                  </button>
                                  <button
                                    onClick={() => handleOpenSendBillModal(mr)}
                                    className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-slate-800 hover:bg-slate-900 text-white rounded-lg transition-colors shadow-xs flex items-center gap-1"
                                    title="Send Bill with Reference No & Date"
                                  >
                                    <Send className="w-3 h-3" />
                                    <span>{isBillSent ? 'Update Sent' : 'Send Bill'}</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : activeTab === 'sent' ? (
            /* TAB 2: SENT BILLS (AWAITING PAYMENT) */
            <div className="space-y-6">
              {/* KPI Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 sm:gap-4">
                <div className="bg-white p-4 rounded-xl border border-amber-200 bg-amber-50/30 shadow-xs">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Sent Bills Awaiting Payment</p>
                  <p className="text-xl sm:text-2xl font-bold text-amber-700 mt-1">{sentBillStats.unpaidCount}</p>
                  <p className="text-[11px] text-amber-600 mt-0.5">Bills Pending Realization</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Pending Invoiced Value</p>
                  <p className="text-xl sm:text-2xl font-bold text-blue-600 mt-1">₹{sentBillStats.unpaidValue.toLocaleString('en-IN')}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Awaiting Disbursal</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Sent Invoices</p>
                  <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">{sentBillStats.totalCount}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Lifetime Sent</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 shadow-xs">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Realized Collections</p>
                  <p className="text-xl sm:text-2xl font-bold text-emerald-700 mt-1">₹{sentBillStats.paidValue.toLocaleString('en-IN')}</p>
                  <p className="text-[11px] text-emerald-600 mt-0.5">{sentBillStats.paidCount} Bills Realized</p>
                </div>
              </div>

              {/* Sent Bills Register Table Card */}
              <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
                <div className="p-3.5 sm:p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Send className="w-4 h-4 text-amber-600 shrink-0" />
                    <div>
                      <h2 className="text-xs sm:text-sm font-bold text-slate-700 uppercase tracking-wider">
                        Stage 2: Sent Invoices Register (Awaiting Payment) ({filteredUnpaidSentBills.length})
                      </h2>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Invoices dispatched to division. Click "Mark as Paid" when payment credit is received to advance to Stage 3.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <button
                      onClick={handleExportSentBillsExcel}
                      className="px-3 py-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors shadow-xs flex items-center justify-center gap-1.5 shrink-0"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Export Excel</span>
                    </button>
                  </div>
                </div>

                {/* Sent Bills Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm min-w-[760px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">MR & Division</th>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Bill No & Dispatch Ref</th>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Sent Date</th>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Invoiced Grand Total</th>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Status</th>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px] text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredUnpaidSentBills.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-12 text-center text-slate-500 text-xs sm:text-sm">
                            {unpaidSentBills.length === 0 ? (
                              <div>
                                <p className="font-semibold text-slate-700">All sent bills have been marked as paid!</p>
                                <p className="text-xs text-slate-400 mt-1">To record newly dispatched bills, use "Send Bill" in the Bill Generator tab.</p>
                              </div>
                            ) : (
                              <p>No sent bills found matching the selected search criteria.</p>
                            )}
                          </td>
                        </tr>
                      ) : (
                        filteredUnpaidSentBills.map(item => (
                          <tr key={item.mrNo} className="hover:bg-slate-50/80 border-b border-slate-100">
                            <td className="px-4 py-3 align-top">
                              <div className="font-mono font-bold text-blue-600 text-xs sm:text-sm">{item.mrNo}</div>
                              <div className="text-xs font-semibold text-slate-700">{item.division}</div>
                              <div className="text-[10px] text-slate-500">{item.deliveredCount} / {item.totalCount} Delivered</div>
                            </td>
                            <td className="px-4 py-3 align-top text-xs">
                              <div className="font-bold text-slate-800">{item.billNo}</div>
                              <div className="text-[11px] text-slate-500 font-mono mt-0.5">Ref: {item.billRefNo}</div>
                              {item.paymentRemarks && (
                                <div className="text-[10px] text-slate-400 italic mt-0.5">{item.paymentRemarks}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 align-top text-xs font-medium text-slate-700">
                              {formatDDMMYYYY(item.billSentDate)}
                            </td>
                            <td className="px-4 py-3 align-top">
                              <span className="font-bold text-slate-900 text-sm">
                                ₹{item.billAmount.toLocaleString('en-IN')}
                              </span>
                            </td>
                            <td className="px-4 py-3 align-top">
                              <span className="inline-flex items-center px-2.5 py-1 rounded text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                                <Clock className="w-3.5 h-3.5 mr-1 text-amber-600 shrink-0" />
                                Pending Payment
                              </span>
                            </td>
                            <td className="px-4 py-3 align-top text-right">
                              <div className="flex flex-col sm:flex-row items-end sm:items-center justify-end gap-1.5">
                                <button
                                  onClick={() => handleOpenPaidModal(item.mrNo)}
                                  className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors shadow-xs flex items-center gap-1"
                                  title="Record received payment with UTR / Cheque No and Date"
                                >
                                  <CheckSquare className="w-3 h-3" />
                                  <span>Mark as Paid</span>
                                </button>
                                <button
                                  onClick={() => handleOpenSendBillModal(item.mrNo)}
                                  className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-slate-700 hover:bg-slate-800 text-white rounded-lg transition-colors shadow-xs flex items-center gap-1"
                                  title="Edit sent reference number or date"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  <span>Edit Ref</span>
                                </button>
                                <button
                                  onClick={() => handleSelectMr(item.mrNo)}
                                  className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-xs flex items-center gap-1"
                                  title="View and print invoice"
                                >
                                  <Eye className="w-3 h-3" />
                                  <span>View Bill</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            /* TAB 3: RECEIVED PAYMENTS */
            <div className="space-y-6">
              {/* KPI Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 sm:gap-4">
                <div className="bg-white p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 shadow-xs">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">Total Realized Collections</p>
                  <p className="text-xl sm:text-2xl font-bold text-emerald-700 mt-1">₹{sentBillStats.paidValue.toLocaleString('en-IN')}</p>
                  <p className="text-[11px] text-emerald-600 mt-0.5">{sentBillStats.paidCount} Invoices Fully Settled</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Deductions / TDS</p>
                  <p className="text-xl sm:text-2xl font-bold text-amber-700 mt-1">₹{sentBillStats.totalDeductions.toLocaleString('en-IN')}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">TDS / SD Withheld</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Settled Bills Count</p>
                  <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">{sentBillStats.paidCount}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Paid MRs</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-amber-200 bg-amber-50/30 shadow-xs">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Pending Payments</p>
                  <p className="text-xl sm:text-2xl font-bold text-amber-700 mt-1">₹{sentBillStats.unpaidValue.toLocaleString('en-IN')}</p>
                  <p className="text-[11px] text-amber-600 mt-0.5">{sentBillStats.unpaidCount} Bills Pending</p>
                </div>
              </div>

              {/* Received Payments Register Table Card */}
              <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
                <div className="p-3.5 sm:p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Banknote className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div>
                      <h2 className="text-xs sm:text-sm font-bold text-slate-700 uppercase tracking-wider">
                        Stage 3: Received Payments Register ({filteredPaidBills.length})
                      </h2>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Bank transaction records, UTR details and realized payment values.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    {/* Payment Mode Filter */}
                    <div className="w-36">
                      <select
                        value={paidFilterMode}
                        onChange={(e) => setPaidFilterMode(e.target.value)}
                        className="py-1.5 px-2.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 w-full bg-white text-slate-700 font-medium outline-none cursor-pointer"
                      >
                        <option value="All">All Modes</option>
                        <option value="NEFT / RTGS">NEFT / RTGS</option>
                        <option value="Cheque / DD">Cheque / DD</option>
                        <option value="Direct Credit">Direct Credit</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>

                    {/* Export Excel Button */}
                    <button
                      onClick={handleExportPaidBillsExcel}
                      className="px-3 py-1.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg transition-colors shadow-xs flex items-center justify-center gap-1.5 shrink-0"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Export Excel</span>
                    </button>
                  </div>
                </div>

                {/* Received Payments Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm min-w-[820px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Payment Details & UTR</th>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">MR & Division</th>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Bill No & Sent Date</th>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Realized Amount</th>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Deductions / Bank</th>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Status</th>
                        <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px] text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredPaidBills.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-12 text-center text-slate-500 text-xs sm:text-sm">
                            {paidBillsList.length === 0 ? (
                              <div>
                                <p className="font-semibold text-slate-700">No payment receipts recorded yet.</p>
                                <p className="text-xs text-slate-400 mt-1">Go to "Sent Bills" tab and click "Mark as Paid" on any sent invoice to record incoming payment.</p>
                              </div>
                            ) : (
                              <p>No payment records found matching the selected search criteria.</p>
                            )}
                          </td>
                        </tr>
                      ) : (
                        filteredPaidBills.map(item => (
                          <tr key={item.mrNo} className="hover:bg-slate-50/80 border-b border-slate-100">
                            <td className="px-4 py-3 align-top text-xs">
                              <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded font-semibold text-[10px]">
                                  {item.paymentMode || 'NEFT'}
                                </span>
                                <span className="font-mono text-emerald-700 font-bold">{item.paymentRefNo}</span>
                              </div>
                              <div className="text-[11px] text-slate-500 mt-1">
                                Payment Date: <span className="font-medium text-slate-700">{formatDDMMYYYY(item.paymentDate)}</span>
                              </div>
                              {item.paymentRemarks && (
                                <div className="text-[10px] text-slate-400 italic mt-0.5">{item.paymentRemarks}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 align-top">
                              <div className="font-mono font-bold text-blue-600 text-xs sm:text-sm">{item.mrNo}</div>
                              <div className="text-xs font-semibold text-slate-700">{item.division}</div>
                              <div className="text-[10px] text-slate-500">{item.deliveredCount} Delivered Jobs</div>
                            </td>
                            <td className="px-4 py-3 align-top text-xs">
                              <div className="font-bold text-slate-800">{item.billNo}</div>
                              <div className="text-[11px] text-slate-500 font-mono mt-0.5">Ref: {item.billRefNo}</div>
                              <div className="text-[10px] text-slate-400 mt-0.5">Sent: {formatDDMMYYYY(item.billSentDate)}</div>
                            </td>
                            <td className="px-4 py-3 align-top">
                              <div className="font-bold text-emerald-700 text-sm">
                                ₹{(item.paidAmount || item.billAmount).toLocaleString('en-IN')}
                              </div>
                              {item.billAmount !== item.paidAmount && (
                                <div className="text-[10px] text-slate-400">
                                  Billed: ₹{item.billAmount.toLocaleString('en-IN')}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 align-top text-xs">
                              {Number(item.paymentDeductions) > 0 ? (
                                <div className="font-semibold text-amber-700">
                                  TDS/Ded: ₹{Number(item.paymentDeductions).toLocaleString('en-IN')}
                                </div>
                              ) : (
                                <div className="text-slate-400 text-[11px]">No Deductions</div>
                              )}
                              {item.paymentBank && (
                                <div className="text-[11px] text-slate-600 font-medium mt-0.5">Bank: {item.paymentBank}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 align-top">
                              <span className="inline-flex items-center px-2.5 py-1 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600 shrink-0" />
                                Paid & Settled
                              </span>
                            </td>
                            <td className="px-4 py-3 align-top text-right">
                              <div className="flex flex-col sm:flex-row items-end sm:items-center justify-end gap-1.5">
                                <button
                                  onClick={() => handleOpenPaidModal(item.mrNo)}
                                  className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-slate-700 hover:bg-slate-800 text-white rounded-lg transition-colors shadow-xs flex items-center gap-1"
                                  title="Edit payment transaction details"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  <span>Edit Payment</span>
                                </button>
                                <button
                                  onClick={() => handleSelectMr(item.mrNo)}
                                  className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-xs flex items-center gap-1"
                                  title="View and print tax invoice"
                                >
                                  <Eye className="w-3 h-3" />
                                  <span>View Bill</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          <SetupGapDialog gap={setupGap} onCancel={() => setSetupGap(null)} />

          {/* Pending Delivery Alert Modal */}
          {pendingAlertModal && pendingAlertModal.isOpen && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="bg-amber-500 p-4 text-white flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-6 h-6" />
                    <h3 className="font-bold text-base md:text-lg">
                      {pendingAlertModal.billType === 'scrap' ? 'Scrap Return Pending' : 'Delivery Pending Alert'}: MR {pendingAlertModal.mrNo}
                    </h3>
                  </div>
                  <button onClick={() => setPendingAlertModal(null)} className="text-amber-100 hover:text-white p-1 rounded">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-6 space-y-4">
                  {pendingAlertModal.billType === 'scrap' ? (
                    <>
                      {pendingAlertModal.deliveredCount === 0 ? (
                        /* Nothing returned yet means nothing to bill - warn-don't-block
                           applies when SOME are delivered, not when none are. */
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-slate-700 text-sm">
                          <p className="font-bold text-slate-900 text-base mb-1">
                            No scrap transformers have been returned yet
                          </p>
                          <p className="leading-relaxed text-xs md:text-sm">
                            None of the <strong>{pendingAlertModal.totalCount}</strong> scrap transformer(s) under MR <strong>{pendingAlertModal.mrNo}</strong> have been returned to the division on a delivery challan, so there is nothing to bill. Raise this bill once the scrap committee has visited and the units have been returned.
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-900 text-sm">
                            <p className="font-bold text-amber-950 text-base mb-1">
                              ⚠️ {pendingAlertModal.pendingCount} of {pendingAlertModal.totalCount} scrap transformers have not yet been returned to the division.
                            </p>
                            <p className="text-amber-800 leading-relaxed text-xs md:text-sm">
                              Confirm the scrap committee has completed its visit before sending this bill.
                            </p>
                          </div>

                          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-600 space-y-1">
                            <p className="font-bold text-slate-700">Scrap billing is separate:</p>
                            <p>
                              Scrap transformers return to the division only after the scrap committee has visited, on a different timeline from repaired units. This is a separate bill from the repair bill for MR <strong>{pendingAlertModal.mrNo}</strong>, with its own bill number and date. You may proceed with the <strong>{pendingAlertModal.deliveredCount}</strong> returned transformer(s).
                            </p>
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-900 text-sm">
                        <p className="font-bold text-amber-950 text-base mb-1">
                          ⚠️ {pendingAlertModal.pendingCount} Transformer(s) Pending Delivery for MR {pendingAlertModal.mrNo}
                        </p>
                        <p className="text-amber-800 leading-relaxed text-xs md:text-sm">
                          Out of total <strong>{pendingAlertModal.totalCount}</strong> repairable transformer(s) under MR <strong>{pendingAlertModal.mrNo}</strong>, only <strong>{pendingAlertModal.deliveredCount}</strong> transformer(s) have been delivered/dispatched, while <strong>{pendingAlertModal.pendingCount}</strong> transformer(s) are still pending delivery.
                        </p>
                      </div>

                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-600 space-y-1">
                        <p className="font-bold text-slate-700">Official MR-Wise Billing Rule:</p>
                        <p>
                          Agencies prepare bills <strong>ONE TIME MR-wise</strong> after all repairable transformers in the MR are delivered. Generating a bill now will only include the {pendingAlertModal.deliveredCount} delivered transformer(s).
                        </p>
                      </div>
                    </>
                  )}

                  <div className="flex flex-col sm:flex-row justify-end gap-2 pt-2 border-t border-slate-100">
                    <button
                      onClick={() => setPendingAlertModal(null)}
                      className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors border border-slate-300"
                    >
                      {pendingAlertModal.billType === 'scrap' && pendingAlertModal.deliveredCount === 0
                        ? 'Close'
                        : pendingAlertModal.billType === 'scrap' ? 'Wait for Scrap Committee' : 'Wait for Remaining Deliveries'}
                    </button>
                    {/* Scrap with nothing returned has nothing billable, so no Proceed is
                        offered. A repairable bill still covers its undelivered jobs, so
                        its Proceed stays exactly as before. */}
                    {!(pendingAlertModal.billType === 'scrap' && pendingAlertModal.deliveredCount === 0) && (
                      <button
                        onClick={() => {
                          const targetMr = pendingAlertModal.mrNo;
                          setPendingAlertModal(null);
                          handleSelectMr(targetMr);
                        }}
                        className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors shadow"
                      >
                        Proceed with Partial Bill ({pendingAlertModal.deliveredCount} Jobs)
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      ) : (
        /* Bill Documents Editor & Multi-Page View */
        <div className="space-y-6 print:space-y-0">
          
          {/* Top Control Bar */}
          <div className="bg-slate-900 border border-slate-800 p-4 sm:p-5 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-white print:hidden shadow-sm">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">MR BILL GENERATOR</p>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-500/20 text-blue-300 rounded uppercase border border-blue-500/30">
                  {billTypeFilter === 'scrap' ? 'Scrap Delivered Bill' : 'Repairable Bill'}
                </span>
                {selectedJobsData.some(j => j.paymentStatus === 'Paid') ? (
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/30 text-emerald-300 rounded uppercase border border-emerald-500/40 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Paid
                  </span>
                ) : selectedJobsData.some(j => j.billSentDate || j.billStatus === 'Sent') ? (
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-500/30 text-amber-300 rounded uppercase border border-amber-500/40 flex items-center gap-1">
                    <Send className="w-3 h-3" /> Bill Sent
                  </span>
                ) : null}
              </div>
              <p className="text-lg sm:text-xl font-mono font-bold text-white mt-1">MR No: {selectedMrNo}</p>
              <p className="text-xs text-slate-300 mt-0.5">
                Division: <span className="font-semibold text-white">{currentDivision}</span> • {selectedJobsData.length} Delivered Transformers
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <button
                onClick={() => handleOpenSendBillModal(selectedMrNo)}
                className="flex-1 sm:flex-none flex items-center justify-center text-xs font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2 rounded-lg transition-colors shadow-xs"
                title="Send Bill with Reference No & Date"
              >
                <Send className="w-4 h-4 mr-1.5 shrink-0" /> Send Bill
              </button>

              <button
                onClick={() => handleOpenPaidModal(selectedMrNo)}
                className="flex-1 sm:flex-none flex items-center justify-center text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-lg transition-colors shadow-xs"
                title="Record payment details for this MR Bill"
              >
                <Banknote className="w-4 h-4 mr-1.5 shrink-0" /> {selectedJobsData.some(j => j.paymentStatus === 'Paid') ? 'Edit Payment' : 'Mark Paid'}
              </button>

              <button
                onClick={handleSaveBillDates}
                disabled={savingBillDates}
                className="flex-1 sm:flex-none flex items-center justify-center text-xs font-bold uppercase tracking-wider bg-purple-600 hover:bg-purple-700 text-white px-3.5 py-2 rounded-lg transition-colors shadow-xs disabled:opacity-50"
                title="Save Bill No & Bill Date to all delivered jobs in this MR"
              >
                {savingBillDates ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin shrink-0" /> Saving...
                  </>
                ) : (
                  <>
                    <Calendar className="w-4 h-4 mr-1.5 shrink-0" /> Save Bill Date
                  </>
                )}
              </button>
              <button
                onClick={() => setShowEditLetterModal(true)}
                className="flex-1 sm:flex-none flex items-center justify-center text-xs font-bold uppercase tracking-wider bg-amber-600 hover:bg-amber-700 text-white px-3 py-2 rounded-lg transition-colors shadow-xs"
              >
                <Edit3 className="w-4 h-4 mr-1.5 shrink-0" /> Customize
              </button>
              <button
                onClick={() => {
                  const el = document.getElementById('printable-billing-container');
                  if (el) downloadHtmlAsWord(el, `Billing_Package_${selectedMrNo}.doc`, `Tax Invoice & Letter Documents - MR ${selectedMrNo}`);
                }}
                className="flex-1 sm:flex-none flex items-center justify-center text-xs font-bold uppercase tracking-wider bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg transition-colors shadow-xs"
              >
                <FileText className="w-4 h-4 mr-1.5 shrink-0" /> Word (.doc)
              </button>
              <button
                onClick={handlePrint}
                className="flex-1 sm:flex-none flex items-center justify-center text-xs font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-3.5 py-2 rounded-lg transition-colors shadow-xs cursor-pointer"
                title="Print documents or open print dialog"
              >
                <Printer className="w-4 h-4 mr-1.5 shrink-0" /> Print
              </button>
              <button
                onClick={handleExportExcel}
                className="flex-1 sm:flex-none flex items-center justify-center text-xs font-bold uppercase tracking-wider bg-emerald-700 hover:bg-emerald-800 text-white px-3 py-2 rounded-lg transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-4 h-4 mr-1.5 shrink-0" /> Excel
              </button>
              <button
                onClick={() => {
                  setSelectedMrNo(null);
                  if (searchParams.has('mr') || searchParams.has('mrNo')) {
                    searchParams.delete('mr');
                    searchParams.delete('mrNo');
                    setSearchParams(searchParams);
                  }
                  if (params.mrNo) {
                    navigate('/bills', { replace: true });
                  }
                }}
                className="flex-1 sm:flex-none flex items-center justify-center text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-white border border-slate-700 px-3 py-2 rounded-lg transition-colors cursor-pointer"
                title="Return to Bill List & Stage Overview"
              >
                <ArrowLeft className="w-4 h-4 mr-1 shrink-0" /> Back to Bill List
              </button>
            </div>
          </div>

          {savedSuccessMsg && (
            <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 p-3 rounded-lg flex items-center justify-between text-xs font-semibold print:hidden shadow-sm">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{savedSuccessMsg}</span>
              </div>
              <button onClick={() => setSavedSuccessMsg('')} className="text-emerald-600 hover:text-emerald-800">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Scrap charge could not be resolved from the master - blocking, and named
              so the user knows exactly which code to add for which core type. The
              amount is never defaulted to a hardcoded 500. */}
          {scrapChargeErrors.length > 0 && (
            <div className="bg-rose-50 border-l-4 border-rose-600 p-4 rounded-lg text-rose-900 flex items-start gap-3 print:hidden shadow-sm">
              <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold text-rose-950">
                  Scrap charge not configured - this bill cannot be sent
                </p>
                <ul className="mt-1 space-y-1 text-xs text-rose-800 list-disc list-inside">
                  {scrapChargeErrors.map((msg, i) => <li key={i}>{msg}</li>)}
                </ul>
              </div>
            </div>
          )}

          {/* Pending Delivery Warning Banner inside Editor */}
          {selectedMrPendingCount > 0 && (
            <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-lg text-amber-900 flex items-start gap-3 print:hidden shadow-sm">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                {billTypeFilter === 'scrap' ? (
                  <>
                    <p className="font-bold text-amber-950">
                      ⚠️ {selectedMrPendingCount} of {selectedMrPendingCount + selectedJobsData.length} scrap transformers have not yet been returned to the division.
                    </p>
                    <p className="mt-0.5 text-amber-800 text-xs">
                      Confirm the scrap committee has completed its visit before sending this bill.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-bold text-amber-950">
                      ⚠️ Partial Bill Notice: {selectedMrPendingCount} Transformer(s) Pending Delivery
                    </p>
                    <p className="mt-0.5 text-amber-800 text-xs">
                      MR <strong>{selectedMrNo}</strong> has <strong>{selectedMrPendingCount}</strong> transformer(s) still pending delivery. This bill is generated for the <strong>{selectedJobsData.length}</strong> delivered transformer(s).
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Scrap Jobs Notice Banner inside Editor */}
          {billTypeFilter === 'repairable' && jobs.filter(j => j.mrNo === selectedMrNo && (j.status === 'Scrap' || j.condition === 'Scrap')).length > 0 && (
            <div className="bg-purple-50 border-l-4 border-purple-500 p-4 rounded-lg text-purple-950 flex items-start gap-3 print:hidden shadow-sm">
              <AlertCircle className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold">
                  ℹ️ Scrap Transformers Returned ({jobs.filter(j => j.mrNo === selectedMrNo && (j.status === 'Scrap' || j.condition === 'Scrap')).length} Scrap Job)
                </p>
                <p className="mt-0.5 text-purple-800 text-xs">
                  MR <strong>{selectedMrNo}</strong> includes <strong>{jobs.filter(j => j.mrNo === selectedMrNo && (j.status === 'Scrap' || j.condition === 'Scrap')).length}</strong> scrap transformer(s) [{jobs.filter(j => j.mrNo === selectedMrNo && (j.status === 'Scrap' || j.condition === 'Scrap')).map(j => j.jobNo).join(', ')}] delivered back to division. No repair bill is prepared for scrap jobs.
                </p>
              </div>
            </div>
          )}

          {/* Editable Metadata Form */}
          <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-4 print:hidden">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
                Bill Meta & Tax Credentials
              </h3>
              <span className="text-[11px] text-blue-600 font-medium">
                Auto-populated from {activeAgency?.name || 'Agency'} Profile
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
              <div>
                <label className="block font-bold text-slate-600 mb-1">Bill No</label>
                <input
                  type="text"
                  value={billNo}
                  onChange={(e) => setBillNo(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono font-bold text-slate-800"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1">Bill Date</label>
                <input
                  type="text"
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono text-slate-800"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1">Appr / Order No</label>
                <input
                  type="text"
                  value={apprNo}
                  onChange={(e) => setApprNo(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono text-slate-800"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1">Appr Date</label>
                <input
                  type="text"
                  value={apprDate}
                  onChange={(e) => setApprDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono text-slate-800"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1">DISCOM GSTIN</label>
                <input
                  type="text"
                  value={divisionGstin}
                  onChange={(e) => setDivisionGstin(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono text-slate-800"
                  placeholder="DISCOM GST No"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1">DISCOM PAN</label>
                <input
                  type="text"
                  value={divisionPan}
                  onChange={(e) => setDivisionPan(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono text-slate-800"
                  placeholder="DISCOM PAN No"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1">SAC Code</label>
                <input
                  type="text"
                  value={serviceSacCode}
                  onChange={(e) => setServiceSacCode(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono text-slate-800"
                  placeholder="998719"
                />
              </div>
            </div>
          </div>

          {/* Document Preview Tabs */}
          <div className="flex bg-slate-200 p-1 rounded-lg border border-slate-300 print:hidden overflow-x-auto">
            <button
              onClick={() => setActiveDocTab('all')}
              className={`flex-1 min-w-[120px] py-2 text-xs font-bold uppercase rounded-md transition-all ${
                activeDocTab === 'all' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All 4 Pages (Stacked)
            </button>
            <button
              onClick={() => setActiveDocTab('forwarding')}
              className={`flex-1 min-w-[120px] py-2 text-xs font-bold uppercase rounded-md transition-all ${
                activeDocTab === 'forwarding' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              1. Forwarding Letter
            </button>
            <button
              onClick={() => setActiveDocTab('certificate')}
              className={`flex-1 min-w-[120px] py-2 text-xs font-bold uppercase rounded-md transition-all ${
                activeDocTab === 'certificate' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              2. Certificate
            </button>
            <button
              onClick={() => setActiveDocTab('invoice')}
              className={`flex-1 min-w-[120px] py-2 text-xs font-bold uppercase rounded-md transition-all ${
                activeDocTab === 'invoice' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              3. Tax Invoice
            </button>
            <button
              onClick={() => setActiveDocTab('oil')}
              className={`flex-1 min-w-[120px] py-2 text-xs font-bold uppercase rounded-md transition-all ${
                activeDocTab === 'oil' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              4. Oil Account
            </button>
          </div>

          {/* PRINTABLE DOCUMENTS CONTAINER */}
          {/* REPRINT WARNING - screen only, never on the sheet itself.
              These figures are RECALCULATED from today's master and today's AT
              percentage. They are not a record of what was sent: the master can have been
              edited since, and the AT percentage follows the AT currently selected rather
              than the one the job was booked under. So a reprint can differ from the copy
              on file, silently and without either document being wrong.

              print:hidden - the printed sheet is deliberately untouched. A caveat printed
              onto a document that goes to UGVCL would be worse than the ambiguity it
              describes. */}
          {selectedJobsData.some((j: any) => j.billNo || j.billSentDate) && (
            <div className="print:hidden mb-3 p-3 rounded-lg bg-amber-50 border border-amber-300 text-[12px] text-amber-900 leading-relaxed">
              <strong className="font-bold">Already sent - this is a recalculation, not the copy that was issued.</strong>
              <p className="mt-0.5">
                Amounts below are worked out from the estimate master and AT percentage <em>as they are now</em>.
                If either changed since the bill was sent, this will differ from the document on file.
                <strong> The copy on file is what was sent.</strong>
              </p>
            </div>
          )}
          <div id="printable-billing-container" className="space-y-8 print:space-y-0">

            {/* ==================== PAGE 1: FORWARDING LETTER ==================== */}
            <PrintableA4Page
              agency={activeAgency}
              documentTitle=""
              className={activeDocTab === 'all' || activeDocTab === 'forwarding' ? 'block' : 'hidden print:block'}
            >
              <div className="flex flex-col justify-between h-full">
                <div>
                  {/* Recipient */}
                  <div className="mb-4 text-xs text-black whitespace-pre-wrap font-medium">
                    {forwardingTo || `To\n${activeAgency?.divisionAuthority || ''}\n${activeAgency?.discomName || ''}\nDivision Office : ${currentDivision}`}
                    {divisionGstin && <p className="font-bold mt-1">GST No. {divisionGstin}</p>}
                  </div>

                  {/* Subject */}
                  <div className="text-center my-4">
                    <p className="text-sm font-bold text-black border-b border-black inline-block pb-0.5">
                      Sub : {forwardingSub || 'Submission of Bill for Payment'}
                    </p>
                  </div>

                  {/* Salutation & Body */}
                  <div className="text-xs text-black space-y-3 leading-relaxed mb-4">
                    <p>Dear Sir,</p>
                    <div className="pl-4 space-y-1">
                      <p>
                        Please find enclosed herewith our bill No. - <strong className="font-bold">{billNo}</strong> dated <strong className="font-bold">{formatDDMMYYYY(billDate)}</strong>
                      </p>
                      <p>
                        <strong className="font-bold">Rs. {grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/-</strong> in words <strong className="font-bold">{numberToIndianWords(grandTotal)}</strong>
                      </p>
                    </div>
                    <p className="pl-4">
                      Along with our Delivery Challan , Oil Account and relevant Test Certificate.
                    </p>
                    <p className="pl-4">
                      You are requested to pass the above bill at your earliest and arrange to release the payment possibly earlier.
                    </p>
                    <p className="pl-4">Thanking you and assuring you of best services.</p>
                  </div>
                </div>

                <div>
                  {/* Enclosures & Signatures */}
                  <div className="flex justify-between items-end text-xs text-black pt-4">
                    <div className="space-y-1">
                      <p className="font-bold">Encl :-</p>
                      <ol className="list-decimal list-inside space-y-0.5 text-[11px]">
                        <li>Bill Copy - 2 with Advance Stamp receipt.</li>
                        <li>Bill Oil Account - 2.</li>
                        <li>Delivery Challan - 1.</li>
                        <li>Test Certificate - 1.</li>
                        <li>Estimate Copy - 1.</li>
                        <li>Approval Copy - 1.</li>
                      </ol>
                    </div>

                    <div className="text-center">
                      <p className="font-bold mb-8">Yours Faithfully,</p>
                      <p className="font-bold">For, {activeAgency?.name || ''}</p>
                      <p className="text-[10px] text-slate-500 mt-1">(Auth Sign.)</p>
                    </div>
                  </div>

                  {forwardingCc && (
                    <div className="mt-4 text-[10px] font-bold text-slate-800 border-t pt-2">
                      <p>C . C. to :</p>
                      <p className="whitespace-pre-wrap font-normal mt-0.5">{forwardingCc}</p>
                    </div>
                  )}
                </div>
              </div>
            </PrintableA4Page>

            {/* ==================== PAGE 2: CERTIFICATE ==================== */}
            <PrintableA4Page
              agency={activeAgency}
              documentTitle=""
              className={activeDocTab === 'all' || activeDocTab === 'certificate' ? 'block' : 'hidden print:block'}
            >
              <div className="flex flex-col justify-center h-full my-auto">
                {/* Content-sized box: nothing here is absolutely positioned, so the
                    signature escaping the border is the CONTENT being taller than the
                    printable A4 area, not an element placed over it. `justify-between`
                    also did nothing - it distributes free space, and a content-sized
                    column has none - so it is dropped rather than left looking load-bearing.
                    Spacing reduced just enough to fit; the structure is unchanged. */}
                <div className="border-2 border-black p-6 my-auto flex flex-col">
                  <div className="text-center mb-4">
                    <h2 className="text-lg font-black uppercase border-b-2 border-black inline-block tracking-wider pb-1">
                      CERTIFICATE
                    </h2>
                  </div>

                  <p className="text-xs text-black leading-loose text-justify font-medium">
                    We hereby Certify that the materials and spares mentioned in the Estimate of Transformers mentioned in our <strong className="font-bold">BILL NO. {billNo}</strong> Dated <strong className="font-bold">{formatDDMMYYYY(billDate)}</strong> are Replaced and Fitted, the above Transformers are guaranteed by {certMonthsText || 'Twelve/Eighteen'} months from the date to delivery.
                  </p>

                  <div className="text-right mt-10">
                    <p className="font-bold text-xs">For, {activeAgency?.name || ''}</p>
                    <p className="text-[10px] text-slate-500 mt-6">(Auth Sign.)</p>
                  </div>
                </div>
              </div>
            </PrintableA4Page>

            {/* ==================== PAGE 3: TAX INVOICE ==================== */}
            <PrintableA4Page
              agency={activeAgency}
              showAgencyHeaderIfNoLetterhead={false}
              className={activeDocTab === 'all' || activeDocTab === 'invoice' ? 'block' : 'hidden print:block'}
            >
              <div className="border-2 border-black text-black text-[10px] h-full flex flex-col justify-between">
                <div>
                  {/* Header Row: Supplier & Invoice Identification */}
                  <div className="grid grid-cols-2 border-b-2 border-black">
                    <div className="p-2 border-r-2 border-black flex flex-col justify-between">
                      <div>
                        {activeAgency?.letterheadUrl && activeAgency?.letterheadMode === 'header_only' ? (
                          <img src={activeAgency.letterheadUrl} alt="Letterhead" className="max-h-12 object-contain mb-1" />
                        ) : (
                          /* Registered business name, falling back to the short name. The
                             tax invoice is the ONLY document that uses legalName - every
                             other screen and document prints `name`, deliberately. */
                          <h1 className="text-xs font-black uppercase font-serif tracking-wide">{activeAgency?.legalName || activeAgency?.name || 'AGENCY NAME'}</h1>
                        )}
                        <p className="font-bold text-[9px] text-slate-800">Repairing of Distribution Transformers</p>
                        <p className="mt-0.5 text-[9px] leading-tight">{activeAgency?.address || ''}</p>
                      </div>
                      <div className="mt-1 pt-1 border-t border-slate-200 text-[9px] space-y-0.5">
                        <div className="flex justify-between">
                          <span><strong>State:</strong> {activeAgency?.agencyState || '-'}</span>
                          {/* Derived from the agency's own GSTIN - its first two digits
                              ARE the state code - so it cannot disagree with it. */}
                          <span><strong>State Code:</strong> {getAgencyStateCode(activeAgency) || '-'}</span>
                        </div>
                        {(activeAgency?.phone || activeAgency?.email) && (
                          <div>
                            {activeAgency?.phone && <span><strong>Ph:</strong> {activeAgency.phone} </span>}
                            {activeAgency?.email && <span><strong>Email:</strong> {activeAgency.email}</span>}
                          </div>
                        )}
                        {activeAgency?.msmeNo && (
                          <div><strong>MSME Reg No:</strong> {activeAgency.msmeNo}</div>
                        )}
                      </div>
                    </div>

                    <div className="p-2 flex flex-col justify-between">
                      <div>
                        <div className="text-right font-bold text-[9px] uppercase tracking-widest border-b border-black pb-0.5 mb-1">
                          TAX INVOICE
                        </div>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px]">
                          <div><span className="font-bold">Bill No:</span> <strong className="font-bold font-mono">{billNo}</strong></div>
                          <div><span className="font-bold">Bill Date:</span> <span className="font-mono">{formatDDMMYYYY(billDate)}</span></div>
                          <div><span className="font-bold">Order No:</span> <span className="font-mono">{apprNo}</span></div>
                          <div><span className="font-bold">Order Date:</span> <span className="font-mono">{formatDDMMYYYY(apprDate)}</span></div>
                        </div>
                      </div>
                      <div className="mt-1 pt-1 border-t border-black p-1 text-[9px] grid grid-cols-2 gap-x-2">
                        <div><span className="font-bold">GSTIN:</span> <strong className="font-mono">{activeAgency?.gstin || '-'}</strong></div>
                        <div><span className="font-bold">PAN:</span> <strong className="font-mono">{activeAgency?.pan || '-'}</strong></div>
                      </div>
                    </div>
                  </div>

                  {/* Customer (Buyer / Consignee) Details */}
                  <div className="p-2 border-b-2 border-black">
                    <div className="grid grid-cols-2 gap-2 text-[9px]">
                      <div>
                        <span className="text-[8px] font-black uppercase tracking-widest text-slate-500 block mb-0.5">Billed To (Client / Consignee):</span>
                        {/* No fallback. It defaulted to UGVCL's title on every DISCOM's
                            invoice; missingForTaxInvoice now gates on it (AUDIT O7). */}
                        <p className="font-bold uppercase text-[9px]">{activeAgency?.divisionAuthority || ''}</p>
                        {/* No placeholder. This is the BUYER NAME on a tax invoice: a
                            literal like 'DISCOM' looks like a filled field and survives
                            review, where an empty one does not. The gate
                            (missingForTaxInvoice) already prevents reaching this state -
                            the dash is what shows if that gate is ever loosened. */}
                        <p className="font-bold text-black">{activeAgency?.discomName || '-'}</p>
                        <p className="text-[9px]">Division Office: <strong className="font-bold">{currentDivision}</strong></p>
                        {activeAgency?.discomAddress && (
                          <p className="text-[8px] text-slate-700 mt-0.5 leading-tight">{activeAgency.discomAddress}</p>
                        )}
                      </div>
                      <div className="border-l border-slate-300 pl-2 flex flex-col justify-between space-y-0.5">
                        <div>
                          <div><span className="font-bold">DISCOM GSTIN:</span> <strong className="font-mono">{divisionGstin || activeAgency?.discomGstin || '-'}</strong></div>
                          <div><span className="font-bold">DISCOM PAN:</span> <strong className="font-mono">{divisionPan || activeAgency?.discomPan || '-'}</strong></div>
                          <div className="flex justify-between text-[8px] text-slate-700 mt-0.5">
                            <span><strong>State:</strong> {activeAgency?.discomState || 'Gujarat'}</span>
                            <span><strong>State Code:</strong> {activeAgency?.discomStateCode || '24'}</span>
                          </div>
                        </div>
                        <div className="text-[8px]">
                          <span className="font-bold">SAC:</span> Maintenance of Transformers <strong className="font-mono">({serviceSacCode || '998719'})</strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Sub-header instruction */}
                  <div className="p-1 border-b border-black font-semibold text-center text-[9px]">
                    {billTypeFilter === 'scrap'
                      ? 'The following Transformer(s) declared as scrap by E.E. (TR), inspected & dismantled and returned to the division.'
                      : 'The following Transformer duly repaired with standard parts and tested o.k. with oil up to level mark.'}
                  </div>

                  {/* Itemized Table */}
                  <table className="w-full text-center border-collapse text-[9px]">
                    <thead>
                      <tr className="font-bold border-b border-black bg-slate-100 print:bg-white">
                        <th className="p-1 border-r border-black w-6">Sr.</th>
                        <th className="p-1 border-r border-black">Job No.</th>
                        <th className="p-1 border-r border-black">Challan No.</th>
                        <th className="p-1 border-r border-black">Date</th>
                        <th className="p-1 border-r border-black">Make</th>
                        <th className="p-1 border-r border-black w-8">KVA</th>
                        <th className="p-1 border-r border-black w-6">KV</th>
                        <th className="p-1 border-r border-black">Serial No.</th>
                        <th className="p-1 border-r border-black text-right">Est. Amount</th>
                        <th className="p-1 text-right">Amount (Rs)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedJobsData.map((job, idx) => {
                        const jobTotal = calculateJobTotal(job);
                        // Est. Amount is RECOMPUTED here, not read from job.estimateAmount.
                        //
                        // Two reasons. The stored figure is understated - it is built from
                        // baseTotal rather than finalAmount (AUDIT O4) - and fixing that
                        // corrects only future writes, leaving every existing job printing
                        // the wrong number on an invoice today. And computing it from the
                        // same function the estimate itself prints from means the two
                        // documents agree by construction rather than by both happening to
                        // have stored the same value.
                        //
                        // WHAT THIS COLUMN IS, for whoever reads it next: a CURRENT
                        // recomputation of the estimate, not a record of what was sent.
                        // It reflects today's master and AT percentage, so an invoice
                        // reprinted after a rate change shows a different figure from the
                        // estimate that actually went out. THE PRINTED ESTIMATE ON FILE IS
                        // THE AUTHORITY for what was sent; this column is here so a
                        // reviewer can compare estimate against bill, which is the whole
                        // reason the column exists - it previously printed jobTotal twice.
                        const estAmount = getJobFullEstimate(
                          job,
                          externalInspMap[job.id],
                          internalInspMap[job.id],
                          activeAgency,
                          atForJob(job, atMasters) ?? activeAtMaster
                        ).finalAmount;
                        return (
                          <tr key={job.id} className="border-b border-black">
                            <td className="p-1 border-r border-black">{idx + 1}</td>
                            <td className="p-1 border-r border-black font-bold font-mono">{job.jobNo}</td>
                            <td className="p-1 border-r border-black font-mono">{job.challanNo || ''}</td>
                            <td className="p-1 border-r border-black">{formatDDMMYYYY(job.deliveryDate || job.challanDate || billDate)}</td>
                            <td className="p-1 border-r border-black">{job.make || ''}</td>
                            <td className="p-1 border-r border-black font-bold">{job.capacityKva}</td>
                            <td className="p-1 border-r border-black">11</td>
                            <td className="p-1 border-r border-black font-mono">{job.serialNo || '-'}</td>
                            <td className="p-1 border-r border-black text-right font-mono">{estAmount.toFixed(2)}</td>
                            <td className="p-1 text-right font-mono font-bold">{jobTotal.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                      {/* Financial Calculations */}
                      <tr className="font-bold border-t border-black">
                        <td colSpan={9} className="p-1 border-r border-black text-right">Total (Taxable Value):</td>
                        <td className="p-1 text-right font-mono">{subTotal.toFixed(2)}</td>
                      </tr>
                      <tr className="font-bold border-t border-black">
                        <td colSpan={9} className="p-1 border-r border-black text-right">CGST ({cgstRate.toFixed(2)}%):</td>
                        <td className="p-1 text-right font-mono">{cgst.toFixed(2)}</td>
                      </tr>
                      <tr className="font-bold border-t border-black">
                        <td colSpan={9} className="p-1 border-r border-black text-right">SGST ({sgstRate.toFixed(2)}%):</td>
                        <td className="p-1 text-right font-mono">{sgst.toFixed(2)}</td>
                      </tr>
                      <tr className="font-black border-t border-black text-[10px]">
                        <td colSpan={9} className="p-1 border-r border-black text-right">Net Total Invoice Value:</td>
                        <td className="p-1 text-right font-mono font-bold">{grandTotal.toFixed(2)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Bottom Footer Section */}
                <div className="grid grid-cols-2 border-t-2 border-black">
                  <div className="p-2 border-r-2 border-black flex flex-col justify-between text-[9px]">
                    <div>
                      <p><strong className="font-bold">Received Payment of Rs.</strong> <span className="font-mono font-bold">{grandTotal.toFixed(2)}</span></p>
                      <p className="font-semibold italic text-[8px] text-slate-800">{numberToIndianWords(grandTotal)}</p>
                      <p className="mt-1 text-[8px]">In full settlement of Bill no <strong className="font-bold font-mono">{billNo}</strong> Dated <strong className="font-bold font-mono">{formatDDMMYYYY(billDate)}</strong></p>
                      {(activeAgency?.bankName || activeAgency?.accountNumber) && (
                        <div className="mt-1 pt-1 border-t border-dashed border-slate-300 text-[8px]">
                          <div><strong>Bank:</strong> {activeAgency?.bankName || '-'} | <strong>A/C:</strong> <span className="font-mono font-bold">{activeAgency?.accountNumber || '-'}</span> | <strong>IFSC:</strong> <span className="font-mono font-bold">{activeAgency?.ifscCode || '-'}</span></div>
                        </div>
                      )}
                    </div>
                    <div className="pt-3 text-center">
                      <p className="font-bold">For, {activeAgency?.name || ''}</p>
                      <div className="h-4"></div>
                      <p className="text-[8px] text-slate-500">(Authorized Signatory / Stamp)</p>
                    </div>
                  </div>

                  <div className="p-2 flex flex-col justify-between text-[9px]">
                    <div>
                      <h4 className="font-black text-center uppercase tracking-wider mb-1 border-b border-black pb-0.5 text-[9px]">
                        Guarantee Card
                      </h4>
                      <p className="text-[8px] leading-tight text-justify">
                        We guarantee the satisfactory performance of the above repaired transformers for {activeAgency?.gpValidationMonths || 18} months for 11 KV and 12 months for 22 KV from date of delivery.
                      </p>
                    </div>
                    <div className="pt-3 text-center">
                      <p className="font-bold">For, {activeAgency?.name || ''}</p>
                      <div className="h-4"></div>
                      <p className="text-[8px] text-slate-500">(Authorized Signatory)</p>
                    </div>
                  </div>
                </div>
              </div>
            </PrintableA4Page>

            {/* ==================== PAGE 4: OIL ACCOUNT ==================== */}
            <PrintableA4Page
              agency={activeAgency}
              documentTitle="OIL ACCOUNT SHEET"
              showAgencyHeaderIfNoLetterhead={false}
              className={activeDocTab === 'all' || activeDocTab === 'oil' ? 'block' : 'hidden print:block'}
            >
              <div className="border-2 border-black p-3 text-black text-[9px] space-y-2 h-full flex flex-col justify-between">
                <div>
                  <div className="grid grid-cols-4 gap-1 font-semibold text-[9px] border-b border-black pb-1 mb-2">
                    <div>Order: <span className="font-mono font-bold">{apprNo}</span></div>
                    <div>MR NO: <span className="font-mono font-bold">{selectedMrNo}</span> | Date: <span className="font-mono font-bold">{formatDDMMYYYY(selectedMrDate)}</span></div>
                    <div>Insp. Date: <span className="font-mono font-bold text-blue-900">{formatDDMMYYYY(selectedMrInspectionDate)}</span></div>
                    <div className="text-right">Division: <strong className="font-bold uppercase text-black">{currentDivision}</strong></div>
                  </div>

                  {/* Table 1: Delivered Transformers Oil Table */}
                  <table className="w-full text-center border-collapse border border-black text-[8px] mb-2">
                    <thead>
                      <tr className="font-bold border-b border-black bg-slate-100 print:bg-white">
                        <th className="border border-black p-0.5 w-5">Sr.</th>
                        <th className="border border-black p-0.5">Job No.</th>
                        <th className="border border-black p-0.5">Make</th>
                        <th className="border border-black p-0.5">Serial No.</th>
                        <th className="border border-black p-0.5 w-6">KVA</th>
                        <th className="border border-black p-0.5 w-5">KV</th>
                        <th className="border border-black p-0.5">Oil Cap.</th>
                        <th className="border border-black p-0.5">Oil Recd.</th>
                        <th className="border border-black p-0.5">Shortage</th>
                        <th className="border border-black p-0.5">FL (5%)</th>
                        <th className="border border-black p-0.5 font-bold">Net Oil Req.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobOilDetails.map((detail, idx) => (
                        <tr key={detail.job.id} className="border-b border-black">
                          <td className="border border-black p-0.5">{idx + 1}</td>
                          <td className="border border-black p-0.5 font-bold font-mono">{detail.job.jobNo}</td>
                          <td className="border border-black p-0.5">{detail.job.make || 'VIJAI'}</td>
                          <td className="border border-black p-0.5 font-mono">{detail.job.serialNo || '-'}</td>
                          <td className="border border-black p-0.5 font-bold">{detail.job.capacityKva}</td>
                          <td className="border border-black p-0.5">11</td>
                          <td className="border border-black p-0.5 font-mono">{detail.oilCap.toFixed(1)}</td>
                          <td className="border border-black p-0.5 font-mono">{detail.oilRecd.toFixed(1)}</td>
                          <td className="border border-black p-0.5 font-mono">{detail.baseShortage.toFixed(1)}</td>
                          <td className="border border-black p-0.5 font-mono">{detail.filterLoss.toFixed(1)}</td>
                          <td className="border border-black p-0.5 font-mono font-bold">{detail.netShortage.toFixed(1)}</td>
                        </tr>
                      ))}
                      <tr className="font-bold border-t border-black bg-slate-50 print:bg-white">
                        <td colSpan={6} className="border border-black p-0.5 text-right">Total (MR {selectedMrNo}):</td>
                        <td className="border border-black p-0.5 font-mono">{totalOilCapacity.toFixed(1)}</td>
                        <td className="border border-black p-0.5 font-mono">{totalOilReceived.toFixed(1)}</td>
                        <td className="border border-black p-0.5 font-mono">{totalBaseShortage.toFixed(1)}</td>
                        <td className="border border-black p-0.5 font-mono">{totalFilterLoss.toFixed(1)}</td>
                        <td className="border border-black p-0.5 font-mono font-bold">{totalNetShortage.toFixed(1)}</td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Table 2: Oil Inward Log for MR */}
                  <div className="mb-2">
                    <div className="flex justify-between items-center mb-0.5">
                      <h4 className="font-bold text-[8px] uppercase">
                        Inward Oil Received Log for MR: {selectedMrNo} (Division: {currentDivision})
                      </h4>
                      <span className="text-[8px] text-slate-500 font-mono">Bill No: {billNo}</span>
                    </div>
                    <table className="w-full text-center border-collapse border border-black text-[8px]">
                      <thead>
                        <tr className="font-bold border-b border-black bg-slate-100 print:bg-white">
                          <th className="border border-black p-0.5">MR NO</th>
                          <th className="border border-black p-0.5">Date</th>
                          <th className="border border-black p-0.5">Type</th>
                          <th className="border border-black p-0.5">Gross (Ltr)</th>
                          <th className="border border-black p-0.5">Barrels</th>
                          <th className="border border-black p-0.5 font-bold">Net Oil (Ltr)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mrOilTxList.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="border border-black p-1 text-slate-500 italic text-[8px]">
                              No inward oil transaction logged for MR {selectedMrNo}.
                            </td>
                          </tr>
                        ) : (
                          mrOilTxList.map((tx, idx) => (
                            <tr key={tx.id || idx} className="border-b border-black">
                              <td className="border border-black p-0.5 font-mono font-bold">{tx.mrNo}</td>
                              {/* A missing transaction date shows '-', never the bill date. Substituting billDate
                                  put a fabricated date on a financial document - see AUDIT.md O6. */}
                              <td className="border border-black p-0.5">{formatDDMMYYYY(tx.date)}</td>
                              <td className="border border-black p-0.5">{tx.oilType || 'Fresh'}</td>
                              <td className="border border-black p-0.5 font-mono">{Number(tx.grossLiters || 0).toFixed(1)}</td>
                              <td className="border border-black p-0.5 font-mono">{tx.barrels || 0}</td>
                              <td className="border border-black p-0.5 font-mono font-bold">{Number(tx.netLiters || 0).toFixed(1)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary Box */}
                  <div className="grid grid-cols-2 gap-2 border border-black p-2 font-semibold text-[8px]">
                    <div className="space-y-0.5">
                      <h4 className="font-bold border-b border-black pb-0.5 mb-0.5 uppercase text-[8px]">
                        1. Current MR ({selectedMrNo}) Oil Requirement
                      </h4>
                      <div className="flex justify-between"><span>Total Capacity:</span> <span className="font-mono">{totalOilCapacity.toFixed(1)} Ltr</span></div>
                      <div className="flex justify-between"><span>Oil Received:</span> <span className="font-mono">{totalOilReceived.toFixed(1)} Ltr</span></div>
                      <div className="flex justify-between"><span>Base Shortage:</span> <span className="font-mono">{totalBaseShortage.toFixed(1)} Ltr</span></div>
                      <div className="flex justify-between"><span>Filtration Loss (5%):</span> <span className="font-mono">+{totalFilterLoss.toFixed(1)} Ltr</span></div>
                      <div className="flex justify-between border-t border-black pt-0.5 font-bold">
                        <span>Net Shortage:</span>
                        <span className="font-mono font-bold">{totalNetShortage.toFixed(1)} Ltr</span>
                      </div>
                    </div>

                    <div className="space-y-0.5 border-l border-black pl-2">
                      <h4 className="font-bold border-b border-black pb-0.5 mb-0.5 uppercase text-[8px]">
                        2. {currentDivision} Division Balance (Up to: {formatDDMMYYYY(effectiveOilUptoDate)})
                      </h4>
                      <div className="flex justify-between">
                        <span>Cumulative Shortage:</span>
                        <span className="font-mono font-bold">+{divisionOilStatement.divisionCumulativeShortage.toFixed(1)} Ltr</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Cumulative Inward:</span>
                        <span className="font-mono font-bold">-{divisionOilStatement.divisionCumulativeInward.toFixed(1)} Ltr</span>
                      </div>
                      <div className="flex justify-between border-t border-black pt-0.5 font-black">
                        <span>Net Oil Status:</span>
                        <span className="font-mono">
                          {divisionOilStatement.divisionNetOilOnInspectionDate >= 0 ? '+' : ''}
                          {divisionOilStatement.divisionNetOilOnInspectionDate.toFixed(1)} Ltr
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer Signature */}
                <div className="text-right pt-2">
                  <p className="font-bold text-[9px]">For, {activeAgency?.name || 'POWER TRANSMISSION COMPANY'}</p>
                  <div className="h-4"></div>
                  <p className="text-[8px] text-slate-500">(Auth Sign.)</p>
                </div>
              </div>
            </PrintableA4Page>

          </div>

        </div>
      )}

      {/* EDIT / CUSTOMIZE LETTER MODAL FOR BILLING SYSTEM */}
      {showEditLetterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-2xl w-full border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200">
              <div className="flex items-center space-x-2 text-slate-800">
                <Edit3 className="w-5 h-5 text-amber-600" />
                <h3 className="font-bold text-base">Customize Letter & Certificate Details</h3>
              </div>
              <button onClick={() => setShowEditLetterModal(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Forwarding To (Recipient Address)</label>
                <textarea rows={3} value={forwardingTo} onChange={e => setForwardingTo(e.target.value)} className="w-full px-3 py-2 text-sm border rounded bg-slate-50 focus:bg-white font-mono text-xs" />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Subject (Sub.)</label>
                <input type="text" value={forwardingSub} onChange={e => setForwardingSub(e.target.value)} className="w-full px-3 py-2 text-sm border rounded bg-slate-50 focus:bg-white" />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Guarantee Certificate Period (Months)</label>
                <input type="text" value={certMonthsText} onChange={e => setCertMonthsText(e.target.value)} placeholder="e.g. Twelve/Eighteen" className="w-full px-3 py-2 text-sm border rounded bg-slate-50 focus:bg-white" />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">C . C. to :</label>
                <textarea rows={2} value={forwardingCc} onChange={e => setForwardingCc(e.target.value)} className="w-full px-3 py-2 text-sm border rounded bg-slate-50 focus:bg-white font-mono text-xs" />
              </div>

              <div className="bg-amber-50 border border-amber-200 p-3 rounded flex items-center space-x-2 text-xs text-amber-800">
                <input
                  type="checkbox"
                  id="saveAgencyDefaultBilling"
                  checked={saveAsDefaultAgency}
                  onChange={e => setSaveAsDefaultAgency(e.target.checked)}
                  className="rounded text-amber-600 focus:ring-amber-500 w-4 h-4"
                />
                <label htmlFor="saveAgencyDefaultBilling" className="cursor-pointer font-medium">
                  Save Recipient, Subject & C.C. as default configuration for {activeAgency?.name || 'active agency'}
                </label>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-200 flex justify-end space-x-3">
              <button onClick={() => setShowEditLetterModal(false)} className="px-4 py-2 text-xs font-bold uppercase text-slate-600 hover:text-slate-800 border rounded">
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (saveAsDefaultAgency && activeAgency) {
                    await updateAgency(activeAgency.id, {
                      forwardingToText: forwardingTo,
                      forwardingSubject: forwardingSub,
                      forwardingCcText: forwardingCc
                    });
                  }
                  setShowEditLetterModal(false);
                }}
                className="px-5 py-2 text-xs font-bold uppercase bg-emerald-600 hover:bg-emerald-700 text-white rounded transition-colors flex items-center"
              >
                <Check className="w-4 h-4 mr-1.5" /> Confirm & Apply To Document
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SEND BILL MODAL */}
      {showSendBillModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-blue-600 p-4 text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Send className="w-5 h-5" />
                <h3 className="font-bold text-base">Send Bill / Record Dispatch (MR {sendTargetMr})</h3>
              </div>
              <button onClick={() => setShowSendBillModal(false)} className="text-blue-100 hover:text-white p-1 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 flex justify-between items-center">
                <div>
                  <p className="font-bold text-blue-950">MR No: {sendTargetMr}</p>
                  <p className="text-blue-700">Division: {mrGroups[sendTargetMr]?.[0]?.division || 'SABARMATI'}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase font-bold text-blue-700">Net Bill Value</p>
                  <p className="text-base font-bold text-blue-900 font-mono">
                    ₹{calculateMrBillSummary(sendTargetMr).grandTotal.toLocaleString('en-IN')}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                  Bill / Invoice No <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={sendBillNo}
                  onChange={e => setSendBillNo(e.target.value)}
                  placeholder="e.g. BILL/SAB/2026/045"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                  Dispatch / Covering Letter Ref No <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={sendBillRefNo}
                  onChange={e => setSendBillRefNo(e.target.value)}
                  placeholder="e.g. UGVCL/BILL-SUB/MR-841/2026-27"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                  Bill Sent / Dispatch Date <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  value={sendBillDate}
                  onChange={e => setSendBillDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                  Remarks / Dispatch Details (Optional)
                </label>
                <input
                  type="text"
                  value={sendBillRemarks}
                  onChange={e => setSendBillRemarks(e.target.value)}
                  placeholder="e.g. Hand delivered to EE Sabarmati with test certs"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  onClick={() => setShowSendBillModal(false)}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-600 hover:text-slate-800 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmSendBill}
                  disabled={submittingSendBill}
                  className="px-5 py-2 text-xs font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  {submittingSendBill ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Mark as Sent & Save</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MARK AS PAID MODAL */}
      {showPaidModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-emerald-600 p-4 text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Banknote className="w-5 h-5" />
                <h3 className="font-bold text-base">Record Payment (MR {paidTargetMr})</h3>
              </div>
              <button onClick={() => setShowPaidModal(false)} className="text-emerald-100 hover:text-white p-1 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-950 flex justify-between items-center">
                <div>
                  <p className="font-bold text-emerald-950">MR No: {paidTargetMr}</p>
                  <p className="text-emerald-700">Division: {mrGroups[paidTargetMr]?.[0]?.division || 'SABARMATI'}</p>
                  <p className="text-emerald-800 font-mono text-[11px] mt-0.5">
                    Bill No: {mrGroups[paidTargetMr]?.[0]?.billNo || `BILL/${paidTargetMr}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase font-bold text-emerald-700">Total Billed</p>
                  <p className="text-base font-bold text-emerald-900 font-mono">
                    ₹{calculateMrBillSummary(paidTargetMr).grandTotal.toLocaleString('en-IN')}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                    Payment Mode
                  </label>
                  <select
                    value={paymentMode}
                    onChange={e => setPaymentMode(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white font-medium"
                  >
                    <option value="NEFT / RTGS">NEFT / RTGS</option>
                    <option value="Bank Transfer">Bank Transfer / IMPS</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Demand Draft (DD)">Demand Draft (DD)</option>
                    <option value="Cash / Other">Cash / Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                    Payment Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={e => setPaymentDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                  Transaction UTR / Cheque / Ref No <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={paymentRefNo}
                  onChange={e => setPaymentRefNo(e.target.value)}
                  placeholder="e.g. UTR002938192839 or CHQ-928371"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                    Net Paid Amount (₹) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    value={paidAmount}
                    onChange={e => setPaidAmount(e.target.value)}
                    placeholder="e.g. 145000"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                    TDS / Deduction Amount (₹)
                  </label>
                  <input
                    type="number"
                    value={paymentDeductions}
                    onChange={e => setPaymentDeductions(e.target.value)}
                    placeholder="e.g. 2900"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                  Bank Name / Branch (Optional)
                </label>
                <input
                  type="text"
                  value={paymentBank}
                  onChange={e => setPaymentBank(e.target.value)}
                  placeholder="e.g. State Bank of India, Ahmedabad"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                  Payment Remarks / Notes (Optional)
                </label>
                <input
                  type="text"
                  value={paymentRemarks}
                  onChange={e => setPaymentRemarks(e.target.value)}
                  placeholder="e.g. Full settlement received against Bill No"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  onClick={() => setShowPaidModal(false)}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-600 hover:text-slate-800 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmPaid}
                  disabled={submittingPaid}
                  className="px-5 py-2 text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors shadow-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  {submittingPaid ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Confirm & Record Payment</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
