import React, { useState, useEffect, useMemo } from 'react';
import { useAgency } from '../lib/AgencyContext';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
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
  Building2
} from 'lucide-react';
import * as XLSX from 'xlsx';

export default function Reports() {
  const { activeAgency } = useAgency();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'master' | 'pending' | 'testing_ready' | 'delivered' | 'scrap'>('master');
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('All');
  const [stageFilter, setStageFilter] = useState('All');

  const fetchJobs = async () => {
    if (!auth.currentUser || !activeAgency) { setLoading(false); return; }
    setLoading(true);
    try {
      const q = query(
        collection(db, 'jobs'),
        where('ownerId', '==', auth.currentUser.uid), 
        where('agencyId', '==', activeAgency.id)
      );
      const snapshot = await getDocs(q);
      const fetchedJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // Sort jobs numeric order by jobNo
      fetchedJobs.sort((a: any, b: any) => (a.jobNo || '').localeCompare(b.jobNo || '', undefined, { numeric: true }));
      
      setJobs(fetchedJobs);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [activeAgency]);

  // Extract unique divisions
  const divisions = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach(j => { if (j.division) set.add(j.division); });
    return Array.from(set).sort();
  }, [jobs]);

  // Metric Stats
  const stats = useMemo(() => {
    let pendingExternal = 0;
    let pendingInternal = 0;
    let pendingTesting = 0;
    let readyForDispatch = 0;
    let dispatched = 0;
    let scrap = 0;

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
    });

    return {
      total: jobs.length,
      pendingExternal,
      pendingInternal,
      pendingTesting,
      readyForDispatch,
      dispatched,
      scrap
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
        if (!matchNo && !matchMr && !matchMake && !matchSerial && !matchChallan) return false;
      }

      // Division filter
      if (divisionFilter !== 'All' && j.division !== divisionFilter) return false;

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
  }, [jobs, searchQuery, divisionFilter, stageFilter, activeTab]);

  // Export Active Report to Excel
  const handleExportExcel = () => {
    const data: any[] = [];
    filteredJobs.forEach((j, idx) => {
      const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
      data.push({
        'S.N.': idx + 1,
        'Job No': j.jobNo || '',
        'MR No': j.mrNo || '',
        'MR Issue Date': j.dateOfIssue || '',
        'Division': j.division || '',
        'Capacity (KVA)': j.capacityKva || '',
        'Make': j.make || '',
        'Serial No': j.serialNo || '',
        'Core Type': j.coreType || '',
        'Current Stage / Status': isScrap ? 'Scrap Job' : (j.status || 'Received'),
        'Repair Condition': isScrap ? 'Scrap - Return to Division' : (j.repairType || 'Repairable'),
        'External Insp Date': j.externalDetails?.dateOfInspection || '-',
        'Internal Insp Date': j.internalDetails?.dateOfInspection || '-',
        'Testing Date': j.testingDetails?.testDate || '-',
        'Delivery Challan No': j.challanNo || '-',
        'Delivery Date': j.deliveryDate || j.challanDate || '-',
        'Vehicle No': j.vehicleNo || '-',
        'Bill No': j.billNo || '-'
      });
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    const sheetName = activeTab.toUpperCase();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `Transformer_Report_${activeTab}_${new Date().toISOString().split('T')[0]}.xlsx`);
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
            Master Reports & Job Analytics
          </h1>
          <p className="text-sm text-slate-500">Track complete lifecycle details for all transformer repair jobs</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchJobs}
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
            Export to Excel ({filteredJobs.length})
          </button>
        </div>
      </div>

      {/* Quick Metric Dashboard */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-center">
          <div className="text-2xl font-black text-slate-900">{stats.total}</div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-1">Total Jobs</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-center">
          <div className="text-2xl font-black text-amber-600">{stats.pendingExternal + stats.pendingInternal}</div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-1">In Inspection</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-center">
          <div className="text-2xl font-black text-blue-600">{stats.pendingTesting}</div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-1">In Testing</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-center">
          <div className="text-2xl font-black text-indigo-600">{stats.readyForDispatch}</div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-1">Ready Dispatch</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-center">
          <div className="text-2xl font-black text-emerald-600">{stats.dispatched}</div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-1">Dispatched</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-center">
          <div className="text-2xl font-black text-rose-600">{stats.scrap}</div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-1">Scrap Jobs</div>
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
              placeholder="Search Job No, MR, Make, Serial..."
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
                  <th className="px-3 py-3 font-bold uppercase tracking-wider text-[10px]">Inspections</th>
                  <th className="px-3 py-3 font-bold uppercase tracking-wider text-[10px]">Delivery Challan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredJobs.map((job, idx) => {
                  const isScrap = job.status === 'Scrap' || job.condition === 'Scrap';

                  return (
                    <tr key={job.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-3 text-slate-400 font-mono">{idx + 1}</td>
                      <td className="px-3 py-3 font-mono font-bold text-slate-900">{job.jobNo}</td>
                      <td className="px-3 py-3">
                        <div className="font-mono font-bold text-slate-800">{job.mrNo || 'N/A'}</div>
                        <div className="text-[10px] text-slate-500">{job.dateOfIssue || '-'}</div>
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
                          <span>{job.externalDetails?.dateOfInspection ? `Done (${job.externalDetails.dateOfInspection})` : 'Pending'}</span>
                        </div>
                        <div className="flex items-center gap-1 text-slate-600">
                          <span className="font-bold text-slate-800">Int:</span>
                          <span>{job.internalDetails?.dateOfInspection ? `Done (${job.internalDetails.dateOfInspection})` : 'Pending'}</span>
                        </div>
                        <div className="flex items-center gap-1 text-slate-600">
                          <span className="font-bold text-slate-800">Test:</span>
                          <span>{job.testingDetails?.testDate ? `Tested (${job.testingDetails.testDate})` : 'Pending'}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {job.status === 'Dispatched' ? (
                          <div className="space-y-0.5">
                            <div className="font-mono font-bold text-emerald-800">{job.challanNo || 'Dispatched'}</div>
                            <div className="text-[10px] text-slate-500">Date: {job.deliveryDate || job.challanDate || '-'}</div>
                            <div className="text-[10px] text-slate-500">Vehicle: {job.vehicleNo || '-'}</div>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Not Dispatched</span>
                        )}
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
    </div>
  );
}
