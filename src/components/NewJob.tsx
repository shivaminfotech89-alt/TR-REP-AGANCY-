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
  coreType: string;
}

export default function NewJob() {
  const navigate = useNavigate();
  const { activeAgency, activeAtMaster, getNextJobNoInfo, incrementJobNoCounter } = useAgency();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [commonData, setCommonData] = useState({
    mrNo: '',
    dateOfIssue: new Date().toISOString().split('T')[0],
    type: 'Distribution', // Distribution, Power, SDT, etc.
    repairType: 'OGP', // OGP, GP
    division: 'SABARMATI',
  });

  React.useEffect(() => {
    const currentPrefixes = (activeAtMaster && activeAtMaster.prefixes && Object.keys(activeAtMaster.prefixes).length > 0) 
        ? activeAtMaster.prefixes 
        : (activeAgency?.prefixes || {});
    
    if (Object.keys(currentPrefixes).length > 0) {
      const firstDiv = Object.keys(currentPrefixes)[0];
      setCommonData(prev => ({
        ...prev,
        division: firstDiv
      }));
      
      const { prefix, nextNum } = getNextJobNoInfo(firstDiv, 'CRGO', 'OGP');
      setTransformers(prev => {
        if (prev.length === 1 && prev[0].jobNo === '') {
          return [{ ...prev[0], jobNo: `${prefix}-${nextNum}` }];
        }
        return prev;
      });
    }
  }, [activeAgency]); // eslint-disable-line

  const [transformers, setTransformers] = useState<TransformerEntry[]>([
    { jobNo: '', capacityKva: '', make: '', serialNo: '', coreType: 'CRGO' }
  ]);

  const handleCommonChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setCommonData(prev => ({ ...prev, [name]: value }));

    if (name === 'division' && activeAgency) {
      const oldDivision = commonData.division;
      
      setTransformers(prev => prev.map((t, idx) => {
        const oldInfo = getNextJobNoInfo(oldDivision, t.coreType, commonData.repairType);
        const newInfo = getNextJobNoInfo(value, t.coreType, commonData.repairType);
        
        // If it looks like it was generated with the old division, replace it
        if (t.jobNo && t.jobNo.startsWith(oldInfo.prefix + '-')) {
          return { ...t, jobNo: t.jobNo.replace(oldInfo.prefix + '-', newInfo.prefix + '-') };
        } else if (!t.jobNo) {
          return { ...t, jobNo: `${newInfo.prefix}-${newInfo.nextNum + idx}` };
        }
        return t;
      }));
    } else if (name === 'repairType' && activeAgency) {
      const oldRepairType = commonData.repairType;
      
      setTransformers(prev => prev.map((t, idx) => {
        const oldInfo = getNextJobNoInfo(commonData.division, t.coreType, oldRepairType);
        const newInfo = getNextJobNoInfo(commonData.division, t.coreType, value);
        
        if (t.jobNo && t.jobNo.startsWith(oldInfo.prefix + '-')) {
          return { ...t, jobNo: t.jobNo.replace(oldInfo.prefix + '-', newInfo.prefix + '-') };
        } else if (!t.jobNo) {
          return { ...t, jobNo: `${newInfo.prefix}-${newInfo.nextNum + idx}` };
        }
        return t;
      }));
    }
  };

  const handleJobNoBlur = async (index: number, jobNo: string) => {
    if (commonData.repairType !== 'GP' || !jobNo.trim() || !activeAgency || !auth.currentUser) return;
    
    try {
      const q = query(
        collection(db, 'jobs'),
        where('ownerId', '==', auth.currentUser.uid),
        where('jobNo', '==', jobNo.trim()),
        where('agencyId', '==', activeAgency.id),
        where('repairType', '==', 'OGP')
      );
      
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        // Sort by createdAt descending to get the latest OGP job
        const ogpJobs = snapshot.docs.map(d => d.data()).sort((a, b) => b.createdAt - a.createdAt);
        const latestJob = ogpJobs[0];
        
        // Auto-fill Make, SNo, KVA, and coreType
        handleTransformerChange(index, 'capacityKva', String(latestJob.capacityKva));
        handleTransformerChange(index, 'make', latestJob.make);
        handleTransformerChange(index, 'serialNo', latestJob.serialNo);
        if (latestJob.coreType) {
          handleTransformerChange(index, 'coreType', latestJob.coreType);
        }
        
        if (latestJob.isClosed !== true) {
           setErrorMsg(`Warning: The OGP job ${jobNo} is still marked as '${latestJob.status}'. It should be delivered before it can be received as a GP job.`);
        }
      } else {
        setErrorMsg(`No previous OGP job found for Job No: ${jobNo}`);
      }
    } catch (err) {
      console.error('Error fetching OGP job details:', err);
    }
  };

  const handleTransformerChange = (index: number, field: keyof TransformerEntry, value: string) => {
    const newTransformers = [...transformers];
    const oldType = newTransformers[index].coreType;
    newTransformers[index][field] = value;
    
    // Auto-update jobNo if coreType changes
    if (field === 'coreType' && activeAgency) {
      const newCoreType = value;
      const info = getNextJobNoInfo(commonData.division, newCoreType, commonData.repairType);
      
      let highestNum = info.nextNum - 1;
      newTransformers.forEach((t, i) => {
        if (i === index) return;
        const tInfo = getNextJobNoInfo(commonData.division, t.coreType, commonData.repairType);
        if (tInfo.counterKey === info.counterKey) {
          const parts = t.jobNo.split('-');
          if (parts.length > 1) {
            const num = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(num) && num > highestNum) highestNum = num;
          }
        }
      });
      newTransformers[index].jobNo = `${info.prefix}-${highestNum + 1}`;
    }
    
    setTransformers(newTransformers);
  };

  const addTransformer = () => {
    let nextJobNo = '';
    const newCoreType = transformers.length > 0 ? transformers[transformers.length - 1].coreType : 'CRGO';
    if (activeAgency) {
      const info = getNextJobNoInfo(commonData.division, newCoreType, commonData.repairType);
      let highestNum = info.nextNum - 1;
      transformers.forEach(t => {
        // Only consider transformers of the same counterKey type
        const tInfo = getNextJobNoInfo(commonData.division, t.coreType, commonData.repairType);
        if (tInfo.counterKey === info.counterKey) {
          const parts = t.jobNo.split('-');
          if (parts.length > 1) {
            const num = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(num) && num > highestNum) highestNum = num;
          }
        }
      });
      nextJobNo = `${info.prefix}-${highestNum + 1}`;
    }
    setTransformers([...transformers, { jobNo: nextJobNo, capacityKva: '', make: '', serialNo: '', coreType: newCoreType }]);
  };

  const removeTransformer = (index: number) => {
    if (transformers.length === 1) return;
    const newTransformers = [...transformers];
    newTransformers.splice(index, 1);
    setTransformers(newTransformers);
  };

  const handleAutoFillEmptyJobNos = () => {
    if (!activeAgency) {
      setErrorMsg("Please configure and select an agency in Settings first.");
      return;
    }
    
    // Map next job numbers by counterKey
    const nextNums: Record<string, number> = {};
    
    transformers.forEach(t => {
      const info = getNextJobNoInfo(commonData.division, t.coreType, commonData.repairType);
      if (!nextNums[info.counterKey]) {
        nextNums[info.counterKey] = info.nextNum;
      }
      const parts = t.jobNo.split('-');
      if (parts.length > 1) {
        const num = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(num) && num >= nextNums[info.counterKey]) {
          nextNums[info.counterKey] = num + 1;
        }
      }
    });
    
    const newTransformers = transformers.map(t => {
      if (!t.jobNo.trim()) {
        const info = getNextJobNoInfo(commonData.division, t.coreType, commonData.repairType);
        // Initialize if empty for some reason
        if (!nextNums[info.counterKey]) nextNums[info.counterKey] = info.nextNum;
        
        const jobNo = `${info.prefix}-${nextNums[info.counterKey]}`;
        nextNums[info.counterKey]++;
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

      // Check MR No duplication using simpler query to avoid composite index errors
      
      // Check MR No duplication using simpler query to avoid composite index errors
      const mrQuery = query(collection(db, 'jobs'), where('ownerId', '==', auth.currentUser.uid), where('mrNo', '==', commonData.mrNo));
      const mrDocs = await getDocs(mrQuery);
      
      let isDuplicateMR = false;
      mrDocs.forEach(doc => {
         const d = doc.data();
         if (d.ownerId === auth.currentUser.uid && d.division === commonData.division && d.agencyId === activeAgency.id) {
            isDuplicateMR = true;
         }
      });
      
      if (isDuplicateMR) {
         setErrorMsg(`MR No ${commonData.mrNo} already exists for division ${commonData.division}. Duplication not allowed.`);
         setLoading(false);
         return;
      }
      

      
      
      // Check Allotment limits
      if (activeAtMaster && activeAgency && commonData.repairType !== 'OH') {
        const countsToAdd: Record<string, number> = {};
        for (const t of transformers) {
          const cType = t.coreType || 'CRGO';
          if (cType === 'OH') continue;
          countsToAdd[cType] = (countsToAdd[cType] || 0) + 1;
        }
        
        // Optimize querying by fetching all relevant AT jobs just once
        const snap = await getDocs(query(
            collection(db, 'jobs'),
            where('ownerId', '==', auth.currentUser.uid),
            where('atId', '==', activeAtMaster.id)
        ));
        
        const existingJobsData = snap.docs.map(d => d.data());

        for (const [cType, countToAdd] of Object.entries(countsToAdd)) {
          let allowed = Number(activeAtMaster.allotments?.[commonData.division]?.[cType]);
          
          if (!allowed || allowed === 0) {
             allowed = Number(activeAgency.allotments?.[commonData.division]?.[cType]) || 0;
          }
          
          allowed = allowed || 0;
          
          if (allowed > 0) {
            let used = 0;
            existingJobsData.forEach(data => {
              if (data.ownerId !== auth.currentUser.uid || data.division !== commonData.division) return;
              
              // Only count if it's NOT an OH repair
              if (data.repairType === 'OH') return;
              
              const docType = data.coreType || 'CRGO';
              if (docType === 'OH') return;
              
              // ONLY check the exact coreType currently being looped
              if (docType === cType) {
                used++;
              }
            });
            
            if (used + countToAdd > allowed) {
              setErrorMsg(`Cannot receive job. ${cType} allotment exceeded for ${commonData.division}.\nAllowed: ${allowed}\nUsed: ${used}\nTrying to add: ${countToAdd}`);
              setLoading(false);
              return;
            }
          } else if (allowed === 0 && countToAdd > 0) {
            setErrorMsg(`Cannot receive job. No ${cType} allotment has been configured for ${commonData.division}. Please set the allotment in AT Settings first.`);
            setLoading(false);
            return;
          }
        }
      }

      
      const jobNos = transformers.map(t => t.jobNo).filter(j => j);
      if (jobNos.length > 0) {
        // Check local duplication within the form itself
        const uniqueJobNos = new Set(jobNos);
        if (uniqueJobNos.size !== jobNos.length) {
           setErrorMsg("Duplicate Job Numbers entered in the form.");
           setLoading(false);
           return;
        }

        if (!activeAtMaster) {
           setErrorMsg("Please configure and select an Active AT/Tender period in Settings first.");
           setLoading(false);
           return;
        }

        // We check every jobNo entered
        for (const jn of jobNos) {
           // We are only concerned with duplicates in the current AT period
           const jnQuery = query(collection(db, 'jobs'), where('ownerId', '==', auth.currentUser.uid), where('jobNo', '==', jn));
           const jnDocs = await getDocs(jnQuery);
           
           if (!jnDocs.empty) {
             const jnDocsFiltered = jnDocs.docs.filter(d => {
               const data = d.data();
               return data.ownerId === auth.currentUser.uid && data.agencyId === activeAgency.id && data.atId === activeAtMaster.id;
             });
             if (jnDocsFiltered.length > 0) {
                 const activeCycles = jnDocsFiltered.filter(d => d.data().isClosed !== true);
                 if (activeCycles.length > 0) {
                   setErrorMsg(`Job No ${jn} already exists and is still active in the current AT period. Duplication not allowed until previous cycle is closed.`);
                   setLoading(false);
                   return;
                 }
             }
           }
           
           
      if (commonData.repairType === 'GP') {
             // For GP, we check ALL history for this JobNo to ensure the last delivery was within 18 months
             const allJnQuery = query(collection(db, 'jobs'), where('ownerId', '==', auth.currentUser.uid), where('jobNo', '==', jn));
             const allJnDocs = await getDocs(allJnQuery);
             
             if (allJnDocs.empty) {
               // Technically allowed to receive GP if not in system, but normally GP means previously OGP.
               // We will allow it but maybe warn in real life.
             } else {
               // Sort by deliveryDate or createdAt
               const allJnDocsFiltered = allJnDocs.docs.filter(d => d.data().ownerId === auth.currentUser.uid && d.data().agencyId === activeAgency.id);
               const closedCycles = allJnDocsFiltered
                 .map(d => d.data())
                 .filter(d => d.isClosed === true)
                 .sort((a, b) => (b.deliveryDate || b.createdAt) - (a.deliveryDate || a.createdAt));
                 
               if (closedCycles.length > 0) {
                  const lastCycle = closedCycles[0];
                  const lastDeliveryDate = lastCycle.deliveryDate || lastCycle.updatedAt || lastCycle.createdAt;
                  
                  const validationMonths = activeAgency?.gpValidationMonths || 18;
                  const validationPeriodInMs = validationMonths * 30 * 24 * 60 * 60 * 1000;
                  if (now - lastDeliveryDate > validationPeriodInMs) {
                    setErrorMsg(`Job No ${jn} cannot be received as GP. The previous OGP delivery was more than ${validationMonths} months ago.`);
                    setLoading(false);
                    return;
                  }
               }
             }
           }
           
        }
      }

      const maxJobNoMap: Record<string, number> = {};

      for (const t of transformers) {
        if (!t.jobNo) continue;
        
        const info = getNextJobNoInfo(commonData.division, t.coreType, commonData.repairType);
        const counterKey = info.counterKey;

        const parts = t.jobNo.split('-');
        if (parts.length > 1) {
          const num = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(num)) {
            if (!maxJobNoMap[counterKey] || num > maxJobNoMap[counterKey]) {
              maxJobNoMap[counterKey] = num;
            }
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
          coreType: t.coreType,
          status: 'Received',
          isClosed: false,
          atId: activeAtMaster ? activeAtMaster.id : '',
          createdAt: now,
          updatedAt: now,
          ownerId: auth.currentUser.uid,
          agencyId: activeAgency.id,
        };
        batch.set(newJobRef, jobData);
      }

      for (const [counterKey, maxNum] of Object.entries(maxJobNoMap)) {
        let currentLast = 0;
        if (activeAtMaster && activeAtMaster.lastJobNumbers) {
           currentLast = activeAtMaster.lastJobNumbers[counterKey] || 0;
        } else if (activeAgency && activeAgency.lastJobNumbers) {
           currentLast = activeAgency.lastJobNumbers[counterKey] || 0;
        }
        
        if (maxNum > currentLast) {
          const diff = maxNum - currentLast;
          await incrementJobNoCounter(counterKey, diff);
        }
      }

      
      await batch.commit();
      navigate('/');
    } catch (err) {
      setErrorMsg("Submission Error: " + (err instanceof Error ? err.stack : String(err)));
      handleFirestoreError(err, OperationType.CREATE, 'jobs');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      {errorMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full border border-red-100 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center gap-3 mb-4 text-red-600">
              <div className="bg-red-100 p-2 rounded-full">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold">Attention</h3>
            </div>
            <p className="text-gray-700 whitespace-pre-wrap mb-6">{errorMsg}</p>
            <div className="flex justify-end">
              <button onClick={(e) => { e.preventDefault(); setErrorMsg(null); }} className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium rounded-lg transition-colors">
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

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
            <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
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
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">MR Receive</label>
                <input
                  required
                  type="date"
                  name="dateOfIssue"
                  value={commonData.dateOfIssue}
                  onChange={handleCommonChange}
                  className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Repair Type (Job Category)</label>
                <div className="flex space-x-4">
                  <label className={`flex-1 flex items-center justify-center space-x-2 border rounded p-2 cursor-pointer transition-colors ${commonData.repairType === 'OGP' ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-slate-50 border-slate-300 hover:bg-slate-100'}`}>
                    <input type="radio" name="repairType" value="OGP" checked={commonData.repairType === 'OGP'} onChange={handleCommonChange} className="hidden" />
                    <span className="text-sm font-bold">OGP (Out of Guarantee)</span>
                  </label>
                  <label className={`flex-1 flex items-center justify-center space-x-2 border rounded p-2 cursor-pointer transition-colors ${commonData.repairType === 'GP' ? 'bg-amber-50 border-amber-500 text-amber-700' : 'bg-slate-50 border-slate-300 hover:bg-slate-100'}`}>
                    <input type="radio" name="repairType" value="GP" checked={commonData.repairType === 'GP'} onChange={handleCommonChange} className="hidden" />
                    <span className="text-sm font-bold">GP (Guarantee Period)</span>
                  </label>
                  

                </div>
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
                    Object.keys((activeAtMaster && activeAtMaster.prefixes && Object.keys(activeAtMaster.prefixes).length > 0) ? activeAtMaster.prefixes : (activeAgency.prefixes || {})).map(div => (
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
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 flex-1">
                      <div>
                        {index === 0 && <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Job No.</label>}
                        <div className="relative">
                          <input
                            required
                            type="text"
                            value={t.jobNo}
                            onChange={(e) => handleTransformerChange(index, 'jobNo', e.target.value)}
                            onBlur={() => handleJobNoBlur(index, t.jobNo)}
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
                      <div>
                         {index === 0 && <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Job Type</label>}
                        <select
                          value={t.coreType}
                          onChange={(e) => handleTransformerChange(index, 'coreType', e.target.value)}
                          className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50"
                        >
                          <option value="CRGO">CRGO</option>
                          <option value="Amorphous">Amorphous</option>
                          <option value="Wound Core">Wound Core</option>
                          <option value="LSTC">LSTC</option>\n                          <option value="OH">OH (Overhauling)</option>
                          
                        </select>
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
