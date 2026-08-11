import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAgency } from '../lib/AgencyContext';
import { daysLeftFrom, getCircleOfficeLimit } from '../lib/contractRates';
import { SLA_DAYS } from '../lib/types';
import type { Job } from '../lib/types';
import {
  ClipboardPlus,
  FileEdit,
  FileSearch,
  FlaskConical,
  FileSpreadsheet,
  Truck,
  Receipt,
  BadgeIndianRupee,
  Droplets,
  Package,
  Building2,
  ClipboardCheck,
  FileBarChart,
  Warehouse,
  Settings,
  Loader2,
} from 'lucide-react';

type Mod = {
  to: string;
  label: string;
  icon: typeof ClipboardPlus;
  color: string;
  group: string;
};

const MODULES: Mod[] = [
  // Entry
  { to: '/new-job', label: 'New Job Entry', icon: ClipboardPlus, color: 'bg-blue-600', group: 'Entry' },
  { to: '/external-inspection', label: 'OGP External', icon: FileEdit, color: 'bg-indigo-700', group: 'Entry' },
  { to: '/internal-inspection', label: 'OGP Internal', icon: FileSearch, color: 'bg-red-600', group: 'Entry' },
  { to: '/jobs?core=Amorphous', label: 'AMORPHOUS Entry', icon: ClipboardPlus, color: 'bg-slate-700', group: 'Entry' },
  { to: '/jobs?core=Wound', label: 'Wound CORE Entry', icon: ClipboardPlus, color: 'bg-emerald-600', group: 'Entry' },
  { to: '/testing-report?type=CRGO', label: 'CRGO Test Entry', icon: FlaskConical, color: 'bg-blue-600', group: 'Entry' },
  { to: '/testing-report?type=LSTC', label: 'LSTC Test Entry', icon: FlaskConical, color: 'bg-red-600', group: 'Entry' },
  { to: '/data-modification', label: 'Data Modification', icon: FileEdit, color: 'bg-indigo-800', group: 'Entry' },
  // Reports
  { to: '/reports/inspection', label: 'Inspection Report', icon: ClipboardCheck, color: 'bg-emerald-700', group: 'Reports' },
  { to: '/estimates/new', label: 'Estimate Report', icon: FileSpreadsheet, color: 'bg-emerald-600', group: 'Reports' },
  { to: '/challans/new', label: 'Challan Report', icon: ClipboardCheck, color: 'bg-teal-600', group: 'Reports' },
  { to: '/bills/new', label: 'Bill Report', icon: Receipt, color: 'bg-emerald-700', group: 'Reports' },
  { to: '/testing-report', label: 'Test Report', icon: FileBarChart, color: 'bg-green-600', group: 'Reports' },
  { to: '/reports/inspection-blank', label: 'Insp. Report Blank', icon: ClipboardCheck, color: 'bg-lime-600', group: 'Reports' },
  { to: '/reports/stock', label: 'Stock Statement', icon: Warehouse, color: 'bg-emerald-800', group: 'Reports' },
  { to: '/barrel-delivery', label: 'Barrel Delivery Report', icon: Package, color: 'bg-violet-700', group: 'Reports' },
  // Generate
  { to: '/estimates/new', label: 'Estimate Generate', icon: FileSpreadsheet, color: 'bg-red-600', group: 'Generate' },
  { to: '/challans/new', label: 'Challan Generate', icon: Truck, color: 'bg-red-600', group: 'Generate' },
  { to: '/bills/new', label: 'Bill Generate', icon: Receipt, color: 'bg-red-600', group: 'Generate' },
  { to: '/approval-amount', label: 'Approval Amount', icon: BadgeIndianRupee, color: 'bg-rose-700', group: 'Generate' },
  // Logistics
  { to: '/oil-inward', label: 'Oil Inward', icon: Droplets, color: 'bg-amber-800', group: 'Logistics' },
  { to: '/barrel-delivery', label: 'Barrel Delivery', icon: Package, color: 'bg-amber-700', group: 'Logistics' },
  { to: '/change-division', label: 'Change Division', icon: Building2, color: 'bg-stone-700', group: 'Logistics' },
  { to: '/agency-settings', label: 'Agency Settings', icon: Settings, color: 'bg-slate-800', group: 'Logistics' },
];

export default function Dashboard() {
  const { activeAgency, setActiveAgencyId, agencies } = useAgency();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [division, setDivision] = useState('');

  useEffect(() => {
    const first = activeAgency ? Object.keys(activeAgency.prefixes || {})[0] : '';
    const stored = localStorage.getItem('activeDivision');
    setDivision(stored || first || '');
  }, [activeAgency]);

  useEffect(() => {
    async function fetchJobs() {
      if (!auth.currentUser) return;
      try {
        const q = query(collection(db, 'jobs'), where('ownerId', '==', auth.currentUser.uid));
        const snapshot = await getDocs(q);
        setJobs(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Job)));
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'jobs');
      } finally {
        setLoading(false);
      }
    }
    fetchJobs();
  }, []);

  const onDivisionChange = (div: string) => {
    setDivision(div);
    localStorage.setItem('activeDivision', div);
  };

  const pendingExt = jobs.filter((j) => j.repairType === 'OGP' && j.status === 'Received').length;
  const pendingInt = jobs.filter(
    (j) => (j.repairType === 'GP' && j.status === 'Received') || j.status === 'External Done'
  ).length;
  const slaRisk = jobs.filter((j) => {
    const left = daysLeftFrom(j.estimateApprovedAt || null, SLA_DAYS);
    return left !== null && left < 15 && !['Dispatched', 'Completed', 'Non-Repairable'].includes(j.status);
  }).length;

  const groups = ['Entry', 'Reports', 'Generate', 'Logistics'];

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            {activeAgency?.name || 'Transformer Management System'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">Web modules matching your Ideal Engineering Co. desktop system</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {agencies.length > 1 && (
            <select
              value={activeAgency?.id || ''}
              onChange={(e) => setActiveAgencyId(e.target.value)}
              className="text-xs border rounded px-2 py-1.5 bg-slate-50"
            >
              {agencies.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase text-slate-500">Division</span>
            <select
              value={division}
              onChange={(e) => onDivisionChange(e.target.value)}
              className="text-sm font-semibold border border-slate-300 rounded px-3 py-1.5 bg-amber-50 text-amber-900"
            >
              {(activeAgency ? Object.keys(activeAgency.prefixes) : ['SABARMATI']).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 max-w-xl">
        <div className="bg-white border rounded-lg p-3">
          <p className="text-[10px] uppercase font-bold text-slate-500">Ext. Pending</p>
          <p className="text-2xl font-mono font-bold">{loading ? '…' : pendingExt}</p>
        </div>
        <div className="bg-white border rounded-lg p-3">
          <p className="text-[10px] uppercase font-bold text-slate-500">Int. Pending</p>
          <p className="text-2xl font-mono font-bold">{loading ? '…' : pendingInt}</p>
        </div>
        <div className="bg-white border rounded-lg p-3">
          <p className="text-[10px] uppercase font-bold text-slate-500">SLA Risk</p>
          <p className={`text-2xl font-mono font-bold ${slaRisk ? 'text-red-600' : ''}`}>{loading ? '…' : slaRisk}</p>
        </div>
      </div>

      {groups.map((g) => (
        <section key={g}>
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">{g}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-3">
            {MODULES.filter((m) => m.group === g).map((m) => (
              <Link
                key={`${g}-${m.label}`}
                to={m.to}
                className="group flex flex-col items-center text-center bg-white border border-slate-200 rounded-xl p-3 hover:shadow-md hover:border-slate-300 transition-all"
              >
                <div className={`w-14 h-14 ${m.color} text-white rounded-xl flex items-center justify-center mb-2 shadow-sm group-hover:scale-105 transition-transform`}>
                  <m.icon className="w-7 h-7" />
                </div>
                <span className="text-[11px] font-semibold text-slate-800 leading-tight">{m.label}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b bg-slate-50 flex justify-between items-center">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Recent Jobs · {division || 'All'}</h2>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-slate-400">
              <tr>
                <th className="p-3 text-left">Job</th>
                <th className="p-3 text-left">MR</th>
                <th className="p-3 text-left">KVA / Make</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Circle Limit</th>
                <th className="p-3 text-left">Days Left</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {jobs
                .filter((j) => !division || j.division === division)
                .slice(0, 12)
                .map((job) => {
                  const daysLeft = daysLeftFrom(job.estimateApprovedAt || null, SLA_DAYS);
                  const limit =
                    activeAgency?.circleOfficeLimits?.[job.capacityKva.toString()] ?? getCircleOfficeLimit(job.capacityKva);
                  return (
                    <tr key={job.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono font-bold">
                        {job.jobNo}
                        {job.repairType === 'GP' ? '*' : ''}
                      </td>
                      <td className="p-3">{job.mrNo}</td>
                      <td className="p-3">
                        {job.capacityKva} / {job.make}
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-semibold">
                          {job.status}
                        </span>
                      </td>
                      <td className="p-3 font-mono">₹{limit.toLocaleString()}</td>
                      <td className={`p-3 font-bold ${daysLeft !== null && daysLeft < 15 ? 'text-red-500' : ''}`}>
                        {daysLeft === null ? '—' : `${daysLeft}d`}
                      </td>
                    </tr>
                  );
                })}
              {!loading && jobs.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    No jobs yet — start with <Link className="text-blue-600 underline" to="/new-job">New Job Entry</Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
