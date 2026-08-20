import React, { useState, useEffect } from 'react';
import { 
  defaultEstimateData, 
  defaultAmorphousEstimateData, 
  defaultWoundCoreEstimateData, 
  defaultOverhaulingEstimateData,
  defaultCircleLimitsEstimateData,
  defaultRates, 
  EstimateItem 
} from '../lib/estimateData';
import { 
  Edit2, Save, FileSpreadsheet, Loader2, X, ChevronDown, ChevronUp, Plus, Trash2, 
  Layers, Building2, CheckCircle2, RefreshCw, AlertCircle, AlertTriangle, Sparkles, Check, Globe2, ShieldCheck, Wrench, Scale, LayoutGrid, FileText, Crown
} from 'lucide-react';
import { useAgency } from '../lib/AgencyContext';

const kvaColumns = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'] as const;
type KvaType = typeof kvaColumns[number];

function mergeDefaultRates(items: EstimateItem[]): EstimateItem[] {
  return items.map((item: any) => ({
    ...item,
    rates: {
      ...defaultRates,
      ...item.rates
    }
  }));
}

function normalizeCircleLimitsData(items: EstimateItem[] | undefined, defaultData: EstimateItem[]): EstimateItem[] {
  if (!items || items.length === 0) {
    return JSON.parse(JSON.stringify(defaultData));
  }

  const itemMap = new Map<string, EstimateItem>();
  items.forEach(it => {
    const code = (it.itemCode || '').trim().toLowerCase();
    if (code) itemMap.set(code, it);
  });

  const result: EstimateItem[] = [];
  const processedCodes = new Set<string>();

  defaultData.forEach(defItem => {
    const code = (defItem.itemCode || '').trim().toLowerCase();
    processedCodes.add(code);
    const existing = itemMap.get(code);

    if (existing) {
      result.push({
        itemCode: existing.itemCode || defItem.itemCode,
        itemName: existing.itemName && existing.itemName.trim() !== '' ? existing.itemName : defItem.itemName,
        unit: existing.unit || 'Rs.',
        fixedRate: null,
        rates: { ...defaultRates, ...defItem.rates, ...(existing.rates || {}) }
      });
    } else {
      result.push(JSON.parse(JSON.stringify(defItem)));
    }
  });

  items.forEach(it => {
    const code = (it.itemCode || '').trim().toLowerCase();
    if (code && !processedCodes.has(code)) {
      result.push({
        ...it,
        unit: it.unit || 'Rs.',
        rates: it.rates ? { ...defaultRates, ...it.rates } : { ...defaultRates }
      });
    }
  });

  return result;
}

function normalizeAmorphousOrWoundCoreData(items: EstimateItem[] | undefined, defaultData: EstimateItem[]): EstimateItem[] {
  if (!items || items.length === 0) {
    return JSON.parse(JSON.stringify(defaultData));
  }
  
  // Check if it's the old CRGO array mistakenly stored as Wound Core / Amorphous
  const isLegacyCrgo = items.some(it => {
    const name = (it.itemName || '').toLowerCase();
    return name.includes('dismental') || name.includes('washer ring') || name.includes('hv metal') || name.includes('lv metal');
  });

  // Check if it's the old 10-item placeholder with 0 rates
  const isOldPlaceholder = items.length <= 10 && items.every(it => (!it.fixedRate || it.fixedRate === 0) && (!it.rates || Object.values(it.rates).every(v => v === null || v === 0)));
  
  if (isLegacyCrgo || isOldPlaceholder) {
    return JSON.parse(JSON.stringify(defaultData));
  }

  const itemMap = new Map<string, EstimateItem>();
  items.forEach(it => {
    const code = (it.itemCode || '').trim().toLowerCase();
    if (code) itemMap.set(code, it);
  });

  const result: EstimateItem[] = [];
  const processedCodes = new Set<string>();

  defaultData.forEach(defItem => {
    const code = (defItem.itemCode || '').trim().toLowerCase();
    processedCodes.add(code);
    const existing = itemMap.get(code);

    if (existing) {
      let fRate = existing.fixedRate;
      if (fRate === undefined || fRate === null || fRate === 0) {
        if (defItem.fixedRate) {
          fRate = defItem.fixedRate;
        } else if (existing.rates) {
          const ratesObj = existing.rates as any;
          const nonNull = Object.entries(ratesObj).find(([k, v]) => v !== null && !isNaN(Number(v)) && Number(v) > 0);
          if (nonNull) fRate = Number(nonNull[1]);
        }
      }

      // Merge rates
      const mergedRates = { ...defaultRates, ...defItem.rates, ...(existing.rates || {}) };

      let resolvedUnit = existing.unit;
      if (!resolvedUnit || resolvedUnit.toLowerCase().includes('each') || resolvedUnit.toLowerCase().includes('coil weight')) {
        resolvedUnit = 'QTY';
      }

      result.push({
        itemCode: existing.itemCode || defItem.itemCode,
        itemName: existing.itemName && existing.itemName.trim() !== '' ? existing.itemName : defItem.itemName, // Do not change user's saved description
        unit: resolvedUnit, // Unit set to QTY
        fixedRate: fRate !== undefined && fRate !== null && !isNaN(Number(fRate)) && Number(fRate) > 0 ? Number(fRate) : (defItem.fixedRate || 0),
        rates: mergedRates
      });
    } else {
      result.push(JSON.parse(JSON.stringify(defItem)));
    }
  });

  items.forEach(it => {
    const code = (it.itemCode || '').trim().toLowerCase();
    if (code && !processedCodes.has(code)) {
      let resolvedUnit = it.unit;
      if (!resolvedUnit || resolvedUnit.toLowerCase().includes('each')) {
        resolvedUnit = 'QTY';
      }
      result.push({
        ...it,
        unit: resolvedUnit,
        fixedRate: it.fixedRate !== undefined && it.fixedRate !== null ? Number(it.fixedRate) : 0,
        rates: it.rates ? { ...defaultRates, ...it.rates } : { ...defaultRates }
      });
    }
  });

  return result;
}

function normalizeOverhaulingData(items: EstimateItem[] | undefined, defaultData: EstimateItem[]): EstimateItem[] {
  if (!items || items.length === 0) {
    return JSON.parse(JSON.stringify(defaultData));
  }

  const itemMap = new Map<string, EstimateItem>();
  items.forEach(it => {
    const code = (it.itemCode || '').trim().toLowerCase();
    if (code) itemMap.set(code, it);
  });

  const result: EstimateItem[] = [];
  const processedCodes = new Set<string>();

  defaultData.forEach(defItem => {
    const code = (defItem.itemCode || '').trim().toLowerCase();
    processedCodes.add(code);
    const existing = itemMap.get(code);

    if (existing) {
      let fRate = existing.fixedRate;
      if (fRate === undefined || fRate === null || fRate === 0) {
        if (defItem.fixedRate) {
          fRate = defItem.fixedRate;
        } else if (existing.rates) {
          const ratesObj = existing.rates as any;
          const nonNull = Object.entries(ratesObj).find(([k, v]) => v !== null && !isNaN(Number(v)) && Number(v) > 0);
          if (nonNull) fRate = Number(nonNull[1]);
        }
      }

      let resolvedUnit = existing.unit;
      if (!resolvedUnit || resolvedUnit.toLowerCase().includes('each') || resolvedUnit.toLowerCase().includes('transformer')) {
        resolvedUnit = 'QTY';
      }

      result.push({
        ...defItem,
        ...existing,
        unit: resolvedUnit,
        fixedRate: fRate !== undefined && fRate !== null ? Number(fRate) : (defItem.fixedRate || 0),
        rates: existing.rates ? { ...defItem.rates, ...existing.rates } : { ...defItem.rates }
      });
    } else {
      result.push(JSON.parse(JSON.stringify(defItem)));
    }
  });

  items.forEach(it => {
    const code = (it.itemCode || '').trim().toLowerCase();
    if (code && !processedCodes.has(code)) {
      let resolvedUnit = it.unit;
      if (!resolvedUnit || resolvedUnit.toLowerCase().includes('each') || resolvedUnit.toLowerCase().includes('transformer')) {
        resolvedUnit = 'QTY';
      }
      result.push({
        ...it,
        unit: resolvedUnit,
        fixedRate: it.fixedRate !== undefined && it.fixedRate !== null ? Number(it.fixedRate) : 0,
        rates: it.rates ? { ...defaultRates, ...it.rates } : { ...defaultRates }
      });
    }
  });

  return result;
}

export default function EstimateMaster() {
  const { 
    agencies, 
    activeAgency, 
    isSuperAdmin,
    updateAgency, 
    updateAllAgenciesEstimateMaster, 
    saveGlobalDefaultEstimateMaster,
    globalDefaultEstimateMaster,
    globalConfigError,
    dismissGlobalConfigError
  } = useAgency();

  const [crgoData, setCrgoData] = useState<EstimateItem[]>([]);
  const [amorphousData, setAmorphousData] = useState<EstimateItem[]>([]);
  const [woundCoreData, setWoundCoreData] = useState<EstimateItem[]>([]);
  const [overhaulingData, setOverhaulingData] = useState<EstimateItem[]>([]);
  const [circleLimitsData, setCircleLimitsData] = useState<EstimateItem[]>([]);

  const [editingSection, setEditingSection] = useState<'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS' | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Accordion minimize / expand state
  const [openCrgo, setOpenCrgo] = useState(true);
  const [openAmorphous, setOpenAmorphous] = useState(true);
  const [openWoundCore, setOpenWoundCore] = useState(true);
  const [openOverhauling, setOpenOverhauling] = useState(true);
  const [openCircleLimits, setOpenCircleLimits] = useState(true);

  // Circle limits view toggle: Standard KVA Columns Grid vs Official Document Matrix View
  const [circleLimitsViewMode, setCircleLimitsViewMode] = useState<'standard' | 'matrix'>('standard');

  // Multi-agency Save Confirmation Modal
  const [pendingSaveSection, setPendingSaveSection] = useState<'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS' | null>(null);
  const [saveScope, setSaveScope] = useState<'ALL' | 'SINGLE'>('ALL');

  // Full Sync Modal
  const [showFullSyncModal, setShowFullSyncModal] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (activeAgency) {
      // Load CRGO
      if (activeAgency.estimateMasterCRGO && activeAgency.estimateMasterCRGO.length > 0) {
        setCrgoData(mergeDefaultRates(JSON.parse(JSON.stringify(activeAgency.estimateMasterCRGO))));
      } else if (globalDefaultEstimateMaster?.estimateMasterCRGO && globalDefaultEstimateMaster.estimateMasterCRGO.length > 0) {
        setCrgoData(mergeDefaultRates(JSON.parse(JSON.stringify(globalDefaultEstimateMaster.estimateMasterCRGO))));
      } else if (activeAgency.estimateMaster && activeAgency.estimateMaster.length > 0) {
        setCrgoData(mergeDefaultRates(JSON.parse(JSON.stringify(activeAgency.estimateMaster))));
      } else {
        setCrgoData(JSON.parse(JSON.stringify(defaultEstimateData)));
      }

      // Load Amorphous
      let currentAmorphous: EstimateItem[] = [];
      if (activeAgency.estimateMasterAmorphous && activeAgency.estimateMasterAmorphous.length > 0) {
        currentAmorphous = normalizeAmorphousOrWoundCoreData(activeAgency.estimateMasterAmorphous, defaultAmorphousEstimateData);
      } else if (globalDefaultEstimateMaster?.estimateMasterAmorphous && globalDefaultEstimateMaster.estimateMasterAmorphous.length > 0) {
        currentAmorphous = normalizeAmorphousOrWoundCoreData(globalDefaultEstimateMaster.estimateMasterAmorphous, defaultAmorphousEstimateData);
      } else {
        currentAmorphous = JSON.parse(JSON.stringify(defaultAmorphousEstimateData));
      }
      setAmorphousData(currentAmorphous);

      // Load Wound Core
      const isLegacyWc = (arr?: EstimateItem[]) => !arr || arr.length === 0 || arr.some(it => {
        const name = (it.itemName || '').toLowerCase();
        return name.includes('dismental') || name.includes('washer ring') || name.includes('hv metal') || name.includes('lv metal');
      });

      if (activeAgency.estimateMasterWoundCore && activeAgency.estimateMasterWoundCore.length > 0 && !isLegacyWc(activeAgency.estimateMasterWoundCore)) {
        setWoundCoreData(normalizeAmorphousOrWoundCoreData(activeAgency.estimateMasterWoundCore, currentAmorphous));
      } else if (globalDefaultEstimateMaster?.estimateMasterWoundCore && globalDefaultEstimateMaster.estimateMasterWoundCore.length > 0 && !isLegacyWc(globalDefaultEstimateMaster.estimateMasterWoundCore)) {
        setWoundCoreData(normalizeAmorphousOrWoundCoreData(globalDefaultEstimateMaster.estimateMasterWoundCore, currentAmorphous));
      } else {
        setWoundCoreData(JSON.parse(JSON.stringify(currentAmorphous)));
      }

      // Load Overhauling
      if (activeAgency.estimateMasterOverhauling && activeAgency.estimateMasterOverhauling.length > 0) {
        setOverhaulingData(normalizeOverhaulingData(activeAgency.estimateMasterOverhauling, defaultOverhaulingEstimateData));
      } else if (globalDefaultEstimateMaster?.estimateMasterOverhauling && globalDefaultEstimateMaster.estimateMasterOverhauling.length > 0) {
        setOverhaulingData(normalizeOverhaulingData(globalDefaultEstimateMaster.estimateMasterOverhauling, defaultOverhaulingEstimateData));
      } else {
        setOverhaulingData(JSON.parse(JSON.stringify(defaultOverhaulingEstimateData)));
      }

      // Load Circle Approval Limits
      if (activeAgency.estimateMasterCircleLimits && activeAgency.estimateMasterCircleLimits.length > 0) {
        setCircleLimitsData(normalizeCircleLimitsData(activeAgency.estimateMasterCircleLimits, defaultCircleLimitsEstimateData));
      } else if (globalDefaultEstimateMaster?.estimateMasterCircleLimits && globalDefaultEstimateMaster.estimateMasterCircleLimits.length > 0) {
        setCircleLimitsData(normalizeCircleLimitsData(globalDefaultEstimateMaster.estimateMasterCircleLimits, defaultCircleLimitsEstimateData));
      } else {
        setCircleLimitsData(JSON.parse(JSON.stringify(defaultCircleLimitsEstimateData)));
      }
    }
  }, [activeAgency, globalDefaultEstimateMaster]);

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
    setOpenOverhauling(true);
    setOpenCircleLimits(true);
  };

  const handleCollapseAll = () => {
    setOpenCrgo(false);
    setOpenAmorphous(false);
    setOpenWoundCore(false);
    setOpenOverhauling(false);
    setOpenCircleLimits(false);
  };

  // Section specific handlers
  const getSectionData = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS') => {
    if (section === 'CRGO') return crgoData;
    if (section === 'AMORPHOUS') return amorphousData;
    if (section === 'WOUND_CORE') return woundCoreData;
    if (section === 'OVERHAULING') return overhaulingData;
    return circleLimitsData;
  };

  const setSectionData = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS', newData: EstimateItem[]) => {
    if (section === 'CRGO') setCrgoData(newData);
    else if (section === 'AMORPHOUS') setAmorphousData(newData);
    else if (section === 'WOUND_CORE') setWoundCoreData(newData);
    else if (section === 'OVERHAULING') setOverhaulingData(newData);
    else setCircleLimitsData(newData);
  };

  const handleItemDetailsChange = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS', index: number, field: 'itemCode' | 'itemName' | 'unit', value: string) => {
    const data = [...getSectionData(section)];
    data[index] = { ...data[index], [field]: value };
    setSectionData(section, data);
  };

  const handleRateChange = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS', index: number, kva: KvaType, value: string) => {
    const data = [...getSectionData(section)];
    if (value.trim() === '') {
      data[index].rates[kva] = null;
    } else {
      const numValue = parseFloat(value);
      data[index].rates[kva] = isNaN(numValue) ? null : numValue;
    }
    setSectionData(section, data);
  };

  const handleFixedRateChange = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS', index: number, value: string) => {
    const data = [...getSectionData(section)];
    const numValue = value.trim() === '' ? 0 : parseFloat(value);
    const fixedRate = isNaN(numValue) ? 0 : numValue;
    
    data[index] = {
      ...data[index],
      fixedRate: fixedRate
    };

    // Also sync into rates object for backwards-compatibility
    const itemCode = (data[index].itemCode || '').trim().toLowerCase();
    const itemName = (data[index].itemName || '').toLowerCase();
    
    if (itemCode === '2' || itemName.includes('labour') || itemCode === '7' || itemName.includes('overhauling')) {
      data[index].rates = { "5": fixedRate, "10": fixedRate, "16": fixedRate, "25": fixedRate, "50": fixedRate, "63": fixedRate, "100": fixedRate, "200": fixedRate, "315": fixedRate, "500": fixedRate };
    } else if (itemCode === '6' || itemName.includes('sealing of uneconomical')) {
      data[index].rates = { "5": fixedRate, "10": fixedRate, "16": fixedRate, "25": fixedRate, "50": fixedRate, "63": fixedRate, "100": fixedRate, "200": fixedRate, "315": fixedRate, "500": fixedRate };
    } else if (itemCode === '3' || itemCode === '4') {
      data[index].rates = { "5": fixedRate, "10": fixedRate, "16": fixedRate, "25": fixedRate, "50": fixedRate, "63": fixedRate, "100": fixedRate, "200": fixedRate, "315": fixedRate, "500": fixedRate };
    } else if (itemCode === '1a' || itemName.includes('10 kva') || itemName.includes('10kva')) {
      data[index].rates = { ...data[index].rates, "10": fixedRate };
    } else if (itemCode === '1b' || itemName.includes('16 kva') || itemName.includes('16kva')) {
      data[index].rates = { ...data[index].rates, "16": fixedRate };
    } else if (itemCode === '1c' || itemName.includes('25 kva') || itemName.includes('25kva')) {
      data[index].rates = { ...data[index].rates, "25": fixedRate };
    } else if (itemCode === '1d-1' || itemCode === '1d-2' || itemCode === '1d' || itemName.includes('63 kva') || itemName.includes('63kva')) {
      data[index].rates = { ...data[index].rates, "63": fixedRate };
    } else if (itemCode === '1e' || itemName.includes('100 kva') || itemName.includes('100kva')) {
      data[index].rates = { ...data[index].rates, "100": fixedRate };
    } else if (itemCode === '1f' || itemName.includes('200 kva') || itemName.includes('200kva')) {
      data[index].rates = { ...data[index].rates, "200": fixedRate };
    }

    setSectionData(section, data);
  };

  const handleAddItem = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS') => {
    const data = [...getSectionData(section)];
    const isFixedTable = section === 'AMORPHOUS' || section === 'WOUND_CORE' || section === 'OVERHAULING';
    data.push({
      itemCode: `${data.length + 1}`,
      itemName: '',
      unit: section === 'CIRCLE_LIMITS' ? 'Rs.' : 'QTY',
      fixedRate: isFixedTable ? 0 : undefined,
      rates: { ...defaultRates }
    });
    setSectionData(section, data);
    if (editingSection !== section) setEditingSection(section);
  };

  // Reset Circle Limits to Official UGVCL Clause 4.0 Standard Schedule
  const handleResetCircleLimitsToDefault = () => {
    setCircleLimitsData(JSON.parse(JSON.stringify(defaultCircleLimitsEstimateData)));
    setEditingSection('CIRCLE_LIMITS');
    setOpenCircleLimits(true);
    setSyncSuccessMsg('✓ Restored official UGVCL Clause 4.0 Circle Limit values! Click "Save as Default" to save.');
    setTimeout(() => setSyncSuccessMsg(null), 6000);
  };

  const handleRestoreFromGlobalDefaults = () => {
    if (globalDefaultEstimateMaster) {
      if (globalDefaultEstimateMaster.estimateMasterCRGO && globalDefaultEstimateMaster.estimateMasterCRGO.length > 0) {
        setCrgoData(mergeDefaultRates(JSON.parse(JSON.stringify(globalDefaultEstimateMaster.estimateMasterCRGO))));
      } else {
        setCrgoData(JSON.parse(JSON.stringify(defaultEstimateData)));
      }
      if (globalDefaultEstimateMaster.estimateMasterAmorphous && globalDefaultEstimateMaster.estimateMasterAmorphous.length > 0) {
        setAmorphousData(normalizeAmorphousOrWoundCoreData(globalDefaultEstimateMaster.estimateMasterAmorphous, defaultAmorphousEstimateData));
      } else {
        setAmorphousData(JSON.parse(JSON.stringify(defaultAmorphousEstimateData)));
      }
      if (globalDefaultEstimateMaster.estimateMasterWoundCore && globalDefaultEstimateMaster.estimateMasterWoundCore.length > 0) {
        setWoundCoreData(normalizeAmorphousOrWoundCoreData(globalDefaultEstimateMaster.estimateMasterWoundCore, defaultWoundCoreEstimateData));
      } else {
        setWoundCoreData(JSON.parse(JSON.stringify(defaultWoundCoreEstimateData)));
      }
      if (globalDefaultEstimateMaster.estimateMasterOverhauling && globalDefaultEstimateMaster.estimateMasterOverhauling.length > 0) {
        setOverhaulingData(normalizeOverhaulingData(globalDefaultEstimateMaster.estimateMasterOverhauling, defaultOverhaulingEstimateData));
      } else {
        setOverhaulingData(JSON.parse(JSON.stringify(defaultOverhaulingEstimateData)));
      }
      if (globalDefaultEstimateMaster.estimateMasterCircleLimits && globalDefaultEstimateMaster.estimateMasterCircleLimits.length > 0) {
        setCircleLimitsData(normalizeCircleLimitsData(globalDefaultEstimateMaster.estimateMasterCircleLimits, defaultCircleLimitsEstimateData));
      } else {
        setCircleLimitsData(JSON.parse(JSON.stringify(defaultCircleLimitsEstimateData)));
      }
      setSyncSuccessMsg('✓ Reloaded rates from Global Master! You can edit them as per your own preference or save.');
      setTimeout(() => setSyncSuccessMsg(null), 5000);
    } else {
      setCrgoData(JSON.parse(JSON.stringify(defaultEstimateData)));
      setAmorphousData(JSON.parse(JSON.stringify(defaultAmorphousEstimateData)));
      setWoundCoreData(JSON.parse(JSON.stringify(defaultWoundCoreEstimateData)));
      setOverhaulingData(JSON.parse(JSON.stringify(defaultOverhaulingEstimateData)));
      setCircleLimitsData(JSON.parse(JSON.stringify(defaultCircleLimitsEstimateData)));
      setSyncSuccessMsg('✓ Reset to standard system defaults.');
      setTimeout(() => setSyncSuccessMsg(null), 5000);
    }
  };

  // Synchronize Wound Core to be exactly identical to Amorphous Estimate Master
  const handleSyncWoundCoreWithAmorphous = () => {
    const cloned = JSON.parse(JSON.stringify(amorphousData)).map((it: EstimateItem) => ({
      ...it,
      unit: (it.unit || '').toLowerCase().includes('each') ? 'QTY' : (it.unit || 'QTY')
    }));
    setWoundCoreData(cloned);
    setEditingSection('WOUND_CORE');
    setOpenWoundCore(true);
    setSyncSuccessMsg('✓ Wound Core master updated to match your saved Amorphous items with unit "QTY"! Click "Save as Default" to save.');
    setTimeout(() => setSyncSuccessMsg(null), 6000);
  };

  const handleDeleteItem = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS', index: number) => {
    const data = [...getSectionData(section)];
    data.splice(index, 1);
    setSectionData(section, data);
  };

  // Direct save for active agency
  const handleSaveSectionToActiveAgency = async (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS') => {
    if (!activeAgency) return;
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
      } else if (section === 'OVERHAULING') {
        updatePayload.estimateMasterOverhauling = overhaulingData;
      } else if (section === 'CIRCLE_LIMITS') {
        updatePayload.estimateMasterCircleLimits = circleLimitsData;
      }

      await updateAgency(activeAgency.id, updatePayload);
      setEditingSection(null);
      setPendingSaveSection(null);
      setSyncSuccessMsg(`✓ Saved ${section} rates specifically for "${activeAgency.name}". (Other users and agencies are NOT affected).`);
      setTimeout(() => setSyncSuccessMsg(null), 5000);
    } catch (err) {
      alert(`Failed to save ${section} Estimate Master data for active agency.`);
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  // Trigger Save
  const handleInitiateSave = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS') => {
    if (!isSuperAdmin) {
      // Regular user: directly save to current agency without affecting any other user
      handleSaveSectionToActiveAgency(section);
    } else {
      // Super Admin: allow choice between saving for active agency or publishing globally
      setPendingSaveSection(section);
      setSaveScope('SINGLE');
    }
  };

  // Direct 1-click Save for Active Agency Only (Safe & Isolated)
  const handleSaveAllToCurrentAgency = async () => {
    if (!activeAgency) return;
    setIsSaving(true);
    try {
      const payload = {
        estimateMasterCRGO: crgoData,
        estimateMaster: crgoData,
        estimateMasterAmorphous: amorphousData,
        estimateMasterWoundCore: woundCoreData,
        estimateMasterOverhauling: overhaulingData,
        estimateMasterCircleLimits: circleLimitsData,
      };
      await updateAgency(activeAgency.id, payload);
      setEditingSection(null);
      setSyncSuccessMsg(`✓ Successfully saved all rates for "${activeAgency.name}". Other users and agencies are NOT affected.`);
      setTimeout(() => setSyncSuccessMsg(null), 5000);
    } catch (err) {
      alert('Failed to save rates for active agency.');
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  // Execute Save based on chosen scope (Admin modal)
  const handleConfirmSaveSection = async () => {
    if (!pendingSaveSection) return;
    const section = pendingSaveSection;
    if (saveScope !== 'ALL' || !isSuperAdmin) {
      return handleSaveSectionToActiveAgency(section);
    }

    setIsSaving(true);
    try {
      const updatePayload: any = {};
      if (section === 'CRGO') {
        updatePayload.estimateMasterCRGO = crgoData;
        updatePayload.estimateMaster = crgoData;
      } else if (section === 'AMORPHOUS') {
        updatePayload.estimateMasterAmorphous = amorphousData;
      } else if (section === 'WOUND_CORE') {
        updatePayload.estimateMasterWoundCore = woundCoreData;
      } else if (section === 'OVERHAULING') {
        updatePayload.estimateMasterOverhauling = overhaulingData;
      } else if (section === 'CIRCLE_LIMITS') {
        updatePayload.estimateMasterCircleLimits = circleLimitsData;
      }

      // Save as global system default in Firestore and across all agencies
      await updateAllAgenciesEstimateMaster(updatePayload);
      setSyncSuccessMsg(`✓ Successfully published ${section} rates as the GLOBAL DEFAULT for all users & agencies!`);

      setEditingSection(null);
      setPendingSaveSection(null);
      setTimeout(() => setSyncSuccessMsg(null), 5000);
    } catch (err) {
      alert(`Failed to publish ${section} Estimate Master data globally.`);
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  // Execute full sync of all sections across all agencies and save as global default for all users (Admin only)
  const handleExecuteFullSync = async () => {
    if (!isSuperAdmin) {
      alert('Permission Denied: Only system administrators can publish global default rates.');
      setShowFullSyncModal(false);
      return;
    }
    setIsSaving(true);
    try {
      const fullPayload = {
        estimateMasterCRGO: crgoData,
        estimateMaster: crgoData,
        estimateMasterAmorphous: amorphousData,
        estimateMasterWoundCore: woundCoreData,
        estimateMasterOverhauling: overhaulingData,
        estimateMasterCircleLimits: circleLimitsData,
      };

      await saveGlobalDefaultEstimateMaster(fullPayload);
      setShowFullSyncModal(false);
      setSyncSuccessMsg(`✓ Successfully published all CRGO, Amorphous, Wound Core, Overhauling & Circle Limits rates as the SYSTEM DEFAULT for ALL users and agencies!`);
      setTimeout(() => {
        setSyncSuccessMsg(null);
      }, 6000);
    } catch (err) {
      alert('Failed to save default master rates for all users.');
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelSection = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS') => {
    if (section === 'CRGO') {
      if (activeAgency.estimateMasterCRGO && activeAgency.estimateMasterCRGO.length > 0) {
        setCrgoData(mergeDefaultRates(JSON.parse(JSON.stringify(activeAgency.estimateMasterCRGO))));
      } else if (globalDefaultEstimateMaster?.estimateMasterCRGO && globalDefaultEstimateMaster.estimateMasterCRGO.length > 0) {
        setCrgoData(mergeDefaultRates(JSON.parse(JSON.stringify(globalDefaultEstimateMaster.estimateMasterCRGO))));
      } else if (activeAgency.estimateMaster && activeAgency.estimateMaster.length > 0) {
        setCrgoData(mergeDefaultRates(JSON.parse(JSON.stringify(activeAgency.estimateMaster))));
      } else {
        setCrgoData(JSON.parse(JSON.stringify(defaultEstimateData)));
      }
    } else if (section === 'AMORPHOUS') {
      if (activeAgency.estimateMasterAmorphous && activeAgency.estimateMasterAmorphous.length > 0) {
        setAmorphousData(normalizeAmorphousOrWoundCoreData(activeAgency.estimateMasterAmorphous, defaultAmorphousEstimateData));
      } else if (globalDefaultEstimateMaster?.estimateMasterAmorphous && globalDefaultEstimateMaster.estimateMasterAmorphous.length > 0) {
        setAmorphousData(normalizeAmorphousOrWoundCoreData(globalDefaultEstimateMaster.estimateMasterAmorphous, defaultAmorphousEstimateData));
      } else {
        setAmorphousData(JSON.parse(JSON.stringify(defaultAmorphousEstimateData)));
      }
    } else if (section === 'WOUND_CORE') {
      if (activeAgency.estimateMasterWoundCore && activeAgency.estimateMasterWoundCore.length > 0) {
        setWoundCoreData(normalizeAmorphousOrWoundCoreData(activeAgency.estimateMasterWoundCore, defaultWoundCoreEstimateData));
      } else if (globalDefaultEstimateMaster?.estimateMasterWoundCore && globalDefaultEstimateMaster.estimateMasterWoundCore.length > 0) {
        setWoundCoreData(normalizeAmorphousOrWoundCoreData(globalDefaultEstimateMaster.estimateMasterWoundCore, defaultWoundCoreEstimateData));
      } else {
        setWoundCoreData(JSON.parse(JSON.stringify(defaultWoundCoreEstimateData)));
      }
    } else if (section === 'OVERHAULING') {
      if (activeAgency.estimateMasterOverhauling && activeAgency.estimateMasterOverhauling.length > 0) {
        setOverhaulingData(normalizeOverhaulingData(activeAgency.estimateMasterOverhauling, defaultOverhaulingEstimateData));
      } else if (globalDefaultEstimateMaster?.estimateMasterOverhauling && globalDefaultEstimateMaster.estimateMasterOverhauling.length > 0) {
        setOverhaulingData(normalizeOverhaulingData(globalDefaultEstimateMaster.estimateMasterOverhauling, defaultOverhaulingEstimateData));
      } else {
        setOverhaulingData(JSON.parse(JSON.stringify(defaultOverhaulingEstimateData)));
      }
    } else if (section === 'CIRCLE_LIMITS') {
      if (activeAgency.estimateMasterCircleLimits && activeAgency.estimateMasterCircleLimits.length > 0) {
        setCircleLimitsData(normalizeCircleLimitsData(activeAgency.estimateMasterCircleLimits, defaultCircleLimitsEstimateData));
      } else if (globalDefaultEstimateMaster?.estimateMasterCircleLimits && globalDefaultEstimateMaster.estimateMasterCircleLimits.length > 0) {
        setCircleLimitsData(normalizeCircleLimitsData(globalDefaultEstimateMaster.estimateMasterCircleLimits, defaultCircleLimitsEstimateData));
      } else {
        setCircleLimitsData(JSON.parse(JSON.stringify(defaultCircleLimitsEstimateData)));
      }
    }
    setEditingSection(null);
  };

  const renderSectionTable = (
    sectionKey: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS',
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
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 flex-wrap">
                {sectionTitle}
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                  {data.length} Items
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <Globe2 className="w-3 h-3" /> Default for all users
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center space-x-2 self-end sm:self-center" onClick={e => e.stopPropagation()}>
            {isOpen && (
              <div className="flex items-center space-x-2 mr-1 flex-wrap gap-y-1.5">
                {sectionKey === 'WOUND_CORE' && (
                  <button 
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSyncWoundCoreWithAmorphous();
                    }}
                    className="flex items-center px-2.5 py-1.5 text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 rounded-lg transition-colors shadow-2xs"
                    title="Make Wound Core master identical to Amorphous Estimate Master"
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1" />
                    Make Same as Amorphous
                  </button>
                )}
                {sectionKey === 'CIRCLE_LIMITS' && (
                  <>
                    <button 
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleResetCircleLimitsToDefault();
                      }}
                      className="flex items-center px-2.5 py-1.5 text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 rounded-lg transition-colors shadow-2xs"
                      title="Restore official UGVCL Clause 4.0 standard limits schedule"
                    >
                      <Scale className="w-3.5 h-3.5 mr-1" />
                      Restore Clause 4.0 Standard
                    </button>
                    <button 
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCircleLimitsViewMode(prev => prev === 'standard' ? 'matrix' : 'standard');
                      }}
                      className="flex items-center px-2.5 py-1.5 text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200 rounded-lg transition-colors shadow-2xs"
                      title="Toggle between Standard Capacity Columns view and Matrix Capacity Rows view"
                    >
                      {circleLimitsViewMode === 'standard' ? (
                        <>
                          <FileText className="w-3.5 h-3.5 mr-1 text-slate-600" />
                          Matrix View (KVA Rows)
                        </>
                      ) : (
                        <>
                          <LayoutGrid className="w-3.5 h-3.5 mr-1 text-slate-600" />
                          Grid View (KVA Cols)
                        </>
                      )}
                    </button>
                  </>
                )}
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
            {sectionKey === 'CIRCLE_LIMITS' && circleLimitsViewMode === 'matrix' ? (
              /* Transposed Matrix View (Capacity Rows x Level Columns) matching scanned circular */
              <table className="w-full text-left text-sm text-slate-600 min-w-max">
                <thead className="bg-rose-50/80 text-[11px] uppercase text-rose-950 font-bold border-b border-rose-200">
                  <tr>
                    <th className="px-3.5 py-3 whitespace-nowrap sticky left-0 bg-rose-50 z-10 border-r border-rose-200 w-24">
                      Sr. No
                    </th>
                    <th className="px-3.5 py-3 text-left sticky left-[96px] bg-rose-50 z-10 border-r border-rose-200 min-w-[140px] w-40">
                      Capacity (KVA)
                    </th>
                    {data.map((item, idx) => (
                      <th key={idx} className="px-3.5 py-3 text-right border-r border-rose-200 min-w-[170px] whitespace-normal">
                        <div className="font-bold text-rose-900 leading-snug">{item.itemName}</div>
                        <div className="text-[10px] text-rose-700 font-mono font-normal">Level Code: {item.itemCode}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {kvaColumns.map((kva, kvaIdx) => (
                    <tr key={kva} className="hover:bg-rose-50/40 transition-colors">
                      <td className="px-3.5 py-2.5 font-bold text-slate-700 whitespace-nowrap sticky left-0 bg-white border-r border-slate-100 text-center w-24 font-mono">
                        {kvaIdx + 1}
                      </td>
                      <td className="px-3.5 py-2.5 font-bold text-slate-900 sticky left-[96px] bg-white border-r border-slate-100 min-w-[140px] w-40">
                        <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200 font-mono text-xs">
                          {kva} / 11 KVA
                        </span>
                      </td>
                      {data.map((item, itemIdx) => {
                        const rateVal = item.rates?.[kva];
                        return (
                          <td key={itemIdx} className="px-3 py-2.5 text-right font-mono text-slate-700 border-r border-slate-100">
                            {isEditing ? (
                              <input
                                type="number"
                                step="0.01"
                                value={rateVal ?? ''}
                                onChange={(e) => handleRateChange('CIRCLE_LIMITS', itemIdx, kva, e.target.value)}
                                className="w-24 px-2 py-1 text-right text-xs border border-rose-300 rounded focus:ring-1 focus:ring-rose-500 font-mono font-semibold"
                                placeholder="-"
                              />
                            ) : (
                              rateVal !== null && rateVal !== undefined && !isNaN(Number(rateVal)) && Number(rateVal) > 0 ? (
                                <span className="font-bold text-slate-900 text-xs font-mono">
                                  ₹ {Number(rateVal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              ) : (
                                <span className="text-slate-300">-</span>
                              )
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              /* Standard Table View (Top Row = Capacities, Left Column = Levels/Items) */
              <table className="w-full text-left text-sm text-slate-600 min-w-max">
                <thead className="bg-slate-50 text-[11px] uppercase text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="px-3.5 py-3 whitespace-nowrap sticky left-0 bg-slate-50 z-10 border-r border-slate-200 w-16">
                      Sr.
                    </th>
                    <th className="px-3.5 py-3 text-left sticky left-[64px] bg-slate-50 z-10 border-r border-slate-200 min-w-[280px] max-w-md">
                      {sectionKey === 'CIRCLE_LIMITS' ? 'Transformer Level / Rating' : 'Item Description'}
                    </th>
                    <th className="px-3.5 py-3 text-left border-r border-slate-200 min-w-[130px] w-36">
                      Unit
                    </th>
                    {kvaColumns.map(kva => (
                      <th key={kva} className="px-3 py-3 text-right bg-blue-50/50 text-blue-900 whitespace-nowrap font-mono">
                        {kva} / 11 KVA
                      </th>
                    ))}
                    {isEditing && <th className="px-2.5 py-3 text-center w-16">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-3.5 py-2.5 font-bold text-slate-900 whitespace-nowrap sticky left-0 bg-white group-hover:bg-slate-50 border-r border-slate-100 align-top w-16">
                        {isEditing ? (
                          <input 
                            type="text" 
                            value={item.itemCode} 
                            onChange={(e) => handleItemDetailsChange(sectionKey, idx, 'itemCode', e.target.value)}
                            className="w-14 px-1.5 py-1 text-xs border border-slate-300 rounded font-mono font-bold"
                          />
                        ) : (
                          <span className="font-mono font-bold">{item.itemCode}</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 sticky left-[64px] bg-white group-hover:bg-slate-50 border-r border-slate-100 min-w-[280px] max-w-md whitespace-normal break-words align-top">
                        {isEditing ? (
                          <textarea 
                            rows={item.itemName.length > 80 ? 4 : item.itemName.length > 30 ? 2 : 1}
                            value={item.itemName} 
                            onChange={(e) => handleItemDetailsChange(sectionKey, idx, 'itemName', e.target.value)}
                            className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded font-medium text-slate-900 leading-relaxed focus:ring-1 focus:ring-blue-500"
                            placeholder="Enter description"
                          />
                        ) : (
                          <div className="font-medium text-slate-800 text-xs sm:text-sm leading-relaxed whitespace-pre-line break-words">
                            {item.itemName}
                          </div>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 border-r border-slate-100 min-w-[130px] w-36 whitespace-normal break-words align-top">
                        {isEditing ? (
                          <input 
                            type="text" 
                            value={item.unit} 
                            onChange={(e) => handleItemDetailsChange(sectionKey, idx, 'unit', e.target.value)}
                            className="w-full px-2 py-1 text-xs border border-slate-300 rounded text-slate-700 font-medium focus:ring-1 focus:ring-blue-500"
                            placeholder="e.g. Rs., QTY"
                          />
                        ) : (
                          <span className="text-xs font-medium text-slate-700 bg-slate-100 px-2 py-1 rounded-md inline-block whitespace-normal break-words leading-snug">
                            {item.unit}
                          </span>
                        )}
                      </td>
                      {kvaColumns.map(kva => {
                        const rateVal = item.rates?.[kva];
                        return (
                          <td key={kva} className="px-2.5 py-2.5 text-right font-mono text-slate-700 align-top">
                            {isEditing ? (
                              <input
                                type="number"
                                step="0.01"
                                value={rateVal ?? ''}
                                onChange={(e) => handleRateChange(sectionKey, idx, kva, e.target.value)}
                                className="w-20 px-1.5 py-1 text-right text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 font-mono font-medium"
                                placeholder="-"
                              />
                            ) : (
                              rateVal !== null && rateVal !== undefined && !isNaN(Number(rateVal)) && Number(rateVal) > 0 ? (
                                <span className="font-semibold text-slate-800 text-xs font-mono">
                                  {Number(rateVal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              ) : (
                                <span className="text-slate-300">-</span>
                              )
                            )}
                          </td>
                        );
                      })}
                      {isEditing && (
                        <td className="px-2 py-2.5 text-center align-top w-16">
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
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner / Success Notification */}
      {syncSuccessMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-4 rounded-xl flex items-center justify-between shadow-xs animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="text-sm font-bold">{syncSuccessMsg}</span>
          </div>
          <button 
            onClick={() => setSyncSuccessMsg(null)}
            className="text-emerald-600 hover:text-emerald-800 p-1 rounded-lg hover:bg-emerald-100/60"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Global Config Failure Warning Banner */}
      {globalConfigError && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 shadow-xs flex items-start justify-between gap-3 text-amber-900 animate-in fade-in">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-amber-100 border border-amber-300 rounded-lg text-amber-700 shrink-0 mt-0.5">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h4 className="text-xs font-black uppercase tracking-wider text-amber-900 flex items-center gap-2">
                <span>Global Estimate Defaults Offline</span>
                <span className="text-[10px] bg-amber-200 text-amber-800 px-2 py-0.5 rounded font-bold">Fallback Active</span>
              </h4>
              <p className="text-xs text-amber-800 leading-relaxed font-medium">
                {globalConfigError}
              </p>
              <p className="text-[11px] text-amber-700 leading-relaxed">
                Rates below are currently sourced from your local agency workspace cache or offline standard presets. You may continue editing and saving rates for your agency.
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={dismissGlobalConfigError}
            className="text-amber-500 hover:text-amber-800 p-1 rounded-lg hover:bg-amber-100/80 transition-colors"
            title="Dismiss warning"
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
            {isSuperAdmin ? (
              <span className="px-2.5 py-0.5 text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200 rounded-full flex items-center gap-1">
                <Crown className="w-3.5 h-3.5 text-purple-600" />
                Admin: Global Rate Publishing Enabled
              </span>
            ) : (
              <span className="px-2.5 py-0.5 text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Agency-Isolated Custom Pricing
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1.5">
            {isSuperAdmin 
              ? 'Administrator Mode: Standard tender rate master for CRGO, Amorphous, Wound Core, Overhauling & Circle Limits. You can edit for your agency or publish system-wide defaults.'
              : 'Standard tender repair and material rates for your agency. Any rates you customize here are strictly saved for your agency and will not affect any other user.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-end">
          <button 
            type="button"
            onClick={handleRestoreFromGlobalDefaults}
            className="flex items-center px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-300 transition-colors shadow-2xs"
            title="Reload rates from the central Global Master into the editor"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
            Reload Global Rates
          </button>
          <button 
            type="button"
            onClick={handleSaveAllToCurrentAgency}
            disabled={isSaving}
            className="flex items-center px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors disabled:opacity-50"
            title={`Save all rates specifically for ${activeAgency.name} without affecting other users`}
          >
            <Save className="w-3.5 h-3.5 mr-1.5" /> 
            Save All for {activeAgency.name}
          </button>
          {isSuperAdmin && (
            <button 
              type="button"
              onClick={() => setShowFullSyncModal(true)}
              className="flex items-center px-3.5 py-2 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 shadow-2xs transition-colors"
              title="Admin Only: Publish all entered rates as system default for all users & agencies"
            >
              <Crown className="w-3.5 h-3.5 mr-1.5 text-purple-600" /> 
              Publish as Default for All Users
            </button>
          )}
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
          'Standard repair and material rates for Wound Core transformers (same rate schedule as Amorphous)',
          openWoundCore,
          setOpenWoundCore,
          woundCoreData,
          'bg-indigo-600'
        )}

        {renderSectionTable(
          'OVERHAULING',
          'Overhauling (OH) Estimate Master',
          'Official tender rate schedule for complete overhauling, servicing & testing of transformers',
          openOverhauling,
          setOpenOverhauling,
          overhaulingData,
          'bg-teal-600'
        )}

        {/* Circle Approval Limits Master (Clause 4.0) */}
        {renderSectionTable(
          'CIRCLE_LIMITS',
          'Circle Authority Estimate Approval Power Limits (Clause 4.0 - 25% Limit)',
          'Capacity and Rating/Star level wise financial limit of SE (O&M) Circle. The system automatically raises an alert if an estimate exceeds these values.',
          openCircleLimits,
          setOpenCircleLimits,
          circleLimitsData,
          'bg-rose-600'
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
              Choose how you want to save your entered price rates for <strong className="text-slate-800">{activeAgency.name}</strong>.
            </p>

            {/* Scope Selection Cards */}
            <div className="space-y-2.5">
              {/* Option 1: Single Agency (Default & Isolated) */}
              <div 
                onClick={() => setSaveScope('SINGLE')}
                className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                  saveScope === 'SINGLE' 
                    ? 'border-emerald-600 bg-emerald-50/50 shadow-xs' 
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <input 
                    type="radio" 
                    name="saveScope" 
                    checked={saveScope === 'SINGLE'} 
                    onChange={() => setSaveScope('SINGLE')}
                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 border-slate-300 mt-0.5"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">Save for Current Agency Only ({activeAgency.name})</span>
                      <span className="text-[10px] uppercase font-bold bg-emerald-600 text-white px-2 py-0.5 rounded-full">Recommended</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                      Saves your custom {pendingSaveSection} rates <strong>exclusively for this agency</strong>. Other users and other agencies will <strong>NOT</strong> be affected and will keep their own rates.
                    </p>
                  </div>
                </div>
              </div>

              {/* Option 2: ALL Users & Agencies */}
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
                        <span className="text-sm font-bold text-slate-900">Publish as Global Default for ALL Users</span>
                        <span className="text-[10px] uppercase font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">System Wide</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Updates the central cloud master so that all other users and new agencies will adopt these {pendingSaveSection} rates as their default.
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
                    {saveScope === 'ALL' ? `Save as Default for All Users` : `Save for ${activeAgency.name}`}
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
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
                  <Globe2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Save Default Price Rates
                  </h3>
                  <p className="text-xs text-slate-500">
                    Set current entered rates as default for all users and all agencies
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
              <p className="bg-blue-50/70 p-3 rounded-lg border border-blue-100 text-blue-950 font-medium">
                This will save all rates (CRGO, Amorphous, Wound Core, Overhauling & Circle Limits) from <span className="font-bold text-blue-900">{activeAgency.name}</span> into the global database so that <strong>every user and every agency</strong> uses these rates by default.
              </p>

              <div className="border border-slate-200 rounded-xl p-3.5 space-y-2 bg-slate-50/50">
                <div className="font-bold text-slate-800 text-xs mb-1">Rate Master Summary to be Saved as Default:</div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                  <div className="bg-white p-2 rounded-lg border border-slate-200">
                    <span className="block text-xs font-bold text-blue-700">{crgoData.length}</span>
                    <span className="text-[10px] text-slate-500">CRGO Items</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-slate-200">
                    <span className="block text-xs font-bold text-amber-700">{amorphousData.length}</span>
                    <span className="text-[10px] text-slate-500">Amorphous</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-slate-200">
                    <span className="block text-xs font-bold text-indigo-700">{woundCoreData.length}</span>
                    <span className="text-[10px] text-slate-500">Wound Core</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-slate-200">
                    <span className="block text-xs font-bold text-teal-700">{overhaulingData.length}</span>
                    <span className="text-[10px] text-slate-500">Overhauling</span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-slate-200 col-span-2 sm:col-span-1">
                    <span className="block text-xs font-bold text-rose-700">{circleLimitsData.length}</span>
                    <span className="text-[10px] text-slate-500">Circle Limits</span>
                  </div>
                </div>
              </div>

              <div>
                <span className="font-semibold text-slate-700">Agencies receiving default rates:</span>
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
                      {ag.name} {ag.id === activeAgency.id ? '(Active)' : '✓'}
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
                className="flex items-center px-5 py-2.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm transition-colors disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    Saving Defaults...
                  </>
                ) : (
                  <>
                    <Globe2 className="w-4 h-4 mr-1.5" />
                    Save as Default for All Users
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

