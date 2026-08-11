import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { Loader2, ArrowLeft, Search, Activity } from 'lucide-react';

interface Job {
  id: string;
  jobNo: string;
  mrNo: string;
  capacityKva: number;
  make: string;
  repairType: string;
  status: string;
}

export default function TestingReport() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const [formData, setFormData] = useState({
    meggerValHvLv: '',
    meggerValHvE: '',
    meggerValLvE: '',
    magneticBalance: '',
    magnetizingCurrent: '',
    ratioTest: '',
    vectorGroup: '',
    noLoadLoss: '',
    loadLoss: '',
    impedance: '',
    dvdfTest: '',
    hvTest: '',
    oilBdv: '',
    remarks: '',
  });

  useEffect(() => {
    async function fetchJobs() {
      if (!auth.currentUser) return;
      try {
        const q = query(
          collection(db, 'jobs'),
          where('ownerId', '==', auth.currentUser.uid)
        );
        const snapshot = await getDocs(q);
        const fetchedJobs = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() } as Job))
          .filter(j =>
            ['Estimate Approved', 'Under Repair', 'Tested', 'Billed'].includes(j.status) &&
            !j.status.includes('Non-Repairable')
          );
        setJobs(fetchedJobs);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'jobs');
      } finally {
        setLoading(false);
      }
    }
    fetchJobs();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJob) return;

    setLoading(true);
    try {
      const jobRef = doc(db, 'jobs', selectedJob.id);
      await updateDoc(jobRef, {
        testingDetails: formData,
        status: 'Tested - Ready for Dispatch',
        updatedAt: Date.now()
      });
      navigate('/');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'jobs');
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
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Transformer Testing Report</h1>
      </div>

      {!selectedJob ? (
        <div className="bg-white p-6 rounded shadow-sm border border-slate-200">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-4">Select a Job for Testing</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Job No</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">MR No</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Make / KVA</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</th>
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
                       <span className="px-2 py-1 rounded-full text-[10px] bg-slate-100 text-slate-600 font-bold uppercase tracking-widest">
                         {job.status}
                       </span>
                    </td>
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
                {jobs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">No jobs found.</td>
                  </tr>
                )}
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
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 border-b border-slate-100 pb-2">Megger / Insulation Resistance</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">HV to LV (MΩ)</label>
                    <input required type="text" name="meggerValHvLv" value={formData.meggerValHvLv} onChange={handleChange} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">HV to Earth (MΩ)</label>
                    <input required type="text" name="meggerValHvE" value={formData.meggerValHvE} onChange={handleChange} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">LV to Earth (MΩ)</label>
                    <input required type="text" name="meggerValLvE" value={formData.meggerValLvE} onChange={handleChange} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50" />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 border-b border-slate-100 pb-2">Losses & Impedance</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">No Load Loss (W)</label>
                    <input type="number" name="noLoadLoss" value={formData.noLoadLoss} onChange={handleChange} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Full Load Loss (W)</label>
                    <input type="number" name="loadLoss" value={formData.loadLoss} onChange={handleChange} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">% Impedance</label>
                    <input type="text" name="impedance" value={formData.impedance} onChange={handleChange} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50" />
                  </div>
                </div>
              </div>
              
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 border-b border-slate-100 pb-2">High Voltage & Other Tests</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">DVDF Test</label>
                    <select name="dvdfTest" value={formData.dvdfTest} onChange={handleChange} className="w-full px-4 py-2 text-sm border border-slate-300 rounded bg-slate-50">
                      <option value="">Select...</option>
                      <option value="OK">OK</option>
                      <option value="FAIL">FAIL</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">HV Test (28KV/3KV)</label>
                    <select name="hvTest" value={formData.hvTest} onChange={handleChange} className="w-full px-4 py-2 text-sm border border-slate-300 rounded bg-slate-50">
                      <option value="">Select...</option>
                      <option value="OK">OK</option>
                      <option value="FAIL">FAIL</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Ratio Test</label>
                     <select name="ratioTest" value={formData.ratioTest} onChange={handleChange} className="w-full px-4 py-2 text-sm border border-slate-300 rounded bg-slate-50">
                      <option value="">Select...</option>
                      <option value="OK">OK</option>
                      <option value="FAIL">FAIL</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Oil BDV (KV)</label>
                    <input type="text" name="oilBdv" value={formData.oilBdv} onChange={handleChange} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50" placeholder="e.g. 50KV" />
                  </div>
                </div>
              </div>

              <div>
                 <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Remarks</label>
                 <textarea name="remarks" value={formData.remarks} onChange={handleChange} rows={3} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50"></textarea>
              </div>

              <div className="pt-6 flex justify-end">
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2 text-[10px] font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center shadow-sm"
                >
                  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Save Testing Report
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
