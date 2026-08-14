import React, { useState, useEffect } from 'react';
import { defaultEstimateData, defaultAmorphousEstimateData, EstimateItem } from '../lib/estimateData';
import { 
  Edit2, Save, FileSpreadsheet, Loader2, X, ChevronDown, ChevronUp, Plus, Trash2, 
  Layers, Building2, CheckCircle2, RefreshCw, AlertCircle, Sparkles, Check
} from 'lucide-react';
import { useAgency } from '../lib/AgencyContext';

const kvaColumns = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'] as const;
type KvaType = typeof kvaColumns[number];

const defaultRates = { "5": null, "10": null, "16": null, "25": null, "50": null, "63": null, "100": null, "200": null, "315": null, "500": null };

function mergeDefaultRates(items: EstimateItem[]): EstimateItem[] {
  return items.map((item: any) => ({
    ...item,
    rates: {
      ...defaultRates,
      ...item.rates
    }
  }));
}

export default function EstimateMaster() {
  const { agencies, activeAgency, updateAgency, updateAllAgenciesEstimateMaster } = useAgency();

  const [crgoData, setCrgoData] = useState<EstimateItem[]>([]);
  const [amorphousData, setAmorphousData] = useState<EstimateItem[]>([]);
  const [woundCoreData, setWoundCoreData] = useState<EstimateItem[]>([]);

  const [editingSection, setEditingSection] = useState<'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Accordion minimize / expand state
  const [openCrgo, setOpenCrgo] = useState(true);
  const [openAmorphous, setOpenAmorphous] = useState(false);
  const [openWoundCore, setOpenWoundCore] = useState(false);

  // Multi-agency Save Confirmation Modal
  const [pendingSaveSection, setPendingSaveSection] = useState<'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | null>(null);
  const [saveScope, setSaveScope] = useState<'ALL' | 'SINGLE'>('ALL');

  // Full Sync Modal
  const [showFullSyncModal, setShowFullSyncModal] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (activeAgency) {
      // Load CRGO
      if (activeAgency.estimateMasterCRGO && activeAgency.estimateMasterCRGO.length > 0) {
        setCrgoData(mergeDefaultRates(JSON.parse(JSON.stringify(activeAgency.estimateMasterCRGO))));
      } else if (activeAgency.estimateMaster && activeAgency.estimateMaster.length > 0) {
        setCrgoData(mergeDefaultRates(JSON.parse(JSON.stringify(activeAgency.estimateMaster))));
      } else {
        setCrgoData(JSON.parse(JSON.stringify(defaultEstimateData)));
      }

      // Load Amorphous
      if (activeAgency.estimateMasterAmorphous && activeAgency.estimateMasterAmorphous.length > 0) {
        setAmorphousData(mergeDefaultRates(JSON.parse(JSON.stringify(activeAgency.estimateMasterAmorphous))));
      } else {
        setAmorphousData(JSON.parse(JSON.stringify(defaultAmorphousEstimateData)));
      }

      // Load Wound Core
      if (activeAgency.estimateMasterWoundCore && activeAgency.estimateMasterWoundCore.length > 0) {
        setWoundCoreData(mergeDefaultRates(JSON.parse(JSON.stringify(activeAgency.estimateMasterWoundCore))));
      } else if (activeAgency.estimateMasterCRGO && activeAgency.estimateMasterCRGO.length > 0) {
        setWoundCoreData(mergeDefaultRates(JSON.parse(JSON.stringify(activeAgency.estimateMasterCRGO))));
      } else if (activeAgency.estimateMaster && activeAgency.estimateMaster.length > 0) {
        setWoundCoreData(mergeDefaultRates(JSON.parse(JSON.stringify(activeAgency.estimateMaster))));
      } else {
        setWoundCoreData(JSON.parse(JSON.stringify(defaultEstimateData)));
      }
    }
  }, [activeAgency]);

  if (!activeAgency) {
    return (
      <div className="p-8 text-center text-slate-500">
        Please select or create an agency first.
      </div>
    );
  }

  const handleExpandAll = () => {
    setOpenCrgo(true);
    setOpenAmorphous(true);
    setOpenWoundCore(true);
  };

  const handleCollapseAll = () => {
    setOpenCrgo(false);
    setOpenAmorphous(false);
    setOpenWoundCore(false);
  };

  // Section specific handlers
  const getSectionData = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE') => {
    if (section === 'CRGO') return crgoData;
    if (section === 'AMORPHOUS') return amorphousData;
    return woundCoreData;
  };

  const setSectionData = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE', newData: EstimateItem[]) => {
    if (section === 'CRGO') setCrgoData(newData);
    else if (section === 'AMORPHOUS') setAmorphousData(newData);
    else setWoundCoreData(newData);
  };

  const handleItemDetailsChange = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE', index: number, field: 'itemCode' | 'itemName' | 'unit', value: string) => {
    const data = [...getSectionData(section)];
    data[index] = { ...data[index], [field]: value };
    setSectionData(section, data);
  };

  const handleRateChange = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE', index: number, kva: KvaType, value: string) => {
    const data = [...getSectionData(section)];
    if (value.trim() === '') {
      data[index].rates[kva] = null;
    } else {
      const numValue = parseFloat(value);
      data[index].rates[kva] = isNaN(numValue) ? null : numValue;
    }
    setSectionData(section, data);
  };

  const handleAddItem = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE') => {
    const data = [...getSectionData(section)];
    data.push({
      itemCode: `${data.length + 1}`,
      itemName: '',
      unit: 'QTY',
      rates: { ...defaultRates }
    });
    setSectionData(section, data);
    if (editingSection !== section) setEditingSection(section);
  };

  const handleDeleteItem = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE', index: number) => {
    const data = [...getSectionData(section)];
    data.splice(index, 1);
    setSectionData(section, data);
  };

  // Trigger Save Confirmation Prompt
  const handleInitiateSave = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE') => {
    setPendingSaveSection(section);
    setSaveScope('ALL'); // Default to all agencies as requested
  };

  // Execute Save based on chosen scope
  const handleConfirmSaveSection = async () => {
    if (!pendingSaveSection) return;
    const section = pendingSaveSection;
    setIsSaving(true);
    try {
      const updatePayload: any = {};
      if (section === 'CRGO') {
        updatePayload.estimateMasterCRGO = crgoData;
        updatePayload.estimateMaster = crgoData; // Legacy support
      } else if (section === 'AMORPHOUS') {
        updatePayload.estimateMasterAmorphous = amorphousData;
      } else if (section === 'WOUND_CORE') {
        updatePayload.estimateMasterWoundCore = woundCoreData;
      }

      if (saveScope === 'ALL') {
        await updateAllAgenciesEstimateMaster(updatePayload);
        setSyncSuccessMsg(`Successfully saved and applied ${section} rates across all ${agencies.length} agencies!`);
      } else {
        await updateAgency(activeAgency.id, updatePayload);
        setSyncSuccessMsg(`Successfully saved ${section} rates for ${activeAgency.name}.`);
      }

      setEditingSection(null);
      setPendingSaveSection(null);

      // Clear success notification after 5 seconds
      setTimeout(() => {
        setSyncSuccessMsg(null);
      }, 5000);
    } catch (err) {
      alert(`Failed to save ${section} Estimate Master data.`);
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  // Execute full sync of all 3 sections across all agencies
  const handleExecuteFullSync = async () => {
    setIsSaving(true);
    try {
      const fullPayload = {
        estimateMasterCRGO: crgoData,
        estimateMaster: crgoData,
        estimateMasterAmorphous: amorphousData,
        estimateMasterWoundCore: woundCoreData,
      };

      await updateAllAgenciesEstimateMaster(fullPayload);
      setShowFullSyncModal(false);
      setSyncSuccessMsg(`Successfully synchronized all CRGO, Amorphous & Wound Core rates to all ${agencies.length} agencies!`);
      setTimeout(() => {
        setSyncSuccessMsg(null);
      }, 5000);
    } catch (err) {
      alert('Failed to sync master rates across agencies.');
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelSection = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE') => {
    if (section === 'CRGO') {
      if (activeAgency.estimateMasterCRGO && activeAgency.estimateMasterCRGO.length > 0) {
        setCrgoData(mergeDefaultRates(JSON.parse(JSON.stringify(activeAgency.estimateMasterCRGO))));
      } else if (activeAgency.estimateMaster && activeAgency.estimateMaster.length > 0) {
        setCrgoData(mergeDefaultRates(JSON.parse(JSON.stringify(activeAgency.estimateMaster))));
      } else {
        setCrgoData(JSON.parse(JSON.stringify(defaultEstimateData)));
      }
    } else if (section === 'AMORPHOUS') {
      if (activeAgency.estimateMasterAmorphous && activeAgency.estimateMasterAmorphous.length > 0) {
        setAmorphousData(mergeDefaultRates(JSON.parse(JSON.stringify(activeAgency.estimateMasterAmorphous))));
      } else {
        setAmorphousData(JSON.parse(JSON.stringify(defaultAmorphousEstimateData)));
      }
    } else if (section === 'WOUND_CORE') {
      if (activeAgency.estimateMasterWoundCore && activeAgency.estimateMasterWoundCore.length > 0) {
        setWoundCoreData(mergeDefaultRates(JSON.parse(JSON.stringify(activeAgency.estimateMasterWoundCore))));
      } else if (activeAgency.estimateMasterCRGO && activeAgency.estimateMasterCRGO.length > 0) {
        setWoundCoreData(mergeDefaultRates(JSON.parse(JSON.stringify(activeAgency.estimateMasterCRGO))));
      } else {
        setWoundCoreData(JSON.parse(JSON.stringify(defaultEstimateData)));
      }
    }
    setEditingSection(null);
  };

  const renderSectionTable = (
    sectionKey: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE',
    sectionTitle: string,
    subtitle: string,
    isOpen: boolean,
    setIsOpen: (val: boolean) => void,
    data: EstimateItem[],
    themeColor: string
  ) => {
    const isEditing = editingSection === sectionKey;

    return (
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden transition-all">
        {/* Accordion Header */}
        <div 
          onClick={() => setIsOpen(!isOpen)}
          className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between cursor-pointer select-none transition-colors gap-3 ${
            isOpen ? 'bg-slate-50/90 border-b border-slate-200' : 'hover:bg-slate-50'
          }`}
        >
          <div className="flex items-center space-x-3">
            <span className={`w-3 h-3 rounded-full ${themeColor} shrink-0`}></span>
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                {sectionTitle}
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                  {data.length} Items
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center space-x-2 self-end sm:self-center" onClick={e => e.stopPropagation()}>
            {isOpen && (
              <div className="flex items-center space-x-2 mr-1">
                <button 
                  onClick={() => handleAddItem(sectionKey)}
                  className="flex items-center px-3 py-1.5 text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors shadow-2xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add Item
                </button>
                {!isEditing ? (
                  <button 
                    onClick={() => {
                      setEditingSection(sectionKey);
                      setIsOpen(true);
                    }}
                    className="flex items-center px-3 py-1.5 text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 rounded-lg transition-colors shadow-2xs"
                  >
                    <Edit2 className="w-3.5 h-3.5 mr-1" />
                    Edit Rates
                  </button>
                ) : (
                  <>
                    <button 
                      onClick={() => handleCancelSection(sectionKey)}
                      disabled={isSaving}
                      className="flex items-center px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5 mr-1" />
                      Cancel
                    </button>
                    <button 
                      onClick={() => handleInitiateSave(sectionKey)}
                      disabled={isSaving}
                      className="flex items-center px-3.5 py-1.5 text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50 shadow-sm"
                    >
                      <Save className="w-3.5 h-3.5 mr-1.5" />
                      Save Rates
                    </button>
                  </>
                )}
              </div>
            )}

            <button 
              onClick={() => setIsOpen(!isOpen)}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60"
            >
              {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Accordion Content Table */}
        {isOpen && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 min-w-max">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="px-3.5 py-3 whitespace-nowrap sticky left-0 bg-slate-50 z-10 border-r border-slate-200 w-16">Sr.</th>
                  <th className="px-3.5 py-3 whitespace-nowrap sticky left-[64px] bg-slate-50 z-10 border-r border-slate-200 min-w-[260px]">Item Description</th>
                  <th className="px-3 py-3 whitespace-nowrap border-r border-slate-200 w-20">Unit</th>
                  {kvaColumns.map(kva => (
                    <th key={kva} className="px-3 py-3 text-right bg-blue-50/50 text-blue-900 whitespace-nowrap font-mono">
                      {kva} / 11 KVA
                    </th>
                  ))}
                  {isEditing && <th className="px-2 py-3 text-center">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-3.5 py-2 font-medium text-slate-900 whitespace-nowrap sticky left-0 bg-white group-hover:bg-slate-50 border-r border-slate-100">
                      {isEditing ? (
                        <input 
                          type="text" 
                          value={item.itemCode} 
                          onChange={(e) => handleItemDetailsChange(sectionKey, idx, 'itemCode', e.target.value)}
                          className="w-14 px-1.5 py-1 text-xs border border-slate-300 rounded font-mono"
                        />
                      ) : (
                        item.itemCode
                      )}
                    </td>
                    <td className="px-3.5 py-2 whitespace-nowrap sticky left-[64px] bg-white group-hover:bg-slate-50 border-r border-slate-100">
                      {isEditing ? (
                        <input 
                          type="text" 
                          value={item.itemName} 
                          onChange={(e) => handleItemDetailsChange(sectionKey, idx, 'itemName', e.target.value)}
                          className="w-full min-w-[280px] px-2 py-1 text-xs border border-slate-300 rounded font-medium text-slate-900"
                        />
                      ) : (
                        <span className="font-medium text-slate-800">{item.itemName}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap border-r border-slate-100">
                      {isEditing ? (
                        <select 
                          value={item.unit} 
                          onChange={(e) => handleItemDetailsChange(sectionKey, idx, 'unit', e.target.value)}
                          className="px-1.5 py-1 text-xs border border-slate-300 rounded"
                        >
                          <option value="Y">Y</option>
                          <option value="N">N</option>
                          <option value="QTY">QTY</option>
                          <option value="KG">KG</option>
                        </select>
                      ) : (
                        <span className="text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-mono">{item.unit}</span>
                      )}
                    </td>
                    {kvaColumns.map(kva => (
                      <td key={kva} className="px-3 py-2 text-right font-mono text-slate-700">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.01"
                            value={item.rates[kva] ?? ''}
                            onChange={(e) => handleRateChange(sectionKey, idx, kva, e.target.value)}
                            className="w-20 px-2 py-1 text-right text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 font-mono"
                            placeholder="-"
                          />
                        ) : (
                          item.rates[kva] !== null && item.rates[kva] !== undefined ? (
                            <span className="font-semibold text-slate-800">{item.rates[kva]!.toFixed(2)}</span>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )
                        )}
                      </td>
                    ))}
                    {isEditing && (
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleDeleteItem(sectionKey, idx)}
                          className="p-1 text-red-500 hover:bg-red-50 rounded"
                          title="Delete item row"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner / Success Notification */}
      {syncSuccessMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl flex items-center justify-between shadow-xs animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="text-sm font-semibold">{syncSuccessMsg}</span>
          </div>
          <button 
            onClick={() => setSyncSuccessMsg(null)}
            className="text-emerald-600 hover:text-emerald-800 p-1 rounded-lg hover:bg-emerald-100/60"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center bg-white p-5 sm:p-6 rounded-xl shadow-xs border border-slate-200 gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900 flex items-center">
              <FileSpreadsheet className="w-6 h-6 mr-2.5 text-blue-600" />
              Estimate Master Rates
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 rounded-full">
              Active: {activeAgency.name}
            </span>
            <span className="px-2.5 py-0.5 text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200 rounded-full flex items-center gap-1">
              <Building2 className="w-3.5 h-3.5 text-slate-500" />
              {agencies.length} {agencies.length === 1 ? 'Agency' : 'Agencies'} Configured
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1.5">
            Standard tender repair and material rate master for CRGO, Amorphous, and Wound Core transformers. Rates can be unified across all agencies automatically.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-end">
          <button 
            onClick={() => setShowFullSyncModal(true)}
            className="flex items-center px-3.5 py-2 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-200 transition-colors shadow-2xs"
            title="Synchronize all CRGO, Amorphous & Wound Core rates across all agencies"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5 text-indigo-600" /> 
            Sync Rates to All Agencies
          </button>
          <div className="flex items-center space-x-1.5 border-l border-slate-200 pl-2">
            <button 
              onClick={handleExpandAll}
              className="flex items-center px-2.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-300 transition-colors"
            >
              <ChevronDown className="w-3.5 h-3.5 mr-1" /> Expand
            </button>
            <button 
              onClick={handleCollapseAll}
              className="flex items-center px-2.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-300 transition-colors"
            >
              <ChevronUp className="w-3.5 h-3.5 mr-1" /> Minimize
            </button>
          </div>
        </div>
      </div>

      {/* Accordion Sections */}
      <div className="space-y-4">
        {renderSectionTable(
          'CRGO',
          'CRGO Estimate Master',
          'Standard repair and material rates for CRGO core transformers',
          openCrgo,
          setOpenCrgo,
          crgoData,
          'bg-blue-600'
        )}

        {renderSectionTable(
          'AMORPHOUS',
          'Amorphous Estimate Master',
          'Fixed capacity & OGP repair rate master for Amorphous core transformers',
          openAmorphous,
          setOpenAmorphous,
          amorphousData,
          'bg-amber-500'
        )}

        {renderSectionTable(
          'WOUND_CORE',
          'Wound Core Estimate Master',
          'Standard repair and material rates for Wound Core transformers',
          openWoundCore,
          setOpenWoundCore,
          woundCoreData,
          'bg-indigo-600'
        )}
      </div>

      {/* Section Save Scope Confirmation Dialog */}
      {pendingSaveSection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 space-y-5 animate-in zoom-in-95">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Save Rate Changes
                  </h3>
                  <p className="text-xs text-slate-500">
                    Updating rates for <span className="font-semibold text-slate-800">{pendingSaveSection} Core Master</span>
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setPendingSaveSection(null)}
                disabled={isSaving}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200">
              Estimate Master rates are typically unified across DISCOM tenders. Would you like to update this rate master across <strong>all registered agencies</strong> or only for the active agency?
            </p>

            {/* Scope Selection Cards */}
            <div className="space-y-2.5">
              {/* Option 1: ALL Agencies (Recommended) */}
              <div 
                onClick={() => setSaveScope('ALL')}
                className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                  saveScope === 'ALL' 
                    ? 'border-blue-600 bg-blue-50/50 shadow-xs' 
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <input 
                      type="radio" 
                      name="saveScope" 
                      checked={saveScope === 'ALL'} 
                      onChange={() => setSaveScope('ALL')}
                      className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-slate-300"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">Apply to ALL Agencies ({agencies.length})</span>
                        <span className="text-[10px] uppercase font-bold bg-blue-600 text-white px-2 py-0.5 rounded-full">Recommended</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Saves and synchronizes these {pendingSaveSection} rates across all {agencies.length} agencies so all estimates use uniform rates.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Agency Chips */}
                <div className="mt-3 flex flex-wrap gap-1.5 pl-6">
                  {agencies.map(ag => (
                    <span 
                      key={ag.id} 
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-md border ${
                        ag.id === activeAgency.id 
                          ? 'bg-blue-100 text-blue-800 border-blue-300 font-bold' 
                          : 'bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                    >
                      {ag.name} {ag.id === activeAgency.id ? '(Active)' : ''}
                    </span>
                  ))}
                </div>
              </div>

              {/* Option 2: Single Agency */}
              <div 
                onClick={() => setSaveScope('SINGLE')}
                className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                  saveScope === 'SINGLE' 
                    ? 'border-blue-600 bg-blue-50/50 shadow-xs' 
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <input 
                    type="radio" 
                    name="saveScope" 
                    checked={saveScope === 'SINGLE'} 
                    onChange={() => setSaveScope('SINGLE')}
                    className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-slate-300"
                  />
                  <div>
                    <span className="text-sm font-bold text-slate-900">Apply to Current Agency Only</span>
                    <p className="text-xs text-slate-500 mt-1">
                      Only updates {pendingSaveSection} rates for <strong className="text-slate-700">{activeAgency.name}</strong>. Other agencies will retain their previous rates.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setPendingSaveSection(null)}
                disabled={isSaving}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSaveSection}
                disabled={isSaving}
                className="flex items-center px-5 py-2.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm transition-colors disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    Saving Rates...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-1.5" />
                    {saveScope === 'ALL' ? `Save & Apply to All (${agencies.length}) Agencies` : `Save for ${activeAgency.name}`}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full Sync Modal */}
      {showFullSyncModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 space-y-5 animate-in zoom-in-95">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-100">
                  <RefreshCw className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Sync Entire Estimate Master
                  </h3>
                  <p className="text-xs text-slate-500">
                    Synchronize all 3 rate categories across all agencies
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowFullSyncModal(false)}
                disabled={isSaving}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600">
              <p className="bg-indigo-50/60 p-3 rounded-lg border border-indigo-100 text-indigo-900 font-medium">
                This will copy the current rates from <span className="font-bold text-indigo-950">{activeAgency.name}</span> to all other <strong>{agencies.length - 1}</strong> registered agencies.
              </p>

              <div className="border border-slate-200 rounded-xl p-3.5 space-y-2 bg-slate-50/50">
                <div className="font-bold text-slate-800 text-xs mb-1">Rate Master Summary to be Synced:</div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-white p-2 rounded-lg border border-slate-200">
                    <span className="block text-xs font-bold text-blue-700">{crgoData.length}</span>
                    <span className="text-[10px] text-slate-500">CRGO Items</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-slate-200">
                    <span className="block text-xs font-bold text-amber-700">{amorphousData.length}</span>
                    <span className="text-[10px] text-slate-500">Amorphous Items</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-slate-200">
                    <span className="block text-xs font-bold text-indigo-700">{woundCoreData.length}</span>
                    <span className="text-[10px] text-slate-500">Wound Core Items</span>
                  </div>
                </div>
              </div>

              <div>
                <span className="font-semibold text-slate-700">Target Agencies to Receive Rates:</span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {agencies.map(ag => (
                    <span 
                      key={ag.id} 
                      className={`text-[11px] px-2.5 py-1 rounded-md border ${
                        ag.id === activeAgency.id 
                          ? 'bg-blue-50 text-blue-700 border-blue-200 font-semibold' 
                          : 'bg-white text-slate-800 border-slate-300 font-medium'
                      }`}
                    >
                      {ag.name} {ag.id === activeAgency.id ? '(Source)' : '✓'}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowFullSyncModal(false)}
                disabled={isSaving}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteFullSync}
                disabled={isSaving}
                className="flex items-center px-5 py-2.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm transition-colors disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    Synchronizing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-1.5" />
                    Sync All Rates to All Agencies
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
