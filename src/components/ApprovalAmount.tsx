import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useAgency } from '../lib/AgencyContext';
import { getCircleOfficeLimit, getApprovalLevel } from '../lib/contractRates';
import type { Job } from '../lib/types';

/** Approval Amount — circle office passing power by KVA (legacy module) */
export default function ApprovalAmount() {
  const { activeAgency } = useAgency();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [estimates, setEstimates] = useState<{ id: string; mrNo: string; lines: { jobId: string; grandTotal: number; capacityKva: number }[]; status: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!auth.currentUser) return;
      try {
        const jq = query(collection(db, 'jobs'), where('ownerId', '==', auth.currentUser.uid));
        const eq = query(collection(db, 'estimates'), where('ownerId', '==', auth.currentUser.uid));
        const [js, es] = await Promise.all([getDocs(jq), getDocs(eq)]);
        setJobs(js.docs.map((d) => ({ id: d.id, ...d.data() } as Job)));
        setEstimates(es.docs.map((d) => ({ id: d.id, ...d.data() } as (typeof estimates)[0])));
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'estimates');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const limits = useMemo(() => {
    const base = activeAgency?.circleOfficeLimits || {
      '5': 5422,
      '10': 8716,
      '16': 8696,
      '25': 10124,
      '63': 20423,
      '100': 24609,
      '200': 47170,
      '500': 148260,
    };
    return Object.entries(base)
      .map(([kva, amt]) => ({ kva: Number(kva), amt: Number(amt) }))
      .sort((a, b) => a.kva - b.kva);
  }, [activeAgency]);

  const rows = useMemo(() => {
    const out: { job: Job; amount: number; limit: number; level: string }[] = [];
    for (const est of estimates) {
      for (const line of est.lines || []) {
        const job = jobs.find((j) => j.id === line.jobId);
        if (!job) continue;
        const limit = activeAgency?.circleOfficeLimits?.[job.capacityKva.toString()] ?? getCircleOfficeLimit(job.capacityKva);
        out.push({
          job,
          amount: line.grandTotal || 0,
          limit,
          level: getApprovalLevel(line.grandTotal || 0, job.capacityKva),
        });
      }
    }
    return out;
  }, [estimates, jobs, activeAgency]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/" className="p-2 bg-white rounded-full border shadow-sm">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">Approval Amount</h1>
          <p className="text-xs text-slate-500">Circle office estimate passing power (KVA-wise)</p>
        </div>
      </div>

      <div className="bg-white border rounded p-4">
        <h2 className="text-xs font-bold uppercase text-slate-500 mb-3">Prefix Limits (Circle Office)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {limits.map((l) => (
            <div key={l.kva} className="border rounded p-3 bg-slate-50">
              <p className="text-[10px] uppercase text-slate-500 font-bold">{l.kva} KVA</p>
              <p className="font-mono font-bold text-lg">₹{l.amt.toLocaleString()}</p>
            </div>
          ))}
        </div>
        <Link to="/agency-settings" className="inline-block mt-3 text-[10px] font-bold uppercase text-blue-600">
          Edit limits in Agency Settings →
        </Link>
      </div>

      <div className="bg-white border rounded overflow-hidden">
        <div className="px-4 py-3 border-b bg-slate-50 text-xs font-bold uppercase text-slate-500">Estimate vs Limit</div>
        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-slate-400">
              <tr>
                <th className="p-3 text-left">Job</th>
                <th className="p-3 text-left">KVA</th>
                <th className="p-3 text-right">Estimate</th>
                <th className="p-3 text-right">Circle Limit</th>
                <th className="p-3 text-left">Level</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.job.id} className="hover:bg-slate-50">
                  <td className="p-3 font-mono font-bold">{r.job.jobNo}</td>
                  <td className="p-3">{r.job.capacityKva}</td>
                  <td className="p-3 text-right font-mono">₹{r.amount.toFixed(2)}</td>
                  <td className="p-3 text-right font-mono">₹{r.limit.toLocaleString()}</td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        r.level === 'Circle'
                          ? 'bg-emerald-50 text-emerald-700'
                          : r.level === 'Corporate'
                            ? 'bg-orange-50 text-orange-700'
                            : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {r.level}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    No estimates yet. Generate an estimate first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
