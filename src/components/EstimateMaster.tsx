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
import { serverTimestamp } from 'firebase/firestore';
import { auth } from '../lib/firebase';
import { formatDDMMYYYY } from '../lib/utils';
import { useAgency } from '../lib/AgencyContext';
import { checkMasterSection, storedSection, MasterSection } from '../lib/estimateMasterHealth';
import { scheduleSrForMasterCode, variantAxisForMasterCode } from '../lib/scheduleItemMap';
import { SCHEDULE_A, bandForKva } from '../lib/ugvclSchedule2020';
import { SCRAP_ITEM_CODE_BY_CORE_CLASS } from '../lib/estimateCalc';

const kvaColumns = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'] as const;
type KvaType = typeof kvaColumns[number];

/**
 * What the ESTIMATE would charge for this item at this capacity when the master says
 * nothing - i.e. the tender rate the cell inherits.
 *
 * A blank cell is not a gap: resolveRate falls through to Schedule-A, so the job prices
 * correctly from the tender. Showing that figure turns an empty cell from "unknown" into
 * "inherited", which is the difference between an agency wondering whether something is
 * missing and an agency seeing what it will be charged.
 *
 * Returns null for variant items - a row whose rate depends on the job (KV rating, winding
 * material, capacity) has no single inherited value, and printing one would be a confident
 * half-truth. Those render a marker instead.
 */
function inheritedScheduleRate(itemCode: string, kva: string): number | null {
  if (variantAxisForMasterCode(itemCode)) return null;
  const sr = scheduleSrForMasterCode(itemCode);
  if (!sr) return null;
  const entry = SCHEDULE_A.find(i => i.sr === sr);
  if (!entry) return null;
  const v = entry.rates[bandForKva(Number(kva) || 0)];
  return typeof v === 'number' && v > 0 ? v : null;
}

/**
 * Both tender rates for a row whose only variable is the winding material.
 *
 * Worth showing BOTH rather than a marker: since copper stopped blocking (AUDIT F52) each
 * of these is a rate the estimate will actually charge, chosen by a field the operator
 * fills in. "Varies by winding material" told the reader the cell had two answers without
 * telling them either one - true, and useless for checking a bill.
 *
 * Rendered stacked, not side by side, and the reason is the grid rather than taste: this
 * column auto-sizes to its widest cell, so one row carrying "163.00 AL / 357.00 CU" would
 * widen all ten capacity columns for all 31 rows. Two short lines cost height on two rows
 * instead of width on the whole table.
 */
function inheritedWindingPair(itemCode: string, kva: string): { al: number; cu: number } | null {
  const v = variantAxisForMasterCode(itemCode);
  if (!v || v.axis !== 'winding-material') return null;
  const rateFor = (sr: string | undefined): number | null => {
    if (!sr) return null;
    const entry = SCHEDULE_A.find(i => i.sr === sr);
    if (!entry) return null;
    const r = entry.rates[bandForKva(Number(kva) || 0)];
    return typeof r === 'number' && r > 0 ? r : null;
  };
  const al = rateFor(v.options.Aluminium);
  const cu = rateFor(v.options.Copper);
  // Both or neither. Showing one half of a pair labelled by material invites the reader to
  // assume the other is absent from the tender rather than absent from this lookup.
  return al !== null && cu !== null ? { al, cu } : null;
}

/** Short reason a variant row shows no inherited figure. Never blank - see AUDIT F50. */
function variantMarker(itemCode: string): string | null {
  const v = variantAxisForMasterCode(itemCode);
  if (!v) return null;
  return v.axis === 'kv-class' ? 'Varies by KV rating'
    : v.axis === 'winding-material' ? 'Varies by winding material'
    : 'Varies by capacity';
}

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
    countOverridesForApply,
    applyEstimateMasterToOwnAgencies,
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
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyTargets, setApplyTargets] = useState<string[]>([]);
  const [applyCounts, setApplyCounts] = useState<Array<{ id: string; name: string; overrides: number; inheritingCellsFrozen: number; sections: Record<string, number> }> | null>(null);
  const [countingOverrides, setCountingOverrides] = useState(false);
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
      // A fresh load is not an edit. Cleared here so `editedSections` means exactly
      // "the operator changed this since it was loaded".
      setEditedSections({});

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

  /**
   * WHICH SECTIONS THE OPERATOR HAS ACTUALLY TOUCHED.
   *
   * Deliberately NOT "the loaded data differs from what is stored" - that is true of
   * almost every section almost always, because the load path normalises: it merges
   * default rows in, reorders to default order, forces units to QTY and backfills
   * fixedRate. Using "differs from stored" as the edit test would classify every section
   * as edited and the distinction would do nothing.
   *
   * This is set only where an operator action changes a section: cell edits, add, delete,
   * the resets, and the Amorphous -> Wound Core sync. It is cleared when the agency's data
   * is (re)loaded and after a successful save.
   */
  const [editedSections, setEditedSections] = useState<Record<string, boolean>>({});
  const markEdited = (...sections: string[]) =>
    setEditedSections(prev => {
      const next = { ...prev };
      sections.forEach(sec => { next[sec] = true; });
      return next;
    });

  const setSectionData = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS', newData: EstimateItem[]) => {
    markEdited(section);
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
    // ITEM CODE LEFT BLANK ON PURPOSE. It used to be `${data.length + 1}` - a row's
    // POSITION, presented as its identity. That is where three of the four scrap codes in
    // this database came from: "1" is row 1 of a then-empty section, "18" is row 18 -
    // including the "18" CRGO was deliberately moved off because it collides with
    // "Repl. Of Tank" (AUDIT F32). Nobody chose them; the list length did.
    //
    // A blank field asks a question. An auto-filled one asserts an answer that is wrong
    // by construction, in the field that prices a line on a UGVCL document.
    data.push({
      itemCode: '',
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
    markEdited(...['CIRCLE_LIMITS']);
    setCircleLimitsData(JSON.parse(JSON.stringify(defaultCircleLimitsEstimateData)));
    setEditingSection('CIRCLE_LIMITS');
    setOpenCircleLimits(true);
    setSyncSuccessMsg('✓ Restored official UGVCL Clause 4.0 Circle Limit values! Click "Save as Default" to save.');
    setTimeout(() => setSyncSuccessMsg(null), 6000);
  };

  const handleRestoreFromGlobalDefaults = () => {
    markEdited(...['CRGO', 'AMORPHOUS', 'WOUND_CORE', 'OVERHAULING', 'CIRCLE_LIMITS']);
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
    markEdited('WOUND_CORE');
    const before = woundCoreData.length;
    const cloned = JSON.parse(JSON.stringify(amorphousData)).map((it: EstimateItem) => ({
      ...it,
      unit: (it.unit || '').toLowerCase().includes('each') ? 'QTY' : (it.unit || 'QTY')
    }));
    setWoundCoreData(cloned);
    setEditingSection('WOUND_CORE');
    setOpenWoundCore(true);
    // The message states the DIRECTION and the overwrite. "Updated to match" named
    // neither the section read nor the section replaced, so it read equally as a merge or
    // as the reverse copy - for one click that destroys a whole section. Same family as
    // the "Move ALL My Data" bulk-move button: an operation whose feedback does not describe
    // what it did.
    setSyncSuccessMsg(
      `✓ COPIED Amorphous → Wound Core. The Wound Core section's ${before} item(s) were REPLACED ` +
      `by ${cloned.length} item(s) copied from Amorphous, with unit "QTY". Amorphous is unchanged. ` +
      `Nothing is saved yet - click "Save as Default" to keep this, or reload the page to discard it.`
    );
    setTimeout(() => setSyncSuccessMsg(null), 6000);
  };

  const handleDeleteItem = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS', index: number) => {
    const data = [...getSectionData(section)];
    const item = data[index];
    if (!item) return;

    const code = String(item.itemCode ?? '').trim();
    const name = String(item.itemName ?? '').trim();

    // A master that can gain rows but never lose them accumulates wrong data forever, so
    // deletion has to exist. But ONE row in some sections is load-bearing: the scrap item
    // code the resolver looks up. Removing the last one does not fail here - it fails
    // later, at bill time, in resolveScrapCharge, far from the click that caused it.
    // Allowed when another row already carries the same code, since the lookup finds that
    // one; the guard is about the code surviving, not about this particular row.
    const requiredScrapCode = SCRAP_ITEM_CODE_BY_CORE_CLASS[section];
    if (requiredScrapCode !== undefined && code === requiredScrapCode) {
      const others = data.filter((it, i) => i !== index && String(it.itemCode ?? '').trim() === requiredScrapCode);
      if (others.length === 0) {
        alert(
          `Cannot delete item "${requiredScrapCode}" - ${name || '(no description)'}.\n\n` +
          `It is the only row in the ${section.replace('_', ' ')} section carrying scrap item code ` +
          `"${requiredScrapCode}", which is the code a scrap transformer is billed under for this ` +
          `core type. Deleting it would not fail now - it would fail later, when a scrap bill is ` +
          `produced and the charge cannot be resolved.\n\n` +
          `Add a replacement row with code "${requiredScrapCode}" first, then delete this one.`
        );
        return;
      }
    }

    // Names the row, because "Delete this item?" is answerable without knowing what is
    // about to go. Says it is unsaved, because that is the difference between a mistake
    // and a disaster here.
    const ok = confirm(
      `Delete this row from the ${section.replace('_', ' ')} estimate master?\n\n` +
      `  Item code : ${code || '(none)'}\n` +
      `  Description: ${name || '(none)'}\n\n` +
      `This is not saved until you click Save - reloading the page discards it.`
    );
    if (!ok) return;

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
        // No `estimateMaster` mirror. It is the pre-sections CRGO field, nothing reads
        // it on any reachable path, and writing it kept a shadow copy correct only by
        // remembering to do so at five separate call sites. See AUDIT D4.
      } else if (section === 'AMORPHOUS') {
        updatePayload.estimateMasterAmorphous = amorphousData;
      } else if (section === 'WOUND_CORE') {
        updatePayload.estimateMasterWoundCore = woundCoreData;
      } else if (section === 'OVERHAULING') {
        updatePayload.estimateMasterOverhauling = overhaulingData;
      } else if (section === 'CIRCLE_LIMITS') {
        updatePayload.estimateMasterCircleLimits = circleLimitsData;
      }

      await updateAgency(activeAgency.id, { ...updatePayload, ...editStamp() });
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

  /**
   * WHAT A PUBLISH WOULD ACTUALLY SEND, and why it is not simply what is on screen.
   *
   * The screen shows NORMALISED data: normalizeAmorphousOrWoundCoreData clones in any
   * default row the stored section lacks, reorders to default order, forces units to QTY
   * and backfills fixedRate from the first non-zero rate it finds. Publishing component
   * state therefore broadcasts rows nobody authored, into every agency AND into
   * public_config, which then seeds every future agency (AUDIT F34).
   *
   * So an UNEDITED section publishes what is STORED. An EDITED one publishes what the
   * operator has on screen, because that is what they chose - normalisation and all. The
   * dialog says which, in counts, so the difference is legible rather than merely present.
   */
  const publishPlanFor = (
    section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS'
  ) => {
    const shown = getSectionData(section);
    const stored = section === 'CIRCLE_LIMITS'
      ? activeAgency?.estimateMasterCircleLimits
      : storedSection(activeAgency, section as MasterSection);
    const edited = Boolean(editedSections[section]);

    // Rows on screen whose code is absent from storage - the normaliser's additions.
    const storedCodes = new Set(
      (stored || []).map(it => String(it.itemCode ?? '').trim().toLowerCase()).filter(Boolean)
    );
    const autoAdded = shown.filter(it => {
      const code = String(it.itemCode ?? '').trim().toLowerCase();
      return code && !storedCodes.has(code);
    });

    // An unedited section with nothing stored has nothing to publish FROM. The publish
    // guard already refuses those (except Overhauling, where empty is normal and there is
    // genuinely nothing to send), so this only ever falls back for Overhauling.
    const useStored = !edited && Array.isArray(stored) && stored.length > 0;

    return {
      section,
      edited,
      useStored,
      payload: useStored ? (stored as EstimateItem[]) : shown,
      storedCount: Array.isArray(stored) ? stored.length : 0,
      shownCount: shown.length,
      autoAdded,
    };
  };

  /** One plain sentence naming what is being sent and where it came from. */
  const publishSummary = (
    section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS'
  ): string => {
    const p = publishPlanFor(section);
    const label = section.replace('_', ' ');
    if (p.useStored) {
      return `Publishing the ${p.storedCount} ${label} row(s) STORED for ${activeAgency?.name || 'this agency'} - not the ${p.shownCount} shown on screen.`;
    }
    if (!p.edited) {
      return `Nothing is stored for ${label}; publishing the ${p.shownCount} row(s) shown.`;
    }
    const added = p.autoAdded.length;
    return added > 0
      ? `Publishing your ${p.shownCount} edited ${label} row(s), ${added} of which ${added === 1 ? 'was' : 'were'} added automatically and ${added === 1 ? 'is' : 'are'} not in storage: ${p.autoAdded.map(r => `"${r.itemCode}"`).join(', ')}.`
      : `Publishing your ${p.shownCount} edited ${label} row(s).`;
  };

  /**
   * PUBLISH GUARD. Publishing writes the on-screen content of a section into EVERY agency
   * and into public_config. If that content was resolved from a FALLBACK rather than read
   * from the section's own stored data, publishing broadcasts the fallback as the shared
   * baseline - the same defect that produced the misfiled masters, at six times the blast
   * radius (AUDIT F27 finding (c)(1)).
   *
   * A section is fallback-resolved when its stored data is absent, or holds the wrong
   * schedule. In both cases what the screen shows came from somewhere else. Deliberately
   * NOT "the screen differs from stored" - that is also true of ordinary unsaved edits,
   * which are exactly what publishing is for.
   */
  const blockPublishIfFallbackResolved = (
    sections: ('CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS')[]
  ): boolean => {
    const offenders = sections
      .filter(sec => sec !== 'CIRCLE_LIMITS')
      .map(sec => {
        const stored = storedSection(activeAgency, sec as MasterSection);
        const health = checkMasterSection(sec as MasterSection, stored);
        // An empty Overhauling section is the normal state (it holds optional overrides
        // of Schedule-A), so emptiness there is not fallback content and must not block.
        const fallbackResolved = (health.isEmpty && !health.emptyIsNormalHere) || health.blocking;
        return { sec, health, fallbackResolved };
      })
      .filter(o => o.fallbackResolved);

    if (offenders.length === 0) return false;

    alert(
      `Cannot publish: ${offenders.length === 1 ? 'a section is' : `${offenders.length} sections are`} showing ` +
      `fallback content, not their own stored data.\n\n` +
      offenders.map(o =>
        `  ${o.health.label}: ${o.health.isEmpty
          ? 'nothing is stored for this section, so what you see was substituted from another one.'
          : 'the stored section holds the wrong schedule, so what you see was substituted from another one.'}`
      ).join('\n') +
      `\n\nPublishing writes what is on screen into EVERY agency and into the shared default. ` +
      `That would make the substituted content the shared baseline for all of them.\n\n` +
      `Correct the stored data for ${offenders.length === 1 ? 'that section' : 'those sections'} first - ` +
      `enter the right schedule and save it for this agency - then publish.`
    );
    return true;
  };

  /**
   * Item codes must be present and unique before a section can be saved.
   *
   * NOTHING BREAKS while a code is blank on screen - checked rather than assumed:
   * `resolveRate` and `resolveScrapCharge` both look a code up with `.find()`, so a blank
   * one simply never matches; `checkMasterSection` filters empty codes out of its overlap
   * score; `withMissingDefaults` filters them too; the table keys rows by index, not code.
   * So the row can sit there half-entered without affecting anything.
   *
   * SAVING it is the problem, and duplicates are the worse half. `.find()` returns the
   * FIRST match, so a second row carrying an existing code is silently unreachable - it
   * renders, it can be edited, it can be given a rate, and it prices nothing. That is
   * indistinguishable from a rate that did not take effect.
   */
  const BR = '\n';

  const codeProblems = (
    section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS',
    data: EstimateItem[]
  ): string[] => {
    const problems: string[] = [];
    const seen = new Map<string, number>();
    data.forEach((it, idx) => {
      const code = String(it.itemCode ?? '').trim();
      const name = String(it.itemName ?? '').trim();
      if (!code) {
        problems.push(`Row ${idx + 1}${name ? ` ("${name.slice(0, 40)}")` : ''} has no item code.`);
        return;
      }
      const key = code.toLowerCase();
      if (seen.has(key)) {
        problems.push(
          `Item code "${code}" is used by both row ${seen.get(key)} and row ${idx + 1}. ` +
          `Only the first would ever be found - the second would price nothing.`
        );
      } else {
        seen.set(key, idx + 1);
      }
    });
    return problems;
  };

  const blockSaveIfCodeProblems = (
    section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS',
    data: EstimateItem[]
  ): boolean => {
    const problems = codeProblems(section, data);
    if (problems.length === 0) return false;
    alert(
      `Cannot save the ${section.replace('_', ' ')} section:` + BR + BR +
      problems.map(p => `  - ${p}`).join(BR) + BR + BR +
      `Item codes identify the row to the estimate and the bill. Give every row a code, ` +
      `unique within this section, taken from the tender - not from its position in the list.`
    );
    return true;
  };

  // Trigger Save
  /**
   * WHEN THE RATES LAST CHANGED, and by whom.
   *
   * Without this, "was this estimate produced before or after the master was edited" is
   * unanswerable - and that question decides whether a figure on an issued document can
   * still be reproduced. The agency document carries no such stamp today; `updatedAt` on a
   * job says when the JOB changed, which is a different fact.
   *
   * serverTimestamp() rather than Date.now() for A5's reason: a stamp from the same
   * browser clock as the thing it dates cannot corroborate it. formatDDMMYYYY already
   * reads Timestamps (F23).
   *
   * Scoped name on purpose - `estimateMasterEditedAt`, not `updatedAt`. The agency record
   * holds a dozen unrelated things; a generic name would be read as "the agency changed"
   * and would be wrong the moment anyone edits a bank detail.
   */
  const editStamp = () => ({
    estimateMasterEditedAt: serverTimestamp(),
    estimateMasterEditedBy: auth.currentUser?.email || auth.currentUser?.uid || '',
  });

  const handleInitiateSave = (section: 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS') => {
    // Gates BOTH destinations - the per-agency save and the publish modal behind it.
    if (blockSaveIfCodeProblems(section, getSectionData(section))) return;
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
    // Every section it writes is checked - this button bypasses handleInitiateSave.
    const sections: ('CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS')[] =
      ['CRGO', 'AMORPHOUS', 'WOUND_CORE', 'OVERHAULING', 'CIRCLE_LIMITS'];
    for (const sec of sections) {
      if (blockSaveIfCodeProblems(sec, getSectionData(sec))) return;
    }
    setIsSaving(true);
    try {
      const payload = {
        estimateMasterCRGO: crgoData,
        // No `estimateMaster` mirror. It is the pre-sections CRGO field, nothing reads
        // it on any reachable path, and writing it kept a shadow copy correct only by
        // remembering to do so at five separate call sites. See AUDIT D4.
        estimateMasterAmorphous: amorphousData,
        estimateMasterWoundCore: woundCoreData,
        estimateMasterOverhauling: overhaulingData,
        estimateMasterCircleLimits: circleLimitsData,
      };
      await updateAgency(activeAgency.id, { ...payload, ...editStamp() });
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

    if (blockPublishIfFallbackResolved([section])) return;

    setIsSaving(true);
    try {
      // STORED when unedited, screen state when edited - see publishPlanFor.
      const plan = publishPlanFor(section);
      const updatePayload: any = {};
      if (section === 'CRGO') {
        updatePayload.estimateMasterCRGO = plan.payload;
        // No `estimateMaster` mirror. It is the pre-sections CRGO field, nothing reads
        // it on any reachable path, and writing it kept a shadow copy correct only by
        // remembering to do so at five separate call sites. See AUDIT D4.
      } else if (section === 'AMORPHOUS') {
        updatePayload.estimateMasterAmorphous = plan.payload;
      } else if (section === 'WOUND_CORE') {
        updatePayload.estimateMasterWoundCore = plan.payload;
      } else if (section === 'OVERHAULING') {
        updatePayload.estimateMasterOverhauling = plan.payload;
      } else if (section === 'CIRCLE_LIMITS') {
        updatePayload.estimateMasterCircleLimits = plan.payload;
      }

      // Save as global system default in Firestore and across all agencies
      await updateAllAgenciesEstimateMaster(updatePayload);
      setEditedSections(prev => ({ ...prev, [section]: false }));
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

  /** The five sections as they would be written - stored when untouched, screen when edited. */
  const buildSectionPayload = () => ({
    estimateMasterCRGO: publishPlanFor('CRGO').payload,
    estimateMasterAmorphous: publishPlanFor('AMORPHOUS').payload,
    estimateMasterWoundCore: publishPlanFor('WOUND_CORE').payload,
    estimateMasterOverhauling: publishPlanFor('OVERHAULING').payload,
    estimateMasterCircleLimits: publishPlanFor('CIRCLE_LIMITS').payload,
  });

  /**
   * "Apply to my agencies" - owner-scoped, available to every user, no admin rights.
   *
   * The count is fetched BEFORE the modal can be confirmed, and from fresh reads, because
   * the whole purpose of the dialog is to say what this destroys. A dialog that cannot yet
   * say it must not offer the button.
   */
  const openApplyToMyAgencies = async () => {
    const others = agencies.filter(a => a.id !== activeAgency?.id);
    if (others.length === 0) {
      alert('You only have one agency. There is nothing to apply this to.');
      return;
    }
    // Same guard the publish path uses: never push a section that exists on screen only
    // because a fallback resolved it. Sending four agencies a section this agency does not
    // actually have stored is how one wrong card became four.
    if (blockPublishIfFallbackResolved(['CRGO', 'AMORPHOUS', 'WOUND_CORE', 'OVERHAULING'])) return;

    setApplyTargets(others.map(a => a.id));
    setApplyCounts(null);
    setShowApplyModal(true);
    setCountingOverrides(true);
    try {
      setApplyCounts(await countOverridesForApply(buildSectionPayload(), others.map(a => a.id)));
    } catch (err) {
      console.error(err);
      setShowApplyModal(false);
      alert('Could not read the other agencies to check what this would overwrite. Nothing was changed.');
    } finally {
      setCountingOverrides(false);
    }
  };

  const handleApplyToMyAgencies = async () => {
    setIsSaving(true);
    try {
      await applyEstimateMasterToOwnAgencies(buildSectionPayload(), applyTargets);
      setShowApplyModal(false);
      const names = agencies.filter(a => applyTargets.includes(a.id)).map(a => a.name).join(', ');
      setSyncSuccessMsg(`✓ Rates from ${activeAgency.name} applied to ${names}.`);
      setTimeout(() => setSyncSuccessMsg(null), 6000);
    } catch (err) {
      console.error(err);
      alert('Failed to apply rates to your other agencies.');
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
    // Every section is being published here, so every section is checked.
    if (blockPublishIfFallbackResolved(['CRGO', 'AMORPHOUS', 'WOUND_CORE', 'OVERHAULING'])) {
      setShowFullSyncModal(false);
      return;
    }
    setIsSaving(true);
    try {
      // Each section independently: stored when untouched, screen state when edited.
      const pCrgo = publishPlanFor('CRGO');
      const fullPayload = {
        estimateMasterCRGO: pCrgo.payload,
        // No `estimateMaster` mirror. It is the pre-sections CRGO field, nothing reads
        // it on any reachable path, and writing it kept a shadow copy correct only by
        // remembering to do so at five separate call sites. See AUDIT D4.
        estimateMasterAmorphous: publishPlanFor('AMORPHOUS').payload,
        estimateMasterWoundCore: publishPlanFor('WOUND_CORE').payload,
        estimateMasterOverhauling: publishPlanFor('OVERHAULING').payload,
        estimateMasterCircleLimits: publishPlanFor('CIRCLE_LIMITS').payload,
      };

      await saveGlobalDefaultEstimateMaster(fullPayload);
      setShowFullSyncModal(false);
      // Says what it did, not what it sounds like it did. The old wording claimed "ALL
      // users and agencies", which was never true for an agency holding its own sections.
      setSyncSuccessMsg(`✓ Published all five sections to the shared baseline. New agencies will inherit these rates; existing agencies keep their own. Use "Apply to my agencies" to update yours.`);
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
              <p className="text-[11px] text-slate-500 mt-1">
                <span className="px-1 rounded bg-sky-50 text-slate-600 font-mono">tinted</span> = the UGVCL tender rate,
                used while the cell is blank - nothing is stored. Type to override for this agency;
                <strong> clear a cell to go back to the tender rate</strong>. Once a cell holds a value,
                a future change to the tender schedule no longer reaches it.
                {' '}A cell showing <span className="font-mono">AL</span> and{' '}
                <span className="font-mono">CU</span> has two tender rates; the estimate picks one
                from the Winding Type on the internal inspection, and typing a rate here replaces
                both.
              </p>

              {/*
                SECTION HEALTH LINE. Both checks that would have caught the misfiled
                masters already existed - one in getEstimateMasterForCore, one in this
                screen's own load path - and both ran where nobody could see them, so a
                CRGO card sat in AARATI's Wound Core section for an unknown length of time
                while the screen displayed Amorphous. A check whose output nobody reads is
                not a check. This is that output.

                Reads the STORED section, deliberately NOT `data`: `data` is what the load
                path resolved, and the fallback makes it look healthy by construction -
                which is exactly how this stayed invisible.
              */}
              {(() => {
                if (sectionKey === 'CIRCLE_LIMITS') return null;
                // storedSection reads the RAW Firestore value. Reading
                // activeAgency.estimateMasterX directly would read the ENRICHED field,
                // which AgencyContext fills from the global default when the stored one is
                // empty - so an empty section would render as healthy. This panel exists
                // to see past exactly that.
                const stored = storedSection(activeAgency, sectionKey as MasterSection);
                const health = checkMasterSection(sectionKey as MasterSection, stored);

                // STORED vs SHOWING. These are different things and the difference is the
                // whole point of the panel, so it never collapses them into one verdict.
                //
                // `stored` is what the database holds - the only thing that can be wrong
                // in the way AARATI's Wound Core is wrong. `data` is what the screen is
                // showing, which may be a fallback the resolver substituted, or edits the
                // operator has not saved. Reporting only `stored` while someone is midway
                // through editing describes a state they are in the middle of leaving;
                // reporting only `data` hides the misfiling this panel exists to surface.
                const showing = checkMasterSection(sectionKey as MasterSection, data);
                const differs = JSON.stringify(stored || []) !== JSON.stringify(data || []);

                // WHY the displayed list differs from storage - tested, not assumed.
                //
                // The first version of this band branched on `isEditing` alone and told
                // everyone else "resolved from a fallback section". That was a confident
                // verdict from a test that never looked at the cause - the same defect as
                // the isLegacy blacklist this panel was built to expose, committed inside
                // the panel. It would have gone on saying "fallback" about a section that
                // was by then completely correct, because `differs` is true of almost
                // every section: the load path NORMALISES, merging default rows in,
                // reordering, forcing units to QTY and backfilling fixedRate.
                //
                // Three distinguishable causes, in order of seriousness:
                const edited = Boolean(editedSections[sectionKey]);
                const fallbackResolved = !stored || stored.length === 0 || health.blocking;
                const storedCodes = new Set(
                  (stored || []).map(it => String(it.itemCode ?? '').trim().toLowerCase()).filter(Boolean)
                );
                const addedRows = (data || []).filter(it => {
                  const code = String(it.itemCode ?? '').trim().toLowerCase();
                  return code && !storedCodes.has(code);
                });
                const cause: 'edited' | 'fallback' | 'normalised' =
                  edited ? 'edited' : (fallbackResolved ? 'fallback' : 'normalised');
                const pendingBand = differs ? (
                  <div className={`mt-1.5 p-2 rounded border text-[11px] leading-relaxed ${
                    cause === 'fallback'
                      ? 'bg-amber-50 border-amber-300 text-amber-900'
                      : (showing.problems.length > 0
                          ? 'bg-amber-50 border-amber-300 text-amber-900'
                          : 'bg-blue-50 border-blue-200 text-blue-900')
                  }`}>
                    <strong className="font-bold flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {cause === 'edited'
                        ? `Showing your ${showing.itemCount} edited row(s) - not saved`
                        : cause === 'fallback'
                          ? `Showing ${showing.itemCount} row(s) from a FALLBACK section`
                          : `Showing ${showing.itemCount} row(s) - stored ${health.itemCount}, the rest filled in for display`}
                    </strong>
                    <p className="mt-0.5">
                      {cause === 'edited'
                        ? 'These are your unsaved edits. Nothing is written until you click Save.'
                        : cause === 'fallback'
                          ? `Nothing usable is stored for ${health.label}, so this content came from another section. Saving would write it into the stored section as though it had been configured here.`
                          : `The stored ${health.label} section holds ${health.itemCount} row(s) and is used as-is for pricing. The display merges in default rows and rewrites units and order; that is presentation, not storage.`}
                    </p>
                    {cause === 'normalised' && addedRows.length > 0 && (
                      <p className="mt-1">
                        <strong>Not in storage:</strong> {addedRows.map(r => `"${r.itemCode}"`).join(', ')}
                        {' '}- shown from the default list. Saving would make {addedRows.length === 1 ? 'it' : 'them'} real.
                      </p>
                    )}
                    {showing.problems.length > 0 && (
                      <>
                        <p className="mt-1 font-bold">After saving, this section would have:</p>
                        <ul className="list-disc list-inside mt-0.5 space-y-0.5">
                          {showing.problems.map((prob, i) => <li key={i}>{prob}</li>)}
                        </ul>
                      </>
                    )}
                  </div>
                ) : null;

                if (health.problems.length === 0) {
                  return (
                    <>
                      <p className="text-[11px] text-emerald-700 mt-1 flex items-center gap-1 font-semibold">
                        <ShieldCheck className="w-3 h-3 shrink-0" />
                        <span>
                          {health.emptyIsNormalHere && health.isEmpty
                            ? 'Nothing stored - which is correct. Overhauling holds optional per-item overrides of UGVCL Schedule-A; with none stored, OH jobs price straight from Schedule-A.'
                            : <>
                                Stored {health.label} section: {health.itemCount} items
                                {health.requiredScrapCode !== null ? `, scrap code "${health.requiredScrapCode}" present` : ''}
                                {health.emptyIsNormalHere ? ' (optional overrides of Schedule-A)' : ''}
                              </>}
                        </span>
                      </p>
                      {pendingBand}
                    </>
                  );
                }
                return (
                  <>
                  <div className={`mt-1.5 p-2 rounded border text-[11px] leading-relaxed ${
                    health.blocking
                      ? 'bg-red-50 border-red-300 text-red-800'
                      : 'bg-amber-50 border-amber-300 text-amber-900'
                  }`}>
                    <span className="block text-[9px] uppercase font-bold tracking-wider opacity-70 mb-0.5">Stored in the database</span>
                    <strong className="font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      {health.blocking
                        ? `This section does not hold the ${health.label} schedule`
                        : `${health.label} section needs attention`}
                    </strong>
                    <ul className="list-disc list-inside mt-0.5 space-y-0.5">
                      {health.problems.map((prob, i) => <li key={i}>{prob}</li>)}
                    </ul>
                    {health.blocking && (
                      <p className="mt-1">
                        What is shown below comes from a fallback section, so prices are not
                        wrong - the STORED master is. Correct it by hand; nothing is repaired
                        automatically.
                      </p>
                    )}
                  </div>
                  {pendingBand}
                  </>
                );
              })()}
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
                    title="Copies Amorphous → Wound Core. REPLACES every item in the Wound Core section with a copy of the Amorphous section. Amorphous is not changed. Not saved until you click Save as Default."
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
                    {sectionKey !== 'CIRCLE_LIMITS' && <th className="px-2.5 py-3 text-center w-16">Action</th>}
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
                            placeholder="code"
                            title={
                              !String(item.itemCode ?? '').trim()
                                ? 'Enter the item code from the tender. It identifies this row to the estimate and the bill - it is not a row number.'
                                : (data.filter(o => String(o.itemCode ?? '').trim().toLowerCase() === String(item.itemCode ?? '').trim().toLowerCase()).length > 1
                                    ? 'Duplicate item code. Only the first row with this code is ever found - this one would price nothing.'
                                    : undefined)
                            }
                            /* Marked in place, so a blank or duplicated code is visible in the
                               row rather than only in an alert when Save is pressed. */
                            className={`w-14 px-1.5 py-1 text-xs border rounded font-mono font-bold ${
                              !String(item.itemCode ?? '').trim()
                                ? 'border-amber-400 bg-amber-50 placeholder-amber-600'
                                : (data.filter(o => String(o.itemCode ?? '').trim().toLowerCase() === String(item.itemCode ?? '').trim().toLowerCase()).length > 1
                                    ? 'border-red-400 bg-red-50'
                                    : 'border-slate-300')
                            }`}
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
                            {(() => {
                              const stored = rateVal !== null && rateVal !== undefined
                                && !isNaN(Number(rateVal)) && Number(rateVal) > 0;
                              const inherited = stored ? null : inheritedScheduleRate(item.itemCode, kva);
                              const pair = stored || inherited !== null ? null : inheritedWindingPair(item.itemCode, kva);
                              const marker = stored || pair ? null : variantMarker(item.itemCode);
                              const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                              const pairTitle = pair
                                ? `From the UGVCL tender schedule. Aluminium ${fmt(pair.al)}, copper ${fmt(pair.cu)} - the estimate picks one using the Winding Type on the internal inspection. Nothing is stored for this cell. Type over it to override BOTH materials with a single rate.`
                                : undefined;

                              if (isEditing) {
                                return (
                                  <input
                                    type="number"
                                    step="0.01"
                                    /* VALUE stays the STORED figure, never the inherited one. An
                                       inherited number shown as the input's value would make opening
                                       edit mode and pressing Save convert every inherited cell into
                                       an override without anyone touching it - a resolved display
                                       becoming stored data through an ordinary save, which is the
                                       F27 mechanism, and it would freeze the whole grid against
                                       future tender changes in one click. It is the PLACEHOLDER, so
                                       an untouched cell still saves as null. */
                                    value={rateVal ?? ''}
                                    onChange={(e) => handleRateChange(sectionKey, idx, kva, e.target.value)}
                                    className={`w-20 px-1.5 py-1 text-right text-xs border rounded focus:ring-1 focus:ring-blue-500 font-mono font-medium ${
                                      stored ? 'border-slate-300 text-slate-900 font-semibold' : 'border-sky-200 bg-sky-50 text-slate-600'
                                    }`}
                                    placeholder={inherited !== null ? fmt(inherited) : pair ? `${fmt(pair.al)}/${fmt(pair.cu)}` : '-'}
                                    title={inherited !== null
                                      ? `Tender rate ${fmt(inherited)} applies while this is blank. Type to override; clear to go back to it.`
                                      : pairTitle || marker || undefined}
                                  />
                                );
                              }
                              if (stored) {
                                return (
                                  <span className="font-semibold text-slate-900 text-xs font-mono"
                                        title="Set by this agency - overrides the tender rate.">
                                    {fmt(Number(rateVal))}
                                  </span>
                                );
                              }
                              if (inherited !== null) {
                                return (
                                  /* TWO signals, and neither is legibility.
                                     The figure was grey italic and too faint to read at a
                                     glance, which defeated the point - an agency has to SEE
                                     what it will be charged. It is now normal slate-600 at
                                     normal weight; the cell carries a sky tint instead.
                                     Tint is a property of the CELL, so the number stays fully
                                     readable, and it scans column-wise - which part of the
                                     grid is the agency's own is visible without reading any
                                     individual figure.
                                     WEIGHT is the second signal on purpose: colour alone must
                                     never be the sole indicator (see GP_TEXT_CLASS in
                                     jobDisplay) - it is invisible to a colour-blind operator
                                     and to a photocopy, which is how these are read on the
                                     floor. Overrides are semibold and near-black; inherited is
                                     normal weight. That difference survives greyscale. */
                                  <span className="block -mx-1 px-1 rounded bg-sky-50 text-slate-600 text-xs font-mono"
                                        title="From the UGVCL tender schedule. Nothing is stored for this cell - the estimate uses this figure. Type over it to override.">
                                    {fmt(inherited)}
                                  </span>
                                );
                              }
                              if (pair) {
                                return (
                                  /* Same tint and weight as a single inherited figure - it is
                                     the same kind of thing, a tender rate with nothing stored
                                     over it. The material suffix carries the distinction, so
                                     no third visual signal is introduced.
                                     STACKED, not "163.00 AL / 357.00 CU" on one line: this
                                     column sizes to its widest cell, and one wide row would
                                     widen all ten capacity columns for all 31 rows. */
                                  <span className="block -mx-1 px-1 rounded bg-sky-50 text-slate-600 text-[11px] font-mono leading-tight"
                                        title={pairTitle}>
                                    <span className="block whitespace-nowrap">{fmt(pair.al)} AL</span>
                                    <span className="block whitespace-nowrap">{fmt(pair.cu)} CU</span>
                                  </span>
                                );
                              }
                              if (marker) {
                                return (
                                  <span className="text-[9px] text-amber-700/80 italic leading-tight"
                                        title="This item's tender rate depends on the job, so there is no single figure to show here - the estimate selects it per job.">
                                    {marker}
                                  </span>
                                );
                              }
                              return <span className="text-slate-300">-</span>;
                            })()}
                          </td>
                        );
                      })}
                      {/* Rendered in BOTH modes. It used to appear only while editing, so a
                          master with wrong rows in it looked like one that could not lose
                          them - the control was not missing, it was invisible. Disabled
                          outside edit mode, with the reason in the tooltip. */}
                      {sectionKey !== 'CIRCLE_LIMITS' && (
                        <td className="px-2 py-2.5 text-center align-top w-16">
                          <button
                            type="button"
                            disabled={!isEditing}
                            onClick={() => handleDeleteItem(sectionKey, idx)}
                            className={`p-1 rounded ${
                              isEditing
                                ? 'text-red-500 hover:bg-red-50'
                                : 'text-slate-300 cursor-not-allowed'
                            }`}
                            title={isEditing
                              ? `Delete row "${item.itemCode || '(no code)'}" - asks for confirmation, and is not saved until you click Save`
                              : 'Click Edit on this section to remove rows'}
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
          {/* When the rates last changed. Shown beside the master itself, because the
              question it answers - "could this estimate predate the current rates" - is
              asked while looking at the master, not while looking at the agency record. */}
          {(activeAgency as any)?.estimateMasterEditedAt && (
            <p className="text-[11px] text-slate-500 mt-1">
              Rates last edited {formatDDMMYYYY((activeAgency as any).estimateMasterEditedAt)}
              {(activeAgency as any).estimateMasterEditedBy
                ? ` by ${(activeAgency as any).estimateMasterEditedBy}` : ''}
              . Estimates produced before that date were priced from different rates.
            </p>
          )}
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
          {/* TWO BUTTONS, TWO BLAST RADII.
              One control used to do both: write public_config AND loop the caller's own
              agencies. Applying rates to agencies you own is reversible by you; seeding
              public_config changes the default every future agency inherits, for every
              user, and cannot be undone by you on their behalf. Naming one of those two
              is how someone publishes a baseline meaning to update their own agencies. */}
          {agencies.length > 1 && (
            <button
              type="button"
              onClick={openApplyToMyAgencies}
              disabled={isSaving}
              className="flex items-center px-3.5 py-2 text-xs font-bold text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 shadow-2xs transition-colors disabled:opacity-50"
              title={`Copy these rates from ${activeAgency.name} into your other agencies. You will see what it replaces before anything is written.`}
            >
              <Building2 className="w-3.5 h-3.5 mr-1.5 text-sky-600" />
              Apply to my agencies
            </button>
          )}
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => setShowFullSyncModal(true)}
              className="flex items-center px-3.5 py-2 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 shadow-2xs transition-colors"
              title="Admin only: write these rates into public_config, the baseline every new agency inherits. Does NOT change your own agencies - use 'Apply to my agencies' for that."
            >
              <Crown className="w-3.5 h-3.5 mr-1.5 text-purple-600" />
              Publish as shared default
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
                      {/* Names WHAT is being sent, in rows. The screen shows normalised data -
                          default rows merged in, order and units rewritten - so "publish this
                          section" is ambiguous without saying which version. An operator who
                          cannot tell the difference gains nothing from the distinction. */}
                      {pendingSaveSection && (
                        <div className={`mt-2 p-2 rounded border text-[11px] leading-relaxed ${
                          publishPlanFor(pendingSaveSection).useStored
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                            : 'bg-amber-50 border-amber-300 text-amber-900'
                        }`}>
                          <strong className="font-bold block">{publishSummary(pendingSaveSection)}</strong>
                          <span>
                            {publishPlanFor(pendingSaveSection).useStored
                              ? 'You have not edited this section, so the stored rows are published as they are. Rows the screen adds for display are not sent.'
                              : 'This section has unsaved edits, so what you see is what will be published - to every agency and to the shared default.'}
                          </span>
                        </div>
                      )}
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
      {showApplyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4 animate-in zoom-in-95">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-sky-50 text-sky-600 rounded-xl border border-sky-100">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Apply to my agencies</h3>
                  <p className="text-xs text-slate-500">
                    Copy all five sections from <span className="font-semibold text-slate-700">{activeAgency.name}</span> into the agencies you select.
                  </p>
                </div>
              </div>
              <button onClick={() => setShowApplyModal(false)} disabled={isSaving}
                      className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            {countingOverrides && (
              <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
                <Loader2 className="w-4 h-4 animate-spin" />
                Reading each agency to check what this would replace…
              </div>
            )}

            {/* The counts come from a FRESH read, not from what is in memory - see
                countOverridesForApply. A confirmation is a claim, and a claim that was true
                at page load and false at click time is worse than no claim at all. */}
            {!countingOverrides && applyCounts && (
              <div className="border border-slate-300 rounded-xl divide-y divide-slate-200 bg-white max-h-64 overflow-y-auto">
                {applyCounts.map(c => {
                  const checked = applyTargets.includes(c.id);
                  return (
                    <label key={c.id} className={`flex items-start gap-3 p-3 cursor-pointer ${checked ? '' : 'opacity-50'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setApplyTargets(prev =>
                          e.target.checked ? [...prev, c.id] : prev.filter(x => x !== c.id))}
                        className="mt-0.5 w-4 h-4 accent-sky-600"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-800">{c.name}</div>
                        {c.overrides > 0 ? (
                          <div className="text-[11px] text-amber-700 font-semibold">
                            {c.overrides} customised rate{c.overrides === 1 ? '' : 's'} would be replaced
                            {Object.keys(c.sections).length > 0 && (
                              <span className="font-normal text-amber-700/80">
                                {' '}({Object.entries(c.sections)
                                  .map(([f, n]) => `${n} ${f.replace('estimateMaster', '') || 'CRGO'}`)
                                  .join(', ')})
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-500">No customised rates would be lost.</div>
                        )}
                        {c.inheritingCellsFrozen > 0 && (
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {c.inheritingCellsFrozen} cell{c.inheritingCellsFrozen === 1 ? '' : 's'} that currently
                            inherit the tender rate would be set to a fixed value.
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            {!countingOverrides && applyCounts && (() => {
              const sel = applyCounts.filter(c => applyTargets.includes(c.id));
              const lost = sel.filter(c => c.overrides > 0);
              const total = lost.reduce((a, c) => a + c.overrides, 0);
              return (
                <p className={`text-xs p-3 rounded-lg border font-medium ${
                  total > 0 ? 'bg-amber-50 border-amber-200 text-amber-900'
                            : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                  {sel.length === 0
                    ? 'No agencies selected - nothing will be written.'
                    : total > 0
                      ? `This will update ${sel.map(c => c.name).join(', ')}, replacing ${lost.map(c => `${c.overrides} rate${c.overrides === 1 ? '' : 's'} customised in ${c.name}`).join(' and ')}.`
                      : `This will update ${sel.map(c => c.name).join(', ')}. No agency loses a rate it had customised.`}
                </p>
              );
            })()}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowApplyModal(false)} disabled={isSaving}
                      className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg">
                Cancel
              </button>
              <button
                onClick={handleApplyToMyAgencies}
                disabled={isSaving || countingOverrides || !applyCounts || applyTargets.length === 0}
                className="flex items-center px-4 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-lg disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
                Apply to {applyTargets.length} agenc{applyTargets.length === 1 ? 'y' : 'ies'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                    Publish as shared default
                  </h3>
                  <p className="text-xs text-slate-500">
                    Sets the baseline every NEW agency inherits. Does not change existing agencies.
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
                This writes all five sections from <span className="font-bold text-blue-900">{activeAgency.name}</span> into the shared baseline (<code className="text-[10px]">public_config</code>). Every <strong>newly created</strong> agency inherits it, and any agency whose own section is empty resolves through it.
                {' '}<strong>It does not change agencies that already have their own rates</strong> — including yours. To update your own agencies, use <span className="font-semibold">Apply to my agencies</span>.
              </p>

              {/* Per section, in rows, which version is being sent. The counts below are
                  the SCREEN's counts and can differ from what is published - that is the
                  whole point of this block. */}
              <div className="border border-slate-300 rounded-xl p-3 space-y-1 bg-white">
                <div className="font-bold text-slate-800 text-xs mb-1">Exactly what will be published:</div>
                {(['CRGO', 'AMORPHOUS', 'WOUND_CORE', 'OVERHAULING', 'CIRCLE_LIMITS'] as const).map(sec => {
                  const plan = publishPlanFor(sec);
                  return (
                    <div key={sec} className={`px-2 py-1 rounded text-[11px] leading-relaxed border ${
                      plan.useStored
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-amber-50 border-amber-200 text-amber-900'
                    }`}>
                      {publishSummary(sec)}
                    </div>
                  );
                })}
              </div>

              <div className="border border-slate-200 rounded-xl p-3.5 space-y-2 bg-slate-50/50">
                <div className="font-bold text-slate-800 text-xs mb-1">Rows currently on screen (not necessarily what is published):</div>
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

