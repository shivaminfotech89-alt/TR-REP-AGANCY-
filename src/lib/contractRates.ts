import { ESTIMATE_RISE_PCT, EstimateItem, FILTRATION_LOSS_PCT } from './types';

/** Circle office estimate passing power (≈25% of new transformer cost) — 11KV */
export const CIRCLE_OFFICE_APPROVAL_LIMITS_11KV: Record<string, number> = {
  '5': 5422,
  '10': 8716,
  '16': 8696,
  '25': 10124,
  '63': 20423,
  '100': 24609,
  '200': 47170,
  '500': 148260,
};

export function getCircleOfficeLimit(kva: number): number {
  return CIRCLE_OFFICE_APPROVAL_LIMITS_11KV[kva.toString()] || 0;
}

export function requiresCorporateApproval(estimateAmount: number, kva: number): boolean {
  const limit = getCircleOfficeLimit(kva);
  if (limit === 0) return true;
  return estimateAmount > limit;
}

/** Scrap when estimate exceeds ~30% of new transformer cost (1.2 × 25% circle limit) */
export function isNonRepairable(estimateAmount: number, kva: number): boolean {
  const limit25Percent = getCircleOfficeLimit(kva);
  if (limit25Percent === 0) return false;
  return estimateAmount > limit25Percent * 1.2;
}

export function getApprovalLevel(
  estimateAmount: number,
  kva: number
): 'Circle' | 'Corporate' | 'Scrap' {
  if (isNonRepairable(estimateAmount, kva)) return 'Scrap';
  if (requiresCorporateApproval(estimateAmount, kva)) return 'Corporate';
  return 'Circle';
}

/** Oil shortage: lessOil + 5% filtration loss on contained (available) oil */
export function calcOilShortage(oilCap: number, lessOil: number) {
  const oilCont = Math.max(0, oilCap - lessOil);
  const oilShort = Math.max(0, lessOil);
  const filterLoss5 = Number((oilCont * FILTRATION_LOSS_PCT).toFixed(2));
  const total = Number((oilShort + filterLoss5).toFixed(2));
  return { oilCont, oilShort, filterLoss5, total };
}

export interface RateRow {
  no: string;
  item: string;
  /** Base rate lookup by KVA; falls back to nearest known or default */
  ratesByKva: Record<string, number>;
  defaultRate: number;
  /** How qty is derived when auto-filling from inspection */
  qtySource?:
    | 'fixed1'
    | 'hvBushing'
    | 'lvBushing'
    | 'hvMetal'
    | 'lvMetal'
    | 'hvConnector'
    | 'lvConnector'
    | 'hvLvRod'
    | 'gasket'
    | 'hvCoilWt'
    | 'lvCoilWt'
    | 'damRad'
    | 'yn'
    | 'sealConvert'
    | 'windingCu'
    | 'windingAl'
    | 'reinsuCu'
    | 'reinsuAl';
}

/**
 * Contract rate catalog extracted from SP estimate samples.
 * Rates vary by capacity; missing KVA uses defaultRate.
 */
export const ESTIMATE_CATALOG: RateRow[] = [
  { no: '1a', item: 'Dismantling', ratesByKva: { '10': 1603, '16': 1603, '25': 2061, '63': 2061, '100': 2061 }, defaultRate: 1603, qtySource: 'fixed1' },
  { no: '1b', item: 'Repl. of Gaskets', ratesByKva: { '10': 46, '16': 46, '25': 46, '63': 46 }, defaultRate: 46, qtySource: 'gasket' },
  { no: '1c', item: 'Repl. HV/LV Gaskets', ratesByKva: { '10': 34, '16': 34, '25': 34, '63': 34 }, defaultRate: 34, qtySource: 'hvLvRod' },
  { no: '1d', item: 'Repl. of Insulation', ratesByKva: { '10': 229, '16': 229, '25': 286, '63': 286 }, defaultRate: 229, qtySource: 'yn' },
  { no: '1e', item: 'Repl. of M.S bolt-nuts', ratesByKva: { '10': 46, '16': 46, '25': 57, '63': 57 }, defaultRate: 46, qtySource: 'yn' },
  { no: '1f', item: 'Drying of active parts', ratesByKva: { '10': 183, '16': 183, '25': 229, '63': 229 }, defaultRate: 183, qtySource: 'yn' },
  { no: '2a', item: 'Cleaning Dirty Tank', ratesByKva: { '10': 28.75, '16': 28.75, '25': 34, '63': 34 }, defaultRate: 28.75, qtySource: 'yn' },
  { no: '2b', item: 'Painting Out-Side', ratesByKva: { '10': 115, '16': 115, '25': 149, '63': 149 }, defaultRate: 115, qtySource: 'yn' },
  { no: '3', item: 'Painting In-Side', ratesByKva: { '10': 0, '16': 0, '25': 0, '63': 0 }, defaultRate: 0, qtySource: 'yn' },
  { no: '5', item: 'Oil Level Glass', ratesByKva: { '10': 46, '16': 46, '25': 46, '63': 46 }, defaultRate: 46, qtySource: 'yn' },
  { no: '6', item: 'Breather', ratesByKva: { '10': 0, '16': 0, '25': 0, '63': 0 }, defaultRate: 0, qtySource: 'yn' },
  { no: '8', item: 'HV Bushing', ratesByKva: { '10': 176, '16': 176, '25': 176, '63': 176 }, defaultRate: 176, qtySource: 'hvBushing' },
  { no: '9A', item: 'HV Metal Parts', ratesByKva: { '10': 131, '16': 131, '25': 131, '63': 131 }, defaultRate: 131, qtySource: 'hvMetal' },
  { no: '9B', item: 'HV Connector', ratesByKva: { '10': 80, '16': 80, '25': 80, '63': 80 }, defaultRate: 80, qtySource: 'hvConnector' },
  { no: '10', item: 'LV Bushing', ratesByKva: { '10': 59.8, '16': 59.8, '25': 59.8, '63': 59.8 }, defaultRate: 59.8, qtySource: 'lvBushing' },
  { no: '11A', item: 'LV Metal Parts', ratesByKva: { '10': 156, '16': 156, '25': 156, '63': 156 }, defaultRate: 156, qtySource: 'lvMetal' },
  { no: '11B', item: 'LV Connector', ratesByKva: { '10': 149, '16': 149, '25': 149, '63': 149 }, defaultRate: 149, qtySource: 'lvConnector' },
  { no: '12A(a)', item: 'HV Wdg. (Not Miss) -CU', ratesByKva: { '10': 0, '16': 0, '25': 0, '63': 0 }, defaultRate: 0, qtySource: 'windingCu' },
  { no: '12A(b)', item: 'HV Wdg. (Not Miss) -AL', ratesByKva: { '10': 163, '16': 163, '25': 163, '63': 163 }, defaultRate: 163, qtySource: 'windingAl' },
  { no: '12C', item: 'HV Coil - Labour', ratesByKva: { '10': 34, '16': 34, '25': 34, '63': 34 }, defaultRate: 34, qtySource: 'hvCoilWt' },
  { no: '13A(a)', item: 'LV Wdg. (Not Miss) -CU', ratesByKva: { '10': 0, '16': 0, '25': 0, '63': 0 }, defaultRate: 0, qtySource: 'windingCu' },
  { no: '13b(b)', item: 'LV Wdg. (Not Miss) -AL', ratesByKva: { '10': 149, '16': 149, '25': 149, '63': 149 }, defaultRate: 149, qtySource: 'windingAl' },
  { no: '13C', item: 'LV Coil - Labour', ratesByKva: { '10': 51.75, '16': 51.75, '25': 51.75, '63': 51.75 }, defaultRate: 51.75, qtySource: 'lvCoilWt' },
  { no: '14(ii)-CU', item: 'LV Wdg. Re-Insu.-CU', ratesByKva: { '10': 0, '16': 0, '25': 0, '63': 0 }, defaultRate: 0, qtySource: 'reinsuCu' },
  { no: '14(ii)-AL', item: 'LV Wdg. Re-Insu.-AL', ratesByKva: { '10': 115, '16': 115, '25': 172, '63': 172 }, defaultRate: 115, qtySource: 'reinsuAl' },
  { no: '15', item: 'Washer Ring', ratesByKva: { '10': 54, '16': 54, '25': 54, '63': 54 }, defaultRate: 54, qtySource: 'fixed1' },
  { no: '16', item: 'Name Plate', ratesByKva: { '10': 0, '16': 0, '25': 0, '63': 0 }, defaultRate: 0, qtySource: 'yn' },
  { no: '17', item: 'Con. of Sealed to Bolt', ratesByKva: { '10': 0, '16': 0, '25': 0, '63': 0 }, defaultRate: 0, qtySource: 'sealConvert' },
  { no: '18', item: 'Repl. Of Tank', ratesByKva: { '10': 0, '16': 0, '25': 0, '63': 0 }, defaultRate: 0, qtySource: 'yn' },
  { no: '20', item: 'Testing Of Trans.', ratesByKva: { '10': 1052, '16': 1052, '25': 1052, '63': 1248 }, defaultRate: 1052, qtySource: 'fixed1' },
  { no: '21', item: 'Repl. Of Radiator', ratesByKva: { '10': 0, '16': 0, '25': 0, '63': 0 }, defaultRate: 0, qtySource: 'damRad' },
];

export function rateForKva(row: RateRow, kva: number): number {
  const key = kva.toString();
  if (row.ratesByKva[key] != null) return row.ratesByKva[key];
  // nearest lower known
  const known = Object.keys(row.ratesByKva)
    .map(Number)
    .sort((a, b) => a - b);
  let best = row.defaultRate;
  for (const k of known) {
    if (k <= kva) best = row.ratesByKva[k.toString()];
  }
  return best;
}

export interface AutoFillCtx {
  kva: number;
  windingType: string; // AL | CU
  sealType: string; // BL | SL
  gasket: string;
  hvLvRod: string;
  hvBushing: string;
  hvMetal: string;
  lvBushing: string;
  lvMetal: string;
  outsidePaint: string;
  oilLevGls: string;
  breather: string;
  namePlate: string;
  dryActPart: string;
  nuteBolt: string;
  clnDrtyTank: string;
  insidePaint: string;
  damRadNo: number;
  hvCoilWt: number;
  lvCoilWt: number;
  lvHasRI: boolean;
  insulation: string;
}

function ynQty(val: string): number {
  const v = (val || '').toUpperCase();
  if (v === 'Y' || v === 'TBR' || v === '1') return 1;
  return 0;
}

function numOr(val: string, fallback = 0): number {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : fallback;
}

export function buildEstimateItems(ctx: AutoFillCtx): EstimateItem[] {
  return ESTIMATE_CATALOG.map((row) => {
    const rate = rateForKva(row, ctx.kva);
    let qty = 0;
    let enabled = false;

    switch (row.qtySource) {
      case 'fixed1':
        qty = 1;
        enabled = rate > 0 || row.no === '1a' || row.no === '20' || row.no === '15';
        break;
      case 'gasket':
        qty = ynQty(ctx.gasket) || (numOr(ctx.gasket) > 0 ? 1 : 0);
        enabled = qty > 0;
        break;
      case 'hvLvRod':
        qty = numOr(ctx.hvLvRod, 0);
        enabled = qty > 0;
        break;
      case 'hvBushing':
        qty = numOr(ctx.hvBushing, 0);
        enabled = qty > 0;
        break;
      case 'hvMetal':
        qty = numOr(ctx.hvMetal, 0);
        enabled = qty > 0;
        break;
      case 'hvConnector':
        qty = numOr(ctx.hvBushing, 0) > 0 ? numOr(ctx.hvBushing, 0) : 0;
        // connectors often match bushing count; default from sample = bushing count when HV work present
        enabled = qty > 0;
        break;
      case 'lvBushing':
        qty = numOr(ctx.lvBushing, 0);
        enabled = qty > 0;
        break;
      case 'lvMetal':
        qty = numOr(ctx.lvMetal, 0);
        enabled = qty > 0;
        break;
      case 'lvConnector':
        qty = numOr(ctx.lvBushing, 0) > 0 ? 1 : 0;
        enabled = qty > 0 && rate > 0;
        break;
      case 'hvCoilWt':
        qty = ctx.hvCoilWt;
        enabled = qty > 0;
        break;
      case 'lvCoilWt':
        qty = ctx.lvCoilWt;
        enabled = qty > 0;
        break;
      case 'windingCu':
        qty = ctx.windingType === 'CU' && ctx.hvCoilWt > 0 ? 1 : 0;
        enabled = qty > 0 && rate > 0;
        break;
      case 'windingAl':
        qty = ctx.windingType === 'AL' && (ctx.hvCoilWt > 0 || row.no.startsWith('13')) ? 1 : 0;
        if (row.no.startsWith('12') && ctx.windingType === 'AL' && ctx.hvCoilWt > 0) {
          qty = 1;
          enabled = true;
        } else if (row.no.startsWith('13') && ctx.windingType === 'AL') {
          qty = ctx.lvCoilWt > 0 || ctx.lvHasRI ? 1 : 0;
          enabled = qty > 0;
        } else {
          enabled = false;
          qty = 0;
        }
        break;
      case 'reinsuCu':
        qty = ctx.windingType === 'CU' && ctx.lvHasRI ? 1 : 0;
        enabled = qty > 0 && rate > 0;
        break;
      case 'reinsuAl':
        qty = ctx.windingType === 'AL' && ctx.lvHasRI ? 1 : 0;
        enabled = qty > 0;
        break;
      case 'damRad':
        qty = ctx.damRadNo;
        enabled = qty > 0;
        break;
      case 'sealConvert':
        qty = ctx.sealType === 'SL' ? 1 : 0;
        enabled = qty > 0 && rate > 0;
        break;
      case 'yn': {
        const map: Record<string, string> = {
          '1d': ctx.insulation,
          '1e': ctx.nuteBolt,
          '1f': ctx.dryActPart,
          '2a': ctx.clnDrtyTank,
          '2b': ctx.outsidePaint,
          '3': ctx.insidePaint,
          '5': ctx.oilLevGls,
          '6': ctx.breather,
          '16': ctx.namePlate,
        };
        qty = ynQty(map[row.no] || '');
        enabled = qty > 0 && rate > 0;
        break;
      }
      default:
        qty = 0;
        enabled = false;
    }

    const amt = Number((qty * rate).toFixed(2));
    return { no: row.no, item: row.item, qty, rate, amt, enabled };
  });
}

export function summarizeItems(items: EstimateItem[], risePct = ESTIMATE_RISE_PCT) {
  const active = items.filter((i) => i.enabled);
  const total = Number(active.reduce((s, i) => s + i.amt, 0).toFixed(2));
  const riseTotal = Number((total * risePct).toFixed(2));
  const grandTotal = Number((total + riseTotal).toFixed(2));
  return { total, riseTotal, grandTotal, risePct };
}

const ones = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ones[n];
  return `${tens[Math.floor(n / 10)]}${n % 10 ? ' ' + ones[n % 10] : ''}`.trim();
}

function threeDigits(n: number): string {
  if (n < 100) return twoDigits(n);
  return `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' + twoDigits(n % 100) : ''}`.trim();
}

/** Indian numbering: Rupees ... And Paisa ... Only */
export function amountInWordsINR(amount: number): string {
  const abs = Math.abs(amount);
  const rupees = Math.floor(abs);
  const paisa = Math.round((abs - rupees) * 100);

  if (rupees === 0 && paisa === 0) return 'Rupees Zero Only';

  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const hundred = rupees % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));

  let out = `Rupees ${parts.join(' ')}`;
  if (paisa) out += ` And Paisa ${twoDigits(paisa)}`;
  return `${out} Only`.replace(/\s+/g, ' ').trim();
}

export function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

export function daysLeftFrom(timestampMs: number | null | undefined, slaDays: number): number | null {
  if (!timestampMs) return null;
  const daysPassed = Math.floor((Date.now() - timestampMs) / (1000 * 60 * 60 * 24));
  return slaDays - daysPassed;
}

export function formatDateIN(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    // already dd-mm-yyyy or similar
    return iso;
  }
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}
