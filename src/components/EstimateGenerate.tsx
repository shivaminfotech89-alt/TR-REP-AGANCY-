
import { useAgency, getAtPercentageForCore, getEstimateMasterForCore, getEstimateCircleRecipient, getEstimateCcText, getCircleLimitsEstimateMaster } from '../lib/AgencyContext';
import React, { useState, useEffect, useMemo } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, doc, writeBatch } from 'firebase/firestore';
import { 
  Loader2, Printer, Search, FileSpreadsheet, Edit3, Check, Save, FileText, X,
  Lock, Unlock, AlertTriangle, RotateCcw, Calendar, Send, CheckCircle2, Clock, CheckSquare,
  Eye, ArrowLeft, ArrowUpRight, Filter, IndianRupee, Scale, ShieldAlert, FileStack, Layers,
  FileCheck2, ChevronRight
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { defaultEstimateData, EstimateItem, RATING_LEVEL_OPTIONS } from '../lib/estimateData';
import { getJobFullEstimate as getJobFullEstimatePure, checkJobCircleLimit as checkJobCircleLimitPure, getScrapItemCodeForCore, isGpJob } from '../lib/estimateCalc';
import { GP_TEXT_CLASS } from '../lib/jobDisplay';
import { ExternalData } from './ExternalInspection';
import { LetterheadHeader, PrintableA4Page } from './LetterheadHeader';
import SingleJobEstimateReport from './SingleJobEstimateReport';
import { downloadHtmlAsWord } from '../lib/wordExport';
import { triggerUniversalPrint } from '../lib/printUtils';
import { paginateRows } from '../lib/pagination';
import { formatDDMMYYYY, byDateDesc, byNumericDesc } from '../lib/utils';

// Helper function to calculate item rate, quantity, and amount for any core type
export function calculateJobItemDetails(
  item: EstimateItem, 
  job: any,
  externalData?: any,
  internalData?: any
): { qty: number; qtyDisplay: string; rate: number; amt: number } {
  if (!item || !job) return { qty: 0, qtyDisplay: '0', rate: 0, amt: 0 };
  
  const kva = String(job.capacityKva || '25').trim();
  const coreType = (job.coreType || 'CRGO').trim().toUpperCase();
  const isOverhauling = coreType === 'OH' || coreType.includes('OVERHAUL');
  const isAmorphousOrWound = coreType.includes('AMORPHOUS') || coreType.includes('AM') || coreType.includes('WOUND') || coreType.includes('WC');
  const isScrapJob = job.status === 'Scrap' || job.condition === 'Scrap' || internalData?.condition === 'Scrap';

  const itemCode = (item.itemCode || '').trim();
  const itemCodeLower = itemCode.toLowerCase();
  const itemName = (item.itemName || '').toLowerCase();

  // Determine rate: Prefer rates[kva] first, fallback to item.fixedRate
  let rate = 0;
  if (item.rates && item.rates[kva as keyof typeof item.rates] !== null && item.rates[kva as keyof typeof item.rates] !== undefined) {
    rate = Number(item.rates[kva as keyof typeof item.rates]) || 0;
  } else if (item.fixedRate !== undefined && item.fixedRate !== null && !isNaN(Number(item.fixedRate)) && Number(item.fixedRate) > 0) {
    rate = Number(item.fixedRate);
  } else if (item.rates) {
    const nonNull = Object.values(item.rates).find(v => v !== null && !isNaN(Number(v)) && Number(v) > 0);
    if (nonNull) rate = Number(nonNull);
  }

  if (isOverhauling) {
    if (itemCodeLower === '7' || itemName.includes('overhauling of complete transformer') || itemName.includes('overhauling')) {
      if (!isScrapJob) {
        return { qty: 1, qtyDisplay: '1', rate, amt: rate };
      }
      return { qty: 0, qtyDisplay: '0', rate: 0, amt: 0 };
    }

    if (rate > 0 && !isScrapJob) {
      if (item.unit === 'Y') return { qty: 1, qtyDisplay: 'Y', rate, amt: rate };
      if (item.unit === 'QTY' || item.unit === 'No' || item.unit === 'Each Transformer') return { qty: 1, qtyDisplay: '1', rate, amt: rate };
      if (item.unit === 'KG') {
        const kgQty = kva === '10' || kva === '16' ? 14 : kva === '25' ? 15.54 : 45.36;
        return { qty: kgQty, qtyDisplay: kgQty.toFixed(2), rate, amt: rate * kgQty };
      }
    }

    return { qty: 0, qtyDisplay: '0', rate: 0, amt: 0 };
  }

  if (isAmorphousOrWound) {
    // Check capacity match
    const is10Kva = (itemCodeLower === '1a' || itemName.startsWith('10 kva') || itemName.includes('10kva') || itemName.includes('10 kva')) && kva === '10';
    const is16Kva = (itemCodeLower === '1b' || itemName.startsWith('16 kva') || itemName.includes('16kva') || itemName.includes('16 kva')) && kva === '16';
    const is25Kva = (itemCodeLower === '1c' || itemName.startsWith('25 kva') || itemName.includes('25kva') || itemName.includes('25 kva')) && kva === '25';

    const isVijayMake = (job.make || '').toLowerCase().includes('vijay');
    const is63KvaVijay = (itemCodeLower === '1d-2' || (itemName.includes('63') && itemName.includes('vijay'))) && kva === '63' && isVijayMake;
    const is63KvaStd = (itemCodeLower === '1d-1' || (itemName.includes('63') && !itemName.includes('vijay'))) && kva === '63' && !isVijayMake;
    const is63KvaGeneric = (itemCodeLower === '1d' || (itemName.includes('63') && !itemName.includes('vijay') && !is63KvaStd)) && kva === '63';

    const is100Kva = (itemCodeLower === '1e' || itemName.startsWith('100 kva') || itemName.includes('100kva') || itemName.includes('100 kva')) && kva === '100';
    const is200Kva = (itemCodeLower === '1f' || itemName.startsWith('200 kva') || itemName.includes('200kva') || itemName.includes('200 kva')) && kva === '200';

    const isLabourCharge = itemCodeLower === '2' || itemName.includes('labour charge') || itemName.includes('labor charge');
    const isSealingScrap = itemCodeLower === '6' || itemName.includes('sealing of uneconomical') || itemName.includes('welding at six places');
    const isScrapDismantling = itemCodeLower === '0' || itemCodeLower === '1s' || itemCodeLower === '1a-scrap' || itemName.includes('inspection & dismantling') || (itemName.includes('scrap') && (itemName.includes('dismantl') || itemName.includes('inspection') || itemName.includes('charges')));

    // Default fallback rates from official UGVCL schedule if not set
    if (rate === 0) {
      if (isScrapDismantling) rate = 500;
      else if (is10Kva) rate = 4927;
      else if (is16Kva) rate = 5202;
      else if (is25Kva) rate = 8395;
      else if (is63KvaStd || is63KvaGeneric) rate = 13746;
      else if (is63KvaVijay) rate = 16746;
      else if (is100Kva) rate = 17970;
      else if (is200Kva) rate = 10148;
      else if (isLabourCharge) rate = 2345;
      else if (isSealingScrap) rate = 189;
      else if (itemCodeLower === '3' || itemCodeLower === '4') rate = 54;
      else if (itemCodeLower === '5') rate = kva === '25' ? 1057 : kva === '63' ? 1256 : kva === '100' ? 1452 : 1057;
    }

    // Scrap Dismantling Charges (Rs. 500)
    if (isScrapDismantling) {
      if (isScrapJob) {
        return { qty: 1, qtyDisplay: '1', rate: rate || 500, amt: rate || 500 };
      }
      return { qty: 0, qtyDisplay: '0', rate: 0, amt: 0 };
    }

    // Sealing of uneconomical unit (Sr. 6)
    if (isSealingScrap) {
      if (isScrapJob) {
        return { qty: 1, qtyDisplay: '1', rate: rate || 189, amt: rate || 189 };
      }
      return { qty: 0, qtyDisplay: '0', rate: 0, amt: 0 };
    }

    if (isLabourCharge) {
      if (!isScrapJob) {
        return { qty: 1, qtyDisplay: '1', rate, amt: rate };
      }
      return { qty: 0, qtyDisplay: '0', rate: 0, amt: 0 };
    }

    if (is10Kva || is16Kva || is25Kva || is63KvaVijay || is63KvaStd || is63KvaGeneric || is100Kva) {
      if (!isScrapJob) {
        return { qty: 1, qtyDisplay: '1', rate, amt: rate };
      }
      return { qty: 0, qtyDisplay: '0', rate: 0, amt: 0 };
    }

    if (is200Kva) {
      if (!isScrapJob) {
        const qty = 3;
        return { qty, qtyDisplay: '3', rate, amt: rate * qty };
      }
      return { qty: 0, qtyDisplay: '0', rate: 0, amt: 0 };
    }

    // If it's a capacity-specific winding item (e.g. 10 KVA coil evaluated for 25 KVA job), skip it
    const isAnyWindingItem = itemCodeLower.startsWith('1') || itemName.includes('winding') || itemName.includes('coil weight');
    if (isAnyWindingItem) {
      return { qty: 0, qtyDisplay: '0', rate: 0, amt: 0 };
    }

    // Additional items (like Tank replacement per KG, Radiator Set, or custom QTY items)
    if (rate > 0 && !isScrapJob) {
      if (item.unit === 'Y') return { qty: 1, qtyDisplay: 'Y', rate, amt: rate };
      if (item.unit === 'QTY' || item.unit === 'No' || item.unit === 'Job' || item.unit === 'Set' || item.unit?.toLowerCase().includes('each') || item.unit?.toLowerCase().includes('per')) {
        return { qty: 1, qtyDisplay: '1', rate, amt: rate };
      }
      if (item.unit === 'KG') {
        const kgQty = kva === '10' || kva === '16' ? 14 : kva === '25' ? 15.54 : 45.36;
        return { qty: kgQty, qtyDisplay: kgQty.toFixed(2), rate, amt: rate * kgQty };
      }
    }

    return { qty: 0, qtyDisplay: '0', rate: 0, amt: 0 };
  }

  // Standard CRGO Stacked Core - Evaluated with exact inspection data & Y/N matching
  const isDismantling = itemCodeLower === '1a' || itemName.includes('dismentaling') || itemName.includes('dismantl');

  // A scrap transformer bills exactly one flat line, resolved by the mapped scrap
  // item code for its core type (shared helper - see lib/estimateCalc.ts). The old
  // matching also caught '1a'/'dismantl', which in the CRGO schedule is Labour
  // Charge at Rs 2,061 - not the scrap charge - and code '19', which no master
  // defines. Both are retired.
  if (isScrapJob) {
    const scrapItemCode = getScrapItemCodeForCore(job.coreType || 'CRGO');
    if (scrapItemCode && itemCode === scrapItemCode) {
      return { qty: 1, qtyDisplay: '1', rate, amt: rate };
    }
    return { qty: 0, qtyDisplay: '0', rate: 0, amt: 0 };
  }

  // 1. Name Plating (16)
  if (itemCodeLower === '16' || itemName.includes('name plating')) {
    const isYes = externalData?.namePlate !== 'N' && externalData?.namePlate !== '0' && externalData?.namePlate !== '-';
    return { qty: isYes ? 1 : 0, qtyDisplay: isYes ? 'Y' : 'N', rate, amt: isYes ? rate : 0 };
  }

  // 2. Spray Painting (2b)
  if (itemCodeLower === '2b' || itemName.includes('spray paint') || itemName.includes('outside paint')) {
    const isYes = externalData?.outsidePaint !== 'N' && externalData?.outsidePaint !== '0';
    return { qty: isYes ? 1 : 0, qtyDisplay: isYes ? 'Y' : 'N', rate, amt: isYes ? rate : 0 };
  }

  // 3. Conservator Tank (4)
  if (itemCodeLower === '4' || itemName.includes('conservator tank')) {
    const qty = Number(externalData?.damCtTank) || 0;
    return { qty, qtyDisplay: qty > 0 ? qty.toString() : '0', rate, amt: qty * rate };
  }

  // 4. Radiator Replacement (21)
  if (itemCodeLower === '21' || itemName.includes('radiator')) {
    const qty = Number(externalData?.damRadNo) || 0;
    return { qty, qtyDisplay: qty > 0 ? qty.toString() : '0', rate, amt: qty * rate };
  }

  // 5. Rod Gasket (1c)
  if (itemCodeLower === '1c' || itemName.includes('rod gasket')) {
    const qty = externalData?.hvLvRod !== undefined && externalData?.hvLvRod !== '' ? Number(externalData.hvLvRod) : 7;
    return { qty, qtyDisplay: qty.toString(), rate, amt: qty * rate };
  }

  // 6. M/S Bolt Nuts (1e)
  if (itemCodeLower === '1e' || itemName.includes('bolt nuts') || itemName.includes('nute bolt')) {
    const isYes = externalData?.nuteBolt !== 'N' && externalData?.nuteBolt !== '0';
    return { qty: isYes ? 1 : 0, qtyDisplay: isYes ? 'Y' : 'N', rate, amt: isYes ? rate : 0 };
  }

  // 7. Top Cover Gasket (1b)
  if (itemCodeLower === '1b' || itemName.includes('top cover gasket')) {
    const qty = externalData?.gasket !== undefined && externalData?.gasket !== '' ? Number(externalData.gasket) : (Number(kva) >= 63 ? 3 : 1);
    return { qty, qtyDisplay: qty.toString(), rate, amt: qty * rate };
  }

  // 8. Oil Guage Glass (5)
  if (itemCodeLower === '5' || itemName.includes('oil guage') || itemName.includes('oil gauge') || itemName.includes('oil lev')) {
    const isYes = externalData?.oilLevGls !== 'N' && externalData?.oilLevGls !== '0';
    return { qty: isYes ? 1 : 0, qtyDisplay: isYes ? 'Y' : 'N', rate, amt: isYes ? rate : 0 };
  }

  // 9. Breather (6)
  if (itemCodeLower === '6' || itemName.includes('breather')) {
    const isYes = externalData?.breather !== 'N' && externalData?.breather !== '0';
    return { qty: isYes ? 1 : 0, qtyDisplay: isYes ? 'Y' : 'N', rate, amt: isYes ? rate : 0 };
  }

  // 10. HV Bushing (8)
  if (itemCodeLower === '8' || itemName.includes('hv bushing')) {
    const qty = externalData?.hvSideHvb !== undefined && externalData?.hvSideHvb !== '' ? Number(externalData.hvSideHvb) : 3;
    return { qty, qtyDisplay: qty.toString(), rate, amt: qty * rate };
  }

  // 11. HV Metal Parts (9A)
  if (itemCodeLower === '9a' || itemName.includes('hv metal')) {
    const qty = externalData?.hvSideHvm !== undefined && externalData?.hvSideHvm !== '' ? Number(externalData.hvSideHvm) : 2;
    return { qty, qtyDisplay: qty.toString(), rate, amt: qty * rate };
  }

  // 12. HV Connectors (9B)
  if (itemCodeLower === '9b' || itemName.includes('hv connector')) {
    const qty = externalData?.hvSideHvCc !== undefined && externalData?.hvSideHvCc !== '' ? Number(externalData.hvSideHvCc) : 0;
    return { qty, qtyDisplay: qty.toString(), rate, amt: qty * rate };
  }

  // 13. LV Bushing (10)
  if (itemCodeLower === '10' || itemName.includes('lv bushing')) {
    const qty = externalData?.lvSideLvb !== undefined && externalData?.lvSideLvb !== '' ? Number(externalData.lvSideLvb) : 1;
    return { qty, qtyDisplay: qty.toString(), rate, amt: qty * rate };
  }

  // 14. LV Metal Parts (11A)
  if (itemCodeLower === '11a' || itemName.includes('lv metal')) {
    const qty = externalData?.lvSideLvm !== undefined && externalData?.lvSideLvm !== '' ? Number(externalData.lvSideLvm) : 4;
    return { qty, qtyDisplay: qty.toString(), rate, amt: qty * rate };
  }

  // 15. LV Connectors (11B)
  if (itemCodeLower === '11b' || itemName.includes('lv connector')) {
    const qty = externalData?.lvSideLvCc !== undefined && externalData?.lvSideLvCc !== '' ? Number(externalData.lvSideLvCc) : 0;
    return { qty, qtyDisplay: qty.toString(), rate, amt: qty * rate };
  }

  // 16. Sealed to Bolted (17)
  if (itemCodeLower === '17' || itemName.includes('sealed to bolted')) {
    const isBolted = externalData?.sealType === 'B' || externalData?.sealType === 'Bolted' || externalData?.sealType === 'Y';
    return { qty: isBolted ? 1 : 0, qtyDisplay: isBolted ? 'Y' : 'N', rate, amt: isBolted ? rate : 0 };
  }

  // 17. Inside Painting (3)
  if (itemCodeLower === '3' || itemName.includes('inside paint')) {
    const isYes = internalData?.inPnt !== 'N' && internalData?.inPnt !== '0';
    return { qty: isYes ? 1 : 0, qtyDisplay: isYes ? 'Y' : 'N', rate, amt: isYes ? rate : 0 };
  }

  // 18. Insulating Material (1d)
  if (itemCodeLower === '1d' || itemName.includes('insulating material')) {
    const isYes = internalData?.insula !== 'N' && internalData?.insula !== '0';
    return { qty: isYes ? 1 : 0, qtyDisplay: isYes ? 'Y' : 'N', rate, amt: isYes ? rate : 0 };
  }

  // 19. Washer Ring (15)
  if (itemCodeLower === '15' || itemName.includes('washer ring')) {
    const qty = internalData?.wasring !== undefined && internalData?.wasring !== '' ? Number(internalData.wasring) : 6;
    return { qty, qtyDisplay: qty.toString(), rate, amt: qty * rate };
  }

  // 20. HV Coil (12A)
  if (itemCodeLower === '12a' || itemName.includes('hv coil') && !itemName.includes('labour')) {
    let weight = 0;
    if (internalData?.totWt && Number(internalData.totWt) > 0) {
      weight = Number(internalData.totWt);
    } else if (internalData?.wtOfCoil && internalData?.totCoil) {
      weight = Number(internalData.wtOfCoil) * Number(internalData.totCoil);
    } else {
      weight = Number(kva) === 63 ? 47.00 : (Number(kva) === 25 ? 15.54 : (Number(kva) === 100 ? 55.00 : 14.00));
    }
    return { qty: weight, qtyDisplay: weight.toFixed(2), rate, amt: weight * rate };
  }

  // 21. LV Coil (13A)
  if (itemCodeLower === '13a' || itemName.includes('lv coil') && !itemName.includes('labour') && !itemName.includes('re-insulation')) {
    let weight = 0;
    if (internalData?.totWtLv && Number(internalData.totWtLv) > 0) {
      weight = Number(internalData.totWtLv);
    }
    return { qty: weight, qtyDisplay: weight.toFixed(2), rate, amt: weight * rate };
  }

  // 22. Re-insulation LV Coil (14)
  if (itemCodeLower === '14' || itemName.includes('re-insulation')) {
    let weight = 0;
    let lvWeight = Number(internalData?.totWtLv) || 0;
    if (internalData?.lvCoilR !== 'DMG' || internalData?.lvCoilY !== 'DMG' || internalData?.lvCoilB !== 'DMG') {
      if (lvWeight === 0) {
        weight = Number(kva) === 63 ? 24.30 : (Number(kva) === 25 ? 15.54 : (Number(kva) === 100 ? 35.00 : 12.00));
      }
    }
    return { qty: weight, qtyDisplay: weight.toFixed(2), rate, amt: weight * rate };
  }

  // 23. Labour Charge (1a)
  if (isDismantling) {
    return { qty: 1, qtyDisplay: '1', rate, amt: rate };
  }

  // 24. Cleaning dirty tank (2a)
  if (itemCodeLower === '2a' || itemName.includes('cleaning dirty')) {
    const isYes = externalData?.clnDrtyTank !== 'N' && externalData?.clnDrtyTank !== '0';
    return { qty: isYes ? 1 : 0, qtyDisplay: isYes ? 'Y' : 'N', rate, amt: isYes ? rate : 0 };
  }

  // 25. Drying of active parts (1f)
  if (itemCodeLower === '1f' || itemName.includes('drying of active')) {
    const isYes = internalData?.dc !== 'N' && internalData?.dc !== '0' && externalData?.dryActPart !== 'N';
    return { qty: isYes ? 1 : 0, qtyDisplay: isYes ? 'Y' : 'N', rate, amt: isYes ? rate : 0 };
  }

  // 26. Testing Charge (20)
  if (itemCodeLower === '20' || itemName.includes('testing charge')) {
    const isYes = internalData?.tstTrn !== 'N' && internalData?.tstTrn !== '0';
    return { qty: isYes ? 1 : 0, qtyDisplay: isYes ? 'Y' : 'N', rate, amt: isYes ? rate : 0 };
  }

  // 27. Labour HV Coil (12C)
  if (itemCodeLower === '12c' || (itemName.includes('labour') && itemName.includes('hv coil'))) {
    let weight = 0;
    if (internalData?.totWt && Number(internalData.totWt) > 0) {
      weight = Number(internalData.totWt);
    } else if (internalData?.wtOfCoil && internalData?.totCoil) {
      weight = Number(internalData.wtOfCoil) * Number(internalData.totCoil);
    } else {
      weight = Number(kva) === 63 ? 47.00 : (Number(kva) === 25 ? 15.54 : (Number(kva) === 100 ? 55.00 : 14.00));
    }
    return { qty: weight, qtyDisplay: weight.toFixed(2), rate, amt: weight * rate };
  }

  // 28. Labour LV Coil (13C)
  if (itemCodeLower === '13c' || (itemName.includes('labour') && itemName.includes('lv coil'))) {
    let weight = 0;
    if (internalData?.totWtLv && Number(internalData.totWtLv) > 0) {
      weight = Number(internalData.totWtLv);
    }
    return { qty: weight, qtyDisplay: weight.toFixed(2), rate, amt: weight * rate };
  }

  // Fallback for custom or unmapped items
  if (rate > 0) {
    if (item.unit === 'Y') return { qty: 1, qtyDisplay: 'Y', rate, amt: rate };
    if (item.unit === 'N') return { qty: 0, qtyDisplay: 'N', rate, amt: 0 };
    if (item.unit === 'QTY' || item.unit === 'No' || item.unit === 'Job' || item.unit === 'Set') {
      return { qty: 1, qtyDisplay: '1', rate, amt: rate };
    }
    if (item.unit === 'KG') {
      const kgQty = kva === '10' || kva === '16' ? 14 : kva === '25' ? 15.54 : 45.36;
      return { qty: kgQty, qtyDisplay: kgQty.toFixed(2), rate, amt: rate * kgQty };
    }
  }

  return { qty: 0, qtyDisplay: '0', rate: 0, amt: 0 };
}

// Forwarding-letter job table pagination: fewer rows on page 1 since the recipient/ref
// block eats vertical space; more room on continuation pages.
const ROWS_FIRST_PAGE = 14;
const ROWS_PER_PAGE = 22;

export default function EstimateGenerate() {
  const { activeAgency, activeAtMaster, updateAgency } = useAgency();
  const [jobs, setJobs] = useState<any[]>([]);
  const [inspections, setInspections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Tab state: 'generator' | 'sent' | 'approvals'
  const [activeTab, setActiveTab] = useState<'generator' | 'sent' | 'approvals'>('generator');

  // Estimate view modes: 'batch_all' (Default official common forwarding letter + separate job estimates) | 'forwarding_only' | 'single_job' | 'matrix'
  const [estimateViewMode, setEstimateViewMode] = useState<'batch_all' | 'forwarding_only' | 'single_job' | 'matrix'>('batch_all');
  const [activeSingleJobId, setActiveSingleJobId] = useState<string | null>(null);

  const [selectedMrNo, setSelectedMrNo] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDivision, setSelectedDivision] = useState<string>('All');
  const [savingEstimateDates, setSavingEstimateDates] = useState(false);
  const [savedSuccessMsg, setSavedSuccessMsg] = useState('');

  // Send Estimate Modal State
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendTargetMr, setSendTargetMr] = useState<string>('');
  const [sendRefNo, setSendRefNo] = useState('');
  const [sendDate, setSendDate] = useState(new Date().toISOString().split('T')[0]);
  const [sendRemarks, setSendRemarks] = useState('');
  const [submittingSend, setSubmittingSend] = useState(false);

  // Approval Received Modal State
  const [showApprModal, setShowApprModal] = useState(false);
  const [apprTargetMr, setApprTargetMr] = useState<string>('');
  const [apprNo, setApprNo] = useState('');
  const [apprDate, setApprDate] = useState(new Date().toISOString().split('T')[0]);
  const [apprAmount, setApprAmount] = useState<number | string>('');
  const [apprRemarks, setApprRemarks] = useState('');
  const [submittingAppr, setSubmittingAppr] = useState(false);

  // Sent Estimates List Filters
  const [sentSearchQuery, setSentSearchQuery] = useState('');
  const [sentFilterDivision, setSentFilterDivision] = useState<string>('All');

  // Received Approvals List Filters
  const [apprSearchQuery, setApprSearchQuery] = useState('');
  const [apprFilterDivision, setApprFilterDivision] = useState<string>('All');

  // Customizable Forwarding Letter Fields
  const [forwardingTo, setForwardingTo] = useState('');
  const [forwardingSub, setForwardingSub] = useState('');
  const [forwardingCc, setForwardingCc] = useState('');
  const [refNoText, setRefNoText] = useState('');
  const [letterDateText, setLetterDateText] = useState('');
  const [refBodyText, setRefBodyText] = useState('');
  const [closingText, setClosingText] = useState('');
  const [signedByText, setSignedByText] = useState('');
  
  const [showEditModal, setShowEditModal] = useState(false);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [isCcLocked, setIsCcLocked] = useState(true);
  const [showCcUnlockModal, setShowCcUnlockModal] = useState(false);

  // Derive current division for selected MR
  const currentSelectedDivision = useMemo(() => {
    if (!selectedMrNo) return activeAgency?.circleOfficeName || 'SABARMATI';
    const mrJobs = jobs.filter(j => j.mrNo === selectedMrNo);
    return mrJobs[0]?.division || activeAgency?.circleOfficeName || 'SABARMATI';
  }, [jobs, selectedMrNo, activeAgency]);

  // Sync letter fields whenever activeAgency or selectedMrNo changes
  useEffect(() => {
    if (activeAgency) {
      setForwardingTo(getEstimateCircleRecipient(activeAgency, currentSelectedDivision));
      setForwardingSub(activeAgency.forwardingSubject || 'Submiting Inspection Report & Estimate of Transformer');
      setForwardingCc(getEstimateCcText(activeAgency, currentSelectedDivision));
      setSignedByText(`For, ${activeAgency.name || ''}`);
    }
  }, [activeAgency, currentSelectedDivision]);

  useEffect(() => {
    const todayStr = formatDDMMYYYY(new Date());
    setLetterDateText(todayStr);
    const discomPrefix = activeAgency?.discomName ? activeAgency.discomName.split(' ')[0].toUpperCase() : 'EST';
    setRefNoText(`${discomPrefix}/EE-T-1/TRANS-REP/${selectedMrNo || '001'}`);
    setRefBodyText(`With reference to the abvoe subject , we are submitting you inspection reports and estimates of following transformers received from ${currentSelectedDivision}`);
    setClosingText('We Request you to send the approval of above transformers earliest as possible.');
  }, [selectedMrNo, currentSelectedDivision, activeAgency]);

  useEffect(() => {
    async function fetchData() {
      if (!auth.currentUser || !activeAgency) { setLoading(false); return; }
      try {
        const jobsQ = query(
          collection(db, 'jobs'),
          where('ownerId', '==', auth.currentUser.uid), 
          where('agencyId', '==', activeAgency.id)
        );
        // Inspection records carry no agencyId (neither save path has ever written
        // one), so filtering on it here matched nothing and this screen silently
        // priced every estimate off capacity-based defaults instead of the real
        // inspection. Scope by owner in the query, then by agency in memory via the
        // job the record belongs to - the same way InternalInspection does it.
        const inspQ = query(
          collection(db, 'inspections'),
          where('ownerId', '==', auth.currentUser.uid)
        );

        const [jobsSnapshot, inspSnapshot] = await Promise.all([
          getDocs(jobsQ),
          getDocs(inspQ)
        ]);

        const fetchedJobs = jobsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        const agencyJobIds = new Set(fetchedJobs.map(j => j.id));
        const fetchedInspections = inspSnapshot.docs
          .map(d => ({ id: d.id, ...d.data() } as any))
          .filter(i => i.jobId && agencyJobIds.has(i.jobId));

        setJobs(fetchedJobs);
        setInspections(fetchedInspections);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'jobs');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [activeAgency]);

  // Inspection lookup maps
  const externalInspMap = useMemo(() => {
    const map: Record<string, any> = {};
    inspections.filter(i => (i.type || '').toLowerCase() === 'external').forEach(i => {
      if (i.jobId) map[i.jobId] = i.data || i;
    });
    return map;
  }, [inspections]);

  const internalInspMap = useMemo(() => {
    const map: Record<string, any> = {};
    inspections.filter(i => (i.type || '').toLowerCase() === 'internal').forEach(i => {
      if (i.jobId) map[i.jobId] = i.data || i;
    });
    return map;
  }, [inspections]);

  const mrGroups = useMemo(() => {
    const groups: Record<string, any[]> = {};
    jobs.forEach(j => {
      if (!j.mrNo) return;
      if (!groups[j.mrNo]) groups[j.mrNo] = [];
      groups[j.mrNo].push(j);
    });
    return groups;
  }, [jobs]);

  const divisions = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach(j => {
      if (j.division) set.add(j.division);
    });
    return Array.from(set).sort();
  }, [jobs]);

  // A GP repair within the guarantee period is free of cost - the agency redoes the
  // work at its own expense. GP jobs therefore produce NO estimate: excluded from job
  // selection, from the forwarding letter's table and from its TOTAL.
  //
  // Keyed on repairType/isGp, NOT gpSource: gpSource only exists on jobs saved since it
  // was added, so keying off it would leave every pre-existing GP job billable.
  const selectedJobsData = useMemo(() => {
    if (!selectedMrNo) return [];
    return jobs
      .filter(j => j.mrNo === selectedMrNo)
      .filter(j => !isGpJob(j))
      .sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));
  }, [jobs, selectedMrNo]);

  /** GP jobs in the selected MR - excluded from the estimate, but counted so the
   *  operator can see the numbers reconcile rather than silently not adding up (1e). */
  const selectedMrGpJobs = useMemo(() => {
    if (!selectedMrNo) return [];
    return jobs.filter(j => j.mrNo === selectedMrNo && isGpJob(j));
  }, [jobs, selectedMrNo]);
  
  // Unsent MRs count (Stage 1)
  const unsentMrCount = useMemo(() => {
    return Object.keys(mrGroups).filter(mr => {
      const groupJobs = mrGroups[mr] || [];
      const isSent = groupJobs.some(j => j.estimateSentDate || j.estimateStatus === 'Sent' || j.estimateRefNo);
      return !isSent;
    }).length;
  }, [mrGroups]);

  // Stage 1: Only show unsent MRs

  /** MR date for sorting: the date of issue recorded on the MR's jobs. MR NUMBERS ARE
   *  NOT CHRONOLOGICAL (MR 9344 predates MR 1563; MR 1 sits among five-digit numbers),
   *  so sorting by number would not be newest-first. Number is the tiebreak only. */
  const mrSortDate = (mr: string): string => {
    const g = mrGroups[mr] || [];
    for (const j of g) {
      const d = j.dateOfIssue || j.mrDate || '';
      if (d) return d;
    }
    return '';
  };

  const filteredMrNos = useMemo(() => {
    return Object.keys(mrGroups).filter(mr => {
      const groupJobs = mrGroups[mr] || [];
      // Remove from Estimate Generator if already sent
      const isSent = groupJobs.some(j => j.estimateSentDate || j.estimateStatus === 'Sent' || j.estimateRefNo);
      if (isSent) return false;

      const matchesSearch = !searchQuery || mr.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesDivision = selectedDivision === 'All' || groupJobs.some(j => j.division === selectedDivision);
      return matchesSearch && matchesDivision;
    }).sort(byDateDesc(mr => mrSortDate(mr), byNumericDesc(mr => mr)));
  }, [mrGroups, searchQuery, selectedDivision]);

  const handlePrint = () => {
    if (selectedMrNo) {
      triggerUniversalPrint('printable-estimate-container', `Estimate Report & Forwarding Letter - MR ${selectedMrNo}`, `Estimate_MR_${selectedMrNo}.pdf`);
    } else {
      triggerUniversalPrint('printable-estimate-container', 'Estimate Report', 'Estimate_Report.pdf');
    }
  };

  const handleExportExcel = () => {
    if (!selectedMrNo || selectedJobsData.length === 0) return;

    const wsData: any[][] = [];
    wsData.push([`ESTIMATE REPORT - MR NO: ${selectedMrNo}`]);
    wsData.push([`Division: ${selectedJobsData[0]?.division || 'SABARMATI'}`, `Date: ${dateString}`]);
    wsData.push([]);

    // Header row
    const headerRow = ['SR.', 'ITEM DESCRIPTION', ...selectedJobsData.map(j => `JOB ${j.jobNo} (${j.capacityKva} KVA)`)];
    wsData.push(headerRow);

    // Items
    const itemsList = selectedJobsData.length > 0 
      ? getEstimateMasterForCore(activeAgency, selectedJobsData[0].coreType)
      : (activeAgency?.estimateMaster?.length > 0 ? activeAgency.estimateMaster : defaultEstimateData);

    itemsList.forEach((item) => {
      const row = [item.itemCode, item.itemName];
      selectedJobsData.forEach((job) => {
        const jobMasterData = getEstimateMasterForCore(activeAgency, job.coreType);
        const itemForJob = jobMasterData.find(m => m.itemCode === item.itemCode || m.itemName === item.itemName) || item;
        const { amt } = calculateJobItemDetails(itemForJob, job);
        row.push(amt.toFixed(2));
      });
      wsData.push(row);
    });

    // Totals
    const baseTotalsRow = ['-', 'BASE REPAIR COST'];
    selectedJobsData.forEach(job => {
      baseTotalsRow.push(calculateJobTotal(job).toFixed(2));
    });
    wsData.push(baseTotalsRow);

    const riseTotalsRow = ['-', 'AT % RISE / FALL TOTAL'];
    selectedJobsData.forEach(job => {
      const atPct = getAtPercentageForCore(activeAtMaster, job.coreType);
      const baseTot = calculateJobTotal(job);
      const riseAmt = baseTot * (atPct / 100);
      riseTotalsRow.push(riseAmt.toFixed(2));
    });
    wsData.push(riseTotalsRow);

    const grandTotalsRow = ['-', 'GRAND TOTAL'];
    selectedJobsData.forEach(job => {
      const atPct = getAtPercentageForCore(activeAtMaster, job.coreType);
      const baseTot = calculateJobTotal(job);
      const grandTot = baseTot * (1 + atPct / 100);
      grandTotalsRow.push(grandTot.toFixed(2));
    });
    wsData.push(grandTotalsRow);

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Estimate");
    XLSX.writeFile(wb, `Estimate_Report_MR_${selectedMrNo}.xlsx`);
  };

  const handleSaveEstimateDates = async () => {
    if (!selectedMrNo || selectedJobsData.length === 0 || !auth.currentUser) return;
    setSavingEstimateDates(true);
    setSavedSuccessMsg('');
    try {
      const batch = writeBatch(db);
      const todayIso = new Date().toISOString().split('T')[0];

      selectedJobsData.forEach(job => {
        const baseTot = calculateJobTotal(job);
        const atPct = getAtPercentageForCore(activeAtMaster, job.coreType);
        const grandTot = Math.round(baseTot * (1 + atPct / 100));

        const jobRef = doc(db, 'jobs', job.id);
        batch.update(jobRef, {
          estimateSentDate: todayIso,
          estimateRefNo: refNoText || `UGVCL/EST/${selectedMrNo}`,
          estimateAmount: grandTot,
          updatedAt: new Date().toISOString()
        });
      });

      await batch.commit();

      // Update local state
      setJobs(prev => prev.map(j => {
        if (j.mrNo === selectedMrNo) {
          const baseTot = calculateJobTotal(j);
          const atPct = getAtPercentageForCore(activeAtMaster, j.coreType);
          const grandTot = Math.round(baseTot * (1 + atPct / 100));
          return {
            ...j,
            estimateSentDate: todayIso,
            estimateRefNo: refNoText || `UGVCL/EST/${selectedMrNo}`,
            estimateAmount: grandTot
          };
        }
        return j;
      }));

      setSavedSuccessMsg('Estimate Sent Date & Ref No saved to all jobs in this MR!');
      setTimeout(() => setSavedSuccessMsg(''), 4000);
    } catch (err: any) {
      console.error(err);
      alert('Error saving estimate dates: ' + (err.message || err.toString()));
    } finally {
      setSavingEstimateDates(false);
    }
  };

  const today = new Date();
  const dateString = formatDDMMYYYY(today);

  // Thin wrappers over the pure calculators in lib/estimateCalc.ts, supplying this
  // screen's own state (inspection maps, agency, AT master) so every existing call
  // site below can keep calling these with just a job.
  const getJobFullEstimate = (job: any) => {
    const ext = externalInspMap[job.id];
    const int = internalInspMap[job.id];
    return getJobFullEstimatePure(job, ext, int, activeAgency, activeAtMaster);
  };

  const calculateJobTotal = (job: any) => {
    const est = getJobFullEstimate(job);
    return est.baseTotal;
  };

  // Helper to evaluate a job against Clause 4.0 Circle Estimate Power Limit
  const checkJobCircleLimit = (job: any) => {
    const ext = externalInspMap[job.id];
    const int = internalInspMap[job.id];
    const circleMaster = getCircleLimitsEstimateMaster(activeAgency);
    return checkJobCircleLimitPure(job, ext, int, activeAgency, activeAtMaster, circleMaster);
  };

  /** Jobs of an MR that actually get estimated - GP carries no charge (see isGpJob). */
  const estimableJobs = (mr: string) => (mrGroups[mr] || []).filter(j => !isGpJob(j));

  const mrHasExceededCircleLimit = (mr: string) => {
    return estimableJobs(mr).some(j => checkJobCircleLimit(j).exceeds);
  };

  const handleUpdateJobRating = async (jobId: string, newRating: string) => {
    setJobs(prev => prev.map(j => (j.id === jobId ? { ...j, starRating: newRating, ratingLevel: newRating } : j)));
    try {
      const jobRef = doc(db, 'jobs', jobId);
      const batch = writeBatch(db);
      batch.update(jobRef, {
        starRating: newRating,
        ratingLevel: newRating,
        updatedAt: new Date().toISOString()
      });
      await batch.commit();
    } catch (e) {
      console.error('Failed to update job rating in Firestore:', e);
    }
  };

  const exceedingJobsInSelectedMr = useMemo(() => {
    return selectedJobsData
      .map(job => ({ job, check: checkJobCircleLimit(job) }))
      .filter(item => item.check.exceeds);
  }, [selectedJobsData, activeAgency, activeAtMaster, externalInspMap, internalInspMap]);

  // GP jobs are excluded from the TOTAL as well as from the table - they must not
  // appear as a zero line, and must not be dropped from a table while still counting
  // toward the sum.
  const calculateMrEstimateTotal = (mr: string) => {
    let total = 0;
    estimableJobs(mr).forEach(job => {
      total += getJobFullEstimate(job).finalAmount;
    });
    return Math.round(total);
  };

  // Open Send Estimate Modal
  const handleOpenSendModal = (mr: string) => {
    setSendTargetMr(mr);
    const mrJobs = mrGroups[mr] || [];
    const div = mrJobs[0]?.division || currentSelectedDivision;
    setSendRefNo(`UGVCL/EE-T-1/TRANS-REP/${mr}`);
    setSendDate(new Date().toISOString().split('T')[0]);
    setSendRemarks('');
    setShowSendModal(true);
  };

  // Confirm Sending Estimate
  const handleConfirmSendEstimate = async () => {
    if (!sendTargetMr || !sendRefNo.trim() || !sendDate || !auth.currentUser) {
      alert('Please enter both Reference No and Send Date');
      return;
    }
    setSubmittingSend(true);
    try {
      const targetJobs = mrGroups[sendTargetMr] || [];
      const batch = writeBatch(db);

      targetJobs.forEach(job => {
        const est = getJobFullEstimate(job);
        const grandTot = Math.round(est.finalAmount);

        const jobRef = doc(db, 'jobs', job.id);
        batch.update(jobRef, {
          estimateSentDate: sendDate,
          estimateRefNo: sendRefNo.trim(),
          estimateAmount: grandTot,
          estimateStatus: 'Sent',
          estimateApprovalStatus: job.approvalNo ? 'Approved' : (job.estimateApprovalStatus || 'Pending'),
          estimateRemarks: sendRemarks || '',
          updatedAt: new Date().toISOString()
        });
      });

      await batch.commit();

      // Update local state
      setJobs(prev => prev.map(j => {
        if (j.mrNo === sendTargetMr) {
          const est = getJobFullEstimate(j);
          const grandTot = Math.round(est.finalAmount);
          return {
            ...j,
            estimateSentDate: sendDate,
            estimateRefNo: sendRefNo.trim(),
            estimateAmount: grandTot,
            estimateStatus: 'Sent',
            estimateApprovalStatus: j.approvalNo ? 'Approved' : (j.estimateApprovalStatus || 'Pending'),
            estimateRemarks: sendRemarks || ''
          };
        }
        return j;
      }));

      setShowSendModal(false);
      setSavedSuccessMsg(`Estimate for MR ${sendTargetMr} successfully marked as Sent with Ref: ${sendRefNo}!`);
      setTimeout(() => setSavedSuccessMsg(''), 5000);
    } catch (err: any) {
      console.error('Error sending estimate:', err);
      alert('Failed to send estimate: ' + (err.message || err.toString()));
    } finally {
      setSubmittingSend(false);
    }
  };

  // Open Approval Received Modal
  const handleOpenApprModal = (mr: string) => {
    setApprTargetMr(mr);
    const mrJobs = mrGroups[mr] || [];
    const sample = mrJobs[0] || {};
    const totalEstAmt = calculateMrEstimateTotal(mr);
    setApprNo(sample.approvalNo || `UGVCL/SE-TR/APPR/${new Date().getFullYear()}/${mr}`);
    setApprDate(sample.approvalDate || new Date().toISOString().split('T')[0]);
    setApprAmount(sample.approvedAmount || totalEstAmt);
    setApprRemarks(sample.approvalRemarks || '');
    setShowApprModal(true);
  };

  // Confirm Approval Received
  const handleConfirmApproval = async () => {
    if (!apprTargetMr || !apprNo.trim() || !apprDate || !auth.currentUser) {
      alert('Please enter Approval Number and Approval Date');
      return;
    }
    setSubmittingAppr(true);
    try {
      const targetJobs = mrGroups[apprTargetMr] || [];
      const batch = writeBatch(db);

      targetJobs.forEach(job => {
        const jobRef = doc(db, 'jobs', job.id);
        batch.update(jobRef, {
          approvalNo: apprNo.trim(),
          approvalDate: apprDate,
          approvedAmount: Number(apprAmount) || 0,
          estimateApprovalStatus: 'Approved',
          approvalRemarks: apprRemarks || '',
          updatedAt: new Date().toISOString()
        });
      });

      await batch.commit();

      // Update local state
      setJobs(prev => prev.map(j => {
        if (j.mrNo === apprTargetMr) {
          return {
            ...j,
            approvalNo: apprNo.trim(),
            approvalDate: apprDate,
            approvedAmount: Number(apprAmount) || 0,
            estimateApprovalStatus: 'Approved',
            approvalRemarks: apprRemarks || ''
          };
        }
        return j;
      }));

      setShowApprModal(false);
      setSavedSuccessMsg(`Approval for MR ${apprTargetMr} marked successfully (Appr No: ${apprNo})!`);
      setTimeout(() => setSavedSuccessMsg(''), 5000);
    } catch (err: any) {
      console.error('Error saving approval:', err);
      alert('Failed to save approval: ' + (err.message || err.toString()));
    } finally {
      setSubmittingAppr(false);
    }
  };

  // Sent Estimates List (Awaiting Approval)
  const sentEstimatesList = useMemo(() => {
    const list: Array<{
      mrNo: string;
      mrDate: string;
      division: string;
      jobCount: number;
      estimateRefNo: string;
      estimateSentDate: string;
      estimateAmount: number;
      isApproved: boolean;
      approvalNo: string;
      approvalDate: string;
      approvedAmount: number;
      approvalRemarks?: string;
    }> = [];

    Object.keys(mrGroups).forEach(mr => {
      const groupJobs = mrGroups[mr] || [];
      // Sent if estimateSentDate or estimateStatus === 'Sent' or estimateRefNo
      const isSent = groupJobs.some(j => j.estimateSentDate || j.estimateStatus === 'Sent' || j.estimateRefNo);
      const isApproved = groupJobs.some(j => !!j.approvalNo || j.estimateApprovalStatus === 'Approved');
      
      if (isSent && !isApproved) {
        const sample = groupJobs[0] || {};
        const estAmount = calculateMrEstimateTotal(mr);
        list.push({
          mrNo: mr,
          mrDate: sample.dateOfIssue || sample.mrDate || '-',
          division: sample.division || 'SABARMATI',
          jobCount: groupJobs.length,
          estimateRefNo: sample.estimateRefNo || `UGVCL/EST/${mr}`,
          estimateSentDate: sample.estimateSentDate || '-',
          estimateAmount: estAmount,
          isApproved: false,
          approvalNo: '',
          approvalDate: '',
          approvedAmount: 0,
          approvalRemarks: sample.approvalRemarks || ''
        });
      }
    });

    return [...list].sort(byDateDesc(x => x.estimateSentDate, byNumericDesc(x => x.mrNo)));
  }, [mrGroups, activeAtMaster, activeAgency]);

  // Received Approvals List
  const approvedEstimatesList = useMemo(() => {
    const list: Array<{
      mrNo: string;
      mrDate: string;
      division: string;
      jobCount: number;
      estimateRefNo: string;
      estimateSentDate: string;
      estimateAmount: number;
      approvalNo: string;
      approvalDate: string;
      approvedAmount: number;
      approvalRemarks?: string;
    }> = [];

    Object.keys(mrGroups).forEach(mr => {
      const groupJobs = mrGroups[mr] || [];
      const isApproved = groupJobs.some(j => !!j.approvalNo || j.estimateApprovalStatus === 'Approved');
      if (isApproved) {
        const sample = groupJobs[0] || {};
        const estAmount = calculateMrEstimateTotal(mr);
        list.push({
          mrNo: mr,
          mrDate: sample.dateOfIssue || sample.mrDate || '-',
          division: sample.division || 'SABARMATI',
          jobCount: groupJobs.length,
          estimateRefNo: sample.estimateRefNo || `UGVCL/EST/${mr}`,
          estimateSentDate: sample.estimateSentDate || '-',
          estimateAmount: estAmount,
          approvalNo: sample.approvalNo || `UGVCL/APPR/${mr}`,
          approvalDate: sample.approvalDate || sample.estimateSentDate || '-',
          approvedAmount: Number(sample.approvedAmount) || estAmount,
          approvalRemarks: sample.approvalRemarks || ''
        });
      }
    });

    return [...list].sort(byDateDesc(x => x.approvalDate, byNumericDesc(x => x.mrNo)));
  }, [mrGroups, activeAtMaster, activeAgency]);

  // Filtered Sent Estimates List (Uses Universal Filters)
  const filteredSentEstimates = useMemo(() => {
    return sentEstimatesList.filter(item => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || 
        item.mrNo.toLowerCase().includes(q) ||
        item.estimateRefNo.toLowerCase().includes(q) ||
        item.division.toLowerCase().includes(q);
      
      const matchesDivision = selectedDivision === 'All' || item.division === selectedDivision;

      return matchesSearch && matchesDivision;
    });
  }, [sentEstimatesList, searchQuery, selectedDivision]);

  // Filtered Approved Estimates List (Uses Universal Filters)
  const filteredApprovedEstimates = useMemo(() => {
    return approvedEstimatesList.filter(item => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || 
        item.mrNo.toLowerCase().includes(q) ||
        item.estimateRefNo.toLowerCase().includes(q) ||
        item.approvalNo.toLowerCase().includes(q) ||
        item.division.toLowerCase().includes(q);
      
      const matchesDivision = selectedDivision === 'All' || item.division === selectedDivision;

      return matchesSearch && matchesDivision;
    });
  }, [approvedEstimatesList, searchQuery, selectedDivision]);

  // Summary Stats
  const sentStats = useMemo(() => {
    const pendingCount = sentEstimatesList.length;
    const pendingValue = sentEstimatesList.reduce((sum, item) => sum + item.estimateAmount, 0);
    const approvedCount = approvedEstimatesList.length;
    const approvedValue = approvedEstimatesList.reduce((sum, item) => sum + (item.approvedAmount || item.estimateAmount), 0);
    const totalCount = pendingCount + approvedCount;
    const totalValue = pendingValue + approvedValue;

    return {
      totalCount,
      totalValue,
      approvedCount,
      approvedValue,
      pendingCount,
      pendingValue
    };
  }, [sentEstimatesList, approvedEstimatesList]);

  // Common Forwarding Letter (used by both 'batch_all' and 'forwarding_only' view modes),
  // paginated so the job table never overflows a single A4 page on large MRs.
  const renderForwardingLetterPages = () => {
    const jobRows = selectedJobsData.map((job, idx) => ({ job, idx }));
    const pages = paginateRows(jobRows, ROWS_FIRST_PAGE, ROWS_PER_PAGE);
    const totalPages = pages.length;
    const grandTotal = selectedJobsData.reduce((acc, job) => acc + getJobFullEstimate(job).finalAmount, 0);

    return pages.map((rows, pageIdx) => {
      const isFirst = pageIdx === 0;
      const isLast = pageIdx === totalPages - 1;

      return (
        <PrintableA4Page key={pageIdx} agency={activeAgency} documentTitle="FORWARDING LETTER">
          <div className="flex flex-col justify-between h-full text-black">
            <div>
              {isFirst && (
                <>
                  <div className="flex justify-between text-xs font-bold mb-4">
                    <div className="whitespace-pre-wrap">
                      {forwardingTo || `Superintending Engineer (O & M),
Uttar Gujarat Vij Company Ltd.,
Circle Office : ${currentSelectedDivision || 'SABARMATI'}`}
                    </div>
                    <div className="text-right whitespace-pre-wrap">
                      <p>REF. NO. : {refNoText}</p>
                      <p className="mt-1">DATE : {letterDateText}</p>
                    </div>
                  </div>

                  <div className="text-xs font-bold text-center underline underline-offset-2 mb-4">
                    Sub. : {forwardingSub || 'Submiting Inspection Report & Estimate of Transformer'}
                  </div>

                  <p className="text-xs mb-2">Dear Sir,</p>
                  <p className="text-xs mb-4 leading-relaxed ml-4 whitespace-pre-wrap">
                    {refBodyText}
                  </p>
                </>
              )}

              <table className="w-full text-center text-xs border-collapse border border-black mb-4">
                <thead>
                  <tr className="font-bold border-b border-black bg-slate-100 print:bg-white">
                    <th className="p-1 border-r border-black">NO.</th>
                    <th className="p-1 border-r border-black">JOB. NO.</th>
                    <th className="p-1 border-r border-black">T.R. MAKE</th>
                    <th className="p-1 border-r border-black">TR. SR. NO.</th>
                    <th className="p-1 border-r border-black">KVA</th>
                    <th className="p-1 border-r border-black">KV</th>
                    <th className="p-1 border-r border-black">TYPE</th>
                    <th className="p-1 border-r border-black">OGP/GP</th>
                    <th className="p-1 border-r border-black">EST. AMT.</th>
                    <th className="p-1">REMARK</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ job, idx }) => {
                    const est = getJobFullEstimate(job);
                    const finalAmt = est.finalAmount.toFixed(2);
                    const isScrapJob = job.status === 'Scrap' || job.condition === 'Scrap';
                    const check = checkJobCircleLimit(job);

                    return (
                      <tr key={job.id} className="border-b border-black">
                        <td className="p-1 border-r border-black">{idx + 1}</td>
                        <td className="p-1 border-r border-black font-mono font-bold">{job.jobNo}</td>
                        <td className="p-1 border-r border-black">{job.make}</td>
                        <td className="p-1 border-r border-black font-mono">{job.serialNo}</td>
                        <td className="p-1 border-r border-black font-bold">{job.capacityKva}</td>
                        <td className="p-1 border-r border-black">11</td>
                        <td className="p-1 border-r border-black">{job.coreType || 'CRGO'}</td>
                        <td className="p-1 border-r border-black">{job.repairType || 'OGP'}</td>
                        <td className="p-1 border-r border-black text-right font-mono font-bold">{finalAmt}</td>
                        <td className="p-1 text-center text-[9px] font-bold whitespace-nowrap">
                          {isScrapJob ? (
                            'SCRAP'
                          ) : check.exceeds ? (
                            <span className="text-rose-900 font-bold" title={`Exceeds SE Circle Limit ₹${check.limit.toFixed(0)} by ₹${check.diff.toFixed(0)}`}>
                              REPAIRABLE <span className="text-[7.5px] block text-rose-700 font-black">(&gt; CIRCLE LIMIT)</span>
                            </span>
                          ) : (
                            'REPAIRABLE'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {isLast && (
                    <tr className="font-bold border-black">
                      <td colSpan={8} className="p-1 border-r border-black text-right">TOTAL</td>
                      <td className="p-1 border-r border-black text-right font-mono font-bold">{grandTotal.toFixed(2)}</td>
                      <td></td>
                    </tr>
                  )}
                </tbody>
              </table>

              {isLast && <p className="text-xs mb-4 whitespace-pre-wrap">{closingText}</p>}

              {!isLast && (
                <p className="text-right text-xs italic mt-2">Continued on page {pageIdx + 2}…</p>
              )}
            </div>

            {isLast && (
              <div>
                <div className="flex justify-between text-xs mb-6">
                  <p>Thanking you</p>
                  <p>Yours faithfully</p>
                </div>

                <div className="flex justify-between text-xs mb-4">
                  <p>Encl. : 1. Inspection Reports (Internal &amp; External) &nbsp;&bull;&nbsp; 2. Detailed Job-wise Estimates</p>
                  <div className="text-center">
                    <p className="mb-6 font-bold">{signedByText}</p>
                    <p className="text-[10px] text-slate-500">Auth Sign.</p>
                  </div>
                </div>

                <div className="text-xs font-bold">
                  <p className="mb-1">C . C. to :</p>
                  <p className="whitespace-pre-wrap font-normal text-[11px]">{forwardingCc || `E. E. (O & M) DIVISION - ${currentSelectedDivision || 'SABARMATI'}`}</p>
                </div>
              </div>
            )}
          </div>

          {activeAgency?.showPageNumbers !== false && (
            <footer className="a4-page-footer">
              Page {pageIdx + 1} of {totalPages}
            </footer>
          )}
        </PrintableA4Page>
      );
    });
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="max-w-6xl mx-auto print:max-w-none print:w-full print:m-0 print:p-0">
      
      {/* Universal Top Filter Bar & Stage Lifecycle Navigation (Hidden during print) */}
      {!selectedMrNo ? (
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-4 sm:p-5 mb-5 space-y-4 print:hidden">
          {/* Header Title & Universal Filters */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-base sm:text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600 shrink-0" />
                <span>Estimate & Approval Lifecycle</span>
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Stage 1: Generate & Send &rarr; Stage 2: Sent Awaiting Sanction &rarr; Stage 3: Approved
              </p>
            </div>

            {/* Universal Filters (Applies across all 3 tabs) */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full md:w-auto">
              <div className="relative flex-1 sm:w-60">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search MR No, Ref, Order..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full bg-white outline-none"
                />
              </div>

              <div className="w-full sm:w-44">
                <select
                  value={selectedDivision}
                  onChange={(e) => setSelectedDivision(e.target.value)}
                  className="py-2 px-3 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full bg-white text-slate-700 font-medium outline-none cursor-pointer"
                >
                  <option value="All">All Divisions</option>
                  {divisions.map(div => (
                    <option key={div} value={div}>{div} Division</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Stage Tabs (Positioned BELOW the Universal Filters) */}
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
            <button
              onClick={() => { setActiveTab('generator'); }}
              className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
                activeTab === 'generator'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>1. Estimate Generator</span>
              <span className={`ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-black ${
                activeTab === 'generator' ? 'bg-blue-800 text-blue-100' : 'bg-slate-200 text-slate-700'
              }`}>
                {unsentMrCount} Unsent
              </span>
            </button>

            <button
              onClick={() => { setActiveTab('sent'); setSelectedMrNo(null); }}
              className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
                activeTab === 'sent'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>2. Sent Estimates</span>
              {sentStats.pendingCount > 0 && (
                <span className={`ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-black ${
                  activeTab === 'sent' ? 'bg-amber-800 text-amber-100' : 'bg-amber-100 text-amber-800'
                }`}>
                  {sentStats.pendingCount} Awaiting Appr.
                </span>
              )}
            </button>

            <button
              onClick={() => { setActiveTab('approvals'); setSelectedMrNo(null); }}
              className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
                activeTab === 'approvals'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>3. Received Approvals</span>
              {sentStats.approvedCount > 0 && (
                <span className={`ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-black ${
                  activeTab === 'approvals' ? 'bg-emerald-800 text-emerald-100' : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {sentStats.approvedCount} Approved
                </span>
              )}
            </button>
          </div>
        </div>
      ) : (
        /* Top bar when viewing an MR estimate document */
        <div className="flex flex-wrap items-center justify-between border-b border-slate-200 mb-5 pb-3 gap-3 print:hidden">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedMrNo(null)}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-3.5 py-2 rounded-lg transition-colors shadow-xs"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>&larr; Back to Estimate Register</span>
            </button>
            <span className="text-xs font-mono font-bold text-slate-500">MR: {selectedMrNo}</span>
          </div>
        </div>
      )}

      {/* Global Success Notification */}
      {savedSuccessMsg && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 p-3 rounded-lg flex items-center justify-between text-xs font-semibold print:hidden shadow-sm mb-4">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{savedSuccessMsg}</span>
          </div>
          <button onClick={() => setSavedSuccessMsg('')} className="text-emerald-600 hover:text-emerald-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* TAB 1: ESTIMATE GENERATOR */}
      {activeTab === 'generator' && (
        <>
          {!selectedMrNo ? (
            <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden print:hidden">
              <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                <div>
                  <h2 className="text-xs font-bold text-slate-700 uppercase tracking-widest">
                    Stage 1: Pending Estimates To Generate ({filteredMrNos.length} MRs)
                  </h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Click "Send Estimate" to record dispatch to DISCOM and advance to Stage 2.
                  </p>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">MR No</th>
                      <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Division</th>
                      <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Total Jobs</th>
                      <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Est. Amount</th>
                      <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Status</th>
                      <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px] text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMrNos.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                          No matching MR numbers found.
                        </td>
                      </tr>
                    ) : (
                      filteredMrNos.map(mr => {
                        const groupJobs = mrGroups[mr] || [];
                        const divName = groupJobs[0]?.division || '-';
                        const gpCount = groupJobs.filter(j => isGpJob(j)).length;
                        const chargeableJobs = groupJobs.filter(j => !isGpJob(j));
                        const scrapCount = chargeableJobs.filter(j => j.status === 'Scrap' || j.condition === 'Scrap').length;
                        const repairableCount = chargeableJobs.length - scrapCount;
                        const estTotal = calculateMrEstimateTotal(mr);
                        const isSent = groupJobs.some(j => j.estimateSentDate || j.estimateStatus === 'Sent' || j.estimateRefNo);
                        const isApproved = groupJobs.some(j => !!j.approvalNo || j.estimateApprovalStatus === 'Approved');
                        
                        const hasCircleLimitExceeded = mrHasExceededCircleLimit(mr);

                        return (
                          <tr key={mr} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-mono font-bold text-slate-800">
                              <div className="flex items-center gap-2">
                                <span>{mr}</span>
                                {hasCircleLimitExceeded && (
                                  <span 
                                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-800 border border-rose-300 shadow-2xs"
                                    title="One or more transformers in this MR exceed SE Circle Approval Power Limit (Clause 4.0)"
                                  >
                                    <AlertTriangle className="w-2.5 h-2.5 mr-1 text-rose-600 shrink-0" />
                                    <span>&gt; Circle Limit</span>
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-600">{divName}</td>
                            <td className="px-4 py-3 text-slate-600">
                              <span className="font-semibold">{groupJobs.length} Jobs</span>
                              <span className="text-xs text-slate-400 block">({repairableCount} Rep, {scrapCount} Scrap)</span>
                              {gpCount > 0 && (
                                <span
                                  className={`text-xs font-semibold block ${GP_TEXT_CLASS}`}
                                  title="GP repairs are done under guarantee at no cost and are excluded from the estimate and its total"
                                >
                                  {gpCount} of {groupJobs.length} jobs are GP - not billable
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 font-mono font-bold text-slate-900">
                              <div>₹{estTotal.toLocaleString('en-IN')}</div>
                              {hasCircleLimitExceeded && (
                                <span className="text-[10px] text-rose-600 font-sans font-bold flex items-center gap-0.5">
                                  <AlertTriangle className="w-2.5 h-2.5" /> Exceeds Circle Limit
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {isApproved ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                  <CheckCircle2 className="w-3 h-3 mr-1" /> Approved
                                </span>
                              ) : isSent ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                  <Send className="w-3 h-3 mr-1" /> Sent (Pending Appr.)
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                  Draft / Ready
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right space-x-2">
                              <button
                                onClick={() => handleOpenSendModal(mr)}
                                className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 rounded transition-colors inline-flex items-center"
                                title="Mark this estimate as Sent to Department"
                              >
                                <Send className="w-3 h-3 mr-1" />
                                {isSent ? 'Update Sent Ref' : 'Send Estimate'}
                              </button>
                              <button 
                                onClick={() => setSelectedMrNo(mr)}
                                className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 rounded transition-colors"
                              >
                                Generate / View
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="space-y-6 print:space-y-0">
              <div className="bg-slate-900 border border-slate-800 p-4 rounded flex flex-wrap gap-3 justify-between items-center text-white print:hidden shadow-sm">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Selected MR</p>
                  <p className="text-lg font-mono font-bold">{selectedMrNo}</p>
                  <p className="text-xs text-slate-300 mt-1">{selectedJobsData.length} Transformer(s) in this MR</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleOpenSendModal(selectedMrNo)}
                    className="flex items-center text-xs font-bold uppercase tracking-wider bg-purple-600 hover:bg-purple-700 text-white px-3.5 py-2 rounded transition-colors shadow-sm"
                    title="Send Estimate with Ref No and Date"
                  >
                    <Send className="w-3.5 h-3.5 mr-1.5" /> Send Estimate
                  </button>
                  <button 
                    onClick={() => setShowEditModal(true)}
                    className="flex items-center text-xs font-bold uppercase tracking-wider bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-2 rounded transition-colors shadow-sm"
                  >
                    <Edit3 className="w-3.5 h-3.5 mr-1.5" /> Edit Letter
                  </button>
                  <button 
                    onClick={() => {
                      const container = document.getElementById('printable-estimate-container');
                      if (container) downloadHtmlAsWord(container, `Estimate_Report_${selectedMrNo}.doc`, `Estimate Report & Forwarding Letter - ${selectedMrNo}`);
                    }}
                    className="flex items-center text-xs font-bold uppercase tracking-wider bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded transition-colors shadow-sm"
                  >
                    <FileText className="w-3.5 h-3.5 mr-1.5" /> Download Word (.doc)
                  </button>
                  <button 
                    onClick={handlePrint}
                    className="flex items-center text-xs font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-3.5 py-2 rounded transition-colors shadow-sm cursor-pointer"
                    title="Print document or open print dialog"
                  >
                    <Printer className="w-3.5 h-3.5 mr-1.5" /> Print
                  </button>
                  <button
                    onClick={handleExportExcel}
                    className="flex items-center text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded transition-colors shadow-sm"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" /> Export Excel
                  </button>
                  <button 
                    onClick={() => setSelectedMrNo(null)}
                    className="text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-white border border-slate-700 px-3.5 py-2 rounded transition-colors"
                  >
                    Change MR
                  </button>
                </div>
              </div>

          {/* VIEW MODE TABS */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-2.5 rounded-lg border border-slate-200 shadow-xs print:hidden">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mr-1">Report Format:</span>
              <button
                onClick={() => setEstimateViewMode('batch_all')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                  estimateViewMode === 'batch_all'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
                title="Prints 1 Common Forwarding Letter for the MR on Page 1, followed by individual detailed 3-section A4 estimate sheets for each transformer"
              >
                <FileStack className="w-3.5 h-3.5" />
                <span>Complete MR Package (Common Letter + All Job Estimates)</span>
              </button>
              <button
                onClick={() => setEstimateViewMode('forwarding_only')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                  estimateViewMode === 'forwarding_only'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
                title="View or print the consolidated MR-wise Common Forwarding Letter"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Common Forwarding Letter (MR Wise)</span>
              </button>
              <button
                onClick={() => setEstimateViewMode('single_job')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                  estimateViewMode === 'single_job'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
                title="View or print a single transformer's 3-section estimate sheet"
              >
                <FileCheck2 className="w-3.5 h-3.5" />
                <span>Single Job Estimate Sheet</span>
              </button>
              <button
                onClick={() => setEstimateViewMode('matrix')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                  estimateViewMode === 'matrix'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
                title="Traditional multi-column side-by-side comparison matrix"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Multi-Job Summary Matrix</span>
              </button>
            </div>
            <div className="text-[11px] text-slate-500 font-medium italic">
              {estimateViewMode === 'batch_all' && '📌 Standard format: 1 Common Forwarding Letter (Cover) + Individual Job Estimate Sheets'}
              {estimateViewMode === 'forwarding_only' && '📌 Common Forwarding Letter for MR submission'}
              {estimateViewMode === 'single_job' && '📌 Inspecting individual 3-section breakdown (Physical, Internal, Labour)'}
              {estimateViewMode === 'matrix' && '📌 Side-by-side comparison format'}
            </div>
          </div>

          {/* SINGLE JOB SELECTOR (when in single_job mode) */}
          {estimateViewMode === 'single_job' && (
            <div className="flex flex-wrap items-center gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200 print:hidden">
              <span className="text-xs font-bold text-slate-700 mr-2">Select Transformer:</span>
              {selectedJobsData.map((job) => {
                const isActive = (activeSingleJobId || selectedJobsData[0]?.id) === job.id;
                return (
                  <button
                    key={job.id}
                    onClick={() => setActiveSingleJobId(job.id)}
                    className={`px-3 py-1.5 rounded-md text-xs font-mono font-bold transition-colors border ${
                      isActive
                        ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    Job #{job.jobNo} &bull; {job.capacityKva} KVA ({job.coreType || 'CRGO'})
                  </button>
                );
              })}
            </div>
          )}

          {savedSuccessMsg && (
            <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 p-3 rounded-lg flex items-center justify-between text-xs font-semibold print:hidden shadow-sm">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{savedSuccessMsg}</span>
              </div>
              <button onClick={() => setSavedSuccessMsg('')} className="text-emerald-600 hover:text-emerald-800">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* EXCEEDS CIRCLE LIMIT WARNING CARD */}
          {exceedingJobsInSelectedMr.length > 0 && (
            <div className="bg-rose-50 border-2 border-rose-400 rounded-xl p-4 text-rose-900 shadow-md print:hidden space-y-3">
              <div className="flex items-start gap-3">
                <div className="p-2.5 bg-rose-100 rounded-xl text-rose-700 shrink-0 border border-rose-300">
                  <AlertTriangle className="w-6 h-6 animate-pulse text-rose-700" />
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-black uppercase tracking-wide text-rose-950">
                      ⚠️ ESTIMATE AMOUNT IS MORE THAN CIRCLE LIMIT (Clause 4.0 - 25% Approval Power)
                    </h3>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] bg-rose-200 text-rose-900 font-bold font-mono border border-rose-300">
                      {exceedingJobsInSelectedMr.length} Transformer(s) Over Limit
                    </span>
                  </div>
                  <p className="text-xs text-rose-800 mt-1 leading-relaxed">
                    The estimated repair cost for the transformer(s) listed below exceeds the 25% financial sanction power of the Superintending Engineer (Circle Office). These estimates will require special sanction from higher corporate authority (Chief Engineer / Corporate Office).
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
                {exceedingJobsInSelectedMr.map(({ job, check }) => (
                  <div key={job.id} className="bg-white border border-rose-300 rounded-lg p-3 flex justify-between items-center shadow-xs">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-slate-900 text-xs">Job #{job.jobNo}</span>
                        <span className="text-[11px] font-semibold text-slate-600">({job.capacityKva} KVA &bull; {check.ratingLabel})</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Make: {job.make || '-'} &bull; S/N: {job.serialNo || '-'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-rose-700 text-xs">
                        ₹{check.finalAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                      <div className="text-[9px] text-slate-500 font-medium">
                        Circle Limit: ₹{check.limit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                      <div className="text-[9px] font-bold text-rose-600">
                        +₹{check.diff.toFixed(0)} (+{check.diffPct.toFixed(1)}%)
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div id="printable-estimate-container" className="space-y-6 print:space-y-0">
            {/* VIEW MODE 1: COMPLETE SUBMISSION PACKAGE (PAGE 1: COMMON FORWARDING LETTER + PAGE 2..N: SEPARATE JOB ESTIMATES) */}
            {estimateViewMode === 'batch_all' && (
              <>
                {/* 1. COMMON FORWARDING LETTER FOR ALL JOBS IN THIS MR */}
                {renderForwardingLetterPages()}

                {/* 2. SEPARATE INDIVIDUAL ESTIMATE SHEETS (1 PAGE PER TRANSFORMER) */}
                {selectedJobsData.map((job) => (
                  <SingleJobEstimateReport
                    key={job.id}
                    job={job}
                    agency={activeAgency}
                    atMaster={activeAtMaster}
                    externalData={externalInspMap[job.id]}
                    internalData={internalInspMap[job.id]}
                    letterDateText={letterDateText || dateString}
                  />
                ))}
              </>
            )}

            {/* VIEW MODE 1B: COMMON FORWARDING LETTER ONLY */}
            {estimateViewMode === 'forwarding_only' && renderForwardingLetterPages()}

            {/* VIEW MODE 2: SINGLE JOB ESTIMATE SHEET */}
            {estimateViewMode === 'single_job' && (
              (() => {
                const targetJob = selectedJobsData.find(j => j.id === (activeSingleJobId || selectedJobsData[0]?.id)) || selectedJobsData[0];
                if (!targetJob) return <div className="text-center p-8 bg-white text-slate-500">No transformer selected.</div>;
                return (
                  <SingleJobEstimateReport
                    job={targetJob}
                    agency={activeAgency}
                    atMaster={activeAtMaster}
                    externalData={externalInspMap[targetJob.id]}
                    internalData={internalInspMap[targetJob.id]}
                    letterDateText={letterDateText || dateString}
                  />
                );
              })()
            )}

            {/* VIEW MODE 3: MULTI-JOB SUMMARY MATRIX */}
            {estimateViewMode === 'matrix' && (
              <>
                <PrintableA4Page agency={activeAgency} documentTitle="ESTIMATE REPORT">
                  <div className="flex flex-col justify-between h-full">
                    <div>
                      <div className="flex justify-between items-center text-[9px] font-bold uppercase text-black mb-1.5 border-b border-black pb-1">
                        <div>
                          <p>DIVISION : {selectedJobsData[0]?.division || 'SABARMATI'}</p>
                          <p className="mt-0.5">ORDER NO : {activeAgency?.prefixes?.[selectedJobsData[0]?.division || 'SABARMATI'] ? 'UGVCL/EE-T-1/TRANS-REP/...' : '...'}</p>
                        </div>
                        <div className="text-center text-xs font-bold underline decoration-1 underline-offset-2">
                          ESTIMATE REPORT
                        </div>
                        <div className="text-right">
                          <p>NO : {Math.floor(Math.random() * 100) + 1}</p>
                          <p className="mt-0.5">DATE : {letterDateText || dateString}</p>
                        </div>
                      </div>

                      <table className="w-full text-black text-[8px] border-collapse border border-black">
                        <tbody>
                          <tr className="border-b border-black font-bold">
                            <td className="p-0.5 border-r border-black">TRANS TYPE</td>
                            {selectedJobsData.map(job => (
                              <td key={job.id} className="p-0.5 border-r border-black text-center">{job.coreType || 'CRGO'}</td>
                            ))}
                          </tr>
                          <tr className="border-b border-black font-bold">
                            <td className="p-0.5 border-r border-black">JOB NO</td>
                            {selectedJobsData.map(job => (
                              <td key={job.id} className="p-0.5 border-r border-black text-center">{job.jobNo}</td>
                            ))}
                          </tr>
                          <tr className="border-b border-black font-bold">
                            <td className="p-0.5 border-r border-black">MAKE</td>
                            {selectedJobsData.map(job => (
                              <td key={job.id} className="p-0.5 border-r border-black text-center">{job.make}</td>
                            ))}
                          </tr>
                          <tr className="border-b border-black font-bold">
                            <td className="p-0.5 border-r border-black">KVA / KV</td>
                            {selectedJobsData.map(job => (
                              <td key={job.id} className="p-0.5 border-r border-black text-center">{job.capacityKva} / 11</td>
                            ))}
                          </tr>
                          <tr className="border-b border-black font-bold">
                            <td className="p-0.5 border-r border-black">TSR NO.</td>
                            {selectedJobsData.map(job => (
                              <td key={job.id} className="p-0.5 border-r border-black text-center">{job.serialNo}</td>
                            ))}
                          </tr>
                          <tr className="border-b border-black font-bold">
                            <td className="p-0.5 border-r border-black">MR NO. & DATE</td>
                            {selectedJobsData.map(job => (
                              <td key={job.id} className="p-0.5 border-r border-black text-center">{job.mrNo}</td>
                            ))}
                          </tr>
                          <tr className="border-b border-black font-bold">
                            <td className="p-0.5 border-r border-black">Oil Cap / Less Oil / Filter Oil</td>
                            {selectedJobsData.map(job => (
                              <td key={job.id} className="p-0.5 border-r border-black text-center">- / - / -</td>
                            ))}
                          </tr>
                          <tr className="border-b border-black font-bold">
                            <td className="p-0.5 border-r border-black">RATING / LEVEL (Clause 4.0)</td>
                            {selectedJobsData.map(job => (
                              <td key={job.id} className="p-0.5 border-r border-black text-center">
                                <select
                                  value={job.starRating || job.ratingLevel || '3 Star & other'}
                                  onChange={(e) => handleUpdateJobRating(job.id, e.target.value)}
                                  className="text-[8px] font-bold bg-white border border-slate-300 rounded px-1 py-0.5 max-w-full print:border-none print:bg-transparent print:appearance-none text-center cursor-pointer"
                                  title="Change Transformer Rating / Level for Circle Limit Approval Check"
                                >
                                  {RATING_LEVEL_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                  ))}
                                </select>
                              </td>
                            ))}
                          </tr>

                          {/* Sub headers */}
                          <tr className="border-b border-black font-bold bg-slate-100 print:bg-transparent">
                            <td className="p-0.5 border-r border-black flex justify-between">
                              <span>As Per AT Sr</span>
                              <span className="text-center flex-1">ITEM</span>
                            </td>
                            {selectedJobsData.map(job => (
                              <td key={job.id} className="p-0 border-r border-black">
                                <table className="w-full text-center text-[8px]">
                                  <tbody>
                                    <tr>
                                      <td className="w-1/3 py-0.5 border-r border-black">QTY</td>
                                      <td className="w-1/3 py-0.5 border-r border-black">RATE</td>
                                      <td className="w-1/3 py-0.5">AMT.</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </td>
                            ))}
                          </tr>

                          {/* Items */}
                          {(selectedJobsData.length > 0 
                            ? getEstimateMasterForCore(activeAgency, selectedJobsData[0].coreType)
                            : (activeAgency?.estimateMaster?.length > 0 ? activeAgency.estimateMaster : defaultEstimateData)
                          ).map((item, idx) => (
                            <tr key={idx} className="border-b border-slate-300">
                              <td className="p-0.5 border-r border-black flex gap-1">
                                <span className="w-6 shrink-0">{item.itemCode}</span>
                                <span className="truncate">{item.itemName}</span>
                              </td>
                              {selectedJobsData.map(job => {
                                const jobMasterData = getEstimateMasterForCore(activeAgency, job.coreType);
                                const itemForJob = jobMasterData.find(m => m.itemCode === item.itemCode || m.itemName === item.itemName) || item;
                                const { qtyDisplay, rate, amt } = calculateJobItemDetails(
                                  itemForJob, 
                                  job,
                                  externalInspMap[job.id],
                                  internalInspMap[job.id]
                                );

                                return (
                                  <td key={job.id} className="p-0 border-r border-black">
                                    <table className="w-full text-center text-[8px]">
                                      <tbody>
                                        <tr>
                                          <td className="w-1/3 py-0.5 border-r border-slate-300">{qtyDisplay}</td>
                                          <td className="w-1/3 py-0.5 border-r border-slate-300">{rate > 0 ? rate.toFixed(1) : '0.0'}</td>
                                          <td className="w-1/3 py-0.5">{amt > 0 ? amt.toFixed(1) : '0.0'}</td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                          
                          {/* Totals */}
                          <tr className="border-t border-black font-bold">
                            <td className="p-1 border-r border-black text-right">Total</td>
                            {selectedJobsData.map(job => (
                              <td key={job.id} className="p-1 border-r border-black text-right font-mono">{calculateJobTotal(job).toFixed(2)}</td>
                            ))}
                          </tr>
                          <tr className="border-t border-black font-bold">
                            <td className="p-1 border-r border-black text-right">
                              {(() => {
                                if (selectedJobsData.length === 0) return 'Rise / Fall Total';
                                const pcts = selectedJobsData.map(j => getAtPercentageForCore(activeAtMaster, j.coreType));
                                const allSame = pcts.every(p => p === pcts[0]);
                                if (allSame) {
                                  const p = pcts[0];
                                  return p >= 0 ? `${p.toFixed(2)} % Rise Total` : `${Math.abs(p).toFixed(2)} % Fall Total`;
                                }
                                return 'AT % Rise / Fall Total';
                              })()}
                            </td>
                            {selectedJobsData.map(job => {
                              const atPct = getAtPercentageForCore(activeAtMaster, job.coreType);
                              const baseTot = calculateJobTotal(job);
                              const riseAmt = baseTot * (atPct / 100);
                              return (
                                <td key={job.id} className="p-1 border-r border-black text-right font-mono">
                                  {riseAmt.toFixed(2)}
                                </td>
                              );
                            })}
                          </tr>
                          <tr className="border-t border-black font-bold text-[9px]">
                            <td className="p-1 border-r border-black text-right">Grand Total</td>
                            {selectedJobsData.map(job => {
                              const atPct = getAtPercentageForCore(activeAtMaster, job.coreType);
                              const baseTot = calculateJobTotal(job);
                              const grandTot = baseTot * (1 + atPct / 100);
                              return (
                                <td key={job.id} className="p-1 border-r border-black text-right font-mono">{grandTot.toFixed(2)}</td>
                              );
                            })}
                          </tr>

                          {/* Circle Limit Clause 4.0 Rows */}
                          <tr className="border-t border-black text-[8px] bg-slate-50 print:bg-transparent">
                            <td className="p-1 border-r border-black text-right font-bold text-slate-700">
                              SE (Circle) Limit (Clause 4.0)
                            </td>
                            {selectedJobsData.map(job => {
                              const check = checkJobCircleLimit(job);
                              return (
                                <td key={job.id} className="p-1 border-r border-black text-right font-mono font-bold text-slate-800">
                                  {check.hasLimit ? `₹ ${check.limit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : 'N/A'}
                                </td>
                              );
                            })}
                          </tr>
                          <tr className="border-t border-black text-[8px] font-bold">
                            <td className="p-1 border-r border-black text-right font-bold">
                              Approval Authority Power Check
                            </td>
                            {selectedJobsData.map(job => {
                              const check = checkJobCircleLimit(job);
                              if (!check.hasLimit) {
                                return (
                                  <td key={job.id} className="p-1 border-r border-black text-center text-slate-500 font-normal">
                                    Standard Limit
                                  </td>
                                );
                              }
                              if (check.exceeds) {
                                return (
                                  <td key={job.id} className="p-1 border-r border-black text-center bg-rose-100 text-rose-900 font-bold">
                                    <div className="flex flex-col items-center justify-center">
                                      <span className="text-[7.5px] uppercase text-rose-800 font-black">
                                        ⚠️ EXCEEDS CIRCLE LIMIT
                                      </span>
                                      <span className="text-[7px] text-rose-700 font-mono">
                                        +₹{check.diff.toFixed(0)} (+{check.diffPct.toFixed(1)}%) &bull; Needs CE/CO Appr.
                                      </span>
                                    </div>
                                  </td>
                                );
                              }
                              return (
                                <td key={job.id} className="p-1 border-r border-black text-center bg-emerald-50 text-emerald-800 font-medium">
                                  <span className="text-[7.5px]">✓ Within Circle Limit</span>
                                </td>
                              );
                            })}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    
                    <div className="flex justify-between items-end mt-4 text-black text-xs font-bold pt-2">
                      <div>
                        <p className="underline underline-offset-2 text-[10px]">
                          Note - {selectedJobsData.some(j => j.status === 'Scrap' || j.condition === 'Scrap') ? 'Scrap Included' : ''}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="mb-6">For, {activeAgency?.name || ''}</p>
                        <p className="text-[10px] text-slate-500">Auth Sign.</p>
                      </div>
                    </div>
                  </div>
                </PrintableA4Page>

                {/* COMMON FORWARDING LETTER */}
                <PrintableA4Page agency={activeAgency}>
                  <div className="flex flex-col justify-between h-full text-black">
                    <div>
                      <div className="flex justify-between text-xs font-bold mb-4">
                        <div className="whitespace-pre-wrap">
                          {forwardingTo || `Superintending Engineer (O & M),
Uttar Gujarat Vij Company Ltd.,
Circle Office : SABARMATI`}
                        </div>
                        <div className="text-right whitespace-pre-wrap">
                          <p>REF. NO. : {refNoText}</p>
                          <p className="mt-1">DATE : {letterDateText}</p>
                        </div>
                      </div>

                      <div className="text-xs font-bold text-center underline underline-offset-2 mb-4">
                        Sub. : {forwardingSub || 'Submiting Inspection Report & Estimate of Transformer'}
                      </div>

                      <p className="text-xs mb-2">Dear Sir,</p>
                      <p className="text-xs mb-4 leading-relaxed ml-4 whitespace-pre-wrap">
                        {refBodyText}
                      </p>

                      <table className="w-full text-center text-xs border-collapse border border-black mb-4">
                        <thead>
                          <tr className="font-bold border-b border-black bg-slate-100 print:bg-white">
                            <th className="p-1 border-r border-black">NO.</th>
                            <th className="p-1 border-r border-black">JOB. NO.</th>
                            <th className="p-1 border-r border-black">T.R. MAKE</th>
                            <th className="p-1 border-r border-black">TR. SR. NO.</th>
                            <th className="p-1 border-r border-black">KVA</th>
                            <th className="p-1 border-r border-black">KV</th>
                            <th className="p-1 border-r border-black">TYPE</th>
                            <th className="p-1 border-r border-black">OGP/GP</th>
                            <th className="p-1 border-r border-black">EST. AMT.</th>
                            <th className="p-1">REMARK</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedJobsData.map((job, idx) => {
                             const jobBaseTotal = calculateJobTotal(job);
                             const atPct = getAtPercentageForCore(activeAtMaster, job.coreType);
                             const finalAmt = (jobBaseTotal * (1 + atPct / 100)).toFixed(2);
                             const isScrapJob = job.status === 'Scrap' || job.condition === 'Scrap';
                             const check = checkJobCircleLimit(job);
                             
                            return (
                              <tr key={job.id} className="border-b border-black">
                                <td className="p-1 border-r border-black">{idx + 1}</td>
                                <td className="p-1 border-r border-black font-mono font-bold">{job.jobNo}</td>
                                <td className="p-1 border-r border-black">{job.make}</td>
                                <td className="p-1 border-r border-black font-mono">{job.serialNo}</td>
                                <td className="p-1 border-r border-black font-bold">{job.capacityKva}</td>
                                <td className="p-1 border-r border-black">11</td>
                                <td className="p-1 border-r border-black">{job.coreType || 'CRGO'}</td>
                                <td className="p-1 border-r border-black">{job.repairType || 'OGP'}</td>
                                <td className="p-1 border-r border-black text-right font-mono font-bold">{finalAmt}</td>
                                <td className="p-1 text-center text-[9px] font-bold whitespace-nowrap">
                                  {isScrapJob ? (
                                    'SCRAP'
                                  ) : check.exceeds ? (
                                    <span className="text-rose-900 font-bold" title={`Exceeds SE Circle Limit ₹${check.limit.toFixed(0)} by ₹${check.diff.toFixed(0)}`}>
                                      REPAIRABLE <span className="text-[7.5px] block text-rose-700 font-black">(&gt; CIRCLE LIMIT)</span>
                                    </span>
                                  ) : (
                                    'REPAIRABLE'
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="font-bold border-black">
                            <td colSpan={8} className="p-1 border-r border-black text-right">TOTAL</td>
                            <td className="p-1 border-r border-black text-right font-mono font-bold">
                              {selectedJobsData.reduce((acc, job) => {
                                const baseAmt = calculateJobTotal(job);
                                const atPct = getAtPercentageForCore(activeAtMaster, job.coreType);
                                return acc + (baseAmt * (1 + atPct / 100));
                              }, 0).toFixed(2)}
                            </td>
                            <td></td>
                          </tr>
                        </tbody>
                      </table>

                      <p className="text-xs mb-4 whitespace-pre-wrap">{closingText}</p>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-6">
                        <p>Thanking you</p>
                        <p>Yours faithfully</p>
                      </div>

                      <div className="flex justify-between text-xs mb-4">
                        <p>Encl. : Estimate & Inspection Reports</p>
                        <div className="text-center">
                          <p className="mb-6 font-bold">{signedByText}</p>
                          <p className="text-[10px] text-slate-500">Auth Sign.</p>
                        </div>
                      </div>

                      <div className="text-xs font-bold">
                        <p className="mb-1">C . C. to :</p>
                        <p className="whitespace-pre-wrap font-normal text-[11px]">{forwardingCc || 'E. E. (O & M) DIVISION - SABARMATI'}</p>
                      </div>
                    </div>
                  </div>
                </PrintableA4Page>
              </>
            )}
          </div>
      </div>
      )}
      </>
      )}

      {/* TAB 2: SENT ESTIMATES (AWAITING APPROVAL) */}
      {activeTab === 'sent' && (
        <div className="space-y-5 print:hidden">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-xs flex items-center justify-between bg-gradient-to-br from-white to-amber-50/40">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Sent Estimates Awaiting Approval</p>
                <p className="text-2xl font-mono font-black text-amber-900 mt-1">{sentStats.pendingCount}</p>
                <p className="text-xs text-amber-700 mt-0.5">₹{sentStats.pendingValue.toLocaleString('en-IN')} Total Value</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                <Clock className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Cumulative Sent Estimates</p>
                <p className="text-2xl font-mono font-black text-slate-900 mt-1">{sentStats.totalCount}</p>
                <p className="text-xs text-slate-500 mt-0.5">₹{sentStats.totalValue.toLocaleString('en-IN')} Estimated</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Send className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Already Approved Estimates</p>
                <p className="text-2xl font-mono font-black text-emerald-800 mt-1">{sentStats.approvedCount}</p>
                <p className="text-xs text-emerald-600 mt-0.5">
                  <button 
                    onClick={() => setActiveTab('approvals')}
                    className="hover:underline font-bold text-emerald-700 inline-flex items-center gap-1"
                  >
                    <span>View Received Approvals</span> &rarr;
                  </button>
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
            </div>
          </div>

          {/* Sent Estimates Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-amber-600 shrink-0" />
                <div>
                  <h3 className="font-bold text-slate-800 text-xs sm:text-sm uppercase tracking-wider">
                    Stage 2: Sent Estimates Awaiting Approval ({filteredSentEstimates.length})
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Click "Mark Approval Received" to record official sanction and move to Stage 3.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  onClick={() => {
                    const wsData = filteredSentEstimates.map(item => ({
                      'MR Number': item.mrNo,
                      'MR Date': item.mrDate,
                      'Division': item.division,
                      'Total Transformers': item.jobCount,
                      'Estimate Ref No': item.estimateRefNo,
                      'Estimate Sent Date': item.estimateSentDate,
                      'Estimate Amount (₹)': item.estimateAmount,
                      'Status': 'Awaiting DISCOM Approval',
                      'Remarks': item.approvalRemarks || '-'
                    }));
                    const ws = XLSX.utils.json_to_sheet(wsData);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, 'Sent Estimates');
                    XLSX.writeFile(wb, `Sent_Estimates_Awaiting_Approval_${new Date().toISOString().split('T')[0]}.xlsx`);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors shadow-xs"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Export Excel</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/70 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-4 py-3">MR Details</th>
                    <th className="px-4 py-3">Dispatch Details</th>
                    <th className="px-4 py-3 text-right">Estimated Amount</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSentEstimates.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                        <Send className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                        <p className="font-bold text-slate-600">No sent estimates currently awaiting approval</p>
                        <p className="text-xs text-slate-400 mt-0.5">Use the "Send Estimate" option in the Estimate Generator tab to dispatch an estimate to DISCOM.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredSentEstimates.map(item => {
                      const hasCircleLimitExceeded = mrHasExceededCircleLimit(item.mrNo);

                      return (
                      <tr key={item.mrNo} className="hover:bg-slate-50/80 transition-colors">
                        {/* MR Details */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-black text-slate-900 text-sm">{item.mrNo}</span>
                            {hasCircleLimitExceeded && (
                              <span 
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-800 border border-rose-300 shadow-2xs"
                                title="One or more transformers in this MR exceed SE Circle Approval Power Limit (Clause 4.0)"
                              >
                                <AlertTriangle className="w-2.5 h-2.5 mr-1 text-rose-600 shrink-0" />
                                <span>&gt; Circle Limit</span>
                              </span>
                            )}
                          </div>
                          <span className="text-slate-600 font-medium block">{item.division} Division • {item.jobCount} T/F</span>
                          {item.mrDate !== '-' && (
                            <span className="text-[10px] text-slate-400 block font-mono mt-0.5">MR Date: {formatDDMMYYYY(item.mrDate)}</span>
                          )}
                        </td>

                        {/* Dispatch Details */}
                        <td className="px-4 py-3.5">
                          <span className="font-mono font-bold text-slate-800 block text-xs">{item.estimateRefNo}</span>
                          <span className="text-slate-500 flex items-center mt-0.5 text-[11px]">
                            <Calendar className="w-3 h-3 mr-1 text-slate-400" /> Dispatched: {formatDDMMYYYY(item.estimateSentDate)}
                          </span>
                        </td>

                        {/* Amount */}
                        <td className="px-4 py-3.5 text-right font-mono font-black text-slate-900 text-sm">
                          <div>₹{item.estimateAmount.toLocaleString('en-IN')}</div>
                          {hasCircleLimitExceeded && (
                            <span className="text-[10px] text-rose-600 font-sans font-bold flex items-center justify-end gap-0.5">
                              <AlertTriangle className="w-2.5 h-2.5" /> Exceeds Circle Limit
                            </span>
                          )}
                        </td>

                        {/* Status Badge */}
                        <td className="px-4 py-3.5 text-center">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            <Clock className="w-3 h-3 mr-1 text-amber-600" /> Pending Approval
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            onClick={() => handleOpenApprModal(item.mrNo)}
                            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors shadow-xs inline-flex items-center gap-1"
                            title="Record DISCOM Approval No, Date & Amount"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Mark Approval Received</span>
                          </button>

                          <button
                            onClick={() => handleOpenSendModal(item.mrNo)}
                            className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg transition-colors inline-flex items-center gap-1"
                            title="Edit dispatch reference number or date"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Edit Dispatch</span>
                          </button>

                          <button
                            onClick={() => {
                              setSelectedMrNo(item.mrNo);
                              setActiveTab('generator');
                            }}
                            className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors inline-flex items-center gap-1"
                            title="View Estimate & Forwarding Letter"
                          >
                            <Eye className="w-3 h-3" />
                            <span>View / Print</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: RECEIVED APPROVALS */}
      {activeTab === 'approvals' && (
        <div className="space-y-5 print:hidden">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-xs flex items-center justify-between bg-gradient-to-br from-white to-emerald-50/40">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Total Received Approvals</p>
                <p className="text-2xl font-mono font-black text-emerald-900 mt-1">{sentStats.approvedCount}</p>
                <p className="text-xs text-emerald-700 mt-0.5">₹{sentStats.approvedValue.toLocaleString('en-IN')} Approved Value</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Approval Rate</p>
                <p className="text-2xl font-mono font-black text-slate-900 mt-1">
                  {sentStats.totalCount > 0 
                    ? `${Math.round((sentStats.approvedCount / sentStats.totalCount) * 100)}%` 
                    : '100%'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">{sentStats.approvedCount} of {sentStats.totalCount} sent estimates</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                <CheckSquare className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Pending Approvals</p>
                <p className="text-2xl font-mono font-black text-amber-800 mt-1">{sentStats.pendingCount}</p>
                <p className="text-xs text-amber-600 mt-0.5">
                  <button 
                    onClick={() => setActiveTab('sent')}
                    className="hover:underline font-bold text-amber-700 inline-flex items-center gap-1"
                  >
                    <span>View Sent Estimates</span> &rarr;
                  </button>
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <Clock className="w-6 h-6" />
              </div>
            </div>
          </div>

          {/* Received Approvals Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <div>
                  <h3 className="font-bold text-slate-800 text-xs sm:text-sm uppercase tracking-wider">
                    Stage 3: Received Estimate Approvals Register ({filteredApprovedEstimates.length})
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Official sanction records from DISCOM with approved amount and order references.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  onClick={() => {
                    const wsData = filteredApprovedEstimates.map(item => ({
                      'MR Number': item.mrNo,
                      'MR Date': item.mrDate,
                      'Division': item.division,
                      'Total Transformers': item.jobCount,
                      'Estimate Ref No': item.estimateRefNo,
                      'Estimate Sent Date': item.estimateSentDate,
                      'Original Estimate Amount (₹)': item.estimateAmount,
                      'Approval Order No': item.approvalNo,
                      'Approval Date': item.approvalDate,
                      'Approved Amount (₹)': item.approvedAmount,
                      'Approval Status': 'Approved by DISCOM',
                      'Remarks / Scope': item.approvalRemarks || '-'
                    }));
                    const ws = XLSX.utils.json_to_sheet(wsData);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, 'Received Approvals');
                    XLSX.writeFile(wb, `Received_Estimate_Approvals_${new Date().toISOString().split('T')[0]}.xlsx`);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors shadow-xs"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Export Excel</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/70 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-4 py-3">Approval Details</th>
                    <th className="px-4 py-3">MR & Division</th>
                    <th className="px-4 py-3 text-right">Approved Amount</th>
                    <th className="px-4 py-3">Remarks / Scope</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredApprovedEstimates.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                        <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                        <p className="font-bold text-slate-600">No approved estimates recorded yet</p>
                        <p className="text-xs text-slate-400 mt-0.5">When DISCOM issues approval for an estimate, click "Mark Approval Received" on the Sent Estimates tab.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredApprovedEstimates.map(item => (
                      <tr key={item.mrNo} className="hover:bg-slate-50/80 transition-colors">
                        {/* Approval Details */}
                        <td className="px-4 py-3.5">
                          <span className="font-mono font-bold text-emerald-900 text-xs block">{item.approvalNo}</span>
                          <span className="text-slate-500 flex items-center mt-0.5 text-[11px]">
                            <Calendar className="w-3 h-3 mr-1 text-slate-400" /> Approval Date: {formatDDMMYYYY(item.approvalDate)}
                          </span>
                          <span className="text-[10px] text-slate-400 block font-mono">Ref: {item.estimateRefNo}</span>
                        </td>

                        {/* MR Details */}
                        <td className="px-4 py-3.5">
                          <span className="font-mono font-black text-slate-900 text-sm block">{item.mrNo}</span>
                          <span className="text-slate-600 font-medium">{item.division} Division • {item.jobCount} T/F</span>
                        </td>

                        {/* Approved Amount */}
                        <td className="px-4 py-3.5 text-right">
                          <span className="font-mono font-black text-emerald-800 text-sm block">
                            ₹{item.approvedAmount.toLocaleString('en-IN')}
                          </span>
                          {item.approvedAmount !== item.estimateAmount && (
                            <span className="text-[10px] text-slate-400 block">
                              Est: ₹{item.estimateAmount.toLocaleString('en-IN')}
                            </span>
                          )}
                        </td>

                        {/* Remarks */}
                        <td className="px-4 py-3.5 text-slate-600 max-w-[200px]">
                          {item.approvalRemarks ? (
                            <span className="italic text-xs text-slate-700 block">"{item.approvalRemarks}"</span>
                          ) : (
                            <span className="text-slate-400 text-[11px]">-</span>
                          )}
                        </td>

                        {/* Status Badge */}
                        <td className="px-4 py-3.5 text-center">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" /> Approved
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            onClick={() => handleOpenApprModal(item.mrNo)}
                            className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg transition-colors inline-flex items-center gap-1"
                            title="Edit Approval Details"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Edit Approval</span>
                          </button>

                          <button
                            onClick={() => {
                              setSelectedMrNo(item.mrNo);
                              setActiveTab('generator');
                            }}
                            className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors inline-flex items-center gap-1"
                            title="View Full Estimate & Documents"
                          >
                            <Eye className="w-3 h-3" />
                            <span>View Estimate</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: SEND ESTIMATE (Prompt for Ref No and Date) */}
      {showSendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-3 bg-purple-100 text-purple-700 rounded-xl">
                  <Send className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Send Estimate to DISCOM</h3>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">MR Number: <strong>{sendTargetMr}</strong></p>
                </div>
              </div>
              <button onClick={() => setShowSendModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs text-purple-900 flex justify-between items-center">
              <div>
                <span className="text-purple-700 block font-medium">Estimated Value:</span>
                <span className="text-base font-mono font-black text-purple-950">
                  ₹{calculateMrEstimateTotal(sendTargetMr).toLocaleString('en-IN')}
                </span>
              </div>
              <div className="text-right">
                <span className="text-purple-700 block font-medium">Transformers:</span>
                <span className="font-bold text-purple-950">{(mrGroups[sendTargetMr] || []).length} Units</span>
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Dispatch Reference Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={sendRefNo}
                  onChange={(e) => setSendRefNo(e.target.value)}
                  placeholder="e.g. UGVCL/EE-T-1/TRANS-REP/123"
                  className="w-full px-3 py-2 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Estimate Sent Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={sendDate}
                  onChange={(e) => setSendDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Remarks / Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={sendRemarks}
                  onChange={(e) => setSendRemarks(e.target.value)}
                  placeholder="e.g. Submitted by hand to Circle Office"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2.5 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowSendModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingSend || !sendRefNo.trim()}
                onClick={handleConfirmSendEstimate}
                className="px-5 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors flex items-center space-x-1.5 shadow-sm disabled:opacity-50"
              >
                {submittingSend ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Confirm & Mark as Sent</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: MARK APPROVAL RECEIVED */}
      {showApprModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-3 bg-emerald-100 text-emerald-700 rounded-xl">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Record Estimate Approval</h3>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">MR Number: <strong>{apprTargetMr}</strong></p>
                </div>
              </div>
              <button onClick={() => setShowApprModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-900 flex justify-between items-center">
              <div>
                <span className="text-emerald-700 block font-medium">Estimated Amount:</span>
                <span className="text-base font-mono font-black text-emerald-950">
                  ₹{calculateMrEstimateTotal(apprTargetMr).toLocaleString('en-IN')}
                </span>
              </div>
              <div className="text-right">
                <span className="text-emerald-700 block font-medium">Status:</span>
                <span className="font-bold text-emerald-800">DISCOM Official Approval</span>
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Approval Letter / Order No. <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={apprNo}
                  onChange={(e) => setApprNo(e.target.value)}
                  placeholder="e.g. UGVCL/SE-TR/APPR/2026/123"
                  className="w-full px-3 py-2 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Approval Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={apprDate}
                    onChange={(e) => setApprDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Approved Amount (₹)
                  </label>
                  <input
                    type="number"
                    value={apprAmount}
                    onChange={(e) => setApprAmount(e.target.value)}
                    placeholder="Approved Amt"
                    className="w-full px-3 py-2 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Approval Remarks (Optional)
                </label>
                <textarea
                  rows={2}
                  value={apprRemarks}
                  onChange={(e) => setApprRemarks(e.target.value)}
                  placeholder="e.g. Approved with 100% repair scope"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2.5 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowApprModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingAppr || !apprNo.trim()}
                onClick={handleConfirmApproval}
                className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors flex items-center space-x-1.5 shadow-sm disabled:opacity-50"
              >
                {submittingAppr ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Confirm Approval Received</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT / CUSTOMIZE FORWARDING LETTER MODAL */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-2xl w-full border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200">
              <div className="flex items-center space-x-2 text-slate-800">
                <Edit3 className="w-5 h-5 text-amber-600" />
                <h3 className="font-bold text-base">Customize Forwarding Letter Details</h3>
              </div>
              <button onClick={() => setShowEditModal(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">REF. NO.</label>
                  <input type="text" value={refNoText} onChange={e => setRefNoText(e.target.value)} className="w-full px-3 py-2 text-sm border rounded bg-slate-50 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">DATE</label>
                  <input type="text" value={letterDateText} onChange={e => setLetterDateText(e.target.value)} className="w-full px-3 py-2 text-sm border rounded bg-slate-50 focus:bg-white" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Forwarding To (Recipient Address)</label>
                <textarea rows={3} value={forwardingTo} onChange={e => setForwardingTo(e.target.value)} className="w-full px-3 py-2 text-sm border rounded bg-slate-50 focus:bg-white font-mono text-xs" />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Subject (Sub.)</label>
                <input type="text" value={forwardingSub} onChange={e => setForwardingSub(e.target.value)} className="w-full px-3 py-2 text-sm border rounded bg-slate-50 focus:bg-white" />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Opening Reference Body Text</label>
                <textarea rows={2} value={refBodyText} onChange={e => setRefBodyText(e.target.value)} className="w-full px-3 py-2 text-sm border rounded bg-slate-50 focus:bg-white" />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Closing Request Message</label>
                <input type="text" value={closingText} onChange={e => setClosingText(e.target.value)} className="w-full px-3 py-2 text-sm border rounded bg-slate-50 focus:bg-white" />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Authorized Signatory Title</label>
                <input type="text" value={signedByText} onChange={e => setSignedByText(e.target.value)} className="w-full px-3 py-2 text-sm border rounded bg-slate-50 focus:bg-white" />
              </div>

              <div className="bg-slate-50 p-3 rounded-lg border border-slate-300 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    {isCcLocked ? (
                      <span className="inline-flex items-center gap-1 text-slate-800">
                        <Lock className="w-3.5 h-3.5 text-amber-600" /> C . C. to :
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-blue-700">
                        <Unlock className="w-3.5 h-3.5 text-blue-600" /> C . C. to : (Unlocked)
                      </span>
                    )}
                  </label>
                  <div className="flex items-center gap-2">
                    {isCcLocked ? (
                      <button
                        type="button"
                        onClick={() => setShowCcUnlockModal(true)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold uppercase text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded transition-colors shadow-xs"
                      >
                        <Unlock className="w-3 h-3 text-amber-600" /> Unlock
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setForwardingCc(getEstimateCcText(activeAgency, currentSelectedDivision))}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-slate-600 hover:text-slate-900 bg-slate-200 hover:bg-slate-300 rounded transition-colors"
                          title="Reset to default format"
                        >
                          <RotateCcw className="w-3 h-3" /> Reset
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsCcLocked(true)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold uppercase text-slate-700 bg-slate-200 hover:bg-slate-300 rounded transition-colors"
                        >
                          <Lock className="w-3 h-3" /> Lock
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <textarea
                    rows={2}
                    readOnly={isCcLocked}
                    value={forwardingCc}
                    onChange={e => setForwardingCc(e.target.value)}
                    className={`w-full px-3 py-2 text-sm border rounded font-mono text-xs transition-all ${
                      isCcLocked
                        ? 'bg-slate-200/70 text-slate-700 border-slate-300 font-bold select-none cursor-not-allowed'
                        : 'bg-white text-slate-900 border-blue-500 font-bold ring-2 ring-blue-100'
                    }`}
                  />
                  {isCcLocked && (
                    <span className="absolute right-2 top-2 text-[10px] uppercase font-bold text-amber-800 bg-amber-100/90 px-1.5 py-0.5 rounded border border-amber-200 flex items-center">
                      <Lock className="w-2.5 h-2.5 mr-1" /> Locked Standard
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-500">
                  Standard format: <strong className="font-mono text-slate-700">E. E. (O & M) DIVISION - {currentSelectedDivision}</strong>
                </p>
              </div>

              <div className="bg-amber-50 border border-amber-200 p-3 rounded flex items-center space-x-2 text-xs text-amber-800">
                <input
                  type="checkbox"
                  id="saveAgencyDefaultEst"
                  checked={saveAsDefault}
                  onChange={e => setSaveAsDefault(e.target.checked)}
                  className="rounded text-amber-600 focus:ring-amber-500 w-4 h-4"
                />
                <label htmlFor="saveAgencyDefaultEst" className="cursor-pointer font-medium">
                  Save Recipient, Subject & C.C. as default configuration for {activeAgency?.name || 'active agency'}
                </label>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-200 flex justify-end space-x-3">
              <button onClick={() => setShowEditModal(false)} className="px-4 py-2 text-xs font-bold uppercase text-slate-600 hover:text-slate-800 border rounded">
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (saveAsDefault && activeAgency) {
                    await updateAgency(activeAgency.id, {
                      forwardingToText: forwardingTo,
                      forwardingSubject: forwardingSub,
                      forwardingCcText: forwardingCc
                    });
                  }
                  setShowEditModal(false);
                }}
                className="px-5 py-2 text-xs font-bold uppercase bg-emerald-600 hover:bg-emerald-700 text-white rounded transition-colors flex items-center"
              >
                <Check className="w-4 h-4 mr-1.5" /> Confirm & Apply To Document
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alert / Warning Modal for Unlocking C.C. in Estimate Generator */}
      {showCcUnlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start space-x-3.5">
              <div className="p-3 bg-amber-100 text-amber-700 rounded-xl flex-shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-slate-900">
                  Unlock C.C. Copy Field?
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Standard DISCOM Routing Protection
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 text-xs text-amber-900 space-y-2">
              <p className="font-semibold text-amber-900">
                Standard C.C. recipient is locked by default:
              </p>
              <div className="p-2 bg-white rounded border border-amber-300 font-mono font-bold text-slate-800 text-center select-all">
                E. E. (O & M) DIVISION - {currentSelectedDivision}
              </div>
              <p className="text-[11px] text-amber-800 leading-normal">
                <strong>Notice:</strong> Changing the C.C. recipient will modify the printed forwarding letter for this estimate batch.
              </p>
            </div>

            <p className="text-xs text-slate-600">
              Do you want to unlock and edit the C.C. recipient?
            </p>

            <div className="flex items-center justify-end space-x-2.5 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowCcUnlockModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Keep Locked
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCcLocked(false);
                  setShowCcUnlockModal(false);
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors flex items-center space-x-1.5 shadow-sm"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Yes, Unlock for Edit</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
