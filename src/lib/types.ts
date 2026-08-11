/** Shared domain types for TR Rep Agency */

export type RepairType = 'OGP' | 'GP';
export type JobStatus =
  | 'Received'
  | 'External Done'
  | 'Internal Done'
  | 'Non-Repairable'
  | 'Estimate Prepared'
  | 'Estimate Sent'
  | 'Estimate Approved'
  | 'Under Repair'
  | 'Tested'
  | 'Billed'
  | 'Dispatched'
  | 'Completed';

export interface Job {
  id: string;
  jobNo: string;
  mrNo: string;
  dateOfIssue: string;
  capacityKva: number;
  make: string;
  serialNo: string;
  type: string; // Distribution / Power / SDT / Wound Core
  repairType: RepairType;
  division: string;
  status: JobStatus | string;
  kv?: string;
  transformerCore?: string; // CRGO etc.
  agencyId?: string;
  /** For GP returns: link to original job */
  originalJobId?: string | null;
  /** Guarantee starts once on first repair dispatch — never resets */
  guaranteeStartDate?: string | null;
  guaranteeEndDate?: string | null;
  estimateApprovedAt?: number | null;
  estimateId?: string | null;
  isNonRepairable?: boolean;
  challanNo?: string | null;
  billId?: string | null;
  testingDetails?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
  ownerId: string;
}

export interface ExternalInspectionData {
  kv: string;
  oilCapLtrs: number;
  lessOilLtrs: number;
  oilAvailable: number;
  netShortage: number;
  sealType: string;
  gasket: string;
  hvLvRod: string;
  nuteBolt: string;
  dryActPart: string;
  clnDrtyTank: string;
  breather: string;
  oilLevGls: string;
  outsidePaint: string;
  namePlate: string;
  damCtTank: number;
  damRadNo: number;
  hvSideHvb: string;
  hvSideHvm: string;
  hvSideHvCc: string;
  lvSideLvb: string;
  lvSideLvm: string;
  lvSideLvCc: string;
  transType: string;
  inspNo?: string;
  inspDate?: string;
}

export interface InternalInspectionData {
  windingType: string; // AL / CU
  transformerCore: string; // CRGO
  hvCoilLimb: string;
  damR: string;
  damY: string;
  damB: string;
  totCoil: string;
  wtOfCoil: string;
  totWt: string;
  lvCoilR: string;
  lvCoilY: string;
  lvCoilB: string;
  wtOfCoilLv: string;
  totWtLv: string;
  washerRing: string;
  insidePaint: string;
  testTrn: string;
  dcSup: string;
  insulation: string;
  nonRepairable: boolean;
  scrapReason: string;
  inspNo?: string;
  inspDate?: string;
}

export interface Inspection {
  id: string;
  jobId: string;
  type: 'External' | 'Internal';
  data: ExternalInspectionData | InternalInspectionData | Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  ownerId: string;
}

export interface EstimateItem {
  no: string;
  item: string;
  qty: number;
  rate: number;
  amt: number;
  enabled: boolean;
}

export interface EstimateJobLine {
  jobId: string;
  jobNo: string;
  capacityKva: number;
  make: string;
  serialNo: string;
  repairType: string;
  transformerCore: string;
  windingType: string;
  oilCap: number;
  lessOil: number;
  filterOil: number;
  items: EstimateItem[];
  total: number;
  risePct: number;
  riseTotal: number;
  grandTotal: number;
  approvalLevel: 'Circle' | 'Corporate' | 'Scrap';
  circleLimit: number;
}

export interface Estimate {
  id: string;
  estimateNo: string;
  estimateDate: string;
  division: string;
  mrNo: string;
  orderNo: string;
  status: 'Draft' | 'Sent' | 'Approved' | 'Rejected';
  lines: EstimateJobLine[];
  grandTotal: number;
  approvedAt?: number | null;
  approvalRef?: string;
  agencyId?: string;
  createdAt: number;
  updatedAt: number;
  ownerId: string;
}

export interface BillLine {
  jobId: string;
  jobNo: string;
  mrNo: string;
  mrDate: string;
  make: string;
  serialNo: string;
  capacityKva: number;
  challanNo: string;
  challanDate: string;
  aprNo: string;
  aprDate: string;
  materialCost: number;
  labourChrg: number;
  amt: number;
}

export interface Bill {
  id: string;
  billNo: string;
  billDate: string;
  division: string;
  orderNo: string;
  lines: BillLine[];
  subTotal: number;
  cgstPct: number;
  sgstPct: number;
  cgstAmt: number;
  sgstAmt: number;
  advanceStamp: number;
  netTotal: number;
  amountInWords: string;
  agencyId?: string;
  createdAt: number;
  updatedAt: number;
  ownerId: string;
}

export interface OilJobLine {
  jobId: string;
  jobNo: string;
  make: string;
  serialNo: string;
  capacityKva: number;
  oilCap: number;
  oilCont: number;
  oilShort: number;
  filterLoss5: number;
  total: number;
}

export interface OilReceipt {
  srNo: number;
  mrNo: string;
  mrDate: string;
  receivedOil: number;
  filtLoss: number;
}

export interface OilAccount {
  id: string;
  billNo: string;
  billDate: string;
  division: string;
  openingBalance: number;
  oilReceived: number;
  total: number;
  lessAsPerBill: number;
  scrapTransOil: number;
  closingBalance: number;
  debitCreditBalance: number;
  receipts: OilReceipt[];
  lines: OilJobLine[];
  agencyId?: string;
  createdAt: number;
  updatedAt: number;
  ownerId: string;
}

export interface ChallanLine {
  jobId: string;
  jobNo: string;
  make: string;
  serialNo: string;
  capacityKva: number;
  mrNo: string;
}

export interface Challan {
  id: string;
  challanNo: string;
  challanDate: string;
  division: string;
  lines: ChallanLine[];
  agencyId?: string;
  createdAt: number;
  updatedAt: number;
  ownerId: string;
}

export const SLA_DAYS = 45;
export const GUARANTEE_MONTHS = 18;
export const FILTRATION_LOSS_PCT = 0.05;
export const ESTIMATE_RISE_PCT = 0.04;
