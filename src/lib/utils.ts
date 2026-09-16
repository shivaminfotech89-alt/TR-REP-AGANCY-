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

/**
 * THE APP'S SUPPORTED REGISTRATION STATE, and it is a SCOPE LIMIT rather than a defect.
 *
 * `DISCOM_OPTIONS` offers four entities and all four are Gujarat (state code 24), behind a
 * required select - so the customer base this app is built for is Gujarat agencies working
 * for Gujarat DISCOMs. `discomState` and `discomStateCode` are seeded from that fact.
 *
 * The scope decision was therefore already made and encoded; it was just made SILENTLY, and
 * the one place it surfaced was a tax invoice. An out-of-state agency could sign up, work
 * for weeks, and receive an invoice printing `Supplier State Code 27` and `Buyer State Code
 * 24` while charging CGST+SGST - an inter-state supply taxed as intra-state, on a document
 * carrying the evidence it is wrong (AUDIT O9).
 *
 * Refusing the registration makes an existing decision honest. It is NOT a substitute for
 * an IGST path, which stays on the list unbuilt - see D6.
 */
export const SUPPORTED_GSTIN_STATE_CODE = '24';

/**
 * Why this GSTIN cannot be used, or null if it can. Empty is allowed - GSTIN is optional
 * until a tax invoice needs it, and `missingForTaxInvoice` blocks there.
 *
 * THE MESSAGE IS THE POINT. "Invalid GSTIN" would be a dead end that teaches the prospect
 * nothing and teaches us nothing about whether we want their business. This names what is
 * refused, why, and asks them to make contact - so a wrong assumption about scope corrects
 * itself at signup, before any paper is issued, rather than at a division office months in.
 */
export function gstinScopeError(gstin?: string | null): string | null {
  const g = String(gstin ?? '').trim();
  if (!g) return null;
  const code = stateCodeFromGstin(g);
  if (!code) {
    return `This GSTIN does not begin with a two-digit state code, so the registration state cannot be read from it. A GSTIN looks like 24ABCDE1234F1Z5.`;
  }
  if (code !== SUPPORTED_GSTIN_STATE_CODE) {
    return `This app currently supports agencies registered in Gujarat - a GSTIN beginning ${SUPPORTED_GSTIN_STATE_CODE} - working for Gujarat DISCOMs. Yours begins ${code}.

An agency registered outside Gujarat supplying a Gujarat DISCOM is an inter-state supply and must be billed IGST, which this app does not yet produce. Issuing a CGST+SGST invoice for it would be wrong on the face of the document.

Please get in touch - we would like to know about this case, and it may change what we build next.`;
  }
  return null;
}

/** An agency's GST state code: derived from its own GSTIN, falling back to a stored
 *  value only for agencies recorded before derivation existed. Never defaulted. */
export function getAgencyStateCode(agency: any): string {
  return stateCodeFromGstin(agency?.gstin) || String(agency?.agencyStateCode ?? '').trim();
}

/**
 * A TENDER REFERENCE, SHORTENED FOR THE SCREEN (AUDIT G94).
 *
 * `UGVCL/EE-T-1/TRANS-REP/2026-28/01/AT/1819` is what the tender letter says and what the
 * operator types. It is also what sixteen surfaces rendered in full, including the tender
 * selector in the sidebar, where it wrapped to three lines and pushed everything else down.
 *
 * ⚠ THE STORED VALUES DO NOT FORM ONE FAMILY. Measured across all seventeen live ATs rather
 * than assumed from the two that prompted this:
 *
 *     UGVCL/EE-T-1/TRANS-REP/2026-28/01/AT/1819      full reference - what this is for
 *     UGVCL/2026-28/01/AT/1819                       shorter reference, same shape
 *     UGVCL/EE-T-1/TRANS-REP/2020-21/1087            serial with no /AT/ before it
 *     2026-28/AT/1819, 2020-21/01/1049               partial - no discom prefix
 *     2026-27, 26-27, 24-25, 2026-28, 2020-2021      already short
 *     AT-2026-28, AT2026-27, AT 26-27, 2026_27       already short, various spellings
 *     ALLOTMENT NO.25903,DT.10/09/26                 ⚠ NOT A TENDER REFERENCE AT ALL
 *     ...2026-28/01/AT/1808 ,07/09/2026              ⚠ a date appended after the serial
 *
 * ⚠ SO AN UNRECOGNISED VALUE IS RETURNED UNCHANGED, and that rule is the important half.
 * Two of seventeen are not tender references. `ALLOTMENT NO.25903,DT.10/09/26` reduced to
 * something that LOOKS like a tender number would be worse than leaving it long: a wrong
 * short form reads as deliberate, while a long one only reads as untidy.
 *
 * THE RULE: find a tender PERIOD, and optionally a SERIAL that follows it. No period, no
 * change. The period is the part an operator recognises - "26-28" is the tender - and the
 * serial is what distinguishes two ATs of the same period, which several agencies have.
 *
 * ⚠ NEVER USE THIS ON A PRINTED DOCUMENT. The estimate, the bill and the challan carry the
 * reference UGVCL reads back against its own file, and a shortened one is a different
 * string from the one on the paper. This is for screens only.
 */
export function shortAtNumber(atNumber?: string | null): string {
  const raw = String(atNumber ?? '').trim();
  if (!raw) return '';

  /**
   * A period: 2026-28, 2026-2028, 26-28, or the underscore spelling some ATs use.
   *
   * ⚠ `/` IS NOT A PERIOD SEPARATOR, AND ALLOWING IT MANGLED THE ONE VALUE THIS FUNCTION
   * EXISTS TO LEAVE ALONE. An earlier revision accepted `[-_/]`, so
   * `ALLOTMENT NO.25903,DT.10/09/26` matched `10/09` inside its DATE and shortened to
   * "10-09" - a plausible-looking tender period invented out of a day and a month. No live
   * value uses `/` between the halves of a period; it was widened for a format that does not
   * exist, and it swallowed one that does.
   *
   * ⚠⚠ NO LOOKBEHIND. NOT FOR STYLE - REGEX LOOKBEHIND IS A PARSE-TIME SyntaxError IN
   * SAFARI BELOW 16.4, AND THIS BUNDLE IS A SINGLE CHUNK, SO ONE OF THEM BLANKS THE WHOLE
   * APP. A revision of this function carried `(?<![\d-])` for two minutes; it was removed
   * because the app is at this moment failing to load at all on an iPhone, cause unknown,
   * and lookbehind is one of the few constructs that produces exactly that symptom.
   *
   * So the character before the period is CAPTURED (`(^|[^\d])`) rather than asserted about.
   * That accepts a letter or a dash - `AT2026-27` and `AT-2026-28` are both real stored
   * values, and `\b` matched neither - while still refusing a digit, so a long run like
   * `NO.25903` cannot yield a period out of its own tail. The captured delimiter's length is
   * added back when locating the serial.
   *
   * Every failure here was caught by the test against all seventeen live values before this
   * reached a single screen. None was a missed requirement; all were speculative generality.
   */
  const period = raw.match(/(^|[^\d])((?:19|20)\d{2}|\d{2})([-_])((?:19|20)\d{2}|\d{2})([^\d-]|$)/);
  if (!period) return raw;

  const from = period[2];
  const sep = period[3];
  const to = period[4];
  // Both halves shortened to two digits, so 2026-2028 and 2026-28 render identically.
  const shortPeriod = `${from.slice(-2)}-${to.slice(-2)}`;

  // The serial, when one follows the period. `/AT/1819` first, because that is the labelled
  // form; otherwise the last all-digit segment AFTER the period, so a discom prefix's own
  // numbers cannot be mistaken for it.
  //
  // The trailing group is part of the match, so the search for a serial starts one character
  // early and includes it - which is correct: `/AT/1819` needs that leading `/`.
  const after = raw.slice(period.index! + period[1].length + from.length + sep.length + to.length);
  const labelled = after.match(/\/\s*AT\s*\/\s*(\d+)/i);
  let serial = labelled ? labelled[1] : '';
  if (!serial) {
    const digitSegments = after.match(/\/\s*(\d+)(?=\s*(?:[,\s]|$|\/))/g);
    if (digitSegments && digitSegments.length > 0) {
      const last = digitSegments[digitSegments.length - 1].match(/(\d+)/);
      // A bare "01" is a sequence number within the tender, not the AT serial - too short to
      // identify anything on its own, and every agency has one.
      if (last && last[1].length >= 3) serial = last[1];
    }
  }

  return serial ? `${shortPeriod}/${serial}` : shortPeriod;
}
