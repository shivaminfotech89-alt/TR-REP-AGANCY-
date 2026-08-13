
import React, { useState, useEffect, useMemo } from 'react';
import { useAgency } from '../lib/AgencyContext';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { Wrench, Search, Loader2, ArrowLeft, Save, Download, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';

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
          where('agencyId', '==', activeAgency.id),
          where('repairType', '==', 'OGP')
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
    const wsData = [
      ['MR Number', selectedMrNo],
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
    window.print();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !selectedMrNo) return;
    
    setIsSubmitting(true);
    try {
      const now = Date.now();
      const batch = writeBatch(db);
      
      for (const job of mrJobs) {
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
        where('agencyId', '==', activeAgency?.id),
        where('repairType', '==', 'OGP')
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
      return jobsForMr.some(j => !inspections.some(i => i.jobId === j.id) && (j.status === 'External Done' || j.status === 'Received'));
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
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase print:text-black tracking-widest">MR Number</th>
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase print:text-black tracking-widest">Total Jobs</th>
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase print:text-black tracking-widest">Job Nos</th>
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase print:text-black tracking-widest">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {filteredMrNos.map(mr => (
                    <tr key={mr} className="hover:bg-slate-50 print:bg-transparent transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap font-mono font-bold text-slate-900 print:text-black">{mr}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-500">{mrGroups[mr].length} Jobs</td>
                      <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate" title={mrGroups[mr].map(j => j.jobNo).join(', ')}>
                        {mrGroups[mr].map(j => j.jobNo).join(', ')}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button 
                          onClick={() => handleSelectMr(mr)}
                          className="flex items-center px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition-colors"
                        >
                          {statusFilter === 'Pending' ? 'Inspect MR' : 'Edit MR'} <ArrowLeft className="w-3 h-3 ml-1 rotate-180" />
                        </button>
                      </td>
                    </tr>
                  ))}
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
              <p className="text-xl font-mono font-bold">{selectedMrNo}</p>
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

          <div className="bg-white rounded shadow-sm border border-slate-200 overflow-x-auto print:border-none print:shadow-none print:overflow-visible">
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
