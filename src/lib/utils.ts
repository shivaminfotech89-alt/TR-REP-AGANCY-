import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDDMMYYYY(dateInput?: string | number | Date | any | null): string {
  if (!dateInput) return '-';
  // Firestore Timestamp. Handled BEFORE the generic paths because `new Date(timestamp)`
  // is Invalid Date, which since F16 renders as '-' - a silent blanking rather than a
  // visible error. Accepts both the SDK object (.toDate()) and the plain {seconds,...}
  // shape a document read can produce.
  if (typeof dateInput === 'object' && !(dateInput instanceof Date)) {
    if (typeof dateInput.toDate === 'function') {
      return formatDDMMYYYY(dateInput.toDate());
    }
    if (typeof dateInput.seconds === 'number') {
      return formatDDMMYYYY(new Date(dateInput.seconds * 1000));
    }
  }
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
/**
 * A date-ish value as epoch MILLISECONDS, or null when it is not a date.
 *
 * Exists because `formatDDMMYYYY` returns a rendered string, and several callers need a
 * NUMBER - to sort, to take a min/max, to compare two records. Those callers were each
 * writing `Number(v) || Date.parse(v)`, which silently fails on a Firestore Timestamp:
 * `Number(timestamp)` is NaN and `Date.parse(timestamp)` parses "[object Object]", so the
 * whole expression yields NaN and the value is dropped or mis-rendered (AUDIT F58).
 *
 * Accepts every shape a document read can produce: SDK Timestamp (`.toDate()`), the plain
 * `{seconds}` shape, Date, epoch number, numeric string, and ISO string. Returns null
 * rather than 0 or NaN, so "no date" cannot be mistaken for 1 January 1970.
 */
export function toMillis(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'object') {
    if (typeof v.toDate === 'function') {
      const d = v.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : null;
    }
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    return null;
  }
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const str = String(v).trim();
  // A numeric string is epoch millis, not a date to parse - Date.parse('1700000000000')
  // is NaN, which is how the old expression lost them.
  const n = /^\d+$/.test(str) ? Number(str) : Date.parse(str);
  return isNaN(n) ? null : n;
}

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

/**
 * The GST state code is the FIRST TWO DIGITS of a GSTIN - it is part of the number, not
 * a separate fact. Deriving it means it can never disagree with the GSTIN, and the
 * agency does not have to know or restate it.
 *
 * Returns '' when there is no GSTIN or it does not start with two digits, rather than
 * guessing. Nothing is assumed about which state an agency is registered in - that was
 * the defect: a seeded '24' asserted Gujarat registration for every agency (AUDIT O8).
 */
export function stateCodeFromGstin(gstin?: string | null): string {
  const g = String(gstin ?? '').trim();
  return /^\d{2}/.test(g) ? g.slice(0, 2) : '';
}

/** An agency's GST state code: derived from its own GSTIN, falling back to a stored
 *  value only for agencies recorded before derivation existed. Never defaulted. */
export function getAgencyStateCode(agency: any): string {
  return stateCodeFromGstin(agency?.gstin) || String(agency?.agencyStateCode ?? '').trim();
}
