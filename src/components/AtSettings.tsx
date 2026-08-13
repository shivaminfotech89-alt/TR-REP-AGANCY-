import React, { useState } from 'react';
import { useAgency, AtMaster } from '../lib/AgencyContext';
import { Plus, Check, Loader2, Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import { AtAllotments } from './AtAllotments';
import { AtDivisions } from './AtDivisions';


export function AtSettings() {
  const { activeAgency, atMasters, activeAtMaster, setActiveAtMasterId, addAtMaster, updateAtMaster } = useAgency();
  const [showAddForm, setShowAddForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  
  const [newAt, setNewAt] = useState({
    atNumber: '',
    name: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0],
    atPercentage: 4,
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
        atPercentage: newAt.atPercentage
      });
      setShowAddForm(false);
      setNewAt({
        atNumber: '',
        name: '',
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0],
        atPercentage: 4
      });
    } catch (err) {
      alert("Failed to create AT Master");
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
            {atMasters.filter(at => at.agencyId === activeAgency?.id).map(at => (
              <React.Fragment key={at.id}>
              <div  
                className={`p-4 border rounded flex items-center justify-between cursor-pointer transition-colors ${
                  activeAtMaster?.id === at.id ? 'border-blue-500 bg-blue-50/50' : 'border-slate-200 hover:border-blue-300'
                }`}
                onClick={() => setActiveAtMasterId(at.id)}
              >
                <div>
                  <h3 className="font-bold text-slate-900 flex items-center">
                    {at.atNumber} {at.name && <span className="text-slate-500 font-normal ml-2">- {at.name}</span>}
                  </h3>
                  <div className="text-xs text-slate-500 mt-1 flex items-center space-x-4">
                    <span className="flex items-center"><Calendar className="w-3 h-3 mr-1" /> {new Date(at.startDate).toLocaleDateString()} to {new Date(at.endDate).toLocaleDateString()}</span>
                    <span className="font-semibold text-slate-700">Value: {at.atPercentage > 0 ? '+' : ''}{at.atPercentage ?? 0}%</span>
                    <span className={`px-2 py-0.5 rounded-full ${at.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'}`}>
                      {at.status}
                    </span>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleToggleStatus(at); }}
                    className="text-xs font-bold text-blue-600 hover:text-blue-800"
                  >
                    Mark as {at.status === 'Active' ? 'Closed' : 'Active'}
                  </button>
                  {activeAtMaster?.id === at.id && <span className="flex items-center text-xs font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded"><Check className="w-3 h-3 mr-1"/> Active AT</span>}
                </div>
              </div>
              {activeAtMaster?.id === at.id && (
                <div className="border border-t-0 border-blue-500 bg-white p-4 rounded-b space-y-4">
                  <AtDivisions at={at} />
                  <AtAllotments at={at} />
                </div>
              )}
              </React.Fragment>
            ))}
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
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">AT Value % (+ or -)</label>
                <input required type="number" step="0.01" value={newAt.atPercentage} onChange={e => setNewAt({...newAt, atPercentage: parseFloat(e.target.value)})} className="w-full px-3 py-2 text-sm border rounded" />
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
