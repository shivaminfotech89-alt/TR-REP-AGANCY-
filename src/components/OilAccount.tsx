import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, doc, setDoc } from 'firebase/firestore';
import { Loader2, ArrowLeft, Printer, Droplet, Save, Plus, Trash2 } from 'lucide-react';
import { useAgency } from '../lib/AgencyContext';
import { calcOilShortage, todayISO, formatDateIN } from '../lib/contractRates';
import type { Job, OilJobLine, OilReceipt, ExternalInspectionData } from '../lib/types';

export default function OilAccount() {
  const { activeAgency } = useAgency();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [inspections, setInspections] = useState<{ jobId: string; type: string; data: ExternalInspectionData }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState({
    billNo: '',
    billDate: todayISO(),
    division: '',
    openingBalance: 0,
    scrapTransOil: 0,
  });
  const [receipts, setReceipts] = useState<OilReceipt[]>([
    { srNo: 1, mrNo: '', mrDate: todayISO(), receivedOil: 0, filtLoss: 0 },
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      if (!auth.currentUser) return;
      try {
        const jq = query(collection(db, 'jobs'), where('ownerId', '==', auth.currentUser.uid));
        const iq = query(collection(db, 'inspections'), where('ownerId', '==', auth.currentUser.uid), where('type', '==', 'External'));
        const [js, is] = await Promise.all([getDocs(jq), getDocs(iq)]);
        setJobs(js.docs.map((d) => ({ id: d.id, ...d.data() } as Job)));
        setInspections(
          is.docs.map((d) => {
            const raw = d.data();
            return {
              jobId: raw.jobId,
              type: raw.type,
              data: (typeof raw.data === 'string' ? JSON.parse(raw.data) : raw.data) as ExternalInspectionData,
            };
          })
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'inspections');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const jobsWithOil = jobs.filter((j) => inspections.some((i) => i.jobId === j.id));

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

  const lines: OilJobLine[] = useMemo(() => {
    return [...selectedIds].map((id) => {
      const job = jobs.find((j) => j.id === id)!;
      const ext = inspections.find((i) => i.jobId === id)?.data;
      const oilCap = Number(ext?.oilCapLtrs) || 0;
      const lessOil = Number(ext?.lessOilLtrs) || 0;
      const oil = calcOilShortage(oilCap, lessOil);
      return {
        jobId: id,
        jobNo: job.jobNo,
        make: job.make,
        serialNo: job.serialNo,
        capacityKva: job.capacityKva,
        oilCap,
        oilCont: oil.oilCont,
        oilShort: oil.oilShort,
        filterLoss5: oil.filterLoss5,
        total: oil.total,
      };
    });
  }, [selectedIds, jobs, inspections]);

  const lessAsPerBill = Number(lines.reduce((s, l) => s + l.total, 0).toFixed(2));
  const oilReceived = Number(receipts.reduce((s, r) => s + (Number(r.receivedOil) || 0), 0).toFixed(2));
  const total = Number((meta.openingBalance + oilReceived).toFixed(2));
  const closingBalance = Number((total - lessAsPerBill - (meta.scrapTransOil || 0)).toFixed(2));
  const debitCredit = closingBalance;

  const save = async () => {
    if (!auth.currentUser || !meta.billNo) {
      alert('Enter Bill No');
      return;
    }
    setSaving(true);
    try {
      const now = Date.now();
      const ref = doc(collection(db, 'oilAccounts'));
      await setDoc(ref, {
        billNo: meta.billNo,
        billDate: meta.billDate,
        division: meta.division,
        openingBalance: meta.openingBalance,
        oilReceived,
        total,
        lessAsPerBill,
        scrapTransOil: meta.scrapTransOil || 0,
        closingBalance,
        debitCreditBalance: debitCredit,
        receipts,
        lines,
        agencyId: activeAgency?.id || '',
        createdAt: now,
        updatedAt: now,
        ownerId: auth.currentUser.uid,
      });
      alert('Oil account saved');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'oilAccounts');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between no-print">
        <div className="flex items-center space-x-4">
          <Link to="/" className="p-2 bg-white rounded-full shadow-sm border border-slate-200 hover:bg-slate-50">
            <ArrowLeft className="w-4 h-4 text-slate-600" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Oil Account Details</h1>
            <p className="text-xs text-slate-500">Shortage + 5% filtration loss · receivable from division</p>
          </div>
        </div>
        {lines.length > 0 && (
          <button onClick={() => window.print()} className="px-3 py-2 text-xs font-bold uppercase bg-slate-900 text-white rounded flex items-center gap-2">
            <Printer className="w-4 h-4" /> Print
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 no-print">
        <div className="bg-white border rounded p-4">
          <h2 className="text-xs font-bold uppercase text-slate-500 mb-3">Jobs with External Oil Data</h2>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {jobsWithOil.map((j) => (
              <label key={j.id} className="flex gap-2 p-2 border rounded text-xs cursor-pointer hover:bg-slate-50">
                <input type="checkbox" checked={selectedIds.has(j.id)} onChange={() => toggle(j.id)} />
                <span>
                  <span className="font-mono font-bold block">{j.jobNo}</span>
                  <span className="text-slate-500">MR {j.mrNo} · {j.capacityKva} KVA</span>
                </span>
              </label>
            ))}
            {jobsWithOil.length === 0 && (
              <p className="text-sm text-slate-500 flex items-center gap-2"><Droplet className="w-4 h-4" /> Complete external inspection first.</p>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white border rounded p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500">Bill No</label>
              <input value={meta.billNo} onChange={(e) => setMeta((p) => ({ ...p, billNo: e.target.value }))}
                className="w-full mt-1 px-2 py-1.5 text-sm border rounded" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500">Bill Date</label>
              <input type="date" value={meta.billDate} onChange={(e) => setMeta((p) => ({ ...p, billDate: e.target.value }))}
                className="w-full mt-1 px-2 py-1.5 text-sm border rounded" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500">Opening Balance</label>
              <input type="number" step="any" value={meta.openingBalance} onChange={(e) => setMeta((p) => ({ ...p, openingBalance: parseFloat(e.target.value) || 0 }))}
                className="w-full mt-1 px-2 py-1.5 text-sm border rounded" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500">Scrap Trans. Oil</label>
              <input type="number" step="any" value={meta.scrapTransOil} onChange={(e) => setMeta((p) => ({ ...p, scrapTransOil: parseFloat(e.target.value) || 0 }))}
                className="w-full mt-1 px-2 py-1.5 text-sm border rounded" />
            </div>
          </div>

          <div className="bg-white border rounded p-4">
            <div className="flex justify-between mb-2">
              <h3 className="text-xs font-bold uppercase text-slate-500">Oil Received (Plus)</h3>
              <button type="button" onClick={() => setReceipts((p) => [...p, { srNo: p.length + 1, mrNo: '', mrDate: todayISO(), receivedOil: 0, filtLoss: 0 }])}
                className="text-[10px] font-bold uppercase text-blue-600 flex items-center gap-1"><Plus className="w-3 h-3" /> Add</button>
            </div>
            {receipts.map((r, idx) => (
              <div key={idx} className="grid grid-cols-5 gap-2 mb-2 items-end">
                <div>
                  <label className="text-[10px] uppercase text-slate-500">MR No</label>
                  <input value={r.mrNo} onChange={(e) => setReceipts((p) => p.map((x, i) => i === idx ? { ...x, mrNo: e.target.value } : x))}
                    className="w-full px-2 py-1 text-sm border rounded" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">MR Date</label>
                  <input type="date" value={r.mrDate} onChange={(e) => setReceipts((p) => p.map((x, i) => i === idx ? { ...x, mrDate: e.target.value } : x))}
                    className="w-full px-2 py-1 text-sm border rounded" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">Received Oil</label>
                  <input type="number" step="any" value={r.receivedOil} onChange={(e) => setReceipts((p) => p.map((x, i) => i === idx ? { ...x, receivedOil: parseFloat(e.target.value) || 0 } : x))}
                    className="w-full px-2 py-1 text-sm border rounded" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">Filt. Loss</label>
                  <input type="number" step="any" value={r.filtLoss} onChange={(e) => setReceipts((p) => p.map((x, i) => i === idx ? { ...x, filtLoss: parseFloat(e.target.value) || 0 } : x))}
                    className="w-full px-2 py-1 text-sm border rounded" />
                </div>
                <button type="button" disabled={receipts.length === 1} onClick={() => setReceipts((p) => p.filter((_, i) => i !== idx))}
                  className="p-2 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>

          {lines.length > 0 && (
            <div className="bg-white border rounded overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                  <tr>
                    {['Job No','Make','Sr No','KVA','Oil Cap','Oil Cont','Oil Short','5% Loss','Total'].map((h) => (
                      <th key={h} className="px-2 py-2 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.map((l) => (
                    <tr key={l.jobId}>
                      <td className="px-2 py-1.5 font-mono font-bold">{l.jobNo}</td>
                      <td className="px-2 py-1.5">{l.make}</td>
                      <td className="px-2 py-1.5">{l.serialNo}</td>
                      <td className="px-2 py-1.5">{l.capacityKva}</td>
                      <td className="px-2 py-1.5 font-mono">{l.oilCap.toFixed(2)}</td>
                      <td className="px-2 py-1.5 font-mono">{l.oilCont.toFixed(2)}</td>
                      <td className="px-2 py-1.5 font-mono">{l.oilShort.toFixed(2)}</td>
                      <td className="px-2 py-1.5 font-mono">{l.filterLoss5.toFixed(2)}</td>
                      <td className="px-2 py-1.5 font-mono font-bold text-amber-700">{l.total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="bg-slate-900 text-white rounded p-4 text-sm space-y-1">
            <div className="flex justify-between"><span>1. Opening Balance</span><span className="font-mono">{meta.openingBalance.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>2. Plus : Oil Received</span><span className="font-mono">{oilReceived.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>3. Total</span><span className="font-mono">{total.toFixed(2)}</span></div>
            <div className="flex justify-between text-amber-300"><span>4. Less : As Per Bill Details</span><span className="font-mono">{lessAsPerBill.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>5. Scrap Trans. Oil</span><span className="font-mono">{(meta.scrapTransOil || 0).toFixed(2)}</span></div>
            <div className="flex justify-between font-bold text-lg border-t border-slate-700 pt-2"><span>6. Closing Balance</span><span className="font-mono">{closingBalance.toFixed(2)} Ltr</span></div>
            <button disabled={saving} onClick={save}
              className="mt-3 w-full py-2 bg-blue-600 rounded text-xs font-bold uppercase flex items-center justify-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Oil Account
            </button>
          </div>
        </div>
      </div>

      <div className="print-only text-[11px]">
        <h2 className="text-center font-bold text-base mb-1">OIL ACCOUNT DETAILS</h2>
        <div className="text-center text-[10px] mb-3">{activeAgency?.name} · {activeAgency?.address}</div>
        <div className="flex justify-between mb-2">
          <div>BILL NO : {meta.billNo}</div>
          <div>DATE : {formatDateIN(meta.billDate)}</div>
        </div>
        <div className="mb-3 space-y-0.5">
          <div>1. OPENING BALANCE : {meta.openingBalance.toFixed(2)}</div>
          <div>2. PLUS : OIL RECEIVED : {oilReceived.toFixed(2)}</div>
          <div>3. TOTAL : {total.toFixed(2)}</div>
          <div>4. LESS : As Per Bill : {lessAsPerBill.toFixed(2)}</div>
          <div>5. Scrap Trans. Oil : {(meta.scrapTransOil || 0).toFixed(2)}</div>
          <div className="font-bold">6. Closing Balance : {closingBalance.toFixed(2)}</div>
          <div>DEBIT/CREDIT BALANCE OF OIL C/F : {debitCredit.toFixed(2)} Ltr.</div>
        </div>
        <table className="w-full border-collapse mb-4">
          <thead>
            <tr>
              {['JOB NO','TR. SR NO','MAKE','KVA','OIL CAP','OIL CONT','OIL SHORT','5% LOSS','TOTAL'].map((h) => (
                <th key={h} className="border px-1">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.jobId}>
                <td className="border px-1">{l.jobNo}</td>
                <td className="border px-1">{l.serialNo}</td>
                <td className="border px-1">{l.make}</td>
                <td className="border px-1 text-center">{l.capacityKva}</td>
                <td className="border px-1 text-right">{l.oilCap.toFixed(2)}</td>
                <td className="border px-1 text-right">{l.oilCont.toFixed(2)}</td>
                <td className="border px-1 text-right">{l.oilShort.toFixed(2)}</td>
                <td className="border px-1 text-right">{l.filterLoss5.toFixed(2)}</td>
                <td className="border px-1 text-right font-bold">{l.total.toFixed(2)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={8} className="border px-1 text-right font-bold">TOTAL</td>
              <td className="border px-1 text-right font-bold">{lessAsPerBill.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
        <p className="font-semibold mb-1">Oil Received :</p>
        <table className="w-full border-collapse mb-6">
          <thead>
            <tr>{['SR','MR NO','MR DATE','RECEIVED OIL','FILT. LOSS'].map((h) => <th key={h} className="border px-1">{h}</th>)}</tr>
          </thead>
          <tbody>
            {receipts.map((r) => (
              <tr key={r.srNo}>
                <td className="border px-1 text-center">{r.srNo}</td>
                <td className="border px-1">{r.mrNo}</td>
                <td className="border px-1">{formatDateIN(r.mrDate)}</td>
                <td className="border px-1 text-right">{Number(r.receivedOil).toFixed(2)}</td>
                <td className="border px-1 text-right">{Number(r.filtLoss).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-right mt-8">Auth Sign.<br />For, {activeAgency?.name}</div>
      </div>
    </div>
  );
}
