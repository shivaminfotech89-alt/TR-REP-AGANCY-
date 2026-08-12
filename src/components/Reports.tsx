import React, { useState, useEffect, useMemo } from 'react';
import { useAgency } from '../lib/AgencyContext';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Loader2, Download, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';

export default function Reports() {
  const { activeAgency } = useAgency();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'testing_ready' | 'delivered'>('testing_ready');

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
        setJobs(fetchedJobs);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'jobs');
      } finally {
        setLoading(false);
      }
    }
    fetchJobs();
  }, [activeAgency]);

  const testingReadyJobs = useMemo(() => {
    return jobs.filter(j => j.status === 'Tested - Ready for Dispatch' && j.isClosed !== true);
  }, [jobs]);

  const deliveredJobs = useMemo(() => {
    return jobs.filter(j => j.status === 'Dispatched');
  }, [jobs]);

  const groupByDivision = (jobList: any[]) => {
    const grouped: Record<string, any[]> = {};
    jobList.forEach(job => {
      const div = job.division || 'Unknown';
      if (!grouped[div]) grouped[div] = [];
      grouped[div].push(job);
    });
    
    // Sort jobs within each division
    Object.keys(grouped).forEach(div => {
       grouped[div].sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));
    });
    return grouped;
  };

  const handleExportTestingReady = () => {
    const data: any[] = [];
    const grouped = groupByDivision(testingReadyJobs);
    
    Object.keys(grouped).sort().forEach(div => {
      data.push({ 'Division': div, 'Job No': '', 'MR No': '', 'Capacity': '', 'Make': '', 'Status': '' });
      grouped[div].forEach(job => {
        data.push({
          'Division': div,
          'Job No': job.jobNo,
          'MR No': job.mrNo,
          'Capacity': job.capacityKva,
          'Make': job.make,
          'Status': job.status
        });
      });
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Testing Ready");
    XLSX.writeFile(wb, `Testing_Ready_Jobs_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleExportDelivered = () => {
    const data: any[] = [];
    const grouped = groupByDivision(deliveredJobs);
    
    Object.keys(grouped).sort().forEach(div => {
      data.push({ 'Division': div, 'Job No': '', 'Challan No': '', 'Delivery Date': '', 'Capacity': '', 'Make': '' });
      grouped[div].forEach(job => {
        data.push({
          'Division': div,
          'Job No': job.jobNo,
          'Challan No': job.challanNo || '-',
          'Delivery Date': job.deliveryDate || '-',
          'Capacity': job.capacityKva,
          'Make': job.make
        });
      });
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Delivered");
    XLSX.writeFile(wb, `Delivered_Jobs_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const currentGrouped = groupByDivision(activeTab === 'testing_ready' ? testingReadyJobs : deliveredJobs);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Reports & Exports</h1>
          <p className="text-sm text-slate-500">Generate Division-wise Excel reports</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex border-b border-slate-200">
          <button 
            onClick={() => setActiveTab('testing_ready')}
            className={`flex-1 py-4 text-sm font-bold uppercase tracking-wider transition-colors ${activeTab === 'testing_ready' ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            Testing Ready Jobs
          </button>
          <button 
            onClick={() => setActiveTab('delivered')}
            className={`flex-1 py-4 text-sm font-bold uppercase tracking-wider transition-colors ${activeTab === 'delivered' ? 'bg-purple-50 text-purple-700 border-b-2 border-purple-600' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            Delivered Jobs
          </button>
        </div>
        
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-bold text-slate-800">
              {activeTab === 'testing_ready' ? 'Testing Ready (Division Wise)' : 'Delivered (Division Wise)'}
            </h2>
            <button
              onClick={activeTab === 'testing_ready' ? handleExportTestingReady : handleExportDelivered}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded font-bold hover:bg-emerald-700 transition-colors"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Export to Excel
            </button>
          </div>

          <div className="space-y-8">
            {Object.keys(currentGrouped).length === 0 ? (
              <div className="text-center py-12 text-slate-500 border-2 border-dashed border-slate-200 rounded">
                No jobs found for this report.
              </div>
            ) : (
              Object.keys(currentGrouped).sort().map(div => (
                <div key={div} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                    <h3 className="font-bold text-slate-800 uppercase tracking-widest">{div} DIVISION</h3>
                    <p className="text-xs text-slate-500 mt-1">{currentGrouped[div].length} jobs</p>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 text-slate-500">
                      <tr>
                        <th className="px-4 py-2 text-left font-bold">Job No</th>
                        {activeTab === 'delivered' && <th className="px-4 py-2 text-left font-bold">Challan No</th>}
                        <th className="px-4 py-2 text-left font-bold">Capacity</th>
                        <th className="px-4 py-2 text-left font-bold">Make</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {currentGrouped[div].map(job => (
                        <tr key={job.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2 font-mono font-bold text-slate-700">{job.jobNo}</td>
                          {activeTab === 'delivered' && <td className="px-4 py-2 font-mono text-slate-600">{job.challanNo || '-'}</td>}
                          <td className="px-4 py-2">{job.capacityKva} KVA</td>
                          <td className="px-4 py-2">{job.make}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
