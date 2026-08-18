import { AtSettings } from './AtSettings';
import React, { useState, useRef } from 'react';
import { useAgency } from '../lib/AgencyContext';
import EditAgencyForm from "./EditAgencyForm";
import { Loader2, Plus, Building, Trash2, FileUp, DatabaseZap, CheckCircle2, AlertTriangle, ArrowRight, Layers, FileText } from 'lucide-react';
import { collection, query, where, getDocs, doc, writeBatch } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { validateDivisionPrefixes } from '../lib/prefixValidation';
import { LetterheadCalibrator } from './LetterheadCalibrator';

export default function AgencySettings() {
  const { agencies, activeAgency, setActiveAgencyId, addAgency, updateAgency, loading, atMasters } = useAgency();
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

  // Letterhead Layout & Calibrator States
  const [letterheadBase64, setLetterheadBase64] = useState('');
  const [letterheadMode, setLetterheadMode] = useState<'full_a4' | 'header_only' | 'standard'>('full_a4');
  const [headerHeightMm, setHeaderHeightMm] = useState<number>(38);
  const [footerHeightMm, setFooterHeightMm] = useState<number>(24);
  const [marginLeftMm, setMarginLeftMm] = useState<number>(12);
  const [marginRightMm, setMarginRightMm] = useState<number>(12);

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
  
  const [isSubmitting, setIsSubmitting] = useState(false);

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

    const validation = validateDivisionPrefixes(divisions);
    if (!validation.isValid) {
      alert(`Cannot create agency due to division prefix validation error:\n\n${validation.errors.join('\n')}`);
      return;
    }

    setIsSubmitting(true);
    try {
      const prefixes: Record<string, Record<string, string>> = {};
      const allotments: Record<string, Record<string, number>> = {};
      const lastJobNumbers: Record<string, number> = {};
      
      divisions.forEach(d => {
        if (d.name.trim() && d.prefixCRGO.trim()) {
          const divName = d.name.trim();
          prefixes[divName] = {
            'CRGO': d.prefixCRGO.trim(),
            'Amorphous': (d.prefixAmorphous || '').trim(),
            'Wound Core': (d.prefixWoundCore || '').trim(),
            'LSTC': (d.prefixLSTC || '').trim(),
            'OH': (d.prefixOH || '').trim(),
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
        letterheadMode,
        letterheadHeaderHeightMm: headerHeightMm,
        letterheadFooterHeightMm: footerHeightMm,
        letterheadMarginLeftMm: marginLeftMm,
        letterheadMarginRightMm: marginRightMm,
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
      <div className="bg-white p-6 rounded-xl shadow-xs border border-slate-200">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Switch Agency</h2>
        {agencies.length === 0 ? (
          <p className="text-sm text-slate-500 mb-4">No agencies found. Please create one.</p>
        ) : (
          <div className="space-y-3">
            {agencies.map(agency => {
              const isActive = activeAgency?.id === agency.id;
              const divisionCount = Object.keys(agency.prefixes || {}).length;
              const atCount = atMasters.filter(at => at.agencyId === agency.id).length;
              const warnings: string[] = [];
              if (divisionCount === 0) warnings.push('No divisions');
              if (atCount === 0) warnings.push('No AT period');
              if (!agency.gstin) warnings.push('No GSTIN');

              return (
                <div
                  key={agency.id}
                  onClick={() => setActiveAgencyId(agency.id)}
                  className={`group relative p-4 rounded-xl border border-l-4 cursor-pointer transition-colors ${
                    isActive
                      ? 'border-l-blue-600 border-blue-200 bg-blue-50/70'
                      : 'border-l-transparent border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <Building className={`w-5 h-5 mt-0.5 shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-slate-900 truncate">{agency.name}</h3>
                          {isActive && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-white bg-blue-600 px-2 py-0.5 rounded-full shrink-0">
                              <CheckCircle2 className="w-3 h-3" />
                              Currently open
                            </span>
                          )}
                        </div>

                        <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Layers className="w-3.5 h-3.5" />
                            {divisionCount} division{divisionCount === 1 ? '' : 's'}
                          </span>
                          <span className="flex items-center gap-1">
                            <FileText className="w-3.5 h-3.5" />
                            {atCount} AT{atCount === 1 ? '' : 's'}
                          </span>
                        </div>

                        {(agency.gstin || agency.discomName) && (
                          <div className="mt-1.5 text-[11px] text-slate-500 space-y-0.5">
                            {agency.gstin && <div>GSTIN: {agency.gstin}</div>}
                            {agency.discomName && <div className="truncate">{agency.discomName}</div>}
                          </div>
                        )}

                        {warnings.length > 0 && (
                          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                            {warnings.map(w => (
                              <span key={w} className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                                <AlertTriangle className="w-3 h-3" />
                                {w}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {!isActive && (
                      <span className="hidden group-hover:flex items-center gap-1 text-xs font-bold text-blue-600 shrink-0 self-center whitespace-nowrap">
                        Switch to this <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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

              <div className="space-y-5">
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Identity</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Company Address</label>
                      <textarea value={address} onChange={e => setAddress(e.target.value)} rows={3} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="Full address" />
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
                  <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Tax details</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">GSTIN</label>
                      <input type="text" value={gstin} onChange={e => setGstin(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="GST Number" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">PAN Number</label>
                      <input type="text" value={pan} onChange={e => setPan(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="PAN Number" />
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Bank details</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <LetterheadCalibrator
                letterheadUrl={letterheadBase64}
                letterheadMode={letterheadMode}
                headerHeightMm={headerHeightMm}
                footerHeightMm={footerHeightMm}
                marginLeftMm={marginLeftMm}
                marginRightMm={marginRightMm}
                agencyName={newAgencyName}
                onLetterheadChange={setLetterheadBase64}
                onModeChange={setLetterheadMode}
                onHeaderHeightChange={setHeaderHeightMm}
                onFooterHeightChange={setFooterHeightMm}
                onMarginLeftChange={setMarginLeftMm}
                onMarginRightChange={setMarginRightMm}
              />
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

      {activeAgency && (
        <div className="bg-white p-6 rounded-xl shadow-xs border border-slate-200">
          <h3 className="text-md font-bold text-slate-900 mb-4">Edit Active Agency: {activeAgency.name}</h3>
          <EditAgencyForm agency={activeAgency} />
        </div>
      )}

      {activeAgency && (
        <AtSettings />
      )}

      <div className="bg-white p-6 rounded-xl shadow-xs border border-slate-200">
        <h2 className="text-lg font-bold text-slate-900 mb-1">Data Tools</h2>
        <p className="text-xs text-slate-500 mb-4">Rarely-needed maintenance actions.</p>
        <button onClick={handleMigrateData} disabled={migrating} className="flex items-center space-x-2 text-sm text-slate-600 hover:text-blue-600 bg-slate-50 px-4 py-2 rounded-lg border border-slate-200 hover:border-blue-300 transition-colors">
          <DatabaseZap className="w-4 h-4" />
          <span>{migrating ? 'Moving data...' : 'Move ALL My Data To Active Agency'}</span>
        </button>
        <p className="text-[10px] text-slate-400 mt-2">Use this if your older jobs are not showing up in the current agency.</p>
      </div>
    </div>
  );
}
