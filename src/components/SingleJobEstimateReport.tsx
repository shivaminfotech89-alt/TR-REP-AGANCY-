import React, { useEffect, useRef, useState } from 'react';
import { LetterheadHeader, PrintableA4Page } from './LetterheadHeader';
import { formatDDMMYYYY } from '../lib/utils';
import { getAtPercentageForCore, getEstimateMasterForCore } from '../lib/AgencyContext';
import { EstimateItem } from '../lib/estimateData';
import { bandForKva, SCHEDULE_A, RADIATOR_ABOVE_100, SCHEDULE_B, ScheduleBItem, AMORPHOUS_ESTIMATE_TEXT } from '../lib/ugvclSchedule2020';
import { resolveScrapCharge } from '../lib/estimateCalc';

type EstimateSection = 'physical' | 'internal' | 'labour';
const SECTION_LABELS: Record<EstimateSection, string> = {
  physical: 'Physical Estimation',
  internal: 'Internal Estimation',
  labour: 'Labour Charge',
};

// Same classification convention as getAtPercentageForCore / getEstimateMasterForCore
// in AgencyContext.tsx - kept consistent so a job classifies identically everywhere.
export type CoreClass = 'CRGO' | 'OH' | 'AMORPHOUS' | 'WOUND_CORE';
export function classifyCoreType(coreType: string): CoreClass {
  const type = (coreType || 'CRGO').trim().toUpperCase();
  if (type === 'OH' || type.includes('OVERHAUL')) return 'OH';
  if (type.includes('AMORPHOUS') || type.includes('AM')) return 'AMORPHOUS';
  if (type.includes('WOUND') || type.includes('WC')) return 'WOUND_CORE';
  return 'CRGO';
}

// Schedule-B has exactly one Aluminium/Copper x capacity combination, except 63 KVA
// Aluminium which has two variants (1d-1 default, 1d-2 for Vijay/Vijai make only).
function findScheduleBEntry(kvaNum: number, isCopper: boolean, make: string): ScheduleBItem | undefined {
  const wantedWinding: 'Aluminium' | 'Copper' = isCopper ? 'Copper' : 'Aluminium';
  const candidates = SCHEDULE_B.filter(e => e.kva === kvaNum && e.winding === wantedWinding);
  if (candidates.length <= 1) return candidates[0];
  const makeLower = (make || '').toLowerCase();
  const isVijay = makeLower.includes('vijay') || makeLower.includes('vijai');
  return candidates.find(e => Boolean(e.makeNote) === isVijay) || candidates[0];
}

// --- Print-layout constants, all in mm, measured against real printed/rendered output ---
// Adjust these here (not the pagination logic below) if a real print still clips
// content or leaves a page looking half empty. FALLBACK_CONTENT_MM is what layout uses
// before the actual PrintableA4Page content-area height has been measured at runtime.
const FALLBACK_CONTENT_MM = 259.1;
const ROW_MM = 4.8;          // one item row
const SECTION_ROW_MM = 4.9;  // PHYSICAL / INTERNAL / LABOUR header row (incl. "(contd.)" repeats)
const TABLE_HEAD_MM = 9.1;   // column header, repeats every page
const JOB_BOX_MM = 38.1;     // job metadata box, page 1 only
const TOTALS_MM = 32.3;      // totals box, last page only
const SIGN_MM = 18.0;        // signature block, last page only
const CONTINUED_MM = 5;      // "Continued on page N..." line
const PAGENUM_MM = 5;        // "Page N of M" line
const SAFETY_MM = 4;

type EstimateRow = SingleEstimateLineItem & { section: EstimateSection };

// contentMm is PrintableA4Page's actual usable content-area height (measured at runtime via
// a ref - see measureContentAreaRef in the component below), not derived from letterhead
// header/footer dimensions: that area is already excluded from what PrintableA4Page reports.
function usableMm(isFirst: boolean, isLast: boolean, contentMm: number): number {
  return contentMm - TABLE_HEAD_MM - PAGENUM_MM - SAFETY_MM
    - (isFirst ? JOB_BOX_MM : 0)
    - (isLast ? TOTALS_MM + SIGN_MM : CONTINUED_MM);
}

// Fills pages to their (non-last) capacity, one row/section-header at a time. Used only
// to discover how many pages are actually needed - the real split comes from greedy fill below.
function greedyFillToMax(rows: EstimateRow[], contentMm: number): EstimateRow[][] {
  const pages: EstimateRow[][] = [];
  let idx = 0;
  while (idx < rows.length) {
    const cap = usableMm(pages.length === 0, false, contentMm);
    let used = 0;
    let openSection: EstimateSection | null = null;
    const pageRows: EstimateRow[] = [];
    while (idx < rows.length) {
      const row = rows[idx];
      const opensHeader = openSection !== row.section;
      const cost = ROW_MM + (opensHeader ? SECTION_ROW_MM : 0);
      if (pageRows.length > 0 && used + cost > cap) break;
      used += cost;
      if (opensHeader) openSection = row.section;
      pageRows.push(row);
      idx++;
    }
    pages.push(pageRows);
  }
  return pages;
}

// The true last page reserves TOTALS_MM + SIGN_MM instead of CONTINUED_MM, which is much
// less room. If the rows greedily assigned to the last page don't actually fit once that
// real reservation is applied, push the overflow onto a new page and re-check. Capped at
// 10 iterations to guarantee termination.
function fixLastPageOverflow(pages: EstimateRow[][], contentMm: number): EstimateRow[][] {
  const result = pages.map(p => [...p]);
  for (let iter = 0; iter < 10; iter++) {
    const lastIdx = result.length - 1;
    const cap = usableMm(lastIdx === 0, true, contentMm);
    let used = 0;
    let openSection: EstimateSection | null = null;
    let overflowAt = -1;
    for (let i = 0; i < result[lastIdx].length; i++) {
      const row = result[lastIdx][i];
      const opensHeader = openSection !== row.section;
      const cost = ROW_MM + (opensHeader ? SECTION_ROW_MM : 0);
      if (used + cost > cap) { overflowAt = i; break; }
      used += cost;
      if (opensHeader) openSection = row.section;
    }
    if (overflowAt <= 0) break; // fits, or a single row alone already exceeds the cap - nothing more to push
    result.push(result[lastIdx].splice(overflowAt));
  }
  return result;
}

function layoutEstimatePages(rows: EstimateRow[], contentMm: number): EstimateRow[][] {
  if (rows.length === 0) return [[]];
  const greedy = greedyFillToMax(rows, contentMm);
  return fixLastPageOverflow(greedy, contentMm);
}

/**
 * Why an estimate cannot be trusted, and WHAT KIND of problem it is.
 *
 * It was a plain string[]. Every consumer then had to render one message for the whole
 * array, and that message was accurate only while the array was HOMOGENEOUS - every entry
 * being a missing RATE. The moment a second kind arrived (a measurement the operator had
 * not entered yet), the internal-inspection indicator went on saying "Rate not configured",
 * sending an operator to the Estimate Master to fix something that was not broken.
 *
 * Nothing was introduced by that change: the message's truth had always depended on a
 * property of the array that nothing stated or enforced. A `kind` states it, and a new kind
 * added later reaches every reader without any of them being edited - which a second
 * parallel array would not, since each reader would have to learn about both and stay in
 * step.
 *
 * 'missing-rate'  - configuration: a rate is absent from the master and Schedule-A.
 *                   Fixed in Estimate Master, by whoever maintains rates.
 * 'missing-input' - observation: the inspector recorded something but not the measurement
 *                   it needs. Fixed on the inspection form, by the person in front of it.
 */
export interface EstimateRateError {
  kind: 'missing-rate' | 'missing-input';
  message: string;
}

export interface SingleEstimateLineItem {
  sr: number;
  itemCode?: string;
  desc: string;
  unit: string;
  qty: string;
  numQty: number;
  /** null when no rate could be resolved - render as a blank cell, not 0.00. */
  rate: number | null;
  amt: number;
}

export interface SingleJobEstimateData {
  job: any;
  externalData?: any;
  internalData?: any;
  physicalItems: SingleEstimateLineItem[];
  internalItems: SingleEstimateLineItem[];
  labourItems: SingleEstimateLineItem[];
  baseTotal: number;
  atPercentage: number;
  percentageAmount: number;
  amountWithPercentage: number;
  lessAmount: number;
  finalAmount: number;
  /** Messages for applicable items whose rate couldn't be resolved. Non-empty means
   *  the total must not be shown/trusted - see rateErrors handling in the renderer. */
  rateErrors: EstimateRateError[];
}

export function buildSingleJobEstimateData(
  job: any,
  agency: any,
  atMaster: any,
  externalData?: any,
  internalData?: any
): SingleJobEstimateData {
  const kva = String(job.capacityKva || '25').trim();
  const kvaNum = Number(kva) || 0;
  const band = bandForKva(kvaNum);
  const coreType = (job.coreType || 'CRGO').trim().toUpperCase();
  const masterList = getEstimateMasterForCore(agency, coreType);
  const atPercentage = getAtPercentageForCore(atMaster, coreType);

  const isScrap = job.status === 'Scrap' || job.condition === 'Scrap' || internalData?.condition === 'Scrap';
  const winding = (internalData?.windingType || 'Aluminium').trim();
  const isCopper = winding.toUpperCase().startsWith('CU');
  const windingSuffix = isCopper ? 'Copper' : 'Aluminium SE';

  const rateErrors: EstimateRateError[] = [];
  const coreClass = classifyCoreType(coreType);

  // SCRAP SHORT-CIRCUIT - must come before the core-type branch.
  //
  // A transformer declared scrap is inspected and dismantled; it receives none of the
  // repair work. Its estimate is exactly ONE line - the flat inspection & dismantling
  // charge for its core type - plus AT. No physical items, no internal items, no
  // labour, and no Schedule-B fixed rate.
  //
  // This has to short-circuit rather than modify. Previously `isScrap` only zeroed
  // SOME itemised lines, so a scrap CRGO job still billed name plating, spray
  // painting, rod gaskets, the unconditional Rs 2,061 labour charge and more, with
  // the Rs 500 scrap line merely APPENDED to a repair estimate. Worse, the
  // Amorphous/Wound Core branch below returns before the scrap line is ever reached,
  // so a scrap Amorphous unit billed the full Schedule-B repair rate and no scrap
  // charge at all.
  if (isScrap) {
    const scrapCharge = resolveScrapCharge(coreType, kva, masterList);
    if (scrapCharge.error) rateErrors.push({ kind: 'missing-rate', message: scrapCharge.error });

    const scrapAmt = scrapCharge.rate ?? 0;
    const scrapItems: SingleEstimateLineItem[] = [{
      sr: 1,
      itemCode: scrapCharge.code ?? '-',
      desc: 'Inspection & Dismantling Charges - Transformer Declared Scrap by E.E. (TR)',
      unit: 'NOS',
      qty: '1',
      numQty: 1,
      rate: scrapCharge.rate,
      amt: scrapAmt
    }];

    const scrapPercentageAmount = Number((scrapAmt * (atPercentage / 100)).toFixed(2));
    const scrapWithPercentage = Number((scrapAmt + scrapPercentageAmount).toFixed(2));

    return {
      job,
      externalData,
      internalData,
      physicalItems: scrapItems,
      internalItems: [],
      labourItems: [],
      baseTotal: scrapAmt,
      atPercentage,
      percentageAmount: scrapPercentageAmount,
      amountWithPercentage: scrapWithPercentage,
      lessAmount: 0,
      finalAmount: scrapWithPercentage, // no "Less" row on a scrap estimate
      rateErrors
    };
  }

  // Amorphous / CRGO Wound Core: FIXED RATE, not itemised. No physical/internal/labour
  // breakdown - external inspection is oil accounting only (no charge) and there is no
  // internal inspection for these core types, so none of the 29 CRGO items apply.
  if (coreClass === 'AMORPHOUS' || coreClass === 'WOUND_CORE') {
    const entry = findScheduleBEntry(kvaNum, isCopper, job.make);
    const fixedItems: SingleEstimateLineItem[] = [];
    const fixedRateErrors: EstimateRateError[] = [];

    if (!entry) {
      fixedRateErrors.push({ kind: 'missing-rate', message: `No fixed-rate entry found for ${kvaNum} KVA ${isCopper ? 'Copper' : 'Aluminium'} winding in UGVCL Schedule-B.` });
      fixedItems.push({ sr: 1, desc: 'Repairing Charge - Fixed Rate (Internal & External)', unit: 'NOS', qty: '-', numQty: 0, rate: null, amt: 0 });
      fixedItems.push({ sr: 2, desc: 'Labour Charge', unit: 'NOS', qty: '-', numQty: 0, rate: null, amt: 0 });
    } else {
      // basis 'coil': a standard three-phase distribution transformer has 3 limbs, so
      // 3 coils. There's no coil-count field on the job (internalData.totCoil is a coil
      // WEIGHT in kg, used elsewhere as weight x rate-per-kg - not a count, and using it
      // as one here would bill e.g. a 47kg coil as 47 units). If a real coil-count field
      // is ever added to the data model, replace this constant with it.
      const COIL_COUNT_THREE_PHASE = 3;
      const qty = entry.basis === 'coil' ? COIL_COUNT_THREE_PHASE : 1;
      const mainAmt = entry.fixedRate * qty;
      fixedItems.push({
        sr: 1,
        itemCode: entry.sr,
        desc: 'Repairing Charge - Fixed Rate (Internal & External)',
        unit: 'NOS',
        qty: String(qty),
        numQty: qty,
        rate: entry.fixedRate,
        amt: mainAmt
      });
      const labourRate = entry.labourPerTransformer ?? 0;
      fixedItems.push({
        sr: 2,
        itemCode: entry.sr,
        desc: 'Labour Charge',
        unit: 'NOS',
        qty: '1',
        numQty: 1,
        rate: labourRate,
        amt: labourRate
      });
    }

    const fixedBaseTotal = fixedItems.reduce((acc, i) => acc + i.amt, 0);
    const fixedPercentageAmount = Number((fixedBaseTotal * (atPercentage / 100)).toFixed(2));
    const fixedAmountWithPercentage = Number((fixedBaseTotal + fixedPercentageAmount).toFixed(2));

    return {
      job,
      externalData,
      internalData,
      physicalItems: fixedItems,
      internalItems: [],
      labourItems: [],
      baseTotal: fixedBaseTotal,
      atPercentage,
      percentageAmount: fixedPercentageAmount,
      amountWithPercentage: fixedAmountWithPercentage,
      lessAmount: 0,
      finalAmount: fixedAmountWithPercentage, // no "Less" row for fixed-rate estimates
      rateErrors: fixedRateErrors
    };
  }

  // Itemised (CRGO / OH) estimates derive nearly every quantity from the inspection
  // records. With a record entirely absent, each optional-chained read below falls
  // through to its per-capacity default and the estimate comes out looking valid -
  // which is how estimates were silently priced off defaults instead of real
  // inspections. Treat a wholly missing record as blocking, exactly like a missing
  // rate: the per-field defaults stay legitimate only INSIDE a real inspection.
  const hasExternalData = !!externalData && Object.keys(externalData).length > 0;
  const hasInternalData = !!internalData && Object.keys(internalData).length > 0;
  const jobLabel = job.jobNo || job.id || 'This job';
  if (!hasExternalData) {
    rateErrors.push({ kind: 'missing-input', message: `${jobLabel}: no external inspection data - quantities cannot be derived.` });
  }
  if (!hasInternalData) {
    rateErrors.push({ kind: 'missing-input', message: `${jobLabel}: no internal inspection data - quantities cannot be derived.` });
  }

  const scheduleRate = (sr: string): number | undefined => {
    const entry = SCHEDULE_A.find(i => i.sr === sr);
    return entry?.rates[band];
  };

  // Lookup order: (1) the agency's own saved estimate master, if it has a value for
  // this exact capacity, (2) UGVCL Schedule-A via bandForKva(), (3) nothing else -
  // no fixedRate fallback (that belongs to a different capacity) and no defaultEstimateData.
  const resolveRate = (masterCode: string, scheduleValue: number | undefined): number | null => {
    const found = masterList.find(m => m.itemCode?.toLowerCase() === masterCode.toLowerCase());
    if (found?.rates) {
      const masterVal = found.rates[kva as keyof typeof found.rates];
      if (masterVal !== undefined && masterVal !== null && !isNaN(Number(masterVal)) && Number(masterVal) > 0) {
        return Number(masterVal);
      }
    }
    return (scheduleValue !== undefined && scheduleValue > 0) ? scheduleValue : null;
  };

  // Only items that actually apply to this job (qty > 0 / 'Y') need a resolvable rate -
  // an inapplicable item contributes 0 regardless, so a missing rate there just leaves
  // the printed rate cell blank instead of blocking the whole estimate.
  const recordErrorIfApplies = (applies: boolean, rate: number | null, label: string, customMessage?: string) => {
    if (applies && rate === null) {
      rateErrors.push({ kind: 'missing-rate', message: customMessage || `No rate found for "${label}" at ${kva} KVA (checked agency estimate master and UGVCL Schedule-A).` });
    }
  };

  // 1. PHYSICAL ESTIMATION ITEMS
  const physicalItems: SingleEstimateLineItem[] = [];
  let srCounter = 1;

  // 1. Name Plating
  // CHARGES ON AN EXPLICIT 'Y' ONLY (AUDIT F46).
  //
  // The test was `!(v === 'N' || v === '0')` - "anything that is not N". That charged on
  // '-' (not applicable), on 'TBR', and on an UNSET field, because `undefined` matches
  // neither exclusion. '-' is the default an unsaved internal inspection carries, so a job
  // nobody had internally inspected was charged Inside Painting, Insulating Material and
  // every other flag on the row. That population overlaps exactly with the inspections lost
  // in the silent-denial window (F45).
  //
  // Charging on the affirmative is the only shape that cannot do this: a value nobody chose
  // can never be an affirmative. `namePlate` alone already excluded '-' - the rule was known
  // and applied once, in ten places that needed it.
  const npApplies = externalData?.namePlate === 'Y';
  const npQtyStr = npApplies ? 'Y' : 'N';
  const npRate = resolveRate('16', scheduleRate('16'));
  recordErrorIfApplies(npApplies, npRate, 'Name Plating');
  const npAmt = npApplies ? (npRate ?? 0) : 0;
  physicalItems.push({ sr: srCounter++, itemCode: '16', desc: 'Name Plating', unit: 'NO', qty: npQtyStr, numQty: npApplies ? 1 : 0, rate: npRate, amt: npAmt });

  // 2. Spray painting
  const spApplies = externalData?.outsidePaint === 'Y';
  const spQtyStr = spApplies ? 'Y' : 'N';
  const spRate = resolveRate('2b', scheduleRate('2b'));
  recordErrorIfApplies(spApplies, spRate, 'Spray painting');
  const spAmt = spApplies ? (spRate ?? 0) : 0;
  physicalItems.push({ sr: srCounter++, itemCode: '2b', desc: 'Spray painting', unit: 'NO', qty: spQtyStr, numQty: spApplies ? 1 : 0, rate: spRate, amt: spAmt });

  // 3. Conservator Tank Replacement (Schedule-A sr '18b' - app's own code '4' doesn't match)
  const ctQty = Number(externalData?.damCtTank) || 0;
  const ctApplies = ctQty > 0;
  const ctRate = resolveRate('4', scheduleRate('18b'));
  recordErrorIfApplies(ctApplies, ctRate, 'Conservator Tank Replacement');
  physicalItems.push({ sr: srCounter++, itemCode: '4', desc: 'Conservator Tank Replacement', unit: 'KG', qty: ctQty > 0 ? ctQty.toString() : '0', numQty: ctQty, rate: ctRate, amt: ctApplies ? ctQty * (ctRate ?? 0) : 0 });

  // 4. Radiator Replacement (Schedule-A sr '20' - app's own code '21' doesn't match).
  // Above 100 KVA the schedule is capacity-specific, not banded - 315 KVA isn't in the
  // tender at all, so it's left unresolved (blocked) rather than interpolated.
  const radQty = Number(externalData?.damRadNo) || 0;
  const radApplies = radQty > 0;
  const radScheduleValue = kvaNum > 100 ? RADIATOR_ABOVE_100[kvaNum] : scheduleRate('20');
  const radRate = resolveRate('21', radScheduleValue);
  recordErrorIfApplies(radApplies, radRate, 'Radiator Replacement');
  physicalItems.push({ sr: srCounter++, itemCode: '21', desc: 'Radiator Replacement', unit: 'NO', qty: radQty > 0 ? radQty.toString() : '0', numQty: radQty, rate: radRate, amt: radApplies ? radQty * (radRate ?? 0) : 0 });

  // 5. Rod Gasket
  const rodQty = externalData?.hvLvRod !== undefined && externalData?.hvLvRod !== '' ? Number(externalData.hvLvRod) : 7;
  const rodApplies = rodQty > 0;
  const rodRate = resolveRate('1c', scheduleRate('1c'));
  recordErrorIfApplies(rodApplies, rodRate, 'Rod Gasket');
  physicalItems.push({ sr: srCounter++, itemCode: '1c', desc: 'Rod Gasket', unit: 'ROD', qty: rodQty.toString(), numQty: rodQty, rate: rodRate, amt: rodApplies ? rodQty * (rodRate ?? 0) : 0 });

  // 6. M/S Bolt Nuts
  const bnApplies = externalData?.nuteBolt === 'Y';
  const bnQtyStr = bnApplies ? 'Y' : 'N';
  const bnRate = resolveRate('1e', scheduleRate('1e'));
  recordErrorIfApplies(bnApplies, bnRate, 'M/S Bolt Nuts');
  const bnAmt = bnApplies ? (bnRate ?? 0) : 0;
  physicalItems.push({ sr: srCounter++, itemCode: '1e', desc: 'M/S Bolt Nuts', unit: 'JOB', qty: bnQtyStr, numQty: bnApplies ? 1 : 0, rate: bnRate, amt: bnAmt });

  // 7. Top Cover Gasket
  const gaskQty = externalData?.gasket !== undefined && externalData?.gasket !== '' ? Number(externalData.gasket) : (Number(kva) >= 63 ? 3 : 1);
  const gaskApplies = gaskQty > 0;
  const gaskRate = resolveRate('1b', scheduleRate('1b'));
  recordErrorIfApplies(gaskApplies, gaskRate, 'Top Cover Gasket');
  physicalItems.push({ sr: srCounter++, itemCode: '1b', desc: 'Top Cover Gasket', unit: 'NO', qty: gaskQty.toString(), numQty: gaskQty, rate: gaskRate, amt: gaskApplies ? gaskQty * (gaskRate ?? 0) : 0 });

  // 8. Oil Guage Glass
  const oggApplies = externalData?.oilLevGls === 'Y';
  const oggQtyStr = oggApplies ? 'Y' : 'N';
  const oggRate = resolveRate('5', scheduleRate('5'));
  recordErrorIfApplies(oggApplies, oggRate, 'Oil Guage Glass');
  const oggAmt = oggApplies ? (oggRate ?? 0) : 0;
  physicalItems.push({ sr: srCounter++, itemCode: '5', desc: 'Oil Guage Glass', unit: 'NO', qty: oggQtyStr, numQty: oggApplies ? 1 : 0, rate: oggRate, amt: oggAmt });

  // 9. Breather
  const brApplies = externalData?.breather === 'Y';
  const brQtyStr = brApplies ? 'Y' : 'N';
  const brRate = resolveRate('6', scheduleRate('6'));
  recordErrorIfApplies(brApplies, brRate, 'Breather');
  const brAmt = brApplies ? (brRate ?? 0) : 0;
  physicalItems.push({ sr: srCounter++, itemCode: '6', desc: 'Breather', unit: 'NO', qty: brQtyStr, numQty: brApplies ? 1 : 0, rate: brRate, amt: brAmt });

  // 10. HV Bushing (Schedule-A sr '8-A', 11kV). The job data model has no voltage-class
  // field, so 11kV is assumed here - matching the 11kV assumption made everywhere else
  // in this app (job metadata, the KV column). A 22kV job would need sr '8-B' (Rs 265);
  // that needs a voltage field on the job to select it, which is a separate change.
  const hvbQty = externalData?.hvSideHvb !== undefined && externalData?.hvSideHvb !== '' ? Number(externalData.hvSideHvb) : 3;
  const hvbApplies = hvbQty > 0;
  const hvbRate = resolveRate('8', scheduleRate('8-A'));
  recordErrorIfApplies(hvbApplies, hvbRate, 'HV Bushing');
  physicalItems.push({ sr: srCounter++, itemCode: '8', desc: 'HV Bushing', unit: 'NO', qty: hvbQty.toString(), numQty: hvbQty, rate: hvbRate, amt: hvbApplies ? hvbQty * (hvbRate ?? 0) : 0 });

  // 11. HV Metal Parts
  const hvmQty = externalData?.hvSideHvm !== undefined && externalData?.hvSideHvm !== '' ? Number(externalData.hvSideHvm) : 2;
  const hvmApplies = hvmQty > 0;
  const hvmRate = resolveRate('9A', scheduleRate('9A'));
  recordErrorIfApplies(hvmApplies, hvmRate, 'HV Metal Parts');
  physicalItems.push({ sr: srCounter++, itemCode: '9A', desc: 'HV Metal Parts', unit: 'NO', qty: hvmQty.toString(), numQty: hvmQty, rate: hvmRate, amt: hvmApplies ? hvmQty * (hvmRate ?? 0) : 0 });

  // 12. HV Connectors
  const hvcQty = externalData?.hvSideHvCc !== undefined && externalData?.hvSideHvCc !== '' ? Number(externalData.hvSideHvCc) : 0;
  const hvcApplies = hvcQty > 0;
  const hvcRate = resolveRate('9B', scheduleRate('9B'));
  recordErrorIfApplies(hvcApplies, hvcRate, 'HV Connectors');
  physicalItems.push({ sr: srCounter++, itemCode: '9B', desc: 'HV Connectors', unit: 'NO', qty: hvcQty.toString(), numQty: hvcQty, rate: hvcRate, amt: hvcApplies ? hvcQty * (hvcRate ?? 0) : 0 });

  // 13. LV Bushing
  const lvbQty = externalData?.lvSideLvb !== undefined && externalData?.lvSideLvb !== '' ? Number(externalData.lvSideLvb) : 1;
  const lvbApplies = lvbQty > 0;
  const lvbRate = resolveRate('10', scheduleRate('10'));
  recordErrorIfApplies(lvbApplies, lvbRate, 'LV Bushing');
  physicalItems.push({ sr: srCounter++, itemCode: '10', desc: 'LV Bushing', unit: 'NO', qty: lvbQty.toString(), numQty: lvbQty, rate: lvbRate, amt: lvbApplies ? lvbQty * (lvbRate ?? 0) : 0 });

  // 14. LV Metal Parts
  const lvmQty = externalData?.lvSideLvm !== undefined && externalData?.lvSideLvm !== '' ? Number(externalData.lvSideLvm) : 4;
  const lvmApplies = lvmQty > 0;
  const lvmRate = resolveRate('11A', scheduleRate('11A'));
  recordErrorIfApplies(lvmApplies, lvmRate, 'LV Metal Parts');
  physicalItems.push({ sr: srCounter++, itemCode: '11A', desc: 'LV Metal Parts', unit: 'NO', qty: lvmQty.toString(), numQty: lvmQty, rate: lvmRate, amt: lvmApplies ? lvmQty * (lvmRate ?? 0) : 0 });

  // 15. LV Connectors
  const lvcQty = externalData?.lvSideLvCc !== undefined && externalData?.lvSideLvCc !== '' ? Number(externalData.lvSideLvCc) : 0;
  const lvcApplies = lvcQty > 0;
  const lvcRate = resolveRate('11B', scheduleRate('11B'));
  recordErrorIfApplies(lvcApplies, lvcRate, 'LV Connectors');
  physicalItems.push({ sr: srCounter++, itemCode: '11B', desc: 'LV Connectors', unit: 'NO', qty: lvcQty.toString(), numQty: lvcQty, rate: lvcRate, amt: lvcApplies ? lvcQty * (lvcRate ?? 0) : 0 });

  // 16. Sealed to Bolted
  const stbIsBolted = (externalData?.sealType === 'B' || externalData?.sealType === 'Bolted' || externalData?.sealType === 'Y');
  const stbQtyStr = stbIsBolted ? 'Y' : 'N';
  const stbRate = resolveRate('17', scheduleRate('17'));
  recordErrorIfApplies(stbIsBolted, stbRate, 'Sealed to Bolted');
  const stbAmt = stbIsBolted ? (stbRate ?? 0) : 0;
  physicalItems.push({ sr: srCounter++, itemCode: '17', desc: 'Sealed to Bolted', unit: 'NO', qty: stbQtyStr, numQty: stbIsBolted ? 1 : 0, rate: stbRate, amt: stbAmt });


  // 2. INTERNAL ESTIMATION ITEMS
  const internalItems: SingleEstimateLineItem[] = [];

  // 17. Inside Painting
  const ipApplies = internalData?.inPnt === 'Y';
  const ipQtyStr = ipApplies ? 'Y' : 'N';
  const ipRate = resolveRate('3', scheduleRate('3'));
  recordErrorIfApplies(ipApplies, ipRate, 'Inside Painting');
  const ipAmt = ipApplies ? (ipRate ?? 0) : 0;
  internalItems.push({ sr: srCounter++, itemCode: '3', desc: 'Inside Painting', unit: 'NO', qty: ipQtyStr, numQty: ipApplies ? 1 : 0, rate: ipRate, amt: ipAmt });

  // 18. Insulating Material
  const insApplies = internalData?.insula === 'Y';
  const insQtyStr = insApplies ? 'Y' : 'N';
  const insRate = resolveRate('1d', scheduleRate('1d'));
  recordErrorIfApplies(insApplies, insRate, 'Insulating Material');
  const insAmt = insApplies ? (insRate ?? 0) : 0;
  internalItems.push({ sr: srCounter++, itemCode: '1d', desc: 'Insulating Material', unit: 'JOB', qty: insQtyStr, numQty: insApplies ? 1 : 0, rate: insRate, amt: insAmt });

  // 19. Washer Ring
  const wrQty = internalData?.wasring !== undefined && internalData?.wasring !== '' ? Number(internalData.wasring) : 6;
  const wrApplies = wrQty > 0;
  const wrRate = resolveRate('15', scheduleRate('15'));
  recordErrorIfApplies(wrApplies, wrRate, 'Washer Ring');
  internalItems.push({ sr: srCounter++, itemCode: '15', desc: 'Washer Ring', unit: 'NO', qty: wrQty.toString(), numQty: wrQty, rate: wrRate, amt: wrApplies ? wrQty * (wrRate ?? 0) : 0 });

  // 20. HV Coil(Aluminium SE)-N
  // NO PER-CAPACITY DEFAULT. It used to fall through to 47.00 kg at 63 kVA when no weight
  // was recorded - a fabricated REPLACEMENT weight (Schedule-A has no HV re-insulation
  // item; the tender clause says "Replacement of all the HV windings"). It fired on the
  // NOTHING-WRONG path: with all damage counts zero, `totCoil` is the string "0", which is
  // falsy, so the second branch was skipped and the constant charged HV replacement on a
  // transformer with no HV work at all.
  //
  // Two honest outcomes now: a weight computed from what was measured, or no HV coil line.
  let hvCoilWeight = 0;
  const hvDamagedCoils =
    (Number(internalData?.damR) || 0) + (Number(internalData?.damY) || 0) + (Number(internalData?.damB) || 0);
  if (internalData?.totWt && Number(internalData.totWt) > 0) {
    hvCoilWeight = Number(internalData.totWt);
  } else if (Number(internalData?.wtOfCoil) > 0 && hvDamagedCoils > 0) {
    hvCoilWeight = Number(internalData.wtOfCoil) * hvDamagedCoils;
  }
  const hvCoilApplies = hvCoilWeight > 0;
  // Damage recorded but no per-coil weight entered. Removing the default turns a wrong
  // charge into NO charge, which is worse if it passes silently - so it blocks by name.
  if (hasInternalData && hvDamagedCoils > 0 && hvCoilWeight === 0) {
    rateErrors.push({ kind: 'missing-input', message: `${jobLabel}: ${hvDamagedCoils} HV coil(s) marked damaged but no per-coil weight ("Wt of Coil") was recorded, so the HV coil charge cannot be calculated.` });
  }
  // WITHOUT S.E. - '12A-b', Rs 163/kg. An AGENCY FACT, confirmed by the operator: these
  // agencies do not use super-enamelled conductor when rewinding, so the without-S.E.
  // variant is the applicable one on both windings (AUDIT O20, F47).
  //
  // Supersedes the previous reasoning, which is worth stating because it was wrong in an
  // instructive way: '12A-b1' (with S.E., Rs 213/kg) was kept because it matched the rate
  // the app already produced on estimates issued to and accepted by UGVCL. That is
  // consistency with prior output, not evidence about the tender - a figure being on an
  // accepted document says the customer did not object, not that it was right. It
  // overcharged HV coil work by Rs 50/kg.
  //
  // Copper stays blocked rather than guessed: '12A-a' w/o S.E. Rs 357 against '12A-a1'
  // w/ S.E. Rs 407. The agency fact resolves the S.E. axis, not the material axis.
  const hvCoilScheduleValue = isCopper ? undefined : scheduleRate('12A-b');
  const hvCoilRate = resolveRate('12A', hvCoilScheduleValue);
  recordErrorIfApplies(
    hvCoilApplies,
    hvCoilRate,
    'HV Coil',
    isCopper ? 'Copper HV coil rate requires confirmation of S.E. variant - see tender Schedule-A item 12A.' : undefined
  );
  const hvCoilAmt = hvCoilApplies ? hvCoilWeight * (hvCoilRate ?? 0) : 0;
  internalItems.push({
    sr: srCounter++,
    itemCode: '12A',
    desc: `HV Coil(${windingSuffix})-N`,
    unit: 'KG',
    qty: hvCoilWeight.toFixed(2),
    numQty: hvCoilWeight,
    rate: hvCoilRate,
    amt: hvCoilAmt
  });

  // 21. LV Coil(Aluminium)-N
  let lvCoilWeight = 0;
  if (internalData?.totWtLv && Number(internalData.totWtLv) > 0) {
    lvCoilWeight = Number(internalData.totWtLv);
  }
  const lvCoilApplies = lvCoilWeight > 0;
  // Same rule as HV: an observation without its weight must surface, never price at zero.
  const lvStates = [internalData?.lvCoilR, internalData?.lvCoilY, internalData?.lvCoilB];
  const lvDamCount = lvStates.filter(v => v === 'DAM').length;
  const lvRiCount = lvStates.filter(v => v === 'RI').length;
  if (hasInternalData && (lvDamCount > 0 || lvRiCount > 0) && !(Number(internalData?.wtOfCoilLv) > 0)) {
    rateErrors.push({ kind: 'missing-input', message: `${jobLabel}: LV coils marked ${lvDamCount ? `${lvDamCount} damaged` : ''}${lvDamCount && lvRiCount ? ' and ' : ''}${lvRiCount ? `${lvRiCount} for re-insulation` : ''}, but no per-coil weight ("Wt of Coil LV") was recorded, so the LV charge cannot be calculated.` });
  }
  // WITHOUT S.E. - '13A-b', Rs 149/kg. Same agency fact as the HV coil above: these
  // agencies do not use super-enamelled conductor, so both windings take the without-S.E.
  // variant. This side was already correct; the reason is stated here too so the two
  // sites carry the same justification rather than one being explained and the other
  // silently agreeing with it.
  //
  // Copper blocked, not guessed: '13A-a' Rs 314 against '13A-a1' Rs 364.
  const lvCoilScheduleValue = isCopper ? undefined : scheduleRate('13A-b');
  const lvCoilRate = resolveRate('13A', lvCoilScheduleValue);
  recordErrorIfApplies(
    lvCoilApplies,
    lvCoilRate,
    'LV Coil',
    isCopper ? 'Copper LV coil rate requires confirmation of S.E. variant - see tender Schedule-A item 13A.' : undefined
  );
  const lvCoilAmt = lvCoilApplies ? lvCoilWeight * (lvCoilRate ?? 0) : 0;
  internalItems.push({
    sr: srCounter++,
    itemCode: '13A',
    desc: `LV Coil(${isCopper ? 'Copper' : 'Aluminium'})-N`,
    unit: 'KG',
    qty: lvCoilWeight.toFixed(2),
    numQty: lvCoilWeight,
    rate: lvCoilRate,
    amt: lvCoilAmt
  });

  // 22. Re-insulation LV Coil(Aluminium) - Schedule-A '14-i'/'14-ii', no S.E. split
  // DRIVEN BY THE COILS MARKED 'RI', exactly as 13A is driven by those marked 'DAM'.
  //
  // The old guard tested `!== 'DMG'` - a value the form NEVER emits, since the selector
  // offers 'DAM'. So the comparison never matched, every observation fell through, and
  // item 14 was charged from a per-capacity constant whenever no replacement weight
  // existed. The constants were not a design decision; they were covering for a
  // comparison that could not read the value that was already there.
  //
  // Consequences of that, both now gone: an all-OK transformer was charged for
  // re-insulation nobody performed, and marking a coil damaged REDUCED the estimate,
  // because the fabricated weight was larger than the real one for any coil under
  // ~18.75 kg.
  //
  // Stored `totWtLvReIns` is preferred; recomputed from the coil states when absent, so
  // records saved before the split still price correctly.
  const reInsWeight = Number(internalData?.totWtLvReIns) > 0
    ? Number(internalData.totWtLvReIns)
    : lvRiCount * (Number(internalData?.wtOfCoilLv) || 0);
  const reInsApplies = reInsWeight > 0;
  const reInsRate = resolveRate('14', scheduleRate(isCopper ? '14-i' : '14-ii'));
  recordErrorIfApplies(reInsApplies, reInsRate, 'Re-insulation LV Coil');
  const reInsAmt = reInsApplies ? reInsWeight * (reInsRate ?? 0) : 0;
  internalItems.push({
    sr: srCounter++,
    itemCode: '14',
    desc: `Re-insulation LV Coil(${isCopper ? 'Copper' : 'Aluminium'})`,
    unit: 'KG',
    qty: reInsWeight.toFixed(2),
    numQty: reInsWeight,
    rate: reInsRate,
    amt: reInsAmt
  });


  // 3. LABOUR CHARGE ITEMS
  const labourItems: SingleEstimateLineItem[] = [];

  // 23. Labour Charge (Basic Dismantling / DC) - 100% Mandatory
  const dcRate = resolveRate('1a', scheduleRate('1a'));
  recordErrorIfApplies(true, dcRate, 'Labour Charge');
  labourItems.push({ sr: srCounter++, itemCode: '1a', desc: 'Labour Charge', unit: 'JOB', qty: '1', numQty: 1, rate: dcRate, amt: dcRate ?? 0 });

  // 24. Cleaning dirty tank
  const cdtApplies = externalData?.clnDrtyTank === 'Y';
  const cdtQtyStr = cdtApplies ? 'Y' : 'N';
  const cdtRate = resolveRate('2a', scheduleRate('2a'));
  recordErrorIfApplies(cdtApplies, cdtRate, 'Cleaning dirty tank');
  const cdtAmt = cdtApplies ? (cdtRate ?? 0) : 0;
  labourItems.push({ sr: srCounter++, itemCode: '2a', desc: 'Cleaning dirty tank', unit: 'NO', qty: cdtQtyStr, numQty: cdtApplies ? 1 : 0, rate: cdtRate, amt: cdtAmt });

  // 25. Drying of active parts
  // Two fields, either of which can authorise drying: the internal `dc` flag or the
  // external `dryActPart`. Affirmative on EITHER charges; neither being 'Y' does not.
  const dryApplies = internalData?.dc === 'Y' || externalData?.dryActPart === 'Y';
  const dryQtyStr = dryApplies ? 'Y' : 'N';
  const dryRate = resolveRate('1f', scheduleRate('1f'));
  recordErrorIfApplies(dryApplies, dryRate, 'Drying of active parts');
  const dryAmt = dryApplies ? (dryRate ?? 0) : 0;
  labourItems.push({ sr: srCounter++, itemCode: '1f', desc: 'Drying of active parts', unit: 'JOB', qty: dryQtyStr, numQty: dryApplies ? 1 : 0, rate: dryRate, amt: dryAmt });

  // (The Scrap line that used to sit here is gone. A scrap transformer never reaches
  // this path - it short-circuits at the top of the function into a single flat
  // charge. Appending a scrap line to a repair estimate was the bug, not the fix.)

  // 27. Testing Charge (Schedule-A sr '19' "Testing of transformer" - app's own code '20' doesn't match)
  const testApplies = internalData?.tstTrn === 'Y';
  const testQtyStr = testApplies ? 'Y' : 'N';
  const testRate = resolveRate('20', scheduleRate('19'));
  recordErrorIfApplies(testApplies, testRate, 'Testing Charge');
  const testAmt = testApplies ? (testRate ?? 0) : 0;
  labourItems.push({ sr: srCounter++, itemCode: '20', desc: 'Testing Charge', unit: 'NO', qty: testQtyStr, numQty: testApplies ? 1 : 0, rate: testRate, amt: testAmt });

  // 28. Labour HV Coil(Aluminium) - Schedule-A '12C-a'/'12C-b', no S.E. split
  const lbrHvWeight = hvCoilWeight;
  const lbrHvApplies = lbrHvWeight > 0;
  const lbrHvRate = resolveRate('12C', scheduleRate(isCopper ? '12C-a' : '12C-b'));
  recordErrorIfApplies(lbrHvApplies, lbrHvRate, 'Labour HV Coil');
  const lbrHvAmt = lbrHvApplies ? lbrHvWeight * (lbrHvRate ?? 0) : 0;
  labourItems.push({
    sr: srCounter++,
    itemCode: '12C',
    desc: `Labour HV Coil(${isCopper ? 'Copper' : 'Aluminium'})`,
    unit: 'KG',
    qty: lbrHvWeight.toFixed(2),
    numQty: lbrHvWeight,
    rate: lbrHvRate,
    amt: lbrHvAmt
  });

  // 29. Labour LV Coil(Aluminium) - Schedule-A '13C-a'/'13C-b', no S.E. split
  const lbrLvWeight = lvCoilWeight;
  const lbrLvApplies = lbrLvWeight > 0;
  const lbrLvRate = resolveRate('13C', scheduleRate(isCopper ? '13C-a' : '13C-b'));
  recordErrorIfApplies(lbrLvApplies, lbrLvRate, 'Labour LV Coil');
  const lbrLvAmt = lbrLvApplies ? lbrLvWeight * (lbrLvRate ?? 0) : 0;
  labourItems.push({
    sr: srCounter++,
    itemCode: '13C',
    desc: `Labour LV Coil(${isCopper ? 'Copper' : 'Aluminium'})`,
    unit: 'KG',
    qty: lbrLvWeight.toFixed(2),
    numQty: lbrLvWeight,
    rate: lbrLvRate,
    amt: lbrLvAmt
  });

  // Calculate Totals
  const physicalTot = physicalItems.reduce((acc, i) => acc + i.amt, 0);
  const internalTot = internalItems.reduce((acc, i) => acc + i.amt, 0);
  const labourTot = labourItems.reduce((acc, i) => acc + i.amt, 0);

  const baseTotal = physicalTot + internalTot + labourTot;
  const percentageAmount = Number((baseTotal * (atPercentage / 100)).toFixed(2));
  const amountWithPercentage = Number((baseTotal + percentageAmount).toFixed(2));
  const lessAmount = 0.00;
  const finalAmount = Number((amountWithPercentage - lessAmount).toFixed(2));

  return {
    job,
    externalData,
    internalData,
    physicalItems,
    internalItems,
    labourItems,
    baseTotal,
    atPercentage,
    percentageAmount,
    amountWithPercentage,
    lessAmount,
    finalAmount,
    rateErrors
  };
}

export interface SingleJobEstimateReportProps {
  key?: React.Key;
  job: any;
  agency: any;
  atMaster: any;
  externalData?: any;
  internalData?: any;
  estimateDate?: string;
  letterDateText?: string;
  className?: string;
}

export default function SingleJobEstimateReport({
  job,
  agency,
  atMaster,
  externalData,
  internalData,
  estimateDate,
  letterDateText,
  className = ''
}: SingleJobEstimateReportProps) {
  const estimate = buildSingleJobEstimateData(job, agency, atMaster, externalData, internalData);
  const dateFormatted = letterDateText || formatDDMMYYYY(estimateDate || job.estimateSentDate || job.updatedAt || new Date());
  const mrDateFormatted = formatDDMMYYYY(job.dateOfIssue || job.mrDate || job.createdAt);
  const orderNo = agency?.atDetails?.orderNo || agency?.contractAgreementNo || atMaster?.orderNo || 'UGVCL/EE-T-1/TRANS-REP/2020-21/01/1102';
  const orderDate = agency?.atDetails?.orderDate || '16/04/2021';

  const windingTypeStr = estimate.internalData?.windingType === 'CU' ? 'Copper' : 'Aluminium SE';
  const voltageRating = job.starRating || job.ratingLevel || '3 Star';
  const oilCap = externalData?.oilCapLtrs || job.oilCapacity || '145.00';
  const oilShort = externalData?.lessOilLtrs || job.oilShortage || '0.00';

  const formatCurrency = (val: number) => {
    return val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // PrintableA4Page's actual usable content-area height, measured at runtime (it already
  // excludes the letterhead header/footer zones). First render lays out with the fallback;
  // once measured, state updates and the second render lays out with the real value.
  const measureContentAreaRef = useRef<HTMLDivElement | null>(null);
  const [contentMm, setContentMm] = useState<number>(FALLBACK_CONTENT_MM);

  useEffect(() => {
    const contentArea = measureContentAreaRef.current?.parentElement;
    if (!contentArea) return;
    const measured = (contentArea.getBoundingClientRect().height / 96) * 25.4;
    if (measured > 0) setContentMm(measured);
  }, []);

  // Flatten the three sections into one continuously-numbered row list, chunked across pages.
  const allRows: EstimateRow[] = [
    ...estimate.physicalItems.map(i => ({ ...i, section: 'physical' as const })),
    ...estimate.internalItems.map(i => ({ ...i, section: 'internal' as const })),
    ...estimate.labourItems.map(i => ({ ...i, section: 'labour' as const })),
  ];
  const sectionStartIndex: Record<EstimateSection, number> = {
    physical: 0,
    internal: estimate.physicalItems.length,
    labour: estimate.physicalItems.length + estimate.internalItems.length,
  };

  const pages = layoutEstimatePages(allRows, contentMm);
  const totalPages = pages.length;

  const coreClass = classifyCoreType(job.coreType || 'CRGO');

  // Amorphous / CRGO Wound Core: fixed-rate document, entirely different printed
  // format from the itemised CRGO/OH report below - separate render path.
  if (coreClass === 'AMORPHOUS' || coreClass === 'WOUND_CORE') {
    const isAmorphous = coreClass === 'AMORPHOUS';
    const titleText = isAmorphous
      ? 'ESTIMATION REPORT OF AMORPHOUS TRANSFORMER'
      : 'ESTIMATION REPORT OF CRGO WOUND CORE TRANSFORMER';
    const subHeadingText = isAmorphous
      ? 'ESTIMATE FOR REPAIRING OF AMORPHOUS DISTRIBUTION TRANSFORMERS'
      : 'ESTIMATE FOR REPAIRING OF CRGO WOUND CORE DISTRIBUTION TRANSFORMERS';
    const clauseText = agency?.amorphousClauseText || AMORPHOUS_ESTIMATE_TEXT.clause;
    const noteLtCoil = agency?.amorphousNoteLtCoil || AMORPHOUS_ESTIMATE_TEXT.noteLtCoil;
    const noteRadiator = agency?.amorphousNoteRadiator || AMORPHOUS_ESTIMATE_TEXT.noteRadiator;

    return (
      <>
        {pages.map((rows, pageIdx) => {
          const isFirst = pageIdx === 0;
          const isLast = pageIdx === totalPages - 1;

          return (
            <PrintableA4Page key={pageIdx} agency={agency} orientation="portrait" className={`text-black ${className}`}>
              <div ref={isFirst ? measureContentAreaRef : undefined} className="flex flex-col justify-between h-full text-black">
                <div>
                  <div className="text-center mb-2 pb-1 border-b-2 border-black">
                    <h2 className="text-sm font-black uppercase tracking-wider">{titleText}</h2>
                  </div>

                  {isFirst && (
                    <div className="grid grid-cols-2 text-[10px] border border-black p-2 mb-2 leading-relaxed bg-white">
                      <div className="space-y-0.5 border-r border-black pr-2">
                        <div className="flex">
                          <span className="font-bold w-24">Job No.:</span>
                          <span className="font-mono font-bold">{job.jobNo} {job.repairType === 'GP' ? '(GP)' : ''}</span>
                        </div>
                        <div className="flex">
                          <span className="font-bold w-24">Manufacturer:</span>
                          <span className="font-bold uppercase truncate">{job.make || '-'}</span>
                        </div>
                        <div className="flex">
                          <span className="font-bold w-24">Serial No.:</span>
                          <span className="font-mono">{job.serialNo || '-'}</span>
                        </div>
                        <div className="flex">
                          <span className="font-bold w-24">KVA/KV:</span>
                          <span className="font-bold">{job.capacityKva}/11</span>
                        </div>
                        <div className="flex">
                          <span className="font-bold w-24">Oil Capacity:</span>
                          <span className="font-mono">{Number(oilCap).toFixed(2)}</span>
                        </div>
                        <div className="flex">
                          <span className="font-bold w-24">Oil Shortage:</span>
                          <span className="font-mono">{Number(oilShort).toFixed(2)}</span>
                        </div>
                        <div className="flex text-[9px] pt-0.5">
                          <span className="font-bold w-24">Order No.:</span>
                          <span className="font-mono truncate">{orderNo}, Dt.: {formatDDMMYYYY(orderDate)}</span>
                        </div>
                      </div>

                      <div className="space-y-0.5 pl-2">
                        <div className="flex">
                          <span className="font-bold w-24">Date:</span>
                          <span className="font-mono">{dateFormatted}</span>
                        </div>
                        <div className="flex">
                          <span className="font-bold w-24">Division:</span>
                          <span className="font-bold uppercase">{job.division || 'SABARMATI'}</span>
                        </div>
                        <div className="flex">
                          <span className="font-bold w-24">Mr. No.:</span>
                          <span className="font-mono font-bold">{job.mrNo}</span>
                        </div>
                        <div className="flex">
                          <span className="font-bold w-24">Mr. Date:</span>
                          <span className="font-mono">{mrDateFormatted}</span>
                        </div>
                        <div className="flex">
                          <span className="font-bold w-24">Service Type:</span>
                          <span className="font-bold">{job.repairType || 'OGP'}</span>
                        </div>
                        <div className="flex">
                          <span className="font-bold w-24">Winding Type:</span>
                          <span className="font-bold">{windingTypeStr}</span>
                        </div>
                        <div className="flex">
                          <span className="font-bold w-24">Voltage Class:</span>
                          <span className="font-bold">{voltageRating}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {isFirst && (
                    <div className="text-center mb-2">
                      <p className="text-xs font-bold uppercase">{subHeadingText}</p>
                      <p className="text-xs font-bold uppercase mt-0.5">FIXED RATE (Internal &amp; External)</p>
                    </div>
                  )}

                  {isFirst && (
                    <p className="text-[9px] text-justify leading-relaxed mb-2">{clauseText}</p>
                  )}

                  <table className="w-full border-collapse border border-black text-[8.5px]">
                    <thead>
                      <tr className="bg-slate-100 print:bg-transparent font-bold border-b border-black text-center">
                        <th className="border border-black p-1 w-8">Sr. No.</th>
                        <th className="border border-black p-1 text-left min-w-[200px]">Item Description</th>
                        <th className="border border-black p-1 w-12">Unit</th>
                        <th className="border border-black p-1 w-14">Quantity</th>
                        <th className="border border-black p-1 text-right w-16">Unit Rate</th>
                        <th className="border border-black p-1 text-right w-20">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((item) => (
                        <tr key={`item-${item.sr}`} className="border-b border-slate-300 print:border-black h-4">
                          <td className="border-r border-black p-0.5 text-center font-mono">{item.sr}</td>
                          <td className="border-r border-black p-0.5 pl-1">{item.desc}</td>
                          <td className="border-r border-black p-0.5 text-center font-semibold">{item.unit}</td>
                          <td className="border-r border-black p-0.5 text-center font-mono">{item.qty}</td>
                          <td className="border-r border-black p-0.5 text-right font-mono">{item.rate === null ? '' : formatCurrency(item.rate)}</td>
                          <td className="border-r border-black p-0.5 text-right font-mono font-medium">{formatCurrency(item.amt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {isFirst && (
                    <div className="mt-2 text-[8px] leading-relaxed space-y-1">
                      <p>{noteLtCoil}</p>
                      <p>{noteRadiator}</p>
                    </div>
                  )}

                  {isLast && estimate.rateErrors.length > 0 && (
                    <div className="mt-2 p-2 border-2 border-red-600 bg-red-50 text-red-800 text-[9px]">
                      <p className="font-black uppercase tracking-wide mb-1">⚠ Estimate incomplete - rate not found</p>
                      <ul className="list-disc list-inside space-y-0.5 font-normal">
                        {estimate.rateErrors.map((e, i) => <li key={i}>{e.message}</li>)}
                      </ul>
                      <p className="mt-1 font-bold">Total withheld until a rate is confirmed.</p>
                    </div>
                  )}
                  {isLast && estimate.rateErrors.length === 0 && (
                    <div className="flex justify-end mt-1 text-[9.5px]">
                      <table className="border-collapse border border-black w-64 text-right">
                        <tbody>
                          <tr className="border-b border-black">
                            <td className="p-1 font-bold border-r border-black">Total Amount:</td>
                            <td className="p-1 font-mono font-bold w-24">{formatCurrency(estimate.baseTotal)}</td>
                          </tr>
                          <tr className="border-b border-black">
                            <td className="p-1 font-bold border-r border-black">
                              Percentage ({estimate.atPercentage > 0 ? `+${estimate.atPercentage.toFixed(1)}%` : `${estimate.atPercentage.toFixed(1)}%`}):
                            </td>
                            <td className="p-1 font-mono font-medium">{formatCurrency(estimate.percentageAmount)}</td>
                          </tr>
                          <tr className="bg-slate-100 print:bg-transparent font-black text-[10.5px]">
                            <td className="p-1.5 border-r border-black">Final Amount:</td>
                            <td className="p-1.5 font-mono">{formatCurrency(estimate.finalAmount)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {!isLast && (
                    <p className="text-right text-xs italic mt-2">Continued on page {pageIdx + 2}…</p>
                  )}
                </div>

                {isLast && estimate.rateErrors.length === 0 && (
                  <div className="mt-4 pt-3 border-t border-black flex justify-between items-end px-8 text-[10px] font-bold uppercase">
                    <div className="text-left">
                      <div className="h-10"></div>
                      <p className="font-bold">For, {agency?.discomName || '-'}</p>
                    </div>
                    <div className="text-right">
                      <div className="h-10"></div>
                      <p className="font-bold">For, {agency?.name || 'CONTRACTOR'}</p>
                    </div>
                  </div>
                )}
              </div>

              {agency?.showPageNumbers !== false && (
                <footer className="a4-page-footer">
                  Page {pageIdx + 1} of {totalPages}
                </footer>
              )}
            </PrintableA4Page>
          );
        })}
      </>
    );
  }

  return (
    <>
      {pages.map((rows, pageIdx) => {
        const isFirst = pageIdx === 0;
        const isLast = pageIdx === totalPages - 1;

        // Group this page's rows into consecutive runs by section, so each run
        // gets its own section header row (marked "(contd.)" if it's a continuation
        // of a section that already started on an earlier page).
        const groups: Array<{ section: EstimateSection; rows: typeof rows; globalStartIdx: number }> = [];
        rows.forEach((row) => {
          const globalIdx = row.sr - 1;
          const lastGroup = groups[groups.length - 1];
          if (lastGroup && lastGroup.section === row.section) {
            lastGroup.rows.push(row);
          } else {
            groups.push({ section: row.section, rows: [row], globalStartIdx: globalIdx });
          }
        });

        return (
          <PrintableA4Page key={pageIdx} agency={agency} orientation="portrait" className={`text-black ${className}`}>
            <div ref={isFirst ? measureContentAreaRef : undefined} className="flex flex-col justify-between h-full text-black">
              <div>
                {/* Header Title */}
                <div className="text-center mb-2 pb-1 border-b-2 border-black">
                  <h2 className="text-base font-black uppercase tracking-wider">ESTIMATION REPORT</h2>
                </div>

                {/* 2-Column Metadata Box (page 1 only) */}
                {isFirst && (
                  <div className="grid grid-cols-2 text-[10px] border border-black p-2 mb-2 leading-relaxed bg-white">
                    <div className="space-y-0.5 border-r border-black pr-2">
                      <div className="flex">
                        <span className="font-bold w-24">Job No.:</span>
                        <span className="font-mono font-bold">{job.jobNo} {job.repairType === 'GP' ? '(GP)' : ''}</span>
                      </div>
                      <div className="flex">
                        <span className="font-bold w-24">Manufacturer:</span>
                        <span className="font-bold uppercase truncate">{job.make || '-'}</span>
                      </div>
                      <div className="flex">
                        <span className="font-bold w-24">Serial No.:</span>
                        <span className="font-mono">{job.serialNo || '-'}</span>
                      </div>
                      <div className="flex">
                        <span className="font-bold w-24">KVA/KV:</span>
                        <span className="font-bold">{job.capacityKva}/11</span>
                      </div>
                      <div className="flex">
                        <span className="font-bold w-24">Oil Capacity:</span>
                        <span className="font-mono">{Number(oilCap).toFixed(2)}</span>
                      </div>
                      <div className="flex">
                        <span className="font-bold w-24">Oil Shortage:</span>
                        <span className="font-mono">{Number(oilShort).toFixed(2)}</span>
                      </div>
                      <div className="flex text-[9px] pt-0.5">
                        <span className="font-bold w-24">Order No.:</span>
                        <span className="font-mono truncate">{orderNo}, Dt.: {formatDDMMYYYY(orderDate)}</span>
                      </div>
                    </div>

                    <div className="space-y-0.5 pl-2">
                      <div className="flex">
                        <span className="font-bold w-24">Date:</span>
                        <span className="font-mono">{dateFormatted}</span>
                      </div>
                      <div className="flex">
                        <span className="font-bold w-24">Division:</span>
                        <span className="font-bold uppercase">{job.division || 'SABARMATI'}</span>
                      </div>
                      <div className="flex">
                        <span className="font-bold w-24">Mr. No.:</span>
                        <span className="font-mono font-bold">{job.mrNo}</span>
                      </div>
                      <div className="flex">
                        <span className="font-bold w-24">Mr. Date:</span>
                        <span className="font-mono">{mrDateFormatted}</span>
                      </div>
                      <div className="flex">
                        <span className="font-bold w-24">Service Type:</span>
                        <span className="font-bold">{job.repairType || 'OGP'}</span>
                      </div>
                      <div className="flex">
                        <span className="font-bold w-24">Winding Type:</span>
                        <span className="font-bold">{windingTypeStr}</span>
                      </div>
                      <div className="flex">
                        <span className="font-bold w-24">Voltage Class:</span>
                        <span className="font-bold">{voltageRating}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Line Items Table */}
                <table className="w-full border-collapse border border-black text-[8.5px]">
                  <thead>
                    <tr className="bg-slate-100 print:bg-transparent font-bold border-b border-black text-center">
                      <th className="border border-black p-1 w-8">Sr. No.</th>
                      <th className="border border-black p-1 text-left min-w-[200px]">Item Description</th>
                      <th className="border border-black p-1 w-12">Unit</th>
                      <th className="border border-black p-1 w-14">Quantity</th>
                      <th className="border border-black p-1 text-right w-16">Unit Rate</th>
                      <th className="border border-black p-1 text-right w-20">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group, gi) => {
                      const isContd = gi === 0 && group.globalStartIdx > sectionStartIndex[group.section];
                      return (
                        <React.Fragment key={`${group.section}-${group.globalStartIdx}`}>
                          <tr className="bg-slate-200 print:bg-slate-100 font-bold border-t border-b border-black">
                            <td colSpan={6} className="p-0.5 text-center uppercase tracking-wider text-[9px]">
                              {SECTION_LABELS[group.section]}{isContd ? ' (contd.)' : ''}
                            </td>
                          </tr>
                          {group.rows.map((item) => (
                            <tr key={`item-${item.sr}`} className="border-b border-slate-300 print:border-black h-4">
                              <td className="border-r border-black p-0.5 text-center font-mono">{item.sr}</td>
                              <td className="border-r border-black p-0.5 pl-1">{item.desc}</td>
                              <td className="border-r border-black p-0.5 text-center font-semibold">{item.unit}</td>
                              <td className="border-r border-black p-0.5 text-center font-mono">{item.qty}</td>
                              <td className="border-r border-black p-0.5 text-right font-mono">{item.rate === null ? '' : formatCurrency(item.rate)}</td>
                              <td className="border-r border-black p-0.5 text-right font-mono font-medium">{formatCurrency(item.amt)}</td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>

                {/* Bottom Calculation Box (last page only) - withheld if any applicable item has no rate */}
                {isLast && estimate.rateErrors.length > 0 && (
                  <div className="mt-2 p-2 border-2 border-red-600 bg-red-50 text-red-800 text-[9px]">
                    <p className="font-black uppercase tracking-wide mb-1">⚠ Estimate incomplete - rate not found</p>
                    <ul className="list-disc list-inside space-y-0.5 font-normal">
                      {estimate.rateErrors.map((e, i) => <li key={i}>{e.message}</li>)}
                    </ul>
                    <p className="mt-1 font-bold">Total withheld until every applicable item has a rate.</p>
                  </div>
                )}
                {isLast && estimate.rateErrors.length === 0 && (
                  <div className="flex justify-end mt-1 text-[9.5px]">
                    <table className="border-collapse border border-black w-64 text-right">
                      <tbody>
                        <tr className="border-b border-black">
                          <td className="p-1 font-bold border-r border-black">Total Amount:</td>
                          <td className="p-1 font-mono font-bold w-24">{formatCurrency(estimate.baseTotal)}</td>
                        </tr>
                        <tr className="border-b border-black">
                          <td className="p-1 font-bold border-r border-black">
                            Percentage ({estimate.atPercentage > 0 ? `+${estimate.atPercentage.toFixed(1)}%` : `${estimate.atPercentage.toFixed(1)}%`}):
                          </td>
                          <td className="p-1 font-mono font-medium">{formatCurrency(estimate.percentageAmount)}</td>
                        </tr>
                        <tr className="border-b border-black">
                          <td className="p-1 font-bold border-r border-black">
                            Amount {estimate.atPercentage >= 0 ? `+ (${estimate.atPercentage.toFixed(1)}%)` : `(${estimate.atPercentage.toFixed(1)}%)`}:
                          </td>
                          <td className="p-1 font-mono font-bold">{formatCurrency(estimate.amountWithPercentage)}</td>
                        </tr>
                        <tr className="border-b border-black">
                          <td className="p-1 font-bold border-r border-black">Less:</td>
                          <td className="p-1 font-mono">{formatCurrency(estimate.lessAmount)}</td>
                        </tr>
                        <tr className="bg-slate-100 print:bg-transparent font-black text-[10.5px]">
                          <td className="p-1.5 border-r border-black">Final Amount:</td>
                          <td className="p-1.5 font-mono">{formatCurrency(estimate.finalAmount)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {!isLast && (
                  <p className="text-right text-xs italic mt-2">Continued on page {pageIdx + 2}…</p>
                )}
              </div>

              {/* Dual Signatures Block (last page only, withheld along with the total) */}
              {isLast && estimate.rateErrors.length === 0 && (
                <div className="mt-4 pt-3 border-t border-black flex justify-between items-end px-8 text-[10px] font-bold uppercase">
                  <div className="text-left">
                    <div className="h-10"></div>
                    <p className="font-bold">For, {agency?.discomName || '-'}</p>
                  </div>
                  <div className="text-right">
                    <div className="h-10"></div>
                    <p className="font-bold">For, {agency?.name || 'CONTRACTOR'}</p>
                  </div>
                </div>
              )}
            </div>

            {agency?.showPageNumbers !== false && (
              <footer className="a4-page-footer">
                Page {pageIdx + 1} of {totalPages}
              </footer>
            )}
          </PrintableA4Page>
        );
      })}
    </>
  );
}
