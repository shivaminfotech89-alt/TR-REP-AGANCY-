import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, doc, setDoc, writeBatch, query, where, getDocs } from 'firebase/firestore';
import { Loader2, ArrowLeft, Plus, Trash2, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAgency } from '../lib/AgencyContext';

interface TransformerEntry {
  jobNo: string;
  capacityKva: string;
  make: string;
  serialNo: string;
}

export default function NewJob() {
  const navigate = useNavigate();
  const { activeAgency, getNextJobNoInfo, incrementJobNoCounter } = useAgency();
  const [loading, setLoading] = useState(false);
  
  const [commonData, setCommonData] = useState({
    mrNo: '',
    dateOfIssue: new Date().toISOString().split('T')[0],
    type: 'Distribution', // Distribution, Power, SDT, etc.
    repairType: 'OGP', // OGP, GP
    division: 'SABARMATI',
  });

  React.useEffect(() => {
    if (activeAgency && Object.keys(activeAgency.prefixes).length > 0) {
      const firstDiv = Object.keys(activeAgency.prefixes)[0];
      setCommonData(prev => ({
        ...prev,
        division: firstDiv
      }));
      
      const { prefix, nextNum } = getNextJobNoInfo(firstDiv);
      setTransformers(prev => {
        if (prev.length === 1 && prev[0].jobNo === '') {
          return [{ ...prev[0], jobNo: `${prefix}-${nextNum}` }];
        }
        return prev;
      });
    }
  }, [activeAgency]); // eslint-disable-line

  const [transformers, setTransformers] = useState<TransformerEntry[]>([
    { jobNo: '', capacityKva: '', make: '', serialNo: '' }
  ]);

  const handleCommonChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setCommonData(prev => ({ ...prev, [name]: value }));
    
    if (name === 'division' && activeAgency) {
      const { prefix, nextNum } = getNextJobNoInfo(value);
      setTransformers(prev => prev.map((t, idx) => {
        // If we change division, we can update the job numbers if they look like they were generated
        // Simplest is to just re-generate all empty ones or ones that match the old division prefix
        return { ...t, jobNo: `${prefix}-${nextNum + idx}` };
      }));
    }
  };

  const handleTransformerChange = (index: number, field: keyof TransformerEntry, value: string) => {
    const newTransformers = [...transformers];
    newTransformers[index][field] = value;
    setTransformers(newTransformers);
  };

  const addTransformer = () => {
    let nextJobNo = '';
    if (activeAgency) {
      const { prefix, nextNum } = getNextJobNoInfo(commonData.division);
      let highestNum = nextNum - 1;
      transformers.forEach(t => {
        const parts = t.jobNo.split('-');
        if (parts.length > 1) {
          const num = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(num) && num > highestNum) highestNum = num;
        }
      });
      nextJobNo = `${prefix}-${highestNum + 1}`;
    }
    setTransformers([...transformers, { jobNo: nextJobNo, capacityKva: '', make: '', serialNo: '' }]);
  };

  const removeTransformer = (index: number) => {
    if (transformers.length === 1) return;
    const newTransformers = [...transformers];
    newTransformers.splice(index, 1);
    setTransformers(newTransformers);
  };

  const handleAutoFillEmptyJobNos = () => {
    if (!activeAgency) {
      alert("Please configure and select an agency in Settings first.");
      return;
    }
    
    const { prefix, nextNum } = getNextJobNoInfo(commonData.division);
    let currentNext = nextNum;
    
    const newTransformers = transformers.map(t => {
      if (!t.jobNo.trim()) {
        const jobNo = `${prefix}-${currentNext}`;
        currentNext++;
        return { ...t, jobNo };
      }
      return t;
    });
    
    setTransformers(newTransformers);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    
    setLoading(true);
    try {
      const now = Date.now();
      const batch = writeBatch(db);

      // Check MR No duplication
      const mrQuery = query(collection(db, 'jobs'), where('mrNo', '==', commonData.mrNo), where('division', '==', commonData.division));
      const mrDocs = await getDocs(mrQuery);
      if (!mrDocs.empty) {
         alert(`MR No ${commonData.mrNo} already exists for division ${commonData.division}. Duplication not allowed.`);
         setLoading(false);
         return;
      }
      
      const jobNos = transformers.map(t => t.jobNo).filter(j => j);
      if (jobNos.length > 0) {
        // Check local duplication within the form itself
        const uniqueJobNos = new Set(jobNos);
        if (uniqueJobNos.size !== jobNos.length) {
           alert("Duplicate Job Numbers entered in the form.");
           setLoading(false);
           return;
        }

        // We can do an individual check for each Job NO if we want to be safe since array 'in' has 10 limit
        for (const jn of jobNos) {
           const jnQuery = query(collection(db, 'jobs'), where('jobNo', '==', jn));
           const jnDocs = await getDocs(jnQuery);
           if (!jnDocs.empty) {
             alert(`Job No ${jn} already exists. Duplication not allowed.`);
             setLoading(false);
             return;
           }
        }
      }

      let maxJobNoNumber = 0;

      for (const t of transformers) {
        if (!t.jobNo) continue;
        
        // Basic logic to find highest assigned number for counter increment if auto-filled
        const parts = t.jobNo.split('-');
        if (parts.length > 1) {
          const num = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(num) && num > maxJobNoNumber) {
            maxJobNoNumber = num;
          }
        }

        const newJobRef = doc(collection(db, 'jobs'));
        const jobData = {
          mrNo: commonData.mrNo,
          dateOfIssue: commonData.dateOfIssue,
          type: commonData.type,
          repairType: commonData.repairType,
          division: commonData.division,
          jobNo: t.jobNo,
          capacityKva: Number(t.capacityKva),
          make: t.make,
          serialNo: t.serialNo,
          status: 'Received',
          createdAt: now,
          updatedAt: now,
          ownerId: auth.currentUser.uid,
        };
        batch.set(newJobRef, jobData);
      }

      // If we found auto-generated numbers, update the max counter for this division
      if (maxJobNoNumber > 0 && activeAgency) {
        const currentLast = (activeAgency.lastJobNumbers && activeAgency.lastJobNumbers[commonData.division]) || 0;
        if (maxJobNoNumber > currentLast) {
          const diff = maxJobNoNumber - currentLast;
          await incrementJobNoCounter(commonData.division, diff);
        }
      }

      await batch.commit();
      navigate('/');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'jobs');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <Link to="/" className="p-2 bg-white rounded-full shadow-sm border border-slate-200 hover:bg-slate-50">
            <ArrowLeft className="w-4 h-4 text-slate-600" />
          </Link>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">New Transformer Job Entry</h1>
        </div>
      </div>

      <div className="bg-white p-6 md:p-8 rounded shadow-sm border border-slate-200">
        <form onSubmit={handleSubmit} className="space-y-8">
          
          {/* Common Details (MR Level) */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 border-b border-slate-100 pb-2">MR / Challan Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">MR No.</label>
                <input
                  required
                  type="text"
                  name="mrNo"
                  value={commonData.mrNo}
                  onChange={handleCommonChange}
                  className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50"
                  placeholder="e.g. 5933"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Date of Issue</label>
                <input
                  required
                  type="date"
                  name="dateOfIssue"
                  value={commonData.dateOfIssue}
                  onChange={handleCommonChange}
                  className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Repair Type</label>
                <select
                  name="repairType"
                  value={commonData.repairType}
                  onChange={handleCommonChange}
                  className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50"
                >
                  <option value="OGP">OGP (Out of Guarantee)</option>
                  <option value="GP">GP (Guarantee Period)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Division Office</label>
                <select
                  name="division"
                  value={commonData.division}
                  onChange={handleCommonChange}
                  className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50"
                >
                  {activeAgency ? (
                    Object.keys(activeAgency.prefixes).map(div => (
                      <option key={div} value={div}>{div}</option>
                    ))
                  ) : (
                    <>
                      <option value="SABARMATI">SABARMATI</option>
                      <option value="GANDHINAGAR">GANDHINAGAR</option>
                      <option value="AHMEDABAD">AHMEDABAD</option>
                    </>
                  )}
                </select>
              </div>
            </div>
          </div>

          {/* Transformer Details */}
          <div>
             <div className="flex justify-between items-end mb-4 border-b border-slate-100 pb-2">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Transformer Details</h3>
                <div className="flex items-center space-x-2">
                  <button type="button" onClick={handleAutoFillEmptyJobNos} className="text-[10px] font-bold uppercase tracking-widest text-amber-600 hover:text-amber-800 flex items-center bg-amber-50 px-2 py-1 rounded">
                    <Zap className="w-3 h-3 mr-1" /> Auto-Fill Job Nos
                  </button>
                  <button type="button" onClick={addTransformer} className="text-[10px] font-bold uppercase tracking-widest text-blue-600 hover:text-blue-800 flex items-center bg-blue-50 px-2 py-1 rounded">
                    <Plus className="w-3 h-3 mr-1" /> Add Row
                  </button>
                </div>
             </div>
             
             <div className="space-y-4">
                {transformers.map((t, index) => (
                  <div key={index} className={`flex flex-col sm:flex-row gap-4 items-start ${index > 0 ? 'pt-4 border-t border-slate-100' : ''}`}>
                    <div className="text-xs font-mono font-bold text-slate-400 mt-2 w-6">{index + 1}.</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1">
                      <div>
                        {index === 0 && <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Job No.</label>}
                        <div className="relative">
                          <input
                            required
                            type="text"
                            value={t.jobNo}
                            onChange={(e) => handleTransformerChange(index, 'jobNo', e.target.value)}
                            className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50"
                            placeholder="e.g. 21 IS-48"
                          />
                        </div>
                      </div>
                      <div>
                         {index === 0 && <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">KVA</label>}
                        <input
                          required
                          type="number"
                          value={t.capacityKva}
                          onChange={(e) => handleTransformerChange(index, 'capacityKva', e.target.value)}
                          className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50"
                          placeholder="e.g. 63"
                        />
                      </div>
                      <div>
                         {index === 0 && <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Make</label>}
                        <input
                          required
                          type="text"
                          value={t.make}
                          onChange={(e) => handleTransformerChange(index, 'make', e.target.value)}
                          className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50"
                          placeholder="e.g. NJA"
                        />
                      </div>
                      <div>
                         {index === 0 && <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Serial No.</label>}
                        <input
                          required
                          type="text"
                          value={t.serialNo}
                          onChange={(e) => handleTransformerChange(index, 'serialNo', e.target.value)}
                          className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50"
                          placeholder="e.g. 13602"
                        />
                      </div>
                    </div>
                    {transformers.length > 1 && (
                      <button 
                        type="button" 
                        onClick={() => removeTransformer(index)}
                        className={`p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors ${index === 0 ? 'mt-6' : ''}`}
                        title="Remove Row"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
             </div>
          </div>

          <div className="pt-6 flex justify-end">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="px-6 py-2 text-xs font-bold uppercase tracking-widest border border-slate-300 rounded text-slate-700 hover:bg-slate-50 transition-colors mr-4"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 text-xs font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center shadow-sm"
            >
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Jobs Entry
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
