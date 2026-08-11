import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { Loader2, ArrowLeft, Search, Save, AlertTriangle } from 'lucide-react';
import { useAgency } from '../lib/AgencyContext';
import { todayISO } from '../lib/contractRates';
import type { Job } from '../lib/types';

interface InternalForm {
  windingType: string;
  transformerCore: string;
  hvCoilLimb: string;
  damR: string;
  damY: string;
  damB: string;
  totCoil: string;
  wtOfCoil: string;
  totWt: string;
  lvCoilR: string;
  lvCoilY: string;
  lvCoilB: string;
  wtOfCoilLv: string;
  totWtLv: string;
  washerRing: string;
  insidePaint: string;
  testTrn: string;
  dcSup: string;
  insulation: string;
  nonRepairable: boolean;
  scrapReason: string;
}

const blank = (): InternalForm => ({
  windingType: 'AL',
  transformerCore: 'CRGO',
  hvCoilLimb: '4',
  damR: '0',
  damY: '0',
  damB: '0',
  totCoil: '0',
  wtOfCoil: '0',
  totWt: '0',
  lvCoilR: 'OK',
  lvCoilY: 'OK',
  lvCoilB: 'OK',
  wtOfCoilLv: '0',
  totWtLv: '0',
  washerRing: '6',
  insidePaint: '-',
  testTrn: 'Y',
  dcSup: 'Y',
  insulation: 'Y',
  nonRepairable: false,
  scrapReason: '',
});

export default function InternalInspection() {
  const navigate = useNavigate();
  const { jobId } = useParams();
  const { activeAgency, nextSequence } = useAgency();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMrNo, setSelectedMrNo] = useState<string | null>(null);
  const [mrJobs, setMrJobs] = useState<Job[]>([]);
  const [formsData, setFormsData] = useState<Record<string, InternalForm>>({});
  const [inspMeta, setInspMeta] = useState({ inspNo: '', inspDate: todayISO() });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function fetchJobs() {
      if (!auth.currentUser) return;
      try {
        const q = query(collection(db, 'jobs'), where('ownerId', '==', auth.currentUser.uid));
        const snapshot = await getDocs(q);
        const fetched = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Job));
        setJobs(fetched);
        if (jobId) {
          const found = fetched.find((j) => j.id === jobId);
          if (found) handleSelectMr(found.mrNo, fetched);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'jobs');
      } finally {
        setLoading(false);
      }
    }
    fetchJobs();
  }, [jobId]); // eslint-disable-line

  const eligible = (j: Job) => {
    if (j.status === 'Internal Done' || j.status === 'Non-Repairable') return false;
    if (j.repairType === 'GP') return j.status === 'Received'; // GP skips external
    return j.status === 'External Done' || j.status === 'Received'; // allow first-time scrap path via internal only
  };

  const handleSelectMr = (mrNo: string, allJobs = jobs) => {
    const list = allJobs
      .filter((j) => j.mrNo === mrNo && eligible(j))
      .sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));
    const initial: Record<string, InternalForm> = {};
    list.forEach((j) => {
      initial[j.id] = blank();
    });
    setMrJobs(list);
    setFormsData(initial);
    setSelectedMrNo(mrNo);
  };

  const handleChange = (id: string, field: keyof InternalForm, value: string | boolean) => {
    setFormsData((prev) => {
      const row = { ...prev[id], [field]: value };
      if (field === 'damR' || field === 'damY' || field === 'damB' || field === 'wtOfCoil') {
        const tot =
          (parseFloat(field === 'damR' ? String(value) : row.damR) || 0) +
          (parseFloat(field === 'damY' ? String(value) : row.damY) || 0) +
          (parseFloat(field === 'damB' ? String(value) : row.damB) || 0);
        row.totCoil = String(tot);
        const wt = parseFloat(row.wtOfCoil) || 0;
        row.totWt = (tot * wt).toFixed(2);
      }
      return { ...prev, [id]: row };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !selectedMrNo) return;
    setIsSubmitting(true);
    try {
      const now = Date.now();
      const batch = writeBatch(db);
      let inspNo = inspMeta.inspNo;
      if (!inspNo && activeAgency) {
        const n = await nextSequence('lastIntInspNo');
        const prefix = activeAgency.prefixes[mrJobs[0]?.division] || 'IS';
        inspNo = `${prefix}-${n}`;
      }

      for (const job of mrJobs) {
        const f = formsData[job.id];
        batch.set(doc(collection(db, 'inspections')), {
          jobId: job.id,
          type: 'Internal',
          data: {
            ...f,
            inspNo,
            inspDate: inspMeta.inspDate,
          },
          createdAt: now,
          updatedAt: now,
          ownerId: auth.currentUser.uid,
        });

        batch.update(doc(db, 'jobs', job.id), {
          status: f.nonRepairable ? 'Non-Repairable' : 'Internal Done',
          isNonRepairable: f.nonRepairable,
          transformerCore: f.transformerCore,
          updatedAt: now,
        });
      }

      await batch.commit();
      navigate('/');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'inspections');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  const pending = jobs.filter(eligible);
  const mrGroups: Record<string, Job[]> = {};
  pending.forEach((j) => {
    if (!mrGroups[j.mrNo]) mrGroups[j.mrNo] = [];
    mrGroups[j.mrNo].push(j);
  });
  const mrs = Object.keys(mrGroups).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const filtered = mrs.filter((mr) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return mr.toLowerCase().includes(q) || mrGroups[mr].some((j) => j.jobNo.toLowerCase().includes(q));
  });

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-6 flex items-center space-x-4 no-print">
        <Link to="/" className="p-2 bg-white rounded-full shadow-sm border border-slate-200 hover:bg-slate-50">
          <ArrowLeft className="w-4 h-4 text-slate-600" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Internal Inspection Report</h1>
          <p className="text-xs text-slate-500">Open job for winding details · Mark scrap / non-repairable here</p>
        </div>
      </div>

      {!selectedMrNo ? (
        <div className="bg-white p-6 rounded shadow-sm border border-slate-200 max-w-4xl mx-auto">
          <div className="flex justify-between mb-4 gap-4 flex-wrap">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Select MR No</h2>
            <div className="relative w-full md:w-64">
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search..."
                className="w-full pl-9 pr-4 py-2 text-sm border border-slate-300 rounded bg-slate-50" />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>
          <table className="min-w-full text-sm divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-[10px] font-bold uppercase text-slate-500">MR No</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold uppercase text-slate-500">Jobs</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold uppercase text-slate-500">Types</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold uppercase text-slate-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((mr) => (
                <tr key={mr} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono font-bold">{mr}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{mrGroups[mr].map((j) => j.jobNo).join(', ')}</td>
                  <td className="px-4 py-3 text-xs">{[...new Set(mrGroups[mr].map((j) => j.repairType))].join(', ')}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleSelectMr(mr)} className="text-[10px] font-bold uppercase text-blue-600 bg-blue-50 px-3 py-1.5 rounded">Inspect</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">No jobs pending internal inspection.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-slate-900 p-4 rounded flex flex-wrap gap-4 justify-between text-white no-print">
            <div>
              <p className="text-[10px] uppercase text-slate-400 font-bold">MR No</p>
              <p className="text-xl font-mono font-bold">{selectedMrNo}</p>
            </div>
            <div className="flex gap-3 items-end">
              <div>
                <label className="text-[10px] uppercase text-slate-400">Insp No</label>
                <input value={inspMeta.inspNo} onChange={(e) => setInspMeta((p) => ({ ...p, inspNo: e.target.value }))}
                  className="block mt-1 px-2 py-1 text-sm rounded bg-slate-800 border border-slate-700 font-mono" placeholder="Auto" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-400">Date</label>
                <input type="date" value={inspMeta.inspDate} onChange={(e) => setInspMeta((p) => ({ ...p, inspDate: e.target.value }))}
                  className="block mt-1 px-2 py-1 text-sm rounded bg-slate-800 border border-slate-700" />
              </div>
              <button type="button" onClick={() => setSelectedMrNo(null)} className="text-[10px] font-bold uppercase border border-blue-400/30 text-blue-300 px-3 py-1.5 rounded">Change</button>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded p-3 flex gap-2 text-xs text-amber-900 no-print">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <p>Tick <strong>Non-Repairable</strong> to declare scrap (first receipt or GP). No estimate is generated for scrap jobs.</p>
          </div>

          <div className="bg-white rounded border border-slate-200 shadow-sm overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left">
              <thead>
                <tr className="bg-slate-50 text-[9px] uppercase text-slate-500 font-bold">
                  {['SR','JOB','MAKE','KVA','CORE','WIND','HV LIMB','DAM R','Y','B','TOT','WT/COIL','TOT WT','LV R','Y','B','LV WT','WASHER','IN PNT','TEST','DC','INSU','SCRAP'].map((h) => (
                    <th key={h} className="p-1.5 border-b whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mrJobs.map((job, i) => {
                  const f = formsData[job.id];
                  const inp = (field: keyof InternalForm, w = 'w-14') => (
                    <input value={String(f[field] ?? '')} onChange={(e) => handleChange(job.id, field, e.target.value)}
                      className={`${w} px-1 py-1 text-[10px] border border-slate-300 rounded bg-slate-50 font-mono`} />
                  );
                  return (
                    <tr key={job.id} className={f.nonRepairable ? 'bg-red-50' : 'hover:bg-slate-50'}>
                      <td className="p-1 text-xs font-mono">{i + 1}</td>
                      <td className="p-1 text-xs font-mono font-bold whitespace-nowrap">{job.jobNo}<span className="text-orange-600">{job.repairType === 'GP' ? '*' : ''}</span></td>
                      <td className="p-1 text-[10px]">{job.make}</td>
                      <td className="p-1 text-[10px] font-mono">{job.capacityKva}</td>
                      <td className="p-1">
                        <select value={f.transformerCore} onChange={(e) => handleChange(job.id, 'transformerCore', e.target.value)} className="w-16 px-1 py-1 text-[10px] border rounded bg-slate-50">
                          <option value="CRGO">CRGO</option>
                          <option value="Amorphous">Amorph</option>
                          <option value="Wound">Wound</option>
                        </select>
                      </td>
                      <td className="p-1">
                        <select value={f.windingType} onChange={(e) => handleChange(job.id, 'windingType', e.target.value)} className="w-12 px-1 py-1 text-[10px] border rounded bg-slate-50">
                          <option value="AL">AL</option>
                          <option value="CU">CU</option>
                        </select>
                      </td>
                      <td className="p-1">{inp('hvCoilLimb', 'w-10')}</td>
                      <td className="p-1">{inp('damR', 'w-10')}</td>
                      <td className="p-1">{inp('damY', 'w-10')}</td>
                      <td className="p-1">{inp('damB', 'w-10')}</td>
                      <td className="p-1 text-[10px] font-mono">{f.totCoil}</td>
                      <td className="p-1">{inp('wtOfCoil', 'w-14')}</td>
                      <td className="p-1 text-[10px] font-mono">{f.totWt}</td>
                      <td className="p-1">{inp('lvCoilR', 'w-12')}</td>
                      <td className="p-1">{inp('lvCoilY', 'w-12')}</td>
                      <td className="p-1">{inp('lvCoilB', 'w-12')}</td>
                      <td className="p-1">{inp('wtOfCoilLv', 'w-14')}</td>
                      <td className="p-1">{inp('washerRing', 'w-10')}</td>
                      <td className="p-1">{inp('insidePaint', 'w-10')}</td>
                      <td className="p-1">{inp('testTrn', 'w-10')}</td>
                      <td className="p-1">{inp('dcSup', 'w-10')}</td>
                      <td className="p-1">{inp('insulation', 'w-10')}</td>
                      <td className="p-1 text-center">
                        <input type="checkbox" checked={f.nonRepairable} onChange={(e) => handleChange(job.id, 'nonRepairable', e.target.checked)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {mrJobs.some((j) => formsData[j.id]?.nonRepairable) && (
            <div className="bg-white border border-red-200 rounded p-4 space-y-3">
              <h3 className="text-xs font-bold uppercase text-red-700">Scrap reasons</h3>
              {mrJobs.filter((j) => formsData[j.id]?.nonRepairable).map((j) => (
                <div key={j.id}>
                  <label className="text-[10px] font-bold uppercase text-slate-500">{j.jobNo}</label>
                  <input value={formsData[j.id].scrapReason} onChange={(e) => handleChange(j.id, 'scrapReason', e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm border border-red-200 rounded bg-red-50" placeholder="Reason for non-repairable / scrap" />
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end no-print">
            <button type="submit" disabled={isSubmitting}
              className="px-6 py-2.5 text-xs font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center shadow-sm">
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Save className="w-4 h-4 mr-2" /> Save Internal Inspections
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
