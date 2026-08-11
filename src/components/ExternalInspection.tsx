import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { Loader2, ArrowLeft, Search, Save } from 'lucide-react';
import { useAgency } from '../lib/AgencyContext';

interface Job {
  id: string;
  jobNo: string;
  mrNo: string;
  capacityKva: number;
  make: string;
  serialNo: string;
  repairType: string;
}

interface ExternalData {
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
}

export default function ExternalInspection() {
  const navigate = useNavigate();
  const { jobId } = useParams();
  
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [selectedMrNo, setSelectedMrNo] = useState<string | null>(null);
  const [mrJobs, setMrJobs] = useState<Job[]>([]);
  const [formsData, setFormsData] = useState<Record<string, ExternalData>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function fetchJobs() {
      if (!auth.currentUser) return;
      try {
        const q = query(collection(db, 'jobs'), where('ownerId', '==', auth.currentUser.uid));
        const snapshot = await getDocs(q);
        const fetchedJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Job));
        setJobs(fetchedJobs);
        
        // If jobId is passed, auto-select its MR No
        if (jobId) {
          const found = fetchedJobs.find(j => j.id === jobId);
          if (found) {
            handleSelectMr(found.mrNo, fetchedJobs);
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'jobs');
      } finally {
        setLoading(false);
      }
    }
    fetchJobs();
  }, [jobId]); // eslint-disable-line

  const handleSelectMr = (mrNo: string, allJobs = jobs) => {
    const jobsForMr = allJobs.filter(j => j.mrNo === mrNo && j.repairType === 'OGP');
    
    // Sort by Job No conceptually
    jobsForMr.sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));

    const initialForms: Record<string, ExternalData> = {};
    jobsForMr.forEach(j => {
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
    });
    
    setMrJobs(jobsForMr);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !selectedMrNo) return;
    
    setIsSubmitting(true);
    try {
      const now = Date.now();
      const batch = writeBatch(db);
      
      for (const job of mrJobs) {
        const jobData = formsData[job.id];
        const inspectionRef = doc(collection(db, 'inspections'));
        
        batch.set(inspectionRef, {
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
          createdAt: now,
          updatedAt: now,
          ownerId: auth.currentUser.uid,
        });

        const jobRef = doc(db, 'jobs', job.id);
        batch.update(jobRef, {
          status: 'External Done',
          updatedAt: now
        });
      }

      await batch.commit();
      navigate('/');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'inspections');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // Group OGP jobs by MR No for the selection list
  const ogpJobs = jobs.filter(j => j.repairType === 'OGP' && j.status === 'Received');
  const mrGroups: Record<string, Job[]> = {};
  ogpJobs.forEach(j => {
    if (!mrGroups[j.mrNo]) mrGroups[j.mrNo] = [];
    mrGroups[j.mrNo].push(j);
  });
  
  const uniqueMrNos = Object.keys(mrGroups).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const filteredMrNos = uniqueMrNos.filter(mr => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return mr.toLowerCase().includes(query) || mrGroups[mr].some(j => j.jobNo.toLowerCase().includes(query));
  });

  const renderSelectField = (jobId: string, name: keyof ExternalData, options: string[]) => (
    <select
      value={formsData[jobId]?.[name]}
      onChange={e => handleChange(jobId, name, e.target.value)}
      className="w-full min-w-[60px] px-2 py-1.5 text-[10px] border border-slate-300 rounded bg-slate-50 focus:ring-1 focus:ring-blue-500 font-mono"
    >
      {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  );

  const renderInputField = (jobId: string, name: keyof ExternalData, type: string = 'text', minWidth: string = 'min-w-[60px]') => (
    <input
      type={type}
      value={formsData[jobId]?.[name] || ''}
      onChange={e => handleChange(jobId, name, e.target.value)}
      className={`w-full ${minWidth} px-2 py-1.5 text-[10px] border border-slate-300 rounded bg-slate-50 focus:ring-1 focus:ring-blue-500 font-mono`}
    />
  );

  return (
    <div className="max-w-[1600px] mx-auto px-2 md:px-4">
      <div className="mb-6 flex items-center space-x-4">
        <Link to="/" className="p-2 bg-white rounded-full shadow-sm border border-slate-200 hover:bg-slate-50">
          <ArrowLeft className="w-4 h-4 text-slate-600" />
        </Link>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">External Inspection (Bulk by MR No)</h1>
      </div>

      {!selectedMrNo ? (
        <div className="bg-white p-6 rounded shadow-sm border border-slate-200 max-w-4xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Select an MR No</h2>
            <div className="relative w-full md:w-64">
              <input 
                type="text" 
                placeholder="Search MR No, Job No..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">MR No</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total Jobs</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Job Nos</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {filteredMrNos.map(mr => (
                  <tr key={mr} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap font-mono font-bold text-slate-900">{mr}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">{mrGroups[mr].length} Jobs</td>
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate" title={mrGroups[mr].map(j => j.jobNo).join(', ')}>
                      {mrGroups[mr].map(j => j.jobNo).join(', ')}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                      <button 
                        onClick={() => handleSelectMr(mr)}
                        className="text-[10px] font-bold uppercase tracking-widest text-blue-600 hover:text-blue-800 flex items-center bg-blue-50 px-3 py-1.5 rounded"
                      >
                        Inspect MR <ArrowLeft className="w-3 h-3 ml-1 rotate-180" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredMrNos.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500">No MR numbers found requiring inspection.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded flex justify-between items-center text-white">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Selected MR No</p>
              <p className="text-xl font-mono font-bold">{selectedMrNo}</p>
              <p className="text-xs text-slate-300 mt-1">{mrJobs.length} Jobs Total</p>
            </div>
            <button 
              onClick={() => setSelectedMrNo(null)}
              className="text-[10px] font-bold uppercase tracking-widest text-blue-400 hover:text-blue-300 border border-blue-400/30 px-3 py-1.5 rounded transition-colors"
            >
              Change MR
            </button>
          </div>

          <div className="bg-white rounded shadow-sm border border-slate-200">
            <form onSubmit={handleSubmit}>
              <div className="overflow-x-auto p-0 md:p-4">
                <table className="w-full text-left border-collapse min-w-[1200px]">
                  <thead>
                    <tr>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest sticky left-0 z-10 w-8">SR</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest sticky left-8 z-10 w-24">JOB NO</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest min-w-[50px]">MAKE</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest min-w-[40px]">KVA</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest min-w-[40px]">KV</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest">OIL<br/>CAP</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest">LESS<br/>OIL</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest">SL/<br/>BL</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest">GA<br/>SK</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest">HV<br/>LV</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Nute<br/>Bolt</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Dry<br/>Act</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest">Cln<br/>Tank</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest">BR<br/>ETH</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest">OIL<br/>LEV</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest">OUT<br/>PAINT</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest">NAME<br/>PLT</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest">DAM<br/>CT</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest">DAM<br/>RAD</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest text-center" colSpan={3}>HV SIDE (B/M/CC)</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest text-center" colSpan={3}>LV SIDE (B/M/CC)</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest">TRANS<br/>TYPE</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest print:hidden">OIL<br/>AVL</th>
                      <th className="p-1 border-b border-slate-200 bg-slate-50 text-[9px] font-bold text-slate-500 uppercase tracking-widest print:hidden">NET<br/>SHRT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {mrJobs.map((job, index) => {
                      const oilCap = Number(formsData[job.id]?.oilCapLtrs) || 0;
                      const lessOil = Number(formsData[job.id]?.lessOilLtrs) || 0;
                      const oilAvl = oilCap - lessOil;
                      const netShrt = (oilAvl * 0.05) + lessOil;
                      return (
                      <tr key={job.id} className="hover:bg-slate-50 group">
                        <td className="p-1 text-xs font-mono text-slate-500 sticky left-0 bg-white group-hover:bg-slate-50 border-r border-slate-100">{index + 1}</td>
                        <td className="p-1 text-xs font-mono font-bold text-slate-900 sticky left-8 bg-white group-hover:bg-slate-50 border-r border-slate-100 min-w-[100px]">{job.jobNo}</td>
                        <td className="p-1 text-[10px] text-slate-700 min-w-[60px] truncate max-w-[80px]" title={job.make}>{job.make}</td>
                        <td className="p-1 text-[10px] text-slate-700 font-mono">{job.capacityKva}</td>
                        <td className="p-1">{renderInputField(job.id, 'kv', 'text', 'w-10')}</td>
                        <td className="p-1">{renderInputField(job.id, 'oilCapLtrs', 'number', 'min-w-[60px]')}</td>
                        <td className="p-1">{renderInputField(job.id, 'lessOilLtrs', 'number', 'min-w-[60px]')}</td>
                        <td className="p-1">{renderSelectField(job.id, 'sealType', ['BL', 'SL'])}</td>
                        <td className="p-1">{renderInputField(job.id, 'gasket', 'text', 'w-10')}</td>
                        <td className="p-1">{renderInputField(job.id, 'hvLvRod', 'text', 'w-10')}</td>
                        <td className="p-1">{renderInputField(job.id, 'nuteBolt', 'text', 'w-10')}</td>
                        <td className="p-1">{renderInputField(job.id, 'dryActPart', 'text', 'w-10')}</td>
                        <td className="p-1">{renderSelectField(job.id, 'clnDrtyTank', ['Y', 'N', '-', 'TBR'])}</td>
                        <td className="p-1">{renderSelectField(job.id, 'breather', ['Y', 'N', '-', 'TBR'])}</td>
                        <td className="p-1">{renderSelectField(job.id, 'oilLevGls', ['Y', 'N', '-', 'TBR'])}</td>
                        <td className="p-1">{renderSelectField(job.id, 'outsidePaint', ['Y', 'N', '-', 'TBR'])}</td>
                        <td className="p-1">{renderSelectField(job.id, 'namePlate', ['-', 'Y', 'N', 'TBR'])}</td>
                        <td className="p-1">{renderInputField(job.id, 'damCtTank', 'text', 'w-12')}</td>
                        <td className="p-1">{renderInputField(job.id, 'damRadNo', 'number', 'w-10')}</td>
                        <td className="p-0.5">{renderInputField(job.id, 'hvSideHvb', 'text', 'w-8')}</td>
                        <td className="p-0.5">{renderInputField(job.id, 'hvSideHvm', 'text', 'w-8')}</td>
                        <td className="p-0.5 border-r border-slate-100">{renderInputField(job.id, 'hvSideHvCc', 'text', 'w-8')}</td>
                        <td className="p-0.5">{renderInputField(job.id, 'lvSideLvb', 'text', 'w-8')}</td>
                        <td className="p-0.5">{renderInputField(job.id, 'lvSideLvm', 'text', 'w-8')}</td>
                        <td className="p-0.5 border-r border-slate-100">{renderInputField(job.id, 'lvSideLvCc', 'text', 'w-8')}</td>
                        <td className="p-1">{renderInputField(job.id, 'transType', 'text', 'w-12')}</td>
                        <td className="p-1 text-[10px] font-mono text-slate-700 bg-slate-50/50 text-center print:hidden">{oilAvl >= 0 ? oilAvl.toFixed(1) : '-'}</td>
                        <td className="p-1 text-[10px] font-mono font-bold text-amber-600 bg-amber-50/30 text-center print:hidden">{netShrt >= 0 ? netShrt.toFixed(1) : '-'}</td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
              
              <div className="p-6 bg-slate-50 border-t border-slate-200 flex justify-end">
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
