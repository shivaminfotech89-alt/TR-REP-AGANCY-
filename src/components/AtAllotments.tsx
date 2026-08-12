import React, { useState } from 'react';
import { useAgency, AtMaster } from '../lib/AgencyContext';
import { Plus, Check, Loader2, Save } from 'lucide-react';

export function AtAllotments({ at }: { at: AtMaster }) {
  const { activeAgency, updateAtMaster } = useAgency();
  const [isSaving, setIsSaving] = useState(false);
  const [allotments, setAllotments] = useState<Record<string, Record<string, number>>>(at.allotments || {});

  if (!activeAgency) return null;

  const divisions = Object.keys(activeAgency.prefixes || {});

  const handleAllotmentChange = (division: string, type: string, value: string) => {
    const num = parseInt(value, 10);
    setAllotments(prev => ({
      ...prev,
      [division]: {
        ...(prev[division] || {}),
        [type]: isNaN(num) ? 0 : num
      }
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateAtMaster(at.id, { allotments });
      alert("Allotments updated successfully");
    } catch (e) {
      alert("Failed to update allotments");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-200">
      <h4 className="text-sm font-bold text-slate-700 mb-3">Job Allotment Track (For AT: {at.atNumber})</h4>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
              <th className="p-2 border border-slate-200 font-bold">Division</th>
              <th className="p-2 border border-slate-200 font-bold">CRGO</th>
              <th className="p-2 border border-slate-200 font-bold">Amorphous</th>
              <th className="p-2 border border-slate-200 font-bold">Wound Core</th>
              <th className="p-2 border border-slate-200 font-bold">LSTC / OH</th>
            </tr>
          </thead>
          <tbody>
            {divisions.map(div => {
              const divAllot = allotments[div] || {};
              const usedCRGO = at.lastJobNumbers?.[div] || 0; // Using counter key as proxy for used jobs for now, though it includes LSTC/OH. Wait, true tracking of used jobs should be from actual jobs, but this is a good start. 
              // Actually let's just let them set the allotment. We can do used jobs calculation elsewhere.
              return (
                <tr key={div} className="text-sm">
                  <td className="p-2 border border-slate-200 font-semibold">{div}</td>
                  <td className="p-2 border border-slate-200">
                    <input type="number" value={divAllot['CRGO'] || ''} onChange={(e) => handleAllotmentChange(div, 'CRGO', e.target.value)} className="w-full px-2 py-1 text-xs border rounded" placeholder="Total CRGO Allotment" />
                  </td>
                  <td className="p-2 border border-slate-200">
                    <input type="number" value={divAllot['Amorphous'] || ''} onChange={(e) => handleAllotmentChange(div, 'Amorphous', e.target.value)} className="w-full px-2 py-1 text-xs border rounded" placeholder="Total AM Allotment" />
                  </td>
                  <td className="p-2 border border-slate-200">
                    <input type="number" value={divAllot['Wound Core'] || ''} onChange={(e) => handleAllotmentChange(div, 'Wound Core', e.target.value)} className="w-full px-2 py-1 text-xs border rounded" placeholder="Total WC Allotment" />
                  </td>
                  <td className="p-2 border border-slate-200 text-slate-400 text-xs italic">
                    No fixed allotment
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex justify-end">
        <button onClick={handleSave} disabled={isSaving} className="flex items-center px-4 py-1.5 text-xs font-bold uppercase bg-slate-800 text-white rounded hover:bg-slate-900">
          {isSaving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />} Save Allotments
        </button>
      </div>
    </div>
  );
}
