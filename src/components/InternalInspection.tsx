import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, doc, setDoc, query, where, getDocs } from 'firebase/firestore';
import { Loader2, ArrowLeft, Search } from 'lucide-react';

interface Job {
  id: string;
  jobNo: string;
  mrNo: string;
  capacityKva: number;
  make: string;
  serialNo: string;
  repairType: string;
}

export default function InternalInspection() {
  const navigate = useNavigate();
  const { jobId } = useParams();
  
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  
  const [formData, setFormData] = useState({
    windingType: 'AL',
    hvCoilLimb: '4',
    damR: '2',
    damY: '4',
    damB: '4',
    totCoil: '10',
    wtOfCoil: '1.40',
    totWt: '14.00',
    lvCoilR: 'OK',
    lvCoilY: 'OK',
    lvCoilB: 'OK',
    wtOfCoilLv: '4.56',
    totWtLv: '0.00',
    washerRing: '6',
    insidePaint: '-',
    testTrn: 'Y',
    dcSup: 'Y',
    insulation: 'Y'
  });

  useEffect(() => {
    async function fetchJobs() {
      if (!auth.currentUser) return;
      try {
        const q = query(collection(db, 'jobs'), where('ownerId', '==', auth.currentUser.uid));
        const snapshot = await getDocs(q);
        const fetchedJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Job));
        setJobs(fetchedJobs);
        if (jobId) {
          const found = fetchedJobs.find(j => j.id === jobId);
          if (found) setSelectedJob(found);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'jobs');
      } finally {
        setLoading(false);
      }
    }
    fetchJobs();
  }, [jobId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !selectedJob) return;
    
    setLoading(true);
    try {
      const newInspRef = doc(collection(db, 'inspections'));
      const now = Date.now();
      
      const inspData = {
        jobId: selectedJob.id,
        type: 'INTERNAL',
        data: JSON.stringify(formData),
        createdAt: now,
        updatedAt: now,
        ownerId: auth.currentUser.uid,
      };

      await setDoc(newInspRef, inspData);
      
      // Update job status
      await setDoc(doc(db, 'jobs', selectedJob.id), { status: 'Internal Inspection Done', updatedAt: now }, { merge: true });
      
      alert('Internal Inspection saved successfully!');
      navigate('/');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'inspections');
    } finally {
      setLoading(false);
    }
  };

  if (loading && jobs.length === 0) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center space-x-4">
        <Link to="/" className="p-2 bg-white rounded-full shadow-sm border border-slate-200 hover:bg-slate-50">
          <ArrowLeft className="w-4 h-4 text-slate-600" />
        </Link>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Internal Inspection Report</h1>
      </div>

      {!selectedJob ? (
        <div className="bg-white p-6 rounded shadow-sm border border-slate-200">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-4">Select a Job for Internal Inspection</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Job No</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">MR No</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Make / KVA</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {jobs.map(job => (
                  <tr key={job.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap font-mono font-bold text-slate-900">{job.jobNo}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">{job.mrNo}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">{job.make} / {job.capacityKva}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                      <button 
                        onClick={() => setSelectedJob(job)}
                        className="text-[10px] font-bold uppercase tracking-widest text-blue-600 hover:text-blue-800 flex items-center"
                      >
                        Select <Search className="w-3 h-3 ml-1" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded flex justify-between items-center text-white">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Selected Job</p>
              <p className="text-lg font-mono font-bold">{selectedJob.jobNo}</p>
              <p className="text-xs text-slate-300 mt-1">MR: {selectedJob.mrNo} | Make: {selectedJob.make} | {selectedJob.capacityKva} KVA</p>
            </div>
            <button 
              onClick={() => setSelectedJob(null)}
              className="text-[10px] font-bold uppercase tracking-widest text-blue-400 hover:text-blue-300 border border-blue-400/30 px-3 py-1.5 rounded transition-colors"
            >
              Change Job
            </button>
          </div>

          <div className="bg-white p-6 rounded shadow-sm border border-slate-200">
            <form onSubmit={handleSubmit} className="space-y-8">
              
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 border-b border-slate-100 pb-2">HV Coil Details</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Winding</label>
                    <select name="windingType" value={formData.windingType} onChange={handleChange} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50">
                      <option value="AL">Aluminium (AL)</option>
                      <option value="CU">Copper (CU)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">H.V Coil Limb</label>
                    <input type="number" name="hvCoilLimb" value={formData.hvCoilLimb} onChange={handleChange} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50" />
                  </div>
                </div>
                
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-6 mb-2">No. of Damaged H.V Coil</h4>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">R</label>
                    <input type="number" name="damR" value={formData.damR} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Y</label>
                    <input type="number" name="damY" value={formData.damY} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">B</label>
                    <input type="number" name="damB" value={formData.damB} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Tot. Coil</label>
                    <input type="number" name="totCoil" value={formData.totCoil} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Wt. of Coil (Kg)</label>
                    <input type="number" step="0.01" name="wtOfCoil" value={formData.wtOfCoil} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">TOT. Wt.</label>
                    <input type="number" step="0.01" name="totWt" value={formData.totWt} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50" />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 border-b border-slate-100 pb-2">L.V Coil Details</h3>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">R (DMG/RI)</label>
                    <input type="text" name="lvCoilR" value={formData.lvCoilR} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50" placeholder="OK/RI" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Y</label>
                    <input type="text" name="lvCoilY" value={formData.lvCoilY} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">B</label>
                    <input type="text" name="lvCoilB" value={formData.lvCoilB} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">WT. OF Coil</label>
                    <input type="number" step="0.01" name="wtOfCoilLv" value={formData.wtOfCoilLv} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">TOT. Wt.</label>
                    <input type="number" step="0.01" name="totWtLv" value={formData.totWtLv} onChange={handleChange} className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50" />
                  </div>
                </div>
              </div>

              <div className="pt-6 flex justify-end">
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2 text-[10px] font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center shadow-sm"
                >
                  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Submit Internal Inspection
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
