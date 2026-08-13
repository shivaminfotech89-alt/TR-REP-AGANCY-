const fs = require('fs');

const code = `import React, { useState } from 'react';
import { useAgency, AtMaster, AllotmentRecord } from '../lib/AgencyContext';
import { Plus, Check, Loader2, Save, FileText, History } from 'lucide-react';

export function AtAllotments({ at }: { at: AtMaster }) {
  const { activeAgency, updateAtMaster, updateAgency } = useAgency();
  const [isSaving, setIsSaving] = useState(false);
  
  // State for manual net allotments (sync from AT or fallback to Agency)
  const [allotments, setAllotments] = useState<Record<string, Record<string, number>>>(
      at.allotments || activeAgency?.allotments || {}
  );
  
  // State for adding a new allotment letter
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLetterDate, setNewLetterDate] = useState(new Date().toISOString().split('T')[0]);
  const [newLetterNo, setNewLetterNo] = useState('');
  
  const [letterDivision, setLetterDivision] = useState(Object.keys(activeAgency?.prefixes || {})[0] || '');
  const [letterCoreType, setLetterCoreType] = useState('CRGO');
  const [letterQuantity, setLetterQuantity] = useState('');
  
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

  const handleSaveNetAllotment = async () => {
    setIsSaving(true);
    try {
      // Auto update in division with prefix (Agency Level)
      await updateAgency(activeAgency.id, { allotments });
      await updateAtMaster(at.id, { allotments });
      alert("Net Allotments updated across Agency & AT successfully");
    } catch (e) {
      alert("Failed to update allotments");
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddLetter = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseInt(letterQuantity, 10);
    if (!newLetterNo.trim() || isNaN(qty) || qty <= 0 || !letterDivision) {
        alert("Please fill all fields with valid data");
        return;
    }
    
    setIsSaving(true);
    try {
        const newRecord: AllotmentRecord = {
            id: Math.random().toString(36).substring(2, 9),
            date: newLetterDate,
            letterNo: newLetterNo,
            division: letterDivision,
            coreType: letterCoreType,
            quantity: qty,
            addedAt: Date.now()
        };
        
        const history = [...(at.allotmentHistory || []), newRecord];
        
        // Auto-increment the net allotment
        const updatedAllotments = JSON.parse(JSON.stringify(allotments));
        if (!updatedAllotments[letterDivision]) updatedAllotments[letterDivision] = {};
        const currentNet = updatedAllotments[letterDivision][letterCoreType] || 0;
        updatedAllotments[letterDivision][letterCoreType] = currentNet + qty;
        
        // AUTO UPDATE IN DIVISION WITH PREFIX (Agency Settings)
        await updateAgency(activeAgency.id, { allotments: updatedAllotments });
        
        await updateAtMaster(at.id, { 
            allotmentHistory: history,
            allotments: updatedAllotments
        });
        
        setAllotments(updatedAllotments);
        setLetterQuantity('');
        setShowAddForm(false);
        alert("Allotment Letter added and auto-updated in Division Configurations!");
    } catch (err) {
        alert("Failed to add allotment letter");
    } finally {
        setIsSaving(false);
    }
  };

  const getPrefixString = (divName: string, coreType: string) => {
     const prefixData = activeAgency.prefixes?.[divName];
     if (!prefixData) return '';
     if (typeof prefixData === 'string') return prefixData;
     if (coreType === 'CRGO') return prefixData.CRGO;
     if (coreType === 'Amorphous') return prefixData.Amorphous || prefixData.CRGO;
     if (coreType === 'Wound Core') return prefixData['Wound Core'] || prefixData.CRGO;
     return '';
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-200">
      
      {/* SECTION 1: New Allotment Letter Entry */}
      <div className="mb-6 bg-slate-50 border border-slate-200 rounded p-4">
        <div className="flex justify-between items-center mb-3">
          <h4 className="text-sm font-bold text-slate-800 flex items-center">
            <FileText className="w-4 h-4 mr-2 text-blue-600" />
            Receive New Allotment Letter
          </h4>
          {!showAddForm && (
              <button onClick={() => setShowAddForm(true)} className="flex items-center px-3 py-1 text-xs font-bold uppercase bg-blue-600 text-white rounded hover:bg-blue-700">
                  <Plus className="w-3 h-3 mr-1" /> Add Record
              </button>
          )}
        </div>
        
        {showAddForm && (
            <form onSubmit={handleAddLetter} className="space-y-4 bg-white p-4 border border-slate-200 rounded shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                    <div>
                        <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Date</label>
                        <input type="date" required value={newLetterDate} onChange={e => setNewLetterDate(e.target.value)} className="w-full px-2 py-1 text-xs border rounded" />
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Letter No.</label>
                        <input type="text" required value={newLetterNo} onChange={e => setNewLetterNo(e.target.value)} placeholder="e.g. LTR/2026/01" className="w-full px-2 py-1 text-xs border rounded" />
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Division (with Prefix)</label>
                        <select required value={letterDivision} onChange={e => setLetterDivision(e.target.value)} className="w-full px-2 py-1 text-xs border rounded font-semibold text-slate-700">
                            {divisions.map(d => (
                                <option key={d} value={d}>
                                    {d} (Prefix: {getPrefixString(d, letterCoreType) || 'N/A'})
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Core Type</label>
                        <select required value={letterCoreType} onChange={e => setLetterCoreType(e.target.value)} className="w-full px-2 py-1 text-xs border rounded">
                            <option value="CRGO">CRGO</option>
                            <option value="Amorphous">Amorphous</option>
                            <option value="Wound Core">Wound Core</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Quantity</label>
                        <input type="number" required min="1" value={letterQuantity} onChange={e => setLetterQuantity(e.target.value)} placeholder="e.g. 10" className="w-full px-2 py-1 text-xs border rounded" />
                    </div>
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                    <button type="button" onClick={() => setShowAddForm(false)} className="px-3 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded uppercase">Cancel</button>
                    <button type="submit" disabled={isSaving} className="flex items-center px-3 py-1 text-xs font-bold uppercase bg-blue-600 text-white rounded hover:bg-blue-700">
                        {isSaving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />} Save & Auto Update
                    </button>
                </div>
            </form>
        )}
        
        {at.allotmentHistory && at.allotmentHistory.length > 0 && (
            <div className="mt-4">
                <h5 className="text-[10px] font-bold text-slate-500 uppercase mb-2 flex items-center"><History className="w-3 h-3 mr-1" /> Letter History (This AT)</h5>
                <div className="max-h-32 overflow-y-auto border border-slate-200 rounded">
                    <table className="w-full text-left text-xs bg-white">
                        <thead className="bg-slate-50 sticky top-0">
                            <tr>
                                <th className="p-2 border-b font-bold text-slate-600">Date</th>
                                <th className="p-2 border-b font-bold text-slate-600">Letter No</th>
                                <th className="p-2 border-b font-bold text-slate-600">Division (Prefix)</th>
                                <th className="p-2 border-b font-bold text-slate-600">Core Type</th>
                                <th className="p-2 border-b font-bold text-slate-600 text-right">Qty Added</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[...at.allotmentHistory].reverse().map(record => (
                                <tr key={record.id} className="border-b last:border-0 hover:bg-slate-50">
                                    <td className="p-2 text-slate-700">{record.date}</td>
                                    <td className="p-2 font-mono text-slate-800">{record.letterNo}</td>
                                    <td className="p-2 font-bold text-slate-700">{record.division} ({getPrefixString(record.division, record.coreType)})</td>
                                    <td className="p-2 text-slate-600">{record.coreType}</td>
                                    <td className="p-2 text-right font-bold text-green-600">+{record.quantity}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        )}
      </div>

      {/* SECTION 2: Net Allotment Table (Editable Override) */}
      <h4 className="text-sm font-bold text-slate-700 mb-2">Current Net Allotment (Agency & AT Synchronized)</h4>
      <p className="text-xs text-slate-500 mb-3">These values automatically update when you receive a letter, and auto-sync to your Agency Division configs.</p>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
              <th className="p-2 border border-slate-200 font-bold">Division & Prefix</th>
              <th className="p-2 border border-slate-200 font-bold">CRGO</th>
              <th className="p-2 border border-slate-200 font-bold">Amorphous</th>
              <th className="p-2 border border-slate-200 font-bold">Wound Core</th>
              <th className="p-2 border border-slate-200 font-bold">LSTC / OH</th>
            </tr>
          </thead>
          <tbody>
            {divisions.map(div => {
              const divAllot = allotments[div] || {};
              return (
                <tr key={div} className="text-sm">
                  <td className="p-2 border border-slate-200">
                    <span className="font-semibold block">{div}</span>
                    <span className="text-[10px] text-slate-500 block">Pref: {getPrefixString(div, 'CRGO')}</span>
                  </td>
                  <td className="p-2 border border-slate-200">
                    <input type="number" value={divAllot['CRGO'] || ''} onChange={(e) => handleAllotmentChange(div, 'CRGO', e.target.value)} className="w-full px-2 py-1 text-xs border rounded font-bold" placeholder="Net CRGO" />
                  </td>
                  <td className="p-2 border border-slate-200">
                    <input type="number" value={divAllot['Amorphous'] || ''} onChange={(e) => handleAllotmentChange(div, 'Amorphous', e.target.value)} className="w-full px-2 py-1 text-xs border rounded font-bold" placeholder="Net AM" />
                  </td>
                  <td className="p-2 border border-slate-200">
                    <input type="number" value={divAllot['Wound Core'] || ''} onChange={(e) => handleAllotmentChange(div, 'Wound Core', e.target.value)} className="w-full px-2 py-1 text-xs border rounded font-bold" placeholder="Net WC" />
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
        <button onClick={handleSaveNetAllotment} disabled={isSaving} className="flex items-center px-4 py-1.5 text-xs font-bold uppercase bg-slate-800 text-white rounded hover:bg-slate-900">
          {isSaving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />} Manual Override Net Totals
        </button>
      </div>
    </div>
  );
}
`
fs.writeFileSync('src/components/AtAllotments.tsx', code);
