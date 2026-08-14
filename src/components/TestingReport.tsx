
import { useAgency } from '../lib/AgencyContext';
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, doc, writeBatch } from 'firebase/firestore';
import { Loader2, ArrowLeft, Search, Activity, CheckSquare, Square, Save, Printer, Edit, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';

interface Job {
  id: string;
  jobNo: string;
  mrNo: string;
  capacityKva: number;
  make: string;
  repairType: string;
  status: string;
  division?: string;
  testingDetails?: TestingData;
  testingDate?: string;
}

interface TestingData {
  noLoadVoltage: string;
  excitationCurrent: string;
  noLoadLoss: string;
  fullLoadCurrent: string;
  impedanceVoltage: string;
  loadLoss: string;
  neutralCurrent: string;
  highVoltageTest: string;
  dvdfTest: string;
  insulationResistance: string;
  oilBdv: string;
  ratioTest: string;
  percentageImpedance: string;
  remarks: string;
}

const defaultTestingData: TestingData = {
  noLoadVoltage: '433 Volts',
  excitationCurrent: '',
  noLoadLoss: '',
  fullLoadCurrent: '',
  impedanceVoltage: '',
  loadLoss: '',
  neutralCurrent: '',
  highVoltageTest: 'Withstood for 60 Sec.',
  dvdfTest: 'Withstood for 60 Sec.',
  insulationResistance: 'More than 200 Mohm',
  oilBdv: '',
  ratioTest: 'Check & Found OK',
  percentageImpedance: '',
  remarks: ''
};

export default function TestingReport() {
  const { activeAgency } = useAgency();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [tab, setTab] = useState<'Pending' | 'Completed'>('Pending');
  const [divisionFilter, setDivisionFilter] = useState<string>('All');
  const [jobNoFilter, setJobNoFilter] = useState<string>('');
  
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  
  const [testingDate, setTestingDate] = useState(new Date().toISOString().split('T')[0]);
  const [formsData, setFormsData] = useState<Record<string, TestingData>>({});

  useEffect(() => {
    async function fetchJobs() {
      if (!auth.currentUser || !activeAgency) { setLoading(false); return; }
      try {
        const q = query(collection(db, 'jobs'), where('ownerId', '==', auth.currentUser.uid), where('agencyId', '==', activeAgency.id));
        const snapshot = await getDocs(q);
        const fetchedJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Job));
        setJobs(fetchedJobs);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'jobs');
      } finally {
        setLoading(false);
      }
    }
    fetchJobs();
  }, [activeAgency, isFormOpen]); // Refetch when returning from form

  const divisions = useMemo(() => {
    const divs = new Set(jobs.map(j => j.division || 'Unknown'));
    return ['All', ...Array.from(divs).sort()];
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    return jobs.filter(j => {
      if (tab === 'Pending' && j.status !== 'Internal Done') return false;
      if (tab === 'Completed' && (j.status === 'Received' || j.status === 'External Done' || j.status === 'Internal Done')) return false;
      
      if (divisionFilter !== 'All' && (j.division || 'Unknown') !== divisionFilter) return false;
      if (jobNoFilter && !j.jobNo.toLowerCase().includes(jobNoFilter.toLowerCase())) return false;
      return true;
    }).sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));
  }, [jobs, tab, divisionFilter, jobNoFilter]);

  const handleToggleJob = (id: string) => {
    const newSet = new Set(selectedJobIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedJobIds(newSet);
  };

  const handleToggleAll = () => {
    if (selectedJobIds.size === filteredJobs.length && filteredJobs.length > 0) {
      setSelectedJobIds(new Set());
    } else {
      setSelectedJobIds(new Set(filteredJobs.map(j => j.id)));
    }
  };

  const openForm = () => {
    if (selectedJobIds.size === 0) return;
    const initialForms: Record<string, TestingData> = {};
    Array.from<string>(selectedJobIds).forEach((id: string) => {
      const job = jobs.find(j => j.id === id);
      
      // Merge with default data to ensure new fields are populated if they didn't exist before
      initialForms[id] = { ...defaultTestingData, ...(job?.testingDetails || {}) };
    });
    setFormsData(initialForms);
    
    // Set default testing date to the first selected job if available
    const firstSelectedJob = jobs.find(j => j.id === Array.from<string>(selectedJobIds)[0]);
    if (firstSelectedJob?.testingDate) {
      setTestingDate(firstSelectedJob.testingDate);
    } else {
      setTestingDate(new Date().toISOString().split('T')[0]);
    }
    
    setIsFormOpen(true);
  };

  const openPrint = () => {
    if (selectedJobIds.size === 0) return;
    setIsPrintOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setSelectedJobIds(new Set());
  };
  
  const closePrint = () => {
    setIsPrintOpen(false);
    setSelectedJobIds(new Set());
  };

  const handleFieldChange = (jobId: string, field: keyof TestingData, value: string) => {
    setFormsData(prev => ({
      ...prev,
      [jobId]: { ...prev[jobId], [field]: value }
    }));
  };

  const applyToAll = (field: keyof TestingData) => {
    const firstJobId = Array.from<string>(selectedJobIds)[0];
    if (!firstJobId) return;
    const valueToCopy = formsData[firstJobId][field];
    
    setFormsData(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(id => {
        next[id] = { ...next[id], [field]: valueToCopy };
      });
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedJobIds.size === 0) {
      alert('Please select at least one job to submit testing report.');
      return;
    }

    // Strict validation: Blank or incomplete testing forms are NOT acceptable
    const incompleteJobs: string[] = [];
    Array.from<string>(selectedJobIds).forEach((id: string) => {
      const targetJob = jobs.find(j => j.id === id);
      if (targetJob?.status === 'Dispatched' || targetJob?.isClosed === true) return;
      
      const data = formsData[id];
      if (!data) {
        incompleteJobs.push(`Job #${targetJob?.jobNo || id}: Testing form is completely blank`);
        return;
      }

      const missing: string[] = [];
      if (!data.excitationCurrent || data.excitationCurrent.trim() === '') missing.push('Excitation Current');
      if (!data.noLoadLoss || data.noLoadLoss.trim() === '') missing.push('No Load Loss');
      if (!data.fullLoadCurrent || data.fullLoadCurrent.trim() === '') missing.push('Full Load Current');
      if (!data.impedanceVoltage || data.impedanceVoltage.trim() === '') missing.push('Impedance Voltage');
      if (!data.loadLoss || data.loadLoss.trim() === '') missing.push('Load Loss');
      if (!data.neutralCurrent || data.neutralCurrent.trim() === '') missing.push('Neutral Current');
      if (!data.oilBdv || data.oilBdv.trim() === '') missing.push('Oil BDV');
      if (!data.ratioTest || data.ratioTest.trim() === '') missing.push('Ratio Test');
      if (!data.highVoltageTest || data.highVoltageTest.trim() === '') missing.push('High Voltage Test');
      if (!data.dvdfTest || data.dvdfTest.trim() === '') missing.push('DVDF Test');
      if (!data.insulationResistance || data.insulationResistance.trim() === '') missing.push('Insulation Resistance');

      if (missing.length > 0) {
        incompleteJobs.push(`Job #${targetJob?.jobNo || id}: Missing (${missing.join(', ')})`);
      }
    });

    if (incompleteJobs.length > 0) {
      alert(`⚠️ Blank or incomplete testing reports are NOT acceptable!\n\nPlease fill in all required test parameters for the selected transformers before saving:\n\n${incompleteJobs.join('\n')}`);
      return;
    }

    setLoading(true);
    try {
      const batch = writeBatch(db);
      Array.from<string>(selectedJobIds).forEach((id: string) => {
        const targetJob = jobs.find(j => j.id === id);
        if (targetJob?.status === 'Dispatched' || targetJob?.isClosed === true) return;
        const docRef = doc(db, 'jobs', id);
        batch.update(docRef, {
          testingDetails: formsData[id],
          testingDate,
          status: tab === 'Pending' ? 'Tested - Ready for Dispatch' : undefined // only update status if it was pending
        });
      });
      await batch.commit();
      alert('Testing reports saved successfully!');
      closeForm();
    } catch (err) {
      console.error(err);
      alert('Failed to save testing reports');
    } finally {
      setLoading(false);
    }
  };

  const handleExportExcel = () => {
    const jobsToExport = selectedJobIds.size > 0 
      ? jobs.filter(j => selectedJobIds.has(j.id))
      : filteredJobs;

    if (jobsToExport.length === 0) return;

    const wsData: any[][] = [];
    wsData.push(['TESTING REPORT - ' + (activeAgency?.name || 'IDEAL ENGINEERING CO.')]);
    wsData.push(['Date: ' + new Date().toLocaleDateString()]);
    wsData.push([]);

    wsData.push([
      'S.N.', 'Job No', 'MR No', 'KVA', 'Make', 'Repair Type',
      'No Load Volts', 'Excit Curr', 'No Load Loss', 'Full Load Curr',
      'Imp Volts', 'Load Loss', 'Neut Curr', 'HV Test', 'DVDF Test',
      'Insulation Res', 'Oil BDV', 'Ratio Test', '% Impedance', 'Remarks'
    ]);

    jobsToExport.forEach((job, idx) => {
      const data = job.testingDetails || defaultTestingData;
      wsData.push([
        idx + 1,
        job.jobNo,
        job.mrNo,
        job.capacityKva,
        job.make,
        job.repairType || '-',
        data.noLoadVoltage || '',
        data.excitationCurrent || '',
        data.noLoadLoss || '',
        data.fullLoadCurrent || '',
        data.impedanceVoltage || '',
        data.loadLoss || '',
        data.neutralCurrent || '',
        data.highVoltageTest || '',
        data.dvdfTest || '',
        data.insulationResistance || '',
        data.oilBdv || '',
        data.ratioTest || '',
        data.percentageImpedance || '',
        data.remarks || ''
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Testing Reports");
    XLSX.writeFile(wb, `Testing_Reports_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.');
  };

  if (loading && jobs.length === 0) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  if (isPrintOpen) {
    const selectedJobs = Array.from<string>(selectedJobIds).map(id => jobs.find(j => j.id === id)!).sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));
    const printDate = selectedJobs[0]?.testingDate ? formatDate(selectedJobs[0].testingDate) : formatDate(new Date().toISOString());

    return (
      <div className="bg-white min-h-screen print:bg-white text-black p-4 print:p-0">
        <style>
          {`
            @media print {
              @page { size: landscape; margin: 10mm; }
              body { font-family: sans-serif; -webkit-print-color-adjust: exact; }
              table { page-break-inside: auto; }
              tr { page-break-inside: avoid; page-break-after: auto; }
            }
          `}
        </style>
        
        <div className="print:hidden mb-4 flex justify-between items-center bg-slate-100 p-4 rounded border border-slate-300">
          <p className="text-sm font-bold">Print Preview Mode</p>
          <div className="flex space-x-2">
            <button onClick={() => window.print()} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center shadow-sm">
              <Printer className="w-4 h-4 mr-2" /> Print
            </button>
            <button onClick={closePrint} className="px-4 py-2 border border-slate-400 bg-white text-slate-700 rounded hover:bg-slate-50">
              Close
            </button>
          </div>
        </div>

        <div className="w-full">
          <table className="w-full border-collapse border border-black text-[9px] text-center">
            <thead>
              <tr>
                <th colSpan={14} className="border border-black p-2 text-left text-sm">
                  <div className="flex justify-between items-center">
                    <span>Testing of Repairer Distribution Transformer : {activeAgency?.name || 'IDEAL ENGINEERING CO.'}</span>
                    <span className="flex items-center space-x-2"><span>Date:</span> <span className="border-b border-black w-24 text-center inline-block">{printDate}</span></span>
                  </div>
                </th>
              </tr>
              <tr className="bg-slate-100 print:bg-transparent">
                <th rowSpan={2} className="border border-black p-1 w-8">Sr.No.</th>
                <th rowSpan={2} className="border border-black p-1">Name of<br/>Division</th>
                <th rowSpan={2} className="border border-black p-1 w-20">Job No.</th>
                <th rowSpan={2} className="border border-black p-1">Capacity<br/>(KVA)</th>
                <th rowSpan={2} className="border border-black p-1">OGP or<br/>RGP</th>
                <th colSpan={3} className="border border-black p-1">No Load Losses at rated Voltage</th>
                <th colSpan={4} className="border border-black p-1">Full Load Losses at rated Current at 100%<br/>Loading</th>
                <th rowSpan={2} className="border border-black p-1">Separate Source<br/>Voltage withstand Test<br/>(High Voltage) HV: 21<br/>KV/ LV : 3KV :<br/>Withstood for 60<br/>Second</th>
                <th rowSpan={2} className="border border-black p-1">DVDF</th>
                <th rowSpan={2} className="border border-black p-1">ISULATION<br/>RESISTANACE</th>
                <th rowSpan={2} className="border border-black p-1">OIL TEST<br/>BDV</th>
                <th rowSpan={2} className="border border-black p-1">RATIO TEST</th>
                <th rowSpan={2} className="border border-black p-1">%Impedanc<br/>e Voltage</th>
                <th rowSpan={2} className="border border-black p-1">Remark</th>
              </tr>
              <tr className="bg-slate-100 print:bg-transparent text-[8px]">
                <th className="border border-black p-1 font-normal">Apply Full Load<br/>Voltage to LV<br/>Side (Open HV)</th>
                <th className="border border-black p-1 font-normal">Excitation<br/>Current<br/>(Amp)</th>
                <th className="border border-black p-1 font-normal">No Load<br/>Losses( Watt)</th>
                <th className="border border-black p-1 font-normal">Apply Full<br/>Load Current<br/>to HV Side<br/>(Short LV)</th>
                <th className="border border-black p-1 font-normal">Impedenc<br/>e Voltage</th>
                <th className="border border-black p-1 font-normal">Load<br/>Losses at<br/>100%<br/>Loading</th>
                <th className="border border-black p-1 font-normal">Neutral<br/>Current</th>
              </tr>
            </thead>
            <tbody>
              {selectedJobs.map((job, idx) => {
                const data = job.testingDetails || defaultTestingData;
                return (
                  <tr key={job.id} className="border border-black h-8">
                    <td className="border border-black p-1 font-bold">{idx + 1}</td>
                    <td className="border border-black p-1 font-bold uppercase">{job.division || '-'}</td>
                    <td className="border border-black p-1 font-bold uppercase">{job.jobNo}</td>
                    <td className="border border-black p-1 font-bold">{job.capacityKva}</td>
                    <td className="border border-black p-1 font-bold uppercase">{job.repairType || 'GP'}</td>
                    
                    <td className="border border-black p-1">{data.noLoadVoltage || '433 Volts'}</td>
                    <td className="border border-black p-1 font-bold">{data.excitationCurrent}</td>
                    <td className="border border-black p-1 font-bold">{data.noLoadLoss}</td>
                    
                    <td className="border border-black p-1">{data.fullLoadCurrent}</td>
                    <td className="border border-black p-1">{data.impedanceVoltage}</td>
                    <td className="border border-black p-1 font-bold">{data.loadLoss}</td>
                    <td className="border border-black p-1">{data.neutralCurrent}</td>
                    
                    <td className="border border-black p-1">{data.highVoltageTest}</td>
                    <td className="border border-black p-1">{data.dvdfTest}</td>
                    <td className="border border-black p-1">{data.insulationResistance}</td>
                    <td className="border border-black p-1 font-bold">{data.oilBdv}</td>
                    <td className="border border-black p-1">{data.ratioTest}</td>
                    <td className="border border-black p-1">{data.percentageImpedance}</td>
                    <td className="border border-black p-1">{data.remarks}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-16 flex justify-between px-12 text-sm font-bold uppercase">
            <div>
              TESTING SUPERVISED WITNESS
            </div>
            <div className="text-center">
              <div>TESTED BY</div>
              <div className="mt-8 relative">
                 <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -z-10 opacity-20">
                     <div className="w-24 h-24 rounded-full border-4 border-blue-900 flex items-center justify-center rotate-[-15deg]">
                        <div className="text-[10px] text-blue-900 font-serif leading-tight">SEAL / STAMP</div>
                     </div>
                 </div>
                 Shri {auth.currentUser?.displayName || '_____________'} - {activeAgency?.name}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Link to="/" className="p-2 bg-white rounded-full shadow-sm hover:bg-slate-50 transition-colors border border-slate-200">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight flex items-center">
              <Activity className="w-6 h-6 mr-2 text-blue-600" /> Testing Reports
            </h1>
            <p className="text-sm text-slate-500">Record final testing parameters</p>
          </div>
        </div>
      </div>

      {!isFormOpen ? (
        <div className="bg-white rounded shadow-sm border border-slate-200 overflow-hidden">
          <div className="border-b border-slate-200 flex text-sm font-medium">
            <button
              onClick={() => { setTab('Pending'); setSelectedJobIds(new Set()); }}
              className={`flex-1 py-3 text-center transition-colors ${tab === 'Pending' ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              Pending Testing
            </button>
            <button
              onClick={() => { setTab('Completed'); setSelectedJobIds(new Set()); }}
              className={`flex-1 py-3 text-center transition-colors ${tab === 'Completed' ? 'bg-green-50 text-green-700 border-b-2 border-green-600' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              Completed Testing
            </button>
          </div>

          <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex gap-4 flex-1 w-full md:w-auto">
              <div className="relative flex-1 md:w-64 md:flex-none">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter by Job No..."
                  value={jobNoFilter}
                  onChange={(e) => setJobNoFilter(e.target.value)}
                  className="pl-9 pr-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 w-full bg-white"
                />
              </div>
              <select
                value={divisionFilter}
                onChange={(e) => setDivisionFilter(e.target.value)}
                className="px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                {divisions.map(div => (
                  <option key={div} value={div}>{div}</option>
                ))}
              </select>
            </div>
            
            {selectedJobIds.size > 0 && (
              <div className="flex space-x-2">
                <button
                  onClick={openForm}
                  className="px-4 py-2 bg-blue-600 text-white text-[10px] font-bold uppercase tracking-widest rounded hover:bg-blue-700 transition-colors shadow-sm flex items-center whitespace-nowrap"
                >
                  <Edit className="w-3 h-3 mr-2" />
                  {tab === 'Pending' ? 'Proceed with' : 'Edit'} {selectedJobIds.size} Job{selectedJobIds.size > 1 ? 's' : ''}
                </button>
                {tab === 'Completed' && (
                  <>
                    <button
                      onClick={openPrint}
                      className="px-4 py-2 bg-slate-800 text-white text-[10px] font-bold uppercase tracking-widest rounded hover:bg-slate-900 transition-colors shadow-sm flex items-center whitespace-nowrap"
                    >
                      <Printer className="w-3 h-3 mr-2" />
                      Print {selectedJobIds.size} Job{selectedJobIds.size > 1 ? 's' : ''}
                    </button>
                    <button
                      onClick={handleExportExcel}
                      className="px-4 py-2 bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-widest rounded hover:bg-emerald-700 transition-colors shadow-sm flex items-center whitespace-nowrap"
                    >
                      <FileSpreadsheet className="w-3 h-3 mr-2" />
                      Export Excel
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 border-b border-slate-200 w-12">
                    <button onClick={handleToggleAll} className="text-slate-400 hover:text-blue-600">
                      {selectedJobIds.size === filteredJobs.length && filteredJobs.length > 0 ? (
                        <CheckSquare className="w-5 h-5 text-blue-600" />
                      ) : (
                        <Square className="w-5 h-5" />
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Job No</th>
                  <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Division</th>
                  <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Capacity</th>
                  <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Make / MR</th>
                  {tab === 'Completed' && (
                    <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Tested On</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredJobs.map(job => (
                  <tr key={job.id} className={`hover:bg-slate-50 ${selectedJobIds.has(job.id) ? 'bg-blue-50/50' : ''}`}>
                    <td className="px-4 py-3">
                      <button onClick={() => handleToggleJob(job.id)} className="text-slate-400 hover:text-blue-600">
                        {selectedJobIds.has(job.id) ? (
                          <CheckSquare className="w-5 h-5 text-blue-600" />
                        ) : (
                          <Square className="w-5 h-5" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-900">{job.jobNo}</td>
                    <td className="px-4 py-3 text-slate-600">{job.division || '-'}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold uppercase tracking-widest rounded">{job.capacityKva} KVA</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      <div>{job.make}</div>
                      <div className="text-xs">MR: {job.mrNo}</div>
                    </td>
                    {tab === 'Completed' && (
                      <td className="px-4 py-3 text-slate-600 font-mono text-xs">
                        {job.testingDate ? formatDate(job.testingDate) : '-'}
                      </td>
                    )}
                  </tr>
                ))}
                {filteredJobs.length === 0 && (
                  <tr>
                    <td colSpan={tab === 'Completed' ? 6 : 5} className="px-4 py-12 text-center text-slate-500 bg-slate-50/50">
                      <Activity className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                      <p>No jobs found for the selected filters.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-white">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Bulk Testing Entry</p>
              <p className="text-lg font-mono font-bold">{selectedJobIds.size} Job{selectedJobIds.size > 1 ? 's' : ''} Selected</p>
            </div>
            <div className="flex items-center space-x-4 w-full md:w-auto">
              <div className="flex-1 md:flex-none">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Testing Date</label>
                <input 
                  type="date" 
                  required
                  value={testingDate}
                  onChange={(e) => setTestingDate(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-700 bg-slate-800 text-white rounded focus:ring-1 focus:ring-blue-500" 
                />
              </div>
              <button 
                onClick={closeForm}
                className="mt-4 md:mt-0 text-[10px] font-bold uppercase tracking-widest text-blue-400 hover:text-blue-300 border border-blue-400/30 px-3 py-1.5 rounded transition-colors whitespace-nowrap"
              >
                Back to List
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-amber-50 border-l-4 border-amber-500 p-3 rounded text-amber-900 text-xs flex items-center gap-2 shadow-sm">
              <span className="font-bold text-sm">⚠️ Mandatory Rule:</span>
              <span>Blank testing reports are <strong>NOT acceptable</strong>. You must fill Excitation Current, No Load Loss, Full Load Current, Load Loss, BDV, and all test parameters before saving.</span>
            </div>

            <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs p-3 rounded flex items-center shadow-sm">
              <span className="font-bold mr-2">Tip:</span> Fill in the first job's details completely. You can double-click any field label in the first row to apply that value to all jobs below.
            </div>

            {Array.from<string>(selectedJobIds).map((jobId, index) => {
              const job = jobs.find(j => j.id === jobId)!;
              const data = formsData[jobId] || defaultTestingData;
              const isFirst = index === 0;

              const Label = ({ title, field }: { title: string, field: keyof TestingData }) => (
                <label 
                  onDoubleClick={() => isFirst && applyToAll(field)}
                  className={`block text-[10px] font-bold uppercase tracking-widest mb-1 ${isFirst ? 'text-blue-600 cursor-pointer select-none hover:text-blue-800' : 'text-slate-500'}`}
                  title={isFirst ? "Double-click to apply this value to all jobs" : ""}
                >
                  {title} {isFirst && '*'}
                </label>
              );

              return (
                <div key={jobId} className="bg-white p-5 rounded shadow-sm border border-slate-200">
                  <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
                    <h3 className="font-mono font-bold text-slate-900 text-lg">{job.jobNo}</h3>
                    <div className="text-right">
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold uppercase tracking-widest rounded mr-2">{job.capacityKva} KVA</span>
                      <span className="text-xs text-slate-500">{job.make}</span>
                    </div>
                  </div>

                  <div className="space-y-5">
                    {/* No Load row */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border border-slate-200 p-3 rounded bg-slate-50">
                      <div className="col-span-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-200 pb-2 mb-1">
                        No Load Losses at rated Voltage
                      </div>
                      <div>
                        <Label title="Apply Full Load Voltage to LV Side" field="noLoadVoltage" />
                        <input type="text" value={data.noLoadVoltage} onChange={e => handleFieldChange(jobId, 'noLoadVoltage', e.target.value)} className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="e.g. 433 Volts" />
                      </div>
                      <div>
                        <Label title="Excitation Current (Amp)" field="excitationCurrent" />
                        <input type="text" value={data.excitationCurrent} onChange={e => handleFieldChange(jobId, 'excitationCurrent', e.target.value)} className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="e.g. 0.500" />
                      </div>
                      <div>
                        <Label title="No Load Losses (Watt)" field="noLoadLoss" />
                        <input type="number" step="any" value={data.noLoadLoss} onChange={e => handleFieldChange(jobId, 'noLoadLoss', e.target.value)} className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" />
                      </div>
                    </div>

                    {/* Full Load row */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 border border-slate-200 p-3 rounded bg-slate-50">
                       <div className="col-span-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-200 pb-2 mb-1">
                        Full Load Losses at rated Current at 100% Loading
                      </div>
                      <div>
                        <Label title="Apply Full Load Current to HV Side" field="fullLoadCurrent" />
                        <input type="text" value={data.fullLoadCurrent} onChange={e => handleFieldChange(jobId, 'fullLoadCurrent', e.target.value)} className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="e.g. 0.5" />
                      </div>
                      <div>
                        <Label title="Impedance Voltage" field="impedanceVoltage" />
                        <input type="text" value={data.impedanceVoltage} onChange={e => handleFieldChange(jobId, 'impedanceVoltage', e.target.value)} className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="e.g. 454" />
                      </div>
                      <div>
                        <Label title="Load Losses at 100% Loading" field="loadLoss" />
                        <input type="number" step="any" value={data.loadLoss} onChange={e => handleFieldChange(jobId, 'loadLoss', e.target.value)} className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" />
                      </div>
                      <div>
                        <Label title="Neutral Current" field="neutralCurrent" />
                        <input type="text" value={data.neutralCurrent} onChange={e => handleFieldChange(jobId, 'neutralCurrent', e.target.value)} className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="e.g. 0.10" />
                      </div>
                    </div>

                    {/* Other tests */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 border border-slate-200 p-3 rounded bg-slate-50">
                      <div className="col-span-3 md:col-span-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-200 pb-2 mb-1">
                        Other Tests
                      </div>
                      <div>
                        <Label title="Separate Source Withstand (HV)" field="highVoltageTest" />
                        <input type="text" value={data.highVoltageTest} onChange={e => handleFieldChange(jobId, 'highVoltageTest', e.target.value)} className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="e.g. Withstood for 60 Sec." />
                      </div>
                      <div>
                        <Label title="DVDF" field="dvdfTest" />
                        <input type="text" value={data.dvdfTest} onChange={e => handleFieldChange(jobId, 'dvdfTest', e.target.value)} className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="e.g. Withstood for 60 Sec." />
                      </div>
                      <div>
                        <Label title="Insulation Resistance" field="insulationResistance" />
                        <input type="text" value={data.insulationResistance} onChange={e => handleFieldChange(jobId, 'insulationResistance', e.target.value)} className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="e.g. More than 200 Mohm" />
                      </div>
                      <div>
                        <Label title="Oil Test BDV" field="oilBdv" />
                        <input type="text" value={data.oilBdv} onChange={e => handleFieldChange(jobId, 'oilBdv', e.target.value)} className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="e.g. 52" />
                      </div>
                      <div>
                        <Label title="Ratio Test" field="ratioTest" />
                        <input type="text" value={data.ratioTest} onChange={e => handleFieldChange(jobId, 'ratioTest', e.target.value)} className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="e.g. Check & Found OK" />
                      </div>
                      <div>
                        <Label title="% Impedance Voltage" field="percentageImpedance" />
                        <input type="text" value={data.percentageImpedance} onChange={e => handleFieldChange(jobId, 'percentageImpedance', e.target.value)} className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="e.g. 4.13" />
                      </div>
                      <div className="col-span-2 md:col-span-3">
                        <Label title="Remarks" field="remarks" />
                        <input type="text" value={data.remarks} onChange={e => handleFieldChange(jobId, 'remarks', e.target.value)} className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="pt-4 flex justify-end sticky bottom-6 z-10">
              <button
                type="submit"
                disabled={loading}
                className="px-8 py-3 text-xs font-bold uppercase tracking-widest bg-blue-600 text-white rounded shadow-lg hover:bg-blue-700 hover:shadow-xl transition-all flex items-center"
              >
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save {selectedJobIds.size} Testing Report{selectedJobIds.size > 1 ? 's' : ''}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
