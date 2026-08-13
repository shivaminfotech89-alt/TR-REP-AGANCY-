import React, { useState, useEffect } from 'react';
import { useAgency, AtMaster } from '../lib/AgencyContext';
import { Plus, Trash2, Save, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

export function AtDivisions({ at }: { at: AtMaster }) {
  const { updateAtMaster, activeAgency } = useAgency();
  const [isSaving, setIsSaving] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [divisions, setDivisions] = useState<any[]>([]);

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
          prefixAmorphous: prefixData,
          prefixWoundCore: prefixData,
          prefixLSTC: prefixData,
          prefixOH: prefixData,
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

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const prefixes: Record<string, Record<string, string>> = {};
      
      divisions.forEach(d => {
        if (d.name.trim()) {
          prefixes[d.name.trim()] = {
            'CRGO': d.prefixCRGO.trim(),
            'Amorphous': d.prefixAmorphous.trim() || d.prefixCRGO.trim(),
            'Wound Core': d.prefixWoundCore.trim() || d.prefixCRGO.trim(),
            'LSTC': d.prefixLSTC.trim() || d.prefixCRGO.trim(),
            'OH': d.prefixOH.trim() || d.prefixCRGO.trim(),
          };
        }
      });

      await updateAtMaster(at.id, { prefixes });
      alert("Divisions & Prefixes saved successfully for this AT!");
    } catch (e) {
      alert("Failed to save divisions.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-200">
      <div className="flex justify-between items-end mb-2 border-b border-slate-100 pb-2">
          <button 
            type="button" 
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-700"
          >
            {isExpanded ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
            Divisions & Prefixes (AT Wise)
          </button>
          {isExpanded && (
            <div className="space-x-2">
                <button type="button" onClick={handleAddDivision} className="text-[10px] font-bold uppercase tracking-widest text-blue-600 hover:text-blue-800 flex items-center bg-blue-50 px-2 py-1 rounded inline-flex">
                <Plus className="w-3 h-3 mr-1" /> Add Division
                </button>
            </div>
          )}
        </div>
        
        {isExpanded && (
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
                <div className="space-y-3 border-t border-slate-200 pt-3 mt-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-slate-100 p-2 rounded">
                      <label className="block text-[10px] uppercase font-bold text-slate-700 mb-1">CRGO Config</label>
                      <div className="space-y-2">
                        <div>
                          <label className="block text-[9px] uppercase text-slate-500 mb-0.5">Prefix *</label>
                          <input required type="text" value={div.prefixCRGO} onChange={e => handleDivisionChange(index, 'prefixCRGO', e.target.value)} className="w-full px-2 py-1 text-xs border rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="e.g. 21 IS" />
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-slate-100 p-2 rounded">
                      <label className="block text-[10px] uppercase font-bold text-slate-700 mb-1">Amorphous Config</label>
                      <div className="space-y-2">
                        <div>
                          <label className="block text-[9px] uppercase text-slate-500 mb-0.5">Prefix</label>
                          <input type="text" value={div.prefixAmorphous} onChange={e => handleDivisionChange(index, 'prefixAmorphous', e.target.value)} className="w-full px-2 py-1 text-xs border rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="e.g. AM21 IS" />
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-slate-100 p-2 rounded">
                      <label className="block text-[10px] uppercase font-bold text-slate-700 mb-1">Wound Core Config</label>
                      <div className="space-y-2">
                        <div>
                          <label className="block text-[9px] uppercase text-slate-500 mb-0.5">Prefix</label>
                          <input type="text" value={div.prefixWoundCore} onChange={e => handleDivisionChange(index, 'prefixWoundCore', e.target.value)} className="w-full px-2 py-1 text-xs border rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="e.g. WC21 IS" />
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-100 p-2 rounded">
                      <label className="block text-[10px] uppercase font-bold text-slate-700 mb-1">LSTC Config</label>
                      <div className="space-y-2">
                        <div>
                          <label className="block text-[9px] uppercase text-slate-500 mb-0.5">Prefix</label>
                          <input type="text" value={div.prefixLSTC} onChange={e => handleDivisionChange(index, 'prefixLSTC', e.target.value)} className="w-full px-2 py-1 text-xs border rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="e.g. LSTC21 IS" />
                        </div>
                      </div>
                    </div>
                    <div className="bg-slate-100 p-2 rounded">
                      <label className="block text-[10px] uppercase font-bold text-slate-700 mb-1">O/H Config</label>
                      <div className="space-y-2">
                        <div>
                          <label className="block text-[9px] uppercase text-slate-500 mb-0.5">Prefix</label>
                          <input type="text" value={div.prefixOH} onChange={e => handleDivisionChange(index, 'prefixOH', e.target.value)} className="w-full px-2 py-1 text-xs border rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="e.g. OH21 IS" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => handleRemoveDivision(index)} className="text-slate-400 hover:text-red-600 mt-2">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        )}
        
        {isExpanded && (
            <div className="mt-3 flex justify-end">
                <button type="button" onClick={handleSave} disabled={isSaving} className="flex items-center px-4 py-1.5 text-xs font-bold uppercase bg-slate-800 text-white rounded hover:bg-slate-900">
                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />} Save Divisions & Prefixes
                </button>
            </div>
        )}
    </div>
  );
}
