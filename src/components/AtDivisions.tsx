import React, { useState, useEffect } from 'react';
import { useAgency, AtMaster } from '../lib/AgencyContext';
import { Plus, Trash2, Save, Loader2, Check, AlertTriangle, Layers } from 'lucide-react';
import { validateDivisionPrefixes } from '../lib/prefixValidation';

export function AtDivisions({ at }: { at: AtMaster }) {
  const { updateAtMaster, activeAgency, updateAgency } = useAgency();
  const [isSaving, setIsSaving] = useState(false);
  const [divisions, setDivisions] = useState<any[]>([]);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    const divs: any[] = [];
    const sourcePrefixes = at.prefixes && Object.keys(at.prefixes).length > 0 
        ? at.prefixes 
        : (activeAgency?.prefixes || {});

    Object.entries(sourcePrefixes).forEach(([name, prefixData]: [string, any]) => {
      if (typeof prefixData === 'string') {
        divs.push({
          name,
          prefixCRGO: prefixData,
          prefixAmorphous: '',
          prefixWoundCore: '',
          prefixLSTC: '',
          prefixOH: '',
        });
      } else {
        divs.push({
          name,
          prefixCRGO: prefixData['CRGO'] || '',
          prefixAmorphous: prefixData['Amorphous'] || '',
          prefixWoundCore: prefixData['Wound Core'] || '',
          prefixLSTC: prefixData['LSTC'] || '',
          prefixOH: prefixData['OH'] || '',
        });
      }
    });
    
    if (divs.length === 0) {
      divs.push({ name: 'SABARMATI', prefixCRGO: '21 IS', prefixAmorphous: '', prefixWoundCore: '', prefixLSTC: '', prefixOH: '' });
    }
    setDivisions(divs);
  }, [at, activeAgency]);

  const handleAddDivision = () => {
    setDivisions([...divisions, { name: '', prefixCRGO: '', prefixAmorphous: '', prefixWoundCore: '', prefixLSTC: '', prefixOH: '' }]);
  };

  const handleRemoveDivision = (index: number) => {
    if (divisions.length === 1) return;
    const newDivs = [...divisions];
    newDivs.splice(index, 1);
    setDivisions(newDivs);
  };

  const handleDivisionChange = (index: number, field: string, value: string) => {
    const newDivs = [...divisions];
    (newDivs[index] as any)[field] = value.toUpperCase();
    setDivisions(newDivs);
  };

  // Real-time validation result
  const validation = validateDivisionPrefixes(divisions);

  const handleSave = async () => {
    if (!validation.isValid) {
      alert(`Validation Error:\n\n${validation.errors.join('\n')}`);
      return;
    }

    setIsSaving(true);
    try {
      const prefixes: Record<string, Record<string, string>> = {};
      
      divisions.forEach(d => {
        const divName = d.name.trim();
        if (divName) {
          prefixes[divName] = {
            'CRGO': d.prefixCRGO.trim(),
            'Amorphous': (d.prefixAmorphous || '').trim(),
            'Wound Core': (d.prefixWoundCore || '').trim(),
            'LSTC': (d.prefixLSTC || '').trim(),
            'OH': (d.prefixOH || '').trim(),
          };
        }
      });

      await updateAtMaster(at.id, { prefixes });
      if (activeAgency) {
        await updateAgency(activeAgency.id, { prefixes });
      }
      setSaveSuccessMsg(`Divisions & prefixes successfully saved for AT: ${at.atNumber}!`);
      setTimeout(() => setSaveSuccessMsg(null), 5000);
    } catch (e) {
      alert("Failed to save divisions.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-indigo-600" />
            Divisions & Core Prefixes for AT: {at.atNumber}
          </h4>
          <p className="text-[11px] text-slate-500">
            Define division names and unique prefixes for CRGO, Amorphous, Wound Core, LSTC & O/H jobs
          </p>
        </div>
        
        <button 
          type="button" 
          onClick={handleAddDivision} 
          className="text-xs font-bold text-indigo-700 hover:text-indigo-900 flex items-center bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg border border-indigo-200 transition-colors self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5 mr-1" /> Add Division
        </button>
      </div>

      {/* Validation alert banner */}
      {!validation.isValid && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2.5 text-xs text-red-800">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div>
            <strong className="font-bold block mb-0.5">Prefix & Division Validation Alert:</strong>
            <ul className="list-disc list-inside space-y-0.5 text-[11px] text-red-700">
              {validation.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {saveSuccessMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-800 font-bold">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          {saveSuccessMsg}
        </div>
      )}

      <div className="space-y-3">
        {divisions.map((div, index) => {
          const divErr = validation.divisionErrors[index];
          const dupes = divErr?.duplicatePrefixes;

          return (
            <div key={index} className={`p-3.5 rounded-xl space-y-3 border transition-colors ${
              divErr ? 'bg-red-50/40 border-red-300' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[10px] uppercase font-bold text-slate-500">Division Name *</label>
                    {divErr?.nameError && (
                      <span className="text-[10px] text-red-600 font-bold">{divErr.nameError}</span>
                    )}
                  </div>
                  <input 
                    required 
                    type="text" 
                    value={div.name} 
                    onChange={e => handleDivisionChange(index, 'name', e.target.value)} 
                    className={`w-full px-3 py-1.5 text-xs font-bold border rounded-lg uppercase bg-white ${
                      divErr?.nameError ? 'border-red-400 focus:ring-red-400' : 'border-slate-300 focus:ring-indigo-500'
                    }`} 
                    placeholder="e.g. SABARMATI" 
                  />
                </div>
                {divisions.length > 1 && (
                  <button 
                    type="button" 
                    onClick={() => handleRemoveDivision(index)} 
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors self-end"
                    title="Remove Division"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {dupes && dupes.length > 0 && (
                <div className="p-2 bg-amber-50 border border-amber-300 rounded-lg text-[11px] text-amber-900 flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>
                    Duplicate prefix not allowed in same division: <strong className="font-bold font-mono">{dupes.map(d => `"${d.prefix}" (${d.fields.join(' & ')})`).join(', ')}</strong>
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 pt-2 border-t border-slate-200">
                <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                  <label className="block text-[9px] uppercase font-black text-blue-700 mb-0.5">CRGO Prefix *</label>
                  <input 
                    required 
                    type="text" 
                    value={div.prefixCRGO} 
                    onChange={e => handleDivisionChange(index, 'prefixCRGO', e.target.value)} 
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded font-semibold focus:ring-1 focus:ring-indigo-500 bg-slate-50/50" 
                    placeholder="e.g. 21 IS" 
                  />
                </div>

                <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                  <label className="block text-[9px] uppercase font-bold text-amber-700 mb-0.5">Amorphous Prefix</label>
                  <input 
                    type="text" 
                    value={div.prefixAmorphous} 
                    onChange={e => handleDivisionChange(index, 'prefixAmorphous', e.target.value)} 
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 bg-slate-50/50" 
                    placeholder="e.g. AM21 IS" 
                  />
                </div>

                <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                  <label className="block text-[9px] uppercase font-bold text-emerald-700 mb-0.5">Wound Core Prefix</label>
                  <input 
                    type="text" 
                    value={div.prefixWoundCore} 
                    onChange={e => handleDivisionChange(index, 'prefixWoundCore', e.target.value)} 
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 bg-slate-50/50" 
                    placeholder="e.g. WC21 IS" 
                  />
                </div>

                <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                  <label className="block text-[9px] uppercase font-bold text-purple-700 mb-0.5">LSTC Prefix</label>
                  <input 
                    type="text" 
                    value={div.prefixLSTC} 
                    onChange={e => handleDivisionChange(index, 'prefixLSTC', e.target.value)} 
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 bg-slate-50/50" 
                    placeholder="e.g. LS21 IS" 
                  />
                </div>

                <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                  <label className="block text-[9px] uppercase font-bold text-slate-600 mb-0.5">O/H Prefix</label>
                  <input 
                    type="text" 
                    value={div.prefixOH} 
                    onChange={e => handleDivisionChange(index, 'prefixOH', e.target.value)} 
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 bg-slate-50/50" 
                    placeholder="e.g. OH21 IS" 
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end pt-2">
        <button 
          type="button" 
          onClick={handleSave} 
          disabled={isSaving} 
          className="flex items-center px-4 py-2 text-xs font-bold uppercase bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-xs transition-colors"
        >
          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Save className="w-3.5 h-3.5 mr-1.5" />} 
          Save Divisions & Prefixes
        </button>
      </div>
    </div>
  );
}
