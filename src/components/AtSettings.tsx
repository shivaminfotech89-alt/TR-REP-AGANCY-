import React, { useState } from 'react';
import { useAgency, AtMaster } from '../lib/AgencyContext';
import { Plus, Check, Loader2, Calendar, ChevronDown, ChevronUp, Edit2, Save, X, Briefcase, FileText } from 'lucide-react';
import { AtAllotments } from './AtAllotments';

export function AtSettings() {
  const { activeAgency, atMasters, activeAtMaster, setActiveAtMasterId, addAtMaster, updateAtMaster } = useAgency();
  const [showAddForm, setShowAddForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  
  const [editingAtId, setEditingAtId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<{
    atNumber: string;
    name: string;
    startDate: string;
    endDate: string;
    atPercentageCRGO: number;
    atPercentageAmorphous: number;
    atPercentageWoundCore: number;
  } | null>(null);

  const [newAt, setNewAt] = useState({
    atNumber: '',
    name: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0],
    atPercentageCRGO: 4,
    atPercentageAmorphous: 4,
    atPercentageWoundCore: 4,
  });

  const agencyAts = atMasters.filter(at => at.agencyId === activeAgency?.id);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAt.atNumber) return;
    setIsSubmitting(true);
    try {
      await addAtMaster({
        atNumber: newAt.atNumber,
        name: newAt.name,
        startDate: new Date(newAt.startDate).getTime(),
        endDate: new Date(newAt.endDate).getTime(),
        status: 'Active',
        agencyId: activeAgency?.id || '',
        lastJobNumbers: {},
        atPercentage: Number(newAt.atPercentageCRGO) || 0,
        atPercentageCRGO: Number(newAt.atPercentageCRGO) || 0,
        atPercentageAmorphous: Number(newAt.atPercentageAmorphous) || 0,
        atPercentageWoundCore: Number(newAt.atPercentageWoundCore) || 0,
      });
      setShowAddForm(false);
      setNewAt({
        atNumber: '',
        name: '',
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0],
        atPercentageCRGO: 4,
        atPercentageAmorphous: 4,
        atPercentageWoundCore: 4,
      });
    } catch (err) {
      alert("Failed to create AT Master");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartEdit = (at: AtMaster, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingAtId(at.id);
    setEditFormData({
      atNumber: at.atNumber || '',
      name: at.name || '',
      startDate: at.startDate ? new Date(at.startDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      endDate: at.endDate ? new Date(at.endDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      atPercentageCRGO: at.atPercentageCRGO ?? at.atPercentage ?? 4,
      atPercentageAmorphous: at.atPercentageAmorphous ?? at.atPercentage ?? 4,
      atPercentageWoundCore: at.atPercentageWoundCore ?? at.atPercentage ?? 4,
    });
  };

  const handleSaveEdit = async (atId: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!editFormData) return;
    setIsSubmitting(true);
    try {
      await updateAtMaster(atId, {
        atNumber: editFormData.atNumber,
        name: editFormData.name,
        startDate: editFormData.startDate ? new Date(editFormData.startDate).getTime() : Date.now(),
        endDate: editFormData.endDate ? new Date(editFormData.endDate).getTime() : Date.now(),
        atPercentage: Number(editFormData.atPercentageCRGO) || 0,
        atPercentageCRGO: Number(editFormData.atPercentageCRGO) || 0,
        atPercentageAmorphous: Number(editFormData.atPercentageAmorphous) || 0,
        atPercentageWoundCore: Number(editFormData.atPercentageWoundCore) || 0,
      });
      setEditingAtId(null);
      setEditFormData(null);
    } catch (err) {
      alert("Failed to update AT Period");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async (at: AtMaster) => {
    const newStatus = at.status === 'Active' ? 'Closed' : 'Active';
    try {
      await updateAtMaster(at.id, { status: newStatus });
    } catch (err) {
      alert("Failed to update status");
    }
  };

  if (!activeAgency) return null;

  return (
    <div className="bg-white p-6 rounded-xl shadow-xs border border-slate-200">
      {/* Header with Title and Minimize/Expand Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-lg shadow-xs shrink-0">
            <Briefcase className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">AT / Tender Periods</h2>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                {agencyAts.length} Periods
              </span>
            </div>
            <p className="text-xs text-slate-500">Manage tender contracts, validity dates & core type percentage markups</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all self-end sm:self-auto ${
            isExpanded 
              ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-300' 
              : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-200 shadow-2xs'
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
              <span>Expand & Manage</span>
            </>
          )}
        </button>
      </div>

      {/* Minimized Summary View */}
      {!isExpanded && (
        <div className="pt-3">
          {activeAtMaster ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900">{activeAtMaster.atNumber}</span>
                  {activeAtMaster.name && <span className="text-slate-500 font-normal">({activeAtMaster.name})</span>}
                  <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded font-bold text-[10px]">
                    Active
                  </span>
                </div>
                <div className="text-slate-500 text-[11px] flex items-center gap-2">
                  <span>{new Date(activeAtMaster.startDate).toLocaleDateString()} - {new Date(activeAtMaster.endDate).toLocaleDateString()}</span>
                  <span>•</span>
                  <span>CRGO: {activeAtMaster.atPercentageCRGO ?? activeAtMaster.atPercentage ?? 4}%</span>
                  <span>•</span>
                  <span>Amorphous: {activeAtMaster.atPercentageAmorphous ?? activeAtMaster.atPercentage ?? 4}%</span>
                  <span>•</span>
                  <span>Wound: {activeAtMaster.atPercentageWoundCore ?? activeAtMaster.atPercentage ?? 4}%</span>
                </div>
              </div>
              <span className="text-[11px] text-indigo-600 font-semibold self-end sm:self-center">
                Click "Expand & Manage" to edit or add periods
              </span>
            </div>
          ) : (
            <div className="text-xs text-slate-500 p-2">
              No AT period currently active. Click "Expand & Manage" to add or configure AT periods.
            </div>
          )}
        </div>
      )}

      {/* Expanded View */}
      {isExpanded && (
        <div className="pt-4 space-y-4">
          {agencyAts.length === 0 ? (
            <p className="text-sm text-slate-500 py-2">No AT periods defined yet for this agency.</p>
          ) : (
            <div className="space-y-3">
              {agencyAts.map(at => {
                const crgoVal = at.atPercentageCRGO ?? at.atPercentage ?? 4;
                const amVal = at.atPercentageAmorphous ?? at.atPercentage ?? 4;
                const wcVal = at.atPercentageWoundCore ?? at.atPercentage ?? 4;
                const isEditing = editingAtId === at.id;

                return (
                  <div key={at.id} className="space-y-2">
                    <div 
                      className={`p-4 border rounded-xl flex flex-col md:flex-row md:items-center justify-between cursor-pointer transition-colors gap-4 ${
                        activeAtMaster?.id === at.id ? 'border-indigo-500 bg-indigo-50/40 ring-1 ring-indigo-500/20' : 'border-slate-200 hover:border-indigo-300 bg-slate-50/30'
                      }`}
                      onClick={() => setActiveAtMasterId(at.id)}
                    >
                      {!isEditing ? (
                        <>
                          <div className="space-y-1">
                            <div className="flex items-center flex-wrap gap-2">
                              <h3 className="font-bold text-slate-900">{at.atNumber}</h3>
                              {at.name && <span className="text-slate-500 font-normal">- {at.name}</span>}
                              {activeAtMaster?.id === at.id && (
                                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full flex items-center">
                                  <Check className="w-3 h-3 mr-1"/> Active AT
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                              <span className="flex items-center"><Calendar className="w-3.5 h-3.5 mr-1 text-slate-400" /> {new Date(at.startDate).toLocaleDateString()} to {new Date(at.endDate).toLocaleDateString()}</span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${at.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>
                                {at.status}
                              </span>
                            </div>
                            
                            {/* Core Type Percentages Breakdown */}
                            <div className="flex flex-wrap gap-2 pt-2 text-xs">
                              <span className="bg-white text-slate-800 px-2.5 py-1 rounded border border-slate-200 font-medium shadow-2xs">
                                <strong className="text-blue-700">CRGO:</strong> {crgoVal >= 0 ? `+${crgoVal}` : crgoVal}%
                              </span>
                              <span className="bg-white text-slate-800 px-2.5 py-1 rounded border border-slate-200 font-medium shadow-2xs">
                                <strong className="text-amber-700">Amorphous:</strong> {amVal >= 0 ? `+${amVal}` : amVal}%
                              </span>
                              <span className="bg-white text-slate-800 px-2.5 py-1 rounded border border-slate-200 font-medium shadow-2xs">
                                <strong className="text-emerald-700">Wound Core:</strong> {wcVal >= 0 ? `+${wcVal}` : wcVal}%
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2.5 self-end md:self-center">
                            <button 
                              onClick={(e) => handleStartEdit(at, e)}
                              className="flex items-center text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 px-2.5 py-1.5 rounded-lg shadow-2xs transition-colors"
                            >
                              <Edit2 className="w-3 h-3 mr-1" /> Edit
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleToggleStatus(at); }}
                              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-2.5 py-1.5 rounded-lg border border-indigo-100 transition-colors"
                            >
                              Mark as {at.status === 'Active' ? 'Closed' : 'Active'}
                            </button>
                          </div>
                        </>
                      ) : (
                        <form onClick={e => e.stopPropagation()} onSubmit={e => handleSaveEdit(at.id, e)} className="w-full space-y-3 bg-white p-4 rounded-xl border border-indigo-300 shadow-xs">
                          <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-800">Edit AT / Tender Period</h4>
                            <button type="button" onClick={() => { setEditingAtId(null); setEditFormData(null); }} className="text-slate-400 hover:text-slate-600">
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-0.5">AT Number</label>
                              <input required type="text" value={editFormData?.atNumber || ''} onChange={e => setEditFormData(prev => prev ? {...prev, atNumber: e.target.value} : null)} className="w-full px-2.5 py-1.5 text-xs border rounded-lg focus:ring-1 focus:ring-indigo-500" />
                            </div>
                            <div>
                              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-0.5">Description (Optional)</label>
                              <input type="text" value={editFormData?.name || ''} onChange={e => setEditFormData(prev => prev ? {...prev, name: e.target.value} : null)} className="w-full px-2.5 py-1.5 text-xs border rounded-lg focus:ring-1 focus:ring-indigo-500" />
                            </div>
                            <div>
                              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-0.5">Start Date</label>
                              <input required type="date" value={editFormData?.startDate || ''} onChange={e => setEditFormData(prev => prev ? {...prev, startDate: e.target.value} : null)} className="w-full px-2.5 py-1.5 text-xs border rounded-lg focus:ring-1 focus:ring-indigo-500" />
                            </div>
                            <div>
                              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-0.5">End Date</label>
                              <input required type="date" value={editFormData?.endDate || ''} onChange={e => setEditFormData(prev => prev ? {...prev, endDate: e.target.value} : null)} className="w-full px-2.5 py-1.5 text-xs border rounded-lg focus:ring-1 focus:ring-indigo-500" />
                            </div>
                          </div>

                          <div className="border-t border-slate-100 pt-2 mt-2">
                            <label className="block text-[10px] uppercase font-bold text-slate-600 mb-1.5">Estimate % Above (+) or Below (-) per Core Type</label>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div className="bg-slate-50 p-2 rounded-lg border border-slate-200">
                                <label className="block text-[9px] uppercase font-bold text-slate-700 mb-1">CRGO Core %</label>
                                <input required type="number" step="0.01" value={editFormData?.atPercentageCRGO ?? 4} onChange={e => setEditFormData(prev => prev ? {...prev, atPercentageCRGO: parseFloat(e.target.value) || 0} : null)} className="w-full px-2 py-1 text-xs border rounded font-semibold bg-white" placeholder="e.g. 4 or -2.5" />
                              </div>
                              <div className="bg-slate-50 p-2 rounded-lg border border-slate-200">
                                <label className="block text-[9px] uppercase font-bold text-slate-700 mb-1">Amorphous Core %</label>
                                <input required type="number" step="0.01" value={editFormData?.atPercentageAmorphous ?? 4} onChange={e => setEditFormData(prev => prev ? {...prev, atPercentageAmorphous: parseFloat(e.target.value) || 0} : null)} className="w-full px-2 py-1 text-xs border rounded font-semibold bg-white" placeholder="e.g. 4 or -2.5" />
                              </div>
                              <div className="bg-slate-50 p-2 rounded-lg border border-slate-200">
                                <label className="block text-[9px] uppercase font-bold text-slate-700 mb-1">Wound Core %</label>
                                <input required type="number" step="0.01" value={editFormData?.atPercentageWoundCore ?? 4} onChange={e => setEditFormData(prev => prev ? {...prev, atPercentageWoundCore: parseFloat(e.target.value) || 0} : null)} className="w-full px-2 py-1 text-xs border rounded font-semibold bg-white" placeholder="e.g. 4 or -2.5" />
                              </div>
                            </div>
                          </div>

                          <div className="flex justify-end space-x-2 pt-2">
                            <button type="button" onClick={() => { setEditingAtId(null); setEditFormData(null); }} className="px-3 py-1.5 text-xs font-bold uppercase text-slate-500 hover:bg-slate-100 rounded-lg">Cancel</button>
                            <button type="submit" disabled={isSubmitting} className="flex items-center px-3.5 py-1.5 text-xs font-bold uppercase bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                              {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />} Save Changes
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                    
                    {/* Allotments for this active AT */}
                    {activeAtMaster?.id === at.id && !isEditing && (
                      <div className="border border-t-0 border-indigo-300 bg-white p-4 rounded-b-xl space-y-4">
                        <AtAllotments at={at} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Add Form & Buttons */}
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="px-3.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Minimise Table
            </button>

            {!showAddForm ? (
              <button 
                onClick={() => setShowAddForm(true)} 
                className="flex items-center px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add AT Period
              </button>
            ) : null}
          </div>

          {showAddForm && (
            <form onSubmit={handleAdd} className="space-y-4 bg-slate-50 p-4 border border-indigo-200 rounded-xl">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <h4 className="text-xs font-bold uppercase text-indigo-900">Create New AT / Tender Period</h4>
                <button type="button" onClick={() => setShowAddForm(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">AT Number</label>
                  <input required type="text" value={newAt.atNumber} onChange={e => setNewAt({...newAt, atNumber: e.target.value})} className="w-full px-3 py-2 text-xs border rounded-lg bg-white" placeholder="e.g. AT-2026-27" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Description (Optional)</label>
                  <input type="text" value={newAt.name} onChange={e => setNewAt({...newAt, name: e.target.value})} className="w-full px-3 py-2 text-xs border rounded-lg bg-white" placeholder="e.g. Annual Tender" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Start Date</label>
                  <input required type="date" value={newAt.startDate} onChange={e => setNewAt({...newAt, startDate: e.target.value})} className="w-full px-3 py-2 text-xs border rounded-lg bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">End Date</label>
                  <input required type="date" value={newAt.endDate} onChange={e => setNewAt({...newAt, endDate: e.target.value})} className="w-full px-3 py-2 text-xs border rounded-lg bg-white" />
                </div>
              </div>

              <div className="border-t border-slate-200 pt-3">
                <label className="block text-xs font-bold uppercase text-slate-600 mb-2">Estimate % Above (+) or Below (-) per Core Type</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                    <label className="block text-xs font-bold text-slate-700 mb-1">CRGO Core %</label>
                    <input required type="number" step="0.01" value={newAt.atPercentageCRGO} onChange={e => setNewAt({...newAt, atPercentageCRGO: parseFloat(e.target.value) || 0})} className="w-full px-3 py-1.5 text-xs border rounded font-semibold bg-slate-50" placeholder="e.g. 4 or -2.5" />
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                    <label className="block text-xs font-bold text-slate-700 mb-1">Amorphous Core %</label>
                    <input required type="number" step="0.01" value={newAt.atPercentageAmorphous} onChange={e => setNewAt({...newAt, atPercentageAmorphous: parseFloat(e.target.value) || 0})} className="w-full px-3 py-1.5 text-xs border rounded font-semibold bg-slate-50" placeholder="e.g. 4 or -2.5" />
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                    <label className="block text-xs font-bold text-slate-700 mb-1">Wound Core %</label>
                    <input required type="number" step="0.01" value={newAt.atPercentageWoundCore} onChange={e => setNewAt({...newAt, atPercentageWoundCore: parseFloat(e.target.value) || 0})} className="w-full px-3 py-1.5 text-xs border rounded font-semibold bg-slate-50" placeholder="e.g. 4 or -2.5" />
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 text-xs font-bold uppercase text-slate-500 hover:bg-slate-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-xs font-bold uppercase bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save AT Period'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}


