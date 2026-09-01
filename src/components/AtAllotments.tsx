import React, { useState } from 'react';
import { formatDDMMYYYY } from '../lib/utils';
import { useAgency, AtMaster, AllotmentRecord } from '../lib/AgencyContext';
import { TABLE, TH } from '../lib/ui';
import { Plus, Check, Loader2, FileText, History, Lock, ShieldCheck, CheckCircle2, ArrowRight, X } from 'lucide-react';

export interface AllotmentConfirmationData {
  letterNo: string;
  date: string;
  division: string;
  prefix: string;
  coreType: string;
  quantityAdded: number;
  previousTotal: number;
  newTotal: number;
  atNumber: string;
  timestamp: string;
}

export function AtAllotments({ at }: { at: AtMaster }) {
  const { activeAgency, updateAtMaster, updateAgency } = useAgency();
  const [isSaving, setIsSaving] = useState(false);
  
  // State for net allotments (sync from AT or fallback to Agency)
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

  // Confirmation Modal state
  const [confirmationData, setConfirmationData] = useState<AllotmentConfirmationData | null>(null);
  
  const currentPrefixes = (at.prefixes && Object.keys(at.prefixes).length > 0) ? at.prefixes : (activeAgency?.prefixes || {});
  const divisions = Object.keys(currentPrefixes);
  
  React.useEffect(() => {
    if (!letterDivision && divisions.length > 0) {
        setLetterDivision(divisions[0]);
    } else if (letterDivision && !divisions.includes(letterDivision) && divisions.length > 0) {
        setLetterDivision(divisions[0]);
    }
  }, [divisions, letterDivision]);

  React.useEffect(() => {
    setAllotments(at.allotments || activeAgency?.allotments || {});
  }, [at.allotments, activeAgency?.allotments]);

  if (!activeAgency) return null;

  const getPrefixString = (divName: string, coreType: string) => {
     const prefixSource = (at.prefixes && Object.keys(at.prefixes).length > 0) ? at.prefixes : (activeAgency.prefixes || {});
     const prefixData = prefixSource[divName];
     if (!prefixData) return '';
     if (typeof prefixData === 'string') return prefixData;
     if (coreType === 'CRGO') return prefixData['CRGO'] || '';
     if (coreType === 'Amorphous') return prefixData['Amorphous'] || '';
     if (coreType === 'Wound Core') return prefixData['Wound Core'] || '';
     if (coreType === 'LSTC') return prefixData['LSTC'] || '';
     if (coreType === 'OH') return prefixData['OH'] || '';
     return '';
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
            letterNo: newLetterNo.trim(),
            division: letterDivision,
            coreType: letterCoreType,
            quantity: qty,
            addedAt: Date.now()
        };
        
        const history = [...(at.allotmentHistory || []), newRecord];
        
        // Auto-increment the net allotment on AT Master
        const updatedAllotments = JSON.parse(JSON.stringify(allotments));
        if (!updatedAllotments[letterDivision]) updatedAllotments[letterDivision] = {};
        const previousNet = updatedAllotments[letterDivision][letterCoreType] || 0;
        const newNet = previousNet + qty;
        updatedAllotments[letterDivision][letterCoreType] = newNet;
        
        await updateAtMaster(at.id, { 
            allotmentHistory: history,
            allotments: updatedAllotments
        });
        
        setAllotments(updatedAllotments);
        
        // Set Confirmation Data to show modal
        const activePrefix = getPrefixString(letterDivision, letterCoreType);
        setConfirmationData({
          letterNo: newLetterNo.trim(),
          date: newLetterDate,
          division: letterDivision,
          prefix: activePrefix,
          coreType: letterCoreType,
          quantityAdded: qty,
          previousTotal: previousNet,
          newTotal: newNet,
          atNumber: at.atNumber || at.name || 'Active AT',
          timestamp: new Date().toLocaleString()
        });

        // Reset form
        setNewLetterNo('');
        setLetterQuantity('');
        setShowAddForm(false);
    } catch (err) {
        alert("Failed to add allotment letter");
    } finally {
        setIsSaving(false);
    }
  };

  // Grand totals across all divisions
  const totalCRGO = divisions.reduce((sum, d) => sum + (allotments[d]?.['CRGO'] || 0), 0);
  const totalAmorphous = divisions.reduce((sum, d) => sum + (allotments[d]?.['Amorphous'] || 0), 0);
  const totalWoundCore = divisions.reduce((sum, d) => sum + (allotments[d]?.['Wound Core'] || 0), 0);
  const grandTotal = totalCRGO + totalAmorphous + totalWoundCore;

  return (
    <div className="mt-4 pt-4 border-t border-slate-200">
      
      {/* SECTION 1: New Allotment Letter Entry */}
      <div className="mb-4 bg-slate-50 border border-slate-200 rounded-lg p-3">
        <div className="flex justify-between items-center mb-3">
          <div>
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-blue-600" />
              Receive New Allotment Letter
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Allotment quotas are accumulated strictly through official letter receipts
            </p>
          </div>
          {!showAddForm && (
            <button 
              type="button"
              onClick={() => setShowAddForm(true)} 
              className="flex items-center px-3 py-1.5 text-xs font-bold uppercase bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> Add Allotment Letter
            </button>
          )}
        </div>
        
        {showAddForm && (
          <form onSubmit={handleAddLetter} className="space-y-3 bg-white p-3 border border-blue-200 rounded-lg animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold text-blue-900 uppercase tracking-wider">New Allotment Receipt</span>
              <span className="text-[11px] text-slate-500">Auto-adds to division quota on save</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Letter Date *</label>
                <input 
                  type="date" 
                  required 
                  value={newLetterDate} 
                  onChange={e => setNewLetterDate(e.target.value)} 
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-slate-50 font-semibold focus:ring-1 focus:ring-blue-500" 
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Letter Ref. No. *</label>
                <input 
                  type="text" 
                  required 
                  value={newLetterNo} 
                  onChange={e => setNewLetterNo(e.target.value)} 
                  placeholder="e.g. LTR/2026/01" 
                  className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums font-bold border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 bg-white" 
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Division (with Prefix) *</label>
                <select 
                  required 
                  value={letterDivision} 
                  onChange={e => setLetterDivision(e.target.value)} 
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-bold text-slate-700 bg-white focus:ring-1 focus:ring-blue-500"
                >
                  {divisions.map(d => {
                    const pref = getPrefixString(d, letterCoreType);
                    return (
                      <option key={d} value={d}>
                        {d} {pref ? `(Pref: ${pref})` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Core Type *</label>
                <select 
                  required 
                  value={letterCoreType} 
                  onChange={e => setLetterCoreType(e.target.value)} 
                  className="w-full px-2.5 py-1.5 text-xs font-bold border border-slate-300 rounded-lg bg-white focus:ring-1 focus:ring-blue-500"
                >
                  <option value="CRGO">CRGO</option>
                  <option value="Amorphous">Amorphous</option>
                  <option value="Wound Core">Wound Core</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Allotment Quantity *</label>
                <input 
                  type="number" 
                  required 
                  min="1" 
                  value={letterQuantity} 
                  onChange={e => setLetterQuantity(e.target.value)} 
                  placeholder="e.g. 10" 
                  className="w-full px-2.5 py-1.5 text-xs font-bold border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 bg-white" 
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button 
                type="button" 
                onClick={() => setShowAddForm(false)} 
                className="px-3.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                disabled={isSaving} 
                className="flex items-center px-4 py-1.5 text-xs font-bold uppercase bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Check className="w-3.5 h-3.5 mr-1.5" />} 
                Save & Issue Allotment Confirmation
              </button>
            </div>
          </form>
        )}
        
        {at.allotmentHistory && at.allotmentHistory.length > 0 && (
          <div className="mt-4">
            <h5 className="text-[10px] font-bold text-slate-600 uppercase mb-2 flex items-center tracking-wider">
              <History className="w-3.5 h-3.5 mr-1.5 text-blue-600" /> Letter History ({at.allotmentHistory.length} Records)
            </h5>
            <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg shadow-2xs">
              <table className={`${TABLE} text-xs bg-white`}>
                <thead className="bg-slate-100/80 sticky top-0 border-b border-slate-200">
                  <tr>
                    <th className={`${TH}`}>Date</th>
                    <th className={`${TH}`}>Letter No</th>
                    <th className={`${TH}`}>Division</th>
                    <th className={`${TH}`}>Prefix</th>
                    <th className={`${TH}`}>Core Type</th>
                    <th className={`${TH} text-right`}>Qty Added</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...at.allotmentHistory].reverse().map((record, idx) => (
                    <tr key={record.id || idx} className="hover:bg-blue-50/40 transition-colors">
                      <td className="p-2.5 text-slate-700 font-medium">{formatDDMMYYYY(record.date)}</td>
                      <td className="p-2.5 font-mono tabular-nums font-bold text-slate-800">{record.letterNo}</td>
                      <td className="p-2.5 font-bold text-slate-800">{record.division}</td>
                      <td className="p-2.5 font-mono tabular-nums text-[11px] text-blue-700">
                        {getPrefixString(record.division, record.coreType) || '-'}
                      </td>
                      <td className="p-2.5 text-slate-700">
                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700">
                          {record.coreType}
                        </span>
                      </td>
                      <td className="p-2.5 text-right font-black text-emerald-600">
                        +{record.quantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 2: Division Allotment Quotas (UNEDITABLE / READ-ONLY SUMMARY) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold text-slate-800">Division Allotment Quotas</h4>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                <Lock className="w-3 h-3 text-amber-600" /> Read-Only
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Cumulative division quotas calculated automatically from received allotment letters. Manual editing is restricted.
            </p>
          </div>

          <div className="text-right">
            <span className="text-[11px] uppercase font-bold text-slate-500">Total Net Quota</span>
            <div className="text-base font-black text-blue-700 font-mono tabular-nums">{grandTotal} Units</div>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-[10px] uppercase tracking-wider">
                <th className="p-2.5 border border-slate-200 font-bold">Division Name</th>
                <th className="p-2.5 border border-slate-200 font-bold text-center">CRGO Quota</th>
                <th className="p-2.5 border border-slate-200 font-bold text-center">Amorphous Quota</th>
                <th className="p-2.5 border border-slate-200 font-bold text-center">Wound Core Quota</th>
                <th className="p-2.5 border border-slate-200 font-bold text-center bg-slate-100/70">Division Total</th>
              </tr>
            </thead>
            <tbody>
              {divisions.map(div => {
                const divAllot = allotments[div] || {};
                const crgo = divAllot['CRGO'] || 0;
                const am = divAllot['Amorphous'] || 0;
                const wc = divAllot['Wound Core'] || 0;
                const divTotal = crgo + am + wc;
                const pref = getPrefixString(div, 'CRGO');

                return (
                  <tr key={div} className="hover:bg-slate-50/60 transition-colors">
                    <td className="p-2.5 border border-slate-200">
                      <span className="font-bold text-slate-800 block text-xs">{div}</span>
                      {pref && (
                        <span className="text-[10px] font-mono tabular-nums text-blue-600 block">
                          Prefix: {pref}
                        </span>
                      )}
                    </td>
                    <td className="p-2.5 border border-slate-200 text-center">
                      <span className="inline-block px-3 py-1 bg-slate-100 text-slate-800 font-mono tabular-nums font-bold text-xs rounded border border-slate-200 min-w-[50px]">
                        {crgo}
                      </span>
                    </td>
                    <td className="p-2.5 border border-slate-200 text-center">
                      <span className="inline-block px-3 py-1 bg-slate-100 text-slate-800 font-mono tabular-nums font-bold text-xs rounded border border-slate-200 min-w-[50px]">
                        {am}
                      </span>
                    </td>
                    <td className="p-2.5 border border-slate-200 text-center">
                      <span className="inline-block px-3 py-1 bg-slate-100 text-slate-800 font-mono tabular-nums font-bold text-xs rounded border border-slate-200 min-w-[50px]">
                        {wc}
                      </span>
                    </td>
                    <td className="p-2.5 border border-slate-200 text-center bg-slate-50/50">
                      <span className="inline-block px-3 py-1 bg-blue-50 text-blue-800 font-mono tabular-nums font-black text-xs rounded border border-blue-200 min-w-[55px]">
                        {divTotal} Units
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold text-xs text-slate-900">
                <td className="p-2.5 border border-slate-300 font-bold uppercase tracking-wider">Grand Total</td>
                <td className="p-2.5 border border-slate-300 text-center font-mono tabular-nums font-black text-slate-800">{totalCRGO}</td>
                <td className="p-2.5 border border-slate-300 text-center font-mono tabular-nums font-black text-slate-800">{totalAmorphous}</td>
                <td className="p-2.5 border border-slate-300 text-center font-mono tabular-nums font-black text-slate-800">{totalWoundCore}</td>
                <td className="p-2.5 border border-slate-300 text-center font-mono tabular-nums font-black text-blue-800 bg-blue-100/50">
                  {grandTotal} Units
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            Quota synchronization is active across AT periods and Agency profile. To allocate new quotas, click <strong>"Add Allotment Letter"</strong> above.
          </span>
        </div>
      </div>

      {/* ALLOTMENT CONFIRMATION MODAL */}
      {confirmationData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-emerald-200 animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 p-5 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-full shrink-0">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-base font-black">Allotment Confirmed</h3>
                  <p className="text-xs text-emerald-100">Allotment letter recorded & quota updated</p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setConfirmationData(null)}
                className="p-1 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-4 space-y-3">
                <div className="flex justify-between items-center text-xs pb-2 border-b border-emerald-200/60">
                  <span className="text-slate-600 font-medium">Letter Ref. Number:</span>
                  <span className="font-mono tabular-nums font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-emerald-200">
                    {confirmationData.letterNo}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs pb-2 border-b border-emerald-200/60">
                  <span className="text-slate-600 font-medium">Letter Date:</span>
                  <span className="font-semibold text-slate-900">{formatDDMMYYYY(confirmationData.date)}</span>
                </div>

                <div className="flex justify-between items-center text-xs pb-2 border-b border-emerald-200/60">
                  <span className="text-slate-600 font-medium">Concern Division:</span>
                  <span className="font-bold text-slate-900">
                    {confirmationData.division} {confirmationData.prefix ? `(${confirmationData.prefix})` : ''}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs pb-2 border-b border-emerald-200/60">
                  <span className="text-slate-600 font-medium">Core Type:</span>
                  <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    {confirmationData.coreType}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 font-medium">AT Reference:</span>
                  <span className="font-medium text-slate-800">{confirmationData.atNumber}</span>
                </div>
              </div>

              {/* Quantity Increment Progression Box */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2 text-center">
                  Quota Update Summary
                </span>
                <div className="flex items-center justify-around">
                  <div className="text-center">
                    <span className="text-[10px] text-slate-500 font-medium block">Previous</span>
                    <span className="text-sm font-bold font-mono tabular-nums text-slate-600">{confirmationData.previousTotal} Units</span>
                  </div>

                  <div className="flex flex-col items-center">
                    <span className="text-xs font-black text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-300">
                      +{confirmationData.quantityAdded} Added
                    </span>
                    <ArrowRight className="w-4 h-4 text-slate-400 mt-1" />
                  </div>

                  <div className="text-center">
                    <span className="text-[10px] text-emerald-700 font-bold block">New Quota</span>
                    <span className="text-base font-black font-mono tabular-nums text-emerald-700 bg-white px-2.5 py-0.5 rounded-lg border border-emerald-300 shadow-2xs">
                      {confirmationData.newTotal} Units
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button 
                type="button" 
                onClick={() => setConfirmationData(null)}
                className="w-full sm:w-auto px-6 py-2 text-xs font-bold uppercase bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" /> Acknowledge & Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

