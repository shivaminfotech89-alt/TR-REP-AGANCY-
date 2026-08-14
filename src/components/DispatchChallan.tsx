import React, { useState, useEffect, useMemo } from 'react';
import { useAgency } from '../lib/AgencyContext';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { Loader2, Printer, Search, Truck, CheckCircle2, History, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';

export default function DispatchChallan() {
  const { activeAgency } = useAgency();
  const [allJobs, setAllJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [jobCategoryFilter, setJobCategoryFilter] = useState<'All' | 'Repairable' | 'Scrap'>('All');
  const [selectedDivision, setSelectedDivision] = useState('All');
  
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

  // Derived dispatched jobs history
  const challanHistory = useMemo(() => {
    const dispatched = allJobs.filter(j => j.status === 'Dispatched' && j.challanNo);
    const groups: Record<string, { jobs: any[], challanDate: string, vehicleNo: string, deliveryDate: string }> = {};
    
    dispatched.forEach(job => {
        if (!groups[job.challanNo]) {
            groups[job.challanNo] = {
                jobs: [],
                challanDate: job.challanDate || '',
                vehicleNo: job.vehicleNo || '',
                deliveryDate: job.deliveryDate || ''
            };
        }
        groups[job.challanNo].jobs.push(job);
    });
    
    // Sort challans by date descending
    return Object.entries(groups).sort((a, b) => {
        return new Date(b[1].challanDate).getTime() - new Date(a[1].challanDate).getTime();
    });
  }, [allJobs]);

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
      setPrintData({
          jobs: selectedJobs,
          challanNo,
          challanDate,
          vehicleNo,
          deliveryDate,
          uniqueDivisions,
          uniqueMrNos
      });
      
      setSelectedJobIds(new Set());
      setChallanNo('');
      setVehicleNo('');
      
      setTimeout(() => {
          setIsPrinting(true);
          setTimeout(() => {
              window.print();
              setIsPrinting(false);
          }, 500);
      }, 500);
      
    } catch (err: any) {
      console.error("DISPATCH ERROR", err);
      alert("Error: " + (err.message || err.toString()));
      handleFirestoreError(err, OperationType.UPDATE, 'jobs');
    } finally {
      setLoading(false);
    }
  };

  const handlePrintPastChallan = (challanNo: string, data: any) => {
    const divs = [...new Set(data.jobs.map((j: any) => j.division).filter(Boolean))].join(', ');
    const mrs = [...new Set(data.jobs.map((j: any) => j.mrNo).filter(Boolean))].join(', ');
    
    setPrintData({
        jobs: data.jobs,
        challanNo: challanNo,
        challanDate: data.challanDate,
        vehicleNo: data.vehicleNo,
        deliveryDate: data.deliveryDate,
        uniqueDivisions: divs,
        uniqueMrNos: mrs
    });
    
    setTimeout(() => {
        setIsPrinting(true);
        setTimeout(() => {
            window.print();
            setIsPrinting(false);
        }, 500);
    }, 100);
  };

  const handleExportExcel = (cNo?: string, data?: any) => {
    const wsData: any[][] = [];
    if (cNo && data) {
      wsData.push([`DELIVERY CHALLAN - ${cNo}`]);
      wsData.push([`Challan Date: ${data.challanDate}`, `Vehicle No: ${data.vehicleNo}`, `Delivery Date: ${data.deliveryDate}`]);
      wsData.push([]);
      wsData.push(['S.N.', 'Job No', 'MR No', 'Capacity (KVA)', 'Make', 'Serial No', 'Division', 'Remarks / Job Condition']);
      data.jobs.forEach((job: any, idx: number) => {
        const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';
        wsData.push([
          idx + 1,
          job.jobNo,
          job.mrNo,
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
      wsData.push([`Challan Date: ${challanDate}`, `Vehicle No: ${vehicleNo}`, `Delivery Date: ${deliveryDate}`]);
      wsData.push([]);
      wsData.push(['S.N.', 'Job No', 'MR No', 'Capacity (KVA)', 'Make', 'Serial No', 'Division', 'Remarks / Job Condition']);
      selectedJobs.forEach((job: any, idx: number) => {
        const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';
        wsData.push([
          idx + 1,
          job.jobNo,
          job.mrNo,
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
                                        <div className="text-xs text-slate-500 mb-1">MR: <span className="font-mono text-slate-700">{job.mrNo || 'N/A'}</span></div>
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
        <div className="space-y-4 print:hidden">
            {challanHistory.length === 0 ? (
                <div className="bg-white p-12 text-center rounded border border-slate-200 text-slate-500">
                    No dispatched challans found.
                </div>
            ) : (
                challanHistory.map(([cNo, data]) => (
                    <div key={cNo} className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
                        <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                            <div>
                                <h3 className="font-bold text-slate-900 text-lg">Challan: {cNo}</h3>
                                <p className="text-xs text-slate-500 flex gap-4 mt-1">
                                    <span>Date: {data.challanDate}</span>
                                    <span>Vehicle: {data.vehicleNo}</span>
                                    <span>Jobs: {data.jobs.length}</span>
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => handlePrintPastChallan(cNo, data)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-white rounded font-bold hover:bg-slate-700 transition-colors text-xs"
                                >
                                    <Printer className="w-3.5 h-3.5" />
                                    Print Challan
                                </button>
                                <button
                                    onClick={() => handleExportExcel(cNo, data)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded font-bold hover:bg-emerald-700 transition-colors text-xs shadow-sm"
                                >
                                    <FileSpreadsheet className="w-3.5 h-3.5" />
                                    Export Excel
                                </button>
                            </div>
                        </div>
                        <div className="p-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                                {data.jobs.map(job => {
                                    const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';
                                    return (
                                    <div key={job.id} className="p-2 border border-slate-100 rounded bg-slate-50 text-center">
                                        <div className="font-bold text-slate-800 text-xs flex items-center justify-center gap-1">
                                            <span>{job.jobNo}</span>
                                            {isScrap && <span className="text-[9px] bg-rose-100 text-rose-700 font-bold px-1 rounded">SCRAP</span>}
                                        </div>
                                        <div className="text-[10px] text-slate-500">{job.capacityKva} KVA</div>
                                    </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                ))
            )}
        </div>
      )}

      {/* Printable Challan Format */}
      <div className={`bg-white shadow-sm border border-slate-200 ${isPrinting ? 'print:block print:border-none print:shadow-none' : 'hidden print:block'}`}>
        {printData ? (
            <div className="p-8 print:p-0">
            <div className="text-center mb-8 border-b-2 border-slate-800 pb-4">
                <h1 className="text-3xl font-bold text-slate-900 uppercase tracking-widest">{activeAgency?.name}</h1>
                <p className="text-sm text-slate-600 mt-1">{activeAgency?.address}</p>
                <div className="mt-4 inline-block bg-slate-900 text-white px-6 py-1 rounded-full text-sm font-bold tracking-widest uppercase">
                Delivery Challan
                </div>
            </div>

            <div className="flex justify-between items-start mb-8 text-sm">
                <div className="space-y-1">
                <div className="flex"><span className="w-24 font-bold">To:</span> <span className="font-bold uppercase max-w-xs">{printData.uniqueDivisions || 'DIVISION'}</span></div>
                <div className="flex"><span className="w-24 font-bold">Vehicle No:</span> <span className="font-mono uppercase">{printData.vehicleNo || '________________'}</span></div>
                <div className="flex"><span className="w-24 font-bold">MR No(s):</span> <span className="font-mono uppercase max-w-xs">{printData.uniqueMrNos}</span></div>
                </div>
                <div className="space-y-1 text-right">
                <div className="flex justify-end"><span className="w-28 font-bold text-left">Challan No:</span> <span className="font-mono uppercase">{printData.challanNo || '________________'}</span></div>
                <div className="flex justify-end"><span className="w-28 font-bold text-left">Date:</span> <span className="font-mono">{printData.challanDate}</span></div>
                <div className="flex justify-end"><span className="w-28 font-bold text-left">Delivery Date:</span> <span className="font-mono">{printData.deliveryDate}</span></div>
                </div>
            </div>

            <div className="min-h-[400px]">
                <table className="w-full text-sm border-collapse border border-slate-800">
                <thead>
                    <tr className="bg-slate-100 print:bg-slate-100">
                    <th className="border border-slate-800 p-2 text-center w-12">Sr.</th>
                    <th className="border border-slate-800 p-2 text-left">Job No.</th>
                    <th className="border border-slate-800 p-2 text-left">Make</th>
                    <th className="border border-slate-800 p-2 text-center">Capacity (KVA)</th>
                    <th className="border border-slate-800 p-2 text-left">Serial No.</th>
                    <th className="border border-slate-800 p-2 text-center">Remarks</th>
                    </tr>
                </thead>
                <tbody>
                    {printData.jobs.map((job: any, idx: number) => {
                    const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';
                    return (
                    <tr key={job.id}>
                        <td className="border border-slate-800 p-2 text-center">{idx + 1}</td>
                        <td className="border border-slate-800 p-2 font-mono font-bold">{job.jobNo}</td>
                        <td className="border border-slate-800 p-2">{job.make}</td>
                        <td className="border border-slate-800 p-2 text-center">{job.capacityKva}</td>
                        <td className="border border-slate-800 p-2 font-mono">{job.serialNo || '-'}</td>
                        <td className="border border-slate-800 p-2 text-center text-xs font-semibold">
                          {isScrap ? 'Scrap - Returned to Division' : 'Tested OK'}
                        </td>
                    </tr>
                    );
                    })}
                    {printData.jobs.length === 0 && (
                    <tr>
                        <td colSpan={6} className="border border-slate-800 p-8 text-center text-slate-400">
                        No jobs selected
                        </td>
                    </tr>
                    )}
                </tbody>
                </table>
                
                <div className="mt-4 text-sm">
                    <span className="font-bold">Total Transformers Dispatched: </span> {printData.jobs.length}
                </div>
            </div>

            <div className="mt-16 flex justify-between items-end text-sm font-bold">
                <div className="text-center">
                <div className="w-48 border-b border-slate-800 mb-2"></div>
                Receiver's Signature
                </div>
                <div className="text-center">
                <div className="w-48 border-b border-slate-800 mb-2"></div>
                For {activeAgency?.name}
                </div>
            </div>

            </div>
        ) : (
            <div className="p-8 text-center text-slate-500">Challan not yet generated.</div>
        )}
      </div>
    </div>
  );
}
