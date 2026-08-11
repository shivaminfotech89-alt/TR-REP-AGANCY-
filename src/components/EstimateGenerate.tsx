import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, doc, writeBatch } from 'firebase/firestore';
import { Loader2, ArrowLeft, FileCheck, AlertTriangle, Printer, CheckCircle2, Send } from 'lucide-react';
import { useAgency } from '../lib/AgencyContext';
import {
  buildEstimateItems,
  summarizeItems,
  getApprovalLevel,
  getCircleOfficeLimit,
  todayISO,
  formatDateIN,
} from '../lib/contractRates';
import type { Job, EstimateItem, EstimateJobLine, ExternalInspectionData, InternalInspectionData } from '../lib/types';
import { ESTIMATE_RISE_PCT } from '../lib/types';

export default function EstimateGenerate() {
  const { activeAgency, nextSequence } = useAgency();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [inspections, setInspections] = useState<{ id: string; jobId: string; type: string; data: Record<string, unknown> }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMrNo, setSelectedMrNo] = useState<string | null>(null);
  const [lines, setLines] = useState<EstimateJobLine[]>([]);
  const [meta, setMeta] = useState({ estimateNo: '', estimateDate: todayISO(), orderNo: '' });
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedCreatedAt, setSavedCreatedAt] = useState<number | null>(null);
  const [approvalRef, setApprovalRef] = useState('');

  useEffect(() => {
    async function load() {
      if (!auth.currentUser) return;
      try {
        const jq = query(collection(db, 'jobs'), where('ownerId', '==', auth.currentUser.uid));
        const iq = query(collection(db, 'inspections'), where('ownerId', '==', auth.currentUser.uid));
        const [js, is] = await Promise.all([getDocs(jq), getDocs(iq)]);
        setJobs(js.docs.map((d) => ({ id: d.id, ...d.data() } as Job)));
        setInspections(
          is.docs.map((d) => {
            const raw = d.data();
            return {
              id: d.id,
              jobId: raw.jobId,
              type: raw.type,
              data: typeof raw.data === 'string' ? JSON.parse(raw.data) : (raw.data || {}),
            };
          })
        );
        if (activeAgency?.orderNo) {
          setMeta((p) => ({ ...p, orderNo: activeAgency.orderNo || '' }));
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'jobs');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [activeAgency?.orderNo]);

  const eligibleJobs = jobs.filter((j) => j.status === 'Internal Done' && !j.isNonRepairable);
  const mrGroups: Record<string, Job[]> = {};
  eligibleJobs.forEach((j) => {
    if (!mrGroups[j.mrNo]) mrGroups[j.mrNo] = [];
    mrGroups[j.mrNo].push(j);
  });
  const mrs = Object.keys(mrGroups).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const buildLineForJob = (job: Job): EstimateJobLine => {
    const ext = inspections.find((i) => i.jobId === job.id && i.type === 'External')?.data as ExternalInspectionData | undefined;
    const inn = inspections.find((i) => i.jobId === job.id && (i.type === 'Internal' || i.type === 'INTERNAL'))?.data as InternalInspectionData | undefined;

    const windingType = inn?.windingType || 'AL';
    const items = buildEstimateItems({
      kva: job.capacityKva,
      windingType,
      sealType: ext?.sealType || 'BL',
      gasket: String(ext?.gasket ?? '1'),
      hvLvRod: String(ext?.hvLvRod ?? '7'),
      hvBushing: String(ext?.hvSideHvb ?? '3'),
      hvMetal: String(ext?.hvSideHvm ?? '3'),
      lvBushing: String(ext?.lvSideLvb ?? '4'),
      lvMetal: String(ext?.lvSideLvm ?? '4'),
      outsidePaint: String(ext?.outsidePaint ?? 'Y'),
      oilLevGls: String(ext?.oilLevGls ?? 'Y'),
      breather: String(ext?.breather ?? 'N'),
      namePlate: String(ext?.namePlate ?? '-'),
      dryActPart: String(ext?.dryActPart ?? 'Y'),
      nuteBolt: String(ext?.nuteBolt ?? 'Y'),
      clnDrtyTank: String(ext?.clnDrtyTank ?? 'Y'),
      insidePaint: String(inn?.insidePaint ?? '-'),
      damRadNo: Number(ext?.damRadNo) || 0,
      hvCoilWt: Number(inn?.totWt) || 0,
      lvCoilWt: Number(inn?.totWtLv) || 0,
      lvHasRI: [inn?.lvCoilR, inn?.lvCoilY, inn?.lvCoilB].some((v) => String(v || '').toUpperCase().includes('RI')),
      insulation: String(inn?.insulation ?? 'Y'),
    });

    // GP jobs: often only labour/testing — keep items but user can edit
    const { total, riseTotal, grandTotal, risePct } = summarizeItems(items);
    const limit = activeAgency?.circleOfficeLimits?.[job.capacityKva.toString()] ?? getCircleOfficeLimit(job.capacityKva);
    const approvalLevel = getApprovalLevel(grandTotal, job.capacityKva);

    return {
      jobId: job.id,
      jobNo: job.jobNo,
      capacityKva: job.capacityKva,
      make: job.make,
      serialNo: job.serialNo,
      repairType: job.repairType,
      transformerCore: inn?.transformerCore || job.transformerCore || 'CRGO',
      windingType,
      oilCap: Number(ext?.oilCapLtrs) || 0,
      lessOil: Number(ext?.lessOilLtrs) || 0,
      filterOil: Number(ext?.oilAvailable) || 0,
      items,
      total,
      risePct,
      riseTotal,
      grandTotal,
      approvalLevel: limit && grandTotal > limit * 1.2 ? 'Scrap' : grandTotal > limit ? 'Corporate' : 'Circle',
      circleLimit: limit,
    };
  };

  const selectMr = (mr: string) => {
    const list = mrGroups[mr].sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));
    const built = list.map(buildLineForJob);
    setLines(built);
    setActiveJobId(built[0]?.jobId || null);
    setSelectedMrNo(mr);
    setSavedId(null);
    setSavedCreatedAt(null);
  };

  const activeLine = lines.find((l) => l.jobId === activeJobId) || null;
  const batchTotal = useMemo(() => Number(lines.reduce((s, l) => s + l.grandTotal, 0).toFixed(2)), [lines]);

  const updateItem = (jobId: string, idx: number, field: 'qty' | 'rate' | 'enabled', value: number | boolean) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.jobId !== jobId) return line;
        const items = [...line.items];
        const item = { ...items[idx] };
        if (field === 'enabled') item.enabled = value as boolean;
        else {
          (item as EstimateItem)[field] = value as number;
          item.amt = Number((item.qty * item.rate).toFixed(2));
          item.enabled = item.qty > 0;
        }
        items[idx] = item;
        const { total, riseTotal, grandTotal, risePct } = summarizeItems(items, ESTIMATE_RISE_PCT);
        const approvalLevel = getApprovalLevel(grandTotal, line.capacityKva);
        return { ...line, items, total, riseTotal, grandTotal, risePct, approvalLevel };
      })
    );
  };

  const persist = async (status: 'Draft' | 'Sent' | 'Approved') => {
    if (!auth.currentUser || !selectedMrNo || !activeAgency) {
      alert('Select agency and MR first');
      return;
    }
    setSaving(true);
    try {
      const now = Date.now();
      const batch = writeBatch(db);
      let estimateNo = meta.estimateNo;
      if (!estimateNo) {
        const n = await nextSequence('lastEstimateNo');
        estimateNo = String(n);
        setMeta((p) => ({ ...p, estimateNo }));
      }

      const estRef = savedId ? doc(db, 'estimates', savedId) : doc(collection(db, 'estimates'));
      const approvedAt = status === 'Approved' ? now : null;
      const createdAt = savedCreatedAt || now;
      const payload = {
        estimateNo,
        estimateDate: meta.estimateDate,
        division: lines[0] ? jobs.find((j) => j.id === lines[0].jobId)?.division || '' : '',
        mrNo: selectedMrNo,
        orderNo: meta.orderNo || activeAgency.orderNo || '',
        status,
        lines,
        grandTotal: batchTotal,
        approvedAt,
        approvalRef: status === 'Approved' ? approvalRef : '',
        agencyId: activeAgency.id,
        createdAt,
        updatedAt: now,
        ownerId: auth.currentUser.uid,
      };

      if (savedId) {
        batch.update(estRef, payload);
      } else {
        batch.set(estRef, payload);
        setSavedCreatedAt(createdAt);
      }

      for (const line of lines) {
        const jobUpdate: Record<string, unknown> = {
          estimateId: estRef.id,
          updatedAt: now,
          status:
            status === 'Approved'
              ? 'Estimate Approved'
              : status === 'Sent'
                ? 'Estimate Sent'
                : 'Estimate Prepared',
        };
        if (status === 'Approved') {
          jobUpdate.estimateApprovedAt = now;
        }
        if (line.approvalLevel === 'Scrap') {
          jobUpdate.status = 'Non-Repairable';
          jobUpdate.isNonRepairable = true;
        }
        batch.update(doc(db, 'jobs', line.jobId), jobUpdate);
      }

      await batch.commit();
      setSavedId(estRef.id);
      alert(`Estimate ${estimateNo} saved as ${status}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'estimates');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between gap-4 no-print">
        <div className="flex items-center space-x-4">
          <Link to="/" className="p-2 bg-white rounded-full shadow-sm border border-slate-200 hover:bg-slate-50">
            <ArrowLeft className="w-4 h-4 text-slate-600" />
          </Link>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Generate Estimate</h1>
        </div>
        {selectedMrNo && (
          <button onClick={() => window.print()} className="px-3 py-2 text-xs font-bold uppercase bg-slate-900 text-white rounded flex items-center gap-2">
            <Printer className="w-4 h-4" /> Print Estimate + Letter
          </button>
        )}
      </div>

      {!selectedMrNo ? (
        <div className="bg-white p-6 rounded shadow-sm border border-slate-200">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-4">Select MR (Internal Done)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {mrs.map((mr) => (
              <button key={mr} onClick={() => selectMr(mr)}
                className="text-left p-4 border border-slate-200 rounded hover:border-blue-500 hover:shadow-sm bg-white">
                <div className="font-mono font-bold text-slate-900">MR {mr}</div>
                <p className="text-xs text-slate-500 mt-1">{mrGroups[mr].length} jobs · {mrGroups[mr].map((j) => j.jobNo).join(', ')}</p>
              </button>
            ))}
            {mrs.length === 0 && <p className="text-slate-500 text-sm col-span-full">No jobs ready for estimate. Complete internal inspection first.</p>}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-slate-900 text-white p-4 rounded flex flex-wrap gap-4 justify-between items-end no-print">
            <div>
              <p className="text-[10px] uppercase text-slate-400 font-bold">MR {selectedMrNo}</p>
              <p className="text-lg font-bold">Batch Total ₹{batchTotal.toFixed(2)}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <div>
                <label className="text-[10px] uppercase text-slate-400">Est. No</label>
                <input value={meta.estimateNo} onChange={(e) => setMeta((p) => ({ ...p, estimateNo: e.target.value }))}
                  className="block mt-1 px-2 py-1 text-sm rounded bg-slate-800 border border-slate-700 font-mono w-24" placeholder="Auto" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-400">Date</label>
                <input type="date" value={meta.estimateDate} onChange={(e) => setMeta((p) => ({ ...p, estimateDate: e.target.value }))}
                  className="block mt-1 px-2 py-1 text-sm rounded bg-slate-800 border border-slate-700" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-400">Order No</label>
                <input value={meta.orderNo} onChange={(e) => setMeta((p) => ({ ...p, orderNo: e.target.value }))}
                  className="block mt-1 px-2 py-1 text-sm rounded bg-slate-800 border border-slate-700 w-56" />
              </div>
              <button type="button" onClick={() => setSelectedMrNo(null)} className="text-[10px] font-bold uppercase border border-blue-400/30 text-blue-300 px-3 py-1.5 rounded self-end">Change</button>
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto no-print">
            {lines.map((l) => (
              <button key={l.jobId} onClick={() => setActiveJobId(l.jobId)}
                className={`px-3 py-2 rounded text-xs font-mono border ${activeJobId === l.jobId ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200'}`}>
                {l.jobNo} · ₹{l.grandTotal.toFixed(0)}
                <span className={`ml-2 text-[9px] uppercase ${l.approvalLevel === 'Circle' ? 'text-green-300' : l.approvalLevel === 'Corporate' ? 'text-orange-300' : 'text-red-300'}`}>
                  {l.approvalLevel}
                </span>
              </button>
            ))}
          </div>

          {activeLine && (
            <div className="space-y-4">
              <div className={`p-4 rounded border no-print ${activeLine.approvalLevel === 'Scrap' ? 'bg-red-50 border-red-200' : activeLine.approvalLevel === 'Corporate' ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200'}`}>
                <div className="flex items-start gap-3">
                  <AlertTriangle className={`w-5 h-5 mt-0.5 ${activeLine.approvalLevel === 'Scrap' ? 'text-red-500' : activeLine.approvalLevel === 'Corporate' ? 'text-orange-500' : 'text-green-600'}`} />
                  <div className="text-xs space-y-1">
                    <p className="font-bold uppercase tracking-widest">
                      {activeLine.approvalLevel === 'Scrap' ? 'Non-Repairable (Scrap)' : activeLine.approvalLevel === 'Corporate' ? 'Corporate (CE) Approval Required' : 'Circle Office (SE) Approval'}
                    </p>
                    <p>Estimate ₹{activeLine.grandTotal.toFixed(2)} · Circle limit (KVA {activeLine.capacityKva}): ₹{activeLine.circleLimit.toFixed(2)}</p>
                    <p className="text-slate-600">Oil Cap / Less / Cont: {activeLine.oilCap} / {activeLine.lessOil} / {activeLine.filterOil} Ltr · {activeLine.windingType} · {activeLine.transformerCore}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white p-4 rounded border border-slate-200 no-print">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">
                  Pre-filled from External + Internal · {activeLine.jobNo}
                </h3>
                <div className="overflow-x-auto border rounded">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                      <tr>
                        <th className="px-2 py-2 text-left">Use</th>
                        <th className="px-2 py-2 text-left">Sr</th>
                        <th className="px-2 py-2 text-left">Item</th>
                        <th className="px-2 py-2 text-right">Qty</th>
                        <th className="px-2 py-2 text-right">Rate</th>
                        <th className="px-2 py-2 text-right">Amt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {activeLine.items.map((row, idx) => (
                        <tr key={row.no} className={row.enabled ? '' : 'opacity-40'}>
                          <td className="px-2 py-1">
                            <input type="checkbox" checked={row.enabled} onChange={(e) => updateItem(activeLine.jobId, idx, 'enabled', e.target.checked)} />
                          </td>
                          <td className="px-2 py-1 text-xs text-slate-500">{row.no}</td>
                          <td className="px-2 py-1 text-xs">{row.item}</td>
                          <td className="px-2 py-1 text-right">
                            <input type="number" step="any" value={row.qty} onChange={(e) => updateItem(activeLine.jobId, idx, 'qty', parseFloat(e.target.value) || 0)}
                              className="w-20 px-1 py-0.5 text-xs border rounded text-right" />
                          </td>
                          <td className="px-2 py-1 text-right">
                            <input type="number" step="any" value={row.rate} onChange={(e) => updateItem(activeLine.jobId, idx, 'rate', parseFloat(e.target.value) || 0)}
                              className="w-24 px-1 py-0.5 text-xs border rounded text-right" />
                          </td>
                          <td className="px-2 py-1 text-right font-mono text-xs">{row.enabled ? row.amt.toFixed(2) : '0.00'}</td>
                        </tr>
                      ))}
                      <tr className="bg-slate-50 font-bold text-xs">
                        <td colSpan={5} className="px-2 py-2 text-right">Total</td>
                        <td className="px-2 py-2 text-right font-mono">{activeLine.total.toFixed(2)}</td>
                      </tr>
                      <tr className="bg-slate-50 font-bold text-xs">
                        <td colSpan={5} className="px-2 py-2 text-right">4% Rise</td>
                        <td className="px-2 py-2 text-right font-mono">{activeLine.riseTotal.toFixed(2)}</td>
                      </tr>
                      <tr className="bg-slate-900 text-white font-bold">
                        <td colSpan={5} className="px-2 py-3 text-right text-sm">Grand Total</td>
                        <td className="px-2 py-3 text-right font-mono text-lg">{activeLine.grandTotal.toFixed(2)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 items-end no-print">
                <button disabled={saving} onClick={() => persist('Draft')}
                  className="px-4 py-2 text-xs font-bold uppercase bg-blue-600 text-white rounded flex items-center gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck className="w-4 h-4" />} Save Draft
                </button>
                <button disabled={saving} onClick={() => persist('Sent')}
                  className="px-4 py-2 text-xs font-bold uppercase bg-slate-800 text-white rounded flex items-center gap-2">
                  <Send className="w-4 h-4" /> Mark Sent to Circle
                </button>
                <div className="flex gap-2 items-end">
                  <div>
                    <label className="text-[10px] uppercase text-slate-500 font-bold">Approval Ref</label>
                    <input value={approvalRef} onChange={(e) => setApprovalRef(e.target.value)}
                      className="block mt-1 px-2 py-1.5 text-sm border rounded w-40" placeholder="Apr No" />
                  </div>
                  <button disabled={saving || !approvalRef} onClick={() => persist('Approved')}
                    className="px-4 py-2 text-xs font-bold uppercase bg-green-700 text-white rounded flex items-center gap-2 disabled:opacity-50">
                    <CheckCircle2 className="w-4 h-4" /> Record Approval
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Print layouts */}
          <div className="print-only space-y-8">
            <section className="print-break text-[11px] leading-snug">
              <div className="text-center font-bold text-base mb-1">{activeAgency?.name || 'Agency'}</div>
              <div className="text-center text-[10px] mb-3">{activeAgency?.address}</div>
              <div className="flex justify-between mb-2">
                <div>ORDER NO : {meta.orderNo || activeAgency?.orderNo}</div>
                <div>DIVISION : {jobs.find((j) => j.mrNo === selectedMrNo)?.division}</div>
              </div>
              <div className="flex justify-between mb-4 font-bold">
                <div>ESTIMATE REPORT NO : {meta.estimateNo || '—'}</div>
                <div>DATE : {formatDateIN(meta.estimateDate)}</div>
              </div>
              {lines.map((line) => (
                <div key={line.jobId} className="mb-6 border-t pt-3">
                  <div className="grid grid-cols-4 gap-2 mb-2 font-semibold">
                    <div>JOB NO: {line.jobNo} / {line.repairType}</div>
                    <div>MAKE: {line.make}</div>
                    <div>SR: {line.serialNo}</div>
                    <div>KVA: {line.capacityKva} · {line.transformerCore} · {line.windingType}</div>
                  </div>
                  <div className="mb-1">Oil Cap / Less / Cont: {line.oilCap} / {line.lessOil} / {line.filterOil}</div>
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="border px-1 text-left">Item</th>
                        <th className="border px-1 text-right">Qty</th>
                        <th className="border px-1 text-right">Rate</th>
                        <th className="border px-1 text-right">Amt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {line.items.filter((i) => i.enabled && i.amt > 0).map((i) => (
                        <tr key={i.no}>
                          <td className="border px-1">{i.no} {i.item}</td>
                          <td className="border px-1 text-right">{i.qty}</td>
                          <td className="border px-1 text-right">{i.rate.toFixed(2)}</td>
                          <td className="border px-1 text-right">{i.amt.toFixed(2)}</td>
                        </tr>
                      ))}
                      <tr><td colSpan={3} className="border px-1 text-right font-bold">Total</td><td className="border px-1 text-right font-bold">{line.total.toFixed(2)}</td></tr>
                      <tr><td colSpan={3} className="border px-1 text-right">4% Rise</td><td className="border px-1 text-right">{line.riseTotal.toFixed(2)}</td></tr>
                      <tr><td colSpan={3} className="border px-1 text-right font-bold">Grand Total</td><td className="border px-1 text-right font-bold">{line.grandTotal.toFixed(2)}</td></tr>
                    </tbody>
                  </table>
                </div>
              ))}
              <div className="mt-8 text-right">Auth Sign.<br />For, {activeAgency?.name}</div>
            </section>

            <section className="text-[12px] leading-relaxed">
              <div className="font-bold text-center text-base mb-1">{activeAgency?.name}</div>
              <div className="text-center text-[10px] mb-6">{activeAgency?.address} Ph: {activeAgency?.phone}</div>
              <div className="flex justify-between mb-4">
                <div>REF. NO. : {meta.estimateNo}</div>
                <div>DATE : {formatDateIN(meta.estimateDate)}</div>
              </div>
              <p>TO,</p>
              <p>Superintending Engineer (O & M),</p>
              <p>Circle Office : {jobs.find((j) => j.mrNo === selectedMrNo)?.division}</p>
              <p className="mt-4 font-semibold">Sub. : Submitting Inspection Report & Estimate of Transformer</p>
              <p className="mt-3">Dear Sir,</p>
              <p className="mt-2">With reference to the above subject, we are submitting you inspection reports and estimates of following transformers received from {jobs.find((j) => j.mrNo === selectedMrNo)?.division}.</p>
              <table className="w-full border-collapse mt-4 mb-4">
                <thead>
                  <tr>
                    {['NO.','TR. MAKE','TR. SR. NO.','KVA','KV','TRANS. TYPE','JOB NO.','OGP/GP','EST. AMT.'].map((h) => (
                      <th key={h} className="border px-1 text-[10px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.jobId}>
                      <td className="border px-1 text-center">{i + 1}</td>
                      <td className="border px-1">{l.make}</td>
                      <td className="border px-1">{l.serialNo}</td>
                      <td className="border px-1 text-center">{l.capacityKva}</td>
                      <td className="border px-1 text-center">11</td>
                      <td className="border px-1 text-center">{l.transformerCore}</td>
                      <td className="border px-1">{l.jobNo}</td>
                      <td className="border px-1 text-center">{l.repairType}</td>
                      <td className="border px-1 text-right">{l.grandTotal.toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={8} className="border px-1 text-right font-bold">TOTAL</td>
                    <td className="border px-1 text-right font-bold">{batchTotal.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
              <p>We request you to send the approval of above transformers earliest as possible.</p>
              <p className="mt-4">Thanking you</p>
              <p className="mt-6">Yours faithfully</p>
              <p className="mt-8">Auth Sign.<br />For, {activeAgency?.name}</p>
              <p className="mt-4 text-[10px]">Encl. : Estimate & Inspection Reports<br />C.C. to : E.E. (O & M) DIVISION - {jobs.find((j) => j.mrNo === selectedMrNo)?.division}</p>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
