import React, { useState, useRef, useEffect } from 'react';
import { useAgency } from '../lib/AgencyContext';
import { CIRCLE_OFFICE_APPROVAL_LIMITS_11KV } from '../lib/contractRates';
import { Loader2, Plus, Building, Trash2, FileUp, Save } from 'lucide-react';

export default function AgencySettings() {
  const { agencies, activeAgency, setActiveAgencyId, addAgency, updateAgency, loading } = useAgency();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAgencyName, setNewAgencyName] = useState('');
  const [divisions, setDivisions] = useState([{ name: 'SABARMATI', prefix: '21 IS' }]);
  const [letterheadBase64, setLetterheadBase64] = useState('');
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [profile, setProfile] = useState({
    address: '',
    phone: '',
    email: '',
    gstNo: '',
    panNo: '',
    bankName: '',
    bankAccNo: '',
    bankIfsc: '',
    orderNo: '',
  });

  const [limits, setLimits] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!activeAgency) return;
    setProfile({
      address: activeAgency.address || '',
      phone: activeAgency.phone || '',
      email: activeAgency.email || '',
      gstNo: activeAgency.gstNo || '',
      panNo: activeAgency.panNo || '',
      bankName: activeAgency.bankName || '',
      bankAccNo: activeAgency.bankAccNo || '',
      bankIfsc: activeAgency.bankIfsc || '',
      orderNo: activeAgency.orderNo || '',
    });
    const base = { ...CIRCLE_OFFICE_APPROVAL_LIMITS_11KV, ...(activeAgency.circleOfficeLimits || {}) };
    const asStr: Record<string, string> = {};
      Object.entries(base).forEach(([k, v]) => {
      asStr[k] = String(v as number);
    });
    setLimits(asStr);
  }, [activeAgency]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onloadend = () => setLetterheadBase64(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleAddAgency = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const prefixes: Record<string, string> = {};
      const lastJobNumbers: Record<string, number> = {};
      divisions.forEach((d) => {
        if (d.name.trim() && d.prefix.trim()) {
          prefixes[d.name.trim()] = d.prefix.trim();
          lastJobNumbers[d.name.trim()] = 0;
        }
      });
      await addAgency({
        name: newAgencyName,
        letterheadUrl: letterheadBase64,
        prefixes,
        lastJobNumbers,
        circleOfficeLimits: { ...CIRCLE_OFFICE_APPROVAL_LIMITS_11KV },
        lastEstimateNo: 0,
        lastBillNo: 0,
        lastChallanNo: 0,
        lastExtInspNo: 0,
        lastIntInspNo: 0,
      });
      setShowAddForm(false);
      setNewAgencyName('');
      setLetterheadBase64('');
      setFileName('');
      setDivisions([{ name: 'SABARMATI', prefix: '21 IS' }]);
    } catch {
      alert('Failed to add agency');
    } finally {
      setIsSubmitting(false);
    }
  };

  const saveProfile = async () => {
    if (!activeAgency) return;
    setSavingProfile(true);
    try {
      const circleOfficeLimits: Record<string, number> = {};
      Object.entries(limits).forEach(([k, v]) => {
        const n = parseFloat(String(v));
        if (!isNaN(n)) circleOfficeLimits[k] = n;
      });
      await updateAgency(activeAgency.id, {
        ...profile,
        circleOfficeLimits,
        letterheadUrl: activeAgency.letterheadUrl || '',
        name: activeAgency.name,
        prefixes: activeAgency.prefixes,
        lastJobNumbers: activeAgency.lastJobNumbers || {},
        lastEstimateNo: activeAgency.lastEstimateNo || 0,
        lastBillNo: activeAgency.lastBillNo || 0,
        lastChallanNo: activeAgency.lastChallanNo || 0,
        lastExtInspNo: activeAgency.lastExtInspNo || 0,
        lastIntInspNo: activeAgency.lastIntInspNo || 0,
      });
      alert('Agency profile saved');
    } catch {
      alert('Failed to save profile');
    } finally {
      setSavingProfile(false);
    }
  };

  if (loading) return <Loader2 className="w-6 h-6 animate-spin mx-auto mt-10 text-blue-600" />;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-white p-6 rounded shadow-sm border border-slate-200">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Switch Agency</h2>
        {agencies.length === 0 ? (
          <p className="text-sm text-slate-500 mb-4">No agencies found. Create one for Firebase project TR REP AGANCY.</p>
        ) : (
          <div className="space-y-3">
            {agencies.map((agency) => (
              <div
                key={agency.id}
                onClick={() => setActiveAgencyId(agency.id)}
                className={`p-4 rounded border cursor-pointer flex items-center justify-between ${
                  activeAgency?.id === agency.id ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-500' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <Building className={`w-5 h-5 ${activeAgency?.id === agency.id ? 'text-blue-600' : 'text-slate-400'}`} />
                  <div>
                    <span className="font-bold text-slate-700 block">{agency.name}</span>
                    <span className="text-[10px] text-slate-500">{Object.keys(agency.prefixes || {}).join(', ')}</span>
                  </div>
                </div>
                {activeAgency?.id === agency.id && (
                  <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600 bg-blue-100 px-2 py-1 rounded">Active</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {activeAgency && (
        <div className="bg-white p-6 rounded shadow-sm border border-slate-200 space-y-4">
          <h2 className="text-lg font-bold text-slate-900">Agency Profile · {activeAgency.name}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(
              [
                ['address', 'Address'],
                ['phone', 'Phone'],
                ['email', 'Email'],
                ['gstNo', 'GST No'],
                ['panNo', 'PAN No'],
                ['orderNo', 'Default Order No'],
                ['bankName', 'Bank Name'],
                ['bankAccNo', 'Account No'],
                ['bankIfsc', 'IFSC'],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className={key === 'address' || key === 'orderNo' ? 'md:col-span-2' : ''}>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">{label}</label>
                <input
                  value={profile[key]}
                  onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50"
                />
              </div>
            ))}
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 border-b pb-2">
              Circle Office Estimate Passing Power (₹ by KVA)
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.keys(limits)
                .sort((a, b) => Number(a) - Number(b))
                .map((kva) => (
                  <div key={kva}>
                    <label className="text-[10px] font-bold text-slate-500">{kva} KVA</label>
                    <input
                      type="number"
                      value={limits[kva]}
                      onChange={(e) => setLimits((p) => ({ ...p, [kva]: e.target.value }))}
                      className="w-full mt-1 px-2 py-1.5 text-sm border rounded font-mono"
                    />
                  </div>
                ))}
            </div>
            <button
              type="button"
              onClick={() => {
                const kva = prompt('Add KVA capacity');
                if (kva) setLimits((p) => ({ ...p, [kva]: p[kva] || '0' }));
              }}
              className="mt-2 text-[10px] font-bold uppercase text-blue-600"
            >
              + Add KVA limit
            </button>
          </div>

          <button
            onClick={saveProfile}
            disabled={savingProfile}
            className="px-4 py-2 text-xs font-bold uppercase tracking-widest bg-blue-600 text-white rounded flex items-center gap-2"
          >
            {savingProfile ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save Profile
          </button>
        </div>
      )}

      <div className="bg-white p-6 rounded shadow-sm border border-slate-200">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-slate-900">Add New Agency</h2>
          {!showAddForm && (
            <button onClick={() => setShowAddForm(true)} className="flex items-center px-3 py-1.5 text-xs font-bold uppercase tracking-widest bg-blue-600 text-white rounded">
              <Plus className="w-3 h-3 mr-1" /> Add
            </button>
          )}
        </div>

        {showAddForm && (
          <form onSubmit={handleAddAgency} className="space-y-6 border-t border-slate-100 pt-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Agency Name</label>
              <input required type="text" value={newAgencyName} onChange={(e) => setNewAgencyName(e.target.value)}
                className="w-full px-4 py-2 text-sm border border-slate-300 rounded bg-slate-50" placeholder="Ideal Engineering Co." />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Letterhead (PDF)</label>
              <input type="file" accept="application/pdf,image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
              <div className="flex items-center space-x-3">
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-widest bg-slate-100 text-slate-700 rounded border flex items-center">
                  <FileUp className="w-4 h-4 mr-2" /> Upload
                </button>
                {fileName && <span className="text-sm text-slate-600 truncate">{fileName}</span>}
              </div>
            </div>
            <div>
              <div className="flex justify-between items-end mb-2 border-b border-slate-100 pb-2">
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500">Divisions & Job Prefixes</label>
                <button type="button" onClick={() => setDivisions([...divisions, { name: '', prefix: '' }])}
                  className="text-[10px] font-bold uppercase text-blue-600 bg-blue-50 px-2 py-1 rounded flex items-center">
                  <Plus className="w-3 h-3 mr-1" /> Add Division
                </button>
              </div>
              <div className="space-y-3">
                {divisions.map((div, index) => (
                  <div key={index} className="flex items-center space-x-3">
                    <input required type="text" value={div.name}
                      onChange={(e) => {
                        const n = [...divisions];
                        n[index].name = e.target.value.toUpperCase();
                        setDivisions(n);
                      }}
                      className="flex-1 px-4 py-2 text-sm border rounded bg-slate-50" placeholder="Division (SABARMATI)" />
                    <input required type="text" value={div.prefix}
                      onChange={(e) => {
                        const n = [...divisions];
                        n[index].prefix = e.target.value.toUpperCase();
                        setDivisions(n);
                      }}
                      className="flex-1 px-4 py-2 text-sm border rounded bg-slate-50" placeholder="Prefix (21 IS)" />
                    {divisions.length > 1 && (
                      <button type="button" onClick={() => setDivisions(divisions.filter((_, i) => i !== index))}
                        className="p-2 text-slate-400 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="pt-4 border-t flex justify-end space-x-2">
              <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 text-xs font-bold uppercase text-slate-500">Cancel</button>
              <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-xs font-bold uppercase bg-blue-600 text-white rounded flex items-center">
                {isSubmitting && <Loader2 className="w-3 h-3 mr-2 animate-spin" />} Save Agency
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
