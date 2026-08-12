import React, { useState, useEffect } from 'react';
import { defaultEstimateData, EstimateItem } from '../lib/estimateData';
import { Edit2, Save, FileSpreadsheet, Loader2, X } from 'lucide-react';
import { useAgency } from '../lib/AgencyContext';

const kvaColumns = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'] as const;
type KvaType = typeof kvaColumns[number];

export default function EstimateMaster() {
  const { activeAgency, updateAgency } = useAgency();
  const [data, setData] = useState<EstimateItem[]>(defaultEstimateData);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (activeAgency) {
      if (activeAgency.estimateMaster && activeAgency.estimateMaster.length > 0) {
        // Deep copy and merge with default rates to ensure new KVAs exist for older saved data
        const loadedData = JSON.parse(JSON.stringify(activeAgency.estimateMaster));
        const mergedData = loadedData.map((item: any) => {
           const defaultRates = { "5": null, "10": null, "16": null, "25": null, "50": null, "63": null, "100": null, "200": null, "315": null, "500": null };
           return {
             ...item,
             rates: {
               ...defaultRates,
               ...item.rates
             }
           };
        });
        setData(mergedData);
      } else {
        setData(JSON.parse(JSON.stringify(defaultEstimateData)));
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

  const handleRateChange = (index: number, kva: KvaType, value: string) => {
    const newData = [...data];
    if (value.trim() === '') {
      newData[index].rates[kva] = null;
    } else {
      const numValue = parseFloat(value);
      newData[index].rates[kva] = isNaN(numValue) ? null : numValue;
    }
    setData(newData);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateAgency(activeAgency.id, { estimateMaster: data });
      setIsEditing(false);
    } catch (err) {
      alert("Failed to save estimate master data.");
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    // Revert to context data
    if (activeAgency.estimateMaster && activeAgency.estimateMaster.length > 0) {
      const loadedData = JSON.parse(JSON.stringify(activeAgency.estimateMaster));
      const mergedData = loadedData.map((item: any) => {
         const defaultRates = { "5": null, "10": null, "16": null, "25": null, "50": null, "63": null, "100": null, "200": null, "315": null, "500": null };
         return { ...item, rates: { ...defaultRates, ...item.rates } };
      });
      setData(mergedData);
    } else {
      setData(JSON.parse(JSON.stringify(defaultEstimateData)));
    }
    setIsEditing(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-6 rounded shadow-sm border border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center">
            <FileSpreadsheet className="w-6 h-6 mr-3 text-blue-600" />
            Estimate Master Data (CRGO) - {activeAgency.name}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Agency-specific material and labor rates for CRGO repairs across all KVAs. Blank fields indicate items that are N/A or have no cost.
          </p>
        </div>
        <div className="flex space-x-2">
          {!isEditing ? (
            <button 
              onClick={() => setIsEditing(true)}
              className="flex items-center px-4 py-2 text-sm font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 rounded transition-colors"
            >
              <Edit2 className="w-4 h-4 mr-2" />
              Edit Rates
            </button>
          ) : (
            <>
              <button 
                onClick={handleCancel}
                disabled={isSaving}
                className="flex items-center px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100 border border-transparent rounded transition-colors disabled:opacity-50"
              >
                <X className="w-4 h-4 mr-2" />
                Cancel
              </button>
              <button 
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center px-4 py-2 text-sm font-bold bg-green-600 text-white hover:bg-green-700 rounded transition-colors disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save Changes
              </button>
            </>
          )}
        </div>
      </div>

      <div className="bg-white rounded shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 min-w-max">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 font-bold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap sticky left-0 bg-slate-50 z-10 border-r border-slate-200">Sr.</th>
                <th className="px-4 py-3 whitespace-nowrap sticky left-[60px] bg-slate-50 z-10 border-r border-slate-200">Item Description</th>
                <th className="px-4 py-3 whitespace-nowrap">Unit</th>
                {kvaColumns.map(kva => (
                  <th key={kva} className="px-4 py-3 text-right bg-blue-50/50 text-blue-800 whitespace-nowrap">
                    {kva} / 11 KVA
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2 font-medium text-slate-900 whitespace-nowrap sticky left-0 bg-white group-hover:bg-slate-50 border-r border-slate-100">{item.itemCode}</td>
                  <td className="px-4 py-2 whitespace-nowrap sticky left-[60px] bg-white group-hover:bg-slate-50 border-r border-slate-100">{item.itemName}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{item.unit}</td>
                  {kvaColumns.map(kva => (
                    <td key={kva} className="px-4 py-2 text-right font-mono text-slate-700">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={item.rates[kva] ?? ''}
                          onChange={(e) => handleRateChange(idx, kva, e.target.value)}
                          className="w-20 px-2 py-1 text-right text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                        />
                      ) : (
                        item.rates[kva] !== null && item.rates[kva] !== undefined ? item.rates[kva]!.toFixed(2) : ''
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
