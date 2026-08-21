import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDDMMYYYY(dateInput?: string | number | Date | null): string {
  if (!dateInput) return '-';
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (!trimmed) return '-';
    // If already in dd-mm-yyyy or dd/mm/yyyy
    if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(trimmed)) {
      return trimmed.replace(/\//g, '-');
    }
    // If in yyyy-mm-dd format
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      const parts = trimmed.split('T')[0].split('-');
      if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }
  }
  try {
    const d = new Date(dateInput);
    // Unparseable input renders as '-', NOT as the raw value. This branch is reachable
    // only for genuine garbage: dd-mm-yyyy and yyyy-mm-dd are caught by the regexes
    // above, and anything Date can parse - including readable forms like '15 Aug 2026' -
    // succeeds below. Returning the raw string could therefore only ever surface
    // unusable data looking like a date. One contract: a value that cannot be rendered
    // as a date renders as '-'.
    if (isNaN(d.getTime())) return '-';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return '-';
  }
}


/**
 * Comparator: most recent first, with rows that have NO date always sorting LAST.
 *
 * The "always last" part is the point. A naive descending sort puts undated rows on
 * top, because an empty string sorts before any real date ascending. The subtler
 * failure - and the one this codebase actually had - is a guarded comparator:
 *
 *   if (a.date && b.date) return b.date.localeCompare(a.date);
 *   return b.mrNo.localeCompare(a.mrNo);          // <-- reached whenever EITHER is missing
 *
 * That looks correct and is not. When only one side has a date the guard fails and the
 * pair is compared by an unrelated key, so undated rows scatter through the list
 * instead of sinking, and the resulting order can depend on input sequence because the
 * comparator is not transitive.
 *
 * Missing is defined as null, undefined, or empty/whitespace. ISO `yyyy-mm-dd` strings
 * compare correctly with `localeCompare`, so no Date parsing is needed; epoch numbers
 * and Date objects are also accepted.
 *
 * Always use on a COPY: `[...rows].sort(byDateDesc(r => r.billSentDate))`. Sorting in
 * place mutates the array, which corrupts any count derived from the same reference.
 *
 * @param getDate   pulls the date out of a row
 * @param tieBreak  optional comparator for rows whose dates are equal or both missing
 */
export function byDateDesc<T>(
  getDate: (row: T) => string | number | Date | null | undefined,
  tieBreak?: (a: T, b: T) => number
) {
  const key = (row: T): string => {
    const v = getDate(row);
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
    if (typeof v === 'number') return isNaN(v) ? '' : new Date(v).toISOString();
    return String(v).trim();
  };

  return (a: T, b: T): number => {
    const ka = key(a);
    const kb = key(b);
    if (ka && !kb) return -1;   // undated always sinks, whatever the direction
    if (!ka && kb) return 1;
    if (ka !== kb) return kb.localeCompare(ka);   // newest first
    return tieBreak ? tieBreak(a, b) : 0;
  };
}

/** Descending numeric-aware compare, for MR numbers as a tiebreak. */
export function byNumericDesc(get: (row: any) => string | undefined) {
  return (a: any, b: any) =>
    String(get(b) ?? '').localeCompare(String(get(a) ?? ''), undefined, { numeric: true });
}

/** Coerce a stored date value (ISO string, epoch ms, or Firestore Timestamp) to an ISO
 *  `yyyy-mm-dd` string, or '' if it cannot be. Storage/comparison shape - NOT display. */
export function toIsoDateStr(dateVal: any): string {
  if (!dateVal) return '';
  if (typeof dateVal === 'string') return dateVal;
  if (typeof dateVal === 'number') {
    const d = new Date(dateVal);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  if (dateVal?.seconds) {
    const d = new Date(dateVal.seconds * 1000);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  const d = new Date(dateVal);
  return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
}

/**
 * The MR's date of issue, as raw ISO `yyyy-mm-dd`, or '-' when the MR has none.
 *
 * RETURNS ISO ON PURPOSE. It feeds comparisons, filters and form state as well as
 * display, so it must stay in the sortable/comparable shape. Wrap it in
 * `formatDDMMYYYY()` at the render site - which passes '-' through unchanged.
 *
 * Previously duplicated character-for-character in OilInward and BillingSystem, with a
 * third near-copy (`selectedMrDate`) that differed in one respect: it fell back to the
 * BILL date instead of '-', putting a plausible but fabricated date on the printed oil
 * statement for an MR that has none. One implementation, one fallback: '-'.
 */
export function getMrDateIso(
  mrNo: string | undefined | null,
  jobs: any[],
  transactions: any[] = []
): string {
  if (!mrNo) return '-';
  const job = (jobs || []).find(j => j.mrNo === mrNo);
  if (job?.dateOfIssue) return job.dateOfIssue;
  if (job?.mrDate) return job.mrDate;
  if (job?.createdAt) {
    const d = toIsoDateStr(job.createdAt);
    if (d) return d;
  }
  const tx = (transactions || []).find(t => t.mrNo === mrNo && t.mrDate);
  if (tx?.mrDate) return tx.mrDate;
  return '-';
}
