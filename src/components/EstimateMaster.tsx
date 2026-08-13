import React, { useState, useEffect } from 'react';
import { defaultEstimateData, defaultAmorphousEstimateData, EstimateItem } from '../lib/estimateData';
import { Edit2, Save, FileSpreadsheet, Loader2, X, ChevronDown, ChevronUp, Plus, Trash2, Layers } from 'lucide-react';
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
  const { activeAgency, updateAgency } = useAgency();

  const [crgoData, setCrgoData] = useState<EstimateItem[]>([]);
  const [amorphousData, setAmorphousData] = useState<EstimateItem[]>([]);
  const [woundCoreData, setWoundCoreData] = useState<EstimateItem[]>([]);

  const [editingSection, setEditingSection] = useState<'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Accordion minimize / expand state
  const [openCrgo, setOpenCrgo] = useState(true);
  const [openAmorphous, setOpenAmorphous] = useState(false);
  const [openWoundCore, setOpenWoundCore] = useState(false);

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

  const handleSaveSection = async (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE') => {
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

      await updateAgency(activeAgency.id, updatePayload);
      setEditingSection(null);
    } catch (err) {
      alert(`Failed to save ${section} Estimate Master data.`);
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
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden transition-all">
        {/* Accordion Header */}
        <div 
          onClick={() => setIsOpen(!isOpen)}
          className={`p-4 flex items-center justify-between cursor-pointer select-none transition-colors ${
            isOpen ? 'bg-slate-50/80 border-b border-slate-200' : 'hover:bg-slate-50'
          }`}
        >
          <div className="flex items-center space-x-3">
            <span className={`w-3 h-3 rounded-full ${themeColor}`}></span>
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                {sectionTitle}
                <span className="text-xs px-2 py-0.5 rounded font-normal bg-slate-100 text-slate-600 border border-slate-200">
                  {data.length} Items
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center space-x-3" onClick={e => e.stopPropagation()}>
            {isOpen && (
              <div className="flex space-x-2 mr-2">
                <button 
                  onClick={() => handleAddItem(sectionKey)}
                  className="flex items-center px-3 py-1.5 text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 rounded transition-colors"
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
                    className="flex items-center px-3 py-1.5 text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 rounded transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5 mr-1" />
                    Edit Rates
                  </button>
                ) : (
                  <>
                    <button 
                      onClick={() => handleCancelSection(sectionKey)}
                      disabled={isSaving}
                      className="flex items-center px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 border border-slate-300 rounded transition-colors disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5 mr-1" />
                      Cancel
                    </button>
                    <button 
                      onClick={() => handleSaveSection(sectionKey)}
                      disabled={isSaving}
                      className="flex items-center px-3 py-1.5 text-xs font-bold bg-green-600 text-white hover:bg-green-700 rounded transition-colors disabled:opacity-50 shadow-sm"
                    >
                      {isSaving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                      Save {sectionKey}
                    </button>
                  </>
                )}
              </div>
            )}

            <button 
              onClick={() => setIsOpen(!isOpen)}
              className="p-1 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-200/50"
            >
              {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Accordion Content Table */}
        {isOpen && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 min-w-max">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 whitespace-nowrap sticky left-0 bg-slate-50 z-10 border-r border-slate-200 w-16">Sr.</th>
                  <th className="px-4 py-3 whitespace-nowrap sticky left-[64px] bg-slate-50 z-10 border-r border-slate-200 min-w-[260px]">Item Description</th>
                  <th className="px-4 py-3 whitespace-nowrap border-r border-slate-200 w-20">Unit</th>
                  {kvaColumns.map(kva => (
                    <th key={kva} className="px-3 py-3 text-right bg-blue-50/40 text-blue-900 whitespace-nowrap font-mono">
                      {kva} / 11 KVA
                    </th>
                  ))}
                  {isEditing && <th className="px-2 py-3 text-center">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-2 font-medium text-slate-900 whitespace-nowrap sticky left-0 bg-white group-hover:bg-slate-50 border-r border-slate-100">
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
                    <td className="px-4 py-2 whitespace-nowrap sticky left-[64px] bg-white group-hover:bg-slate-50 border-r border-slate-100">
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
                    <td className="px-4 py-2 whitespace-nowrap border-r border-slate-100">
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
                            className="w-20 px-2 py-1 text-right text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
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
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-lg shadow-sm border border-slate-200 gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center">
            <FileSpreadsheet className="w-6 h-6 mr-3 text-blue-600" />
            Estimate Master Rates - {activeAgency.name}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Agency-specific repair and material rate masters for CRGO, Amorphous, and Wound Core transformers.
          </p>
        </div>

        <div className="flex items-center space-x-2 self-end md:self-center">
          <button 
            onClick={handleExpandAll}
            className="flex items-center px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 transition-colors"
          >
            <ChevronDown className="w-3.5 h-3.5 mr-1" /> Expand All
          </button>
          <button 
            onClick={handleCollapseAll}
            className="flex items-center px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 transition-colors"
          >
            <ChevronUp className="w-3.5 h-3.5 mr-1" /> Minimize All
          </button>
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
    </div>
  );
}

