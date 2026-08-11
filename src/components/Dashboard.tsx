import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { Loader2, ClipboardPlus, Search, FileSpreadsheet, FileText, Droplet, Truck } from 'lucide-react';
import { daysLeftFrom, getCircleOfficeLimit } from '../lib/contractRates';
import { SLA_DAYS, GUARANTEE_MONTHS } from '../lib/types';
import type { Job } from '../lib/types';
import { useAgency } from '../lib/AgencyContext';

export default function Dashboard() {
  const { activeAgency } = useAgency();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [oilShortage, setOilShortage] = useState(0);

  useEffect(() => {
    async function fetchData() {
      if (!auth.currentUser) return;
      try {
        const q = query(
          collection(db, 'jobs'),
          where('ownerId', '==', auth.currentUser.uid),
          orderBy('createdAt', 'desc'),
          limit(40)
        );
        const snapshot = await getDocs(q);
        const fetchedJobs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Job));
        setJobs(fetchedJobs);

        const iq = query(
          collection(db, 'inspections'),
          where('ownerId', '==', auth.currentUser.uid),
          where('type', '==', 'External')
        );
        const is = await getDocs(iq);
        let short = 0;
        is.forEach((d) => {
          const data = d.data().data;
          const parsed = typeof data === 'string' ? JSON.parse(data) : data;
          short += Number(parsed?.netShortage) || 0;
        });
        setOilShortage(Number(short.toFixed(2)));
      } catch (err) {
        // orderBy may need index — fallback
        try {
          const q2 = query(collection(db, 'jobs'), where('ownerId', '==', auth.currentUser!.uid));
          const snapshot = await getDocs(q2);
          const fetchedJobs = snapshot.docs
            .map((d) => ({ id: d.id, ...d.data() } as Job))
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 40);
          setJobs(fetchedJobs);
        } catch (err2) {
          handleFirestoreError(err2, OperationType.LIST, 'jobs');
        }
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const active = jobs.filter((j) => !['Dispatched', 'Completed', 'Non-Repairable'].includes(j.status));
  const pendingExt = jobs.filter((j) => j.repairType === 'OGP' && j.status === 'Received').length;
  const pendingInt = jobs.filter((j) =>
    (j.repairType === 'GP' && j.status === 'Received') || j.status === 'External Done'
  ).length;
  const pendingEst = jobs.filter((j) => j.status === 'Internal Done').length;
  const pendingApr = jobs.filter((j) => j.status === 'Estimate Sent' || j.status === 'Estimate Prepared').length;
  const slaRisk = active.filter((j) => {
    const left = daysLeftFrom(j.estimateApprovedAt || null, SLA_DAYS);
    return left !== null && left < 15;
  }).length;

  const getStatusColor = (status: string, repairType: string) => {
    if (status === 'Non-Repairable') return 'text-red-700 bg-red-50';
    if (repairType === 'GP') return 'text-violet-700 bg-violet-50';
    if (status.includes('Approved') || status === 'Dispatched' || status === 'Billed') return 'text-emerald-700 bg-emerald-50';
    if (status.includes('Internal') || status.includes('Estimate')) return 'text-blue-700 bg-blue-50';
    return 'text-slate-600 bg-slate-50';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {activeAgency?.name || 'TR Rep Agency'}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Transformer repair workflow · SLA {SLA_DAYS} days from estimate approval · Guarantee {GUARANTEE_MONTHS} months
          </p>
        </div>
        <Link to="/new-job"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-xs font-bold uppercase tracking-widest rounded hover:bg-blue-700">
          <ClipboardPlus className="w-4 h-4" /> New MR Intake
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Ext. Pending', value: pendingExt, to: '/external-inspection', color: 'border-slate-200' },
          { label: 'Int. Pending', value: pendingInt, to: '/internal-inspection', color: 'border-slate-200' },
          { label: 'Est. Ready', value: pendingEst, to: '/estimates/new', color: 'border-blue-200' },
          { label: 'Awaiting Approval', value: pendingApr, to: '/estimates/new', color: 'border-amber-200' },
          { label: 'SLA Risk', value: slaRisk, to: '/', color: 'border-red-200' },
        ].map((c) => (
          <Link key={c.label} to={c.to} className={`bg-white border ${c.color} rounded p-4 hover:shadow-sm transition-shadow`}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{c.label}</p>
            <p className="text-2xl font-bold mt-1 font-mono">{c.value}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-6">
          <section className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
            <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">
                Active Repair Queue (SLA from Estimate Approval)
              </h2>
              <span className="text-[10px] bg-slate-200 px-2 py-0.5 rounded">{active.length} active</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-white text-slate-400 uppercase text-[10px] font-bold">
                  <tr>
                    <th className="p-3">Job No</th>
                    <th className="p-3">MR / Div</th>
                    <th className="p-3">KVA / Make</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Circle Limit</th>
                    <th className="p-3">Days Left</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr><td colSpan={6} className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto" /></td></tr>
                  ) : active.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-slate-500">No active jobs. Start with MR Intake.</td></tr>
                  ) : (
                    active.slice(0, 20).map((job) => {
                      const daysLeft = daysLeftFrom(job.estimateApprovedAt || null, SLA_DAYS);
                      const limit = activeAgency?.circleOfficeLimits?.[job.capacityKva.toString()] ?? getCircleOfficeLimit(job.capacityKva);
                      return (
                        <tr key={job.id} className="hover:bg-slate-50">
                          <td className={`p-3 font-mono font-bold ${job.repairType === 'GP' ? 'text-violet-700' : ''}`}>
                            {job.jobNo}{job.repairType === 'GP' ? '*' : ''}
                          </td>
                          <td className="p-3">{job.mrNo}<div className="text-[10px] text-slate-400">{job.division}</div></td>
                          <td className="p-3">{job.capacityKva} / {job.make}</td>
                          <td className="p-3">
                            <span className={`px-2 py-1 rounded text-[10px] font-semibold ${getStatusColor(job.status, job.repairType)}`}>
                              {job.status}
                            </span>
                          </td>
                          <td className="p-3 font-mono text-slate-600">₹{limit.toLocaleString()}</td>
                          <td className={`p-3 font-bold ${daysLeft !== null && daysLeft < 15 ? 'text-red-500' : 'text-slate-700'}`}>
                            {daysLeft === null ? '—' : `${daysLeft}d`}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { to: '/external-inspection', icon: Search, label: 'External Inspection', desc: 'Physical + oil' },
              { to: '/internal-inspection', icon: Search, label: 'Internal Inspection', desc: 'Winding / scrap' },
              { to: '/estimates/new', icon: FileSpreadsheet, label: 'Estimates', desc: 'Pre-fill + letter' },
              { to: '/bills/new', icon: FileText, label: 'Bills', desc: 'Tax invoice' },
              { to: '/oil-inward', icon: Droplet, label: 'Oil Ledger', desc: '5% filtration' },
              { to: '/challans/new', icon: Truck, label: 'Challan', desc: 'Return to division' },
            ].map((a) => (
              <Link key={a.to} to={a.to} className="bg-white border border-slate-200 rounded p-4 hover:border-blue-300 transition-colors">
                <a.icon className="w-5 h-5 text-blue-600 mb-2" />
                <p className="text-sm font-bold text-slate-900">{a.label}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{a.desc}</p>
              </Link>
            ))}
          </div>
        </div>

        <aside className="lg:col-span-4 space-y-4">
          <section className="bg-slate-900 text-white rounded p-5">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-blue-400">Oil Receivable</h3>
            <p className="text-3xl font-bold mt-2 font-mono">{oilShortage.toFixed(1)}</p>
            <p className="text-[10px] opacity-60">Litres (shortage + 5% filtration) from external inspections</p>
            <Link to="/oil-inward" className="mt-4 block text-center border border-blue-400 text-blue-300 py-2 rounded text-[10px] font-bold uppercase hover:bg-blue-400 hover:text-slate-900 transition-colors">
              Open Oil Account
            </Link>
          </section>

          <section className="bg-white border border-slate-200 rounded p-4">
            <h3 className="text-xs font-bold uppercase text-slate-500 mb-3">Guarantee Policy</h3>
            <div className="flex items-end gap-2 mb-2">
              <span className="text-3xl font-bold font-mono">{GUARANTEE_MONTHS}</span>
              <span className="text-xs text-slate-500 mb-1">months from first dispatch</span>
            </div>
            <ul className="text-[11px] text-slate-600 space-y-1.5 list-disc ml-4">
              <li>GP return: new MR, same Job No, skip external</li>
              <li>Internal only if declaring non-repairable</li>
              <li>Guarantee date never resets on GP jobs</li>
            </ul>
          </section>

          <section className="bg-white border border-slate-200 rounded p-4">
            <h3 className="text-xs font-bold uppercase text-slate-500 mb-3">Circle Office Limits (prefix)</h3>
            <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
              {Object.entries(
                activeAgency?.circleOfficeLimits && Object.keys(activeAgency.circleOfficeLimits).length
                  ? activeAgency.circleOfficeLimits
                  : { '10': 8716, '16': 8696, '25': 10124, '63': 20423, '100': 24609 }
              ).map(([kva, lim]) => (
                <div key={kva} className="flex justify-between bg-slate-50 px-2 py-1 rounded">
                  <span>{kva} KVA</span>
                  <span>₹{Number(lim).toLocaleString()}</span>
                </div>
              ))}
            </div>
            <Link to="/agency-settings" className="mt-3 inline-block text-[10px] font-bold uppercase text-blue-600 hover:underline">
              Edit in Agency Settings →
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
