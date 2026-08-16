
import React, { useState, useEffect, useMemo } from 'react';
import { useAgency } from '../lib/AgencyContext';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { Wrench, Search, Loader2, ArrowLeft, Save, Download, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';
import { formatDDMMYYYY } from '../lib/utils';
import { LetterheadHeader, PrintableA4Page } from './LetterheadHeader';
import { triggerUniversalPrint, downloadElementAsPdf } from '../lib/printUtils';

export interface InternalData {
  windingType: string;
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
  wasring: string;
  inPnt: string;
  tstTrn: string;
  dc: string;
  insula: string;
  inspectionId?: string;
  condition?: string;
}

export default function InternalInspection() {
  const { activeAgency } = useAgency();
  const [jobs, setJobs] = useState<any[]>([]);
  const [inspections, setInspections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedMrNo, setSelectedMrNo] = useState<string | null>(null);
  const [formsData, setFormsData] = useState<Record<string, InternalData>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [divisionFilter, setDivisionFilter] = useState<string>('All');
  
  const [statusFilter, setStatusFilter] = useState<'Pending' | 'Completed'>('Pending');

  useEffect(() => {
    const fetchData = async () => {
      if (!auth.currentUser || !activeAgency) return;
      try {
        setLoading(true);
        const jobsQ = query(
          collection(db, 'jobs'),
          where('ownerId', '==', auth.currentUser.uid),
          where('agencyId', '==', activeAgency.id)
        );
        const [jobsSnap, inspSnap] = await Promise.all([
          getDocs(jobsQ),
          getDocs(query(
            collection(db, 'inspections'),
            where('ownerId', '==', auth.currentUser.uid),
            where('type', '==', 'Internal')
          ))
        ]);
        
        setJobs(jobsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
        setInspections(inspSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, null);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [activeAgency]);

  const handleSelectMr = (mrNo: string, allJobs = jobs, allInspections = inspections) => {
    const jobsForMr = allJobs.filter(j => j.mrNo === mrNo);
    jobsForMr.sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));

    const initialForms: Record<string, InternalData> = {};
    jobsForMr.forEach(j => {
      const existingInsp = allInspections.find(i => i.jobId === j.id);
      
      if (existingInsp && existingInsp.data) {
        initialForms[j.id] = {
          windingType: existingInsp.data.windingType || 'AL',
          condition: existingInsp.data.condition || 'Repairable',
          hvCoilLimb: existingInsp.data.hvCoilLimb || '',
          damR: existingInsp.data.damR || '',
          damY: existingInsp.data.damY || '',
          damB: existingInsp.data.damB || '',
          totCoil: existingInsp.data.totCoil || '',
          wtOfCoil: existingInsp.data.wtOfCoil || '',
          totWt: existingInsp.data.totWt || '',
          lvCoilR: existingInsp.data.lvCoilR || 'OK',
          lvCoilY: existingInsp.data.lvCoilY || 'OK',
          lvCoilB: existingInsp.data.lvCoilB || 'OK',
          wtOfCoilLv: existingInsp.data.wtOfCoilLv || '',
          totWtLv: existingInsp.data.totWtLv || '',
          wasring: existingInsp.data.wasring || '6',
          inPnt: existingInsp.data.inPnt || '-',
          tstTrn: existingInsp.data.tstTrn || 'Y',
          dc: existingInsp.data.dc || 'Y',
          insula: existingInsp.data.insula || 'Y',
          inspectionId: existingInsp.id
        };
      } else {
        initialForms[j.id] = {
          windingType: 'AL',
          condition: 'Repairable',
          hvCoilLimb: '4',
          damR: '',
          damY: '',
          damB: '',
          totCoil: '',
          wtOfCoil: '',
          totWt: '',
          lvCoilR: 'OK',
          lvCoilY: 'OK',
          lvCoilB: 'OK',
          wtOfCoilLv: '',
          totWtLv: '',
          wasring: '6',
          inPnt: '-',
          tstTrn: 'Y',
          dc: 'Y',
          insula: 'Y'
        };
      }
    });

    setFormsData(initialForms);
    setSelectedMrNo(mrNo);
  };

  const handleChange = (jobId: string, field: keyof InternalData, value: string) => {
    setFormsData(prev => {
      const current = { ...prev[jobId], [field]: value };
      
      // Auto-calculate Tot Wt for HV if we have both coil and weight
      if (['damR', 'damY', 'damB', 'wtOfCoil', 'totCoil'].includes(field)) {
        if (['damR', 'damY', 'damB'].includes(field)) {
           const r = parseInt(current.damR || '0', 10);
           const y = parseInt(current.damY || '0', 10);
           const b = parseInt(current.damB || '0', 10);
           current.totCoil = (!isNaN(r) ? r : 0) + (!isNaN(y) ? y : 0) + (!isNaN(b) ? b : 0) + '';
        }
        const tCoil = Number(current.totCoil) || 0;
        const wCoil = Number(current.wtOfCoil) || 0;
        current.totWt = (tCoil * wCoil).toFixed(2);
      }

      // Auto-calculate Tot Wt for LV based on damaged coils
      if (['lvCoilR', 'lvCoilY', 'lvCoilB', 'wtOfCoilLv'].includes(field)) {
        let badCount = 0;
        if (current.lvCoilR !== 'OK') badCount++;
        if (current.lvCoilY !== 'OK') badCount++;
        if (current.lvCoilB !== 'OK') badCount++;
        const wLv = Number(current.wtOfCoilLv) || 0;
        current.totWtLv = (badCount * wLv).toFixed(2);
      }

      return {
        ...prev,
        [jobId]: current
      };
    });
  };

  const mrJobs = useMemo(() => {
    if (!selectedMrNo) return [];
    return jobs.filter(j => j.mrNo === selectedMrNo).sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));
  }, [jobs, selectedMrNo]);

  
  const handleExportExcel = () => {
    if (!selectedMrNo) return;
    const mrDateStr = formatDDMMYYYY(mrJobs[0]?.dateOfIssue || mrJobs[0]?.mrDate || mrJobs[0]?.createdAt);
    const wsData = [
      ['MR Number', selectedMrNo, 'MR Date', mrDateStr],
      [],
      [
        '#', 'JOB NO', 'KVA', 'WIND', 'H.V. Coil Limb', 'No. Of Dam. H.V Coil R', 'No. Of Dam. H.V Coil Y', 'No. Of Dam. H.V Coil B', 'Tot. Coil (ht)', 'Wt. of Coil (Kg.) (ht)', 'TOT. Wt. (ht)', 'L.V. COIL DMG. OR RI. R', 'L.V. COIL DMG. OR RI. Y', 'L.V. COIL DMG. OR RI. B', 'WT. OF Coil (Kg.) LT', 'TOT. Wt. (LT)', 'Wasring', 'In. Pnt', 'Tst Trn', 'Dc', 'Insula', 'Job Type'
      ]
    ];
    
    mrJobs.forEach((job, index) => {
      const data = formsData[job.id] || {} as InternalData;
      wsData.push([
        index + 1,
        job.jobNo,
        job.capacityKva,
        data.windingType || '',
        data.hvCoilLimb || '',
        data.damR || '',
        data.damY || '',
        data.damB || '',
        data.totCoil || '',
        data.wtOfCoil || '',
        data.totWt || '',
        data.lvCoilR || 'OK',
        data.lvCoilY || 'OK',
        data.lvCoilB || 'OK',
        data.wtOfCoilLv || '',
        data.totWtLv || '',
        data.wasring || '',
        data.inPnt || '',
        data.tstTrn || '',
        data.dc || '',
        data.insula || '',
        job.coreType || '-'
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Internal Inspection");
    XLSX.writeFile(wb, `Internal_Inspection_${selectedMrNo}.xlsx`);
  };

  const handlePrint = () => {
    setIsPrintOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !selectedMrNo) return;

    // Strict validation: Ensure no blank or incomplete inspection form is submitted
    const incompleteJobs: string[] = [];
    for (const job of mrJobs) {
      if (job.status === 'Dispatched' || job.isClosed === true) continue;
      const jobData = formsData[job.id];
      if (!jobData) {
        incompleteJobs.push(`Job #${job.jobNo}: Form is completely blank`);
        continue;
      }

      const missing: string[] = [];
      if (!jobData.windingType || jobData.windingType.trim() === '') missing.push('Winding Type');
      if (!jobData.condition || jobData.condition.trim() === '') missing.push('Condition (Repairable / Scrap)');
      if (!jobData.wasring || jobData.wasring.trim() === '') missing.push('WAS Ring');
      if (!jobData.inPnt || jobData.inPnt.trim() === '') missing.push('Inside Paint');

      if (jobData.condition === 'Repairable') {
        const totalHvDam = (Number(jobData.damR) || 0) + (Number(jobData.damY) || 0) + (Number(jobData.damB) || 0);
        if (totalHvDam > 0 && (!jobData.wtOfCoil || jobData.wtOfCoil.trim() === '')) {
          missing.push('HV Coil Weight (Kg)');
        }
      }

      if (missing.length > 0) {
        incompleteJobs.push(`Job #${job.jobNo}: Missing (${missing.join(', ')})`);
      }
    }

    if (incompleteJobs.length > 0) {
      alert(`⚠️ Blank or incomplete internal inspection forms are NOT acceptable!\n\nPlease fill in all required inspection details before saving:\n\n${incompleteJobs.join('\n')}`);
      return;
    }
    
    setIsSubmitting(true);
    try {
      const now = Date.now();
      const batch = writeBatch(db);
      
      for (const job of mrJobs) {
        if (job.status === 'Dispatched' || job.isClosed === true) continue;
        const jobData = formsData[job.id];
        
        let inspectionRef;
        if (jobData.inspectionId) {
          inspectionRef = doc(db, 'inspections', jobData.inspectionId);
        } else {
          inspectionRef = doc(collection(db, 'inspections'));
        }
        
        const payload = {
          jobId: job.id,
          type: 'Internal',
          data: {
            windingType: jobData.windingType,
            condition: jobData.condition || 'Repairable',
            hvCoilLimb: jobData.hvCoilLimb,
            damR: jobData.damR,
            damY: jobData.damY,
            damB: jobData.damB,
            totCoil: jobData.totCoil,
            wtOfCoil: jobData.wtOfCoil,
            totWt: jobData.totWt,
            lvCoilR: jobData.lvCoilR,
            lvCoilY: jobData.lvCoilY,
            lvCoilB: jobData.lvCoilB,
            wtOfCoilLv: jobData.wtOfCoilLv,
            totWtLv: jobData.totWtLv,
            wasring: jobData.wasring,
            inPnt: jobData.inPnt,
            tstTrn: jobData.tstTrn,
            dc: jobData.dc,
            insula: jobData.insula
          },
          updatedAt: now,
          ownerId: auth.currentUser.uid,
        };
        
        if (!jobData.inspectionId) {
          (payload as any).createdAt = now;
        }

        batch.set(inspectionRef, payload, { merge: true });

        // Update Job Status
        const jobRef = doc(db, 'jobs', job.id);
        if (job.status === 'External Done' || job.status === 'Received' || job.status === 'Internal Done' || job.status === 'Scrap') {
          batch.update(jobRef, {
            status: jobData.condition === 'Scrap' ? 'Scrap' : 'Internal Done',
            updatedAt: now
          });
        }
      }

      await batch.commit();

      // Refresh data
      const jobsQ = query(
        collection(db, 'jobs'),
        where('ownerId', '==', auth.currentUser.uid),
        where('agencyId', '==', activeAgency?.id)
      );
      const [jobsSnap, inspSnap] = await Promise.all([
        getDocs(jobsQ),
        getDocs(query(
          collection(db, 'inspections'),
          where('ownerId', '==', auth.currentUser.uid),
          where('type', '==', 'Internal')
        ))
      ]);
      setJobs(jobsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
      setInspections(inspSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      
      setSelectedMrNo(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const mrGroups: Record<string, any[]> = {};
  jobs.forEach(j => {
    if (divisionFilter !== 'All' && j.division !== divisionFilter) return;
    if (!mrGroups[j.mrNo]) mrGroups[j.mrNo] = [];
    mrGroups[j.mrNo].push(j);
  });
  
  const availableDivisions = Array.from(new Set(jobs.map(j => j.division).filter(Boolean))).sort();
  
  const uniqueMrNos = Object.keys(mrGroups).filter(mr => {
    const jobsForMr = mrGroups[mr];
    if (statusFilter === 'Pending') {
      return jobsForMr.some(j => !inspections.some(i => i.jobId === j.id) && (j.status === 'External Done' || j.status === 'Received' || !j.status));
    } else {
      return jobsForMr.some(j => inspections.some(i => i.jobId === j.id));
    }
  }).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const filteredMrNos = uniqueMrNos.filter(mr => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return mr.toLowerCase().includes(q) || mrGroups[mr].some(j => j.jobNo.toLowerCase().includes(q));
  });

  const renderInputField = (jobId: string, field: keyof InternalData, type = 'text', widthClass = 'w-full', step?: string) => (
    <input
      type={type}
      value={formsData[jobId]?.[field] || ''}
      onChange={(e) => handleChange(jobId, field, e.target.value)}
      className={`px-2 py-1 text-[10px] border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm print:border-0 print:shadow-none print:p-0 print:bg-transparent print:appearance-none print:text-black print:text-center ${widthClass}`}
      step={step !== undefined ? step : (type === 'number' ? '0.01' : undefined)}
    />
  );

  const renderSelectField = (jobId: string, field: keyof InternalData, options: string[], widthClass = 'w-full') => (
    <select
      value={formsData[jobId]?.[field] || ''}
      onChange={(e) => handleChange(jobId, field, e.target.value)}
      className={`px-1 py-1 text-[10px] border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm print:border-0 print:shadow-none print:p-0 print:bg-transparent print:appearance-none print:text-black print:text-center ${widthClass}`}
    >
      {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  );

  if (!activeAgency) {
    return (
      <div className="p-8 text-center text-slate-500">
        Please select or create an agency first.
      </div>
    );
  }

  const scrapJobs = mrJobs.filter(job => formsData[job.id]?.condition === 'Scrap').map(j => j.jobNo);
  const scrapNote = scrapJobs.length > 0 
    ? `NOTE : JOB NO ${scrapJobs.join(' & ')} FOUND HEAVILY DAMAGED WITH CORE & LT, HENCE PROPOSED FOR SCRAP ONLY`
    : null;

  if (isPrintOpen && selectedMrNo) {
    const sampleJob = mrJobs[0];
    const mrDateStr = formatDDMMYYYY(sampleJob?.dateOfIssue || sampleJob?.mrDate || sampleJob?.createdAt);
    const CHUNK_SIZE = 9;
    const jobChunks: typeof mrJobs[] = [];
    for (let i = 0; i < mrJobs.length; i += CHUNK_SIZE) {
      jobChunks.push(mrJobs.slice(i, i + CHUNK_SIZE));
    }
    if (jobChunks.length === 0) jobChunks.push([]);

    return (
      <div className="bg-slate-100 min-h-screen text-black p-4 print:p-0 print:bg-white">
        <div className="print:hidden max-w-[297mm] mx-auto mb-4 flex justify-between items-center bg-white p-4 rounded-xl shadow-md border border-slate-200">
          <div>
            <p className="text-sm font-bold text-slate-800">Internal Inspection Report - Print Preview</p>
            <p className="text-xs text-slate-500">
              MR No: <strong className="font-mono">{selectedMrNo}</strong> ({mrDateStr}) • {mrJobs.length} Transformers • {jobChunks.length} Landscape A4 Page{jobChunks.length > 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => triggerUniversalPrint('printable-internal-inspection-sheet', `Internal_Inspection_MR_${selectedMrNo}`, `Internal_Inspection_MR_${selectedMrNo}.pdf`, 'landscape')} 
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg flex items-center shadow-sm font-bold text-xs cursor-pointer transition-colors"
              title="Print document on Landscape A4 / Letterhead"
            >
              <Printer className="w-4 h-4 mr-2" /> Print (Landscape)
            </button>
            <button 
              disabled={isExportingPdf}
              onClick={async () => {
                setIsExportingPdf(true);
                try {
                  await downloadElementAsPdf('printable-internal-inspection-sheet', `Internal_Inspection_MR_${selectedMrNo}.pdf`, 'landscape');
                } finally {
                  setIsExportingPdf(false);
                }
              }}
              className="px-5 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white rounded-lg flex items-center shadow-sm font-bold text-xs cursor-pointer disabled:opacity-50 transition-colors"
              title="Download crisp PDF file"
            >
              {isExportingPdf ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              {isExportingPdf ? 'Generating PDF...' : 'Download PDF'}
            </button>
            <button 
              onClick={handleExportExcel}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold text-xs cursor-pointer transition-colors flex items-center"
            >
              <Download className="w-3.5 h-3.5 mr-1.5" /> Excel
            </button>
            <button 
              onClick={() => setIsPrintOpen(false)} 
              className="px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg font-bold text-xs cursor-pointer transition-colors"
            >
              Close Preview
            </button>
          </div>
        </div>

        <div id="printable-internal-inspection-sheet" className="p-0 bg-transparent flex flex-col items-center">
          {jobChunks.map((chunk, pageIdx) => {
            const isLastPage = pageIdx === jobChunks.length - 1;
            return (
              <PrintableA4Page
                key={pageIdx}
                agency={activeAgency}
                orientation="landscape"
                documentTitle="INTERNAL INSPECTION & COIL DAMAGE REPORT"
                subtitle={jobChunks.length > 1 ? `Sheet ${pageIdx + 1} of ${jobChunks.length}` : undefined}
                className={pageIdx > 0 ? 'print-page-break-before mb-6' : 'mb-6'}
              >
                <div className="flex flex-col justify-between h-full">
                  <div>
                    <div className="flex justify-between items-center text-[10px] font-bold border-b border-black pb-1 mb-1.5">
                      <span>MR NO: <strong className="font-mono">{selectedMrNo}</strong></span>
                      <span>MR DATE: <strong className="font-mono">({mrDateStr})</strong></span>
                      <span>DIVISION: <strong className="uppercase">{sampleJob?.division || '-'}</strong></span>
                      <span>TOTAL TRANSFORMERS: <strong>{mrJobs.length}</strong></span>
                    </div>

                    <table className="w-full border-collapse border border-black text-[7.5px] text-center">
                      <thead>
                        <tr className="bg-slate-100 print:bg-transparent font-bold">
                          <th className="border border-black p-0.5 w-6" rowSpan={2}>Sr</th>
                          <th className="border border-black p-0.5 min-w-[70px]" rowSpan={2}>Job No</th>
                          <th className="border border-black p-0.5 w-8" rowSpan={2}>KVA</th>
                          <th className="border border-black p-0.5 w-8" rowSpan={2}>Wind</th>
                          <th className="border border-black p-0.5 w-8" rowSpan={2}>HV Limb</th>
                          <th className="border border-black p-0.5" colSpan={3}>Damaged HV Coil</th>
                          <th className="border border-black p-0.5 w-8" rowSpan={2}>Tot Coil (HT)</th>
                          <th className="border border-black p-0.5 w-10" rowSpan={2}>Wt/Coil (Kg)</th>
                          <th className="border border-black p-0.5 w-10" rowSpan={2}>Tot Wt (HT)</th>
                          <th className="border border-black p-0.5" colSpan={3}>LV Coil (Dmg/RI/OK)</th>
                          <th className="border border-black p-0.5 w-10" rowSpan={2}>Wt/Coil (LT)</th>
                          <th className="border border-black p-0.5 w-10" rowSpan={2}>Tot Wt (LT)</th>
                          <th className="border border-black p-0.5 w-7" rowSpan={2}>Was Ring</th>
                          <th className="border border-black p-0.5 w-7" rowSpan={2}>In Pnt</th>
                          <th className="border border-black p-0.5 w-7" rowSpan={2}>Tst Trn</th>
                          <th className="border border-black p-0.5 w-7" rowSpan={2}>DC</th>
                          <th className="border border-black p-0.5 w-7" rowSpan={2}>Insula</th>
                          <th className="border border-black p-0.5 w-8" rowSpan={2}>Type</th>
                          <th className="border border-black p-0.5 w-12" rowSpan={2}>Condition</th>
                        </tr>
                        <tr className="bg-slate-100 print:bg-transparent font-bold">
                          <th className="border border-black p-0.5 w-6">R</th>
                          <th className="border border-black p-0.5 w-6">Y</th>
                          <th className="border border-black p-0.5 w-6">B</th>
                          <th className="border border-black p-0.5 w-6">R</th>
                          <th className="border border-black p-0.5 w-6">Y</th>
                          <th className="border border-black p-0.5 w-6">B</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chunk.map((job, cIdx) => {
                          const globalIdx = pageIdx * CHUNK_SIZE + cIdx;
                          const data = formsData[job.id] || {} as any;

                          return (
                            <tr key={job.id} className="border border-black h-6">
                              <td className="border border-black p-0.5 font-bold">{globalIdx + 1}</td>
                              <td className="border border-black p-0.5 font-bold font-mono uppercase text-left pl-1">
                                {job.jobNo}
                              </td>
                              <td className="border border-black p-0.5 font-bold">{job.capacityKva}</td>
                              <td className="border border-black p-0.5">{data.windingType || 'AL'}</td>
                              <td className="border border-black p-0.5">{data.hvCoilLimb || '-'}</td>
                              
                              <td className="border border-black p-0.5 font-mono">{data.damR || '-'}</td>
                              <td className="border border-black p-0.5 font-mono">{data.damY || '-'}</td>
                              <td className="border border-black p-0.5 font-mono">{data.damB || '-'}</td>
                              
                              <td className="border border-black p-0.5 font-bold">{data.totCoil || '-'}</td>
                              <td className="border border-black p-0.5">{data.wtOfCoil || '-'}</td>
                              <td className="border border-black p-0.5 font-bold">{data.totWt || '-'}</td>
                              
                              <td className="border border-black p-0.5">{data.lvCoilR || 'OK'}</td>
                              <td className="border border-black p-0.5">{data.lvCoilY || 'OK'}</td>
                              <td className="border border-black p-0.5">{data.lvCoilB || 'OK'}</td>
                              
                              <td className="border border-black p-0.5">{data.wtOfCoilLv || '-'}</td>
                              <td className="border border-black p-0.5 font-bold">{data.totWtLv || '-'}</td>
                              
                              <td className="border border-black p-0.5">{data.wasring || '1'}</td>
                              <td className="border border-black p-0.5">{data.inPnt || 'Y'}</td>
                              <td className="border border-black p-0.5">{data.tstTrn || 'Y'}</td>
                              <td className="border border-black p-0.5">{data.dc || 'Y'}</td>
                              <td className="border border-black p-0.5">{data.insula || 'Y'}</td>
                              <td className="border border-black p-0.5">{job.coreType || '-'}</td>
                              <td className={`border border-black p-0.5 font-bold ${data.condition === 'Scrap' ? 'text-red-600' : 'text-slate-800'}`}>
                                {data.condition || 'Repairable'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {scrapNote && isLastPage && (
                      <div className="mt-2 p-1.5 bg-amber-50 print:bg-transparent border border-amber-300 print:border-black text-[8px] font-bold text-amber-900 print:text-black uppercase">
                        {scrapNote}
                      </div>
                    )}
                  </div>

                  {isLastPage && (
                    <div className="mt-2 pt-2 border-t border-black flex justify-between items-end px-6 text-[9.5px] font-bold uppercase">
                      <div className="text-center">
                        <div className="h-8"></div>
                        <div className="border-t border-dotted border-black pt-0.5">INSPECTED BY (TESTING ENG.)</div>
                        <div className="text-[8px] text-slate-700 font-normal">Junior Engineer / Inspector</div>
                      </div>
                      <div className="text-center">
                        <div className="h-8"></div>
                        <div className="border-t border-dotted border-black pt-0.5">WITNESSED & VERIFIED BY</div>
                        <div className="text-[8px] text-slate-700 font-normal">AEE / Sub-Division Officer</div>
                      </div>
                      <div className="text-center">
                        <div className="h-8 flex items-center justify-center">
                          <div className="border border-dashed border-slate-400 px-2 py-0.5 rounded text-[7.5px] text-slate-500 font-normal">
                            OFFICIAL STAMP
                          </div>
                        </div>
                        <div className="border-t border-dotted border-black pt-0.5">FOR {activeAgency?.name}</div>
                        <div className="text-[8px] text-slate-700 font-normal">Authorized Signatory</div>
                      </div>
                    </div>
                  )}
                </div>
              </PrintableA4Page>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 print:space-y-0">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded shadow-sm border border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-900 print:text-black flex items-center">
            <Wrench className="w-6 h-6 mr-3 text-blue-600" />
            Internal Inspection
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Fill internal inspection parameters for OGP repair jobs.
          </p>
        </div>
      </div>

      {!selectedMrNo ? (
        <div className="bg-white rounded shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 print:bg-transparent flex flex-col md:flex-row justify-between items-center gap-4">
            <h2 className="text-sm font-bold text-slate-700 print:text-black uppercase tracking-widest">Select MR to Inspect</h2>
            <div className="flex flex-wrap items-center space-x-4 w-full md:w-auto gap-y-2">
              <select
                value={divisionFilter}
                onChange={(e) => setDivisionFilter(e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="All">All Divisions</option>
                {availableDivisions.map(div => (
                  <option key={div as string} value={div as string}>{div as string}</option>
                ))}
              </select>
              <div className="flex bg-slate-200 p-1 rounded-md">
                <button
                  onClick={() => setStatusFilter('Pending')}
                  className={`px-4 py-1.5 text-xs font-bold uppercase rounded ${statusFilter === 'Pending' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 print:text-black'}`}
                >
                  Pending
                </button>
                <button
                  onClick={() => setStatusFilter('Completed')}
                  className={`px-4 py-1.5 text-xs font-bold uppercase rounded ${statusFilter === 'Completed' ? 'bg-white text-green-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 print:text-black'}`}
                >
                  Completed
                </button>
              </div>
              <div className="relative flex-1 md:w-64">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search MR or Job No..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                />
              </div>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-12 flex justify-center text-slate-500">
                <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
              </div>
            ) : (
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-100/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase print:text-black tracking-widest">MR Number & Date</th>
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase print:text-black tracking-widest">Total Jobs</th>
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase print:text-black tracking-widest">Job Nos</th>
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase print:text-black tracking-widest">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {filteredMrNos.map(mr => {
                    const sampleJob = mrGroups[mr][0];
                    const mrDateStr = formatDDMMYYYY(sampleJob?.dateOfIssue || sampleJob?.mrDate || sampleJob?.createdAt);
                    return (
                    <tr key={mr} className="hover:bg-slate-50 print:bg-transparent transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-mono font-bold text-slate-900 print:text-black">{mr}</div>
                        <div className="text-xs text-slate-500">Date: <span className="font-mono text-slate-700 font-medium">({mrDateStr})</span></div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-500">{mrGroups[mr].length} Jobs</td>
                      <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate" title={mrGroups[mr].map(j => j.jobNo).join(', ')}>
                        {mrGroups[mr].map(j => j.jobNo).join(', ')}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <button 
                            onClick={() => handleSelectMr(mr)}
                            className="flex items-center px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition-colors"
                          >
                            {statusFilter === 'Pending' ? 'Inspect MR' : 'Edit MR'} <ArrowLeft className="w-3 h-3 ml-1 rotate-180" />
                          </button>
                          {statusFilter === 'Completed' && (
                            <button 
                              onClick={() => {
                                handleSelectMr(mr);
                                setIsPrintOpen(true);
                              }}
                              className="flex items-center px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest bg-slate-100 text-slate-700 hover:bg-slate-200 rounded transition-colors"
                              title="Print Internal Inspection Report"
                            >
                              <Printer className="w-3 h-3 mr-1 text-slate-600" /> Print
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                  {filteredMrNos.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">No {statusFilter.toLowerCase()} MR numbers found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded flex justify-between items-center text-white print:hidden">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Inspecting MR</p>
              <div className="flex items-center gap-3">
                <p className="text-xl font-mono font-bold">{selectedMrNo}</p>
                <span className="text-xs bg-slate-800 text-blue-300 font-mono px-2.5 py-1 rounded border border-slate-700">
                  MR Date: <strong className="text-white">({formatDDMMYYYY(mrJobs[0]?.dateOfIssue || mrJobs[0]?.mrDate || mrJobs[0]?.createdAt)})</strong>
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1">{mrJobs.length} Transformers in this MR</p>
            </div>
            
            <div className="flex items-center space-x-2">
              <button 
                type="button"
                onClick={handleExportExcel}
                className="flex items-center text-[10px] font-bold uppercase tracking-widest text-green-400 hover:text-green-300 border border-green-400/30 px-3 py-1.5 rounded transition-colors print:hidden"
              >
                <Download className="w-3 h-3 mr-1" /> Excel
              </button>
              <button 
                type="button"
                onClick={handlePrint}
                className="flex items-center text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-300 border border-slate-400/30 px-3 py-1.5 rounded transition-colors print:hidden"
              >
                <Printer className="w-3 h-3 mr-1" /> Print
              </button>
              <button 
                onClick={() => setSelectedMrNo(null)}
                className="text-[10px] font-bold uppercase tracking-widest text-blue-400 hover:text-blue-300 border border-blue-400/30 px-3 py-1.5 rounded transition-colors print:hidden"
              >
                Back to List
              </button>
            </div>

          </div>

          <div className="bg-amber-50 border-l-4 border-amber-500 p-3 rounded text-amber-900 text-xs flex items-center gap-2 shadow-sm print:hidden">
            <span className="font-bold text-sm">⚠️ Mandatory Rule:</span>
            <span>Blank internal inspection reports are <strong>NOT acceptable</strong>. You must select Winding Type, Condition, WAS Ring, and fill damaged coil weights before submitting.</span>
          </div>

          <div className="bg-white rounded shadow-sm border border-slate-200 overflow-x-auto print:border-none print:shadow-none print:overflow-visible">
            <div className="hidden print:block mb-3">
              <LetterheadHeader agency={activeAgency} documentTitle="INTERNAL INSPECTION REPORT" />
              <div className="flex justify-between items-center text-[10px] font-bold border-b border-black pb-1.5 mb-2">
                <span>MR NO: <strong className="font-mono">{selectedMrNo}</strong></span>
                <span>MR DATE: <strong className="font-mono">({formatDDMMYYYY(mrJobs[0]?.dateOfIssue || mrJobs[0]?.mrDate || mrJobs[0]?.createdAt)})</strong></span>
                <span>DIVISION: <strong className="uppercase">{mrJobs[0]?.division || '-'}</strong></span>
                <span>TOTAL TRANSFORMERS: <strong>{mrJobs.length}</strong></span>
              </div>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="min-w-max">
                <table className="w-full text-left print:text-black print:text-[8px]">
                  <thead>
                    <tr>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest sticky left-0 z-10 w-8" rowSpan={2}>#</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest sticky left-8 z-10 min-w-[80px]" rowSpan={2}>JOB NO</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest min-w-[40px]" rowSpan={2}>KVA</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest min-w-[40px]" rowSpan={2}>WIND</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest min-w-[40px]" rowSpan={2}>H.V<br/>Coil<br/>Limb</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest text-center border-l border-slate-200" colSpan={3}>No. Of Dam.<br/>H.V Coil</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest min-w-[40px] border-l border-slate-200" rowSpan={2}>Tot.<br/>Coil<br/>(ht)</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest min-w-[40px]" rowSpan={2}>Wt.<br/>of Coil<br/>(Kg.)<br/>(ht)</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest min-w-[40px]" rowSpan={2}>TOT.<br/>Wt.<br/>(ht)</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest text-center border-l border-slate-200" colSpan={3}>L.V. COIL<br/>DMG. OR RI.</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest min-w-[40px] border-l border-slate-200" rowSpan={2}>WT.<br/>OF<br/>Coil<br/>(Kg.)<br/>LT</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest min-w-[40px]" rowSpan={2}>TOT.<br/>Wt.<br/>(LT)</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest min-w-[40px] border-l border-slate-200" rowSpan={2}>Wa<br/>sri<br/>ng</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest min-w-[40px]" rowSpan={2}>In.<br/>Pnt</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest min-w-[40px]" rowSpan={2}>Tst<br/>Trn</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest min-w-[40px]" rowSpan={2}>Dc</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest min-w-[40px]" rowSpan={2}>In<br/>su<br/>la</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest min-w-[40px]" rowSpan={2}>Job<br/>Type</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest min-w-[50px] print:hidden" rowSpan={2}>Condition</th>
                    </tr>
                    <tr>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest text-center border-l border-slate-200 min-w-[32px]">R</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest text-center min-w-[32px]">Y</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest text-center min-w-[32px]">B</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest text-center border-l border-slate-200 min-w-[36px]">R</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest text-center min-w-[36px]">Y</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest text-center min-w-[36px]">B</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {mrJobs.map((job, index) => {
                      return (
                      <tr key={job.id} className="hover:bg-slate-50 print:bg-transparent group">
                        <td className="p-1 text-xs font-mono text-slate-500 sticky left-0 bg-white group-hover:bg-slate-50 print:bg-transparent border-r border-slate-100 z-10 text-center">{index + 1}</td>
                        <td className="p-1 text-xs font-mono font-bold text-slate-900 print:text-black sticky left-8 bg-white group-hover:bg-slate-50 print:bg-transparent border-r border-slate-100 min-w-[80px] z-10">{job.jobNo}</td>
                        <td className="p-1 text-[10px] text-slate-700 print:text-black font-mono text-center">{job.capacityKva}</td>
                        
                        <td className="p-1">{renderSelectField(job.id, 'windingType', ['AL', 'CU'], 'min-w-[48px]')}</td>
                        <td className="p-1">{renderInputField(job.id, 'hvCoilLimb', 'number', 'min-w-[40px]')}</td>
                        
                        <td className="p-0.5 border-l border-slate-100">{renderInputField(job.id, 'damR', 'number', 'min-w-[36px]', '1')}</td>
                        <td className="p-0.5">{renderInputField(job.id, 'damY', 'number', 'min-w-[36px]', '1')}</td>
                        <td className="p-0.5">{renderInputField(job.id, 'damB', 'number', 'min-w-[36px]', '1')}</td>
                        
                        <td className="p-1 border-l border-slate-100">{renderInputField(job.id, 'totCoil', 'number', 'min-w-[48px]', '1')}</td>
                        <td className="p-1">{renderInputField(job.id, 'wtOfCoil', 'number', 'min-w-[56px]')}</td>
                        <td className="p-1">{renderInputField(job.id, 'totWt', 'number', 'min-w-[64px]')}</td>
                        
                        <td className="p-0.5 border-l border-slate-100">{renderSelectField(job.id, 'lvCoilR', ['OK', 'RI', 'DAM'], 'min-w-[48px]')}</td>
                        <td className="p-0.5">{renderSelectField(job.id, 'lvCoilY', ['OK', 'RI', 'DAM'], 'min-w-[48px]')}</td>
                        <td className="p-0.5">{renderSelectField(job.id, 'lvCoilB', ['OK', 'RI', 'DAM'], 'min-w-[48px]')}</td>
                        
                        <td className="p-1 border-l border-slate-100">{renderInputField(job.id, 'wtOfCoilLv', 'number', 'min-w-[56px]')}</td>
                        <td className="p-1">{renderInputField(job.id, 'totWtLv', 'number', 'min-w-[64px]')}</td>
                        
                        <td className="p-1 border-l border-slate-100">{renderInputField(job.id, 'wasring', 'text', 'min-w-[40px]')}</td>
                        <td className="p-1">{renderSelectField(job.id, 'inPnt', ['-', 'Y', 'N'], 'min-w-[40px]')}</td>
                        <td className="p-1">{renderSelectField(job.id, 'tstTrn', ['Y', 'N', '-'], 'min-w-[40px]')}</td>
                        <td className="p-1">{renderSelectField(job.id, 'dc', ['Y', 'N', '-'], 'min-w-[40px]')}</td>
                        <td className="p-1">{renderSelectField(job.id, 'insula', ['Y', 'N', '-'], 'min-w-[40px]')}</td>
                        <td className="p-1 text-[10px] text-slate-700 print:text-black font-bold text-center bg-slate-50 print:bg-transparent">{job.coreType || '-'}</td>
                        <td className="p-1 print:hidden">{renderSelectField(job.id, 'condition', ['Repairable', 'Scrap'], 'min-w-[70px]')}</td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
              
              {scrapNote && (
                <div className="p-4 text-xs font-bold text-slate-800 print:text-black uppercase tracking-widest border-t border-slate-200">
                  {scrapNote}
                </div>
              )}
              
              <div className="p-6 bg-slate-50 print:bg-transparent border-t border-slate-200 flex justify-end print:hidden">
                <button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="px-8 py-3 text-sm font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center shadow-sm"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  <Save className="w-4 h-4 mr-2" /> Save All {mrJobs.length} Inspections
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
