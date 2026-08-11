import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { Loader2, ArrowLeft, Search, Save } from 'lucide-react';
import { useAgency } from '../lib/AgencyContext';
import { calcOilShortage } from '../lib/contractRates';
import { todayISO } from '../lib/contractRates';
import type { Job } from '../lib/types';

interface ExternalForm {
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

const emptyForm = (): ExternalForm => ({
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
  transType: 'C',
});

export default function ExternalInspection() {
  const navigate = useNavigate();
  const { jobId } = useParams();
  const { activeAgency, nextSequence } = useAgency();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMrNo, setSelectedMrNo] = useState<string | null>(null);
  const [mrJobs, setMrJobs] = useState<Job[]>([]);
  const [formsData, setFormsData] = useState<Record<string, ExternalForm>>({});
  const [inspMeta, setInspMeta] = useState({ inspNo: '', inspDate: todayISO() });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function fetchJobs() {
      if (!auth.currentUser) return;
      try {
        const q = query(collection(db, 'jobs'), where('ownerId', '==', auth.currentUser.uid));
        const snapshot = await getDocs(q);
        const fetchedJobs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Job));
        setJobs(fetchedJobs);
        if (jobId) {
          const found = fetchedJobs.find((j) => j.id === jobId);
          if (found && found.repairType === 'OGP') handleSelectMr(found.mrNo, fetchedJobs);
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
    const jobsForMr = allJobs
      .filter((j) => j.mrNo === mrNo && j.repairType === 'OGP' && j.status === 'Received')
      .sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));

    const initial: Record<string, ExternalForm> = {};
    jobsForMr.forEach((j) => {
      initial[j.id] = emptyForm();
    });
    setMrJobs(jobsForMr);
    setFormsData(initial);
    setSelectedMrNo(mrNo);
  };

  const handleChange = (id: string, field: keyof ExternalForm, value: string) => {
    setFormsData((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !selectedMrNo) return;
    setIsSubmitting(true);
    try {
      const now = Date.now();
      const batch = writeBatch(db);
      let inspNo = inspMeta.inspNo;
      if (!inspNo && activeAgency) {
        const n = await nextSequence('lastExtInspNo');
        const prefix = activeAgency.prefixes[mrJobs[0]?.division] || 'IS';
        inspNo = `${prefix}-${n}`;
        setInspMeta((p) => ({ ...p, inspNo }));
      }

      for (const job of mrJobs) {
        const f = formsData[job.id];
        const oilCap = Number(f.oilCapLtrs) || 0;
        const lessOil = Number(f.lessOilLtrs) || 0;
        const oil = calcOilShortage(oilCap, lessOil);

        batch.set(doc(collection(db, 'inspections')), {
          jobId: job.id,
          type: 'External',
          data: {
            kv: f.kv,
            oilCapLtrs: oilCap,
            lessOilLtrs: lessOil,
            oilAvailable: oil.oilCont,
            netShortage: oil.total,
            sealType: f.sealType,
            gasket: f.gasket,
            hvLvRod: f.hvLvRod,
            nuteBolt: f.nuteBolt,
            dryActPart: f.dryActPart,
            clnDrtyTank: f.clnDrtyTank,
            breather: f.breather,
            oilLevGls: f.oilLevGls,
            outsidePaint: f.outsidePaint,
            namePlate: f.namePlate,
            damCtTank: Number(f.damCtTank) || 0,
            damRadNo: Number(f.damRadNo) || 0,
            hvSideHvb: f.hvSideHvb,
            hvSideHvm: f.hvSideHvm,
            hvSideHvCc: f.hvSideHvCc,
            lvSideLvb: f.lvSideLvb,
            lvSideLvm: f.lvSideLvm,
            lvSideLvCc: f.lvSideLvCc,
            transType: f.transType,
            inspNo,
            inspDate: inspMeta.inspDate,
          },
          createdAt: now,
          updatedAt: now,
          ownerId: auth.currentUser.uid,
        });

        batch.update(doc(db, 'jobs', job.id), {
          status: 'External Done',
          kv: f.kv,
          updatedAt: now,
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

  const ogpJobs = jobs.filter((j) => j.repairType === 'OGP' && j.status === 'Received');
  const mrGroups: Record<string, Job[]> = {};
  ogpJobs.forEach((j) => {
    if (!mrGroups[j.mrNo]) mrGroups[j.mrNo] = [];
    mrGroups[j.mrNo].push(j);
  });
  const uniqueMrNos = Object.keys(mrGroups).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const filteredMrNos = uniqueMrNos.filter((mr) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return mr.toLowerCase().includes(q) || mrGroups[mr].some((j) => j.jobNo.toLowerCase().includes(q));
  });

  const renderSelect = (id: string, name: keyof ExternalForm, options: string[]) => (
    <select value={formsData[id]?.[name]} onChange={(e) => handleChange(id, name, e.target.value)}
      className="w-full min-w-[52px] px-1 py-1 text-[10px] border border-slate-300 rounded bg-slate-50 font-mono">
      {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  );

  const renderInput = (id: string, name: keyof ExternalForm, type = 'text', w = 'min-w-[52px]') => (
    <input type={type} value={formsData[id]?.[name] || ''} onChange={(e) => handleChange(id, name, e.target.value)}
      className={`w-full ${w} px-1 py-1 text-[10px] border border-slate-300 rounded bg-slate-50 font-mono`} />
  );

  return (
    <div className="max-w-[1600px] mx-auto px-2 md:px-4">
      <div className="mb-6 flex items-center space-x-4 no-print">
        <Link to="/" className="p-2 bg-white rounded-full shadow-sm border border-slate-200 hover:bg-slate-50">
          <ArrowLeft className="w-4 h-4 text-slate-600" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">External Physical Inspection</h1>
          <p className="text-xs text-slate-500">OGP jobs only — GP returns skip external inspection</p>
        </div>
      </div>

      {!selectedMrNo ? (
        <div className="bg-white p-6 rounded shadow-sm border border-slate-200 max-w-4xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Select MR No</h2>
            <div className="relative w-full md:w-64">
              <input type="text" placeholder="Search MR / Job No..." value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm border border-slate-300 rounded bg-slate-50" />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">MR No</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">Jobs</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">Job Nos</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredMrNos.map((mr) => (
                <tr key={mr} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono font-bold">{mr}</td>
                  <td className="px-4 py-3 text-slate-500">{mrGroups[mr].length}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 truncate max-w-xs">{mrGroups[mr].map((j) => j.jobNo).join(', ')}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleSelectMr(mr)}
                      className="text-[10px] font-bold uppercase tracking-widest text-blue-600 bg-blue-50 px-3 py-1.5 rounded">
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
              {filteredMrNos.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">No OGP MRs pending external inspection.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-slate-900 p-4 rounded flex flex-wrap gap-4 justify-between items-center text-white no-print">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">MR No</p>
              <p className="text-xl font-mono font-bold">{selectedMrNo}</p>
              <p className="text-xs text-slate-300 mt-1">{mrJobs.length} transformers</p>
            </div>
            <div className="flex gap-3 items-end">
              <div>
                <label className="text-[10px] uppercase text-slate-400">Insp No</label>
                <input value={inspMeta.inspNo} onChange={(e) => setInspMeta((p) => ({ ...p, inspNo: e.target.value }))}
                  className="block mt-1 px-2 py-1 text-sm rounded bg-slate-800 border border-slate-700 text-white font-mono" placeholder="Auto" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-400">Insp Date</label>
                <input type="date" value={inspMeta.inspDate} onChange={(e) => setInspMeta((p) => ({ ...p, inspDate: e.target.value }))}
                  className="block mt-1 px-2 py-1 text-sm rounded bg-slate-800 border border-slate-700 text-white" />
              </div>
              <button onClick={() => setSelectedMrNo(null)} className="text-[10px] font-bold uppercase text-blue-300 border border-blue-400/30 px-3 py-1.5 rounded">
                Change MR
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="bg-white rounded shadow-sm border border-slate-200">
            <div className="overflow-x-auto p-2">
              <table className="w-full text-left border-collapse min-w-[1200px]">
                <thead>
                  <tr>
                    {['SR','JOB NO','MAKE','KVA','KV','OIL CAP','LESS OIL','SL/BL','GASK','HV/LV','NUTE','DRY','CLN','BREATH','OIL LEV','PAINT','NAME','DAM CT','DAM RAD','HV B','HV M','HV CC','LV B','LV M','LV CC','TYPE','OIL AVL','NET SHRT'].map((h) => (
                      <th key={h} className="p-1 border-b bg-slate-50 text-[9px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mrJobs.map((job, index) => {
                    const oilCap = Number(formsData[job.id]?.oilCapLtrs) || 0;
                    const lessOil = Number(formsData[job.id]?.lessOilLtrs) || 0;
                    const oil = calcOilShortage(oilCap, lessOil);
                    return (
                      <tr key={job.id} className="hover:bg-slate-50">
                        <td className="p-1 text-xs font-mono text-slate-500">{index + 1}</td>
                        <td className="p-1 text-xs font-mono font-bold">{job.jobNo}</td>
                        <td className="p-1 text-[10px] truncate max-w-[70px]">{job.make}</td>
                        <td className="p-1 text-[10px] font-mono">{job.capacityKva}</td>
                        <td className="p-1">{renderInput(job.id, 'kv', 'text', 'w-10')}</td>
                        <td className="p-1">{renderInput(job.id, 'oilCapLtrs', 'number')}</td>
                        <td className="p-1">{renderInput(job.id, 'lessOilLtrs', 'number')}</td>
                        <td className="p-1">{renderSelect(job.id, 'sealType', ['BL', 'SL'])}</td>
                        <td className="p-1">{renderInput(job.id, 'gasket', 'text', 'w-10')}</td>
                        <td className="p-1">{renderInput(job.id, 'hvLvRod', 'text', 'w-10')}</td>
                        <td className="p-1">{renderSelect(job.id, 'nuteBolt', ['Y', 'N', '-'])}</td>
                        <td className="p-1">{renderSelect(job.id, 'dryActPart', ['Y', 'N', '-'])}</td>
                        <td className="p-1">{renderSelect(job.id, 'clnDrtyTank', ['Y', 'N', '-', 'TBR'])}</td>
                        <td className="p-1">{renderSelect(job.id, 'breather', ['Y', 'N', '-', 'TBR'])}</td>
                        <td className="p-1">{renderSelect(job.id, 'oilLevGls', ['Y', 'N', '-', 'TBR'])}</td>
                        <td className="p-1">{renderSelect(job.id, 'outsidePaint', ['Y', 'N', '-', 'TBR'])}</td>
                        <td className="p-1">{renderSelect(job.id, 'namePlate', ['-', 'Y', 'N', 'TBR'])}</td>
                        <td className="p-1">{renderInput(job.id, 'damCtTank', 'text', 'w-12')}</td>
                        <td className="p-1">{renderInput(job.id, 'damRadNo', 'number', 'w-10')}</td>
                        <td className="p-0.5">{renderInput(job.id, 'hvSideHvb', 'text', 'w-8')}</td>
                        <td className="p-0.5">{renderInput(job.id, 'hvSideHvm', 'text', 'w-8')}</td>
                        <td className="p-0.5">{renderInput(job.id, 'hvSideHvCc', 'text', 'w-8')}</td>
                        <td className="p-0.5">{renderInput(job.id, 'lvSideLvb', 'text', 'w-8')}</td>
                        <td className="p-0.5">{renderInput(job.id, 'lvSideLvm', 'text', 'w-8')}</td>
                        <td className="p-0.5">{renderInput(job.id, 'lvSideLvCc', 'text', 'w-8')}</td>
                        <td className="p-1">{renderInput(job.id, 'transType', 'text', 'w-10')}</td>
                        <td className="p-1 text-[10px] font-mono text-center bg-slate-50">{oil.oilCont.toFixed(1)}</td>
                        <td className="p-1 text-[10px] font-mono font-bold text-amber-700 text-center bg-amber-50">{oil.total.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-4 bg-slate-50 border-t flex justify-between items-center no-print">
              <p className="text-[10px] text-slate-500">Net shortage = Less Oil + 5% filtration loss on contained oil</p>
              <button type="submit" disabled={isSubmitting}
                className="px-6 py-2.5 text-xs font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center shadow-sm">
                {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                <Save className="w-4 h-4 mr-2" /> Save {mrJobs.length} Inspections
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
