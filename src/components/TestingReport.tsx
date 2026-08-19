
import { useAgency } from '../lib/AgencyContext';
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, doc, writeBatch } from 'firebase/firestore';
import { Loader2, ArrowLeft, Search, Activity, CheckSquare, Square, Save, Printer, Edit, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { formatDDMMYYYY } from '../lib/utils';
import { triggerUniversalPrint } from '../lib/printUtils';
import { PrintableA4Page } from './LetterheadHeader';
import { isMrReadyForTesting } from '../lib/inspectionStage';

interface Job {
  id: string;
  jobNo: string;
  serialNo?: string;
  mrNo: string;
  dateOfIssue?: string;
  mrDate?: string;
  createdAt?: string;
  capacityKva: number;
  make: string;
  repairType: string;
  status: string;
  division?: string;
  externalInspectionDate?: string;
  internalInspectionDate?: string;
  starRating?: number;
  ratingLevel?: string;
  testingDetails?: TestingData;
  testingDate?: string;
  isClosed?: boolean;
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
  const [inspections, setInspections] = useState<any[]>([]);
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
        const [snapshot, extInspSnap, intInspSnap] = await Promise.all([
          getDocs(q),
          getDocs(query(collection(db, 'inspections'), where('ownerId', '==', auth.currentUser.uid), where('type', '==', 'External'))),
          getDocs(query(collection(db, 'inspections'), where('ownerId', '==', auth.currentUser.uid), where('type', '==', 'Internal'))),
        ]);
        const fetchedJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Job));
        setJobs(fetchedJobs);
        setInspections([
          ...extInspSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          ...intInspSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        ]);
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

  // Jobs grouped by MR, so testing visibility can be gated on the whole MR's
  // external+internal readiness, not just this one job's own status.
  const mrGroups = useMemo(() => {
    const groups: Record<string, Job[]> = {};
    jobs.forEach(j => {
      if (!groups[j.mrNo]) groups[j.mrNo] = [];
      groups[j.mrNo].push(j);
    });
    return groups;
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    return jobs.filter(j => {
      const jobsForMr = mrGroups[j.mrNo] || [j];
      if (!isMrReadyForTesting(jobsForMr, inspections)) return false;

      if (tab === 'Pending' && j.status !== 'Internal Done') return false;
      if (tab === 'Completed' && (j.status === 'Received' || j.status === 'External Done' || j.status === 'Internal Done')) return false;

      if (divisionFilter !== 'All' && (j.division || 'Unknown') !== divisionFilter) return false;
      if (jobNoFilter && !j.jobNo.toLowerCase().includes(jobNoFilter.toLowerCase())) return false;
      return true;
    }).sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));
  }, [jobs, mrGroups, inspections, tab, divisionFilter, jobNoFilter]);

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
    wsData.push(['Export Date: ' + new Date().toLocaleDateString()]);
    wsData.push([]);

    wsData.push([
      'S.N.', 'Job No', 'Trans S.No', 'MR No', 'MR Date', 'Division', 'KVA', 'Make', 'Repair Type',
      'Ext. Insp Date', 'Int. Insp Date', 'Testing Date',
      'No Load Volts', 'Excit Curr', 'No Load Loss', 'Full Load Curr',
      'Imp Volts', 'Load Loss', 'Neut Curr', 'HV Test', 'DVDF Test',
      'Insulation Res', 'Oil BDV', 'Ratio Test', '% Impedance', 'Remarks'
    ]);

    jobsToExport.forEach((job, idx) => {
      const data = job.testingDetails || defaultTestingData;
      const mrDateStr = formatDDMMYYYY(job.dateOfIssue || job.mrDate || job.createdAt);
      const extDateStr = job.externalInspectionDate ? formatDDMMYYYY(job.externalInspectionDate) : '-';
      const intDateStr = job.internalInspectionDate ? formatDDMMYYYY(job.internalInspectionDate) : '-';
      const testDateStr = job.testingDate ? formatDDMMYYYY(job.testingDate) : '-';

      wsData.push([
        idx + 1,
        job.jobNo,
        job.serialNo || '-',
        job.mrNo,
        mrDateStr,
        job.division || '-',
        job.capacityKva,
        job.make,
        job.repairType || '-',
        extDateStr,
        intDateStr,
        testDateStr,
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

    // Chunk jobs for clean landscape A4 pagination (8 jobs per page)
    const CHUNK_SIZE = 8;
    const jobChunks: typeof selectedJobs[] = [];
    for (let i = 0; i < selectedJobs.length; i += CHUNK_SIZE) {
      jobChunks.push(selectedJobs.slice(i, i + CHUNK_SIZE));
    }
    if (jobChunks.length === 0) jobChunks.push([]);

    return (
      <div className="bg-slate-100 min-h-screen text-black p-4 print:p-0 print:bg-white">
        <div className="print:hidden max-w-[297mm] mx-auto mb-4 flex justify-between items-center bg-white p-4 rounded-xl shadow-md border border-slate-200">
          <div>
            <p className="text-sm font-bold text-slate-800">Testing Report Print Preview</p>
            <p className="text-xs text-slate-500">
              {selectedJobs.length} Transformers • {jobChunks.length} Landscape A4 Page{jobChunks.length > 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => triggerUniversalPrint('printable-testing-sheet', `Testing Report - ${printDate}`, `Testing_Report_${printDate}.pdf`, 'landscape')} 
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg flex items-center shadow-sm font-bold text-xs cursor-pointer transition-colors"
              title="Print document on Landscape A4 / Letterhead"
            >
              <Printer className="w-4 h-4 mr-2" /> Print (Landscape)
            </button>
            <button
              onClick={closePrint}
              className="px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg font-bold text-xs cursor-pointer transition-colors"
            >
              Close Preview
            </button>
          </div>
        </div>

        <div id="printable-testing-sheet" className="p-0 bg-transparent flex flex-col items-center">
          {jobChunks.map((chunk, pageIdx) => {
            const isLastPage = pageIdx === jobChunks.length - 1;
            return (
              <PrintableA4Page
                key={pageIdx}
                agency={activeAgency}
                orientation="landscape"
                documentTitle="DISTRIBUTION TRANSFORMER ROUTINE TESTING REPORT"
                subtitle={jobChunks.length > 1 ? `Sheet ${pageIdx + 1} of ${jobChunks.length}` : undefined}
                className={pageIdx > 0 ? 'print-page-break-before mb-6' : 'mb-6'}
              >
                <div className="flex flex-col justify-between h-full">
                  <div>
                    <div className="flex justify-between items-center text-[10px] font-bold border-b border-black pb-1 mb-1.5">
                      <span>REPAIRER: <strong className="font-serif uppercase">{activeAgency?.name || 'IDEAL ENGINEERING CO.'}</strong></span>
                      <span>TESTING DATE: <strong className="font-mono">{printDate}</strong></span>
                      <span>TOTAL TRANSFORMERS: <strong>{selectedJobs.length}</strong></span>
                    </div>

                    <table className="w-full border-collapse border border-black text-[8px] text-center">
                      <thead>
                        <tr className="bg-slate-100 print:bg-transparent">
                          <th rowSpan={2} className="border border-black p-0.5 w-5">Sr.</th>
                          <th rowSpan={2} className="border border-black p-0.5 w-14">Division</th>
                          <th rowSpan={2} className="border border-black p-0.5 min-w-[65px]">Job No & S.No</th>
                          <th rowSpan={2} className="border border-black p-0.5 min-w-[60px]">MR No & Date</th>
                          <th rowSpan={2} className="border border-black p-0.5 w-9">KVA</th>
                          <th rowSpan={2} className="border border-black p-0.5 w-9">Type</th>
                          <th rowSpan={2} className="border border-black p-0.5 min-w-[55px]">Insp. Dates (Ext/Int)</th>
                          <th colSpan={3} className="border border-black p-0.5">No Load Losses (Rated Volt)</th>
                          <th colSpan={4} className="border border-black p-0.5">Full Load Losses (100% Load)</th>
                          <th rowSpan={2} className="border border-black p-0.5 min-w-[60px]">HV/LV Withstand (HV:21KV/LV:3KV)</th>
                          <th rowSpan={2} className="border border-black p-0.5 w-9">DVDF</th>
                          <th rowSpan={2} className="border border-black p-0.5 w-11">IR Value</th>
                          <th rowSpan={2} className="border border-black p-0.5 w-9">Oil BDV</th>
                          <th rowSpan={2} className="border border-black p-0.5 w-9">Ratio</th>
                          <th rowSpan={2} className="border border-black p-0.5 w-9">%Imp</th>
                          <th rowSpan={2} className="border border-black p-0.5 min-w-[45px]">Remarks</th>
                        </tr>
                        <tr className="bg-slate-100 print:bg-transparent text-[7.5px]">
                          <th className="border border-black p-0.5 font-normal">LV Volts</th>
                          <th className="border border-black p-0.5 font-normal">Ex. Amp</th>
                          <th className="border border-black p-0.5 font-normal">Loss (W)</th>
                          <th className="border border-black p-0.5 font-normal">Full Amp</th>
                          <th className="border border-black p-0.5 font-normal">Imp. Volt</th>
                          <th className="border border-black p-0.5 font-normal">Loss (W)</th>
                          <th className="border border-black p-0.5 font-normal">Neut. A</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chunk.map((job, cIdx) => {
                          const globalIdx = pageIdx * CHUNK_SIZE + cIdx;
                          const data = job.testingDetails || defaultTestingData;
                          const mrDateStr = formatDDMMYYYY(job.dateOfIssue || job.mrDate || job.createdAt);
                          const extDateStr = job.externalInspectionDate ? formatDDMMYYYY(job.externalInspectionDate) : '-';
                          const intDateStr = job.internalInspectionDate ? formatDDMMYYYY(job.internalInspectionDate) : '-';
                          return (
                            <tr key={job.id} className="border border-black h-6.5">
                              <td className="border border-black p-0.5 font-bold">{globalIdx + 1}</td>
                              <td className="border border-black p-0.5 font-bold uppercase truncate max-w-[60px]">{job.division || '-'}</td>
                              <td className="border border-black p-0.5 font-bold uppercase text-left pl-1">
                                <div className="leading-tight">{job.jobNo}</div>
                                {job.serialNo && (
                                  <div className="text-[6.5px] font-mono font-medium text-slate-600 leading-tight">SN: {job.serialNo}</div>
                                )}
                              </td>
                              <td className="border border-black p-0.5 text-left pl-1">
                                <div className="text-[7.5px] font-mono font-bold leading-tight">{job.mrNo || '-'}</div>
                                <div className="text-[6.5px] font-mono text-slate-600 leading-tight">Dt: {mrDateStr}</div>
                              </td>
                              <td className="border border-black p-0.5 font-bold">{job.capacityKva}</td>
                              <td className="border border-black p-0.5 font-bold uppercase">{job.repairType || 'GP'}</td>
                              <td className="border border-black p-0.5 text-[7px] text-center font-mono leading-tight">
                                <div>E: {extDateStr}</div>
                                <div>I: {intDateStr}</div>
                              </td>
                              
                              <td className="border border-black p-0.5">{data.noLoadVoltage || '433V'}</td>
                              <td className="border border-black p-0.5 font-bold">{data.excitationCurrent}</td>
                              <td className="border border-black p-0.5 font-bold">{data.noLoadLoss}</td>
                              
                              <td className="border border-black p-0.5">{data.fullLoadCurrent}</td>
                              <td className="border border-black p-0.5">{data.impedanceVoltage}</td>
                              <td className="border border-black p-0.5 font-bold">{data.loadLoss}</td>
                              <td className="border border-black p-0.5">{data.neutralCurrent}</td>
                              
                              <td className="border border-black p-0.5 text-[7px]">{data.highVoltageTest || 'Passed (60s)'}</td>
                              <td className="border border-black p-0.5 text-[7.5px]">{data.dvdfTest || 'Passed'}</td>
                              <td className="border border-black p-0.5 text-[7.5px]">{data.insulationResistance}</td>
                              <td className="border border-black p-0.5 font-bold text-[7.5px]">{data.oilBdv}</td>
                              <td className="border border-black p-0.5 text-[7.5px]">{data.ratioTest}</td>
                              <td className="border border-black p-0.5 text-[7.5px]">{data.percentageImpedance}</td>
                              <td className="border border-black p-0.5 text-[7px] font-medium">{data.remarks || 'OK'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {isLastPage && (
                    <div className="mt-2 pt-2 border-t border-black flex justify-between items-end px-6 text-[9.5px] font-bold uppercase">
                      <div className="text-center">
                        <div className="h-8"></div>
                        <div className="border-t border-dotted border-black pt-0.5">TESTING SUPERVISED / WITNESSED</div>
                        <div className="text-[8px] text-slate-700 font-normal">Junior Engineer / AEE</div>
                      </div>
                      <div className="text-center">
                        <div className="h-8 flex items-center justify-center">
                          <div className="border border-dashed border-slate-400 px-2 py-0.5 rounded text-[7.5px] text-slate-500 font-normal">
                            OFFICIAL STAMP
                          </div>
                        </div>
                        <div className="border-t border-dotted border-black pt-0.5">TESTED BY & AUTHORIZED SIGNATORY</div>
                        <div className="text-[8px] text-slate-700 font-normal">{auth.currentUser?.displayName || 'Testing Engineer'} - {activeAgency?.name}</div>
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
              <thead className="bg-slate-100/70 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-3 w-10 text-center">
                    <button onClick={handleToggleAll} className="text-slate-400 hover:text-blue-600 cursor-pointer">
                      {selectedJobIds.size === filteredJobs.length && filteredJobs.length > 0 ? (
                        <CheckSquare className="w-4 h-4 text-blue-600" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th className="px-2 py-3 text-center font-bold text-slate-500 uppercase tracking-wider text-[10px] w-8">#</th>
                  <th className="px-3 py-3 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Job No & S.No</th>
                  <th className="px-3 py-3 font-bold text-slate-500 uppercase tracking-wider text-[10px]">MR No & Date</th>
                  <th className="px-3 py-3 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Division</th>
                  <th className="px-3 py-3 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Capacity</th>
                  <th className="px-3 py-3 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Make / Type</th>
                  <th className="px-3 py-3 font-bold text-slate-500 uppercase tracking-wider text-[10px] text-center">Ext. Insp.</th>
                  <th className="px-3 py-3 font-bold text-slate-500 uppercase tracking-wider text-[10px] text-center">Int. Insp.</th>
                  {tab === 'Completed' && (
                    <th className="px-3 py-3 font-bold text-slate-500 uppercase tracking-wider text-[10px] text-center">Tested On</th>
                  )}
                  <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-wider text-[10px] text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredJobs.map((job, idx) => (
                  <tr key={job.id} className={`hover:bg-slate-50 transition-colors ${selectedJobIds.has(job.id) ? 'bg-blue-50/50' : ''}`}>
                    <td className="px-3 py-3 text-center">
                      <button onClick={() => handleToggleJob(job.id)} className="text-slate-400 hover:text-blue-600 cursor-pointer">
                        {selectedJobIds.has(job.id) ? (
                          <CheckSquare className="w-4 h-4 text-blue-600" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-2 py-3 text-center font-mono font-bold text-xs text-slate-400">
                      {idx + 1}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="font-mono font-bold text-slate-900 text-sm">{job.jobNo}</div>
                      {job.serialNo ? (
                        <div className="text-[11px] font-mono text-slate-500">
                          S.No: <span className="font-semibold text-slate-700">{job.serialNo}</span>
                        </div>
                      ) : (
                        <div className="text-[10px] text-slate-400 italic">No S.No</div>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="font-mono font-bold text-slate-800 text-xs">{job.mrNo}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        Dt: {formatDDMMYYYY(job.dateOfIssue || job.mrDate || job.createdAt)}
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 uppercase">
                        {job.division || '-'}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs font-bold font-mono rounded border border-blue-100">
                        {job.capacityKva} KVA
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      <div className="font-medium text-slate-900">{job.make || '-'}</div>
                      <div className="text-[11px] text-slate-500 font-semibold">{job.repairType || 'GP'}</div>
                    </td>
                    <td className="px-3 py-3 text-center whitespace-nowrap">
                      {job.externalInspectionDate ? (
                        <span className="text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded font-mono">
                          {formatDDMMYYYY(job.externalInspectionDate)}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400 italic">-</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center whitespace-nowrap">
                      {job.internalInspectionDate ? (
                        <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-mono">
                          {formatDDMMYYYY(job.internalInspectionDate)}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400 italic">-</span>
                      )}
                    </td>
                    {tab === 'Completed' && (
                      <td className="px-3 py-3 text-center text-slate-700 font-mono text-xs whitespace-nowrap font-medium">
                        {job.testingDate ? formatDDMMYYYY(job.testingDate) : '-'}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {job.status === 'Scrap' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                          Scrap - not tested
                        </span>
                      ) : (
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => {
                              setSelectedJobIds(new Set([job.id]));
                              setIsFormOpen(true);
                            }}
                            className="px-3 py-1.5 text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 rounded transition-colors shadow-2xs cursor-pointer"
                          >
                            {tab === 'Pending' ? 'Test Job' : 'Edit Test'}
                          </button>
                          {tab === 'Completed' && (
                            <button
                              onClick={() => {
                                setSelectedJobIds(new Set([job.id]));
                                setIsPrintOpen(true);
                              }}
                              className="px-2.5 py-1.5 text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 rounded transition-colors cursor-pointer"
                              title="Print Testing Report"
                            >
                              <Printer className="w-3.5 h-3.5 text-slate-600" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredJobs.length === 0 && (
                  <tr>
                    <td colSpan={tab === 'Completed' ? 11 : 10} className="px-4 py-12 text-center text-slate-500 bg-slate-50/50">
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
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-white shadow-md">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest bg-blue-600/30 text-blue-300 px-2 py-0.5 rounded border border-blue-500/30">
                  Transformer Routine Testing
                </span>
              </div>
              <p className="text-lg font-mono font-bold mt-1">{selectedJobIds.size} Transformer{selectedJobIds.size > 1 ? 's' : ''} Selected for Testing</p>
            </div>
            <div className="flex items-center space-x-4 w-full md:w-auto">
              <div className="flex-1 md:flex-none">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Testing Date</label>
                <input 
                  type="date" 
                  required
                  value={testingDate}
                  onChange={(e) => setTestingDate(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-700 bg-slate-800 text-white rounded-lg focus:ring-1 focus:ring-blue-500" 
                />
              </div>
              <button 
                onClick={closeForm}
                className="mt-4 md:mt-0 text-xs font-bold text-slate-300 hover:text-white bg-slate-800 border border-slate-700 px-3 py-2 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
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
                <div key={jobId} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                  <div className="flex flex-wrap items-center justify-between mb-4 border-b border-slate-100 pb-3 gap-2">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="font-mono font-bold text-slate-900 text-lg">{job.jobNo}</h3>
                        {job.serialNo && (
                          <span className="text-xs font-mono font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200">
                            S.No: {job.serialNo}
                          </span>
                        )}
                        <span className="text-xs font-bold uppercase bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                          {job.division || '-'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 font-mono mt-1">
                        MR: <span className="text-slate-700 font-semibold">{job.mrNo}</span>{' '}
                        <span>({formatDDMMYYYY(job.dateOfIssue || job.mrDate || job.createdAt)})</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {job.externalInspectionDate && (
                        <span className="text-[11px] bg-blue-50 text-blue-800 font-mono px-2 py-1 rounded border border-blue-200 font-medium">
                          Ext: {formatDDMMYYYY(job.externalInspectionDate)}
                        </span>
                      )}
                      {job.internalInspectionDate && (
                        <span className="text-[11px] bg-emerald-50 text-emerald-800 font-mono px-2 py-1 rounded border border-emerald-200 font-medium">
                          Int: {formatDDMMYYYY(job.internalInspectionDate)}
                        </span>
                      )}
                      <span className="px-2.5 py-1 bg-slate-900 text-white text-xs font-bold font-mono rounded-lg">
                        {job.capacityKva} KVA
                      </span>
                      <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg">
                        {job.make}
                      </span>
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
