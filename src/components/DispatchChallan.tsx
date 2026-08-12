import React, { useState, useEffect, useMemo } from 'react';
import { useAgency } from '../lib/AgencyContext';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { Loader2, Printer, Search, Truck } from 'lucide-react';

export default function DispatchChallan() {
  const { activeAgency } = useAgency();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDivision, setSelectedDivision] = useState('All');
  
  const [challanNo, setChallanNo] = useState('');
  const [challanDate, setChallanDate] = useState(new Date().toISOString().split('T')[0]);
  const [vehicleNo, setVehicleNo] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    async function fetchJobs() {
      if (!auth.currentUser || !activeAgency) { setLoading(false); return; }
      try {
        const q = query(
          collection(db, 'jobs'),
          where('ownerId', '==', auth.currentUser.uid), 
          where('agencyId', '==', activeAgency.id)
        );
        const snapshot = await getDocs(q);
        const fetchedJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        // Filter to only jobs that are ready for dispatch
        const readyJobs = fetchedJobs.filter(j => 
            j.status === 'Tested - Ready for Dispatch' &&
            j.isClosed !== true
        );
        // Sort by job number
        readyJobs.sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));
        
        setJobs(readyJobs);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'jobs');
      } finally {
        setLoading(false);
      }
    }
    fetchJobs();
  }, [activeAgency]);

  const availableDivisions = useMemo(() => {
    const divs = new Set(jobs.map(j => j.division).filter(Boolean));
    return ['All', ...Array.from(divs)].sort();
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    let result = jobs;
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
  }, [jobs, searchQuery, selectedDivision]);

  const handleToggleJob = (id: string) => {
    const next = new Set(selectedJobIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedJobIds(next);
  };
  
  const handleSelectAllFiltered = () => {
    const next = new Set(selectedJobIds);
    let allSelected = true;
    for (const job of filteredJobs) {
       if (!next.has(job.id)) {
           allSelected = false;
           break;
       }
    }
    
    if (allSelected) {
        filteredJobs.forEach(job => next.delete(job.id));
    } else {
        filteredJobs.forEach(job => next.add(job.id));
    }
    setSelectedJobIds(next);
  };

  const selectedJobs = jobs.filter(j => selectedJobIds.has(j.id));

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
      alert("Successfully dispatched!");
      setSelectedJobIds(new Set());
      setChallanNo('');
      setVehicleNo('');
      
      // Remove dispatched jobs from the local state
      setJobs(prev => prev.filter(j => !selectedJobIds.has(j.id)));
      
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'jobs');
    } finally {
      setLoading(false);
    }
  };

  if (loading && jobs.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 print:m-0 print:max-w-full print:space-y-0">
      <div className="flex justify-between items-center print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Delivery Challan</h1>
          <p className="text-sm text-slate-500">Dispatch tested transformers and generate challans</p>
        </div>
        <button 
          onClick={() => {
            setIsPrinting(true);
            setTimeout(() => {
                window.print();
                setIsPrinting(false);
            }, 500);
          }}
          disabled={selectedJobIds.size === 0}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded font-bold hover:bg-slate-700 disabled:opacity-50 transition-colors"
        >
          <Printer className="w-4 h-4" />
          Print Challan
        </button>
      </div>

      <div className={`bg-white p-6 rounded shadow-sm border border-slate-200 print:hidden`}>
        <h3 className="text-sm font-bold uppercase text-slate-500 mb-4">Challan Details</h3>
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

      <div className="bg-white border border-slate-200 rounded overflow-hidden flex flex-col print:hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row justify-between items-center gap-4">
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
                <Truck className="w-5 h-5 text-purple-600" />
                Select Ready Jobs
            </h2>
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
            {filteredJobs.length === 0 ? (
                <div className="text-center py-12 text-slate-400 border-2 border-dashed border-slate-200 rounded">
                    No ready jobs found. Try adjusting your search.
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {filteredJobs.map(job => (
                        <label key={job.id} className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${selectedJobIds.has(job.id) ? 'border-purple-500 bg-purple-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                            <input 
                                type="checkbox" 
                                className="mt-1 w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500"
                                checked={selectedJobIds.has(job.id)}
                                onChange={() => handleToggleJob(job.id)}
                            />
                            <div className="flex-1">
                                <div className="font-bold text-sm text-slate-900">{job.jobNo}</div>
                                <div className="text-xs text-slate-500 mb-1">MR: <span className="font-mono text-slate-700">{job.mrNo || 'N/A'}</span></div>
                                <div className="flex justify-between items-center text-[10px] uppercase font-bold text-slate-400">
                                    <span>{job.division}</span>
                                    <span>{job.capacityKva} KVA</span>
                                </div>
                            </div>
                        </label>
                    ))}
                </div>
            )}
        </div>
        
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end">
            <button 
                onClick={handleDispatch}
                disabled={loading || selectedJobIds.size === 0}
                className="px-6 py-2 bg-purple-600 text-white rounded font-bold hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
                {loading ? 'Dispatching...' : 'Confirm Dispatch & Close Jobs'}
            </button>
        </div>
      </div>

      {/* Printable Challan Format */}
      <div className={`bg-white shadow-sm border border-slate-200 ${isPrinting ? 'print:block print:border-none print:shadow-none' : 'hidden print:block'}`}>
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
              <div className="flex"><span className="w-24 font-bold">To:</span> <span className="font-bold uppercase max-w-xs">{uniqueDivisions || 'DIVISION'}</span></div>
              <div className="flex"><span className="w-24 font-bold">Vehicle No:</span> <span className="font-mono uppercase">{vehicleNo || '________________'}</span></div>
              <div className="flex"><span className="w-24 font-bold">MR No(s):</span> <span className="font-mono uppercase max-w-xs">{uniqueMrNos}</span></div>
            </div>
            <div className="space-y-1 text-right">
              <div className="flex justify-end"><span className="w-28 font-bold text-left">Challan No:</span> <span className="font-mono uppercase">{challanNo || '________________'}</span></div>
              <div className="flex justify-end"><span className="w-28 font-bold text-left">Date:</span> <span className="font-mono">{challanDate}</span></div>
              <div className="flex justify-end"><span className="w-28 font-bold text-left">Delivery Date:</span> <span className="font-mono">{deliveryDate}</span></div>
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
                {selectedJobs.map((job, idx) => (
                  <tr key={job.id}>
                    <td className="border border-slate-800 p-2 text-center">{idx + 1}</td>
                    <td className="border border-slate-800 p-2 font-mono font-bold">{job.jobNo}</td>
                    <td className="border border-slate-800 p-2">{job.make}</td>
                    <td className="border border-slate-800 p-2 text-center">{job.capacityKva}</td>
                    <td className="border border-slate-800 p-2 font-mono">{job.serialNo || '-'}</td>
                    <td className="border border-slate-800 p-2 text-center text-xs">Tested OK</td>
                  </tr>
                ))}
                {selectedJobs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="border border-slate-800 p-8 text-center text-slate-400">
                      No jobs selected
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            
            <div className="mt-4 text-sm">
                <span className="font-bold">Total Transformers Dispatched: </span> {selectedJobs.length}
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
      </div>
    </div>
  );
}
