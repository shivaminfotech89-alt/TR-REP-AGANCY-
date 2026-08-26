import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Layers, Building2, CheckCircle2, RefreshCw, AlertCircle, AlertTriangle, Sparkles, Check, Globe2, ShieldCheck, Wrench, Scale, LayoutGrid, FileText, Crown, Database
} from 'lucide-react';
import { serverTimestamp } from 'firebase/firestore';
import { auth } from '../lib/firebase';
import { formatDDMMYYYY } from '../lib/utils';
import { Link, useSearchParams } from 'react-router-dom';
import { useAgency, type AtMaster, type Agency } from '../lib/AgencyContext';
import { checkMasterSection, storedSection, MasterSection } from '../lib/estimateMasterHealth';
import { scheduleSrForMasterCode, variantAxisForMasterCode } from '../lib/scheduleItemMap';
import { SCHEDULE_A, bandForKva } from '../lib/ugvclSchedule2020';
import { SCRAP_ITEM_CODE_BY_CORE_CLASS } from '../lib/estimateCalc';

const kvaColumns = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'] as const;
type KvaType = typeof kvaColumns[number];

type SectionKey = 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS';
const SECTION_KEYS: SectionKey[] = ['CRGO', 'AMORPHOUS', 'WOUND_CORE', 'OVERHAULING', 'CIRCLE_LIMITS'];
/** Master section -> the agency document field it is stored in. */
const SECTION_FIELD: Record<SectionKey, string> = {
  CRGO: 'estimateMasterCRGO',
  AMORPHOUS: 'estimateMasterAmorphous',
  WOUND_CORE: 'estimateMasterWoundCore',
  OVERHAULING: 'estimateMasterOverhauling',
  CIRCLE_LIMITS: 'estimateMasterCircleLimits',
};

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
    atMasters,
    activeAtMaster: globalActiveAtMaster,
    updateAtMaster,
    publishedAts,
    isSuperAdmin,
    countOverridesForApply,
    applyRatesToOwnAts,
    publishAtTemplate,
    adoptPublishedAt,
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
  // SINGLE for everyone, admin included.
  //
  // 'ALL' used to be the default, which pre-selected the publishing option for the one
  // account that can actually execute it - while the card beside it carried the
  // "Recommended" badge. The badge and the default disagreed, and the disagreement favoured
  // the wider blast radius. Publishing seeds the baseline every future agency inherits and
  // cannot be undone by the actor on anyone else's behalf; that is a thing to choose, not
  // a thing to arrive at by pressing Save without reading the modal.
  const [saveScope, setSaveScope] = useState<'ALL' | 'SINGLE'>('SINGLE');

  // Full Sync Modal
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyTargets, setApplyTargets] = useState<string[]>([]);
  /** The "publish this AT as a template" dialog. Replaces publishing to public_config. */
  const [showPublishTplModal, setShowPublishTplModal] = useState(false);
  const [publishTplName, setPublishTplName] = useState('');
  const [publishTplNotes, setPublishTplNotes] = useState('');
  const [publishTplTargetId, setPublishTplTargetId] = useState<string>('');
  const [applyCounts, setApplyCounts] = useState<Array<{ id: string; name: string; overrides: number; inheritingCellsFrozen: number; sections: Record<string, number>; sectionWrites: Array<{ field: string; rowsBefore: number; rowsAfter: number; added: number; removed: number }> }> | null>(null);
  const [countingOverrides, setCountingOverrides] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);

  /**
   * WHICH TENDER'S RATES THIS SCREEN IS SHOWING — a choice made HERE, and only here.
   *
   * ⚠ DISPLAY-ONLY. Selecting a tender in this dropdown does NOT change the globally active
   * AT, and must never be made to. The active AT decides which prefixes New Job draws job
   * numbers from, which allotment is checked at intake, and which tender the next MR is
   * booked against. An operator who opens this screen to LOOK at last year's rates would
   * otherwise silently re-point all three - a mutation caused by a read, which is the shape
   * of F70 and F72 both (AUDIT F79).
   *
   * It DEFAULTS to the active AT, so the two agree unless the operator deliberately picks
   * another; and when they do diverge, the screen says so rather than leaving it implicit.
   */
  const [selectedAtIdState, setSelectedAtId] = useState<string | null>(null);

  /** The agency's tenders, newest tender period first. Closed ones are included - see below. */
  const agencyAts = useMemo(
    () => atMasters
      .filter(t => t.agencyId === activeAgency?.id)
      .sort((a, b) => (b.startDate || 0) - (a.startDate || 0)),
    [atMasters, activeAgency?.id],
  );

  /**
   * ⚠ EVERY READ AND EVERY WRITE ON THIS SCREEN GOES THROUGH `selectedAt`, NOT
   * `globalActiveAtMaster`. A screen showing AT 24-25 that saves to AT 26-27 is worse than
   * the problem this dropdown solves, so the context value is deliberately renamed: any
   * reference that was not migrated is an undefined identifier and fails to compile rather
   * than quietly reading the wrong tender.
   *
   * `globalActiveAtMaster` survives for exactly one purpose - saying that the two differ.
   */
  const selectedAt = useMemo(() => {
    const chosen = selectedAtIdState ? agencyAts.find(t => t.id === selectedAtIdState) : null;
    return chosen || globalActiveAtMaster || agencyAts[0] || null;
  }, [selectedAtIdState, agencyAts, globalActiveAtMaster]);

  /** True when this screen is showing a different tender from the one the app is working in. */
  const divergedFromActive = Boolean(
    selectedAt && globalActiveAtMaster && selectedAt.id !== globalActiveAtMaster.id
  );

  /**
   * A CLOSED TENDER IS READ-ONLY.
   *
   * Viewing what a retired tender priced at is legitimate and is often the reason to come
   * here. Editing it is not: those rates priced jobs that are already estimated, billed and
   * paid, and the printed estimate RECOMPUTES rather than reading stored figures (F72) - so
   * changing them silently re-prices work that has already left the building, and the paper
   * in the file stops matching the screen.
   *
   * The way through is deliberate rather than blocked: reopen the tender in Agency Settings
   * if its rates genuinely need correcting. Two steps, not one accident.
   */
  const selectedAtClosed = String(selectedAt?.status || '').toLowerCase() === 'closed';
  const canSaveRates = Boolean(selectedAt) && !selectedAtClosed;

  /** `?at=<id>` selects a tender on arrival - see the AT creation flow in AtSettings. */
  const [emParams] = useSearchParams();
  useEffect(() => {
    const wanted = emParams.get('at');
    if (wanted && agencyAts.some(t => t.id === wanted)) setSelectedAtId(wanted);
  }, [emParams, agencyAts]);

  /**
   * WHERE THIS SCREEN'S RATES COME FROM — the ACTIVE AT first, the agency behind it.
   *
   * Mirrors getEstimateMasterForCore's top two rungs exactly (AUDIT F73), per section
   * rather than per document: an AT that holds CRGO but not Overhauling shows its own CRGO
   * and the agency's Overhauling, which is what pricing will do.
   *
   * ⚠ Not `selectedAt ?? activeAgency`. That would show the agency's rates only when
   * NO AT is selected, and blank sections whenever an AT held some but not all of them -
   * which is precisely the state every migrated AT could be left in.
   */
  const rateHolder = useMemo(() => {
    const pick = (k: keyof AtMaster & keyof Agency) => {
      const fromAt = (selectedAt as any)?.[k];
      if (Array.isArray(fromAt) && fromAt.length > 0) return fromAt;
      return (activeAgency as any)?.[k];
    };
    return {
      estimateMasterCRGO: pick('estimateMasterCRGO' as any),
      estimateMasterAmorphous: pick('estimateMasterAmorphous' as any),
      estimateMasterWoundCore: pick('estimateMasterWoundCore' as any),
      estimateMasterOverhauling: pick('estimateMasterOverhauling' as any),
      estimateMasterCircleLimits: pick('estimateMasterCircleLimits' as any),
      // The pre-sections CRGO field never moved onto the AT and never will - nothing has
      // written it since D4. Agency only.
      estimateMaster: (activeAgency as any)?.estimateMaster,
    };
  }, [selectedAt, activeAgency]);

  /**
   * WHAT THE OPERATOR IS LOOKING AT, in one value. Absent ratesSource means NO RATES YET.
   */
  const ratesState = useMemo(() => {
    if (!selectedAt) return { kind: 'no-at' as const };
    const src = String((selectedAt as any).ratesSource || '').trim();
    if (!src) return { kind: 'none' as const };
    if (src === 'inherited-agency') return { kind: 'inherited' as const };
    if (src.startsWith('published:')) return { kind: 'published' as const, id: src.slice('published:'.length) };
    return { kind: 'own' as const };
  }, [selectedAt]);

  useEffect(() => {
    if (activeAgency) {
      // Load CRGO
      if (rateHolder.estimateMasterCRGO && rateHolder.estimateMasterCRGO.length > 0) {
        setCrgoData(mergeDefaultRates(JSON.parse(JSON.stringify(rateHolder.estimateMasterCRGO))));
      } else if (globalDefaultEstimateMaster?.estimateMasterCRGO && globalDefaultEstimateMaster.estimateMasterCRGO.length > 0) {
        setCrgoData(mergeDefaultRates(JSON.parse(JSON.stringify(globalDefaultEstimateMaster.estimateMasterCRGO))));
      } else if (rateHolder.estimateMaster && rateHolder.estimateMaster.length > 0) {
        setCrgoData(mergeDefaultRates(JSON.parse(JSON.stringify(rateHolder.estimateMaster))));
      } else {
        setCrgoData(JSON.parse(JSON.stringify(defaultEstimateData)));
      }

      // Load Amorphous
      let currentAmorphous: EstimateItem[] = [];
      if (rateHolder.estimateMasterAmorphous && rateHolder.estimateMasterAmorphous.length > 0) {
        currentAmorphous = normalizeAmorphousOrWoundCoreData(rateHolder.estimateMasterAmorphous, defaultAmorphousEstimateData);
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

      if (rateHolder.estimateMasterWoundCore && rateHolder.estimateMasterWoundCore.length > 0 && !isLegacyWc(rateHolder.estimateMasterWoundCore)) {
        setWoundCoreData(normalizeAmorphousOrWoundCoreData(rateHolder.estimateMasterWoundCore, currentAmorphous));
      } else if (globalDefaultEstimateMaster?.estimateMasterWoundCore && globalDefaultEstimateMaster.estimateMasterWoundCore.length > 0 && !isLegacyWc(globalDefaultEstimateMaster.estimateMasterWoundCore)) {
        setWoundCoreData(normalizeAmorphousOrWoundCoreData(globalDefaultEstimateMaster.estimateMasterWoundCore, currentAmorphous));
      } else {
        setWoundCoreData(JSON.parse(JSON.stringify(currentAmorphous)));
      }

      // Load Overhauling
      if (rateHolder.estimateMasterOverhauling && rateHolder.estimateMasterOverhauling.length > 0) {
        setOverhaulingData(normalizeOverhaulingData(rateHolder.estimateMasterOverhauling, defaultOverhaulingEstimateData));
      } else if (globalDefaultEstimateMaster?.estimateMasterOverhauling && globalDefaultEstimateMaster.estimateMasterOverhauling.length > 0) {
        setOverhaulingData(normalizeOverhaulingData(globalDefaultEstimateMaster.estimateMasterOverhauling, defaultOverhaulingEstimateData));
      } else {
        setOverhaulingData(JSON.parse(JSON.stringify(defaultOverhaulingEstimateData)));
      }

      // Load Circle Approval Limits
      if (rateHolder.estimateMasterCircleLimits && rateHolder.estimateMasterCircleLimits.length > 0) {
        setCircleLimitsData(normalizeCircleLimitsData(rateHolder.estimateMasterCircleLimits, defaultCircleLimitsEstimateData));
      } else if (globalDefaultEstimateMaster?.estimateMasterCircleLimits && globalDefaultEstimateMaster.estimateMasterCircleLimits.length > 0) {
        setCircleLimitsData(normalizeCircleLimitsData(globalDefaultEstimateMaster.estimateMasterCircleLimits, defaultCircleLimitsEstimateData));
      } else {
        setCircleLimitsData(JSON.parse(JSON.stringify(defaultCircleLimitsEstimateData)));
      }
    }
  }, [activeAgency, selectedAt, globalDefaultEstimateMaster, rateHolder]);

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

  /**
   * Sections the operator has changed while this agency has been open, SURVIVING A SAVE.
   *
   * `editedSections` cannot serve this. The loader effect depends on `activeAgency`, and
   * `updateAgency` replaces that object - so saving re-runs the effect, which clears
   * `editedSections` by design ("a fresh load is not an edit"). That is right for
   * publishPlanFor, which asks "is the screen ahead of storage"; after a save it is not.
   *
   * But "which sections did I change" is a different question, and the answer must outlive
   * the save - the ordinary workflow is edit, Save All, then apply to the other agencies.
   * Keyed on agency id so switching agencies resets it and switching back does not
   * resurrect a stale set.
   */
  const touchedRef = useRef<{ agencyId: string | null; sections: Set<string> }>({ agencyId: null, sections: new Set() });
  const noteTouched = (...sections: string[]) => {
    const id = activeAgency?.id ?? null;
    if (touchedRef.current.agencyId !== id) touchedRef.current = { agencyId: id, sections: new Set() };
    sections.forEach(sec => touchedRef.current.sections.add(sec));
  };
  const touchedSections = (): SectionKey[] =>
    (activeAgency?.id && touchedRef.current.agencyId === activeAgency.id)
      ? SECTION_KEYS.filter(k => touchedRef.current.sections.has(k))
      : [];
  const markEdited = (...sections: string[]) => {
    noteTouched(...sections);
    return setEditedSections(prev => {
      const next = { ...prev };
      sections.forEach(sec => { next[sec] = true; });
      return next;
    });
  };

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

      await saveRatesToActiveAt(updatePayload);
      setEditingSection(null);
      setPendingSaveSection(null);
      setSyncSuccessMsg(`✓ Saved ${section} rates for AT "${selectedAt?.atNumber || selectedAt?.name}" (${activeAgency.name}). No other AT, agency or user is affected.`);
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

  /**
   * WHERE A SAVE LANDS: THE ACTIVE AT (AUDIT F73).
   *
   * Rates belong to the tender. Writing them to the agency would put them on a document
   * every AT of that agency falls back to, so editing one tender's rates would silently
   * re-price every other tender that had not yet been given its own - which is the exact
   * shape this move removes.
   *
   * Stamps `ratesSource: 'own'` on every write. An AT that was showing
   * 'inherited-agency' becomes its own the moment the operator saves, because that is what
   * has happened: the figures on screen are now this tender's, whatever they came from.
   *
   * The agency's sections are NOT written and NOT cleared. They remain the fallback rung
   * for ATs that have no section of their own, and the recovery path if a tender's rates
   * turn out wrong.
   */
  const saveRatesToActiveAt = async (payload: Record<string, any>) => {
    if (!selectedAt) {
      throw new Error('No AT is selected, so there is nowhere to save these rates. Rates belong to a tender.');
    }
    await updateAtMaster(selectedAt.id, {
      ...payload,
      ratesSource: 'own',
      ratesUpdatedAt: Date.now(),
      ...editStamp(),
    } as any);
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
      await saveRatesToActiveAt(payload);
      setEditingSection(null);
      setSyncSuccessMsg(`✓ Saved all five sections for AT "${selectedAt?.atNumber || selectedAt?.name}" (${activeAgency.name}). No other AT, agency or user is affected.`);
      setTimeout(() => setSyncSuccessMsg(null), 5000);
    } catch (err) {
      alert('Failed to save rates for active agency.');
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  // Execute Save based on chosen scope (Admin modal)
  /**
   * ONE DESTINATION: THE ACTIVE AT (AUDIT F73).
   *
   * This branched on `saveScope`: 'SINGLE' wrote the agency, 'ALL' wrote `public_config`.
   * That second branch was a SECOND PUBLISH PATH, writing to a different layer from the
   * template publisher - and two publish paths writing to different layers is how a
   * baseline and the things derived from it drift apart. `public_config` already holds two
   * 100-KVA rates no agency has, which is that drift, already happened, silently.
   *
   * Publishing is now one action: "Publish this AT as a template", writing `published_ats`.
   * `public_config` stays the resolution fallback for agencies with no AT rates, and
   * nothing writes to it.
   */
  const handleConfirmSaveSection = async () => {
    if (!pendingSaveSection) return;
    return handleSaveSectionToActiveAgency(pendingSaveSection);
  };

  /**
   * ONLY THE SECTIONS THE OPERATOR ACTUALLY CHANGED.
   *
   * This used to return all five unconditionally, so correcting six CRGO cells also
   * replaced Overhauling and Circle Limits on every target - wholesale, because updateDoc
   * replaces an array rather than merging it. The confirmation could not warn about it
   * either: the cell count never visits a row the payload does not contain (AUDIT O31).
   *
   * Sending what was edited makes the blast radius equal to the intent. A section nobody
   * touched is not in the payload at all, so it cannot be replaced by accident.
   */
  const buildSectionPayload = () => {
    const out: Record<string, EstimateItem[] | undefined> = {};
    touchedSections().forEach(sec => { out[SECTION_FIELD[sec]] = publishPlanFor(sec).payload; });
    return out;
  };

  /**
   * ALL FIVE SECTIONS, for publishing a template.
   *
   * `buildSectionPayload` returns only the sections TOUCHED this session, which is right for
   * saving and for applying to other ATs - both write onto something that already exists,
   * and leaving an unedited section alone is the point.
   *
   * IT IS WRONG FOR A TEMPLATE. A template is adopted wholesale: `adoptPublishedAt` copies
   * the sections the template carries and leaves the rest of the AT as it was, then stamps
   * `ratesSource: 'published:<id>'`. Publish after editing only CRGO and the template holds
   * only CRGO - so an AT adopting it ends up a MIXTURE of that template and whatever was
   * there before, labelled as though the whole schedule came from the template.
   *
   * That is the shape this audit keeps finding: a value that describes something other than
   * what it is attached to. A template carries the whole schedule or it is not a template.
   */
  const buildFullTemplatePayload = () => {
    const out: Record<string, EstimateItem[] | undefined> = {};
    (['CRGO', 'AMORPHOUS', 'WOUND_CORE', 'OVERHAULING', 'CIRCLE_LIMITS'] as const).forEach(sec => {
      out[SECTION_FIELD[sec]] = publishPlanFor(sec).payload;
    });
    return out;
  };

  /**
   * "Apply to my agencies" - owner-scoped, available to every user, no admin rights.
   *
   * The count is fetched BEFORE the modal can be confirmed, and from fresh reads, because
   * the whole purpose of the dialog is to say what this destroys. A dialog that cannot yet
   * say it must not offer the button.
   */
  /**
   * THE ATs THIS USER COULD COPY RATES TO.
   *
   * ACROSS AGENCIES, not just this one - an owner with several agencies now has several
   * tenders, and copying a schedule between tenders is the useful action. Copying between
   * AGENCY documents writes to the fallback rung, which would silently re-price every
   * tender that has no schedule of its own.
   *
   * Carries the agency name because an AT number does not identify an AT: "2026-27" exists
   * under two different agencies in live data.
   *
   * CLOSED TENDERS ARE OFFERED BUT MARKED, never silently included. Copying rates into a
   * retired tender re-prices the jobs still under it, and AARATI's only AT is Closed with a
   * job beneath it - so this is a real case, not a hypothetical.
   */
  const applyCandidateAts = useMemo(() => {
    const uid = activeAgency?.ownerId;
    const ownedAgencyIds = new Set(agencies.filter(a => a.ownerId === uid).map(a => a.id));
    return atMasters
      .filter(t => t.id !== selectedAt?.id && t.ownerId === uid && ownedAgencyIds.has(t.agencyId))
      .map(t => ({
        id: t.id,
        label: t.atNumber || t.name || t.id,
        agencyName: agencies.find(a => a.id === t.agencyId)?.name || '(unknown agency)',
        closed: String(t.status || '').toLowerCase() === 'closed',
        ratesSource: String((t as any).ratesSource || '') || null,
      }))
      .sort((a, b) => a.agencyName.localeCompare(b.agencyName) || a.label.localeCompare(b.label));
  }, [atMasters, agencies, activeAgency, selectedAt]);

  const openApplyToMyAgencies = async () => {
    if (!selectedAt) {
      alert('No AT is selected. Rates belong to a tender, so there is nothing to copy from.');
      return;
    }
    const others = applyCandidateAts;
    if (others.length === 0) {
      alert('You have no other AT to copy these rates to. Rates belong to a tender, so this copies between tenders - create another AT first.');
      return;
    }
    // REFUSE WHEN NOTHING WAS EDITED. Writing five sections of unchanged data to four
    // agencies is not a no-op: it replaces each array with an equal-looking copy, stamps
    // every target as edited, and converts any cell the source resolves-but-does-not-store
    // into stored data on the targets. An action with nothing to do should say so.
    const edited = touchedSections();
    if (edited.length === 0) {
      alert(
        'Nothing to apply.\n\n'
        + 'No section has been changed since this agency was opened, so there is nothing to '
        + 'copy to your other agencies.\n\n'
        + 'Edit the rates you want to propagate first, then use this button. Saving does not '
        + 'clear what you have changed, so you can save first and apply afterwards.'
      );
      return;
    }

    // Same guard the publish path uses, over the edited sections only: never push a section
    // that exists on screen only because a fallback resolved it. Sending four agencies a
    // section this agency does not actually have stored is how one wrong card became four.
    if (blockPublishIfFallbackResolved(edited)) return;

    // Closed tenders are NOT pre-ticked. They are still offered - an operator may genuinely
    // need to correct a retired tender's rates - but ticking one has to be a decision.
    setApplyTargets(others.filter(a => !a.closed).map(a => a.id));
    setApplyCounts(null);
    setShowApplyModal(true);
    setCountingOverrides(true);
    try {
      setApplyCounts(await countOverridesForApply(buildSectionPayload(), others.map(a => a.id), 'atMasters'));
    } catch (err) {
      console.error(err);
      setShowApplyModal(false);
      alert('Could not read the other ATs to check what this would overwrite. Nothing was changed.');
    } finally {
      setCountingOverrides(false);
    }
  };

  /**
   * PUBLISH THIS AT'S RATES AS A NAMED TEMPLATE. Admin only.
   *
   * REPLACES publishing to `public_config`. Rates belong to a tender, so a baseline that
   * everyone inherits should be a published TENDER, not an agency-level document. Two
   * publish paths writing to different layers is how a baseline and the things derived from
   * it drift apart - `public_config` already holds two 100-KVA rates no agency has.
   *
   * `public_config` stays as the resolution fallback for agencies with no AT rates. Nothing
   * new writes to it.
   */
  const handlePublishTemplate = async () => {
    if (!publishTplName.trim()) { alert('Give the template a name operators will recognise, e.g. "UGVCL 2026-27 Schedule A".'); return; }
    // The same guard the old publish path used: never publish a section that is on screen
    // only because a fallback resolved it. Publishing a card this AT does not actually
    // store is how one wrong schedule reaches everyone who copies it.
    if (blockPublishIfFallbackResolved(touchedSections().length ? touchedSections() : (['CRGO','AMORPHOUS','WOUND_CORE','OVERHAULING','CIRCLE_LIMITS'] as const).slice() as any)) return;
    setIsSaving(true);
    try {
      const id = await publishAtTemplate(
        { id: publishTplTargetId || undefined, name: publishTplName.trim(), atNumber: selectedAt?.atNumber, notes: publishTplNotes.trim() },
        // ALL FIVE, not just what was edited - see buildFullTemplatePayload.
        buildFullTemplatePayload(),
      );
      setShowPublishTplModal(false);
      setPublishTplNotes('');
      setPublishTplTargetId('');
      const tpl = publishedAts.find(t => t.id === id);
      setSyncSuccessMsg(`✓ Published "${publishTplName.trim()}"${tpl ? ` v${tpl.version}` : ''}. Any user can now copy it onto their own AT. Nobody's existing rates changed.`);
      setTimeout(() => setSyncSuccessMsg(null), 7000);
    } catch (err) {
      console.error(err);
      alert('Could not publish the template. Nothing was written.');
    } finally {
      setIsSaving(false);
    }
  };

  /** Copy a published template onto the ACTIVE AT. A copy, with the version stamped. */
  const handleAdoptTemplate = async (templateId: string) => {
    if (!selectedAt) { alert('No AT is selected, so there is nowhere to copy these rates to.'); return; }
    const tpl = publishedAts.find(t => t.id === templateId);
    if (!tpl) return;
    const ok = window.confirm(
      `Copy "${tpl.name}" v${tpl.version} onto AT ${selectedAt.atNumber || selectedAt.name}?\n\n`
      + `This REPLACES the rates currently on this AT. It is a copy, so later revisions of the template will not change your rates - `
      + `you will simply be told the template has moved on.`
    );
    if (!ok) return;
    setIsSaving(true);
    try {
      await adoptPublishedAt(selectedAt.id, templateId);
      setSyncSuccessMsg(`✓ Copied "${tpl.name}" v${tpl.version} onto AT ${selectedAt.atNumber || selectedAt.name}.`);
      setTimeout(() => setSyncSuccessMsg(null), 6000);
    } catch (err) {
      console.error(err);
      alert('Could not copy that template. Nothing was changed.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyToMyAgencies = async () => {
    setIsSaving(true);
    try {
      await applyRatesToOwnAts(buildSectionPayload(), applyTargets);
      setShowApplyModal(false);
      const names = applyCandidateAts.filter(a => applyTargets.includes(a.id))
        .map(a => `${a.label} (${a.agencyName})`).join(', ');
      setSyncSuccessMsg(`✓ Rates from AT ${selectedAt?.atNumber || selectedAt?.name} applied to ${names}.`);
      setTimeout(() => setSyncSuccessMsg(null), 6000);
    } catch (err) {
      console.error(err);
      alert('Failed to apply rates to your other ATs. Nothing was changed.');
    } finally {
      setIsSaving(false);
    }
  };

  // THE FULL-SYNC PUBLISH IS DELETED (AUDIT F73). `handleExecuteFullSync` wrote all five
  // sections into `public_config` and re-seeded the shared baseline - the second publish
  // path. See handleConfirmSaveSection above for why one is all there can be.

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

      {/* ⚠ THE SCREEN AND THE APP ARE ON DIFFERENT TENDERS.
          Selecting here is display-only by design, which means the operator can end up
          reading one tender's rates while New Job books against another. That is a fine
          state to be in and a terrible one to be in WITHOUT KNOWING, so it is stated -
          divergence named is not confusion; divergence unstated is (AUDIT F79). */}
      {divergedFromActive && (
        <div className="bg-indigo-50 border border-indigo-300 rounded-xl p-3 text-xs text-indigo-900 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">
              You are viewing AT {selectedAt?.atNumber || selectedAt?.name}. New Job is booking
              against AT {globalActiveAtMaster?.atNumber || globalActiveAtMaster?.name}.
            </p>
            <p className="mt-0.5">
              Choosing a tender here changes only what this screen shows and saves. It does not
              change which tender intake, job numbering or allotment use &mdash; that is set in
              Agency Settings.
            </p>
          </div>
        </div>
      )}

      {/* A CLOSED TENDER IS SHOWN BUT NOT EDITABLE. */}
      {selectedAtClosed && (
        <div className="bg-slate-100 border border-slate-400 rounded-xl p-3 text-xs text-slate-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">
              AT {selectedAt?.atNumber || selectedAt?.name} is CLOSED. These rates are read-only.
            </p>
            <p className="mt-0.5">
              They priced jobs that are already estimated, billed and paid, and the printed
              estimate recomputes rather than reading stored figures &mdash; so changing them
              would silently re-price work that has already left the building.
            </p>
            <p className="mt-0.5">
              If they genuinely need correcting, reopen the tender first: Agency Settings &rarr;
              Tenders &rarr; <strong>Mark as Active</strong>.
            </p>
          </div>
        </div>
      )}

      {/* WHERE THESE RATES COME FROM — stated, never implied.
          `ratesSource` absent means an AT has no rates of its own, and that must not look
          the same as having them. A silent fallthrough to the agency's is the 'JOB'
          sentinel shape (F71): a plausible value standing in for a missing one, with
          nothing saying which it was. */}
      {(() => {
        if (ratesState.kind === 'no-at') {
          // TWO DIFFERENT PROBLEMS, and telling them apart is the whole value of the
          // message. "None selected" is a click away; "none exists" is a setup step the
          // app never asked for - the nav has no Tenders entry and AT creation sits below
          // the agency form in Settings, so a new agency reaches THIS screen first and
          // meets a wall. Saying "cannot save" without saying "create a tender" leaves
          // them at the wall.
          const agencyHasAnyAt = atMasters.some(t => t.agencyId === activeAgency.id);
          return (
            <div className="bg-rose-50 border border-rose-300 rounded-xl p-4 text-sm text-rose-900 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">
                  {agencyHasAnyAt
                    ? 'No AT is selected, so there is nowhere to save rates.'
                    : `${activeAgency.name} has no AT (tender) yet, so it has no rates to set.`}
                </p>
                <p className="text-xs mt-1">
                  {agencyHasAnyAt
                    ? <>Rates belong to a tender. Select which AT you are editing, then come back.</>
                    : <>Rates are part of a tender, not of the agency &mdash; each AT carries the schedule it
                       was awarded under. <strong>Create the AT first</strong>, then set its rates here. The
                       figures below are the shipped defaults and are shown for reference only.</>}
                </p>
                <Link
                  to="/agency-settings?section=at"
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold"
                >
                  {agencyHasAnyAt ? 'Choose an AT' : 'Create an AT for this agency'}
                </Link>
              </div>
            </div>
          );
        }
        if (ratesState.kind === 'none') {
          return (
            <div className="bg-rose-50 border border-rose-300 rounded-xl p-4 text-sm text-rose-900 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">
                  AT &ldquo;{selectedAt?.atNumber || selectedAt?.name}&rdquo; has no rates of its own.
                </p>
                <p className="text-xs mt-1">
                  A new tender starts with no schedule. The figures below are a starting point drawn from
                  {' '}<strong>{activeAgency.name}</strong> and the shipped defaults &mdash; they are
                  {' '}<strong>not this AT&rsquo;s rates</strong> until you save them.
                </p>
              </div>
            </div>
          );
        }
        if (ratesState.kind === 'inherited') {
          return (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-sm text-amber-900 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">
                  These rates were inherited from {activeAgency.name}, not entered for this tender.
                </p>
                <p className="text-xs mt-1">
                  They were copied onto AT &ldquo;{selectedAt?.atNumber || selectedAt?.name}&rdquo; when rates
                  moved from agencies onto tenders, so they are the figures this agency was using &mdash; but nobody
                  has confirmed them against <strong>this</strong> tender&rsquo;s schedule. Saving any section makes
                  them this AT&rsquo;s own.
                </p>
              </div>
            </div>
          );
        }
        if (ratesState.kind === 'published') {
          const tpl = publishedAts.find(t => t.id === (ratesState as any).id);
          const usedVersion = Number((selectedAt as any)?.publishedAtVersion ?? 0);
          const currentVersion = Number(tpl?.version ?? 0);
          const drifted = tpl && currentVersion > usedVersion;
          return (
            <div className={`${drifted ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-emerald-50 border-emerald-300 text-emerald-900'} border rounded-xl p-4 text-sm flex items-start gap-3`}>
              {drifted ? <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" /> : <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" />}
              <div>
                <p className="font-bold">
                  Copied from published template &ldquo;{tpl?.name || (ratesState as any).id}&rdquo; v{usedVersion || '?'}
                </p>
                {/* THE DRIFT CASE, said where someone editing rates would look - not only in
                    the data. A copy does not follow the template, which is the point: a live
                    estimate must not change because an admin revised a template. But the
                    operator has to be able to SEE that it has moved on. */}
                <p className="text-xs mt-1">
                  {drifted
                    ? <>The template is now at <strong>v{currentVersion}</strong>. Your rates did not change and will
                       not &mdash; a copy never follows the template, or a live estimate could move under you. Review
                       the differences and re-copy if this tender should adopt them.</>
                    : <>This is the current version of that template. Your rates are a copy and will not change if the
                       template is revised.</>}
                </p>
              </div>
            </div>
          );
        }
        return (
          <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-4 text-sm text-emerald-900 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">
                Rates entered for AT &ldquo;{selectedAt?.atNumber || selectedAt?.name}&rdquo;.
              </p>
              <p className="text-xs mt-1">
                They price only jobs booked under this tender. No other AT, agency or user is affected.
              </p>
            </div>
          </div>
        );
      })()}

      {/* ADOPT A PUBLISHED TEMPLATE. Shown to everyone: this is the second of the two ways
          a user gets rates - enter them, or take a published AT. It sits above the tables
          because for an AT with none, it is the fastest correct action on the screen. */}
      {selectedAt && publishedAts.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900">Published AT templates</h3>
            <span className="text-[11px] text-slate-500">
              copy one onto AT {selectedAt.atNumber || selectedAt.name}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {publishedAts.map(t => {
              const isSource = ratesState.kind === 'published' && (ratesState as any).id === t.id;
              const usedVersion = Number((selectedAt as any)?.publishedAtVersion ?? 0);
              return (
                <div key={t.id} className="border border-slate-200 rounded-lg p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-800 truncate">{t.name}</div>
                    <div className="text-[11px] text-slate-500">
                      v{t.version}
                      {t.atNumber ? ` · AT ${t.atNumber}` : ''}
                      {isSource && usedVersion < Number(t.version) && (
                        <span className="ml-1 text-amber-700 font-bold">· you have v{usedVersion}</span>
                      )}
                      {isSource && usedVersion >= Number(t.version) && (
                        <span className="ml-1 text-emerald-700 font-bold">· in use</span>
                      )}
                    </div>
                    {t.notes && <div className="text-[11px] text-slate-600 mt-0.5 line-clamp-2">{t.notes}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAdoptTemplate(t.id)}
                    disabled={isSaving}
                    className="shrink-0 px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg disabled:opacity-50"
                  >
                    {isSource && usedVersion < Number(t.version) ? `Update to v${t.version}` : 'Copy to this AT'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* PUBLISH AS A TEMPLATE — admin only. */}
      {showPublishTplModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-5 sm:p-6 max-w-lg w-full border border-purple-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3 mb-3 text-purple-700">
              <div className="bg-purple-100 p-2.5 rounded-xl shrink-0"><Crown className="w-6 h-6" /></div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Publish this AT as a template</h3>
                <p className="text-xs text-purple-700 font-medium">
                  Any user can copy it onto their own tender. Nobody&rsquo;s existing rates change.
                </p>
              </div>
            </div>

            <label className="block text-xs font-bold text-slate-700 mt-3">Template name</label>
            <input
              value={publishTplName}
              onChange={e => setPublishTplName(e.target.value)}
              placeholder="UGVCL 2026-27 Schedule A"
              className="w-full mt-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-purple-500"
            />

            <label className="block text-xs font-bold text-slate-700 mt-3">What changed in this version</label>
            <textarea
              value={publishTplNotes}
              onChange={e => setPublishTplNotes(e.target.value)}
              rows={2}
              placeholder="Shown to anyone whose copy is behind this version."
              className="w-full mt-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-purple-500"
            />

            {publishedAts.length > 0 && (
              <>
                <label className="block text-xs font-bold text-slate-700 mt-3">Publish as</label>
                <select
                  value={publishTplTargetId}
                  onChange={e => {
                    setPublishTplTargetId(e.target.value);
                    const t = publishedAts.find(x => x.id === e.target.value);
                    if (t) setPublishTplName(t.name);
                  }}
                  className="w-full mt-1 px-3 py-2 text-sm border border-slate-300 rounded-lg"
                >
                  <option value="">A NEW template</option>
                  {publishedAts.map(t => (
                    <option key={t.id} value={t.id}>Revise &ldquo;{t.name}&rdquo; (now v{t.version} &rarr; v{Number(t.version) + 1})</option>
                  ))}
                </select>
              </>
            )}

            {/* A NEW VERSION IS A NEW NUMBER, NOT A NEW DOCUMENT. Whoever copied v3 keeps
                v3's rates and is shown that the template has moved on; replacing the
                document would leave their publishedAtVersion pointing at nothing. */}
            <p className="text-xs text-slate-700 bg-purple-50 border border-purple-200 rounded-lg p-3 mt-3">
              Revising a template <strong>bumps its version</strong>. Anyone who already copied it keeps the rates
              they copied &mdash; a copy never follows the template, or a live estimate would move under them &mdash;
              and their Estimate Master screen tells them a newer version exists.
            </p>

            <div className="flex flex-col sm:flex-row justify-end gap-2 mt-4">
              <button type="button" onClick={() => setShowPublishTplModal(false)}
                      className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-300">
                Cancel
              </button>
              <button type="button" onClick={handlePublishTemplate} disabled={isSaving}
                      className="px-4 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-sm disabled:opacity-50">
                {publishTplTargetId ? 'Publish new version' : 'Publish template'}
              </button>
            </div>
          </div>
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
            {/* WHICH TENDER'S RATES THESE ARE. Rates live on the AT now (AUDIT F73), so the
                agency alone no longer says what is on screen - and an AT NUMBER alone does
                not either: "2026-27" exists under two different agencies in live data. */}
            {/* THE TENDER SELECTOR. Display-only: it changes what THIS SCREEN shows and
                writes, and nothing else. See the note on `selectedAt`. */}
            {agencyAts.length > 0 ? (
              <label className="inline-flex items-center gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Rates for</span>
                <select
                  value={selectedAt?.id || ''}
                  onChange={e => setSelectedAtId(e.target.value || null)}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg border bg-white ${
                    selectedAtClosed
                      ? 'border-slate-400 text-slate-600'
                      : 'border-indigo-300 text-indigo-800'
                  }`}
                >
                  {agencyAts.map(t => (
                    <option key={t.id} value={t.id}>
                      AT {t.atNumber || t.name}
                      {String(t.status || '').toLowerCase() === 'closed' ? ' — CLOSED' : ''}
                      {!(t as any).ratesSource ? ' — no rates' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="px-2.5 py-0.5 text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 rounded-full">
                No AT exists for this agency
              </span>
            )}
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
            disabled={isSaving || !canSaveRates}
            className="flex items-center px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors disabled:opacity-50"
            title={!selectedAt
              ? 'No AT is selected. Rates belong to a tender, so there is nowhere to save them.'
              : selectedAtClosed
                ? `AT ${selectedAt.atNumber || selectedAt.name} is closed and its rates are read-only.`
                : `Save all five sections onto AT ${selectedAt.atNumber || selectedAt.name}. No other AT, agency or user is affected.`}
          >
            <Save className="w-3.5 h-3.5 mr-1.5" />
            {/* NAMES THE TENDER, NEVER THE AGENCY. Rates belong to a tender, the dropdown
                above can be pointing at any of them, and this is the last thing the operator
                reads before writing (AUDIT F79). */}
            <span className="flex flex-col items-start leading-tight text-left">
              <span>Save all 5 sections to AT {selectedAt?.atNumber || selectedAt?.name || '—'}</span>
              {divergedFromActive && (
                <span className="text-[9px] font-semibold opacity-90">not the tender New Job is using</span>
              )}
            </span>
          </button>
          {/* TWO BUTTONS, TWO BLAST RADII.
              One control used to do both: write public_config AND loop the caller's own
              agencies. Applying rates to agencies you own is reversible by you; seeding
              public_config changes the default every future agency inherits, for every
              user, and cannot be undone by you on their behalf. Naming one of those two
              is how someone publishes a baseline meaning to update their own agencies. */}
          {/* Gated on ATs, not on how many AGENCIES exist. One agency with two tenders is
              exactly the case this is for, and it used to be hidden. */}
          {applyCandidateAts.length > 0 && (
            <button
              type="button"
              onClick={openApplyToMyAgencies}
              disabled={isSaving || !selectedAt}
              className="flex items-center px-3.5 py-2 text-xs font-bold text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 shadow-2xs transition-colors disabled:opacity-50"
              title={`Copy these rates onto your other ATs. You will see what it replaces before anything is written.`}
            >
              <Building2 className="w-3.5 h-3.5 mr-1.5 text-sky-600" />
              Apply to my other ATs
            </button>
          )}
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => { setPublishTplName(selectedAt?.atNumber ? `UGVCL ${selectedAt.atNumber}` : ''); setShowPublishTplModal(true); }}
              disabled={!selectedAt}
              className="flex items-center px-3.5 py-2 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 shadow-2xs transition-colors disabled:opacity-50"
              title="Admin only: publish these rates as a named AT template that any user can copy onto their own tender. Does not change anyone's existing rates."
            >
              <Crown className="w-3.5 h-3.5 mr-1.5 text-purple-600" />
              Publish this AT as a template
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

              {/* Option 2: the shared baseline.
                  GATED, and shown DISABLED rather than hidden for a non-admin. It used to
                  render for everyone, `saveScope` defaults to 'ALL' so it was even
                  pre-selected, and handleConfirmSaveSection silently redirected a
                  non-admin to the agency-only save. The operator picked "publish", pressed
                  a button reading "Save as Default for All Users", and got an agency save
                  with nothing to say the choice had been overridden - a control that
                  accepts a choice and quietly does something else. Disabled-and-explained
                  beats hidden: it answers "why can't I publish" instead of raising it. */}
              <div 
                onClick={() => { if (isSuperAdmin) setSaveScope('ALL'); }}
                className={`p-4 rounded-xl border-2 transition-all ${
                  !isSuperAdmin
                    ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                    : saveScope === 'ALL'
                      ? 'border-blue-600 bg-blue-50/50 shadow-xs cursor-pointer'
                      : 'border-slate-200 hover:border-slate-300 bg-white cursor-pointer'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <input 
                      type="radio" 
                      name="saveScope" 
                      checked={isSuperAdmin && saveScope === 'ALL'} 
                      disabled={!isSuperAdmin}
                      onChange={() => setSaveScope('ALL')}
                      className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-slate-300 disabled:opacity-50"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">Publish to the shared baseline</span>
                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                          isSuperAdmin ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-600'
                        }`}>{isSuperAdmin ? 'New agencies' : 'Administrator only'}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Updates the central default that <strong>newly created agencies</strong> inherit, and that any agency with no {pendingSaveSection} rates of its own resolves through. <strong>Existing agencies keep their own rates</strong> - this does not change them.
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
                    {isSuperAdmin && saveScope === 'ALL' ? `Publish to shared baseline` : `Save for ${activeAgency.name}`}
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
                  <h3 className="text-lg font-bold text-slate-900">Apply these rates to my other ATs</h3>
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
                Reading each AT to check what this would replace…
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
                        {/* THE AGENCY NAME IS PART OF THE IDENTITY. `c.name` is whatever the
                            target document's `name` field holds, which for an AT is often
                            blank - and "2026-27" exists under two different agencies in live
                            data, so the number alone names nothing. */}
                        {(() => {
                          const cand = applyCandidateAts.find(a => a.id === c.id);
                          return (
                            <div className="text-xs font-bold text-slate-800 flex flex-wrap items-center gap-1.5">
                              <span>AT {cand?.label || c.name || c.id}</span>
                              <span className="font-normal text-slate-500">{cand?.agencyName}</span>
                              {cand?.closed && (
                                <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-bold">
                                  CLOSED — jobs under it would be re-priced
                                </span>
                              )}
                              {cand && !cand.ratesSource && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-bold">
                                  no rates yet
                                </span>
                              )}
                            </div>
                          );
                        })()}
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
                        {/* EVERY SECTION THIS WRITES, not only the one being edited.
                            This action sends all five sections, so correcting CRGO also
                            replaces Overhauling and Circle Limits wholesale. The cell count
                            above cannot show that - it never visits a row the payload does
                            not contain - so a section replaced with the same row count
                            looked like no change at all (AUDIT O31). */}
                        {c.sectionWrites && c.sectionWrites.length > 0 && (
                          <div className="mt-1 pt-1 border-t border-slate-100 text-[10px] text-slate-500 leading-relaxed">
                            <span className="font-semibold text-slate-600">Also writes:</span>{' '}
                            {c.sectionWrites.map(w => {
                              const label = w.field.replace('estimateMaster', '') || 'CRGO';
                              const lost = w.removed > 0;
                              return (
                                <span key={w.field} className={lost ? 'text-rose-700 font-semibold' : ''}>
                                  {label} ({w.rowsBefore}&rarr;{w.rowsAfter} rows
                                  {w.removed > 0 ? `, ${w.removed} removed` : ''}
                                  {w.added > 0 ? `, ${w.added} added` : ''}
                                  ){'  '}
                                </span>
                              );
                            })}
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
                  {sel.some(c => (c.sectionWrites || []).some(w => w.removed > 0)) && (
                    <span className="block mt-1 text-rose-700 font-semibold">
                      Some sections lose rows entirely - see the red entries above. Rows removed this
                      way are not recoverable.
                    </span>
                  )}
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

      {/* The full-sync publish MODAL is deleted with its handler (AUDIT F73). */}

    </div>
  );
}

