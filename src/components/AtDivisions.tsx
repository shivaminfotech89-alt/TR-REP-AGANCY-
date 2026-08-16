import React, { useState, useEffect } from 'react';
import { useAgency, AtMaster } from '../lib/AgencyContext';
import { Plus, Trash2, Save, Loader2, ChevronDown, ChevronUp, Layers, Check, ShieldCheck } from 'lucide-react';

export function AtDivisions({ at: propAt }: { at?: AtMaster }) {
  const { updateAtMaster, activeAgency, atMasters, activeAtMaster, setActiveAtMasterId, updateAgency } = useAgency();
  const [isSaving, setIsSaving] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [divisions, setDivisions] = useState<any[]>([]);

  // Selected AT for division configuration
  const currentAt = propAt || activeAtMaster || atMasters.find(a => a.agencyId === activeAgency?.id && a.status === 'Active') || atMasters.find(a => a.agencyId === activeAgency?.id);

  useEffect(() => {
    const divs: any[] = [];
    const sourcePrefixes = currentAt?.prefixes && Object.keys(currentAt.prefixes).length > 0 
        ? currentAt.prefixes 
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
  }, [currentAt, activeAgency]);

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

      if (currentAt) {
        await updateAtMaster(currentAt.id, { prefixes });
      }
      if (activeAgency) {
        await updateAgency(activeAgency.id, { prefixes });
      }
      alert("Divisions & Prefixes saved successfully!");
    } catch (e) {
      alert("Failed to save divisions.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!activeAgency) return null;

  const agencyAts = atMasters.filter(a => a.agencyId === activeAgency.id);

  return (
    <div className="bg-white p-6 rounded-xl shadow-xs border border-slate-200">
      {/* Header with Title and Minimize/Expand Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-cyan-500 to-blue-600 text-white rounded-lg shadow-xs shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Divisions & Prefixes (AT Wise)</h2>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                {divisions.length} Divisions
              </span>
            </div>
            <p className="text-xs text-slate-500">Configure Division names, CRGO, Amorphous, Wound Core, LSTC & O/H prefixes</p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {/* AT Switcher if multiple ATs exist */}
          {agencyAts.length > 1 && (
            <select
              value={currentAt?.id || ''}
              onChange={(e) => setActiveAtMasterId(e.target.value)}
              className="py-1 px-2.5 text-xs font-semibold border border-slate-300 rounded-lg bg-slate-50 text-slate-700 outline-none"
            >
              {agencyAts.map(at => (
                <option key={at.id} value={at.id}>
                  AT: {at.atNumber} {at.name ? `(${at.name})` : ''}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
              isExpanded 
                ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-300' 
                : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200 shadow-2xs'
            }`}
          >
            {isExpanded ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>Minimise</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>Expand & Edit</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Minimized Summary View */}
      {!isExpanded && (
        <div className="pt-3">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span className="font-semibold text-slate-700 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
              Active AT: <strong className="text-slate-900">{currentAt?.atNumber || 'Default Agency Prefixes'}</strong>
            </span>
            <span>Click "Expand & Edit" to modify</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {divisions.map((div, i) => (
              <div 
                key={i} 
                className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs flex items-center gap-1.5"
              >
                <span className="font-bold text-slate-800">{div.name || 'Unnamed'}</span>
                <span className="text-[11px] font-mono text-blue-600 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
                  {div.prefixCRGO || 'No Prefix'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expanded Table & Configuration Form */}
      {isExpanded && (
        <div className="pt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-600">
              Editing Prefixes for: <strong className="text-blue-700">{currentAt?.atNumber || activeAgency.name}</strong>
            </div>
            <button 
              type="button" 
              onClick={handleAddDivision} 
              className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg border border-blue-200 transition-colors"
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> Add Division
            </button>
          </div>

          <div className="space-y-3">
            {divisions.map((div, index) => (
              <div key={index} className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1">
                    <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Division Name</label>
                    <input 
                      required 
                      type="text" 
                      value={div.name} 
                      onChange={e => handleDivisionChange(index, 'name', e.target.value)} 
                      className="w-full px-3 py-1.5 text-xs font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white uppercase" 
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

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 pt-2 border-t border-slate-200">
                  <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                    <label className="block text-[9px] uppercase font-black text-blue-700 mb-0.5">CRGO Prefix *</label>
                    <input 
                      required 
                      type="text" 
                      value={div.prefixCRGO} 
                      onChange={e => handleDivisionChange(index, 'prefixCRGO', e.target.value)} 
                      className="w-full px-2 py-1 text-xs border border-slate-200 rounded font-semibold focus:ring-1 focus:ring-blue-500 bg-slate-50/50" 
                      placeholder="e.g. 21 IS" 
                    />
                  </div>

                  <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                    <label className="block text-[9px] uppercase font-bold text-slate-600 mb-0.5">Amorphous Prefix</label>
                    <input 
                      type="text" 
                      value={div.prefixAmorphous} 
                      onChange={e => handleDivisionChange(index, 'prefixAmorphous', e.target.value)} 
                      className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50/50" 
                      placeholder="e.g. AM21 IS" 
                    />
                  </div>

                  <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                    <label className="block text-[9px] uppercase font-bold text-slate-600 mb-0.5">Wound Core Prefix</label>
                    <input 
                      type="text" 
                      value={div.prefixWoundCore} 
                      onChange={e => handleDivisionChange(index, 'prefixWoundCore', e.target.value)} 
                      className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50/50" 
                      placeholder="e.g. WC21 IS" 
                    />
                  </div>

                  <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                    <label className="block text-[9px] uppercase font-bold text-slate-600 mb-0.5">LSTC Prefix</label>
                    <input 
                      type="text" 
                      value={div.prefixLSTC} 
                      onChange={e => handleDivisionChange(index, 'prefixLSTC', e.target.value)} 
                      className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50/50" 
                      placeholder="e.g. LS21 IS" 
                    />
                  </div>

                  <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                    <label className="block text-[9px] uppercase font-bold text-slate-600 mb-0.5">O/H Prefix</label>
                    <input 
                      type="text" 
                      value={div.prefixOH} 
                      onChange={e => handleDivisionChange(index, 'prefixOH', e.target.value)} 
                      className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50/50" 
                      placeholder="e.g. OH21 IS" 
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="px-3.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Minimise Table
            </button>
            <button 
              type="button" 
              onClick={handleSave} 
              disabled={isSaving} 
              className="flex items-center px-4 py-2 text-xs font-bold uppercase bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-xs transition-colors"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Save className="w-3.5 h-3.5 mr-1.5" />} 
              Save Divisions & Prefixes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

