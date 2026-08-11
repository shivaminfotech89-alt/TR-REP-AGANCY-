import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Loader2, ArrowLeft, FileCheck, AlertTriangle } from 'lucide-react';
import { getCircleOfficeLimit, requiresCorporateApproval, isNonRepairable } from '../lib/contractRates';

interface Job {
  id: string;
  jobNo: string;
  mrNo: string;
  capacityKva: number;
  make: string;
}

export default function EstimateGenerate() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  useEffect(() => {
    async function fetchJobs() {
      if (!auth.currentUser) return;
      try {
        const q = query(collection(db, 'jobs'), where('ownerId', '==', auth.currentUser.uid));
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
  }, []);

  const [estimateItems, setEstimateItems] = useState([
    { no: '1a', item: 'Dismantling', qty: 1, rate: 1603.00, amt: 1603.00 },
    { no: '1b', item: 'Repl. of Gaskets', qty: 1, rate: 46.00, amt: 46.00 },
    { no: '1c', item: 'Repl. HV/LV Gaskets', qty: 7, rate: 34.00, amt: 238.00 },
    { no: '1d', item: 'Repl. of Insulation', qty: 1, rate: 286.00, amt: 286.00 },
    { no: '8', item: 'HV Bushing', qty: 3, rate: 176.00, amt: 528.00 },
    { no: '9A', item: 'HV Metal Parts', qty: 3, rate: 131.00, amt: 393.00 },
    { no: '10', item: 'LV Bushing', qty: 4, rate: 59.80, amt: 239.20 },
    { no: '12C', item: 'HV Coil - Labour', qty: 15.54, rate: 34.00, amt: 528.36 },
  ]);

  const handleItemChange = (index: number, field: 'qty' | 'rate', value: string) => {
    const numValue = parseFloat(value) || 0;
    const newItems = [...estimateItems];
    newItems[index] = { ...newItems[index], [field]: numValue };
    newItems[index].amt = newItems[index].qty * newItems[index].rate;
    setEstimateItems(newItems);
  };

  const totalAmt = estimateItems.reduce((acc, curr) => acc + curr.amt, 0);
  const riseTotal = Number((totalAmt * 0.04).toFixed(2));
  const grandTotal = totalAmt + riseTotal;

  // Approval logic variables
  let circleOfficeLimit = 0;
  let needsCorporate = false;
  let isScrap = false;

  if (selectedJob) {
    circleOfficeLimit = getCircleOfficeLimit(selectedJob.capacityKva);
    needsCorporate = requiresCorporateApproval(grandTotal, selectedJob.capacityKva);
    isScrap = isNonRepairable(grandTotal, selectedJob.capacityKva);
  }

  if (loading && jobs.length === 0) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-amber-600" /></div>;
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 flex items-center space-x-4">
        <Link to="/" className="p-2 bg-white rounded-full shadow-sm border border-slate-200 hover:bg-slate-50">
          <ArrowLeft className="w-4 h-4 text-slate-600" />
        </Link>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Generate Estimate</h1>
      </div>

      {!selectedJob ? (
        <div className="bg-white p-6 rounded shadow-sm border border-slate-200">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-4">Select a Job for Estimate</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {jobs.map(job => (
              <div key={job.id} onClick={() => setSelectedJob(job)} className="p-4 border border-slate-200 rounded hover:border-blue-500 hover:shadow-sm cursor-pointer transition-all bg-white group">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-mono font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{job.jobNo}</h3>
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold uppercase tracking-widest rounded">{job.capacityKva} KVA</span>
                </div>
                <p className="text-xs text-slate-500">MR No: {job.mrNo}</p>
                <p className="text-xs text-slate-500">Make: {job.make}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded flex justify-between items-center text-white">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Selected Job</p>
              <p className="text-lg font-mono font-bold">{selectedJob.jobNo}</p>
              <p className="text-xs text-slate-300 mt-1">MR: {selectedJob.mrNo} | {selectedJob.capacityKva} KVA</p>
            </div>
            <button onClick={() => setSelectedJob(null)} className="text-[10px] font-bold uppercase tracking-widest text-blue-400 hover:text-blue-300 border border-blue-400/30 px-3 py-1.5 rounded transition-colors">
               Change Job
            </button>
          </div>

          {/* Approval Logic Display */}
          {selectedJob && (
            <div className={`p-4 rounded border ${isScrap ? 'bg-red-50 border-red-200' : needsCorporate ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200'}`}>
              <div className="flex items-start">
                <AlertTriangle className={`w-5 h-5 mr-3 mt-0.5 ${isScrap ? 'text-red-500' : needsCorporate ? 'text-orange-500' : 'text-green-500'}`} />
                <div>
                  <h4 className={`text-sm font-bold uppercase tracking-widest ${isScrap ? 'text-red-800' : needsCorporate ? 'text-orange-800' : 'text-green-800'}`}>
                    {isScrap ? 'Non-Repairable (Scrap)' : needsCorporate ? 'Corporate (CE) Approval Required' : 'Circle Office (SE) Approval'}
                  </h4>
                  <div className="mt-2 space-y-1 text-xs">
                    <p className="text-slate-600"><span className="font-semibold">Estimate Value:</span> ₹{grandTotal.toFixed(2)}</p>
                    <p className="text-slate-600"><span className="font-semibold">Circle Office Limit (25%):</span> ₹{circleOfficeLimit.toFixed(2)}</p>
                    <p className="text-slate-600"><span className="font-semibold">Scrap Limit (30%):</span> ₹{(circleOfficeLimit * 1.2).toFixed(2)}</p>
                  </div>
                  {isScrap && (
                    <p className="mt-2 text-xs font-medium text-red-700 bg-red-100 p-2 rounded">
                      This estimate exceeds 30% of the cost of a new transformer. It must be declared scrap per the contract.
                    </p>
                  )}
                  {needsCorporate && !isScrap && (
                    <p className="mt-2 text-xs font-medium text-orange-700 bg-orange-100 p-2 rounded">
                      This estimate is between 25% and 30% of new transformer cost. It requires approval from the Corporate Office (CE).
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="bg-white p-6 rounded shadow-sm border border-slate-200">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Estimate Details (Pre-filled via Capacity)</h3>
              <button className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center shadow-sm">
                <FileCheck className="w-4 h-4 mr-2" /> Save & Generate PDF
              </button>
            </div>
            
            <div className="overflow-x-auto border border-slate-200 rounded">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Sr</th>
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-widest">Item</th>
                    <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-widest">Qty</th>
                    <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-widest">Rate (₹)</th>
                    <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-widest">Amt (₹)</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {estimateItems.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-xs text-slate-500">{row.no}</td>
                      <td className="px-4 py-3 text-xs font-medium text-slate-900">{row.item}</td>
                      <td className="px-4 py-3 text-xs text-slate-900 text-right">
                        <input
                          type="number"
                          step="any"
                          value={row.qty}
                          onChange={(e) => handleItemChange(idx, 'qty', e.target.value)}
                          className="w-20 px-2 py-1 text-right text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-900 text-right">
                        <input
                          type="number"
                          step="any"
                          value={row.rate}
                          onChange={(e) => handleItemChange(idx, 'rate', e.target.value)}
                          className="w-24 px-2 py-1 text-right text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        />
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-900 text-right">{row.amt.toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-bold">
                    <td colSpan={4} className="px-4 py-3 text-right text-xs uppercase tracking-widest text-slate-600">Total</td>
                    <td className="px-4 py-3 text-right text-xs font-mono text-slate-900">{totalAmt.toFixed(2)}</td>
                  </tr>
                  <tr className="bg-slate-50 font-bold">
                    <td colSpan={4} className="px-4 py-3 text-right text-xs uppercase tracking-widest text-slate-600">4.00 % Rise Total</td>
                    <td className="px-4 py-3 text-right text-xs font-mono text-slate-900">{riseTotal.toFixed(2)}</td>
                  </tr>
                  <tr className="bg-slate-900 text-white font-bold">
                    <td colSpan={4} className="px-4 py-4 text-right text-sm uppercase tracking-widest text-slate-300">Grand Total</td>
                    <td className="px-4 py-4 text-right text-lg font-mono">{grandTotal.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
