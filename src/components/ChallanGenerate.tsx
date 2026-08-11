import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, doc, writeBatch } from 'firebase/firestore';
import { Loader2, ArrowLeft, Printer, Truck, Save } from 'lucide-react';
import { useAgency } from '../lib/AgencyContext';
import { todayISO, formatDateIN, addMonths } from '../lib/contractRates';
import { GUARANTEE_MONTHS } from '../lib/types';
import type { Job, ChallanLine } from '../lib/types';

export default function ChallanGenerate() {
  const { activeAgency, nextSequence } = useAgency();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState({ challanNo: '', challanDate: todayISO(), division: '' });
  const [saving, setSaving] = useState(false);

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

  const dispatchable = jobs.filter((j) =>
    ['Estimate Approved', 'Tested', 'Billed', 'Under Repair'].includes(j.status) && !j.isNonRepairable
  );

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    const job = jobs.find((j) => j.id === id);
    if (job && !meta.division) setMeta((p) => ({ ...p, division: job.division }));
  };

  const lines: ChallanLine[] = [...selectedIds].map((id) => {
    const j = jobs.find((x) => x.id === id)!;
    return { jobId: id, jobNo: j.jobNo, make: j.make, serialNo: j.serialNo, capacityKva: j.capacityKva, mrNo: j.mrNo };
  });

  const save = async () => {
    if (!auth.currentUser || !activeAgency || lines.length === 0) return;
    setSaving(true);
    try {
      const now = Date.now();
      let challanNo = meta.challanNo;
      if (!challanNo) {
        const n = await nextSequence('lastChallanNo');
        challanNo = String(n);
        setMeta((p) => ({ ...p, challanNo }));
      }
      const batch = writeBatch(db);
      const ref = doc(collection(db, 'challans'));
      batch.set(ref, {
        challanNo,
        challanDate: meta.challanDate,
        division: meta.division,
        lines,
        agencyId: activeAgency.id,
        createdAt: now,
        updatedAt: now,
        ownerId: auth.currentUser.uid,
      });

      for (const line of lines) {
        const job = jobs.find((j) => j.id === line.jobId);
        const guaranteeStart = job?.guaranteeStartDate || meta.challanDate;
        const guaranteeEnd = job?.guaranteeEndDate || addMonths(guaranteeStart, GUARANTEE_MONTHS);
        batch.update(doc(db, 'jobs', line.jobId), {
          status: 'Dispatched',
          challanNo,
          // One-time guarantee from first supply back
          guaranteeStartDate: job?.guaranteeStartDate || guaranteeStart,
          guaranteeEndDate: job?.guaranteeEndDate || guaranteeEnd,
          updatedAt: now,
        });
      }

      await batch.commit();
      alert(`Challan ${challanNo} saved — transformers returned to division`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'challans');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between no-print">
        <div className="flex items-center space-x-4">
          <Link to="/" className="p-2 bg-white rounded-full shadow-sm border border-slate-200 hover:bg-slate-50">
            <ArrowLeft className="w-4 h-4 text-slate-600" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Delivery Challan</h1>
            <p className="text-xs text-slate-500">Return repaired transformers to division office</p>
          </div>
        </div>
        {lines.length > 0 && (
          <button onClick={() => window.print()} className="px-3 py-2 text-xs font-bold uppercase bg-slate-900 text-white rounded flex items-center gap-2">
            <Printer className="w-4 h-4" /> Print
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 no-print">
        <div className="bg-white border rounded p-4">
          <h2 className="text-xs font-bold uppercase text-slate-500 mb-3">Ready for Dispatch</h2>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {dispatchable.map((j) => (
              <label key={j.id} className="flex gap-2 p-2 border rounded text-xs cursor-pointer hover:bg-slate-50">
                <input type="checkbox" checked={selectedIds.has(j.id)} onChange={() => toggle(j.id)} />
                <span>
                  <span className="font-mono font-bold block">{j.jobNo}</span>
                  <span className="text-slate-500">MR {j.mrNo} · {j.division} · {j.status}</span>
                </span>
              </label>
            ))}
            {dispatchable.length === 0 && (
              <p className="text-sm text-slate-500 flex items-center gap-2"><Truck className="w-4 h-4" /> No jobs ready for challan.</p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white border rounded p-4 grid grid-cols-1 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500">Challan No</label>
              <input value={meta.challanNo} onChange={(e) => setMeta((p) => ({ ...p, challanNo: e.target.value }))}
                className="w-full mt-1 px-2 py-1.5 text-sm border rounded" placeholder="Auto" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500">Date</label>
              <input type="date" value={meta.challanDate} onChange={(e) => setMeta((p) => ({ ...p, challanDate: e.target.value }))}
                className="w-full mt-1 px-2 py-1.5 text-sm border rounded" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500">Division</label>
              <input value={meta.division} onChange={(e) => setMeta((p) => ({ ...p, division: e.target.value }))}
                className="w-full mt-1 px-2 py-1.5 text-sm border rounded" />
            </div>
          </div>

          {lines.length > 0 && (
            <div className="bg-white border rounded p-4">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="text-left py-1">Job</th>
                    <th className="text-left py-1">Make / Sr</th>
                    <th className="text-left py-1">KVA</th>
                    <th className="text-left py-1">MR</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.jobId} className="border-t">
                      <td className="py-1.5 font-mono font-bold">{l.jobNo}</td>
                      <td className="py-1.5">{l.make} / {l.serialNo}</td>
                      <td className="py-1.5">{l.capacityKva}</td>
                      <td className="py-1.5">{l.mrNo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button disabled={saving} onClick={save}
                className="mt-4 w-full py-2 bg-blue-600 text-white rounded text-xs font-bold uppercase flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save & Mark Dispatched
              </button>
              <p className="mt-2 text-[10px] text-slate-500">Sets 18-month guarantee from first dispatch date (not reset on GP returns).</p>
            </div>
          )}
        </div>
      </div>

      <div className="print-only text-[12px]">
        <div className="text-center font-bold text-base">{activeAgency?.name}</div>
        <div className="text-center text-[10px] mb-4">{activeAgency?.address}</div>
        <h2 className="text-center font-bold underline mb-4">DELIVERY CHALLAN</h2>
        <div className="flex justify-between mb-4">
          <div>Challan No. : {meta.challanNo}</div>
          <div>Date : {formatDateIN(meta.challanDate)}</div>
        </div>
        <p className="mb-3">To,<br />The Executive Engineer,<br />O&amp;M Division Office - {meta.division}</p>
        <p className="mb-3">Please take delivery of the following repaired transformers:</p>
        <table className="w-full border-collapse mb-6">
          <thead>
            <tr>
              {['Sr','Job No','Make','Serial No','KVA','MR No'].map((h) => (
                <th key={h} className="border px-2 py-1">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.jobId}>
                <td className="border px-2 py-1 text-center">{i + 1}</td>
                <td className="border px-2 py-1">{l.jobNo}</td>
                <td className="border px-2 py-1">{l.make}</td>
                <td className="border px-2 py-1">{l.serialNo}</td>
                <td className="border px-2 py-1 text-center">{l.capacityKva}</td>
                <td className="border px-2 py-1">{l.mrNo}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-between mt-16">
          <div>Receiver Sign.</div>
          <div className="text-right">Auth Sign.<br />For, {activeAgency?.name}</div>
        </div>
      </div>
    </div>
  );
}
