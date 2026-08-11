import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, doc, writeBatch } from 'firebase/firestore';
import { Loader2, ArrowLeft, Printer, FileText, Save } from 'lucide-react';
import { useAgency } from '../lib/AgencyContext';
import { amountInWordsINR, todayISO, formatDateIN, addMonths } from '../lib/contractRates';
import { GUARANTEE_MONTHS } from '../lib/types';
import type { Job, BillLine } from '../lib/types';

export default function BillGenerate() {
  const { activeAgency, nextSequence } = useAgency();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [estimates, setEstimates] = useState<{ id: string; estimateNo: string; mrNo: string; lines: { jobId: string; grandTotal: number; total: number; riseTotal: number }[]; approvalRef?: string; approvedAt?: number; estimateDate?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState({
    billNo: '',
    billDate: todayISO(),
    division: '',
    orderNo: '',
    cgstPct: 9,
    sgstPct: 9,
    advanceStamp: 0,
  });
  const [lineExtras, setLineExtras] = useState<Record<string, { challanNo: string; challanDate: string; materialPct: number }>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      if (!auth.currentUser) return;
      try {
        const jq = query(collection(db, 'jobs'), where('ownerId', '==', auth.currentUser.uid));
        const eq = query(collection(db, 'estimates'), where('ownerId', '==', auth.currentUser.uid));
        const [js, es] = await Promise.all([getDocs(jq), getDocs(eq)]);
        setJobs(js.docs.map((d) => ({ id: d.id, ...d.data() } as Job)));
        setEstimates(
          es.docs
            .map((d) => ({ id: d.id, ...d.data() } as (typeof estimates)[0]))
            .filter((e) => (e as { status?: string }).status === 'Approved' || !!(e as { approvedAt?: number }).approvedAt)
        );
        if (activeAgency?.orderNo) setMeta((p) => ({ ...p, orderNo: activeAgency.orderNo || '' }));
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'jobs');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [activeAgency?.orderNo]);

  const billableJobs = jobs.filter(
    (j) =>
      (j.status === 'Estimate Approved' || j.status === 'Tested' || j.status === 'Under Repair') &&
      !j.isNonRepairable
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
    setLineExtras((prev) => ({
      ...prev,
      [id]: prev[id] || { challanNo: '', challanDate: todayISO(), materialPct: 70 },
    }));
  };

  const lines: BillLine[] = useMemo(() => {
    return [...selectedIds].map((id) => {
      const job = jobs.find((j) => j.id === id)!;
      const est = estimates.find((e) => e.lines?.some((l) => l.jobId === id) || e.mrNo === job.mrNo);
      const estLine = est?.lines?.find((l) => l.jobId === id);
      const amt = estLine?.grandTotal || 0;
      const materialPct = (lineExtras[id]?.materialPct ?? 70) / 100;
      const materialCost = Number((amt * materialPct).toFixed(2));
      const labourChrg = Number((amt - materialCost).toFixed(2));
      return {
        jobId: id,
        jobNo: job.jobNo,
        mrNo: job.mrNo,
        mrDate: job.dateOfIssue,
        make: job.make,
        serialNo: job.serialNo,
        capacityKva: job.capacityKva,
        challanNo: lineExtras[id]?.challanNo || '',
        challanDate: lineExtras[id]?.challanDate || '',
        aprNo: est?.approvalRef || '',
        aprDate: est?.estimateDate || '',
        materialCost,
        labourChrg,
        amt,
      };
    });
  }, [selectedIds, jobs, estimates, lineExtras]);

  const subTotal = Number(lines.reduce((s, l) => s + l.amt, 0).toFixed(2));
  const cgstAmt = Number(((subTotal * meta.cgstPct) / 100).toFixed(2));
  const sgstAmt = Number(((subTotal * meta.sgstPct) / 100).toFixed(2));
  const netTotal = Number((subTotal + cgstAmt + sgstAmt - (meta.advanceStamp || 0)).toFixed(2));
  const words = amountInWordsINR(netTotal);

  const saveBill = async () => {
    if (!auth.currentUser || !activeAgency || lines.length === 0) return;
    setSaving(true);
    try {
      const now = Date.now();
      let billNo = meta.billNo;
      if (!billNo) {
        const n = await nextSequence('lastBillNo');
        billNo = String(n);
        setMeta((p) => ({ ...p, billNo }));
      }
      const batch = writeBatch(db);
      const billRef = doc(collection(db, 'bills'));
      batch.set(billRef, {
        billNo,
        billDate: meta.billDate,
        division: meta.division,
        orderNo: meta.orderNo || activeAgency.orderNo || '',
        lines,
        subTotal,
        cgstPct: meta.cgstPct,
        sgstPct: meta.sgstPct,
        cgstAmt,
        sgstAmt,
        advanceStamp: meta.advanceStamp || 0,
        netTotal,
        amountInWords: words,
        agencyId: activeAgency.id,
        createdAt: now,
        updatedAt: now,
        ownerId: auth.currentUser.uid,
      });

      for (const line of lines) {
        const job = jobs.find((j) => j.id === line.jobId);
        const guaranteeStart = job?.guaranteeStartDate || meta.billDate;
        const guaranteeEnd = job?.guaranteeEndDate || addMonths(guaranteeStart, GUARANTEE_MONTHS);
        batch.update(doc(db, 'jobs', line.jobId), {
          status: 'Billed',
          billId: billRef.id,
          challanNo: line.challanNo || '',
          // Guarantee is one-time from first repair/supply — only set if empty
          guaranteeStartDate: job?.guaranteeStartDate || guaranteeStart,
          guaranteeEndDate: job?.guaranteeEndDate || guaranteeEnd,
          updatedAt: now,
        });
      }

      await batch.commit();
      alert(`Bill ${billNo} saved`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'bills');
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
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Generate Bill</h1>
        </div>
        {lines.length > 0 && (
          <button onClick={() => window.print()} className="px-3 py-2 text-xs font-bold uppercase bg-slate-900 text-white rounded flex items-center gap-2">
            <Printer className="w-4 h-4" /> Print Bill + Letter
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 no-print">
        <div className="lg:col-span-1 bg-white border rounded p-4">
          <h2 className="text-xs font-bold uppercase text-slate-500 mb-3">Approved Jobs</h2>
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {billableJobs.map((j) => (
              <label key={j.id} className="flex gap-2 items-start p-2 border rounded hover:bg-slate-50 cursor-pointer text-xs">
                <input type="checkbox" checked={selectedIds.has(j.id)} onChange={() => toggle(j.id)} className="mt-0.5" />
                <span>
                  <span className="font-mono font-bold block">{j.jobNo}</span>
                  <span className="text-slate-500">MR {j.mrNo} · {j.capacityKva} KVA · {j.make}</span>
                </span>
              </label>
            ))}
            {billableJobs.length === 0 && <p className="text-sm text-slate-500">No approved estimates ready for billing.</p>}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white border rounded p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500">Bill No</label>
              <input value={meta.billNo} onChange={(e) => setMeta((p) => ({ ...p, billNo: e.target.value }))}
                className="w-full mt-1 px-2 py-1.5 text-sm border rounded" placeholder="Auto" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500">Date</label>
              <input type="date" value={meta.billDate} onChange={(e) => setMeta((p) => ({ ...p, billDate: e.target.value }))}
                className="w-full mt-1 px-2 py-1.5 text-sm border rounded" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500">Division</label>
              <input value={meta.division} onChange={(e) => setMeta((p) => ({ ...p, division: e.target.value }))}
                className="w-full mt-1 px-2 py-1.5 text-sm border rounded" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500">Order No</label>
              <input value={meta.orderNo} onChange={(e) => setMeta((p) => ({ ...p, orderNo: e.target.value }))}
                className="w-full mt-1 px-2 py-1.5 text-sm border rounded" />
            </div>
          </div>

          {lines.map((l) => (
            <div key={l.jobId} className="bg-white border rounded p-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="font-mono font-bold col-span-2">{l.jobNo} · ₹{l.amt.toFixed(2)}</div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">Challan No</label>
                <input value={lineExtras[l.jobId]?.challanNo || ''} onChange={(e) => setLineExtras((p) => ({ ...p, [l.jobId]: { ...p[l.jobId], challanNo: e.target.value } }))}
                  className="w-full mt-1 px-2 py-1 border rounded" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">Challan Date</label>
                <input type="date" value={lineExtras[l.jobId]?.challanDate || ''} onChange={(e) => setLineExtras((p) => ({ ...p, [l.jobId]: { ...p[l.jobId], challanDate: e.target.value } }))}
                  className="w-full mt-1 px-2 py-1 border rounded" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">Material %</label>
                <input type="number" value={lineExtras[l.jobId]?.materialPct ?? 70} onChange={(e) => setLineExtras((p) => ({ ...p, [l.jobId]: { ...p[l.jobId], materialPct: parseFloat(e.target.value) || 0 } }))}
                  className="w-full mt-1 px-2 py-1 border rounded" />
              </div>
              <div className="text-slate-500 self-end">Mat ₹{l.materialCost.toFixed(2)} · Lab ₹{l.labourChrg.toFixed(2)}</div>
            </div>
          ))}

          {lines.length > 0 && (
            <div className="bg-slate-900 text-white rounded p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span>Sub Total</span><span className="font-mono">₹{subTotal.toFixed(2)}</span></div>
              <div className="flex justify-between gap-4 items-center">
                <span>CGST {meta.cgstPct}%</span>
                <input type="number" value={meta.cgstPct} onChange={(e) => setMeta((p) => ({ ...p, cgstPct: parseFloat(e.target.value) || 0 }))}
                  className="w-16 px-1 py-0.5 text-slate-900 rounded text-right" />
                <span className="font-mono ml-auto">₹{cgstAmt.toFixed(2)}</span>
              </div>
              <div className="flex justify-between gap-4 items-center">
                <span>SGST {meta.sgstPct}%</span>
                <input type="number" value={meta.sgstPct} onChange={(e) => setMeta((p) => ({ ...p, sgstPct: parseFloat(e.target.value) || 0 }))}
                  className="w-16 px-1 py-0.5 text-slate-900 rounded text-right" />
                <span className="font-mono ml-auto">₹{sgstAmt.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg border-t border-slate-700 pt-2">
                <span>Net Total</span><span className="font-mono">₹{netTotal.toFixed(2)}</span>
              </div>
              <p className="text-[10px] text-slate-300">{words}</p>
              <button disabled={saving} onClick={saveBill}
                className="mt-2 w-full py-2 bg-blue-600 hover:bg-blue-500 rounded text-xs font-bold uppercase flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Bill
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Print */}
      <div className="print-only text-[11px]">
        <section className="print-break">
          <div className="flex justify-between font-bold mb-2">
            <div>TAX INVOICE BILL NO : {meta.billNo}</div>
            <div>Date : {formatDateIN(meta.billDate)}</div>
          </div>
          <div className="mb-2">
            <div className="font-bold text-sm">{activeAgency?.name}</div>
            <div>{activeAgency?.address}</div>
            <div>GST No. : {activeAgency?.gstNo} · Pan No : {activeAgency?.panNo}</div>
          </div>
          <div className="mb-2">
            To,<br />
            The Executive Engineer,<br />
            O&amp;M Division Office - {meta.division}<br />
            Order No. &amp; Dt. : {meta.orderNo}
          </div>
          <p className="mb-2">DESCRIPTION: Repairing charges of various rating Distribution / SDT / Amrp. / Wound Core Transformers at our works.</p>
          <table className="w-full border-collapse mb-3">
            <thead>
              <tr>
                {['Sr','JOB','MR NO','DT.','MAKE','TR.SR.NO','CH.NO','DT.','APR.NO','DT.','KVA','Material','Labour','AMT(RS)'].map((h) => (
                  <th key={h} className="border px-0.5 text-[9px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.jobId}>
                  <td className="border px-0.5 text-center">{i + 1}</td>
                  <td className="border px-0.5">{l.jobNo}</td>
                  <td className="border px-0.5">{l.mrNo}</td>
                  <td className="border px-0.5">{formatDateIN(l.mrDate)}</td>
                  <td className="border px-0.5">{l.make}</td>
                  <td className="border px-0.5">{l.serialNo}</td>
                  <td className="border px-0.5">{l.challanNo}</td>
                  <td className="border px-0.5">{formatDateIN(l.challanDate)}</td>
                  <td className="border px-0.5">{l.aprNo}</td>
                  <td className="border px-0.5">{formatDateIN(l.aprDate)}</td>
                  <td className="border px-0.5 text-center">{l.capacityKva}</td>
                  <td className="border px-0.5 text-right">{l.materialCost.toFixed(2)}</td>
                  <td className="border px-0.5 text-right">{l.labourChrg.toFixed(2)}</td>
                  <td className="border px-0.5 text-right">{l.amt.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-right space-y-1">
            <div>TOTAL RS. : {subTotal.toFixed(2)}</div>
            <div>CGST ({meta.cgstPct}%) : {cgstAmt.toFixed(2)}</div>
            <div>SGST ({meta.sgstPct}%) : {sgstAmt.toFixed(2)}</div>
            <div className="font-bold text-sm">NET TOTAL RS. : {netTotal.toFixed(2)}</div>
            <div>{words}</div>
          </div>
          <p className="mt-4 text-[10px]">Guarantee: 18 working months / 6 months for SDT from date of dispatch for whole unit except OH Jobs.</p>
          <div className="mt-2 text-[10px]">
            Bank: {activeAgency?.bankName} · Acc: {activeAgency?.bankAccNo} · IFSC: {activeAgency?.bankIfsc}
          </div>
          <div className="mt-8 text-right">Auth Sign.<br />For, {activeAgency?.name}</div>
        </section>

        <section>
          <div className="font-bold">{activeAgency?.name}</div>
          <div className="text-[10px] mb-4">{activeAgency?.address}</div>
          <p>To<br />The Executive Engineer ,<br />Uttar Gujarat Vij Company Ltd.<br />Division Office : {meta.division}</p>
          <p className="mt-4 font-semibold">Sub : Submission of Bill for Payment</p>
          <p className="mt-3">Dear Sir,</p>
          <p className="mt-2">Please find enclosed herewith our bill No. - {meta.billNo} dated {formatDateIN(meta.billDate)}</p>
          <p className="mt-2">Rs. {netTotal.toFixed(2)} in words {words}</p>
          <p className="mt-2">Along with our Delivery Challan, Oil Account and relevant Test Certificate.</p>
          <p className="mt-2">You are requested to pass the above bill at your earliest and arrange to release the payment possibly earlier.</p>
          <p className="mt-4">Thanking you and assuring you of best services.</p>
          <p className="mt-4">Encl :-</p>
          <ol className="list-decimal ml-5 text-[10px]">
            <li>Bill Copy - 2 with Advance Stamp receipt.</li>
            <li>Bill Oil Account - 2.</li>
            <li>Delivery Challan - 1.</li>
            <li>Test Certificate - 1.</li>
            <li>Estimate Copy -1.</li>
            <li>Approval Copy -1.</li>
          </ol>
          <p className="mt-8">Yours Faithfully,<br />Auth Sign.<br />For, {activeAgency?.name}</p>
        </section>
      </div>

      {lines.length === 0 && (
        <div className="no-print mt-6 bg-white p-10 rounded border text-center text-slate-500">
          <FileText className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          Select approved jobs to prepare tax invoice and forwarding letter.
        </div>
      )}
    </div>
  );
}
