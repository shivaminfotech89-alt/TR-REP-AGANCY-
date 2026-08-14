import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAgency } from '../lib/AgencyContext';
import { Loader2, Search, ChevronDown, ChevronRight, Edit, FileSpreadsheet, Building2, Filter } from 'lucide-react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { formatDDMMYYYY } from '../lib/utils';

interface Job {
  id: string;
  mrNo: string;
  dateOfIssue: string;
  jobNo: string;
  capacityKva: number;
  make: string;
  serialNo: string;
  status: string;
  repairType: string;
  division: string;
  createdAt: any;
}

interface MrGroup {
  mrNo: string;
  dateOfIssue: string;
  division: string;
  jobs: Job[];
}

export default function MrLedger() {
  const { activeAgency } = useAgency();
  const [loading, setLoading] = useState(true);
  const [mrGroups, setMrGroups] = useState<MrGroup[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDivision, setSelectedDivision] = useState<string>('All');
  const [expandedMrs, setExpandedMrs] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function fetchJobs() {
      if (!auth.currentUser || !activeAgency) {
        setMrGroups([]);
        setLoading(false);
        return;
      }
      
      try {
        const q = query(
          collection(db, 'jobs'),
          where('ownerId', '==', auth.currentUser.uid),
          where('agencyId', '==', activeAgency.id),
        );
        const snapshot = await getDocs(q);
        const fetchedJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Job));
        
        // Group by MR No
        const groups: Record<string, MrGroup> = {};
        fetchedJobs.forEach(job => {
          if (!groups[job.mrNo]) {
            groups[job.mrNo] = {
              mrNo: job.mrNo,
              dateOfIssue: job.dateOfIssue,
              division: job.division || 'Unknown',
              jobs: []
            };
          }
          groups[job.mrNo].jobs.push(job);
        });
        
        // Sort MRs by date (newest first)
        const sortedGroups = Object.values(groups).sort((a, b) => {
          return new Date(b.dateOfIssue).getTime() - new Date(a.dateOfIssue).getTime();
        });
        
        setMrGroups(sortedGroups);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'jobs');
      } finally {
        setLoading(false);
      }
    }
    
    fetchJobs();
  }, [activeAgency]);

  // Extract unique divisions for filter
  const divisions = useMemo(() => {
    const set = new Set<string>();
    mrGroups.forEach(g => {
      if (g.division && g.division.trim()) set.add(g.division.trim());
    });
    // Also include configured prefixes if available
    if (activeAgency?.prefixes) {
      Object.keys(activeAgency.prefixes).forEach(div => set.add(div));
    }
    return Array.from(set).sort();
  }, [mrGroups, activeAgency]);

  const toggleExpand = (mrNo: string) => {
    setExpandedMrs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(mrNo)) {
        newSet.delete(mrNo);
      } else {
        newSet.add(mrNo);
      }
      return newSet;
    });
  };

  const exportToExcel = () => {
    const wsData: any[][] = [];
    wsData.push(['MR No', 'MR Receive Date', 'Division', 'Job No', 'KVA', 'Make', 'Serial No', 'Status', 'Repair Type']);
    
    filteredGroups.forEach(group => {
      group.jobs.forEach(job => {
        wsData.push([
          group.mrNo,
          formatDDMMYYYY(group.dateOfIssue),
          group.division,
          job.jobNo,
          job.capacityKva,
          job.make,
          job.serialNo,
          job.status,
          job.repairType
        ]);
      });
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "MR Register");
    XLSX.writeFile(wb, `MR_Register_${selectedDivision}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const filteredGroups = mrGroups.filter(group => {
    const matchesSearch = group.mrNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      group.jobs.some(j => (j.jobNo || '').toLowerCase().includes(searchTerm.toLowerCase()) || (j.serialNo || '').toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesDivision = selectedDivision === 'All' || group.division.toLowerCase() === selectedDivision.toLowerCase();
    
    return matchesSearch && matchesDivision;
  });

  return (
    <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-xl shadow-xs border border-slate-200">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-slate-900">MR Register (Material Receipts)</h1>
          <p className="text-xs text-slate-500">Inward transformer intake records grouped by MR Number</p>
        </div>
        <button 
          onClick={exportToExcel}
          className="w-full sm:w-auto flex items-center justify-center space-x-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors shadow-xs"
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Export Excel</span>
        </button>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="p-3 sm:p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
            {/* Search Input */}
            <div className="relative flex-1 min-w-0 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search MR No, Job No, S/N..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
              />
            </div>

            {/* Division Filter Dropdown */}
            <div className="flex items-center gap-1.5 min-w-0 sm:w-64">
              <div className="relative w-full">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <select
                  value={selectedDivision}
                  onChange={(e) => setSelectedDivision(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 text-xs sm:text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white font-medium text-slate-700 appearance-none cursor-pointer"
                >
                  <option value="All">All Divisions ({mrGroups.length} MRs)</option>
                  {divisions.map(div => {
                    const count = mrGroups.filter(g => g.division.toLowerCase() === div.toLowerCase()).length;
                    return (
                      <option key={div} value={div}>
                        {div} Division ({count} MRs)
                      </option>
                    );
                  })}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Counts badge */}
          <div className="flex items-center justify-between sm:justify-end text-xs font-semibold text-slate-600">
            <span className="bg-slate-200/80 px-2.5 py-1 rounded-md">
              Showing <span className="font-bold text-slate-900">{filteredGroups.length}</span> of {mrGroups.length} MRs
            </span>
          </div>
        </div>

        {/* MR Listing */}
        <div className="divide-y divide-slate-200">
          {loading ? (
            <div className="p-12 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
              <p className="text-sm text-slate-500 mt-4">Loading register...</p>
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <Filter className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="font-medium text-slate-700">No MR records found matching your filters.</p>
              <p className="text-xs text-slate-400 mt-1">Try selecting "All Divisions" or clear your search term.</p>
            </div>
          ) : (
            filteredGroups.map(group => (
              <div key={group.mrNo} className="bg-white">
                <div 
                  onClick={() => toggleExpand(group.mrNo)}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 sm:p-4 cursor-pointer hover:bg-slate-50 transition-colors group gap-2 sm:gap-4"
                >
                  <div className="flex items-start sm:items-center space-x-3 min-w-0">
                    <div className="text-slate-400 group-hover:text-blue-600 transition-colors mt-0.5 sm:mt-0 shrink-0">
                      {expandedMrs.has(group.mrNo) ? <ChevronDown className="w-5 h-5 text-blue-600" /> : <ChevronRight className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold text-slate-900 text-sm">
                          MR No: <span className="font-mono text-blue-600">{group.mrNo}</span>
                        </h3>
                        <span className="text-[10px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          {group.division}
                        </span>
                        <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          Received: <span className="font-mono font-bold text-slate-800">{formatDDMMYYYY(group.dateOfIssue)}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between sm:justify-end space-x-4 pl-8 sm:pl-0">
                    <div className="text-left sm:text-right">
                      <span className="text-xs font-bold text-slate-800 bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded">
                        {group.jobs.length} Transformer{group.jobs.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                </div>
                
                {/* Collapsible Transformer Details Table */}
                {expandedMrs.has(group.mrNo) && (
                  <div className="bg-slate-50/80 p-3 sm:p-4 border-t border-slate-200 overflow-x-auto">
                    <table className="w-full text-xs text-left min-w-[540px]">
                      <thead className="text-slate-500 uppercase tracking-wider font-bold border-b border-slate-200">
                        <tr>
                          <th className="pb-2 pr-3">Job No</th>
                          <th className="pb-2 pr-3">Make</th>
                          <th className="pb-2 pr-3">KVA</th>
                          <th className="pb-2 pr-3">Serial No</th>
                          <th className="pb-2 pr-3">Status</th>
                          <th className="pb-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/70">
                        {group.jobs.map(job => (
                          <tr key={job.id} className="hover:bg-white/80">
                            <td className="py-2 pr-3 font-mono font-bold text-slate-900">{job.jobNo}</td>
                            <td className="py-2 pr-3 text-slate-700">{job.make}</td>
                            <td className="py-2 pr-3 font-semibold text-slate-800">{job.capacityKva} KVA</td>
                            <td className="py-2 pr-3 font-mono text-slate-600">{job.serialNo}</td>
                            <td className="py-2 pr-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                job.status === 'Dispatched' 
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                                  : job.status?.includes('Tested')
                                  ? 'bg-blue-100 text-blue-800 border border-blue-300'
                                  : job.status?.includes('Scrap')
                                  ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                  : 'bg-amber-100 text-amber-800 border border-amber-300'
                              }`}>
                                {job.status}
                              </span>
                            </td>
                            <td className="py-2 text-right">
                              <Link 
                                to={`/edit-job/${job.id}`} 
                                className="inline-flex items-center space-x-1 text-[10px] font-bold uppercase tracking-wider text-blue-600 hover:text-blue-800 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-200 px-2.5 py-1 rounded transition-colors shadow-2xs"
                              >
                                <Edit className="w-3 h-3" />
                                <span>Edit</span>
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
