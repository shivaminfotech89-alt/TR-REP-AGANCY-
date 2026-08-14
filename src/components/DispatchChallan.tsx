import React, { useState, useEffect, useMemo } from 'react';
import { useAgency } from '../lib/AgencyContext';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { Loader2, Printer, Search, Truck, CheckCircle2, History, FileSpreadsheet, Download, X, FileText, Filter, RotateCcw, LayoutGrid, List, Zap, ShieldAlert } from 'lucide-react';
import * as XLSX from 'xlsx';
import { LetterheadHeader } from './LetterheadHeader';
import { formatDDMMYYYY } from '../lib/utils';
import { downloadHtmlAsWord } from '../lib/wordExport';

export default function DispatchChallan() {
  const { activeAgency } = useAgency();
  const [allJobs, setAllJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  
  // Pending Tab Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [jobCategoryFilter, setJobCategoryFilter] = useState<'All' | 'Repairable' | 'Scrap'>('All');
  const [selectedDivision, setSelectedDivision] = useState('All');
  
  // Delivered Jobs (History) Filters
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [historyDivisionFilter, setHistoryDivisionFilter] = useState('All');
  const [historyMrFilter, setHistoryMrFilter] = useState('All');
  const [historyCategoryFilter, setHistoryCategoryFilter] = useState<'All' | 'Repairable' | 'Scrap'>('All');
  const [historyViewMode, setHistoryViewMode] = useState<'cards' | 'table'>('cards');
  
  const [challanNo, setChallanNo] = useState('');
  const [challanDate, setChallanDate] = useState(new Date().toISOString().split('T')[0]);
  const [vehicleNo, setVehicleNo] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  
  const [isPrinting, setIsPrinting] = useState(false);
  const [printData, setPrintData] = useState<any>(null); // To handle printing past challans

  useEffect(() => {
    async function fetchJobs() {
      if (!auth.currentUser || !activeAgency) { setLoading(false); return; }
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
    }
    fetchJobs();
  }, [activeAgency]);

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

  const availableDivisions = useMemo(() => {
    const divs = new Set(pendingJobs.map(j => j.division).filter(Boolean));
    return ['All', ...Array.from(divs)].sort();
  }, [pendingJobs]);

  const filteredPendingJobs = useMemo(() => {
    let result = pendingJobs;
    if (jobCategoryFilter === 'Repairable') {
      result = result.filter(j => j.status === 'Tested - Ready for Dispatch' && j.condition !== 'Scrap');
    } else if (jobCategoryFilter === 'Scrap') {
      result = result.filter(j => j.status === 'Scrap' || j.condition === 'Scrap');
    }
    if (selectedDivision !== 'All') {
        result = result.filter(j => j.division === selectedDivision);
    }
    if (searchQuery) {
        const lowerQ = searchQuery.toLowerCase();
        result = result.filter(j => 
            (j.jobNo || '').toLowerCase().includes(lowerQ) ||
            (j.mrNo || '').toLowerCase().includes(lowerQ) ||
            (j.division || '').toLowerCase().includes(lowerQ) ||
            (j.make || '').toLowerCase().includes(lowerQ)
        );
    }
    return result;
  }, [pendingJobs, jobCategoryFilter, searchQuery, selectedDivision]);

  // Derived dispatched jobs list
  const allDispatchedJobs = useMemo(() => {
    return allJobs.filter(j => j.status === 'Dispatched' && j.challanNo);
  }, [allJobs]);

  const historyAvailableDivisions = useMemo(() => {
    const divs = new Set(allDispatchedJobs.map(j => j.division).filter(Boolean));
    return ['All', ...Array.from(divs)].sort();
  }, [allDispatchedJobs]);

  const historyAvailableMrs = useMemo(() => {
    const mrs = new Set(allDispatchedJobs.map(j => j.mrNo).filter(Boolean));
    return ['All', ...Array.from(mrs)].sort();
  }, [allDispatchedJobs]);

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
    }).sort((a, b) => (a.jobNo || '').localeCompare(b.jobNo || '', undefined, { numeric: true }));
  }, [allDispatchedJobs, historyDivisionFilter, historyMrFilter, historyCategoryFilter, historySearchQuery]);

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
    
    // First map all dispatched jobs to group
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

    // Populate matching filtered jobs
    filteredDispatchedJobs.forEach(job => {
      if (groups[job.challanNo]) {
        groups[job.challanNo].jobs.push(job);
      }
    });
    
    // Keep only challans with matching jobs and sort by date descending
    return Object.entries(groups)
      .filter(([_, data]) => data.jobs.length > 0)
      .sort((a, b) => {
        return new Date(b[1].challanDate).getTime() - new Date(a[1].challanDate).getTime();
      });
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

  const selectedJobs = pendingJobs.filter(j => selectedJobIds.has(j.id));
  const uniqueDivisions = [...new Set(selectedJobs.map(j => j.division).filter(Boolean))].join(', ');
  const uniqueMrNos = [...new Set(selectedJobs.map(j => j.mrNo).filter(Boolean))].join(', ');

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
          challanNo,
          challanDate,
          vehicleNo,
          deliveryDate,
          isClosed: true,
          updatedAt: new Date().toISOString()
        });
      }
      await batch.commit();
      
      // Update local state without losing dispatched data (so history tab works instantly)
      setAllJobs(prev => prev.map(job => {
          if (selectedJobIds.has(job.id)) {
              return {
                  ...job,
                  status: 'Dispatched',
                  challanNo,
                  challanDate,
                  vehicleNo,
                  deliveryDate,
                  isClosed: true
              };
          }
          return job;
      }));

      // Instead of clearing instantly, show print dialog
      const dataToPrint = {
          jobs: selectedJobs,
          challanNo,
          challanDate,
          vehicleNo,
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
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 print:m-0 print:max-w-full print:space-y-0">
      
      {/* HEADER TABS - HIDDEN IN PRINT */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Delivery Challans</h1>
          <p className="text-sm text-slate-500">Dispatch transformers and view history</p>
        </div>
        
        <div className="flex bg-slate-100 p-1 rounded-lg">
            <button
                onClick={() => setActiveTab('pending')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md font-bold text-sm transition-colors ${activeTab === 'pending' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
                <Truck className="w-4 h-4" />
                Pending Dispatch
            </button>
            <button
                onClick={() => setActiveTab('history')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md font-bold text-sm transition-colors ${activeTab === 'history' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
                <History className="w-4 h-4" />
                Delivered Jobs
            </button>
        </div>
      </div>

      {activeTab === 'pending' && (
        <div className="space-y-6 print:hidden">
            <div className="bg-white p-6 rounded shadow-sm border border-slate-200">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-bold uppercase text-slate-500">Challan Details</h3>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => {
                                if (selectedJobs.length > 0) {
                                    setPrintData({
                                        jobs: selectedJobs,
                                        challanNo,
                                        challanDate,
                                        vehicleNo,
                                        deliveryDate,
                                        uniqueDivisions,
                                        uniqueMrNos
                                    });
                                    setTimeout(() => {
                                        setIsPrinting(true);
                                        setTimeout(() => {
                                            window.print();
                                            setIsPrinting(false);
                                        }, 500);
                                    }, 100);
                                } else {
                                    alert("Select jobs first to preview challan.");
                                }
                            }}
                            disabled={selectedJobIds.size === 0}
                            className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-700 rounded font-bold hover:bg-slate-200 disabled:opacity-50 text-xs"
                        >
                            <Printer className="w-3.5 h-3.5" />
                            Preview / Print
                        </button>
                        <button
                            onClick={() => handleExportExcel()}
                            disabled={selectedJobIds.size === 0}
                            className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 text-white rounded font-bold hover:bg-emerald-700 disabled:opacity-50 text-xs shadow-sm"
                        >
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                            Export Excel
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Challan No.</label>
                    <input type="text" value={challanNo} onChange={e => setChallanNo(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded text-sm outline-none focus:border-purple-500" placeholder="e.g. CH-23-001" />
                    </div>
                    <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Challan Date</label>
                    <input type="date" value={challanDate} onChange={e => setChallanDate(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded text-sm outline-none focus:border-purple-500" />
                    </div>
                    <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Vehicle / Truck No.</label>
                    <input type="text" value={vehicleNo} onChange={e => setVehicleNo(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded text-sm outline-none focus:border-purple-500" placeholder="e.g. MH 12 AB 1234" />
                    </div>
                    <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Delivery Date</label>
                    <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded text-sm outline-none focus:border-purple-500" />
                    </div>
                </div>
            </div>

            <div className="bg-white border border-slate-200 rounded overflow-hidden flex flex-col">
                <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                      <h2 className="font-bold text-slate-800 flex items-center gap-2">
                          <CheckCircle2 className="w-5 h-5 text-purple-600" />
                          Select Ready Jobs
                      </h2>
                      <div className="flex items-center bg-slate-200/70 p-1 rounded-lg text-xs font-bold">
                        <button
                          type="button"
                          onClick={() => setJobCategoryFilter('All')}
                          className={`px-3 py-1.5 rounded-md transition-colors ${jobCategoryFilter === 'All' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                        >
                          All ({pendingJobs.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setJobCategoryFilter('Repairable')}
                          className={`px-3 py-1.5 rounded-md transition-colors ${jobCategoryFilter === 'Repairable' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                        >
                          Repairable ({repairableCount})
                        </button>
                        <button
                          type="button"
                          onClick={() => setJobCategoryFilter('Scrap')}
                          className={`px-3 py-1.5 rounded-md transition-colors ${jobCategoryFilter === 'Scrap' ? 'bg-white text-rose-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                        >
                          Scrap Jobs ({scrapCount})
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-3">
                        <select 
                            value={selectedDivision} 
                            onChange={(e) => setSelectedDivision(e.target.value)}
                            className="px-3 py-2 border border-slate-200 rounded text-sm outline-none focus:border-purple-500 bg-white min-w-[150px] font-bold text-slate-700"
                        >
                            {availableDivisions.map(div => (
                                <option key={div} value={div}>{div === 'All' ? 'All Divisions' : div}</option>
                            ))}
                        </select>
                        <div className="relative w-full sm:w-64">
                            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input 
                                type="text" 
                                placeholder="Search Job No, MR No..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded text-sm outline-none focus:border-purple-500"
                            />
                        </div>
                    </div>
                </div>
                
                <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center text-sm">
                    <div className="font-bold text-slate-700">
                        {selectedJobIds.size} Jobs Selected
                    </div>
                    <button 
                        onClick={handleSelectAllFiltered}
                        className="text-purple-600 font-bold hover:underline"
                    >
                        Toggle Select All (Filtered)
                    </button>
                </div>

                <div className="p-4">
                    {filteredPendingJobs.length === 0 ? (
                        <div className="text-center py-12 text-slate-400 border-2 border-dashed border-slate-200 rounded">
                            No matching jobs found. Try adjusting your filters.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                            {filteredPendingJobs.map(job => {
                                const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';
                                return (
                                <label key={job.id} className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${selectedJobIds.has(job.id) ? (isScrap ? 'border-rose-500 bg-rose-50' : 'border-purple-500 bg-purple-50') : 'border-slate-200 hover:bg-slate-50'}`}>
                                    <input 
                                        type="checkbox" 
                                        className="mt-1 w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500"
                                        checked={selectedJobIds.has(job.id)}
                                        onChange={() => handleToggleJob(job.id)}
                                    />
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between gap-1 mb-0.5">
                                          <div className="font-bold text-sm text-slate-900">{job.jobNo}</div>
                                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${isScrap ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'}`}>
                                            {isScrap ? 'Scrap Job' : 'Tested OK'}
                                          </span>
                                        </div>
                                        <div className="text-xs text-slate-500 mb-1">
                                          MR: <span className="font-mono text-slate-700 font-medium">{job.mrNo || 'N/A'}</span>{' '}
                                          <span className="text-slate-500 font-mono text-[11px]">({formatDDMMYYYY(job.dateOfIssue || job.mrDate || job.createdAt)})</span>
                                        </div>
                                        <div className="flex justify-between items-center text-[10px] uppercase font-bold text-slate-400">
                                            <span>{job.division}</span>
                                            <span>{job.capacityKva} KVA</span>
                                        </div>
                                    </div>
                                </label>
                                );
                            })}
                        </div>
                    )}
                </div>
                
                <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end">
                    <button 
                        onClick={handleDispatch}
                        disabled={loading || selectedJobIds.size === 0 || !challanNo.trim() || !vehicleNo.trim()}
                        className="px-6 py-2 bg-purple-600 text-white rounded font-bold hover:bg-purple-700 disabled:opacity-50 transition-colors"
                    >
                        {loading ? 'Dispatching...' : (!challanNo.trim() || !vehicleNo.trim() ? 'Enter Challan & Vehicle No to Dispatch' : 'Confirm Dispatch & Auto-Print')}
                    </button>
                </div>
            </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-6 print:hidden">
            {/* SEARCH & FILTERS PANEL */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <History className="w-5 h-5 text-purple-600" />
                    Delivered Jobs & Dispatched History
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Filter and search delivered transformer records by Division, MR No, Challan No, or Job No
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* View Switcher */}
                  <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setHistoryViewMode('cards')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors cursor-pointer ${historyViewMode === 'cards' ? 'bg-white text-purple-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                      title="Grouped by Delivery Challan"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      Challan View
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryViewMode('table')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors cursor-pointer ${historyViewMode === 'table' ? 'bg-white text-purple-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                      title="Detailed Job List Table"
                    >
                      <List className="w-3.5 h-3.5" />
                      Job Table
                    </button>
                  </div>

                  {/* Export Excel for Filtered */}
                  <button
                    type="button"
                    onClick={handleExportAllFilteredHistoryExcel}
                    disabled={filteredDispatchedJobs.length === 0}
                    className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded text-xs font-bold transition-colors shadow-sm cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    Export Filtered Excel ({filteredDispatchedJobs.length})
                  </button>

                  {/* Reset Filters */}
                  {hasActiveHistoryFilters && (
                    <button
                      type="button"
                      onClick={resetHistoryFilters}
                      className="flex items-center gap-1 px-2.5 py-2 text-rose-600 bg-rose-50 hover:bg-rose-100 rounded text-xs font-bold transition-colors cursor-pointer"
                      title="Reset all filters"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {/* Filter Controls Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Search Bar */}
                <div className="relative">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Search Jobs / Challan
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      value={historySearchQuery}
                      onChange={(e) => setHistorySearchQuery(e.target.value)}
                      placeholder="Job No, MR No, Challan, Serial, Make..."
                      className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:bg-white focus:border-purple-500 focus:ring-1 focus:ring-purple-200 transition-all"
                    />
                    {historySearchQuery && (
                      <button
                        type="button"
                        onClick={() => setHistorySearchQuery('')}
                        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Division Filter */}
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Filter by Division
                  </label>
                  <div className="relative">
                    <select
                      value={historyDivisionFilter}
                      onChange={(e) => setHistoryDivisionFilter(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium outline-none focus:bg-white focus:border-purple-500 focus:ring-1 focus:ring-purple-200 cursor-pointer"
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
                </div>

                {/* MR No Filter */}
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Filter by MR No
                  </label>
                  <div className="relative">
                    <select
                      value={historyMrFilter}
                      onChange={(e) => setHistoryMrFilter(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium outline-none focus:bg-white focus:border-purple-500 focus:ring-1 focus:ring-purple-200 cursor-pointer"
                    >
                      <option value="All">All MR Numbers ({historyAvailableMrs.length > 1 ? historyAvailableMrs.length - 1 : 0})</option>
                      {historyAvailableMrs.filter(m => m !== 'All').map(mr => {
                        const count = allDispatchedJobs.filter(j => j.mrNo === mr).length;
                        return (
                          <option key={mr} value={mr}>
                            MR: {mr} ({count} jobs)
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                {/* Category Filter */}
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Job Condition
                  </label>
                  <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 h-[34px]">
                    <button
                      type="button"
                      onClick={() => setHistoryCategoryFilter('All')}
                      className={`flex-1 text-[11px] font-bold rounded transition-colors cursor-pointer ${historyCategoryFilter === 'All' ? 'bg-white text-purple-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                      All ({allDispatchedJobs.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryCategoryFilter('Repairable')}
                      className={`flex-1 text-[11px] font-bold rounded transition-colors cursor-pointer ${historyCategoryFilter === 'Repairable' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                      Tested OK ({historyRepairableCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryCategoryFilter('Scrap')}
                      className={`flex-1 text-[11px] font-bold rounded transition-colors cursor-pointer ${historyCategoryFilter === 'Scrap' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                      Scrap ({historyScrapCount})
                    </button>
                  </div>
                </div>
              </div>

              {/* Active Filter Chips & Summary Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-slate-600 bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-700">Showing:</span>
                  <span className="bg-purple-100 text-purple-800 font-bold px-2 py-0.5 rounded text-[11px]">
                    {filteredDispatchedJobs.length} Delivered Transformers
                  </span>
                  <span className="bg-slate-200 text-slate-700 font-bold px-2 py-0.5 rounded text-[11px]">
                    {filteredChallanHistory.length} Challan(s)
                  </span>

                  {historyDivisionFilter !== 'All' && (
                    <span className="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded text-[11px] font-medium">
                      Division: <strong>{historyDivisionFilter}</strong>
                      <button onClick={() => setHistoryDivisionFilter('All')} className="hover:text-indigo-900 cursor-pointer">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}

                  {historyMrFilter !== 'All' && (
                    <span className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-800 px-2 py-0.5 rounded text-[11px] font-medium">
                      MR: <strong>{historyMrFilter}</strong>
                      <button onClick={() => setHistoryMrFilter('All')} className="hover:text-amber-900 cursor-pointer">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}

                  {historySearchQuery.trim() && (
                    <span className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-800 px-2 py-0.5 rounded text-[11px] font-medium">
                      Query: <strong>"{historySearchQuery}"</strong>
                      <button onClick={() => setHistorySearchQuery('')} className="hover:text-blue-900 cursor-pointer">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )}
                </div>

                {hasActiveHistoryFilters && (
                  <button
                    type="button"
                    onClick={resetHistoryFilters}
                    className="text-purple-600 hover:text-purple-800 font-bold text-[11px] underline cursor-pointer"
                  >
                    Clear All Filters
                  </button>
                )}
              </div>
            </div>

            {/* RESULTS RENDERING */}
            {allDispatchedJobs.length === 0 ? (
              <div className="bg-white p-12 text-center rounded-xl border border-slate-200 text-slate-500 shadow-xs">
                <Truck className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                <h3 className="font-bold text-slate-800 text-base">No Dispatched Jobs Yet</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Completed & tested transformers dispatched using Delivery Challans will appear in this history archive.
                </p>
              </div>
            ) : filteredDispatchedJobs.length === 0 ? (
              <div className="bg-white p-12 text-center rounded-xl border border-slate-200 text-slate-500 shadow-xs">
                <Search className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                <h3 className="font-bold text-slate-800 text-base">No Delivered Jobs Match Filters</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  No delivered transformers found matching your current division, MR number, or search query.
                </p>
                <button
                  type="button"
                  onClick={resetHistoryFilters}
                  className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg text-xs font-bold hover:bg-purple-700 transition-colors cursor-pointer"
                >
                  Reset All Filters
                </button>
              </div>
            ) : historyViewMode === 'cards' ? (
              /* CARD VIEW - GROUPED BY CHALLAN */
              <div className="space-y-4">
                {filteredChallanHistory.map(([cNo, data]) => {
                  const isFilteredSubset = data.jobs.length < data.allJobsInChallan.length;
                  const displayDivisions = data.divisions.join(', ');
                  const displayMrs = data.mrNos.join(', ');

                  return (
                    <div key={cNo} className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden transition-all hover:border-slate-300">
                      {/* Challan Card Header */}
                      <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-bold text-slate-900 text-base md:text-lg flex items-center gap-2">
                              <span>Challan: <strong className="font-mono text-purple-800">{cNo}</strong></span>
                            </h3>
                            {isFilteredSubset && (
                              <span className="text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 rounded">
                                Matched {data.jobs.length} of {data.allJobsInChallan.length} Jobs
                              </span>
                            )}
                          </div>
                          
                          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 font-medium">
                            <span>Challan Date: <strong className="font-mono text-slate-800">{formatDDMMYYYY(data.challanDate)}</strong></span>
                            <span>Vehicle: <strong className="font-mono uppercase text-slate-800">{data.vehicleNo || '-'}</strong></span>
                            {displayDivisions && <span>Division(s): <strong className="uppercase text-slate-800">{displayDivisions}</strong></span>}
                            {displayMrs && <span>MR No(s): <strong className="font-mono text-slate-800">{displayMrs}</strong></span>}
                          </div>
                        </div>

                        {/* Card Actions */}
                        <div className="flex items-center gap-2 self-end sm:self-center">
                          <button
                            type="button"
                            onClick={() => handlePrintPastChallan(cNo, { ...data, jobs: data.allJobsInChallan })}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-bold transition-colors text-xs shadow-xs cursor-pointer"
                            title="Print original challan with all jobs"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            Print Challan
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadWord(cNo, { ...data, jobs: data.allJobsInChallan })}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold transition-colors text-xs shadow-xs cursor-pointer"
                            title="Download Word Document (.doc)"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            Word
                          </button>
                          <button
                            type="button"
                            onClick={() => handleExportExcel(cNo, { ...data, jobs: data.allJobsInChallan })}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold transition-colors text-xs shadow-xs cursor-pointer"
                            title="Export Excel (.xlsx)"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                            Excel
                          </button>
                        </div>
                      </div>

                      {/* Challan Card Job Items */}
                      <div className="p-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5">
                          {data.jobs.map(job => {
                            const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';
                            const mrDateStr = formatDDMMYYYY(job.dateOfIssue || job.mrDate || job.createdAt);
                            
                            return (
                              <div
                                key={job.id}
                                className={`p-2.5 border rounded-lg transition-all ${
                                  isScrap 
                                    ? 'bg-rose-50/50 border-rose-200' 
                                    : 'bg-slate-50/80 border-slate-200 hover:border-purple-300 hover:bg-purple-50/30'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1 mb-1">
                                  <span className="font-mono font-bold text-xs text-slate-900">{job.jobNo}</span>
                                  {isScrap ? (
                                    <span className="text-[9px] bg-rose-100 text-rose-700 font-bold px-1.5 py-0.5 rounded">
                                      SCRAP
                                    </span>
                                  ) : (
                                    <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.5 rounded">
                                      OK
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] font-bold text-slate-700">
                                  {job.capacityKva} KVA {job.make ? `• ${job.make}` : ''}
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono mt-1 pt-1 border-t border-slate-200/60 flex flex-col gap-0.5">
                                  <div>MR: <strong className="text-slate-700">{job.mrNo || '-'}</strong></div>
                                  <div>MR Rec: <span>({mrDateStr})</span></div>
                                  {job.division && <div className="text-[9px] text-slate-400 uppercase">{job.division}</div>}
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
              /* TABLE VIEW - DETAILED JOB LEDGER */
              <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 uppercase tracking-wider text-[10px]">
                        <th className="p-3 text-center w-12">Sr.</th>
                        <th className="p-3">Job No</th>
                        <th className="p-3">MR No & Receive Date</th>
                        <th className="p-3">Division</th>
                        <th className="p-3 text-center">Capacity</th>
                        <th className="p-3">Make / Serial</th>
                        <th className="p-3">Challan Details</th>
                        <th className="p-3">Vehicle</th>
                        <th className="p-3 text-center">Condition</th>
                        <th className="p-3 text-right">Challan Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filteredDispatchedJobs.map((job, idx) => {
                        const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';
                        const mrDateStr = formatDDMMYYYY(job.dateOfIssue || job.mrDate || job.createdAt);
                        
                        return (
                          <tr key={job.id} className="hover:bg-slate-50 transition-colors">
                            <td className="p-3 text-center font-bold text-slate-400">{idx + 1}</td>
                            <td className="p-3 font-mono font-bold text-slate-900">{job.jobNo}</td>
                            <td className="p-3">
                              <div className="font-mono font-bold text-slate-800">{job.mrNo || '-'}</div>
                              <div className="text-[10px] text-slate-500">Rec: ({mrDateStr})</div>
                            </td>
                            <td className="p-3 font-bold uppercase text-slate-700">{job.division || '-'}</td>
                            <td className="p-3 text-center font-bold text-slate-900">{job.capacityKva} KVA</td>
                            <td className="p-3">
                              <div className="font-medium text-slate-800">{job.make || '-'}</div>
                              <div className="text-[10px] font-mono text-slate-500">S/N: {job.serialNo || '-'}</div>
                            </td>
                            <td className="p-3">
                              <div className="font-mono font-bold text-purple-700">{job.challanNo || '-'}</div>
                              <div className="text-[10px] text-slate-500">Date: {formatDDMMYYYY(job.challanDate)}</div>
                            </td>
                            <td className="p-3 font-mono uppercase text-slate-700">{job.vehicleNo || '-'}</td>
                            <td className="p-3 text-center">
                              {isScrap ? (
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                                  Scrap
                                </span>
                              ) : (
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                  Tested OK
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  // Find the full challan group
                                  const matchChallan = allDispatchedJobs.filter(j => j.challanNo === job.challanNo);
                                  handlePrintPastChallan(job.challanNo, {
                                    challanDate: job.challanDate,
                                    vehicleNo: job.vehicleNo,
                                    deliveryDate: job.deliveryDate,
                                    jobs: matchChallan
                                  });
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded text-[10px] font-bold transition-colors cursor-pointer"
                                title="Print this Challan"
                              >
                                <Printer className="w-3 h-3" />
                                Challan
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

      {/* Printable Challan Modal / Full View */}
      {printData && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 overflow-y-auto p-4 md:p-8 flex justify-center items-start print:p-0 print:static print:bg-transparent print:backdrop-blur-none">
          <style>
            {`
              @media print {
                @page { size: portrait; margin: 10mm; }
                body { font-family: sans-serif; -webkit-print-color-adjust: exact; }
                .print\\:hidden { display: none !important; }
                #printable-challan-section { box-shadow: none !important; border: none !important; padding: 0 !important; margin: 0 !important; width: 100% !important; max-width: 100% !important; }
              }
            `}
          </style>
          
          <div id="printable-challan-section" className="bg-white shadow-2xl border border-slate-300 rounded-xl p-6 md:p-8 text-black w-full max-w-4xl print:m-0 print:p-0 print:border-none print:shadow-none print:max-w-none">
            
            {/* Action Bar (Screen Only) */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 text-white p-4 rounded-lg mb-6 print:hidden shadow-sm">
              <div>
                <h3 className="font-bold text-sm">Challan Document: {printData.challanNo || 'Pending'}</h3>
                <p className="text-xs text-slate-300 mt-0.5">{printData.jobs?.length || 0} Transformer(s) Dispatched</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2 rounded transition-colors shadow-sm cursor-pointer"
                >
                  <Printer className="w-4 h-4" /> Print / PDF
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadWord(printData.challanNo, printData)}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2 rounded transition-colors shadow-sm cursor-pointer"
                >
                  <FileText className="w-4 h-4" /> Download Word (.doc)
                </button>
                <button
                  type="button"
                  onClick={() => handleExportExcel(printData.challanNo, printData)}
                  className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded transition-colors shadow-sm cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4" /> Export Excel
                </button>
                <button
                  type="button"
                  onClick={() => setPrintData(null)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors cursor-pointer"
                  title="Close Preview"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Document Sheet */}
            <div id="printable-challan-sheet" className="p-4 md:p-6 border border-slate-200 rounded print:border-none print:p-0 bg-white">
              {/* Header with Letterhead support */}
              <LetterheadHeader agency={activeAgency} documentTitle="DELIVERY CHALLAN" />

              <div className="flex justify-between items-start mb-6 text-sm">
                <div className="space-y-1">
                  <div className="flex"><span className="w-24 font-bold">To:</span> <span className="font-bold uppercase max-w-xs">{printData.uniqueDivisions || 'DIVISION'}</span></div>
                  <div className="flex"><span className="w-24 font-bold">Vehicle No:</span> <span className="font-mono uppercase font-bold">{printData.vehicleNo || '________________'}</span></div>
                  <div className="flex"><span className="w-24 font-bold">MR No(s):</span> <span className="font-mono uppercase max-w-xs">{printData.uniqueMrNos}</span></div>
                </div>
                <div className="space-y-1 text-right">
                  <div className="flex justify-end"><span className="w-28 font-bold text-left">Challan No:</span> <span className="font-mono uppercase font-bold">{printData.challanNo || '________________'}</span></div>
                  <div className="flex justify-end"><span className="w-28 font-bold text-left">Date:</span> <span className="font-mono">{formatDDMMYYYY(printData.challanDate)}</span></div>
                  <div className="flex justify-end"><span className="w-28 font-bold text-left">Delivery Date:</span> <span className="font-mono">{formatDDMMYYYY(printData.deliveryDate)}</span></div>
                </div>
              </div>

              <div className="min-h-[300px]">
                <table className="w-full text-xs md:text-sm border-collapse border border-slate-800">
                  <thead>
                    <tr className="bg-slate-100 print:bg-slate-100 font-bold">
                      <th className="border border-slate-800 p-2 text-center w-10">Sr.</th>
                      <th className="border border-slate-800 p-2 text-left">Job No.</th>
                      <th className="border border-slate-800 p-2 text-left">MR No & Date</th>
                      <th className="border border-slate-800 p-2 text-left">Make</th>
                      <th className="border border-slate-800 p-2 text-center">Capacity (KVA)</th>
                      <th className="border border-slate-800 p-2 text-left">Serial No.</th>
                      <th className="border border-slate-800 p-2 text-center">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {printData.jobs?.map((job: any, idx: number) => {
                      const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';
                      const mrDateStr = formatDDMMYYYY(job.dateOfIssue || job.mrDate || job.createdAt);
                      return (
                        <tr key={job.id || idx}>
                          <td className="border border-slate-800 p-2 text-center font-bold">{idx + 1}</td>
                          <td className="border border-slate-800 p-2 font-mono font-bold">{job.jobNo}</td>
                          <td className="border border-slate-800 p-2 font-mono text-xs">
                            {job.mrNo || '-'} <span className="text-slate-600">({mrDateStr})</span>
                          </td>
                          <td className="border border-slate-800 p-2">{job.make}</td>
                          <td className="border border-slate-800 p-2 text-center font-bold">{job.capacityKva}</td>
                          <td className="border border-slate-800 p-2 font-mono">{job.serialNo || '-'}</td>
                          <td className="border border-slate-800 p-2 text-center text-xs font-semibold">
                            {isScrap ? 'Scrap - Returned to Division' : 'Tested OK'}
                          </td>
                        </tr>
                      );
                    })}
                    {(!printData.jobs || printData.jobs.length === 0) && (
                      <tr>
                        <td colSpan={7} className="border border-slate-800 p-8 text-center text-slate-400">
                          No jobs selected
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                
                <div className="mt-4 text-sm font-bold flex justify-between items-center">
                  <span>Total Transformers Dispatched: {printData.jobs?.length || 0}</span>
                </div>
              </div>

              <div className="mt-16 flex justify-between items-end text-sm font-bold">
                <div className="text-center">
                  <div className="w-48 border-b border-slate-800 mb-2"></div>
                  Receiver's Signature
                </div>
                <div className="text-center">
                  <div className="w-48 border-b border-slate-800 mb-2"></div>
                  For {activeAgency?.name || ''}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
