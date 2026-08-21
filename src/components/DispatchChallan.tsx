import React, { useState, useEffect, useMemo } from 'react';
import { useAgency } from '../lib/AgencyContext';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { 
  Loader2, 
  Printer, 
  Search, 
  Truck, 
  CheckCircle2, 
  History, 
  FileSpreadsheet, 
  FileText, 
  Filter, 
  RotateCcw, 
  LayoutGrid, 
  List, 
  X, 
  CheckSquare, 
  Calendar,
  PackageCheck,
  Hash,
  Sparkles,
  ArrowRight,
  AlertCircle,
  Clock,
  ShieldCheck
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { LetterheadHeader, PrintableA4Page } from './LetterheadHeader';
import { formatDDMMYYYY, byDateDesc } from '../lib/utils';
import { GP_TEXT_CLASS, GpChip, GP_FILTER_OPTIONS, matchesGpFilter, GpFilter } from '../lib/jobDisplay';
import { downloadHtmlAsWord } from '../lib/wordExport';
import { triggerUniversalPrint } from '../lib/printUtils';
import appLogo from '../assets/images/transformer_app_logo_1786648240128.jpg';

export default function DispatchChallan() {
  const { activeAgency, activeAtMaster } = useAgency();
  const [allJobs, setAllJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  
  // Pending Tab Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [jobCategoryFilter, setJobCategoryFilter] = useState<'All' | 'Repairable' | 'Scrap'>('All');
  const [selectedDivision, setSelectedDivision] = useState('All');
  const [mrFilter, setMrFilter] = useState('All');
  const [gpFilter, setGpFilter] = useState<GpFilter>('All');
  // Pending list is ordered by test date, most recently tested first by default.
  const [testDateSortDir, setTestDateSortDir] = useState<'desc' | 'asc'>('desc');
  
  // Delivered Jobs (History) Filters
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [historyDivisionFilter, setHistoryDivisionFilter] = useState('All');
  const [historyMrFilter, setHistoryMrFilter] = useState('All');
  const [historyGpFilter, setHistoryGpFilter] = useState<GpFilter>('All');
  const [historyCategoryFilter, setHistoryCategoryFilter] = useState<'All' | 'Repairable' | 'Scrap'>('All');
  const [historyViewMode, setHistoryViewMode] = useState<'cards' | 'table'>('cards');
  
  // Challan Form Inputs
  const [challanNo, setChallanNo] = useState('');
  const [challanDate, setChallanDate] = useState(new Date().toISOString().split('T')[0]);
  const [vehicleNo, setVehicleNo] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  
  const [printData, setPrintData] = useState<any>(null); // To handle printing past challans

  // Fetch Jobs from Firestore
  const fetchJobs = async () => {
    if (!auth.currentUser || !activeAgency) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const q = query(
        collection(db, 'jobs'),
        where('ownerId', '==', auth.currentUser.uid), 
        where('agencyId', '==', activeAgency.id)
      );
      const snapshot = await getDocs(q);
      const fetchedJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any));
      setAllJobs(fetchedJobs);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.LIST, 'jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [activeAgency?.id]);

  // Derived pending jobs (includes both Tested Repairable jobs and Scrap Jobs ready for return)
  const pendingJobs = useMemo(() => {
    return allJobs.filter(j => {
      if (j.status === 'Dispatched' || j.isClosed === true) return false;
      const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
      const isTested = j.status === 'Tested - Ready for Dispatch';
      return isTested || isScrap;
    }).sort((a, b) => (a.jobNo || '').localeCompare(b.jobNo || '', undefined, { numeric: true }));
  }, [allJobs]);

  const repairableCount = useMemo(() => {
    return pendingJobs.filter(j => j.status === 'Tested - Ready for Dispatch' && j.condition !== 'Scrap').length;
  }, [pendingJobs]);

  const scrapCount = useMemo(() => {
    return pendingJobs.filter(j => j.status === 'Scrap' || j.condition === 'Scrap').length;
  }, [pendingJobs]);

  // Extract all available divisions
  const availableDivisions = useMemo(() => {
    const set = new Set<string>();
    const currentPrefixes = (activeAtMaster && activeAtMaster.prefixes && Object.keys(activeAtMaster.prefixes).length > 0) 
        ? activeAtMaster.prefixes 
        : (activeAgency?.prefixes || {});
    
    Object.keys(currentPrefixes).forEach(d => {
      if (d && d.trim()) set.add(d.trim());
    });

    pendingJobs.forEach(j => {
      if (j.division && j.division.trim()) set.add(j.division.trim());
    });

    return Array.from(set).sort();
  }, [activeAtMaster, activeAgency, pendingJobs]);

  // Everything the pending list matches EXCEPT the MR dropdown. The MR options are
  // built from this, so an MR with nothing left in it after the other filters never
  // appears as a choice.
  const pendingJobsBeforeMr = useMemo(() => {
    let result = pendingJobs;
    if (jobCategoryFilter === 'Repairable') {
      result = result.filter(j => j.status === 'Tested - Ready for Dispatch' && j.condition !== 'Scrap');
    } else if (jobCategoryFilter === 'Scrap') {
      result = result.filter(j => j.status === 'Scrap' || j.condition === 'Scrap');
    }
    if (selectedDivision !== 'All') {
      result = result.filter(j => (j.division || '').trim().toLowerCase() === selectedDivision.trim().toLowerCase());
    }
    if (gpFilter !== 'All') {
      result = result.filter(j => matchesGpFilter(j, gpFilter));
    }
    if (searchQuery.trim()) {
      const lowerQ = searchQuery.toLowerCase().trim();
      result = result.filter(j =>
        (j.jobNo || '').toLowerCase().includes(lowerQ) ||
        (j.mrNo || '').toLowerCase().includes(lowerQ) ||
        (j.division || '').toLowerCase().includes(lowerQ) ||
        (j.make || '').toLowerCase().includes(lowerQ) ||
        (j.serialNo || '').toLowerCase().includes(lowerQ) ||
        (j.capacityKva || '').toString().includes(lowerQ)
      );
    }
    return result;
  }, [pendingJobs, jobCategoryFilter, searchQuery, selectedDivision, gpFilter]);

  const pendingMrOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    pendingJobsBeforeMr.forEach(j => {
      if (j.mrNo) counts[j.mrNo] = (counts[j.mrNo] || 0) + 1;
    });
    return Object.keys(counts)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map(mrNo => ({ mrNo, count: counts[mrNo] }));
  }, [pendingJobsBeforeMr]);

  // If the other filters leave the selected MR with nothing, fall back to "All MRs"
  // rather than showing an empty list with no explanation.
  useEffect(() => {
    if (mrFilter !== 'All' && !pendingMrOptions.some(o => o.mrNo === mrFilter)) {
      setMrFilter('All');
    }
  }, [pendingMrOptions, mrFilter]);

  const filteredPendingJobs = useMemo(() => {
    const base = mrFilter === 'All'
      ? pendingJobsBeforeMr
      : pendingJobsBeforeMr.filter(j => j.mrNo === mrFilter);

    // Sorted on a COPY - pendingJobsBeforeMr feeds the counts above the table and
    // must not be reordered. testingDate is an ISO yyyy-mm-dd string, so a plain
    // string compare sorts it correctly without Date parsing. Jobs with no test date
    // (scrap returns, which are never tested) always sort LAST, in both directions -
    // a missing date must never read as the newest.
    return [...base].sort((a, b) => {
      const aDate = a.testingDate || '';
      const bDate = b.testingDate || '';
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return testDateSortDir === 'desc' ? bDate.localeCompare(aDate) : aDate.localeCompare(bDate);
    });
  }, [pendingJobsBeforeMr, mrFilter, testDateSortDir]);

  // Derived dispatched jobs list
  const allDispatchedJobs = useMemo(() => {
    return allJobs.filter(j => j.status === 'Dispatched' && j.challanNo);
  }, [allJobs]);

  const historyAvailableDivisions = useMemo(() => {
    const divs = new Set(allDispatchedJobs.map(j => j.division).filter(Boolean));
    return ['All', ...Array.from(divs)].sort();
  }, [allDispatchedJobs]);

  // Dispatched-tab MR options, same shape as the pending tab's: built from the jobs
  // that pass the OTHER dispatched filters, numerically-aware ascending, with counts.
  const historyJobsBeforeMr = useMemo(() => {
    return allDispatchedJobs.filter(j => {
      if (historyDivisionFilter !== 'All' && j.division !== historyDivisionFilter) return false;
      const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
      if (historyCategoryFilter === 'Repairable' && isScrap) return false;
      if (historyCategoryFilter === 'Scrap' && !isScrap) return false;
      if (!matchesGpFilter(j, historyGpFilter)) return false;
      if (historySearchQuery.trim()) {
        const q = historySearchQuery.toLowerCase().trim();
        const hit = [j.jobNo, j.mrNo, j.challanNo, j.vehicleNo, j.make, j.serialNo, j.division, j.capacityKva]
          .some(v => (v || '').toString().toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [allDispatchedJobs, historyDivisionFilter, historyCategoryFilter, historySearchQuery, historyGpFilter]);

  const historyMrOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    historyJobsBeforeMr.forEach(j => {
      if (j.mrNo) counts[j.mrNo] = (counts[j.mrNo] || 0) + 1;
    });
    return Object.keys(counts)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map(mrNo => ({ mrNo, count: counts[mrNo] }));
  }, [historyJobsBeforeMr]);

  useEffect(() => {
    if (historyMrFilter !== 'All' && !historyMrOptions.some(o => o.mrNo === historyMrFilter)) {
      setHistoryMrFilter('All');
    }
  }, [historyMrOptions, historyMrFilter]);

  // Filtered dispatched jobs
  const filteredDispatchedJobs = useMemo(() => {
    return allDispatchedJobs.filter(j => {
      // Division filter
      if (historyDivisionFilter !== 'All' && j.division !== historyDivisionFilter) {
        return false;
      }
      // MR filter
      if (historyMrFilter !== 'All' && j.mrNo !== historyMrFilter) {
        return false;
      }
      // Category filter
      const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
      if (historyCategoryFilter === 'Repairable' && isScrap) return false;
      if (historyCategoryFilter === 'Scrap' && !isScrap) return false;
      if (!matchesGpFilter(j, historyGpFilter)) return false;

      // Search query
      if (historySearchQuery.trim()) {
        const q = historySearchQuery.toLowerCase().trim();
        const matchJob = (j.jobNo || '').toLowerCase().includes(q);
        const matchMr = (j.mrNo || '').toLowerCase().includes(q);
        const matchChallan = (j.challanNo || '').toLowerCase().includes(q);
        const matchVehicle = (j.vehicleNo || '').toLowerCase().includes(q);
        const matchMake = (j.make || '').toLowerCase().includes(q);
        const matchSerial = (j.serialNo || '').toLowerCase().includes(q);
        const matchDiv = (j.division || '').toLowerCase().includes(q);
        const matchCap = (j.capacityKva || '').toString().toLowerCase().includes(q);
        if (!matchJob && !matchMr && !matchChallan && !matchVehicle && !matchMake && !matchSerial && !matchDiv && !matchCap) {
          return false;
        }
      }
      return true;
    }).sort(byDateDesc<any>(
      j => j.deliveryDate || j.challanDate,
      (x, y) => (x.jobNo || '').localeCompare(y.jobNo || '', undefined, { numeric: true })
    ));
  }, [allDispatchedJobs, historyDivisionFilter, historyMrFilter, historyCategoryFilter, historySearchQuery, historyGpFilter]);

  // Group filtered jobs into challan groups
  const filteredChallanHistory = useMemo(() => {
    const groups: Record<string, { 
      jobs: any[], 
      allJobsInChallan: any[],
      challanDate: string, 
      vehicleNo: string, 
      deliveryDate: string,
      divisions: string[],
      mrNos: string[]
    }> = {};
    
    allDispatchedJobs.forEach(job => {
      if (!groups[job.challanNo]) {
        groups[job.challanNo] = {
          jobs: [],
          allJobsInChallan: [],
          challanDate: job.challanDate || '',
          vehicleNo: job.vehicleNo || '',
          deliveryDate: job.deliveryDate || '',
          divisions: [],
          mrNos: []
        };
      }
      groups[job.challanNo].allJobsInChallan.push(job);
      if (job.division && !groups[job.challanNo].divisions.includes(job.division)) {
        groups[job.challanNo].divisions.push(job.division);
      }
      if (job.mrNo && !groups[job.challanNo].mrNos.includes(job.mrNo)) {
        groups[job.challanNo].mrNos.push(job.mrNo);
      }
    });

    filteredDispatchedJobs.forEach(job => {
      if (groups[job.challanNo]) {
        groups[job.challanNo].jobs.push(job);
      }
    });
    
    return Object.entries(groups)
      .filter(([_, data]) => data.jobs.length > 0)
      .sort(byDateDesc(entry => entry[1].challanDate));
  }, [allDispatchedJobs, filteredDispatchedJobs]);

  const historyRepairableCount = useMemo(() => {
    return filteredDispatchedJobs.filter(j => j.status !== 'Scrap' && j.condition !== 'Scrap').length;
  }, [filteredDispatchedJobs]);

  const historyScrapCount = useMemo(() => {
    return filteredDispatchedJobs.filter(j => j.status === 'Scrap' || j.condition === 'Scrap').length;
  }, [filteredDispatchedJobs]);

  const handleToggleJob = (id: string) => {
    const next = new Set(selectedJobIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedJobIds(next);
  };
  
  const handleSelectAllFiltered = () => {
    const next = new Set(selectedJobIds);
    let allSelected = true;
    for (const job of filteredPendingJobs) {
       if (!next.has(job.id)) {
           allSelected = false;
           break;
       }
    }
    
    if (allSelected) {
        filteredPendingJobs.forEach(job => next.delete(job.id));
    } else {
        filteredPendingJobs.forEach(job => next.add(job.id));
    }
    setSelectedJobIds(next);
  };

  const handleClearSelection = () => {
    setSelectedJobIds(new Set());
  };

  const selectedJobs = useMemo(() => {
    return pendingJobs.filter(j => selectedJobIds.has(j.id));
  }, [pendingJobs, selectedJobIds]);

  const selectedTotalKva = useMemo(() => {
    return selectedJobs.reduce((sum, j) => sum + (Number(j.capacityKva) || 0), 0);
  }, [selectedJobs]);

  const selectedRepairCount = useMemo(() => {
    return selectedJobs.filter(j => j.status !== 'Scrap' && j.condition !== 'Scrap').length;
  }, [selectedJobs]);

  const selectedScrapCount = useMemo(() => {
    return selectedJobs.filter(j => j.status === 'Scrap' || j.condition === 'Scrap').length;
  }, [selectedJobs]);

  const uniqueDivisions = useMemo(() => {
    return [...new Set(selectedJobs.map(j => j.division).filter(Boolean))].join(', ');
  }, [selectedJobs]);

  const uniqueMrNos = useMemo(() => {
    return [...new Set(selectedJobs.map(j => j.mrNo).filter(Boolean))].join(', ');
  }, [selectedJobs]);

  const handleDispatch = async () => {
    if (selectedJobIds.size === 0) return;
    if (!challanNo.trim() || !vehicleNo.trim()) {
        alert("Please enter Challan No and Vehicle No.");
        return;
    }
    
    setLoading(true);
    try {
      const batch = writeBatch(db);
      for (const job of selectedJobs) {
        const ref = doc(db, 'jobs', job.id);
        batch.update(ref, {
          status: 'Dispatched',
          challanNo: challanNo.trim(),
          challanDate,
          vehicleNo: vehicleNo.trim().toUpperCase(),
          deliveryDate,
          isClosed: true,
          updatedAt: new Date().toISOString()
        });
      }
      await batch.commit();
      
      setAllJobs(prev => prev.map(job => {
          if (selectedJobIds.has(job.id)) {
              return {
                  ...job,
                  status: 'Dispatched',
                  challanNo: challanNo.trim(),
                  challanDate,
                  vehicleNo: vehicleNo.trim().toUpperCase(),
                  deliveryDate,
                  isClosed: true
              };
          }
          return job;
      }));

      const dataToPrint = {
          jobs: selectedJobs,
          challanNo: challanNo.trim(),
          challanDate,
          vehicleNo: vehicleNo.trim().toUpperCase(),
          deliveryDate,
          uniqueDivisions,
          uniqueMrNos
      };
      setPrintData(dataToPrint);
      
      setSelectedJobIds(new Set());
      setChallanNo('');
      setVehicleNo('');
      
      setTimeout(() => {
          window.print();
      }, 300);
      
    } catch (err: any) {
      console.error("DISPATCH ERROR", err);
      alert("Error: " + (err.message || err.toString()));
      handleFirestoreError(err, OperationType.UPDATE, 'jobs');
    } finally {
      setLoading(false);
    }
  };

  const handlePrintPastChallan = (cNo: string, data: any) => {
    const divs = [...new Set(data.jobs.map((j: any) => j.division).filter(Boolean))].join(', ');
    const mrs = [...new Set(data.jobs.map((j: any) => j.mrNo).filter(Boolean))].join(', ');
    
    const dataToPrint = {
        jobs: data.jobs,
        challanNo: cNo,
        challanDate: data.challanDate,
        vehicleNo: data.vehicleNo,
        deliveryDate: data.deliveryDate,
        uniqueDivisions: divs,
        uniqueMrNos: mrs
    };
    setPrintData(dataToPrint);
    
    setTimeout(() => {
        const el = document.getElementById('printable-challan-section');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
        window.print();
    }, 250);
  };

  const handleDownloadWord = (cNo?: string, data?: any) => {
    const el = document.getElementById('printable-challan-sheet');
    if (el) {
      downloadHtmlAsWord(el, `Delivery_Challan_${cNo || 'Document'}.doc`, `Delivery Challan - ${cNo || ''}`);
    }
  };

  const handleExportExcel = (cNo?: string, data?: any) => {
    const wsData: any[][] = [];
    if (cNo && data) {
      wsData.push([`DELIVERY CHALLAN - ${cNo}`]);
      wsData.push([`Challan Date: ${formatDDMMYYYY(data.challanDate)}`, `Vehicle No: ${data.vehicleNo}`, `Delivery Date: ${formatDDMMYYYY(data.deliveryDate)}`]);
      wsData.push([]);
      wsData.push(['S.N.', 'Job No', 'MR No & Date', 'Capacity (KVA)', 'Make', 'Serial No', 'Division', 'Remarks / Job Condition']);
      data.jobs.forEach((job: any, idx: number) => {
        const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';
        const mrDateStr = formatDDMMYYYY(job.dateOfIssue || job.mrDate || job.createdAt);
        wsData.push([
          idx + 1,
          job.jobNo,
          `${job.mrNo || ''} (${mrDateStr})`,
          job.capacityKva,
          job.make,
          job.serialNo,
          job.division,
          isScrap ? 'Scrap - Returned to Division' : 'Tested OK'
        ]);
      });
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Delivery Challan");
      XLSX.writeFile(wb, `Delivery_Challan_${cNo}.xlsx`);
    } else {
      if (selectedJobs.length === 0) return;
      wsData.push([`DELIVERY CHALLAN PREVIEW - ${challanNo || 'Pending'}`]);
      wsData.push([`Challan Date: ${formatDDMMYYYY(challanDate)}`, `Vehicle No: ${vehicleNo}`, `Delivery Date: ${formatDDMMYYYY(deliveryDate)}`]);
      wsData.push([]);
      wsData.push(['S.N.', 'Job No', 'MR No & Date', 'Capacity (KVA)', 'Make', 'Serial No', 'Division', 'Remarks / Job Condition']);
      selectedJobs.forEach((job: any, idx: number) => {
        const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';
        const mrDateStr = formatDDMMYYYY(job.dateOfIssue || job.mrDate || job.createdAt);
        wsData.push([
          idx + 1,
          job.jobNo,
          `${job.mrNo || ''} (${mrDateStr})`,
          job.capacityKva,
          job.make,
          job.serialNo,
          job.division,
          isScrap ? 'Scrap - Returned to Division' : 'Tested OK'
        ]);
      });
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Challan");
      XLSX.writeFile(wb, `Delivery_Challan_${challanNo || 'Pending'}.xlsx`);
    }
  };

  const handleExportAllFilteredHistoryExcel = () => {
    if (filteredDispatchedJobs.length === 0) {
      alert("No delivered jobs to export with the current filters.");
      return;
    }
    const wsData: any[][] = [];
    wsData.push([`DELIVERED TRANSFORMERS REPORT - ${activeAgency?.name || 'AGENCY'}`]);
    wsData.push([`Generated On: ${formatDDMMYYYY(new Date().toISOString())}`, `Total Delivered Transformers: ${filteredDispatchedJobs.length}`]);
    if (historyDivisionFilter !== 'All') wsData.push([`Division Filter: ${historyDivisionFilter}`]);
    if (historyMrFilter !== 'All') wsData.push([`MR No Filter: ${historyMrFilter}`]);
    if (historySearchQuery.trim()) wsData.push([`Search Query: ${historySearchQuery}`]);
    wsData.push([]);
    wsData.push(['S.N.', 'Job No', 'MR No & Receive Date', 'Challan No', 'Challan Date', 'Vehicle No', 'Capacity (KVA)', 'Make', 'Serial No', 'Division', 'Condition / Remarks']);
    
    filteredDispatchedJobs.forEach((job: any, idx: number) => {
      const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';
      const mrDateStr = formatDDMMYYYY(job.dateOfIssue || job.mrDate || job.createdAt);
      wsData.push([
        idx + 1,
        job.jobNo,
        `${job.mrNo || ''} (${mrDateStr})`,
        job.challanNo || '-',
        formatDDMMYYYY(job.challanDate),
        job.vehicleNo || '-',
        job.capacityKva,
        job.make,
        job.serialNo,
        job.division,
        isScrap ? 'Scrap - Returned to Division' : 'Tested OK'
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Delivered Jobs");
    XLSX.writeFile(wb, `Delivered_Transformers_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const resetHistoryFilters = () => {
    setHistorySearchQuery('');
    setHistoryDivisionFilter('All');
    setHistoryMrFilter('All');
    setHistoryCategoryFilter('All');
  };

  const hasActiveHistoryFilters = historySearchQuery.trim() !== '' || historyDivisionFilter !== 'All' || historyMrFilter !== 'All' || historyCategoryFilter !== 'All';

  if (loading && allJobs.length === 0) {
    return (
      <div className="flex flex-col justify-center items-center h-64 gap-2.5">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="text-xs text-slate-500 font-semibold">Loading delivery challans & yard inventory...</span>
      </div>
    );
  }

  return (
    <div className="w-full max-w-full overflow-x-hidden space-y-3 sm:space-y-4 pb-28 sm:pb-16 print:m-0 print:max-w-full print:p-0 print:pb-0">
      
      {/* 1. TOP HEADER & RESPONSIVE TAB SWITCHER */}
      <div className="bg-slate-900 rounded-xl sm:rounded-2xl p-3 sm:p-4 text-white shadow-md border border-slate-800 print:hidden w-full">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          
          {/* Title & Brand info */}
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <img 
              src={appLogo} 
              alt="Logo" 
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl border border-blue-400/40 object-cover shrink-0" 
              referrerPolicy="no-referrer"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <h1 className="text-sm sm:text-base md:text-lg font-black text-white truncate tracking-tight">
                  Delivery Challans
                </h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 shrink-0">
                  {pendingJobs.length} Ready in Yard
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                Generate official DISCOM challans & track delivered units
              </p>
            </div>
          </div>

          {/* Full-width responsive tab switcher on mobile */}
          <div className="grid grid-cols-2 bg-slate-800/90 p-1 rounded-xl border border-slate-700/80 shrink-0 w-full md:w-auto gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('pending')}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg font-bold text-xs transition-all min-h-[38px] ${
                activeTab === 'pending'
                  ? 'bg-blue-600 text-white shadow-xs ring-1 ring-blue-400/40'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              <Truck className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Pending</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono shrink-0 ${activeTab === 'pending' ? 'bg-black/30 text-white' : 'bg-slate-900 text-slate-300'}`}>
                {pendingJobs.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg font-bold text-xs transition-all min-h-[38px] ${
                activeTab === 'history'
                  ? 'bg-purple-600 text-white shadow-xs ring-1 ring-purple-400/40'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              <History className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Dispatched</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono shrink-0 ${activeTab === 'history' ? 'bg-black/30 text-white' : 'bg-slate-900 text-slate-300'}`}>
                {allDispatchedJobs.length}
              </span>
            </button>
          </div>
        </div>

        {/* COMPACT SCROLLABLE DIVISION FILTER (FOR PENDING TAB) */}
        {activeTab === 'pending' && (
          <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center gap-2 w-full min-w-0">
            <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400 shrink-0 uppercase tracking-wider">
              <Filter className="w-3 h-3 text-cyan-400" />
              <span className="hidden xs:inline">Div:</span>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none text-xs flex-1 min-w-0 no-scrollbar">
              <button
                type="button"
                onClick={() => setSelectedDivision('All')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 shrink-0 ${
                  selectedDivision === 'All'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                }`}
              >
                <span>All</span>
                <span className="text-[10px] px-1.5 py-0.2 bg-black/30 rounded-full font-mono">
                  {pendingJobs.length}
                </span>
              </button>

              {availableDivisions.map(div => {
                const count = pendingJobs.filter(j => (j.division || '').trim().toLowerCase() === div.toLowerCase()).length;
                const isSelected = selectedDivision.toLowerCase() === div.toLowerCase();
                return (
                  <button
                    key={div}
                    type="button"
                    onClick={() => setSelectedDivision(div)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 shrink-0 ${
                      isSelected
                        ? 'bg-cyan-600 text-white shadow-xs'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                    }`}
                  >
                    <span>{div}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${isSelected ? 'bg-black/30 text-white' : 'bg-slate-900 text-slate-400'}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedDivision !== 'All' && (
              <button
                type="button"
                onClick={() => setSelectedDivision('All')}
                className="text-[10px] text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-0.5 bg-cyan-950/60 border border-cyan-800/60 px-2 py-1 rounded-lg shrink-0"
                title="Reset Division Filter"
              >
                <RotateCcw className="w-2.5 h-2.5" /> Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 2. PENDING DISPATCH WORKFLOW TAB */}
      {/* ========================================================================= */}
      {activeTab === 'pending' && (
        <div className="space-y-3 sm:space-y-4 print:hidden w-full">

          {/* SECTION A: CHALLAN METADATA & DISPATCH FORM */}
          <div className="bg-white border border-slate-200 rounded-xl sm:rounded-2xl p-3.5 sm:p-4 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-3 border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-xs sm:text-sm font-bold text-slate-900 leading-tight">
                    Step 1: Challan Details
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Specify transport and DISCOM delivery identifiers
                  </p>
                </div>
              </div>

              {/* ACTION SHORTCUTS (PREVIEW & EXCEL) */}
              <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto">
                <button 
                  type="button"
                  onClick={() => {
                    if (selectedJobs.length > 0) {
                      setPrintData({
                        jobs: selectedJobs,
                        challanNo: challanNo || 'DRAFT',
                        challanDate,
                        vehicleNo,
                        deliveryDate,
                        uniqueDivisions,
                        uniqueMrNos
                      });
                    } else {
                      alert("Please select one or more ready transformers below to preview challan.");
                    }
                  }}
                  disabled={selectedJobIds.size === 0}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold disabled:opacity-40 text-xs transition-colors min-h-[36px]"
                >
                  <Printer className="w-3.5 h-3.5 text-slate-600" />
                  <span>Preview</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportExcel()}
                  disabled={selectedJobIds.size === 0}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold disabled:opacity-40 text-xs shadow-xs transition-colors min-h-[36px]"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Excel</span>
                </button>
              </div>
            </div>

            {/* FORM INPUTS GRID - Responsive & Touch Friendly */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
              <div>
                <label className="block text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Challan No. <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Hash className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input 
                    type="text" 
                    value={challanNo} 
                    onChange={e => setChallanNo(e.target.value)} 
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-xs sm:text-sm font-mono font-bold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-slate-50/50 focus:bg-white transition-colors" 
                    placeholder="e.g. CH/2026/042" 
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Challan Date <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input 
                    type="date" 
                    value={challanDate} 
                    onChange={e => setChallanDate(e.target.value)} 
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-xs sm:text-sm font-mono font-bold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-slate-50/50 focus:bg-white transition-colors" 
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Vehicle / Truck No. <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Truck className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input 
                    type="text" 
                    value={vehicleNo} 
                    onChange={e => setVehicleNo(e.target.value.toUpperCase())} 
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-xs sm:text-sm font-mono font-bold uppercase outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-slate-50/50 focus:bg-white transition-colors" 
                    placeholder="e.g. GJ-01-AB-1234" 
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Delivery Date <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input 
                    type="date" 
                    value={deliveryDate} 
                    onChange={e => setDeliveryDate(e.target.value)} 
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-xs sm:text-sm font-mono font-bold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-slate-50/50 focus:bg-white transition-colors" 
                  />
                </div>
              </div>
            </div>

            {/* LIVE BATCH SUMMARY STRIP */}
            {selectedJobIds.size > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-blue-50/70 p-2.5 sm:p-3 rounded-lg border border-blue-100">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-bold text-blue-950 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>{selectedJobIds.size} Selected</span>
                  </span>
                  <span className="text-slate-400 hidden xs:inline">&bull;</span>
                  <span className="text-slate-700 font-bold font-mono bg-white px-2 py-0.5 rounded border border-blue-200">
                    {selectedTotalKva} KVA
                  </span>
                  <span className="text-slate-400 hidden xs:inline">&bull;</span>
                  <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    {selectedRepairCount} OK
                  </span>
                  {selectedScrapCount > 0 && (
                    <span className="text-rose-700 font-bold bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                      {selectedScrapCount} Scrap
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-2 pt-1 sm:pt-0">
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className="text-xs text-slate-600 hover:text-slate-900 font-bold underline cursor-pointer"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* SECTION B: SELECT READY TRANSFORMERS */}
          <div className="bg-white border border-slate-200 rounded-xl sm:rounded-2xl overflow-hidden shadow-xs">
            
            {/* FILTER & SELECTION CONTROLS HEADER */}
            <div className="p-3 sm:p-4 border-b border-slate-200 bg-slate-50/80 flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-2.5">
              
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <CheckSquare className="w-4 h-4 text-blue-600" />
                  <span>Step 2: Select Ready Units ({filteredPendingJobs.length})</span>
                </h2>

                {/* CATEGORY SWITCHER PILLS */}
                <div className="flex items-center bg-slate-200/80 p-0.5 rounded-lg text-xs font-bold shrink-0">
                  <button
                    type="button"
                    onClick={() => setJobCategoryFilter('All')}
                    className={`px-2.5 py-1 rounded-md transition-all ${jobCategoryFilter === 'All' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    All ({pendingJobs.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setJobCategoryFilter('Repairable')}
                    className={`px-2.5 py-1 rounded-md transition-all ${jobCategoryFilter === 'Repairable' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    OK ({repairableCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setJobCategoryFilter('Scrap')}
                    className={`px-2.5 py-1 rounded-md transition-all ${jobCategoryFilter === 'Scrap' ? 'bg-rose-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    Scrap ({scrapCount})
                  </button>
                </div>
              </div>

              {/* SEARCH BAR & SELECT ALL TOGGLE */}
              <div className="flex items-center gap-2 w-full lg:w-auto">
                <div className="relative flex-1 lg:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input 
                    type="text" 
                    placeholder="Search Job, MR, Make, S/N..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-7 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500 bg-white"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <select
                  value={gpFilter}
                  onChange={(e) => setGpFilter(e.target.value as GpFilter)}
                  className="px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-medium outline-none focus:border-blue-500 bg-white shrink-0"
                  title="Filter by repair type - GP repairs are done under guarantee at no cost"
                >
                  {GP_FILTER_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>

                <select
                  value={mrFilter}
                  onChange={(e) => setMrFilter(e.target.value)}
                  className="px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-medium outline-none focus:border-blue-500 bg-white shrink-0 max-w-[170px]"
                  title="Filter by MR Number"
                >
                  <option value="All">All MRs</option>
                  {pendingMrOptions.map(({ mrNo, count }) => (
                    <option key={mrNo} value={mrNo}>{mrNo} ({count} job{count > 1 ? 's' : ''})</option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleSelectAllFiltered}
                  className="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold transition-colors whitespace-nowrap shrink-0"
                >
                  Toggle All
                </button>
              </div>
            </div>

            {/* PENDING JOB ROWS - flat list, one line per job (not grouped by MR) */}
            <div className="p-0">
              {filteredPendingJobs.length === 0 ? (
                <div className="m-2.5 sm:m-4 text-center py-10 px-4 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                  <PackageCheck className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                  <p className="font-bold text-slate-700 text-xs sm:text-sm">No Ready Transformers Found</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {pendingJobs.length === 0
                      ? 'No transformers currently in "Tested - Ready for Dispatch" or "Scrap" status.'
                      : 'Try adjusting your division, MR or search filters.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto w-full">
                  <table className="w-full text-left text-xs border-collapse min-w-[1000px]">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 uppercase tracking-wider text-[10px]">
                        <th className="p-2 text-center w-10">
                          <span className="sr-only">Select</span>
                        </th>
                        <th className="p-2">Job No</th>
                        <th className="p-2">MR No</th>
                        <th className="p-2">Make</th>
                        <th className="p-2">Serial No</th>
                        <th className="p-2 text-center">KVA</th>
                        <th className="p-2">Core Type</th>
                        <th className="p-2 text-center">GP/OGP</th>
                        <th className="p-2">Division</th>
                        <th className="p-2">
                          <button
                            type="button"
                            onClick={() => setTestDateSortDir(d => (d === 'desc' ? 'asc' : 'desc'))}
                            className="inline-flex items-center gap-1 uppercase tracking-wider text-[10px] font-bold text-slate-700 hover:text-slate-900 transition-colors"
                            title={testDateSortDir === 'desc' ? 'Sorted newest first - click for oldest first' : 'Sorted oldest first - click for newest first'}
                          >
                            <span>Test Date</span>
                            <span className="text-[9px] leading-none">{testDateSortDir === 'desc' ? '▼' : '▲'}</span>
                          </button>
                        </th>
                        <th className="p-2 text-center">Condition</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredPendingJobs.map(job => {
                        const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';
                        const isSelected = selectedJobIds.has(job.id);

                        return (
                          <tr
                            key={job.id}
                            onClick={() => handleToggleJob(job.id)}
                            className={`cursor-pointer select-none transition-colors whitespace-nowrap ${
                              isSelected
                                ? (isScrap ? 'bg-rose-100/80' : 'bg-blue-50')
                                : (isScrap ? 'bg-amber-50/60 hover:bg-amber-100/60' : 'hover:bg-slate-50')
                            }`}
                          >
                            <td className="p-2 text-center">
                              <div className={`w-4 h-4 mx-auto rounded flex items-center justify-center transition-colors ${
                                isSelected ? (isScrap ? 'bg-rose-600 text-white' : 'bg-blue-600 text-white') : 'border border-slate-300 bg-white'
                              }`}>
                                {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                              </div>
                            </td>
                            <td className="p-2 font-mono font-bold">
                              <span className="flex items-center gap-1.5">
                                <span className={matchesGpFilter(job, 'GP') ? GP_TEXT_CLASS : 'text-slate-900'}>{job.jobNo}</span>
                                {matchesGpFilter(job, 'GP') && <GpChip />}
                              </span>
                            </td>
                            <td className="p-2 font-mono text-slate-700">{job.mrNo || '-'}</td>
                            <td className="p-2 text-slate-800 truncate max-w-[130px]" title={job.make}>{job.make || '-'}</td>
                            <td className="p-2 font-mono text-slate-600 truncate max-w-[130px]" title={job.serialNo}>{job.serialNo || '-'}</td>
                            <td className="p-2 text-center font-mono font-bold text-slate-900">{job.capacityKva}</td>
                            <td className="p-2 font-semibold text-slate-700 truncate max-w-[110px]" title={job.coreType || 'CRGO'}>{job.coreType || 'CRGO'}</td>
                            <td className="p-2 text-center">
                              {matchesGpFilter(job, 'GP')
                                ? <GpChip />
                                : <span className="text-[10px] font-bold text-slate-500">OGP</span>}
                            </td>
                            <td className="p-2 uppercase font-semibold text-slate-700 truncate max-w-[130px]">{job.division || '-'}</td>
                            {/* Scrap jobs are never tested, so a dash here is correct, not missing data */}
                            <td className="p-2 font-mono text-slate-600">{formatDDMMYYYY(job.testingDate)}</td>
                            <td className="p-2 text-center">
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isScrap
                                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                  : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              }`}>
                                {isScrap ? 'Scrap' : 'Repairable'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* DESKTOP FOOTER DISPATCH ACTION */}
            <div className="p-3.5 sm:p-4 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-slate-600 font-medium text-center sm:text-left">
                {selectedJobIds.size === 0 ? (
                  <span>Select ready transformers above to generate and dispatch delivery challan.</span>
                ) : (
                  <span className="font-bold text-slate-800">
                    Ready to dispatch <span className="text-blue-600">{selectedJobIds.size}</span> unit(s) with Challan <strong className="font-mono text-purple-700">{challanNo || '(Enter Challan #)'}</strong>
                  </span>
                )}
              </div>

              <button 
                type="button"
                onClick={handleDispatch}
                disabled={loading || selectedJobIds.size === 0 || !challanNo.trim() || !vehicleNo.trim()}
                className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold disabled:opacity-40 transition-all text-xs sm:text-sm shadow-sm flex items-center justify-center gap-2 cursor-pointer min-h-[42px]"
              >
                <Truck className="w-4 h-4 shrink-0" />
                <span>
                  {loading 
                    ? 'Dispatching...' 
                    : (!challanNo.trim() || !vehicleNo.trim() 
                        ? 'Enter Challan No & Vehicle No to Dispatch' 
                        : `Confirm Dispatch & Auto-Print (${selectedJobIds.size} Units)`)}
                </span>
              </button>
            </div>
          </div>

          {/* FIXED MOBILE DISPATCH ACTION BAR */}
          {selectedJobIds.size > 0 && (
            <div className="fixed bottom-0 left-0 right-0 p-3 bg-slate-900/95 backdrop-blur-md border-t border-slate-700 z-40 sm:hidden shadow-2xl flex items-center justify-between gap-3 text-white pb-safe">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold truncate flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  <span>{selectedJobIds.size} Units ({selectedTotalKva} KVA)</span>
                </div>
                <div className="text-[10px] text-slate-300 font-mono truncate">
                  CH: {challanNo || 'Required'} &bull; {vehicleNo || 'Veh Req'}
                </div>
              </div>

              <button 
                type="button"
                onClick={handleDispatch}
                disabled={loading || !challanNo.trim() || !vehicleNo.trim()}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-xs shrink-0 disabled:opacity-40 flex items-center gap-1.5 shadow-md active:scale-95"
              >
                <Truck className="w-3.5 h-3.5" />
                <span>Dispatch</span>
              </button>
            </div>
          )}

        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. DELIVERED JOBS & DISPATCH HISTORY TAB */}
      {/* ========================================================================= */}
      {activeTab === 'history' && (
        <div className="space-y-3 sm:space-y-4 print:hidden w-full">

          {/* TOP SUMMARY STATS BANNER */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
            <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs">
              <span className="text-[10px] font-bold uppercase text-slate-500 block">Total Delivered</span>
              <span className="text-lg sm:text-2xl font-black text-slate-900 font-mono">{allDispatchedJobs.length}</span>
              <span className="text-[10px] text-slate-400 block mt-0.5">Transformers</span>
            </div>

            <div className="bg-white border border-emerald-200 rounded-xl p-3 shadow-xs">
              <span className="text-[10px] font-bold uppercase text-emerald-800 block">Tested OK Delivered</span>
              <span className="text-lg sm:text-2xl font-black text-emerald-950 font-mono">
                {allDispatchedJobs.filter(j => j.status !== 'Scrap' && j.condition !== 'Scrap').length}
              </span>
              <span className="text-[10px] text-emerald-700 block mt-0.5">Dispatched to Grid</span>
            </div>

            <div className="bg-white border border-rose-200 rounded-xl p-3 shadow-xs">
              <span className="text-[10px] font-bold uppercase text-rose-800 block">Scrap Returned</span>
              <span className="text-lg sm:text-2xl font-black text-rose-950 font-mono">
                {allDispatchedJobs.filter(j => j.status === 'Scrap' || j.condition === 'Scrap').length}
              </span>
              <span className="text-[10px] text-rose-700 block mt-0.5">Delivered to Store</span>
            </div>

            <div className="bg-white border border-purple-200 rounded-xl p-3 shadow-xs">
              <span className="text-[10px] font-bold uppercase text-purple-800 block">Total Challans</span>
              <span className="text-lg sm:text-2xl font-black text-purple-950 font-mono">
                {new Set(allDispatchedJobs.map(j => j.challanNo)).size}
              </span>
              <span className="text-[10px] text-purple-700 block mt-0.5">Challan Batches</span>
            </div>
          </div>

          {/* SEARCH & FILTER CONTROLS */}
          <div className="bg-white p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-200 shadow-xs space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-100">
              <div>
                <h2 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <History className="w-4 h-4 text-purple-600" />
                  <span>Delivered Transformer Archive</span>
                </h2>
                <p className="text-[11px] text-slate-500">
                  Filter dispatched units by Division, MR, Challan No, or Job No
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* VIEW MODE SWITCHER */}
                <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setHistoryViewMode('cards')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold transition-all ${historyViewMode === 'cards' ? 'bg-white text-purple-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                    title="Grouped Challan Cards"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                    <span>Cards</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistoryViewMode('table')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold transition-all ${historyViewMode === 'table' ? 'bg-white text-purple-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                    title="Detailed Job Table"
                  >
                    <List className="w-3.5 h-3.5" />
                    <span>Table</span>
                  </button>
                </div>

                {/* EXCEL EXPORT BUTTON */}
                <button
                  type="button"
                  onClick={handleExportAllFilteredHistoryExcel}
                  disabled={filteredDispatchedJobs.length === 0}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg text-xs font-bold transition-colors shadow-xs"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Export ({filteredDispatchedJobs.length})</span>
                </button>

                {/* RESET FILTERS */}
                {hasActiveHistoryFilters && (
                  <button
                    type="button"
                    onClick={resetHistoryFilters}
                    className="flex items-center gap-1 px-2 py-1.5 text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg text-xs font-bold transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset</span>
                  </button>
                )}
              </div>
            </div>

            {/* FILTER INPUTS ROW */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {/* Search input */}
              <div className="relative">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Search Records
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={historySearchQuery}
                    onChange={(e) => setHistorySearchQuery(e.target.value)}
                    placeholder="Job No, MR, Challan, Make, Serial..."
                    className="w-full pl-8 pr-7 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:bg-white focus:border-purple-500"
                  />
                  {historySearchQuery && (
                    <button
                      type="button"
                      onClick={() => setHistorySearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Division filter */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Division
                </label>
                <select
                  value={historyDivisionFilter}
                  onChange={(e) => setHistoryDivisionFilter(e.target.value)}
                  className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium outline-none focus:bg-white focus:border-purple-500"
                >
                  <option value="All">All Divisions ({historyAvailableDivisions.length > 1 ? historyAvailableDivisions.length - 1 : 0})</option>
                  {historyAvailableDivisions.filter(d => d !== 'All').map(div => {
                    const count = allDispatchedJobs.filter(j => j.division === div).length;
                    return (
                      <option key={div} value={div}>
                        {div} ({count} jobs)
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* MR No filter */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  MR Number
                </label>
                <select
                  value={historyGpFilter}
                  onChange={(e) => setHistoryGpFilter(e.target.value as GpFilter)}
                  className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium outline-none focus:bg-white focus:border-purple-500"
                  title="Filter by repair type - GP repairs are done under guarantee at no cost"
                >
                  {GP_FILTER_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>

                <select
                  value={historyMrFilter}
                  onChange={(e) => setHistoryMrFilter(e.target.value)}
                  className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium outline-none focus:bg-white focus:border-purple-500"
                >
                  <option value="All">All MRs</option>
                  {historyMrOptions.map(({ mrNo, count }) => (
                    <option key={mrNo} value={mrNo}>
                      {mrNo} ({count} job{count > 1 ? 's' : ''})
                    </option>
                  ))}
                </select>
              </div>

              {/* Condition filter pills */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Condition
                </label>
                <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 h-[36px]">
                  <button
                    type="button"
                    onClick={() => setHistoryCategoryFilter('All')}
                    className={`flex-1 text-[11px] font-bold rounded transition-all ${historyCategoryFilter === 'All' ? 'bg-white text-purple-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    All ({allDispatchedJobs.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistoryCategoryFilter('Repairable')}
                    className={`flex-1 text-[11px] font-bold rounded transition-all ${historyCategoryFilter === 'Repairable' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    OK ({historyRepairableCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistoryCategoryFilter('Scrap')}
                    className={`flex-1 text-[11px] font-bold rounded transition-all ${historyCategoryFilter === 'Scrap' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    Scrap ({historyScrapCount})
                  </button>
                </div>
              </div>
            </div>

            {/* ACTIVE FILTER SUMMARY CHIPS */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="font-semibold text-slate-700">Showing:</span>
                <span className="bg-purple-100 text-purple-800 font-bold px-2 py-0.5 rounded">
                  {filteredDispatchedJobs.length} Units
                </span>
                <span className="bg-slate-200 text-slate-700 font-bold px-2 py-0.5 rounded">
                  {filteredChallanHistory.length} Challans
                </span>

                {historyDivisionFilter !== 'All' && (
                  <span className="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-200 text-indigo-700 px-1.5 py-0.5 rounded">
                    Div: <strong>{historyDivisionFilter}</strong>
                    <button onClick={() => setHistoryDivisionFilter('All')} className="hover:text-indigo-900">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                )}

                {historyMrFilter !== 'All' && (
                  <span className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-800 px-1.5 py-0.5 rounded">
                    MR: <strong>{historyMrFilter}</strong>
                    <button onClick={() => setHistoryMrFilter('All')} className="hover:text-amber-900">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* DELIVERED JOBS RESULTS */}
          {allDispatchedJobs.length === 0 ? (
            <div className="bg-white p-8 sm:p-10 text-center rounded-xl border border-slate-200 text-slate-500 shadow-xs">
              <Truck className="w-10 h-10 mx-auto text-slate-300 mb-2" />
              <h3 className="font-bold text-slate-800 text-sm">No Dispatched Jobs Yet</h3>
              <p className="text-xs text-slate-500 mt-0.5 max-w-sm mx-auto">
                Completed & tested transformers dispatched using Delivery Challans will automatically appear in this archive.
              </p>
            </div>
          ) : filteredDispatchedJobs.length === 0 ? (
            <div className="bg-white p-8 sm:p-10 text-center rounded-xl border border-slate-200 text-slate-500 shadow-xs">
              <Search className="w-10 h-10 mx-auto text-slate-300 mb-2" />
              <h3 className="font-bold text-slate-800 text-sm">No Delivered Jobs Match Filters</h3>
              <p className="text-xs text-slate-500 mt-0.5 max-w-sm mx-auto">
                Try resetting division, MR number, or search query filters.
              </p>
              <button
                type="button"
                onClick={resetHistoryFilters}
                className="mt-3 px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-bold hover:bg-purple-700 transition-colors"
              >
                Reset All Filters
              </button>
            </div>
          ) : historyViewMode === 'cards' ? (
            /* 1. CHALLAN GROUPED CARDS */
            <div className="space-y-3">
              {filteredChallanHistory.map(([cNo, data]) => {
                const isFilteredSubset = data.jobs.length < data.allJobsInChallan.length;
                const displayDivisions = data.divisions.join(', ');
                const displayMrs = data.mrNos.join(', ');

                return (
                  <div key={cNo} className="bg-white border border-slate-200 rounded-xl sm:rounded-2xl shadow-xs overflow-hidden transition-all hover:border-slate-300">
                    
                    {/* CHALLAN CARD HEADER */}
                    <div className="p-3 sm:p-4 bg-slate-50/90 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-bold text-slate-900 text-xs sm:text-sm md:text-base flex items-center gap-1.5 truncate">
                            <span>Challan: <strong className="font-mono text-purple-800">{cNo}</strong></span>
                          </h3>
                          {isFilteredSubset && (
                            <span className="text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.2 rounded">
                              Matched {data.jobs.length} of {data.allJobsInChallan.length}
                            </span>
                          )}
                        </div>
                        
                        <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 font-medium">
                          <span>Date: <strong className="font-mono text-slate-800">{formatDDMMYYYY(data.challanDate)}</strong></span>
                          <span>Vehicle: <strong className="font-mono uppercase text-slate-800">{data.vehicleNo || '-'}</strong></span>
                          {displayDivisions && <span className="truncate max-w-xs">Div: <strong className="uppercase text-slate-800">{displayDivisions}</strong></span>}
                          {displayMrs && <span className="truncate max-w-xs">MR: <strong className="font-mono text-slate-800">{displayMrs}</strong></span>}
                        </div>
                      </div>

                      {/* CARD ACTION BUTTONS */}
                      <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end">
                        <button
                          type="button"
                          onClick={() => handlePrintPastChallan(cNo, { ...data, jobs: data.allJobsInChallan })}
                          className="flex items-center justify-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-bold text-xs transition-colors shadow-xs"
                          title="Print original challan"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>Print</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadWord(cNo, { ...data, jobs: data.allJobsInChallan })}
                          className="flex items-center justify-center gap-1 px-2 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs transition-colors shadow-xs"
                          title="Download Word Document (.doc)"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>Word</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExportExcel(cNo, { ...data, jobs: data.allJobsInChallan })}
                          className="flex items-center justify-center gap-1 px-2 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs transition-colors shadow-xs"
                          title="Export Excel (.xlsx)"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          <span>Excel</span>
                        </button>
                      </div>
                    </div>

                    {/* CHALLAN CARD JOBS GRID */}
                    <div className="p-2.5 sm:p-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
                        {data.jobs.map(job => {
                          const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';
                          const mrDateStr = formatDDMMYYYY(job.dateOfIssue || job.mrDate || job.createdAt);
                          
                          return (
                            <div
                              key={job.id}
                              className={`p-2.5 border rounded-lg transition-all text-xs ${
                                isScrap 
                                  ? 'bg-rose-50/50 border-rose-200' 
                                  : 'bg-slate-50/80 border-slate-200 hover:border-purple-300'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1 mb-0.5">
                                <span className="font-mono font-bold text-xs text-slate-900 truncate">{job.jobNo}</span>
                                <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded shrink-0 ${
                                  isScrap ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-800'
                                }`}>
                                  {isScrap ? 'SCRAP' : 'OK'}
                                </span>
                              </div>
                              <div className="text-[11px] font-bold text-slate-700 truncate">
                                {job.capacityKva} KVA ({job.coreType || 'CRGO'}) {job.make ? `• ${job.make}` : ''}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono mt-1 pt-1 border-t border-slate-200/60 flex flex-col gap-0.2">
                                <div className="truncate">MR: <strong className="text-slate-700">{job.mrNo || '-'}</strong> ({mrDateStr})</div>
                                {job.division && <div className="text-[9px] text-slate-400 uppercase truncate">{job.division}</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* 2. DETAILED JOB TABLE VIEW (WITH HORIZONTAL SCROLL FOR MOBILE) */
            <div className="bg-white border border-slate-200 rounded-xl sm:rounded-2xl shadow-xs overflow-hidden w-full">
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left text-xs border-collapse min-w-[1080px]">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 uppercase tracking-wider text-[10px]">
                      <th className="p-2">Job No</th>
                      <th className="p-2">MR No</th>
                      <th className="p-2">Make</th>
                      <th className="p-2">Serial No</th>
                      <th className="p-2 text-center">KVA</th>
                      <th className="p-2">Core Type</th>
                      <th className="p-2 text-center">GP/OGP</th>
                      <th className="p-2">Division</th>
                      <th className="p-2 text-center">Condition</th>
                      <th className="p-2">Challan No</th>
                      <th className="p-2">Dispatch Date</th>
                      <th className="p-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredDispatchedJobs.map((job) => {
                      const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';

                      return (
                        <tr key={job.id} className={`transition-colors whitespace-nowrap ${isScrap ? 'bg-amber-50/60 hover:bg-amber-100/60' : 'hover:bg-slate-50'}`}>
                          <td className="p-2 font-mono font-bold">
                              <span className="flex items-center gap-1.5">
                                <span className={matchesGpFilter(job, 'GP') ? GP_TEXT_CLASS : 'text-slate-900'}>{job.jobNo}</span>
                                {matchesGpFilter(job, 'GP') && <GpChip />}
                              </span>
                            </td>
                          <td className="p-2 font-mono text-slate-700">{job.mrNo || '-'}</td>
                          <td className="p-2 text-slate-800 truncate max-w-[130px]" title={job.make}>{job.make || '-'}</td>
                          <td className="p-2 font-mono text-slate-600 truncate max-w-[130px]" title={job.serialNo}>{job.serialNo || '-'}</td>
                          <td className="p-2 text-center font-mono font-bold text-slate-900">{job.capacityKva}</td>
                          <td className="p-2 font-semibold text-slate-700 truncate max-w-[110px]" title={job.coreType || 'CRGO'}>{job.coreType || 'CRGO'}</td>
                          <td className="p-2 text-center">
                            {matchesGpFilter(job, 'GP')
                              ? <GpChip />
                              : <span className="text-[10px] font-bold text-slate-500">OGP</span>}
                          </td>
                          <td className="p-2 uppercase font-semibold text-slate-700 truncate max-w-[130px]">{job.division || '-'}</td>
                          <td className="p-2 text-center">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              isScrap
                                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            }`}>
                              {isScrap ? 'Scrap' : 'Repairable'}
                            </span>
                          </td>
                          <td className="p-2 font-mono font-bold text-purple-700">{job.challanNo || '-'}</td>
                          <td className="p-2 font-mono text-slate-600">{formatDDMMYYYY(job.challanDate)}</td>
                          <td className="p-2 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                const matchChallan = allDispatchedJobs.filter(j => j.challanNo === job.challanNo);
                                handlePrintPastChallan(job.challanNo, {
                                  challanDate: job.challanDate,
                                  vehicleNo: job.vehicleNo,
                                  deliveryDate: job.deliveryDate,
                                  jobs: matchChallan
                                });
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded text-[10px] font-bold transition-colors"
                              title="Print Challan"
                            >
                              <Printer className="w-3 h-3" />
                              <span>Print</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. PRINTABLE CHALLAN DOCUMENT PREVIEW MODAL */}
      {/* ========================================================================= */}
      {printData && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-xs z-50 overflow-y-auto p-2 sm:p-4 md:p-6 flex justify-center items-start print:p-0 print:static print:bg-transparent print:backdrop-blur-none">
          <div id="printable-challan-section" className="bg-white shadow-2xl border border-slate-300 rounded-xl p-3 sm:p-6 md:p-8 text-black w-full max-w-4xl print:m-0 print:p-0 print:border-none print:shadow-none print:max-w-none my-2 sm:my-4">
            
            {/* ACTION BAR (SCREEN ONLY) */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 bg-slate-900 text-white p-3 sm:p-4 rounded-xl mb-4 print:hidden shadow-sm">
              <div className="min-w-0">
                <h3 className="font-bold text-xs sm:text-sm truncate">Challan Document: {printData.challanNo || 'Pending'}</h3>
                <p className="text-[11px] text-slate-300 mt-0.5">{printData.jobs?.length || 0} Transformer(s) Dispatched</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => triggerUniversalPrint('printable-challan-sheet', `Delivery Challan - ${printData.challanNo || 'Draft'}`, `Challan_${printData.challanNo || 'Draft'}.pdf`)}
                  className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-xs px-3 py-1.5 rounded-lg transition-colors shadow-xs cursor-pointer"
                  title="Print document or open print dialog"
                >
                  <Printer className="w-3.5 h-3.5" /> <span>Print</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadWord(printData.challanNo, printData)}
                  className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-2.5 py-1.5 rounded-lg transition-colors shadow-xs cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" /> <span>Word</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportExcel(printData.challanNo, printData)}
                  className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-2.5 py-1.5 rounded-lg transition-colors shadow-xs cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" /> <span>Excel</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPrintData(null)}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                  title="Close Preview"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* PRINTABLE DOCUMENT SHEET (WITH HORIZONTAL SCROLL PROTECTION ON MOBILE) */}
            <div id="printable-challan-sheet" className="p-0 bg-white">
              <PrintableA4Page agency={activeAgency} documentTitle="DELIVERY CHALLAN">
                <div className="flex flex-col justify-between h-full">
                  <div>
                    <div className="flex flex-col sm:flex-row justify-between items-start mb-3 text-xs gap-2">
                      <div className="space-y-1">
                        <div className="flex"><span className="w-20 font-bold shrink-0">To:</span> <span className="font-bold uppercase max-w-xs">{printData.uniqueDivisions || 'DIVISION OFFICE'}</span></div>
                        <div className="flex"><span className="w-20 font-bold shrink-0">Vehicle No:</span> <span className="font-mono uppercase font-bold">{printData.vehicleNo || '________________'}</span></div>
                        <div className="flex"><span className="w-20 font-bold shrink-0">MR No(s):</span> <span className="font-mono uppercase max-w-xs">{printData.uniqueMrNos || '-'}</span></div>
                      </div>
                      <div className="space-y-1 text-left sm:text-right">
                        <div className="flex sm:justify-end"><span className="w-24 font-bold text-left shrink-0">Challan No:</span> <span className="font-mono uppercase font-bold">{printData.challanNo || '________________'}</span></div>
                        <div className="flex sm:justify-end"><span className="w-24 font-bold text-left shrink-0">Challan Date:</span> <span className="font-mono">{formatDDMMYYYY(printData.challanDate)}</span></div>
                        <div className="flex sm:justify-end"><span className="w-24 font-bold text-left shrink-0">Delivery Date:</span> <span className="font-mono">{formatDDMMYYYY(printData.deliveryDate)}</span></div>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse border border-slate-800">
                        <thead>
                          <tr className="bg-slate-100 print:bg-slate-100 font-bold">
                            <th className="border border-slate-800 p-1 text-center w-8">Sr.</th>
                            <th className="border border-slate-800 p-1 text-left">Job No.</th>
                            <th className="border border-slate-800 p-1 text-left">MR No & Date</th>
                            <th className="border border-slate-800 p-1 text-left">Make</th>
                            <th className="border border-slate-800 p-1 text-center">Capacity (KVA)</th>
                            <th className="border border-slate-800 p-1 text-left">Serial No.</th>
                            <th className="border border-slate-800 p-1 text-center">Remarks</th>
                          </tr>
                        </thead>
                        <tbody>
                          {printData.jobs?.map((job: any, idx: number) => {
                            const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';
                            const mrDateStr = formatDDMMYYYY(job.dateOfIssue || job.mrDate || job.createdAt);
                            return (
                              <tr key={job.id || idx}>
                                <td className="border border-slate-800 p-1 text-center font-bold">{idx + 1}</td>
                                <td className="border border-slate-800 p-1 font-mono font-bold">{job.jobNo}</td>
                                <td className="border border-slate-800 p-1 font-mono text-[11px]">
                                  {job.mrNo || '-'} <span className="text-slate-600">({mrDateStr})</span>
                                </td>
                                <td className="border border-slate-800 p-1">{job.make || '-'}</td>
                                <td className="border border-slate-800 p-1 text-center font-bold font-mono whitespace-nowrap">
                                  {job.capacityKva} <span className="font-sans font-semibold text-[10px]">({job.coreType || 'CRGO'})</span>
                                </td>
                                <td className="border border-slate-800 p-1 font-mono">{job.serialNo || '-'}</td>
                                <td className="border border-slate-800 p-1 text-center text-[11px] font-semibold">
                                  {isScrap ? 'Scrap - Returned' : 'Tested OK'}
                                </td>
                              </tr>
                            );
                          })}
                          {(!printData.jobs || printData.jobs.length === 0) && (
                            <tr>
                              <td colSpan={7} className="border border-slate-800 p-4 text-center text-slate-400">
                                No jobs selected
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      
                      <div className="mt-2 text-xs font-bold flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1">
                        <span>Total Transformers Dispatched: {printData.jobs?.length || 0} Units</span>
                        <span>Total Capacity: {printData.jobs?.reduce((acc: number, j: any) => acc + (Number(j.capacityKva) || 0), 0) || 0} KVA</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 flex justify-between items-end text-xs font-bold pt-4">
                    <div className="text-center">
                      <div className="w-36 sm:w-44 border-b border-slate-800 mb-1"></div>
                      Receiver's Signature
                    </div>
                    <div className="text-center">
                      <div className="w-36 sm:w-44 border-b border-slate-800 mb-1"></div>
                      For {activeAgency?.name || 'Authorized Signatory'}
                    </div>
                  </div>
                </div>
              </PrintableA4Page>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
