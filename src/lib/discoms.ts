/**
 * THE ELECTRICITY BOARDS AN AGENCY CAN WORK WITH — A FIXED LIST, AND WHY IT HAD TO BE (AUDIT G88).
 *
 * ⚠ `discomName` IS FREE TEXT AND IS ALREADY INCONSISTENT IN LIVE DATA. Eight agencies hold
 * "Uttar Gujarat Vij Company Ltd." and one holds "UTTAR GUJARAT VIJ CO LTD." - the same board,
 * two spellings, which a string filter reads as two boards. Four hold "" and four have no field
 * at all. A tender filter keyed on that string would have shown an empty list to half of them.
 *
 * So matching is done on a CODE from this list, and the free-text name is left alone.
 *
 * ⚠ THE CODE DOES NOT REPLACE `discomName`, AND MUST NOT. That field is the board's LEGAL NAME as
 * it prints on a tax invoice and a forwarding letter (BillingSystem, EditAgencyForm) - "Uttar
 * Gujarat Vij Company Ltd." is what a division office expects to read. One field cannot be both
 * a printed name and a match key: the first has to be exactly right for a document, the second
 * has to be exactly stable for a filter, and those pull in opposite directions.
 *
 * FOUR DISTRIBUTION COMPANIES AND ONE TRANSMISSION COMPANY. The four GVCLs are the distribution
 * licensees formed when the Gujarat Electricity Board unbundled, each covering one region; GETCO
 * is the separate transmission company under the same holding, and one live agency is named for
 * it.
 *
 * ⚠ THIS LIST IS NOT EXHAUSTIVE FOR GUJARAT, DELIBERATELY. Torrent Power is a private licensee
 * distributing in Ahmedabad, Gandhinagar and Surat, outside this group - raised with the owner
 * and not added, because no live agency records it and inventing a board an operator does not
 * tender with is the same fault as guessing one. Adding it is one entry here plus one in
 * scripts/admin/backfill-agency-discom.js. See AUDIT G88.
 */

export interface Discom {
  /** The stable match key. Never printed on a document. */
  code: string;
  /** The legal name, offered as the default for `discomName` - which stays editable. */
  name: string;
  /** What the operator reads in the selector. */
  label: string;
}

export const DISCOMS: Discom[] = [
  { code: 'UGVCL', name: 'Uttar Gujarat Vij Company Ltd.', label: 'UGVCL — Uttar Gujarat (North)' },
  { code: 'MGVCL', name: 'Madhya Gujarat Vij Company Ltd.', label: 'MGVCL — Madhya Gujarat (Central)' },
  { code: 'PGVCL', name: 'Paschim Gujarat Vij Company Ltd.', label: 'PGVCL — Paschim Gujarat (West)' },
  { code: 'DGVCL', name: 'Dakshin Gujarat Vij Company Ltd.', label: 'DGVCL — Dakshin Gujarat (South)' },
  { code: 'GETCO', name: 'Gujarat Energy Transmission Corporation Ltd.', label: 'GETCO — Transmission' },
];

export const DISCOM_CODES = DISCOMS.map(d => d.code);

/** The board for a code, or null. Null is "not recorded", never a default board. */
export function discomFor(code: string | null | undefined): Discom | null {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return null;
  return DISCOMS.find(d => d.code === c) ?? null;
}

/**
 * ⚠ MATCHED ON LETTERS ONLY, so case and punctuation cannot turn one board into two.
 *
 * This is the same normalisation the backfill script uses, and it is the whole reason
 * "UTTAR GUJARAT VIJ CO LTD." and "Uttar Gujarat Vij Company Ltd." resolve to one code.
 */
const lettersOnly = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z]/g, '');

/**
 * Best-effort code for a free-text board name. Null when nothing matches.
 *
 * ⚠ IT READS THE NAME AND NOTHING ELSE. A division prefix like SABARMATI or DEESA is the agency's
 * own job-numbering configuration; nothing in this app ties a division to a board, and SABARMATI
 * is both a UGVCL division and Ahmedabad, which is Torrent Power territory. Reading a prefix as a
 * board would put an agency on one it may never have tendered with, and then hide the tenders it
 * actually needs - a filter failing silently, in the direction of showing less.
 */
export function codeFromDiscomName(discomName: string | null | undefined): string | null {
  const n = lettersOnly(discomName);
  if (!n) return null;
  if (/UTTARGUJARAT/.test(n) || n.startsWith('UGVCL')) return 'UGVCL';
  if (/MADHYAGUJARAT/.test(n) || n.startsWith('MGVCL')) return 'MGVCL';
  if (/PASCHIMGUJARAT/.test(n) || n.startsWith('PGVCL')) return 'PGVCL';
  if (/DAKSHINGUJARAT/.test(n) || n.startsWith('DGVCL')) return 'DGVCL';
  if (/GUJARATENERGYTRANSMISSION/.test(n) || n.startsWith('GETCO')) return 'GETCO';
  return null;
}

/** What the tender selector shows when an agency has no board recorded. Three states, not two. */
export type TenderListState = 'no-discom' | 'none-published' | 'ready';

/**
 * ⚠ "NO BOARD SET" AND "NO TENDERS FOR YOUR BOARD" ARE DIFFERENT PROBLEMS WITH DIFFERENT FIXES,
 * and an empty dropdown says neither. Eight of eighteen agencies have no board recorded, so the
 * first is the COMMON case rather than the edge one.
 */
export function tenderListState(
  agencyDiscomCode: string | null | undefined,
  matchingTemplateCount: number,
): TenderListState {
  if (!discomFor(agencyDiscomCode)) return 'no-discom';
  if (matchingTemplateCount === 0) return 'none-published';
  return 'ready';
}
