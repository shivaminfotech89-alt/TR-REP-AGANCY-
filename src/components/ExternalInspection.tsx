import { useState, useEffect, FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { Loader2, ArrowLeft, Search, Save, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAgency } from '../lib/AgencyContext';
import { calcOilShortage, todayISO } from '../lib/contractRates';
import type { Job } from '../lib/types';

interface ExternalForm {
  kv: string;
  oilCapLtrs: string;
  lessOilLtrs: string;
  sealType: string;
  gasket: string;
  hvLvRod: string;
  nuteBolt: string;
  dryActPart: string;
  clnDrtyTank: string;
  breather: string;
  oilLevGls: string;
  outsidePaint: string;
  namePlate: string;
  damCtTank: string;
  damRadNo: string;
  hvSideHvb: string;
  hvSideHvm: string;
  hvSideHvCc: string;
  lvSideLvb: string;
  lvSideLvm: string;
  lvSideLvCc: string;
  transType: string;
}

const emptyForm = (): ExternalForm => ({
  kv: '11',
  oilCapLtrs: '',
  lessOilLtrs: '',
  sealType: 'BL',
  gasket: '1',
  hvLvRod: '7',
  nuteBolt: 'Y',
  dryActPart: 'Y',
  clnDrtyTank: 'Y',
  breather: 'Y',
  oilLevGls: 'Y',
  outsidePaint: 'Y',
  namePlate: '-',
  damCtTank: '0.00',
  damRadNo: '0',
  hvSideHvb: '3',
  hvSideHvm: '3',
  hvSideHvCc: '3',
  lvSideLvb: '4',
  lvSideLvm: '4',
  lvSideLvCc: '4',
  transType: 'C',
});

const YN = ['Y', 'N', '-', 'TBR'];
const fieldCls =
  'w-full px-3 py-2 text-sm border border-slate-300 rounded bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono';
const labelCls = 'block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1';

export default function ExternalInspection() {
  const navigate = useNavigate();
  const { jobId } = useParams();
  const { activeAgency, nextSequence } = useAgency();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMrNo, setSelectedMrNo] = useState<string | null>(null);
  const [mrJobs, setMrJobs] = useState<Job[]>([]);
  const [formsData, setFormsData] = useState<Record<string, ExternalForm>>({});
  const [activeIdx, setActiveIdx] = useState(0);
  const [inspMeta, setInspMeta] = useState({ inspNo: '', inspDate: todayISO() });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveResult, setSaveResult] = useState<{ count: number; inspNo: string; mrNo: string } | null>(null);
  const [listTab, setListTab] = useState<'pending' | 'done'>('pending');

  useEffect(() => {
    async function fetchJobs() {
      if (!auth.currentUser) return;
      try {
        const q = query(collection(db, 'jobs'), where('ownerId', '==', auth.currentUser.uid));
        const snapshot = await getDocs(q);
        const fetchedJobs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Job));
        setJobs(fetchedJobs);
        if (jobId) {
          const found = fetchedJobs.find((j) => j.id === jobId);
          if (found && found.repairType === 'OGP') handleSelectMr(found.mrNo, fetchedJobs);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'jobs');
      } finally {
        setLoading(false);
      }
    }
    fetchJobs();
  }, [jobId]); // eslint-disable-line

  const handleSelectMr = (mrNo: string, allJobs = jobs, allowDone = false) => {
    const jobsForMr = allJobs
      .filter(
        (j) =>
          j.mrNo === mrNo &&
          j.repairType === 'OGP' &&
          (allowDone ? true : j.status === 'Received')
      )
      .filter((j) => (allowDone ? j.status === 'External Done' || j.status === 'Received' : j.status === 'Received'))
      .sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));

    // Prefer pending Received for editing
    const editable = allJobs
      .filter((j) => j.mrNo === mrNo && j.repairType === 'OGP' && j.status === 'Received')
      .sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));

    const list = editable.length ? editable : jobsForMr;
    if (list.length === 0) {
      alert(`No pending OGP jobs for MR ${mrNo}. Already completed jobs appear under "Completed".`);
      return;
    }

    const initial: Record<string, ExternalForm> = {};
    list.forEach((j) => {
      initial[j.id] = emptyForm();
    });
    setMrJobs(list);
    setFormsData(initial);
    setActiveIdx(0);
    setSelectedMrNo(mrNo);
    setSaveResult(null);
  };

  const handleChange = (id: string, field: keyof ExternalForm, value: string) => {
    setFormsData((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const validateAll = (): string | null => {
    for (const job of mrJobs) {
      const f = formsData[job.id];
      if (f.oilCapLtrs === '' || Number(f.oilCapLtrs) < 0) {
        return `Job ${job.jobNo}: enter Oil Capacity (Ltrs)`;
      }
      if (f.lessOilLtrs === '' || Number(f.lessOilLtrs) < 0) {
        return `Job ${job.jobNo}: enter Less Oil (Ltrs) — use 0 if full`;
      }
      if (Number(f.lessOilLtrs) > Number(f.oilCapLtrs)) {
        return `Job ${job.jobNo}: Less Oil cannot exceed Oil Cap`;
      }
    }
    return null;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !selectedMrNo) return;

    const err = validateAll();
    if (err) {
      alert(err);
      return;
    }

    setIsSubmitting(true);
    try {
      const now = Date.now();
      const batch = writeBatch(db);
      let inspNo = inspMeta.inspNo;
      if (!inspNo && activeAgency) {
        const n = await nextSequence('lastExtInspNo');
        const prefix = activeAgency.prefixes[mrJobs[0]?.division] || 'IS';
        inspNo = `${prefix}-${n}`;
        setInspMeta((p) => ({ ...p, inspNo }));
      } else if (!inspNo) {
        inspNo = `EXT-${Date.now().toString().slice(-6)}`;
      }

      for (const job of mrJobs) {
        const f = formsData[job.id];
        const oilCap = Number(f.oilCapLtrs) || 0;
        const lessOil = Number(f.lessOilLtrs) || 0;
        const oil = calcOilShortage(oilCap, lessOil);

        batch.set(doc(collection(db, 'inspections')), {
          jobId: job.id,
          type: 'External',
          data: {
            kv: f.kv,
            oilCapLtrs: oilCap,
            lessOilLtrs: lessOil,
            oilAvailable: oil.oilCont,
            netShortage: oil.total,
            sealType: f.sealType,
            gasket: f.gasket,
            hvLvRod: f.hvLvRod,
            nuteBolt: f.nuteBolt,
            dryActPart: f.dryActPart,
            clnDrtyTank: f.clnDrtyTank,
            breather: f.breather,
            oilLevGls: f.oilLevGls,
            outsidePaint: f.outsidePaint,
            namePlate: f.namePlate,
            damCtTank: Number(f.damCtTank) || 0,
            damRadNo: Number(f.damRadNo) || 0,
            hvSideHvb: f.hvSideHvb,
            hvSideHvm: f.hvSideHvm,
            hvSideHvCc: f.hvSideHvCc,
            lvSideLvb: f.lvSideLvb,
            lvSideLvm: f.lvSideLvm,
            lvSideLvCc: f.lvSideLvCc,
            transType: f.transType,
            inspNo,
            inspDate: inspMeta.inspDate,
          },
          createdAt: now,
          updatedAt: now,
          ownerId: auth.currentUser.uid,
        });

        batch.update(doc(db, 'jobs', job.id), {
          status: 'External Done',
          kv: f.kv,
          updatedAt: now,
        });
      }

      await batch.commit();

      // Refresh jobs list locally
      setJobs((prev) =>
        prev.map((j) =>
          mrJobs.some((m) => m.id === j.id) ? { ...j, status: 'External Done', kv: formsData[j.id]?.kv } : j
        )
      );

      setSaveResult({ count: mrJobs.length, inspNo, mrNo: selectedMrNo });
      setSelectedMrNo(null);
      setMrJobs([]);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'inspections');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const pendingJobs = jobs.filter((j) => j.repairType === 'OGP' && j.status === 'Received');
  const doneJobs = jobs.filter((j) => j.repairType === 'OGP' && j.status !== 'Received');

  const groupByMr = (list: Job[]) => {
    const g: Record<string, Job[]> = {};
    list.forEach((j) => {
      if (!g[j.mrNo]) g[j.mrNo] = [];
      g[j.mrNo].push(j);
    });
    return g;
  };

  const pendingGroups = groupByMr(pendingJobs);
  const doneGroups = groupByMr(doneJobs);
  const activeGroups = listTab === 'pending' ? pendingGroups : doneGroups;
  const uniqueMrNos = Object.keys(activeGroups).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const filteredMrNos = uniqueMrNos.filter((mr) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      mr.toLowerCase().includes(q) ||
      activeGroups[mr].some(
        (j) =>
          j.jobNo.toLowerCase().includes(q) ||
          j.make.toLowerCase().includes(q) ||
          j.serialNo.toLowerCase().includes(q)
      )
    );
  });

  const activeJob = mrJobs[activeIdx];
  const f = activeJob ? formsData[activeJob.id] : null;
  const oil = f ? calcOilShortage(Number(f.oilCapLtrs) || 0, Number(f.lessOilLtrs) || 0) : null;

  const setField = (field: keyof ExternalForm, value: string) => {
    if (!activeJob) return;
    handleChange(activeJob.id, field, value);
  };

  // Success confirmation screen
  if (saveResult) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-white border border-emerald-200 rounded-xl p-8 text-center shadow-sm">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-9 h-9" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">External Entry Saved</h1>
          <p className="text-sm text-slate-600 mb-4">
            MR <span className="font-mono font-bold">{saveResult.mrNo}</span> —{' '}
            <span className="font-bold">{saveResult.count}</span> transformer(s) marked{' '}
            <span className="text-emerald-700 font-semibold">External Done</span>
          </p>
          <p className="text-xs text-slate-500 mb-6">
            Inspection No: <span className="font-mono font-bold text-slate-800">{saveResult.inspNo}</span>
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              onClick={() => {
                setSaveResult(null);
                setListTab('pending');
              }}
              className="px-4 py-2.5 text-xs font-bold uppercase tracking-widest bg-blue-600 text-white rounded"
            >
              Enter Another MR
            </button>
            <Link
              to="/internal-inspection"
              className="px-4 py-2.5 text-xs font-bold uppercase tracking-widest bg-slate-900 text-white rounded"
            >
              Go to OGP Internal
            </Link>
            <Link
              to="/"
              className="px-4 py-2.5 text-xs font-bold uppercase tracking-widest border border-slate-300 text-slate-700 rounded"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-5 flex items-center space-x-4">
        <Link to="/" className="p-2 bg-white rounded-full shadow-sm border border-slate-200 hover:bg-slate-50">
          <ArrowLeft className="w-4 h-4 text-slate-600" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">OGP External Entry</h1>
          <p className="text-xs text-slate-500">Physical inspection · oil measurement · all fields visible one transformer at a time</p>
        </div>
      </div>

      {!selectedMrNo ? (
        <div className="bg-white p-5 rounded shadow-sm border border-slate-200">
          <div className="flex flex-col md:flex-row justify-between gap-3 mb-4">
            <div className="flex gap-2">
              <button
                onClick={() => setListTab('pending')}
                className={`px-3 py-1.5 text-[10px] font-bold uppercase rounded ${listTab === 'pending' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                Pending ({Object.keys(pendingGroups).length} MR)
              </button>
              <button
                onClick={() => setListTab('done')}
                className={`px-3 py-1.5 text-[10px] font-bold uppercase rounded ${listTab === 'done' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                Completed ({Object.keys(doneGroups).length} MR)
              </button>
            </div>
            <div className="relative w-full md:w-64">
              <input
                type="text"
                placeholder="Search MR / Job / Make / Sr..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm border border-slate-300 rounded bg-slate-50"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-slate-500 uppercase">MR No</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-slate-500 uppercase">Jobs</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-slate-500 uppercase">Details</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-slate-500 uppercase">Status</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-slate-500 uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMrNos.map((mr) => (
                  <tr key={mr} className="hover:bg-slate-50">
                    <td className="px-3 py-3 font-mono font-bold">{mr}</td>
                    <td className="px-3 py-3 text-slate-500">{activeGroups[mr].length}</td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      {activeGroups[mr].map((j) => (
                        <div key={j.id} className="font-mono">
                          {j.jobNo} · {j.make} · {j.serialNo} · {j.capacityKva} KVA
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-1 rounded ${
                          listTab === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {listTab === 'pending' ? 'Awaiting External' : 'External Done'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {listTab === 'pending' ? (
                        <button
                          onClick={() => handleSelectMr(mr)}
                          className="text-[10px] font-bold uppercase tracking-widest text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded"
                        >
                          Enter
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-400">Saved ✓</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredMrNos.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                      {listTab === 'pending'
                        ? 'No pending OGP MRs. Create jobs via New Job Entry first.'
                        : 'No completed external entries yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeJob && f ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-slate-900 text-white p-4 rounded flex flex-wrap gap-4 justify-between items-end">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">MR No</p>
              <p className="text-xl font-mono font-bold">{selectedMrNo}</p>
              <p className="text-xs text-slate-300 mt-1">
                Transformer {activeIdx + 1} of {mrJobs.length}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-[10px] uppercase text-slate-400">Insp No</label>
                <input
                  value={inspMeta.inspNo}
                  onChange={(e) => setInspMeta((p) => ({ ...p, inspNo: e.target.value }))}
                  className="block mt-1 px-2 py-1.5 text-sm rounded bg-slate-800 border border-slate-700 font-mono w-32"
                  placeholder="Auto"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-400">Insp Date</label>
                <input
                  type="date"
                  value={inspMeta.inspDate}
                  onChange={(e) => setInspMeta((p) => ({ ...p, inspDate: e.target.value }))}
                  className="block mt-1 px-2 py-1.5 text-sm rounded bg-slate-800 border border-slate-700"
                />
              </div>
              <button
                type="button"
                onClick={() => setSelectedMrNo(null)}
                className="text-[10px] font-bold uppercase border border-slate-600 text-slate-300 px-3 py-1.5 rounded"
              >
                Cancel MR
              </button>
            </div>
          </div>

          {/* Transformer tabs */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {mrJobs.map((j, i) => (
              <button
                key={j.id}
                type="button"
                onClick={() => setActiveIdx(i)}
                className={`shrink-0 px-3 py-2 rounded text-xs font-mono border ${
                  i === activeIdx ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                {i + 1}. {j.jobNo}
              </button>
            ))}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-6 shadow-sm">
            {/* Identity — always visible */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-50 border border-slate-100 rounded-lg p-4">
              <div>
                <p className={labelCls}>Job No</p>
                <p className="font-mono font-bold text-slate-900">{activeJob.jobNo}</p>
              </div>
              <div>
                <p className={labelCls}>Make</p>
                <p className="font-bold text-slate-900">{activeJob.make}</p>
              </div>
              <div>
                <p className={labelCls}>Serial No</p>
                <p className="font-mono font-bold text-slate-900">{activeJob.serialNo}</p>
              </div>
              <div>
                <p className={labelCls}>KVA</p>
                <p className="font-mono font-bold text-slate-900">{activeJob.capacityKva}</p>
              </div>
            </div>

            {/* Oil — critical fields */}
            <section>
              <h3 className="text-xs font-bold uppercase tracking-widest text-blue-700 mb-3 border-b border-blue-100 pb-2">
                1. Oil Measurement (Required)
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className={labelCls}>KV *</label>
                  <input className={fieldCls} value={f.kv} onChange={(e) => setField('kv', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Oil Cap (Ltrs) *</label>
                  <input
                    required
                    type="number"
                    step="any"
                    min="0"
                    className={fieldCls}
                    value={f.oilCapLtrs}
                    onChange={(e) => setField('oilCapLtrs', e.target.value)}
                    placeholder="e.g. 165"
                  />
                </div>
                <div>
                  <label className={labelCls}>Less Oil (Ltrs) *</label>
                  <input
                    required
                    type="number"
                    step="any"
                    min="0"
                    className={fieldCls}
                    value={f.lessOilLtrs}
                    onChange={(e) => setField('lessOilLtrs', e.target.value)}
                    placeholder="0 if full"
                  />
                </div>
                <div>
                  <label className={labelCls}>SL / BL</label>
                  <select className={fieldCls} value={f.sealType} onChange={(e) => setField('sealType', e.target.value)}>
                    <option value="BL">BL (Bolted)</option>
                    <option value="SL">SL (Sealed)</option>
                  </select>
                </div>
              </div>
              {oil && (
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="bg-slate-50 rounded p-2 border">
                    <p className="text-[9px] uppercase text-slate-500 font-bold">Oil Contained</p>
                    <p className="font-mono font-bold text-slate-800">{oil.oilCont.toFixed(2)}</p>
                  </div>
                  <div className="bg-amber-50 rounded p-2 border border-amber-200">
                    <p className="text-[9px] uppercase text-amber-700 font-bold">5% Filt. Loss</p>
                    <p className="font-mono font-bold text-amber-800">{oil.filterLoss5.toFixed(2)}</p>
                  </div>
                  <div className="bg-red-50 rounded p-2 border border-red-200">
                    <p className="text-[9px] uppercase text-red-700 font-bold">Net Shortage</p>
                    <p className="font-mono font-bold text-red-800">{oil.total.toFixed(2)}</p>
                  </div>
                </div>
              )}
            </section>

            {/* Tank / fittings */}
            <section>
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-3 border-b pb-2">
                2. Tank / Fittings (Y / N / - / TBR)
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {(
                  [
                    ['gasket', 'Gasket'],
                    ['hvLvRod', 'HV/LV Rod'],
                    ['nuteBolt', 'Nute / Bolt'],
                    ['dryActPart', 'Dry Act. Part'],
                    ['clnDrtyTank', 'Cln Dirty Tank'],
                    ['breather', 'Breather'],
                    ['oilLevGls', 'Oil Level Glass'],
                    ['outsidePaint', 'Outside Paint'],
                    ['namePlate', 'Name Plate'],
                    ['damCtTank', 'Dam CT Tank'],
                    ['damRadNo', 'Dam Radiator No'],
                    ['transType', 'Trans Type (C)'],
                  ] as [keyof ExternalForm, string][]
                ).map(([key, label]) => (
                  <div key={key}>
                    <label className={labelCls}>{label}</label>
                    {['nuteBolt', 'dryActPart', 'clnDrtyTank', 'breather', 'oilLevGls', 'outsidePaint', 'namePlate'].includes(
                      key
                    ) ? (
                      <select className={fieldCls} value={f[key]} onChange={(e) => setField(key, e.target.value)}>
                        {YN.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input className={fieldCls} value={f[key]} onChange={(e) => setField(key, e.target.value)} />
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* HV / LV sides */}
            <section>
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600 mb-3 border-b pb-2">
                3. HV Side & LV Side (Bushing / Metal / Connector)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50">
                  <p className="text-[10px] font-bold uppercase text-slate-500 mb-3">HV Side</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={labelCls}>HVB</label>
                      <input className={fieldCls} value={f.hvSideHvb} onChange={(e) => setField('hvSideHvb', e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>HVM</label>
                      <input className={fieldCls} value={f.hvSideHvm} onChange={(e) => setField('hvSideHvm', e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>HVCC</label>
                      <input className={fieldCls} value={f.hvSideHvCc} onChange={(e) => setField('hvSideHvCc', e.target.value)} />
                    </div>
                  </div>
                </div>
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50">
                  <p className="text-[10px] font-bold uppercase text-slate-500 mb-3">LV Side</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={labelCls}>LVB</label>
                      <input className={fieldCls} value={f.lvSideLvb} onChange={(e) => setField('lvSideLvb', e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>LVM</label>
                      <input className={fieldCls} value={f.lvSideLvm} onChange={(e) => setField('lvSideLvm', e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>LVCC</label>
                      <input className={fieldCls} value={f.lvSideLvCc} onChange={(e) => setField('lvSideLvCc', e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t">
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={activeIdx === 0}
                  onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
                  className="px-3 py-2 text-xs font-bold uppercase border rounded disabled:opacity-40 flex items-center gap-1"
                >
                  <ChevronLeft className="w-4 h-4" /> Prev
                </button>
                <button
                  type="button"
                  disabled={activeIdx >= mrJobs.length - 1}
                  onClick={() => setActiveIdx((i) => Math.min(mrJobs.length - 1, i + 1))}
                  className="px-3 py-2 text-xs font-bold uppercase border rounded disabled:opacity-40 flex items-center gap-1"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-3 text-xs font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center shadow-sm disabled:opacity-60"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save All {mrJobs.length} External Entries
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </div>
  );
}
