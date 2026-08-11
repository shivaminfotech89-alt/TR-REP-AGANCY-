import { useState, useEffect, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { ArrowLeft, Loader2, Save, Search } from 'lucide-react';
import type { Job } from '../lib/types';

/** Data Modification — edit job master fields (like legacy desktop) */
export default function DataModification() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Job | null>(null);
  const [form, setForm] = useState({
    jobNo: '',
    mrNo: '',
    dateOfIssue: '',
    capacityKva: '',
    make: '',
    serialNo: '',
    type: '',
    repairType: 'OGP',
    division: '',
    status: '',
    kv: '',
    transformerCore: '',
  });
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    async function load() {
      if (!auth.currentUser) return;
      try {
        const q = query(collection(db, 'jobs'), where('ownerId', '==', auth.currentUser.uid));
        const snap = await getDocs(q);
        setJobs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Job)));
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'jobs');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const pick = (job: Job) => {
    setSelected(job);
    setSavedMsg('');
    setForm({
      jobNo: job.jobNo || '',
      mrNo: job.mrNo || '',
      dateOfIssue: job.dateOfIssue || '',
      capacityKva: String(job.capacityKva ?? ''),
      make: job.make || '',
      serialNo: job.serialNo || '',
      type: job.type || '',
      repairType: job.repairType || 'OGP',
      division: job.division || '',
      status: job.status || '',
      kv: job.kv || '',
      transformerCore: job.transformerCore || '',
    });
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !auth.currentUser) return;
    setSaving(true);
    setSavedMsg('');
    try {
      await updateDoc(doc(db, 'jobs', selected.id), {
        jobNo: form.jobNo,
        mrNo: form.mrNo,
        dateOfIssue: form.dateOfIssue,
        capacityKva: Number(form.capacityKva) || 0,
        make: form.make,
        serialNo: form.serialNo,
        type: form.type,
        repairType: form.repairType,
        division: form.division,
        status: form.status,
        kv: form.kv,
        transformerCore: form.transformerCore,
        updatedAt: Date.now(),
      });
      setJobs((prev) =>
        prev.map((j) =>
          j.id === selected.id
            ? {
                ...j,
                ...form,
                capacityKva: Number(form.capacityKva) || 0,
                repairType: form.repairType as Job['repairType'],
              }
            : j
        )
      );
      setSavedMsg(`Saved successfully — Job ${form.jobNo}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'jobs');
    } finally {
      setSaving(false);
    }
  };

  const filtered = jobs.filter((j) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [j.jobNo, j.mrNo, j.make, j.serialNo, j.division].some((v) => String(v || '').toLowerCase().includes(q));
  });

  const field = (key: keyof typeof form, label: string, type = 'text') => (
    <div>
      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">{label}</label>
      {key === 'repairType' || key === 'status' ? (
        key === 'repairType' ? (
          <select
            value={form.repairType}
            onChange={(e) => setForm((p) => ({ ...p, repairType: e.target.value }))}
            className="w-full px-3 py-2 text-sm border rounded bg-slate-50"
          >
            <option value="OGP">OGP</option>
            <option value="GP">GP</option>
          </select>
        ) : (
          <select
            value={form.status}
            onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}
            className="w-full px-3 py-2 text-sm border rounded bg-slate-50"
          >
            {[
              'Received',
              'External Done',
              'Internal Done',
              'Non-Repairable',
              'Estimate Prepared',
              'Estimate Sent',
              'Estimate Approved',
              'Under Repair',
              'Tested',
              'Billed',
              'Dispatched',
              'Completed',
            ].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )
      ) : (
        <input
          type={type}
          value={form[key]}
          onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
          className="w-full px-3 py-2 text-sm border rounded bg-slate-50"
        />
      )}
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-5 flex items-center gap-3">
        <Link to="/" className="p-2 bg-white rounded-full border shadow-sm">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-xl font-bold">Data Modification</h1>
      </div>

      {savedMsg && (
        <div className="mb-4 p-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">
          ✓ {savedMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border rounded p-4">
          <div className="relative mb-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search job / MR / make / serial..."
              className="w-full pl-9 pr-3 py-2 text-sm border rounded"
            />
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
          {loading ? (
            <Loader2 className="w-6 h-6 animate-spin mx-auto my-8 text-blue-600" />
          ) : (
            <div className="max-h-[480px] overflow-y-auto divide-y">
              {filtered.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => pick(j)}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 ${selected?.id === j.id ? 'bg-blue-50' : ''}`}
                >
                  <span className="font-mono font-bold block">{j.jobNo}</span>
                  <span className="text-slate-500">
                    MR {j.mrNo} · {j.make} · {j.serialNo} · {j.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border rounded p-4">
          {!selected ? (
            <p className="text-sm text-slate-500 py-12 text-center">Select a job to modify</p>
          ) : (
            <form onSubmit={save} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {field('jobNo', 'Job No')}
                {field('mrNo', 'MR No')}
                {field('dateOfIssue', 'Date of Issue', 'date')}
                {field('capacityKva', 'KVA', 'number')}
                {field('make', 'Make')}
                {field('serialNo', 'Serial No')}
                {field('type', 'Trans Type')}
                {field('repairType', 'Repair Type')}
                {field('division', 'Division')}
                {field('status', 'Status')}
                {field('kv', 'KV')}
                {field('transformerCore', 'Core (CRGO/Amorphous)')}
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 bg-blue-600 text-white text-xs font-bold uppercase rounded flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Changes
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
