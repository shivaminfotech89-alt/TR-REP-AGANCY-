import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { ArrowLeft, Loader2 } from 'lucide-react';

import { useAgency } from '../lib/AgencyContext';
import { auth } from '../lib/firebase';

export default function EditJob() {
  const { activeAgency } = useAgency();
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [formData, setFormData] = useState({
    make: '',
    capacityKva: '',
    coreType: 'CRGO',
    serialNo: ''
  });
  const [jobNo, setJobNo] = useState('');

  useEffect(() => {
    async function fetchJob() {
      if (!jobId) return;
      try {
        const docRef = doc(db, 'jobs', jobId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.ownerId !== auth.currentUser?.uid || data.agencyId !== activeAgency?.id) {
            alert('Unauthorized');
            navigate('/');
            return;
          }
          setJobNo(data.jobNo || '');
          setFormData({
            make: data.make || '',
            capacityKva: data.capacityKva ? String(data.capacityKva) : '',
            coreType: data.coreType || 'CRGO',
            serialNo: data.serialNo || ''
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'jobs');
      } finally {
        setInitialLoading(false);
      }
    }
    fetchJob();
  }, [jobId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobId) return;
    setLoading(true);
    try {
      const docRef = doc(db, 'jobs', jobId);
      await updateDoc(docRef, {
        make: formData.make,
        capacityKva: Number(formData.capacityKva),
        coreType: formData.coreType,
        serialNo: formData.serialNo,
        updatedAt: Date.now()
      });
      navigate('/');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'jobs');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <Link to="/" className="p-2 bg-white rounded-full shadow-sm border border-slate-200 hover:bg-slate-50">
            <ArrowLeft className="w-4 h-4 text-slate-600" />
          </Link>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Edit Job: {jobNo}</h1>
        </div>
      </div>

      <div className="bg-white p-6 md:p-8 rounded shadow-sm border border-slate-200">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Make</label>
              <input
                required
                type="text"
                name="make"
                value={formData.make}
                onChange={handleChange}
                className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">KVA</label>
              <input
                required
                type="number"
                name="capacityKva"
                value={formData.capacityKva}
                onChange={handleChange}
                className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Serial No.</label>
              <input
                type="text"
                name="serialNo"
                value={formData.serialNo}
                onChange={handleChange}
                className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Job Type</label>
              <select
                name="coreType"
                value={formData.coreType}
                onChange={handleChange}
                className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-slate-50"
              >
                <option value="CRGO">CRGO</option>
                <option value="Amorphous">Amorphous</option>
                <option value="Wound Core">Wound Core</option>
                <option value="LSTC">LSTC</option>\n                <option value="OH">OH (Overhauling)</option>
              </select>
            </div>
          </div>
          
          <div className="pt-6 flex justify-end">
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 text-[10px] font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center shadow-sm"
            >
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
