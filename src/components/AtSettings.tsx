import React, { useState } from 'react';
import { useAgency, AtMaster } from '../lib/AgencyContext';
import { Plus, Check, Loader2, Calendar, ChevronDown, ChevronUp, Edit2, Save, X } from 'lucide-react';
import { AtAllotments } from './AtAllotments';
import { AtDivisions } from './AtDivisions';


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
    <div className="space-y-8">
      <div className="bg-white p-6 rounded shadow-sm border border-slate-200">
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center text-lg font-bold text-slate-900 mb-4 hover:text-slate-700"
        >
          {isExpanded ? <ChevronUp className="w-5 h-5 mr-2" /> : <ChevronDown className="w-5 h-5 mr-2" />}
          AT / Tender Periods
        </button>
        
        {isExpanded && (
          <>
            {atMasters.filter(at => at.agencyId === activeAgency?.id).length === 0 ? (
              <p className="text-sm text-slate-500 mb-4">No AT periods defined yet.</p>
            ) : (
          <div className="space-y-3 mb-6">
            {atMasters.filter(at => at.agencyId === activeAgency?.id).map(at => {
              const crgoVal = at.atPercentageCRGO ?? at.atPercentage ?? 4;
              const amVal = at.atPercentageAmorphous ?? at.atPercentage ?? 4;
              const wcVal = at.atPercentageWoundCore ?? at.atPercentage ?? 4;
              const isEditing = editingAtId === at.id;

              return (
              <React.Fragment key={at.id}>
              <div  
                className={`p-4 border rounded flex flex-col md:flex-row md:items-center justify-between cursor-pointer transition-colors gap-4 ${
                  activeAtMaster?.id === at.id ? 'border-blue-500 bg-blue-50/50' : 'border-slate-200 hover:border-blue-300'
                }`}
                onClick={() => setActiveAtMasterId(at.id)}
              >
                {!isEditing ? (
                  <>
                    <div className="space-y-1">
                      <h3 className="font-bold text-slate-900 flex items-center flex-wrap gap-2">
                        <span>{at.atNumber}</span>
                        {at.name && <span className="text-slate-500 font-normal">- {at.name}</span>}
                      </h3>
                      <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                        <span className="flex items-center"><Calendar className="w-3 h-3 mr-1" /> {new Date(at.startDate).toLocaleDateString()} to {new Date(at.endDate).toLocaleDateString()}</span>
                        <span className={`px-2 py-0.5 rounded-full ${at.status === 'Active' ? 'bg-green-100 text-green-700 font-semibold' : 'bg-slate-100 text-slate-700'}`}>
                          {at.status}
                        </span>
                      </div>
                      
                      {/* Core Type Percentages Breakdown */}
                      <div className="flex flex-wrap gap-2 pt-2 text-xs">
                        <span className="bg-slate-100 text-slate-800 px-2.5 py-1 rounded border border-slate-200 font-medium">
                          <strong>CRGO:</strong> {crgoVal >= 0 ? `+${crgoVal}` : crgoVal}%
                        </span>
                        <span className="bg-slate-100 text-slate-800 px-2.5 py-1 rounded border border-slate-200 font-medium">
                          <strong>Amorphous:</strong> {amVal >= 0 ? `+${amVal}` : amVal}%
                        </span>
                        <span className="bg-slate-100 text-slate-800 px-2.5 py-1 rounded border border-slate-200 font-medium">
                          <strong>Wound Core:</strong> {wcVal >= 0 ? `+${wcVal}` : wcVal}%
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 self-end md:self-center">
                      <button 
                        onClick={(e) => handleStartEdit(at, e)}
                        className="flex items-center text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 px-2.5 py-1 rounded shadow-sm transition-colors"
                      >
                        <Edit2 className="w-3 h-3 mr-1" /> Edit
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleToggleStatus(at); }}
                        className="text-xs font-bold text-blue-600 hover:text-blue-800"
                      >
                        Mark as {at.status === 'Active' ? 'Closed' : 'Active'}
                      </button>
                      {activeAtMaster?.id === at.id && <span className="flex items-center text-xs font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded"><Check className="w-3 h-3 mr-1"/> Active AT</span>}
                    </div>
                  </>
                ) : (
                  <form onClick={e => e.stopPropagation()} onSubmit={e => handleSaveEdit(at.id, e)} className="w-full space-y-3 bg-white p-3 rounded border border-blue-300">
                    <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-blue-800">Edit AT / Tender Period</h4>
                      <button type="button" onClick={() => { setEditingAtId(null); setEditFormData(null); }} className="text-slate-400 hover:text-slate-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-slate-500 mb-0.5">AT Number</label>
                        <input required type="text" value={editFormData?.atNumber || ''} onChange={e => setEditFormData(prev => prev ? {...prev, atNumber: e.target.value} : null)} className="w-full px-2.5 py-1.5 text-xs border rounded focus:ring-1 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-slate-500 mb-0.5">Description (Optional)</label>
                        <input type="text" value={editFormData?.name || ''} onChange={e => setEditFormData(prev => prev ? {...prev, name: e.target.value} : null)} className="w-full px-2.5 py-1.5 text-xs border rounded focus:ring-1 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-slate-500 mb-0.5">Start Date</label>
                        <input required type="date" value={editFormData?.startDate || ''} onChange={e => setEditFormData(prev => prev ? {...prev, startDate: e.target.value} : null)} className="w-full px-2.5 py-1.5 text-xs border rounded focus:ring-1 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-slate-500 mb-0.5">End Date</label>
                        <input required type="date" value={editFormData?.endDate || ''} onChange={e => setEditFormData(prev => prev ? {...prev, endDate: e.target.value} : null)} className="w-full px-2.5 py-1.5 text-xs border rounded focus:ring-1 focus:ring-blue-500" />
                      </div>
                    </div>

                    <div className="border-t border-slate-100 pt-2 mt-2">
                      <label className="block text-[10px] uppercase font-bold text-slate-600 mb-1.5">Estimate % Above (+) or Below (-) per Core Type</label>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="bg-slate-50 p-2 rounded border border-slate-200">
                          <label className="block text-[9px] uppercase font-bold text-slate-700 mb-1">CRGO Core %</label>
                          <input required type="number" step="0.01" value={editFormData?.atPercentageCRGO ?? 4} onChange={e => setEditFormData(prev => prev ? {...prev, atPercentageCRGO: parseFloat(e.target.value) || 0} : null)} className="w-full px-2 py-1 text-xs border rounded font-semibold bg-white" placeholder="e.g. 4 or -2.5" />
                        </div>
                        <div className="bg-slate-50 p-2 rounded border border-slate-200">
                          <label className="block text-[9px] uppercase font-bold text-slate-700 mb-1">Amorphous Core %</label>
                          <input required type="number" step="0.01" value={editFormData?.atPercentageAmorphous ?? 4} onChange={e => setEditFormData(prev => prev ? {...prev, atPercentageAmorphous: parseFloat(e.target.value) || 0} : null)} className="w-full px-2 py-1 text-xs border rounded font-semibold bg-white" placeholder="e.g. 4 or -2.5" />
                        </div>
                        <div className="bg-slate-50 p-2 rounded border border-slate-200">
                          <label className="block text-[9px] uppercase font-bold text-slate-700 mb-1">Wound Core %</label>
                          <input required type="number" step="0.01" value={editFormData?.atPercentageWoundCore ?? 4} onChange={e => setEditFormData(prev => prev ? {...prev, atPercentageWoundCore: parseFloat(e.target.value) || 0} : null)} className="w-full px-2 py-1 text-xs border rounded font-semibold bg-white" placeholder="e.g. 4 or -2.5" />
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end space-x-2 pt-2">
                      <button type="button" onClick={() => { setEditingAtId(null); setEditFormData(null); }} className="px-3 py-1 text-xs font-bold uppercase text-slate-500 hover:bg-slate-100 rounded">Cancel</button>
                      <button type="submit" disabled={isSubmitting} className="flex items-center px-3 py-1 text-xs font-bold uppercase bg-blue-600 text-white rounded hover:bg-blue-700">
                        {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />} Save Changes
                      </button>
                    </div>
                  </form>
                )}
              </div>
              {activeAtMaster?.id === at.id && !isEditing && (
                <div className="border border-t-0 border-blue-500 bg-white p-4 rounded-b space-y-4">
                  <AtDivisions at={at} />
                  <AtAllotments at={at} />
                </div>
              )}
              </React.Fragment>
            )})}
          </div>
        )}

        {!showAddForm ? (
          <button onClick={() => setShowAddForm(true)} className="flex items-center px-3 py-1.5 text-xs font-bold uppercase tracking-widest bg-slate-100 text-slate-700 rounded border border-slate-300 hover:bg-slate-200 transition-colors">
            <Plus className="w-3 h-3 mr-1" /> Add AT Period
          </button>
        ) : (
          <form onSubmit={handleAdd} className="space-y-4 border-t border-slate-100 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">AT Number</label>
                <input required type="text" value={newAt.atNumber} onChange={e => setNewAt({...newAt, atNumber: e.target.value})} className="w-full px-3 py-2 text-sm border rounded" placeholder="e.g. AT-2026-27" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Description (Optional)</label>
                <input type="text" value={newAt.name} onChange={e => setNewAt({...newAt, name: e.target.value})} className="w-full px-3 py-2 text-sm border rounded" placeholder="e.g. Annual Tender" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Start Date</label>
                <input required type="date" value={newAt.startDate} onChange={e => setNewAt({...newAt, startDate: e.target.value})} className="w-full px-3 py-2 text-sm border rounded" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">End Date</label>
                <input required type="date" value={newAt.endDate} onChange={e => setNewAt({...newAt, endDate: e.target.value})} className="w-full px-3 py-2 text-sm border rounded" />
              </div>
            </div>

            <div className="border-t border-slate-200 pt-3">
              <label className="block text-xs font-bold uppercase text-slate-600 mb-2">Estimate % Above (+) or Below (-) per Core Type</label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-slate-50 p-2.5 rounded border border-slate-200">
                  <label className="block text-xs font-bold text-slate-700 mb-1">CRGO Core %</label>
                  <input required type="number" step="0.01" value={newAt.atPercentageCRGO} onChange={e => setNewAt({...newAt, atPercentageCRGO: parseFloat(e.target.value) || 0})} className="w-full px-3 py-1.5 text-sm border rounded font-semibold bg-white" placeholder="e.g. 4 or -2.5" />
                </div>
                <div className="bg-slate-50 p-2.5 rounded border border-slate-200">
                  <label className="block text-xs font-bold text-slate-700 mb-1">Amorphous Core %</label>
                  <input required type="number" step="0.01" value={newAt.atPercentageAmorphous} onChange={e => setNewAt({...newAt, atPercentageAmorphous: parseFloat(e.target.value) || 0})} className="w-full px-3 py-1.5 text-sm border rounded font-semibold bg-white" placeholder="e.g. 4 or -2.5" />
                </div>
                <div className="bg-slate-50 p-2.5 rounded border border-slate-200">
                  <label className="block text-xs font-bold text-slate-700 mb-1">Wound Core %</label>
                  <input required type="number" step="0.01" value={newAt.atPercentageWoundCore} onChange={e => setNewAt({...newAt, atPercentageWoundCore: parseFloat(e.target.value) || 0})} className="w-full px-3 py-1.5 text-sm border rounded font-semibold bg-white" placeholder="e.g. 4 or -2.5" />
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 text-xs font-bold uppercase text-slate-500 hover:bg-slate-100 rounded">Cancel</button>
              <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-xs font-bold uppercase bg-blue-600 text-white rounded hover:bg-blue-700">
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save AT Period'}
              </button>
            </div>
          </form>
        )}
        </>
        )}
      </div>
    </div>
  );
}

