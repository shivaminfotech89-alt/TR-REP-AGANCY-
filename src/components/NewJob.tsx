import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, doc, writeBatch, query, where, getDocs, limit } from 'firebase/firestore';
import { Loader2, ArrowLeft, Plus, Trash2, Zap, Search } from 'lucide-react';
import { useAgency } from '../lib/AgencyContext';

interface TransformerEntry {
  jobNo: string;
  capacityKva: string;
  make: string;
  serialNo: string;
  originalJobId?: string;
  guaranteeStartDate?: string | null;
  guaranteeEndDate?: string | null;
}

export default function NewJob() {
  const navigate = useNavigate();
  const { activeAgency, getNextJobNoInfo, incrementJobNoCounter } = useAgency();
  const [loading, setLoading] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);

  const [commonData, setCommonData] = useState({
    mrNo: '',
    dateOfIssue: new Date().toISOString().split('T')[0],
    type: 'Distribution',
    repairType: 'OGP',
    division: 'SABARMATI',
  });

  const [transformers, setTransformers] = useState<TransformerEntry[]>([
    { jobNo: '', capacityKva: '', make: '', serialNo: '' },
  ]);

  React.useEffect(() => {
    if (activeAgency && Object.keys(activeAgency.prefixes).length > 0) {
      const firstDiv = Object.keys(activeAgency.prefixes)[0];
      setCommonData((prev) => ({ ...prev, division: firstDiv }));
      if (commonData.repairType === 'OGP') {
        const { prefix, nextNum } = getNextJobNoInfo(firstDiv);
        setTransformers((prev) => {
          if (prev.length === 1 && prev[0].jobNo === '') {
            return [{ ...prev[0], jobNo: `${prefix}-${nextNum}` }];
          }
          return prev;
        });
      }
    }
  }, [activeAgency]); // eslint-disable-line

  const handleCommonChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setCommonData((prev) => ({ ...prev, [name]: value }));

    if (name === 'division' && activeAgency && commonData.repairType === 'OGP') {
      const { prefix, nextNum } = getNextJobNoInfo(value);
      setTransformers((prev) => prev.map((t, idx) => ({ ...t, jobNo: `${prefix}-${nextNum + idx}` })));
    }

    if (name === 'repairType' && value === 'GP') {
      setTransformers([{ jobNo: '', capacityKva: '', make: '', serialNo: '' }]);
    }
    if (name === 'repairType' && value === 'OGP' && activeAgency) {
      const { prefix, nextNum } = getNextJobNoInfo(commonData.division);
      setTransformers([{ jobNo: `${prefix}-${nextNum}`, capacityKva: '', make: '', serialNo: '' }]);
    }
  };

  const handleTransformerChange = (index: number, field: keyof TransformerEntry, value: string) => {
    const next = [...transformers];
    (next[index] as Record<string, string>)[field] = value;
    setTransformers(next);
  };

  const lookupGpJob = async (index: number) => {
    const jobNo = transformers[index].jobNo.trim();
    if (!jobNo || !auth.currentUser) return;
    setLookupBusy(true);
    try {
      const q = query(
        collection(db, 'jobs'),
        where('ownerId', '==', auth.currentUser.uid),
        where('jobNo', '==', jobNo),
        limit(5)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        alert(`No existing job found for Job No ${jobNo}. GP returns must reuse the original Job No.`);
        return;
      }
      // Prefer the earliest OGP / original job with guarantee dates
      const docs = snap.docs.map((d) => {
        const data = d.data() as {
          repairType?: string;
          guaranteeStartDate?: string;
          guaranteeEndDate?: string;
          capacityKva?: number;
          make?: string;
          serialNo?: string;
          division?: string;
          type?: string;
        };
        return { id: d.id, ...data };
      });
      const original =
        docs.find((d) => d.repairType === 'OGP') ||
        docs.find((d) => !!d.guaranteeStartDate) ||
        docs[0];
      const next = [...transformers];
      next[index] = {
        jobNo,
        capacityKva: String(original.capacityKva ?? ''),
        make: String(original.make ?? ''),
        serialNo: String(original.serialNo ?? ''),
        originalJobId: original.id,
        guaranteeStartDate: original.guaranteeStartDate || null,
        guaranteeEndDate: original.guaranteeEndDate || null,
      };
      setTransformers(next);
      if (original.division) {
        setCommonData((prev) => ({
          ...prev,
          division: original.division!,
          type: original.type || prev.type,
        }));
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'jobs');
    } finally {
      setLookupBusy(false);
    }
  };

  const addTransformer = () => {
    let nextJobNo = '';
    if (activeAgency && commonData.repairType === 'OGP') {
      const { prefix, nextNum } = getNextJobNoInfo(commonData.division);
      let highestNum = nextNum - 1;
      transformers.forEach((t) => {
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
    setTransformers(transformers.filter((_, i) => i !== index));
  };

  const handleAutoFillEmptyJobNos = () => {
    if (!activeAgency || commonData.repairType === 'GP') return;
    const { prefix, nextNum } = getNextJobNoInfo(commonData.division);
    let currentNext = nextNum;
    setTransformers(
      transformers.map((t) => {
        if (!t.jobNo.trim()) {
          const jobNo = `${prefix}-${currentNext}`;
          currentNext++;
          return { ...t, jobNo };
        }
        return t;
      })
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    setLoading(true);
    try {
      const now = Date.now();
      const batch = writeBatch(db);

      const mrQuery = query(
        collection(db, 'jobs'),
        where('mrNo', '==', commonData.mrNo),
        where('division', '==', commonData.division)
      );
      const mrDocs = await getDocs(mrQuery);
      if (!mrDocs.empty) {
        alert(`MR No ${commonData.mrNo} already exists for division ${commonData.division}.`);
        setLoading(false);
        return;
      }

      const jobNos = transformers.map((t) => t.jobNo).filter(Boolean);
      if (new Set(jobNos).size !== jobNos.length) {
        alert('Duplicate Job Numbers in the form.');
        setLoading(false);
        return;
      }

      if (commonData.repairType === 'OGP') {
        for (const jn of jobNos) {
          const jnQuery = query(collection(db, 'jobs'), where('jobNo', '==', jn));
          const jnDocs = await getDocs(jnQuery);
          if (!jnDocs.empty) {
            alert(`Job No ${jn} already exists. For guarantee returns use Repair Type = GP.`);
            setLoading(false);
            return;
          }
        }
      }

      let maxJobNoNumber = 0;
      for (const t of transformers) {
        if (!t.jobNo) continue;
        const parts = t.jobNo.split('-');
        if (parts.length > 1) {
          const num = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(num) && num > maxJobNoNumber) maxJobNoNumber = num;
        }

        const newJobRef = doc(collection(db, 'jobs'));
        const jobData: Record<string, unknown> = {
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
          agencyId: activeAgency?.id || '',
          isNonRepairable: false,
          originalJobId: t.originalJobId || '',
          guaranteeStartDate: t.guaranteeStartDate || '',
          guaranteeEndDate: t.guaranteeEndDate || '',
          createdAt: now,
          updatedAt: now,
          ownerId: auth.currentUser.uid,
        };
        batch.set(newJobRef, jobData);
      }

      if (commonData.repairType === 'OGP' && maxJobNoNumber > 0 && activeAgency) {
        const currentLast = (activeAgency.lastJobNumbers && activeAgency.lastJobNumbers[commonData.division]) || 0;
        if (maxJobNoNumber > currentLast) {
          await incrementJobNoCounter(commonData.division, maxJobNoNumber - currentLast);
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

  const isGp = commonData.repairType === 'GP';

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center space-x-4 no-print">
        <Link to="/" className="p-2 bg-white rounded-full shadow-sm border border-slate-200 hover:bg-slate-50">
          <ArrowLeft className="w-4 h-4 text-slate-600" />
        </Link>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">New Transformer Job Entry</h1>
      </div>

      <div className="bg-white p-6 md:p-8 rounded shadow-sm border border-slate-200">
        <form onSubmit={handleSubmit} className="space-y-8">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 border-b border-slate-100 pb-2">
              MR / Challan Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">MR No.</label>
                <input required type="text" name="mrNo" value={commonData.mrNo} onChange={handleCommonChange}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50" placeholder="e.g. 5933" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Date of Issue</label>
                <input required type="date" name="dateOfIssue" value={commonData.dateOfIssue} onChange={handleCommonChange}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Repair Type</label>
                <select name="repairType" value={commonData.repairType} onChange={handleCommonChange}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50">
                  <option value="OGP">OGP (Out of Guarantee)</option>
                  <option value="GP">GP (Guarantee Period Return)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Trans. Type</label>
                <select name="type" value={commonData.type} onChange={handleCommonChange}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50">
                  <option value="Distribution">Distribution</option>
                  <option value="Power">Power</option>
                  <option value="SDT">SDT</option>
                  <option value="Wound Core">Wound Core</option>
                  <option value="AMRP">AMRP</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Division Office</label>
                <select name="division" value={commonData.division} onChange={handleCommonChange}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50">
                  {activeAgency ? (
                    Object.keys(activeAgency.prefixes).map((div) => (
                      <option key={div} value={div}>{div}</option>
                    ))
                  ) : (
                    <option value="SABARMATI">SABARMATI</option>
                  )}
                </select>
              </div>
            </div>
            {isGp && (
              <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
                GP return: enter the <strong>original Job No</strong>, then Lookup. New MR is created; External inspection is skipped.
                Guarantee dates stay fixed from the first repair dispatch (18 months).
              </p>
            )}
          </div>

          <div>
            <div className="flex justify-between items-end mb-4 border-b border-slate-100 pb-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Transformer Details</h3>
              <div className="flex items-center space-x-2">
                {!isGp && (
                  <button type="button" onClick={handleAutoFillEmptyJobNos}
                    className="text-[10px] font-bold uppercase tracking-widest text-amber-600 hover:text-amber-800 flex items-center bg-amber-50 px-2 py-1 rounded">
                    <Zap className="w-3 h-3 mr-1" /> Auto-Fill Job Nos
                  </button>
                )}
                <button type="button" onClick={addTransformer}
                  className="text-[10px] font-bold uppercase tracking-widest text-blue-600 hover:text-blue-800 flex items-center bg-blue-50 px-2 py-1 rounded">
                  <Plus className="w-3 h-3 mr-1" /> Add Row
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {transformers.map((t, index) => (
                <div key={index} className={`flex flex-col sm:flex-row gap-3 items-start ${index > 0 ? 'pt-4 border-t border-slate-100' : ''}`}>
                  <div className="text-xs font-mono font-bold text-slate-400 mt-2 w-6">{index + 1}.</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
                    <div>
                      {index === 0 && <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Job No.</label>}
                      <div className="flex gap-1">
                        <input required type="text" value={t.jobNo}
                          onChange={(e) => handleTransformerChange(index, 'jobNo', e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50" placeholder={isGp ? 'Original Job No' : 'e.g. 21 IS-48'} />
                        {isGp && (
                          <button type="button" onClick={() => lookupGpJob(index)} disabled={lookupBusy}
                            className="px-2 py-2 bg-slate-900 text-white rounded text-[10px] font-bold uppercase shrink-0" title="Lookup original job">
                            {lookupBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                          </button>
                        )}
                      </div>
                    </div>
                    <div>
                      {index === 0 && <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">KVA</label>}
                      <input required type="number" value={t.capacityKva}
                        onChange={(e) => handleTransformerChange(index, 'capacityKva', e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50" placeholder="63" />
                    </div>
                    <div>
                      {index === 0 && <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Make</label>}
                      <input required type="text" value={t.make}
                        onChange={(e) => handleTransformerChange(index, 'make', e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50" placeholder="NJA" />
                    </div>
                    <div>
                      {index === 0 && <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Serial No.</label>}
                      <input required type="text" value={t.serialNo}
                        onChange={(e) => handleTransformerChange(index, 'serialNo', e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50" placeholder="13602" />
                    </div>
                  </div>
                  {transformers.length > 1 && (
                    <button type="button" onClick={() => removeTransformer(index)}
                      className={`p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded ${index === 0 ? 'mt-6' : ''}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="pt-6 flex justify-end">
            <button type="button" onClick={() => navigate('/')}
              className="px-6 py-2 text-xs font-bold uppercase tracking-widest border border-slate-300 rounded text-slate-700 hover:bg-slate-50 mr-4">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="px-6 py-2 text-xs font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center shadow-sm">
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Jobs Entry
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
