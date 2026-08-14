
import React, { useState, useEffect, useMemo } from 'react';
import { useAgency } from '../lib/AgencyContext';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { ClipboardCheck, Loader2, ArrowLeft, Search, Save, Filter, Download, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';

export interface ExternalData {
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
  inspectionId?: string; // added to track existing inspection ID
}

export default function ExternalInspection() {
  const { activeAgency } = useAgency();
  const [jobs, setJobs] = useState<any[]>([]);
  const [inspections, setInspections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedMrNo, setSelectedMrNo] = useState<string | null>(null);
  const [formsData, setFormsData] = useState<Record<string, ExternalData>>({});
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
          where('agencyId', '==', activeAgency.id)
        );
        const [jobsSnap, inspSnap] = await Promise.all([
          getDocs(jobsQ),
          getDocs(query(
            collection(db, 'inspections'),
            where('ownerId', '==', auth.currentUser.uid),
            where('type', '==', 'External')
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
    
    // Sort by Job No conceptually
    jobsForMr.sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));

    const initialForms: Record<string, ExternalData> = {};
    jobsForMr.forEach(j => {
      const existingInsp = allInspections.find(i => i.jobId === j.id);
      
      if (existingInsp && existingInsp.data) {
        initialForms[j.id] = {
          kv: existingInsp.data.kv || '11',
          oilCapLtrs: (existingInsp.data.oilCapLtrs || 0).toString(),
          lessOilLtrs: (existingInsp.data.lessOilLtrs || 0).toString(),
          sealType: existingInsp.data.sealType || 'BL',
          gasket: existingInsp.data.gasket || '1',
          hvLvRod: existingInsp.data.hvLvRod || '7',
          nuteBolt: existingInsp.data.nuteBolt || 'Y',
          dryActPart: existingInsp.data.dryActPart || 'Y',
          clnDrtyTank: existingInsp.data.clnDrtyTank || 'Y',
          breather: existingInsp.data.breather || 'Y',
          oilLevGls: existingInsp.data.oilLevGls || 'Y',
          outsidePaint: existingInsp.data.outsidePaint || 'Y',
          namePlate: existingInsp.data.namePlate || '-',
          damCtTank: (existingInsp.data.damCtTank || '0').toString(),
          damRadNo: (existingInsp.data.damRadNo || '0').toString(),
          hvSideHvb: existingInsp.data.hvSideHvb || '3',
          hvSideHvm: existingInsp.data.hvSideHvm || '3',
          hvSideHvCc: existingInsp.data.hvSideHvCc || '3',
          lvSideLvb: existingInsp.data.lvSideLvb || '4',
          lvSideLvm: existingInsp.data.lvSideLvm || '4',
          lvSideLvCc: existingInsp.data.lvSideLvCc || '4',
          transType: existingInsp.data.transType || 'C',
          inspectionId: existingInsp.id
        };
      } else {
        initialForms[j.id] = {
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
          transType: 'C'
        };
      }
    });

    setFormsData(initialForms);
    setSelectedMrNo(mrNo);
  };

  const handleChange = (jobId: string, field: keyof ExternalData, value: string) => {
    setFormsData(prev => ({
      ...prev,
      [jobId]: {
        ...prev[jobId],
        [field]: value
      }
    }));
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
        '#', 'JOB NO', 'KVA', 'MAKE', 'S.No.', 'KV', 'OIL CAP LTRS', 'LESS OIL LTRS', 'SEAL TYPE', 'GASKET', 'H.V.L.V ROD', 'NUTE/BOLT', 'DRY ACT. PART', 'CLN DRTY TANK', 'BREATHER', 'OIL LEV. GLS', 'OUTSIDE PAINT', 'NAME PLATE', 'DAM. CT. TANK', 'DAM. RAD. NO', 'H.V.B', 'H.V.M', 'H.V.C.C', 'L.V.B', 'L.V.M', 'L.V.C.C', 'TRANS. TYPE'
      ]
    ];
    
    mrJobs.forEach((job, index) => {
      const data = formsData[job.id] || {} as ExternalData;
      wsData.push([
        index + 1,
        job.jobNo,
        job.capacityKva,
        job.make,
        job.serialNo,
        data.kv || '',
        data.oilCapLtrs || '',
        data.lessOilLtrs || '',
        data.sealType || '',
        data.gasket || '',
        data.hvLvRod || '',
        data.nuteBolt || '',
        data.dryActPart || '',
        data.clnDrtyTank || '',
        data.breather || '',
        data.oilLevGls || '',
        data.outsidePaint || '',
        data.namePlate || '',
        data.damCtTank || '',
        data.damRadNo || '',
        data.hvSideHvb || '',
        data.hvSideHvm || '',
        data.hvSideHvCc || '',
        data.lvSideLvb || '',
        data.lvSideLvm || '',
        data.lvSideLvCc || '',
        data.transType || ''
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "External Inspection");
    XLSX.writeFile(wb, `External_Inspection_${selectedMrNo}.xlsx`);
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
          type: 'External',
          data: {
            kv: jobData.kv,
            oilCapLtrs: Number(jobData.oilCapLtrs) || 0,
            lessOilLtrs: Number(jobData.lessOilLtrs) || 0,
            oilAvailable: (Number(jobData.oilCapLtrs) || 0) - (Number(jobData.lessOilLtrs) || 0),
            netShortage: (((Number(jobData.oilCapLtrs) || 0) - (Number(jobData.lessOilLtrs) || 0)) * 0.05) + (Number(jobData.lessOilLtrs) || 0),
            sealType: jobData.sealType,
            gasket: jobData.gasket,
            hvLvRod: jobData.hvLvRod,
            nuteBolt: jobData.nuteBolt,
            dryActPart: jobData.dryActPart,
            clnDrtyTank: jobData.clnDrtyTank,
            breather: jobData.breather,
            oilLevGls: jobData.oilLevGls,
            outsidePaint: jobData.outsidePaint,
            namePlate: jobData.namePlate,
            damCtTank: Number(jobData.damCtTank) || 0,
            damRadNo: Number(jobData.damRadNo) || 0,
            hvSideHvb: jobData.hvSideHvb,
            hvSideHvm: jobData.hvSideHvm,
            hvSideHvCc: jobData.hvSideHvCc,
            lvSideLvb: jobData.lvSideLvb,
            lvSideLvm: jobData.lvSideLvm,
            lvSideLvCc: jobData.lvSideLvCc,
            transType: jobData.transType
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
        // Only set to 'External Done' if it was previously 'Received' or still needs to advance
        if (job.status === 'Received') {
          batch.update(jobRef, {
            status: 'External Done',
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
          where('type', '==', 'External')
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

  // Group OGP jobs by MR No for the selection list
  const mrGroups: Record<string, any[]> = {};
  jobs.forEach(j => {
    if (divisionFilter !== 'All' && j.division !== divisionFilter) return;
    if (!mrGroups[j.mrNo]) mrGroups[j.mrNo] = [];
    mrGroups[j.mrNo].push(j);
  });
  
  const availableDivisions = Array.from(new Set(jobs.map(j => j.division).filter(Boolean))).sort();
  
  // Filter MRs by Pending/Completed based on job statuses
  const uniqueMrNos = Object.keys(mrGroups).filter(mr => {
    const jobsForMr = mrGroups[mr];
    if (statusFilter === 'Pending') {
      return jobsForMr.some(j => !j.status || j.status === 'Received');
    } else {
      // Completed if ALL jobs (or at least some) are past 'Received'. Let's say if it has External Done or beyond
      return jobsForMr.some(j => j.status !== 'Received' && j.status !== 'Pending');
    }
  }).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const filteredMrNos = uniqueMrNos.filter(mr => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return mr.toLowerCase().includes(q) || mrGroups[mr].some(j => j.jobNo.toLowerCase().includes(q));
  });

  const renderInputField = (jobId: string, field: keyof ExternalData, type = 'text', widthClass = 'w-full') => (
    <input
      type={type}
      value={formsData[jobId]?.[field] || ''}
      onChange={(e) => handleChange(jobId, field, e.target.value)}
      className={`px-2 py-1 text-[10px] border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm print:border-0 print:shadow-none print:p-0 print:bg-transparent print:appearance-none print:text-black print:text-center ${widthClass}`}
      step={type === 'number' ? '0.01' : undefined}
    />
  );

  const renderSelectField = (jobId: string, field: keyof ExternalData, options: string[], widthClass = 'w-full') => (
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

  return (
    <div className="space-y-6 print:space-y-0">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded shadow-sm border border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-900 print:text-black flex items-center">
            <ClipboardCheck className="w-6 h-6 mr-3 text-blue-600" />
            External Inspection
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Fill external inspection parameters for OGP repair jobs.
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
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest sticky left-0 z-10 w-8">#</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest sticky left-8 z-10 min-w-[100px]">JOB NO</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest min-w-[60px]">MAKE</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest min-w-[40px]">KVA</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest min-w-[40px]">KV</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest">OIL<br/>CAP</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest">LESS<br/>OIL</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest">SL/<br/>BL</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest">GA<br/>SK</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest">HV<br/>LV</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest">Nute<br/>Bolt</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest">Dry<br/>Act</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest">Cln<br/>Tank</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest">BR<br/>ETH</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest">OIL<br/>LEV</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest">OUT<br/>PAINT</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest">NAME<br/>PLT</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest">DAM<br/>CT</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest">DAM<br/>RAD</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest text-center" colSpan={3}>HV SIDE (B/M/CC)</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest text-center" colSpan={3}>LV SIDE (B/M/CC)</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest">TRANS<br/>TYPE</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest print:hidden">OIL<br/>AVL</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 print:bg-transparent text-[9px] font-bold text-slate-500 uppercase print:text-black tracking-widest print:hidden">NET<br/>SHRT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {mrJobs.map((job, index) => {
                      const oilCap = Number(formsData[job.id]?.oilCapLtrs) || 0;
                      const lessOil = Number(formsData[job.id]?.lessOilLtrs) || 0;
                      const oilAvl = oilCap - lessOil;
                      const netShrt = (oilAvl * 0.05) + lessOil;

                      return (
                      <tr key={job.id} className="hover:bg-slate-50 print:bg-transparent group">
                        <td className="p-1 text-xs font-mono text-slate-500 sticky left-0 bg-white group-hover:bg-slate-50 print:bg-transparent border-r border-slate-100 z-10">{index + 1}</td>
                        <td className="p-1 text-xs font-mono font-bold text-slate-900 print:text-black sticky left-8 bg-white group-hover:bg-slate-50 print:bg-transparent border-r border-slate-100 min-w-[100px] z-10">{job.jobNo}</td>
                        <td className="p-1 text-[10px] text-slate-700 print:text-black min-w-[60px] truncate max-w-[80px]" title={job.make}>{job.make}</td>
                        <td className="p-1 text-[10px] text-slate-700 print:text-black font-mono">{job.capacityKva}</td>
                        
                        <td className="p-1">{renderInputField(job.id, 'kv', 'text', 'min-w-[48px]')}</td>
                        <td className="p-1">{renderInputField(job.id, 'oilCapLtrs', 'number', 'min-w-[64px]')}</td>
                        <td className="p-1">{renderInputField(job.id, 'lessOilLtrs', 'number', 'min-w-[64px]')}</td>
                        <td className="p-1">{renderSelectField(job.id, 'sealType', ['BL', 'SL'])}</td>
                        <td className="p-1">{renderInputField(job.id, 'gasket', 'text', 'min-w-[48px]')}</td>
                        <td className="p-1">{renderInputField(job.id, 'hvLvRod', 'text', 'min-w-[48px]')}</td>
                        <td className="p-1">{renderInputField(job.id, 'nuteBolt', 'text', 'min-w-[48px]')}</td>
                        <td className="p-1">{renderInputField(job.id, 'dryActPart', 'text', 'min-w-[48px]')}</td>
                        <td className="p-1">{renderSelectField(job.id, 'clnDrtyTank', ['Y', 'N', '-', 'TBR'])}</td>
                        <td className="p-1">{renderSelectField(job.id, 'breather', ['Y', 'N', '-', 'TBR'])}</td>
                        <td className="p-1">{renderSelectField(job.id, 'oilLevGls', ['Y', 'N', '-', 'TBR'])}</td>
                        <td className="p-1">{renderSelectField(job.id, 'outsidePaint', ['Y', 'N', '-', 'TBR'])}</td>
                        <td className="p-1">{renderSelectField(job.id, 'namePlate', ['-', 'Y', 'N', 'TBR'])}</td>
                        <td className="p-1">{renderInputField(job.id, 'damCtTank', 'text', 'min-w-[64px]')}</td>
                        <td className="p-1">{renderInputField(job.id, 'damRadNo', 'number', 'min-w-[48px]')}</td>
                        
                        <td className="p-0.5">{renderInputField(job.id, 'hvSideHvb', 'text', 'min-w-[48px]')}</td>
                        <td className="p-0.5">{renderInputField(job.id, 'hvSideHvm', 'text', 'min-w-[48px]')}</td>
                        <td className="p-0.5 border-r border-slate-100">{renderInputField(job.id, 'hvSideHvCc', 'text', 'min-w-[48px]')}</td>
                        
                        <td className="p-0.5">{renderInputField(job.id, 'lvSideLvb', 'text', 'min-w-[48px]')}</td>
                        <td className="p-0.5">{renderInputField(job.id, 'lvSideLvm', 'text', 'min-w-[48px]')}</td>
                        <td className="p-0.5 border-r border-slate-100">{renderInputField(job.id, 'lvSideLvCc', 'text', 'min-w-[48px]')}</td>
                        
                        <td className="p-1">{renderInputField(job.id, 'transType', 'text', 'min-w-[64px]')}</td>
                        
                        <td className="p-1 text-[10px] font-mono text-slate-700 print:text-black bg-slate-50 print:bg-transparent/50 text-center print:hidden">{oilAvl >= 0 ? oilAvl.toFixed(1) : '-'}</td>
                        <td className="p-1 text-[10px] font-mono font-bold text-amber-600 bg-amber-50/30 text-center print:hidden">{netShrt >= 0 ? netShrt.toFixed(1) : '-'}</td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
              
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
