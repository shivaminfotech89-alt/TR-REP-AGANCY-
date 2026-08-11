import React, { useState, useRef } from 'react';
import { useAgency } from '../lib/AgencyContext';
import { Loader2, Plus, Building, Trash2, FileUp } from 'lucide-react';

export default function AgencySettings() {
  const { agencies, activeAgency, setActiveAgencyId, addAgency, updateAgency, loading } = useAgency();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAgencyName, setNewAgencyName] = useState('');
  
  // Dynamic divisions state
  const [divisions, setDivisions] = useState([{ name: 'SABARMATI', prefix: '21 IS' }]);
  
  // Base64 file string for letterhead
  const [letterheadBase64, setLetterheadBase64] = useState('');
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        setLetterheadBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddDivision = () => {
    setDivisions([...divisions, { name: '', prefix: '' }]);
  };

  const handleRemoveDivision = (index: number) => {
    if (divisions.length === 1) return;
    const newDivs = [...divisions];
    newDivs.splice(index, 1);
    setDivisions(newDivs);
  };

  const handleDivisionChange = (index: number, field: 'name' | 'prefix', value: string) => {
    const newDivs = [...divisions];
    newDivs[index][field] = value.toUpperCase(); // Normalize names to uppercase
    setDivisions(newDivs);
  };

  const handleAddAgency = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const prefixes: Record<string, string> = {};
      const lastJobNumbers: Record<string, number> = {};
      
      divisions.forEach(d => {
        if (d.name.trim() && d.prefix.trim()) {
          prefixes[d.name.trim()] = d.prefix.trim();
          lastJobNumbers[d.name.trim()] = 0;
        }
      });

      await addAgency({
        name: newAgencyName,
        letterheadUrl: letterheadBase64, // Storing base64 string
        prefixes,
        lastJobNumbers
      });
      
      setShowAddForm(false);
      setNewAgencyName('');
      setLetterheadBase64('');
      setFileName('');
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
      <div className="bg-white p-6 rounded shadow-sm border border-slate-200">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Switch Agency</h2>
        {agencies.length === 0 ? (
          <p className="text-sm text-slate-500 mb-4">No agencies found. Please create one.</p>
        ) : (
          <div className="space-y-3">
            {agencies.map(agency => (
              <div 
                key={agency.id} 
                onClick={() => setActiveAgencyId(agency.id)}
                className={`p-4 rounded border cursor-pointer flex items-center justify-between transition-colors ${activeAgency?.id === agency.id ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-500' : 'bg-slate-50 border-slate-200 hover:border-blue-300'}`}
              >
                <div className="flex items-center space-x-3">
                  <Building className={`w-5 h-5 ${activeAgency?.id === agency.id ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span className="font-bold text-slate-700">{agency.name}</span>
                </div>
                {activeAgency?.id === agency.id && <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600 bg-blue-100 px-2 py-1 rounded">Active</span>}
              </div>
            ))}
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
            
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Letterhead (PDF)</label>
              <input 
                type="file" 
                accept="application/pdf"
                ref={fileInputRef}
                onChange={handleFileChange} 
                className="hidden" 
              />
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-widest bg-slate-100 text-slate-700 rounded border border-slate-300 hover:bg-slate-200 transition-colors flex items-center"
                >
                  <FileUp className="w-4 h-4 mr-2" /> Upload PDF
                </button>
                {fileName && <span className="text-sm text-slate-600 truncate">{fileName}</span>}
              </div>
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
                  <div key={index} className="flex items-center space-x-3">
                    <div className="flex-1">
                      <input 
                        required 
                        type="text" 
                        value={div.name} 
                        onChange={e => handleDivisionChange(index, 'name', e.target.value)} 
                        className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" 
                        placeholder="Division Name (e.g. SABARMATI)" 
                      />
                    </div>
                    <div className="flex-1">
                      <input 
                        required 
                        type="text" 
                        value={div.prefix} 
                        onChange={e => handleDivisionChange(index, 'prefix', e.target.value)} 
                        className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" 
                        placeholder="Prefix (e.g. 21 IS)" 
                      />
                    </div>
                    {divisions.length > 1 && (
                      <button type="button" onClick={() => handleRemoveDivision(index)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
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
    </div>
  );
}
