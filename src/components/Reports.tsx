import React, { useState, useEffect, useMemo } from 'react';
import { useAgency, getEstimateMasterForCore } from '../lib/AgencyContext';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, doc, writeBatch } from 'firebase/firestore';
import { 
  Loader2, 
  FileSpreadsheet, 
  Search, 
  Filter, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  Truck, 
  FileText, 
  Wrench, 
  ShieldAlert, 
  RefreshCw,
  Zap,
  Building2,
  Calendar,
  DollarSign,
  Receipt,
  CreditCard,
  Edit3,
  Save,
  X,
  Sparkles,
  Layers
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { formatDDMMYYYY } from '../lib/utils';
import { GP_TEXT_CLASS, GpChip, GP_FILTER_OPTIONS, matchesGpFilter, GpFilter } from '../lib/jobDisplay';
import { resolveScrapCharge, getScrapItemCodeForCore, getJobFullEstimate } from '../lib/estimateCalc';

export default function Reports() {
  const { activeAgency, activeAtMaster } = useAgency();
  const [jobs, setJobs] = useState<any[]>([]);
  const [inspections, setInspections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'master' | 'pending' | 'testing_ready' | 'delivered' | 'scrap'>('master');
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('All');
  const [gpFilter, setGpFilter] = useState<GpFilter>('All');
  const [stageFilter, setStageFilter] = useState('All');

  // Lifecycle Date Manager Modal State
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<any | null>(null);
  const [applyToAllInMr, setApplyToAllInMr] = useState(true);
  const [savingDates, setSavingDates] = useState(false);
  const [dateFormData, setDateFormData] = useState({
    estimateSentDate: '',
    estimateRefNo: '',
    estimateAmount: '',
    billSentDate: '',
    billNo: '',
    billAmount: '',
    paymentReceivedDate: '',
    paymentStatus: 'Pending',
    paymentAmount: '',
    paymentRefNo: ''
  });

  const fetchData = async () => {
    if (!auth.currentUser || !activeAgency) { setLoading(false); return; }
    setLoading(true);
    try {
      const jobsQ = query(
        collection(db, 'jobs'),
        where('ownerId', '==', auth.currentUser.uid), 
        where('agencyId', '==', activeAgency.id)
      );

      const inspQ = query(
        collection(db, 'inspections'),
        where('ownerId', '==', auth.currentUser.uid)
      );

      const [jobsSnap, inspSnap] = await Promise.all([
        getDocs(jobsQ),
        getDocs(inspQ)
      ]);

      const fetchedJobs = jobsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const fetchedInsps = inspSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // Sort jobs numeric order by jobNo
      fetchedJobs.sort((a: any, b: any) => (a.jobNo || '').localeCompare(b.jobNo || '', undefined, { numeric: true }));
      
      setJobs(fetchedJobs);
      setInspections(fetchedInsps);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeAgency]);

  // Extract unique divisions
  const divisions = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach(j => { if (j.division) set.add(j.division); });
    return Array.from(set).sort();
  }, [jobs]);

  // Calculate Job Estimate Amount fallback if not saved
  const calculateJobEstimate = (job: any): number => {
    if (job.estimateAmount) return Number(job.estimateAmount) || 0;
    try {
      const kva = String(job.capacityKva);
      const isScrapJob = job.status === 'Scrap' || job.condition === 'Scrap';
      const jobMasterData = getEstimateMasterForCore(activeAgency, job.coreType);

      // A scrap transformer is one flat charge, resolved by the mapped scrap item
      // code for its core type via the shared helper (lib/estimateCalc.ts) - the same
      // resolution the estimate and the bill use, so these three can't drift apart.
      // An unresolvable rate reports 0 rather than a guessed figure.
      if (isScrapJob) {
        const scrapCharge = resolveScrapCharge(job.coreType, kva, jobMasterData);
        return Math.round(scrapCharge.rate ?? 0);
      }

      // Repairable: THE SAME BUILDER the estimate and the bill use.
      //
      // This was a verbatim copy of the item loop in BillingSystem - the third and second
      // implementations of one calculation, retired together in AUDIT F57. It read no
      // inspection data, charged every `unit: 'Y'` item regardless of what was found,
      // billed a 47 kg coil as qty 1 because the master labels coil rows 'QTY', and
      // substituted an invented per-capacity weight on every 'KG' row.
      //
      // The scrap branch immediately above already routed through the shared helper, with
      // a comment saying these three must not drift apart. They had already drifted; the
      // comment was describing an intention, not a property.
      //
      // Reads `inspections` directly - this file has no externalInspMap/internalInspMap,
      // and building one here would be a fourth place that decides what an inspection is.
      const ext = inspections.find(i => i.jobId === job.id && i.type === 'External');
      const int = inspections.find(i => i.jobId === job.id && i.type === 'Internal');
      const est = getJobFullEstimate(
        job,
        ext?.data ?? ext,
        int?.data ?? int,
        activeAgency,
        activeAtMaster
      );
      return Math.round(est.baseTotal);
    } catch {
      return 0;
    }
  };

  // Helper to get enriched lifecycle details for a job
  const getJobLifecycle = (job: any) => {
    const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';
    const isDelivered = job.status === 'Dispatched' || job.isClosed === true || Boolean(job.deliveryDate) || Boolean(job.challanNo);

    // External Inspection check
    const extInsp = inspections.find(i => i.jobId === job.id && i.type === 'External');
    const isExtDone = isDelivered || job.status === 'External Done' || job.status === 'Internal Done' || job.status === 'Tested - Ready for Dispatch' || Boolean(extInsp) || Boolean(job.externalDetails?.dateOfInspection) || Boolean(job.externalDate);
    
    let extDate = '-';
    if (extInsp?.createdAt) {
      extDate = formatDDMMYYYY(extInsp.createdAt);
    } else if (job.externalDetails?.dateOfInspection) {
      extDate = formatDDMMYYYY(job.externalDetails.dateOfInspection);
    } else if (job.externalDate) {
      extDate = formatDDMMYYYY(job.externalDate);
    } else if (isExtDone) {
      extDate = formatDDMMYYYY(job.dateOfIssue || job.mrDate || job.createdAt);
    }

    // Internal Inspection check
    const intInsp = inspections.find(i => i.jobId === job.id && i.type === 'Internal');
    const isIntDone = isDelivered || job.status === 'Internal Done' || job.status === 'Tested - Ready for Dispatch' || Boolean(intInsp) || Boolean(job.internalDetails?.dateOfInspection) || Boolean(job.internalDate) || isScrap;
    
    let intDate = '-';
    if (intInsp?.createdAt) {
      intDate = formatDDMMYYYY(intInsp.createdAt);
    } else if (job.internalDetails?.dateOfInspection) {
      intDate = formatDDMMYYYY(job.internalDetails.dateOfInspection);
    } else if (job.internalDate) {
      intDate = formatDDMMYYYY(job.internalDate);
    } else if (isIntDone) {
      intDate = formatDDMMYYYY(job.dateOfIssue || job.mrDate || job.createdAt);
    }

    // Testing check
    const isTested = isDelivered || job.status === 'Tested - Ready for Dispatch' || Boolean(job.testingDate) || Boolean(job.testingDetails);
    let testDate = '-';
    if (job.testingDate) {
      testDate = formatDDMMYYYY(job.testingDate);
    } else if (job.testingDetails?.testDate) {
      testDate = formatDDMMYYYY(job.testingDetails.testDate);
    } else if (isTested) {
      testDate = formatDDMMYYYY(job.deliveryDate || job.challanDate || job.updatedAt || job.createdAt);
    }

    // Delivery check
    const deliveryDateStr = job.deliveryDate ? formatDDMMYYYY(job.deliveryDate) : job.challanDate ? formatDDMMYYYY(job.challanDate) : '-';

    // Receive / Inward Date
    const receiveDateStr = formatDDMMYYYY(job.dateOfIssue || job.receivedDate || job.mrDate || job.createdAt);

    // Estimate, Bill, Payment Dates
    const estimateSentDateStr = job.estimateSentDate ? formatDDMMYYYY(job.estimateSentDate) : job.estimateDate ? formatDDMMYYYY(job.estimateDate) : '-';
    const billSentDateStr = job.billSentDate ? formatDDMMYYYY(job.billSentDate) : job.billDate ? formatDDMMYYYY(job.billDate) : job.invoiceDate ? formatDDMMYYYY(job.invoiceDate) : '-';
    const paymentReceivedDateStr = job.paymentReceivedDate ? formatDDMMYYYY(job.paymentReceivedDate) : job.paymentDate ? formatDDMMYYYY(job.paymentDate) : '-';

    const calculatedEstimate = calculateJobEstimate(job);

    return {
      receiveDate: receiveDateStr,
      isExtDone,
      extDate: isExtDone ? (extDate !== '-' ? extDate : receiveDateStr) : '-',
      extStatus: isExtDone ? 'Done' : 'Pending',
      isIntDone,
      intDate: isIntDone ? (intDate !== '-' ? intDate : receiveDateStr) : '-',
      intStatus: isIntDone ? (isScrap ? 'Done (Scrap)' : 'Done') : 'Pending',
      isTested,
      testDate: isTested ? (testDate !== '-' ? testDate : receiveDateStr) : '-',
      testStatus: isTested ? 'Tested OK' : isScrap ? 'Scrap (No Test)' : 'Pending',
      isDelivered,
      deliveryDate: isDelivered ? deliveryDateStr : '-',
      deliveryStatus: isDelivered ? 'Delivered' : isTested ? 'Ready for Dispatch' : 'In Workshop',
      challanNo: job.challanNo || (isDelivered ? 'Dispatched' : '-'),
      vehicleNo: job.vehicleNo || '-',
      estimateSentDate: estimateSentDateStr,
      estimateRefNo: job.estimateRefNo || '-',
      estimateAmount: job.estimateAmount ? Number(job.estimateAmount) : calculatedEstimate,
      billSentDate: billSentDateStr,
      billNo: job.billNo || '-',
      billAmount: job.billAmount ? Number(job.billAmount) : (isDelivered ? calculatedEstimate : 0),
      paymentReceivedDate: paymentReceivedDateStr,
      paymentStatus: job.paymentStatus || (job.paymentReceivedDate ? 'Received' : 'Pending'),
      paymentAmount: job.paymentAmount ? Number(job.paymentAmount) : 0,
      paymentRefNo: job.paymentRefNo || job.paymentRemarks || '-'
    };
  };

  // Metric Stats
  const stats = useMemo(() => {
    let pendingExternal = 0;
    let pendingInternal = 0;
    let pendingTesting = 0;
    let readyForDispatch = 0;
    let dispatched = 0;
    let scrap = 0;
    let billedCount = 0;
    let paymentReceivedCount = 0;

    jobs.forEach(j => {
      const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
      if (isScrap) {
        scrap++;
      } else if (j.status === 'Dispatched') {
        dispatched++;
      } else if (j.status === 'Tested - Ready for Dispatch') {
        readyForDispatch++;
      } else if (j.status === 'Internal Done') {
        pendingTesting++;
      } else if (j.status === 'External Done') {
        pendingInternal++;
      } else {
        pendingExternal++;
      }

      if (j.billSentDate || j.billNo) billedCount++;
      if (j.paymentReceivedDate || j.paymentStatus === 'Received') paymentReceivedCount++;
    });

    return {
      total: jobs.length,
      pendingExternal,
      pendingInternal,
      pendingTesting,
      readyForDispatch,
      dispatched,
      scrap,
      billedCount,
      paymentReceivedCount
    };
  }, [jobs]);

  // Stage Badge helper
  const getStageBadge = (job: any) => {
    const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';
    if (isScrap) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
          <ShieldAlert className="w-3 h-3 mr-1" /> Scrap Job
        </span>
      );
    }
    if (job.status === 'Dispatched') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
          <Truck className="w-3 h-3 mr-1" /> Dispatched (Delivered)
        </span>
      );
    }
    if (job.status === 'Tested - Ready for Dispatch') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300">
          <Zap className="w-3 h-3 mr-1" /> Tested (Ready for Dispatch)
        </span>
      );
    }
    if (job.status === 'Internal Done') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
          <Wrench className="w-3 h-3 mr-1" /> Internal Done (Awaiting Testing)
        </span>
      );
    }
    if (job.status === 'External Done') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
          <Clock className="w-3 h-3 mr-1" /> External Done (Awaiting Internal)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-800 border border-slate-300">
        <Clock className="w-3 h-3 mr-1" /> Received (Awaiting External)
      </span>
    );
  };

  // Filtered jobs list
  const filteredJobs = useMemo(() => {
    return jobs.filter(j => {
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchNo = (j.jobNo || '').toLowerCase().includes(q);
        const matchMr = (j.mrNo || '').toLowerCase().includes(q);
        const matchMake = (j.make || '').toLowerCase().includes(q);
        const matchSerial = (j.serialNo || '').toLowerCase().includes(q);
        const matchChallan = (j.challanNo || '').toLowerCase().includes(q);
        const matchBill = (j.billNo || '').toLowerCase().includes(q);
        if (!matchNo && !matchMr && !matchMake && !matchSerial && !matchChallan && !matchBill) return false;
      }

      // Division filter
      if (divisionFilter !== 'All' && j.division !== divisionFilter) return false;
      if (!matchesGpFilter(j, gpFilter)) return false;

      // Stage filter
      const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
      if (stageFilter === 'Pending External' && (j.status === 'External Done' || j.status === 'Internal Done' || j.status === 'Tested - Ready for Dispatch' || j.status === 'Dispatched' || isScrap)) return false;
      if (stageFilter === 'Pending Internal' && j.status !== 'External Done') return false;
      if (stageFilter === 'Pending Testing' && j.status !== 'Internal Done') return false;
      if (stageFilter === 'Testing Ready' && j.status !== 'Tested - Ready for Dispatch') return false;
      if (stageFilter === 'Dispatched' && j.status !== 'Dispatched') return false;
      if (stageFilter === 'Scrap' && !isScrap) return false;

      // Tab specific rules
      if (activeTab === 'testing_ready' && (j.status !== 'Tested - Ready for Dispatch' || isScrap)) return false;
      if (activeTab === 'delivered' && j.status !== 'Dispatched') return false;
      if (activeTab === 'scrap' && !isScrap) return false;
      if (activeTab === 'pending' && (j.status === 'Dispatched')) return false;

      return true;
    });
  }, [jobs, searchQuery, divisionFilter, stageFilter, activeTab, gpFilter]);

  // Open Lifecycle Date Modal for a job
  const handleOpenDateModal = (job: any) => {
    setEditingJob(job);
    setDateFormData({
      estimateSentDate: job.estimateSentDate || job.estimateDate || '',
      estimateRefNo: job.estimateRefNo || '',
      estimateAmount: job.estimateAmount ? String(job.estimateAmount) : '',
      billSentDate: job.billSentDate || job.billDate || job.invoiceDate || '',
      billNo: job.billNo || job.invoiceNo || '',
      billAmount: job.billAmount ? String(job.billAmount) : '',
      paymentReceivedDate: job.paymentReceivedDate || job.paymentDate || '',
      paymentStatus: job.paymentStatus || (job.paymentReceivedDate ? 'Received' : 'Pending'),
      paymentAmount: job.paymentAmount ? String(job.paymentAmount) : '',
      paymentRefNo: job.paymentRefNo || job.paymentRemarks || ''
    });
    setApplyToAllInMr(true);
    setIsDateModalOpen(true);
  };

  // Save Lifecycle Dates to Firestore
  const handleSaveDates = async () => {
    if (!editingJob || !auth.currentUser) return;
    setSavingDates(true);
    try {
      const batch = writeBatch(db);
      const targetJobs = applyToAllInMr && editingJob.mrNo
        ? jobs.filter(j => j.mrNo === editingJob.mrNo)
        : [editingJob];

      const updatePayload: any = {
        updatedAt: new Date().toISOString()
      };

      if (dateFormData.estimateSentDate) updatePayload.estimateSentDate = dateFormData.estimateSentDate;
      if (dateFormData.estimateRefNo) updatePayload.estimateRefNo = dateFormData.estimateRefNo.trim();
      if (dateFormData.estimateAmount) updatePayload.estimateAmount = Number(dateFormData.estimateAmount) || 0;
      if (dateFormData.billSentDate) updatePayload.billSentDate = dateFormData.billSentDate;
      if (dateFormData.billNo) updatePayload.billNo = dateFormData.billNo.trim();
      if (dateFormData.billAmount) updatePayload.billAmount = Number(dateFormData.billAmount) || 0;
      if (dateFormData.paymentReceivedDate) updatePayload.paymentReceivedDate = dateFormData.paymentReceivedDate;
      if (dateFormData.paymentStatus) updatePayload.paymentStatus = dateFormData.paymentStatus;
      if (dateFormData.paymentAmount) updatePayload.paymentAmount = Number(dateFormData.paymentAmount) || 0;
      if (dateFormData.paymentRefNo) updatePayload.paymentRefNo = dateFormData.paymentRefNo.trim();

      targetJobs.forEach(job => {
        const jobRef = doc(db, 'jobs', job.id);
        batch.update(jobRef, updatePayload);
      });

      await batch.commit();

      // Update local state
      setJobs(prev => prev.map(j => {
        if (targetJobs.some(tj => tj.id === j.id)) {
          return { ...j, ...updatePayload };
        }
        return j;
      }));

      setIsDateModalOpen(false);
      setEditingJob(null);
    } catch (err: any) {
      console.error(err);
      alert('Failed to save lifecycle dates: ' + (err.message || err.toString()));
    } finally {
      setSavingDates(false);
    }
  };

  // Export Complete Lifecycle Report to Excel (MR No wise and Date wise)
  const handleExportExcel = () => {
    // Sort jobs MR No wise and Date wise
    const sortedJobsForExport = [...filteredJobs].sort((a, b) => {
      // 1. Date comparison
      const dateA = a.dateOfIssue || a.mrDate || a.createdAt || '';
      const dateB = b.dateOfIssue || b.mrDate || b.createdAt || '';
      // Newest first, undated last - matches every list in the app.
      if (dateA && !dateB) return -1;
      if (!dateA && dateB) return 1;
      const dateCompare = dateB.localeCompare(dateA);
      if (dateCompare !== 0) return dateCompare;

      // 2. MR No comparison
      const mrA = a.mrNo || '';
      const mrB = b.mrNo || '';
      const mrCompare = mrA.localeCompare(mrB, undefined, { numeric: true });
      if (mrCompare !== 0) return mrCompare;

      // 3. Job No comparison
      const jobA = a.jobNo || '';
      const jobB = b.jobNo || '';
      return jobA.localeCompare(jobB, undefined, { numeric: true });
    });

    const exportRows: any[] = [];

    sortedJobsForExport.forEach((job, idx) => {
      const cycle = getJobLifecycle(job);
      const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';

      exportRows.push({
        'S.N.': idx + 1,
        'MR No': job.mrNo || '',
        'MR Date (Receive Date)': cycle.receiveDate,
        'Job No': job.jobNo || '',
        'Division': job.division || '',
        'Capacity (KVA)': job.capacityKva || '',
        'Make': job.make || '',
        'Serial No': job.serialNo || '',
        'Core Type': job.coreType || 'CRGO',
        'Repair Type': job.repairType || (isScrap ? 'Scrap' : 'Repairable'),
        'Job Condition': isScrap ? 'Scrap - Return to Division' : 'Repairable',
        'Current Stage / Status': isScrap ? 'Scrap Job' : (job.status || 'Received'),
        'External Insp Date': cycle.extDate,
        'External Insp Status': cycle.extStatus,
        'Internal Insp Date': cycle.intDate,
        'Internal Insp Status': cycle.intStatus,
        'Testing Date': cycle.testDate,
        'Testing Status': cycle.testStatus,
        'Delivery Challan No': cycle.challanNo,
        'Delivery Date': cycle.deliveryDate,
        'Delivery Vehicle No': cycle.vehicleNo,
        'Delivery Status': cycle.deliveryStatus,
        'Estimate Sent Date': cycle.estimateSentDate,
        'Estimate Ref No': cycle.estimateRefNo,
        'Estimate Amount (₹)': cycle.estimateAmount || 0,
        'Bill Sent Date (Invoice Date)': cycle.billSentDate,
        'Bill No (Invoice No)': cycle.billNo,
        'Bill Amount (₹)': cycle.billAmount || 0,
        'Payment Received Date': cycle.paymentReceivedDate,
        'Payment Status': cycle.paymentStatus,
        'Payment Amount (₹)': cycle.paymentAmount || 0,
        'Payment UTR / Ref No': cycle.paymentRefNo
      });
    });

    const ws = XLSX.utils.json_to_sheet(exportRows);

    // Auto-fit column widths
    const colWidths = Object.keys(exportRows[0] || {}).map(key => {
      const maxLen = Math.max(
        key.length,
        ...exportRows.map(r => String(r[key] || '').length)
      );
      return { wch: Math.min(Math.max(maxLen + 3, 10), 40) };
    });
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    const sheetName = activeTab === 'master' ? 'FULL_CYCLE_REPORT' : activeTab.toUpperCase();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    
    const fileName = `Transformer_Complete_Cycle_Report_${activeAgency?.name ? activeAgency.name.replace(/\s+/g, '_') : 'Agency'}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <FileSpreadsheet className="w-7 h-7 text-blue-600" />
            Report Hub & Complete Job Lifecycle
          </h1>
          <p className="text-sm text-slate-500">
            End-to-end tracking MR-wise & Date-wise: Receive → Inspection → Testing → Delivery → Estimate → Bill → Payment
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors shadow-sm"
            title="Refresh Data"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-xs font-bold uppercase tracking-wider rounded hover:bg-emerald-700 transition-colors shadow-sm"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Download Complete Cycle Excel ({filteredJobs.length})
          </button>
        </div>
      </div>

      {/* Quick Metric Dashboard */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm text-center">
          <div className="text-xl font-black text-slate-900">{stats.total}</div>
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-1">Total Jobs</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm text-center">
          <div className="text-xl font-black text-amber-600">{stats.pendingExternal + stats.pendingInternal}</div>
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-1">In Inspection</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm text-center">
          <div className="text-xl font-black text-blue-600">{stats.pendingTesting}</div>
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-1">In Testing</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm text-center">
          <div className="text-xl font-black text-indigo-600">{stats.readyForDispatch}</div>
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-1">Ready Dispatch</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm text-center">
          <div className="text-xl font-black text-emerald-600">{stats.dispatched}</div>
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-1">Delivered</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm text-center">
          <div className="text-xl font-black text-purple-600">{stats.billedCount}</div>
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-1">Bills Sent</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm text-center">
          <div className="text-xl font-black text-teal-600">{stats.paymentReceivedCount}</div>
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-1">Payments Recv</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm text-center">
          <div className="text-xl font-black text-rose-600">{stats.scrap}</div>
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-1">Scrap Jobs</div>
        </div>
      </div>

      {/* Main Card with Navigation Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        
        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50/50 overflow-x-auto">
          <button
            onClick={() => setActiveTab('master')}
            className={`px-5 py-3.5 text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === 'master'
                ? 'bg-white text-blue-700 border-b-2 border-blue-600 shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <FileText className="w-4 h-4 text-blue-600" />
            Master All Jobs ({jobs.length})
          </button>

          <button
            onClick={() => setActiveTab('pending')}
            className={`px-5 py-3.5 text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === 'pending'
                ? 'bg-white text-amber-700 border-b-2 border-amber-600 shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Clock className="w-4 h-4 text-amber-600" />
            Pending Stage Jobs ({stats.total - stats.dispatched})
          </button>

          <button
            onClick={() => setActiveTab('testing_ready')}
            className={`px-5 py-3.5 text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === 'testing_ready'
                ? 'bg-white text-indigo-700 border-b-2 border-indigo-600 shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Zap className="w-4 h-4 text-indigo-600" />
            Testing Ready ({stats.readyForDispatch})
          </button>

          <button
            onClick={() => setActiveTab('delivered')}
            className={`px-5 py-3.5 text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === 'delivered'
                ? 'bg-white text-emerald-700 border-b-2 border-emerald-600 shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Truck className="w-4 h-4 text-emerald-600" />
            Dispatched & Delivered ({stats.dispatched})
          </button>

          <button
            onClick={() => setActiveTab('scrap')}
            className={`px-5 py-3.5 text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-colors flex items-center gap-2 ${
              activeTab === 'scrap'
                ? 'bg-white text-rose-700 border-b-2 border-rose-600 shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ShieldAlert className="w-4 h-4 text-rose-600" />
            Scrap Report ({stats.scrap})
          </button>
        </div>

        {/* Toolbar & Filters */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row gap-3 justify-between items-center">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search Job No, MR, Make, Serial, Bill..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 w-full bg-white"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {/* Division Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-500 uppercase">Division:</span>
              <select
                value={gpFilter}
                onChange={(e) => setGpFilter(e.target.value as GpFilter)}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                title="Filter by repair type - GP repairs are done under guarantee at no cost"
              >
                {GP_FILTER_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>

              <select
                value={divisionFilter}
                onChange={(e) => setDivisionFilter(e.target.value)}
                className="py-1.5 px-3 text-xs border border-slate-300 rounded bg-white text-slate-800 font-medium"
              >
                <option value="All">All Divisions</option>
                {divisions.map(div => (
                  <option key={div} value={div}>{div} Division</option>
                ))}
              </select>
            </div>

            {/* Stage Filter */}
            {activeTab === 'master' || activeTab === 'pending' ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-500 uppercase">Stage:</span>
                <select
                  value={stageFilter}
                  onChange={(e) => setStageFilter(e.target.value)}
                  className="py-1.5 px-3 text-xs border border-slate-300 rounded bg-white text-slate-800 font-medium"
                >
                  <option value="All">All Stages</option>
                  <option value="Pending External">Pending External Inspection</option>
                  <option value="Pending Internal">Pending Internal Inspection</option>
                  <option value="Pending Testing">Pending Testing Report</option>
                  <option value="Testing Ready">Testing Ready (Pending Delivery)</option>
                  <option value="Dispatched">Dispatched / Delivered</option>
                  <option value="Scrap">Scrap Jobs</option>
                </select>
              </div>
            ) : null}
          </div>
        </div>

        {/* Detailed Data Table */}
        <div className="overflow-x-auto">
          {filteredJobs.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              No matching job records found for this report filter.
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-3 font-bold uppercase tracking-wider text-[10px]">#</th>
                  <th className="px-3 py-3 font-bold uppercase tracking-wider text-[10px]">Job No</th>
                  <th className="px-3 py-3 font-bold uppercase tracking-wider text-[10px]">MR No & Date</th>
                  <th className="px-3 py-3 font-bold uppercase tracking-wider text-[10px]">Division</th>
                  <th className="px-3 py-3 font-bold uppercase tracking-wider text-[10px]">Capacity & Make</th>
                  <th className="px-3 py-3 font-bold uppercase tracking-wider text-[10px]">Serial No</th>
                  <th className="px-3 py-3 font-bold uppercase tracking-wider text-[10px]">Current Stage</th>
                  <th className="px-3 py-3 font-bold uppercase tracking-wider text-[10px]">Inspections & Testing</th>
                  <th className="px-3 py-3 font-bold uppercase tracking-wider text-[10px]">Delivery Challan</th>
                  <th className="px-3 py-3 font-bold uppercase tracking-wider text-[10px]">Estimate & Billing</th>
                  <th className="px-3 py-3 font-bold uppercase tracking-wider text-[10px]">Payment Status</th>
                  <th className="px-3 py-3 font-bold uppercase tracking-wider text-[10px] text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredJobs.map((job, idx) => {
                  const cycle = getJobLifecycle(job);
                  const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';

                  return (
                    <tr key={job.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-3 text-slate-400 font-mono">{idx + 1}</td>
                      <td className="px-3 py-3 font-mono font-bold">
                        <span className="flex items-center gap-1.5">
                          <span className={matchesGpFilter(job, 'GP') ? GP_TEXT_CLASS : 'text-slate-900'}>{job.jobNo}</span>
                          {matchesGpFilter(job, 'GP') && <GpChip />}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-mono font-bold text-slate-800">{job.mrNo || 'N/A'}</div>
                        <div className="text-[10px] text-slate-500">{cycle.receiveDate}</div>
                      </td>
                      <td className="px-3 py-3 font-medium text-slate-700">{job.division || '-'}</td>
                      <td className="px-3 py-3">
                        <div className="font-bold text-slate-800">{job.capacityKva} KVA</div>
                        <div className="text-[10px] text-slate-500">{job.make || '-'} ({job.coreType || 'CRGO'})</div>
                      </td>
                      <td className="px-3 py-3 font-mono text-slate-700">{job.serialNo || '-'}</td>
                      <td className="px-3 py-3">
                        {getStageBadge(job)}
                      </td>
                      <td className="px-3 py-3 text-[11px] space-y-0.5">
                        <div className="flex items-center gap-1 text-slate-600">
                          <span className="font-bold text-slate-800">Ext:</span>
                          <span className={cycle.isExtDone ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>
                            {cycle.isExtDone ? `Done (${cycle.extDate})` : 'Pending'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-slate-600">
                          <span className="font-bold text-slate-800">Int:</span>
                          <span className={cycle.isIntDone ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>
                            {cycle.isIntDone ? `Done (${cycle.intDate})` : 'Pending'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-slate-600">
                          <span className="font-bold text-slate-800">Test:</span>
                          <span className={cycle.isTested ? 'text-blue-700 font-medium' : isScrap ? 'text-rose-700 font-medium' : 'text-slate-500'}>
                            {cycle.isTested ? `Tested (${cycle.testDate})` : isScrap ? 'Scrap (No Test)' : 'Pending'}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {cycle.isDelivered ? (
                          <div className="space-y-0.5">
                            <div className="font-mono font-bold text-emerald-800">{cycle.challanNo}</div>
                            <div className="text-[10px] text-slate-500">Date: {cycle.deliveryDate}</div>
                            <div className="text-[10px] text-slate-500">Vehicle: {cycle.vehicleNo}</div>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Not Dispatched</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[11px] space-y-0.5">
                        <div className="text-slate-600">
                          <span className="font-bold text-slate-800">Est Sent:</span> {cycle.estimateSentDate !== '-' ? cycle.estimateSentDate : 'Not Recorded'}
                        </div>
                        <div className="text-slate-600">
                          <span className="font-bold text-slate-800">Bill Sent:</span> {cycle.billSentDate !== '-' ? `${cycle.billSentDate} (${cycle.billNo})` : 'Not Recorded'}
                        </div>
                        {cycle.billAmount > 0 && (
                          <div className="text-slate-500 font-mono text-[10px]">
                            ₹{cycle.billAmount.toLocaleString('en-IN')}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {cycle.paymentStatus === 'Received' || cycle.paymentReceivedDate !== '-' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" /> Received ({cycle.paymentReceivedDate})
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-300">
                            <Clock className="w-3 h-3 mr-1 text-slate-400" /> Pending Payment
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          onClick={() => handleOpenDateModal(job)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-300 hover:border-blue-300 rounded transition-colors"
                          title="Record / Edit Estimate, Bill, and Payment Dates"
                        >
                          <Edit3 className="w-3 h-3" />
                          Dates
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer Summary */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex justify-between items-center">
          <div>Showing <strong>{filteredJobs.length}</strong> of <strong>{jobs.length}</strong> total job records</div>
          <div>Report generated for <strong>{activeAgency?.name}</strong></div>
        </div>
      </div>

      {/* LIFECYCLE DATE MANAGER MODAL */}
      {isDateModalOpen && editingJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-2xl w-full border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200">
              <div className="flex items-center space-x-2 text-slate-800">
                <Calendar className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-base">
                  Update Job Cycle Dates & Payment Tracking
                </h3>
              </div>
              <button 
                onClick={() => { setIsDateModalOpen(false); setEditingJob(null); }} 
                className="text-slate-400 hover:text-slate-600 p-1 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <span className="text-slate-400 block uppercase font-bold text-[10px]">Job No</span>
                <span className="font-bold font-mono text-slate-800 text-sm">{editingJob.jobNo}</span>
              </div>
              <div>
                <span className="text-slate-400 block uppercase font-bold text-[10px]">MR No</span>
                <span className="font-bold font-mono text-slate-800 text-sm">{editingJob.mrNo}</span>
              </div>
              <div>
                <span className="text-slate-400 block uppercase font-bold text-[10px]">Division</span>
                <span className="font-medium text-slate-700">{editingJob.division}</span>
              </div>
              <div>
                <span className="text-slate-400 block uppercase font-bold text-[10px]">Capacity</span>
                <span className="font-medium text-slate-700">{editingJob.capacityKva} KVA ({editingJob.make})</span>
              </div>
            </div>

            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              
              {/* Estimate Section */}
              <div className="border border-slate-200 rounded-lg p-3 bg-purple-50/40">
                <div className="flex items-center gap-1.5 text-purple-900 font-bold text-xs uppercase mb-2">
                  <FileText className="w-4 h-4 text-purple-600" />
                  Estimate Submission Details
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Estimate Sent Date</label>
                    <input
                      type="date"
                      value={dateFormData.estimateSentDate}
                      onChange={e => setDateFormData(prev => ({ ...prev, estimateSentDate: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-xs border rounded bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Estimate Reference / Letter No</label>
                    <input
                      type="text"
                      placeholder="e.g. UGVCL/EST/105"
                      value={dateFormData.estimateRefNo}
                      onChange={e => setDateFormData(prev => ({ ...prev, estimateRefNo: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-xs border rounded bg-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Estimate Amount (₹)</label>
                    <input
                      type="number"
                      placeholder="e.g. 18500"
                      value={dateFormData.estimateAmount}
                      onChange={e => setDateFormData(prev => ({ ...prev, estimateAmount: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-xs border rounded bg-white font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Billing / Invoice Section */}
              <div className="border border-slate-200 rounded-lg p-3 bg-blue-50/40">
                <div className="flex items-center gap-1.5 text-blue-900 font-bold text-xs uppercase mb-2">
                  <Receipt className="w-4 h-4 text-blue-600" />
                  Bill / Invoice Submission Details
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Bill Sent Date</label>
                    <input
                      type="date"
                      value={dateFormData.billSentDate}
                      onChange={e => setDateFormData(prev => ({ ...prev, billSentDate: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-xs border rounded bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Bill / Invoice No</label>
                    <input
                      type="text"
                      placeholder="e.g. HE/T-42/26-27"
                      value={dateFormData.billNo}
                      onChange={e => setDateFormData(prev => ({ ...prev, billNo: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-xs border rounded bg-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Bill Amount (₹)</label>
                    <input
                      type="number"
                      placeholder="e.g. 21400"
                      value={dateFormData.billAmount}
                      onChange={e => setDateFormData(prev => ({ ...prev, billAmount: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-xs border rounded bg-white font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Payment Section */}
              <div className="border border-slate-200 rounded-lg p-3 bg-emerald-50/40">
                <div className="flex items-center gap-1.5 text-emerald-900 font-bold text-xs uppercase mb-2">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                  Payment Receipt & Settlement
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Payment Received Date</label>
                    <input
                      type="date"
                      value={dateFormData.paymentReceivedDate}
                      onChange={e => setDateFormData(prev => ({ ...prev, paymentReceivedDate: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-xs border rounded bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Payment Status</label>
                    <select
                      value={dateFormData.paymentStatus}
                      onChange={e => setDateFormData(prev => ({ ...prev, paymentStatus: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-xs border rounded bg-white"
                    >
                      <option value="Pending">Pending</option>
                      <option value="Received">Received / Full Settlement</option>
                      <option value="Partially Paid">Partially Paid</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Payment Amount Received (₹)</label>
                    <input
                      type="number"
                      placeholder="e.g. 21400"
                      value={dateFormData.paymentAmount}
                      onChange={e => setDateFormData(prev => ({ ...prev, paymentAmount: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-xs border rounded bg-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">UTR / Cheque / Ref No / Remarks</label>
                    <input
                      type="text"
                      placeholder="e.g. UTR#SBIN20260312001"
                      value={dateFormData.paymentRefNo}
                      onChange={e => setDateFormData(prev => ({ ...prev, paymentRefNo: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-xs border rounded bg-white font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Batch Apply Option */}
              {editingJob.mrNo && (
                <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg flex items-center space-x-2 text-xs text-amber-900">
                  <input
                    type="checkbox"
                    id="applyToAllInMrCheck"
                    checked={applyToAllInMr}
                    onChange={e => setApplyToAllInMr(e.target.checked)}
                    className="rounded text-amber-600 focus:ring-amber-500 w-4 h-4"
                  />
                  <label htmlFor="applyToAllInMrCheck" className="cursor-pointer font-medium">
                    Apply these lifecycle dates to <strong>all jobs under MR No. {editingJob.mrNo}</strong> ({jobs.filter(j => j.mrNo === editingJob.mrNo).length} transformers)
                  </label>
                </div>
              )}

            </div>

            <div className="mt-6 pt-4 border-t border-slate-200 flex justify-end space-x-3">
              <button 
                onClick={() => { setIsDateModalOpen(false); setEditingJob(null); }} 
                className="px-4 py-2 text-xs font-bold uppercase text-slate-600 hover:text-slate-800 border rounded"
                disabled={savingDates}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDates}
                disabled={savingDates}
                className="px-5 py-2 text-xs font-bold uppercase bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center shadow-sm disabled:opacity-50"
              >
                {savingDates ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-1.5" />
                    Save Dates & Sync Cycle
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

