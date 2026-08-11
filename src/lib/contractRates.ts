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
  if (limit === 0) return true; // If KVA not found, assume it needs higher approval or custom logic
  return estimateAmount > limit;
}

export function isNonRepairable(estimateAmount: number, kva: number): boolean {
  const limit25Percent = getCircleOfficeLimit(kva);
  if (limit25Percent === 0) return false;
  const limit30Percent = limit25Percent * 1.2; // 30% limit
  return estimateAmount > limit30Percent;
}
