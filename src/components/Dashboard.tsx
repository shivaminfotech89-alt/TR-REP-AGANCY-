import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { Loader2 } from 'lucide-react';

interface Job {
  id: string;
  jobNo: string;
  mrNo: string;
  dateOfIssue: string;
  capacityKva: number;
  make: string;
  status: string;
  repairType: string;
  createdAt: number;
}

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchJobs() {
      if (!auth.currentUser) return;
      try {
        const q = query(
          collection(db, 'jobs'),
          where('ownerId', '==', auth.currentUser.uid),
          orderBy('createdAt', 'desc'),
          limit(5)
        );
        const snapshot = await getDocs(q);
        const fetchedJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Job));
        setJobs(fetchedJobs);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'jobs');
      } finally {
        setLoading(false);
      }
    }
    fetchJobs();
  }, []);

  const getStatusColor = (status: string, repairType: string) => {
    if (repairType === 'GP') return 'text-purple-600 bg-purple-50';
    if (status.includes('Internal')) return 'text-blue-600 bg-blue-50';
    if (status.includes('External') || status === 'Received') return 'text-slate-600 bg-slate-50';
    return 'text-green-600 bg-green-50';
  };

  const calculateDaysLeft = (createdAt: number) => {
    const daysPassed = Math.floor((Date.now() - createdAt) / (1000 * 60 * 60 * 24));
    return 45 - daysPassed;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-8 space-y-6">
        
        <section className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Active Repair Queue (SLA: 45 Days)</h2>
            <span className="text-[10px] bg-slate-200 px-2 py-0.5 rounded">Viewing {jobs.length} Items</span>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-white text-slate-400 uppercase text-[10px] font-bold">
                <tr>
                  <th className="p-4">Job No</th>
                  <th className="p-4">MR No / Date</th>
                  <th className="p-4">KVA / Make</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Days Left</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto" /></td>
                  </tr>
                ) : jobs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-500">No active jobs found.</td>
                  </tr>
                ) : (
                  jobs.map(job => {
                    const daysLeft = calculateDaysLeft(job.createdAt);
                    return (
                      <tr key={job.id} className="hover:bg-slate-50">
                        <td className={`p-4 font-mono font-bold ${job.repairType === 'GP' ? 'text-orange-600' : ''}`}>
                          {job.jobNo}{job.repairType === 'GP' ? '*' : ''}
                        </td>
                        <td className="p-4">{job.mrNo} / {job.dateOfIssue.slice(5)}</td>
                        <td className="p-4">{job.capacityKva} / {job.make}</td>
                        <td className="p-4">
                          <span className={`px-2 py-1 rounded-full text-[10px] ${getStatusColor(job.status, job.repairType)}`}>
                            {job.repairType === 'GP' ? 'Guarantee Return' : job.status}
                          </span>
                        </td>
                        <td className={`p-4 font-bold ${daysLeft < 15 ? 'text-red-500' : 'text-slate-700'}`}>
                          {daysLeft} Days
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <section className="bg-white border border-slate-200 rounded p-4">
            <h3 className="text-xs font-bold uppercase text-slate-500 mb-4">Oil Accounting Ledger</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Received Qty:</span>
                <span className="font-mono">1,200 Litres</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Filtration Loss (5%):</span>
                <span className="font-mono text-red-500">-60.0 Litres</span>
              </div>
              <div className="flex justify-between text-xs pt-2 border-t border-dashed">
                <span className="font-bold">Adjusted Receivable:</span>
                <span className="font-mono font-bold">1,140 Litres</span>
              </div>
              <Link to="/oil-inward" className="block w-full mt-2 bg-slate-900 text-white text-[10px] py-2 rounded font-bold uppercase text-center hover:bg-slate-800 transition-colors">
                View Oil Shortage Report
              </Link>
            </div>
          </section>
          
          <section className="bg-white border border-slate-200 rounded p-4">
            <h3 className="text-xs font-bold uppercase text-slate-500 mb-4">Guarantee Monitoring</h3>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-bold">18</span>
              <span className="text-xs text-slate-500 mb-1">Months Fixed Period</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-2 leading-tight">GP Return Policy: Use existing Job No. Internal inspection required only for scrap declaration.</p>
          </section>
        </div>
      </div>

      <aside className="lg:col-span-4 space-y-6">
        <section className="bg-slate-900 text-white rounded p-5 shadow-lg relative overflow-hidden">
          <div className="relative z-10">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-blue-400">Circle Office Approval</h3>
            <p className="text-xl font-bold mt-2">$12,450.00</p>
            <p className="text-[10px] opacity-60">Estimate Power Limit: $15,000.00</p>
            <div className="mt-4 h-1 w-full bg-slate-700 rounded-full">
              <div className="h-full bg-blue-500 rounded-full w-[83%]"></div>
            </div>
            <Link to="/estimates/new" className="block text-center mt-6 w-full border border-blue-400 text-blue-400 py-2 rounded text-[10px] font-bold uppercase hover:bg-blue-400 hover:text-slate-900 transition-colors">
              Generate New Estimate
            </Link>
          </div>
          <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-blue-500 opacity-10 rounded-full"></div>
        </section>

        <section className="bg-white border border-slate-200 rounded p-4">
          <h3 className="text-xs font-bold uppercase text-slate-500 mb-3">Pending Tasks</h3>
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="w-1 bg-orange-400 rounded"></div>
              <div>
                <p className="text-xs font-bold">Upload SP Estimate.pdf</p>
                <p className="text-[10px] text-slate-400">Job: TR-2023-892 • North Division</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-1 bg-blue-400 rounded"></div>
              <div>
                <p className="text-xs font-bold">Create Dispatch Challan</p>
                <p className="text-[10px] text-slate-400">MR-5510 • Completed Unit</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-1 bg-red-400 rounded"></div>
              <div>
                <p className="text-xs font-bold">Declare Non-Repairable</p>
                <p className="text-[10px] text-slate-400">GP-2022-104 • Scrap Report Needed</p>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-blue-50 border border-blue-100 rounded p-4">
          <div className="flex justify-between items-start">
            <div>
              <h4 className="text-blue-800 text-xs font-bold">Quick Billing</h4>
              <p className="text-[10px] text-blue-600 mt-1">Generate SP Bill & Letter for approved estimates.</p>
              <Link to="/bills/new" className="mt-3 inline-block text-[10px] font-bold text-blue-700 uppercase hover:underline">
                Create Bill &rarr;
              </Link>
            </div>
            <div className="text-blue-200">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"></path></svg>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}
