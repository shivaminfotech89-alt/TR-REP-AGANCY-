import { AtSettings } from './AtSettings';
import React, { useState, useRef } from 'react';
import { useAgency } from '../lib/AgencyContext';
import { useTheme } from '../lib/ThemeContext';
import EditAgencyForm from "./EditAgencyForm";
import { Loader2, Plus, Building, Trash2, FileUp, DatabaseZap, Palette, Check, Sparkles } from 'lucide-react';
import { collection, query, where, getDocs, doc, writeBatch } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';

export default function AgencySettings() {
  const { agencies, activeAgency, setActiveAgencyId, addAgency, updateAgency, loading } = useAgency();
  const { currentTheme, themeId, setThemeId, availableThemes } = useTheme();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAgencyName, setNewAgencyName] = useState('');
  
  const [address, setAddress] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const [migrating, setMigrating] = useState(false);
  const handleMigrateData = async () => {
    if (!activeAgency || !auth.currentUser) return;
    if (!confirm('This will move ALL your existing jobs to ' + activeAgency.name + '. Continue?')) return;
    
    setMigrating(true);
    try {
      const q = query(collection(db, 'jobs'), where('ownerId', '==', auth.currentUser.uid));
      const snapshot = await getDocs(q);
      
      let batch = writeBatch(db);
      let count = 0;
      
      snapshot.docs.forEach((document) => {
        const data = document.data();
        if (data.agencyId !== activeAgency.id) {
          batch.update(doc(db, 'jobs', document.id), { agencyId: activeAgency.id });
          count++;
          if (count === 450) {
            batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
      });
      
      if (count > 0) await batch.commit();
      alert('Successfully moved ' + snapshot.docs.length + ' jobs to ' + activeAgency.name);
    } catch (err) {
      console.error(err);
      alert('Failed to migrate data');
    }
    setMigrating(false);
  };

  
  // Dynamic divisions state
  const [divisions, setDivisions] = useState([{ 
    name: 'SABARMATI', 
    prefixCRGO: '21 IS',
    prefixAmorphous: 'AM21 IS',
    prefixWoundCore: 'WC21 IS',
    prefixLSTC: 'LS21 IS',
    prefixOH: 'OH21 IS',
    allotmentCRGO: '20',
    allotmentAmorphous: '15',
    allotmentWoundCore: '10'
  }]);
  
  // Base64 file string for letterhead
  const [letterheadBase64, setLetterheadBase64] = useState('');
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        setLetterheadBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddDivision = () => {
    setDivisions([...divisions, { name: '', prefixCRGO: '', prefixAmorphous: '', prefixWoundCore: '', prefixLSTC: '', prefixOH: '', allotmentCRGO: '', allotmentAmorphous: '', allotmentWoundCore: '' }]);
  };

  const handleRemoveDivision = (index: number) => {
    if (divisions.length === 1) return;
    const newDivs = [...divisions];
    newDivs.splice(index, 1);
    setDivisions(newDivs);
  };

  const handleDivisionChange = (index: number, field: string, value: string) => {
    const newDivs = [...divisions];
    (newDivs[index] as any)[field] = value.toUpperCase(); // Normalize names to uppercase
    setDivisions(newDivs);
  };

  const handleAddAgency = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const prefixes: Record<string, Record<string, string>> = {};
      const allotments: Record<string, Record<string, number>> = {};
      const lastJobNumbers: Record<string, number> = {};
      
      divisions.forEach(d => {
        if (d.name.trim() && d.prefixCRGO.trim()) {
          prefixes[d.name.trim()] = {
            'CRGO': d.prefixCRGO.trim(),
            'Amorphous': d.prefixAmorphous.trim() || d.prefixCRGO.trim(),
            'Wound Core': d.prefixWoundCore.trim() || d.prefixCRGO.trim(),
            'LSTC': d.prefixLSTC.trim() || d.prefixCRGO.trim(),
            'OH': d.prefixOH.trim() || d.prefixCRGO.trim(),
          };
          allotments[d.name.trim()] = {
            'CRGO': Number(d.allotmentCRGO) || 0,
            'Amorphous': Number(d.allotmentAmorphous) || 0,
            'Wound Core': Number(d.allotmentWoundCore) || 0,
          };
          lastJobNumbers[d.name.trim()] = 0;
          lastJobNumbers[d.name.trim() + '_OH'] = 0;
        }
      });

      await addAgency({
        name: newAgencyName,
        letterheadUrl: letterheadBase64,
        agencyState: 'Gujarat',
        agencyStateCode: '24',
        discomName: 'Uttar Gujarat Vij Company Ltd.',
        discomGstin: '24AAACU6551F1ZI',
        discomPan: 'AAACU6551F',
        discomAddress: 'Registered Office: Sardar Patel Vidyut Bhavan, Race Course, Vadodara - 390007',
        discomState: 'Gujarat',
        discomStateCode: '24',
        serviceSacCode: '998719',
        circleOfficeName: 'SABARMATI',
        circleAuthority: 'Superintending Engineer (O & M)',
        divisionAuthority: 'The Executive Engineer',
        estimateCcTemplate: 'E. E. (O & M) DIVISION - {division}',
        forwardingSubject: 'Submiting Inspection Report & Estimate of Transformer',
        gpValidationMonths: 18,
        prefixes,
        lastJobNumbers,
        allotments,
        address,
        gstin,
        pan,
        bankName,
        accountNumber,
        ifscCode,
        email,
        phone
      });
      
      setShowAddForm(false);
      setNewAgencyName('');
      setAddress('');
      setGstin('');
      setPan('');
      setBankName('');
      setAccountNumber('');
      setIfscCode('');
      setEmail('');
      setPhone('');
      setLetterheadBase64('');
      setFileName('');
      setDivisions([{ name: 'SABARMATI', prefix: '21 IS' }]);
    } catch (err) {
      console.error(err);
      alert('Failed to add agency');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return <Loader2 className="w-6 h-6 animate-spin mx-auto mt-10 text-blue-600" />;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Visual Theme Customizer Card */}
      <div className="bg-white p-6 rounded-xl shadow-xs border border-slate-200">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-lg shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Next-Gen Themes & Appearance</h2>
              <p className="text-xs text-slate-500">Personalize color theme, cyber accents, and workspace canvas</p>
            </div>
          </div>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1.5">
            <span 
              className="w-2.5 h-2.5 rounded-full border border-slate-300 shadow-2xs" 
              style={{ backgroundColor: currentTheme.previewColors.accent }}
            />
            {currentTheme.name}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-4">
          {availableThemes.map(t => {
            const isSelected = t.id === themeId;
            return (
              <div
                key={t.id}
                onClick={() => setThemeId(t.id)}
                className={`p-3 rounded-lg border-2 cursor-pointer transition-all flex items-center justify-between ${
                  isSelected 
                    ? 'border-blue-600 bg-blue-50/50 shadow-xs ring-1 ring-blue-600/30' 
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 bg-white'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex items-center -space-x-1 shadow-2xs rounded overflow-hidden border border-slate-300 shrink-0 p-0.5 bg-white">
                    <span className="w-4 h-5 rounded-l-xs" style={{ backgroundColor: t.previewColors.sidebar }} />
                    <span className="w-3 h-5" style={{ backgroundColor: t.previewColors.accent }} />
                    <span className="w-3 h-5 rounded-r-xs border-l border-slate-200" style={{ backgroundColor: t.previewColors.canvas }} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="block text-xs font-bold text-slate-900 truncate">{t.name}</span>
                      {t.tag && (
                        <span 
                          className="text-[8px] font-black px-1 py-0.2 rounded uppercase"
                          style={{
                            backgroundColor: `${t.previewColors.accent}20`,
                            color: t.previewColors.accent
                          }}
                        >
                          {t.tag}
                        </span>
                      )}
                    </div>
                    <span className="block text-[10px] text-slate-500 truncate">{t.category}</span>
                  </div>
                </div>
                {isSelected && (
                  <Check className="w-4 h-4 text-blue-600 stroke-[3] shrink-0 ml-1" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white p-6 rounded shadow-sm border border-slate-200">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Switch Agency</h2>
        {agencies.length === 0 ? (
          <p className="text-sm text-slate-500 mb-4">No agencies found. Please create one.</p>
        ) : (
          <div className="space-y-3">
            {agencies.map(agency => (
              <div 
                key={agency.id} 
                onClick={() => setActiveAgencyId(agency.id)}
                className={`p-4 rounded border cursor-pointer flex items-center justify-between transition-colors ${activeAgency?.id === agency.id ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-500' : 'bg-slate-50 border-slate-200 hover:border-blue-300'}`}
              >
                <div className="flex items-center space-x-3">
                  <Building className={`w-5 h-5 ${activeAgency?.id === agency.id ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span className="font-bold text-slate-700">{agency.name}</span>
                </div>
                {activeAgency?.id === agency.id && <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600 bg-blue-100 px-2 py-1 rounded">Active</span>}
              </div>
            ))}
          </div>
        )}
        <div className="mt-6 pt-4 border-t border-slate-200">
           <button onClick={handleMigrateData} disabled={migrating} className="flex items-center space-x-2 text-sm text-slate-600 hover:text-blue-600 bg-slate-50 px-4 py-2 rounded border border-slate-200 hover:border-blue-300 transition-colors">
              <DatabaseZap className="w-4 h-4" />
              <span>{migrating ? 'Moving data...' : 'Move ALL My Data To Active Agency'}</span>
           </button>
           <p className="text-[10px] text-slate-400 mt-2">Use this if your older jobs are not showing up in the current agency.</p>
        </div>
        
        {activeAgency && (
          <div className="mt-8 border-t border-slate-200 pt-6">
            <h3 className="text-md font-bold text-slate-900 mb-4">Edit Active Agency: {activeAgency.name}</h3>
            <EditAgencyForm agency={activeAgency} />
          </div>
        )}
      </div>
      
      {activeAgency && (
        <AtSettings />
      )}

      <div className="bg-white p-6 rounded shadow-sm border border-slate-200">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-slate-900">Add New Agency</h2>
          {!showAddForm && (
            <button onClick={() => setShowAddForm(true)} className="flex items-center px-3 py-1.5 text-xs font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
              <Plus className="w-3 h-3 mr-1" /> Add
            </button>
          )}
        </div>

        {showAddForm && (
          <form onSubmit={handleAddAgency} className="space-y-6 border-t border-slate-100 pt-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Agency Name</label>
              <input required type="text" value={newAgencyName} onChange={e => setNewAgencyName(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" />
            </div>

            <div className="border-t border-slate-200 pt-6 mt-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-800 mb-4">Company Profile (Billing Details)</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Company Address</label>
                  <textarea value={address} onChange={e => setAddress(e.target.value)} rows={3} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="Full address" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">GSTIN</label>
                  <input type="text" value={gstin} onChange={e => setGstin(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="GST Number" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">PAN Number</label>
                  <input type="text" value={pan} onChange={e => setPan(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="PAN Number" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Bank Name</label>
                  <input type="text" value={bankName} onChange={e => setBankName(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="Bank Name" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Account Number</label>
                  <input type="text" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="Account Number" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">IFSC Code</label>
                  <input type="text" value={ifscCode} onChange={e => setIfscCode(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="IFSC Code" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="Email Address" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Phone Number</label>
                  <input type="text" value={phone} onChange={e => setPhone(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="Phone Number" />
                </div>
              </div>
            </div>
            
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Letterhead (PDF)</label>
              <input 
                type="file" 
                accept="application/pdf"
                ref={fileInputRef}
                onChange={handleFileChange} 
                className="hidden" 
              />
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-widest bg-slate-100 text-slate-700 rounded border border-slate-300 hover:bg-slate-200 transition-colors flex items-center"
                >
                  <FileUp className="w-4 h-4 mr-2" /> Upload PDF
                </button>
                {fileName && <span className="text-sm text-slate-600 truncate">{fileName}</span>}
              </div>
            </div>
            
            <div>
              <div className="flex justify-between items-end mb-2 border-b border-slate-100 pb-2">
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500">Divisions & Prefixes</label>
                <button type="button" onClick={handleAddDivision} className="text-[10px] font-bold uppercase tracking-widest text-blue-600 hover:text-blue-800 flex items-center bg-blue-50 px-2 py-1 rounded">
                  <Plus className="w-3 h-3 mr-1" /> Add Division
                </button>
              </div>
              <div className="space-y-3">
                {divisions.map((div, index) => (
                  <div key={index} className="flex items-start space-x-3 p-3 bg-slate-50 border border-slate-200 rounded">
                    <div className="flex-1 space-y-2">
                      <input 
                        required 
                        type="text" 
                        value={div.name} 
                        onChange={e => handleDivisionChange(index, 'name', e.target.value)} 
                        className="w-full px-4 py-2 text-sm font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" 
                        placeholder="Division Name (e.g. SABARMATI)" 
                      />
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div>
                          <label className="block text-[9px] uppercase font-bold text-slate-500 mb-0.5">CRGO Prefix *</label>
                          <input 
                            required 
                            type="text" 
                            value={div.prefixCRGO} 
                            onChange={e => handleDivisionChange(index, 'prefixCRGO', e.target.value)} 
                            className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" 
                            placeholder="e.g. 21 IS" 
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase font-bold text-slate-500 mb-0.5">Amorphous Prefix</label>
                          <input 
                            type="text" 
                            value={div.prefixAmorphous} 
                            onChange={e => handleDivisionChange(index, 'prefixAmorphous', e.target.value)} 
                            className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" 
                            placeholder="e.g. AM21 IS" 
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase font-bold text-slate-500 mb-0.5">Wound Core Prefix</label>
                          <input 
                            type="text" 
                            value={div.prefixWoundCore} 
                            onChange={e => handleDivisionChange(index, 'prefixWoundCore', e.target.value)} 
                            className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" 
                            placeholder="e.g. WC21 IS" 
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase font-bold text-slate-500 mb-0.5">LSTC Prefix</label>
                          <input 
                            type="text" 
                            value={div.prefixLSTC} 
                            onChange={e => handleDivisionChange(index, 'prefixLSTC', e.target.value)} 
                            className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" 
                            placeholder="e.g. LS21 IS" 
                          />
                        </div>
                      </div>
                    </div>
                    {divisions.length > 1 && (
                      <button type="button" onClick={() => handleRemoveDivision(index)} className="p-2 mt-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end space-x-2">
              <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-100 rounded transition-colors">Cancel</button>
              <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-xs font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center">
                {isSubmitting && <Loader2 className="w-3 h-3 mr-2 animate-spin" />} Save Agency
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
