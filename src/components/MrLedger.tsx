import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAgency } from '../lib/AgencyContext';
import { Loader2, Search, Download, ChevronDown, ChevronRight, Edit, FileSpreadsheet } from 'lucide-react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';

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
          // We could add an order by createdAt but it requires a composite index if combining with division
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
              division: job.division,
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
    wsData.push(['MR No', 'Date of Issue', 'Division', 'Job No', 'KVA', 'Make', 'Serial No', 'Status', 'Repair Type']);
    
    mrGroups.forEach(group => {
      group.jobs.forEach(job => {
        wsData.push([
          group.mrNo,
          group.dateOfIssue,
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
    XLSX.utils.book_append_sheet(wb, ws, "MR Ledger");
    XLSX.writeFile(wb, `MR_Ledger_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const filteredGroups = mrGroups.filter(group => 
    group.mrNo.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded shadow-sm border border-slate-200">
        <h1 className="text-lg font-bold text-slate-900">MR Ledger (Material Receipts)</h1>
        <button 
          onClick={exportToExcel}
          className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded text-xs font-bold uppercase tracking-widest transition-colors shadow-sm"
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Export Excel</span>
        </button>
      </div>

      <div className="bg-white rounded shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search by MR No..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
          <div className="ml-4 text-xs font-bold text-slate-500 uppercase">
            Showing {filteredGroups.length} MRs
          </div>
        </div>

        <div className="divide-y divide-slate-200">
          {loading ? (
            <div className="p-12 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
              <p className="text-sm text-slate-500 mt-4">Loading ledger...</p>
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              No MR records found matching your search.
            </div>
          ) : (
            filteredGroups.map(group => (
              <div key={group.mrNo} className="bg-white">
                <div 
                  onClick={() => toggleExpand(group.mrNo)}
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 transition-colors group"
                >
                  <div className="flex items-center space-x-4">
                    <div className="text-slate-400 group-hover:text-blue-600 transition-colors">
                      {expandedMrs.has(group.mrNo) ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800 text-sm">MR No: <span className="font-mono text-blue-700">{group.mrNo}</span></h3>
                      <p className="text-xs text-slate-500 mt-0.5">Division: {group.division}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-6">
                    <div className="text-right">
                      <p className="text-xs font-bold text-slate-700">{group.jobs.length} Transformers</p>
                      <p className="text-xs text-slate-500">{group.dateOfIssue}</p>
                    </div>
                  </div>
                </div>
                
                {expandedMrs.has(group.mrNo) && (
                  <div className="bg-slate-50 p-4 border-t border-slate-100 pl-12">
                    <table className="w-full text-xs text-left">
                      <thead className="text-slate-500 uppercase tracking-wider font-bold">
                        <tr>
                          <th className="pb-3 pr-4">Job No</th>
                          <th className="pb-3 pr-4">Make</th>
                          <th className="pb-3 pr-4">KVA</th>
                          <th className="pb-3 pr-4">Serial No</th>
                          <th className="pb-3 pr-4">Status</th>
                          <th className="pb-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/60">
                        {group.jobs.map(job => (
                          <tr key={job.id} className="hover:bg-slate-100">
                            <td className="py-2 pr-4 font-mono font-bold text-slate-700">{job.jobNo}</td>
                            <td className="py-2 pr-4">{job.make}</td>
                            <td className="py-2 pr-4">{job.capacityKva}</td>
                            <td className="py-2 pr-4">{job.serialNo}</td>
                            <td className="py-2 pr-4">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700`}>
                                {job.status}
                              </span>
                            </td>
                            <td className="py-2 text-right">
                              <Link 
                                to={`/edit-job/${job.id}`} 
                                className="inline-flex items-center space-x-1 text-[10px] font-bold uppercase tracking-widest text-blue-600 hover:text-blue-800 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-200 px-2 py-1 rounded transition-colors"
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
