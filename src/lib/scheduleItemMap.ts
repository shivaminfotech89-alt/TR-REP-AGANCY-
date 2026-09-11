// WHICH SCHEDULE-A RATE EACH ESTIMATE LINE USES - as data, in one place.
//
// These pairings used to live only inside buildSingleJobEstimateData, as ~28 separate
// `resolveRate('X', scheduleRate('Y'))` calls. Nothing anywhere let a reader see them
// together, which is why item '8' quietly priced every HV bushing at the 11 KV rate and
// nobody could have noticed without reading the function line by line (AUDIT F48, O22).
//
// A table makes the next gap COUNTABLE: an item with no entry, or an entry whose variants
// are never all reachable, is visible by inspection rather than by tracing.
//
// WHAT THIS CARRIES: the pairing, and - for lines whose rate depends on the job - which
// axis selects between the variants.
// WHAT IT DOES NOT CARRY: quantity, unit, and whether the line applies at all. Those stay
// at the call sites, because they read inspection fields that have nothing to do with rate
// lookup, and moving them here would trade one illegible place for another.

export type VariantAxis =
  | 'winding-material'    // internalData.windingType -> Copper | Aluminium
  | 'kv-class'            // externalData.kv -> 11 | 22
  | 'capacity';           // per-capacity exception above the schedule's top band

export interface ScheduleItemMapping {
  /** Item code as it appears in the AGENCY MASTER. */
  masterCode: string;
  /** Human label, so a reader can check the pairing without opening two files. */
  masterName: string;
  /** Schedule-A `sr`, when one rate serves every job. */
  sr?: string;
  /** Schedule-A description for that sr - present so the pairing can be checked by meaning. */
  srName?: string;
  /** Set when the rate depends on the job. `sr` is then absent. */
  variants?: { axis: VariantAxis; options: Record<string, string>; note: string };
  /** Why a pairing that looks wrong is right. */
  note?: string;
}

/**
 * THE MASTER'S NUMBERING IS NOT THE SCHEDULE'S.
 *
 * Three pairings look like transcription errors and are not - the app's master and UGVCL's
 * Schedule-A number the same work differently. Descriptions are recorded beside each so the
 * next reader can satisfy themselves by meaning rather than re-deriving it:
 *
 *   master '20' "Testing Of Trans."     = schedule '19'  "Testing of transformer"
 *   master '21' "Repl. Of Rediator"     = schedule '20'  "Replacement of radiator"
 *   master '4'  (conservator tank)      = schedule '18b' "Conservator tank replacement"
 *
 * And one that IS aligned, listed because its neighbours are not:
 *   master '17' "Con. of Sealed to Bolt" = schedule '17' "conversion of sealed ... bolted"
 */
export const SCHEDULE_ITEM_MAP: ScheduleItemMapping[] = [
  { masterCode: '1a', masterName: 'Dismentaling',            sr: '1a',  srName: 'Dismantling charges' },
  { masterCode: '1b', masterName: 'Repl. of Gaskets',        sr: '1b',  srName: 'Replacement of gaskets' },
  { masterCode: '1c', masterName: 'HV/LV rod',               sr: '1c',  srName: 'Schedule-A sr 1c' },
  { masterCode: '1d', masterName: 'Insulating material',     sr: '1d',  srName: 'Schedule-A sr 1d' },
  { masterCode: '1e', masterName: 'Nut & bolt',              sr: '1e',  srName: 'Schedule-A sr 1e' },
  { masterCode: '1f', masterName: 'Drying',                  sr: '1f',  srName: 'Schedule-A sr 1f' },
  { masterCode: '2a', masterName: 'Clean dirty tank',        sr: '2a',  srName: 'Schedule-A sr 2a' },
  { masterCode: '2b', masterName: 'Spray painting',          sr: '2b',  srName: 'Schedule-A sr 2b' },
  { masterCode: '3',  masterName: 'Inside Painting',         sr: '3',   srName: 'Schedule-A sr 3' },
  { masterCode: '5',  masterName: 'Oil level glass',         sr: '5',   srName: 'Schedule-A sr 5' },
  { masterCode: '6',  masterName: 'Breather',                sr: '6',   srName: 'Schedule-A sr 6' },
  { masterCode: '9A', masterName: 'HV metal parts',          sr: '9A',  srName: 'Schedule-A sr 9A' },
  { masterCode: '9B', masterName: 'HV cross-arm',            sr: '9B',  srName: 'Schedule-A sr 9B' },
  { masterCode: '10', masterName: 'LV bushing',              sr: '10',  srName: 'Schedule-A sr 10' },
  { masterCode: '11A', masterName: 'LV metal parts',         sr: '11A', srName: 'Schedule-A sr 11A' },
  { masterCode: '11B', masterName: 'LV cross-arm',           sr: '11B', srName: 'Schedule-A sr 11B' },
  { masterCode: '15', masterName: 'Washer ring',             sr: '15',  srName: 'Insulation washer ring for coils (per job six)' },
  { masterCode: '16', masterName: 'Name Plating',            sr: '16',  srName: 'Schedule-A sr 16' },

  { masterCode: '17', masterName: 'Con. of Sealed to Bolt',  sr: '17',
    srName: 'Extra payment for conversion of sealed transformer into bolted type',
    note: 'Aligned - listed because its neighbours 20 and 21 are not.' },

  { masterCode: '4',  masterName: 'Conservator Tank Replacement', sr: '18b',
    srName: 'Conservator tank replacement charge (per kg)',
    note: "Numbering differs. Schedule '18a' is the MAIN tank and is a separate item - see the unpriced list below." },

  { masterCode: '20', masterName: 'Testing Of Trans.',       sr: '19',
    srName: 'Testing of transformer',
    note: 'Master numbering runs one ahead of the schedule here.' },

  // ---- coil rows: the MASTER already splits these by material, so each row is
  // unambiguous and takes a fixed sr. The estimate used to ask for '12A' / '13A' / '14',
  // which match no row at all, so the agency-override step was dead for all six (AUDIT
  // F51). The master's codes are irregular - '13b(b)' lower-cases the 'b' that '13A(a)'
  // capitalises - and they are reproduced here exactly as stored, not tidied.
  //
  // ⚠ THE HV S.E. PAIR IS HERE. THE LV S.E. PAIR AND THE ORIGINALS-MISSING ROWS ARE NOT. BOTH BY DECISION (AUDIT G64).
  //
  // HV S.E. - 12A(a1) / 12A(b1). The master is where an agency records its own rates; with S.E. read from
  // Schedule-A alone, the one rate the tender prices differently was the only one an agency could not touch.
  // This reverses O20's "no S.E. rows" decision (2026-09-11). The S.E. lookup names ONLY these codes - never
  // 12A(a) / 12A(b), and never the generic '12A', whose 163 would read as an override of 213 (proved before
  // building).
  //
  // ⚠ THE COPY TEST DISCARDS AN OVERRIDE EQUAL TO THE 2020 FIGURE, AND THESE ARE THE ROWS THAT INVITE ONE. A cell
  // holding 213 (407 copper) reads as a copy and the job's own tender's Schedule-A prices instead: on a
  // UGVCL-2026 AT, an agency typing 213 meaning "our rate is 213" is priced 215. See resolveRate.
  //
  // LV S.E. - 13A(a1) / 13A(b1) - ABSENT. The inspection records S.E. for the HV winding only (G61), so nothing
  // would read these rows, and a rate typed into one would be silently ignored. An absent row is better than a
  // row that discards an override. Do not complete the set until LV S.E. can be recorded.
  //
  // ORIGINALS MISSING - 12B / 13B - ABSENT. Nothing records whether originals are missing (O21), so nothing
  // would read those either.
  { masterCode: '12A(a)',   masterName: 'HV Wdg. (Not Miss) -CU', sr: '12A-a', srName: 'HT coil: Copper per kg, without S.E.' },
  { masterCode: '12A(a1)',  masterName: 'HV Wdg. (Not Miss) -CU S.E.', sr: '12A-a1', srName: 'HT coil: Copper per kg, with S.E.' },
  { masterCode: '12A(b)',   masterName: 'HV Wdg. (Not Miss) -AL', sr: '12A-b', srName: 'HT coil: Aluminium per kg, without S.E.' },
  { masterCode: '12A(b1)',  masterName: 'HV Wdg. (Not Miss) -AL S.E.', sr: '12A-b1', srName: 'HT coil: Aluminium per kg, with S.E.' },
  { masterCode: '13A(a)',   masterName: 'LV Wdg. (Not Miss) -CU', sr: '13A-a', srName: 'LT coil: Copper per kg, without S.E.' },
  { masterCode: '13b(b)',   masterName: 'LV Wdg. (Not Miss) -AL', sr: '13A-b', srName: 'LT coil: Aluminium per kg, without S.E.' },
  { masterCode: '14(ii)CU', masterName: 'LV Wdg. Re-Insu.-CU',    sr: '14-i',  srName: 'Re-insulation of LV coils with existing conductor: Copper' },
  { masterCode: '14(ii)AL', masterName: 'LV Wdg. Re-Insu.-AL',    sr: '14-ii', srName: 'Re-insulation of LV coils with existing conductor: Aluminium' },

  // ---- variant-dependent: the rate depends on the job, not on the item alone ----
  { masterCode: '21', masterName: 'Repl. Of Rediator',
    variants: { axis: 'capacity', options: { 'upto-100': '20', 'above-100': 'RADIATOR_ABOVE_100' },
      note: "Schedule '20' up to 100 KVA. Above 100 the schedule's single B_ABOVE_100 band cannot express per-capacity rates, so RADIATOR_ABOVE_100 holds them - 200 and 500 differ, and 315 is not priced by the tender." } },

  { masterCode: '8',  masterName: 'HV Bushing',
    variants: { axis: 'kv-class', options: { '11': '8-A', '22': '8-B' },
      note: 'From externalData.kv. Anything other than 11 or 22 blocks rather than defaulting (F48).' } },

  // The generic coil codes. No master row carries them - the split rows above do - but the
  // estimate still falls back to them, so a master that predates the split keeps working.
  { masterCode: '12A', masterName: 'HV Coil (generic fallback)',
    variants: { axis: 'winding-material', options: { Aluminium: '12A-b', Copper: '12A-a' },
      note: "The without-S.E. rows. An S.E. job reads its own master row, 12A(a1) / 12A(b1), then Schedule-A 12A-a1 / 12A-b1 - never this code, whose 163 would read as an override of the S.E. rate (G61, G64). Copper priced from 12A-a since F52; it previously blocked, which mixed a rate question with a scrap question that the circle-limit indicator already answers. Originals-missing ('12B-*') is unreachable - nothing records it (O21)." } },

  { masterCode: '13A', masterName: 'LV Coil (generic fallback)',
    variants: { axis: 'winding-material', options: { Aluminium: '13A-b', Copper: '13A-a' },
      note: "Material as 12A, but ALWAYS without S.E.: there is no LV S.E. answer, by decision (G61). 13A-a1 / 13A-b1 are in Schedule-A and unused - an LV S.E. transformer would price without S.E. (a stated limit). Originals-missing ('13B-*') likewise unreachable (O21)." } },

  { masterCode: '14', masterName: 'Re-insulation LV Coil (generic fallback)',
    variants: { axis: 'winding-material', options: { Copper: '14-i', Aluminium: '14-ii' },
      note: 'Driven by coils marked RI; both variants reachable (F46).' } },

  { masterCode: '12C', masterName: 'HV coil winding labour',
    variants: { axis: 'winding-material', options: { Copper: '12C-a', Aluminium: '12C-b' }, note: '' } },

  { masterCode: '13C', masterName: 'LV coil winding labour',
    variants: { axis: 'winding-material', options: { Copper: '13C-a', Aluminium: '13C-b' }, note: '' } },
];

/**
 * Master item codes that are deliberately NOT priced from Schedule-A, so a reader does not
 * record them as gaps. Kept beside the map because "absent from the table" and "absent on
 * purpose" look identical otherwise.
 */
export const NOT_FROM_SCHEDULE_A: Record<string, string> = {
  '22': 'Scrap charge (CRGO). Priced by resolveScrapCharge from the estimate master, flat Rs 500 - not from Schedule-A.',
  '0': 'Scrap charge (Amorphous / Wound Core). As above.',
  '18': 'Repl. Of Tank. NOT PRICED AT ALL - schedule 18a exists (Rs 54/kg) but no line resolves it and no field captures a tank weight. See AUDIT O22.',
};

/**
 * COIL MASTER ROWS, AND THE BUILDER LINE EACH ONE SHOWS - MATCHED BY TENDER ROW (AUDIT G64).
 *
 * The builder emits one coil line per job - coded '12A' / '13A' / '14' - and carries on it the Schedule-A row
 * it was priced as (`scheduleSr`, G62). The master carries one row per tender row: per winding material, and
 * for the HV coil per S.E. answer as well. A master row takes the line whose `scheduleSr` is ITS row, so a
 * charge lands on exactly one row, and it is the row the printed estimate's Sr. No. names.
 *
 * ⚠ THIS USED TO MATCH BY MATERIAL ALONE. With 12A(b1) in the master, that put an S.E. job's HV coil on
 * 12A(b) - the without-S.E. row - in the Excel export and on the multi-job sheet, contradicting the estimate.
 *
 * Which master row is which Schedule-A row is SCHEDULE_ITEM_MAP's to say; it is not repeated here.
 */
export const CODED_COIL_MASTER_ROWS: Record<string, string> = {
  '12a(a)': '12A', '12a(a1)': '12A', '12a(b)': '12A', '12a(b1)': '12A',
  '13a(a)': '13A', '13b(b)': '13A',
  '14(ii)cu': '14', '14(ii)al': '14',
};

/**
 * The builder line a master row shows for a job, or undefined when the row does not apply to it.
 *
 * Undefined for every coil row when the winding material is unknown: an unresolved material must not land the
 * charge on any row. A row that is not a coil row matches on its item code, as before - excluding the
 * 'Labour Charge' line, which the caller places by description.
 */
export function lineForMasterRow<L extends { itemCode?: string; scheduleSr?: string; desc?: string }>(
  masterCode: string,
  lines: L[],
  material: 'Copper' | 'Aluminium' | null,
): L | undefined {
  const raw = String(masterCode ?? '').trim();
  const builderCode = CODED_COIL_MASTER_ROWS[raw.toLowerCase()];
  if (builderCode) {
    if (material === null) return undefined;
    const sr = scheduleSrForMasterCode(raw);
    if (!sr) return undefined;
    return lines.find(l => String(l.itemCode ?? '') === builderCode && String(l.scheduleSr ?? '').toLowerCase() === sr.toLowerCase());
  }
  return lines.find(l => String(l.itemCode ?? '').toLowerCase() === raw.toLowerCase() && l.desc !== 'Labour Charge');
}

/** The single lookup. Returns the Schedule-A `sr` for an unambiguous item, else null. */
export function scheduleSrForMasterCode(masterCode: string): string | null {
  const hit = SCHEDULE_ITEM_MAP.find(m => m.masterCode.toLowerCase() === String(masterCode).trim().toLowerCase());
  return hit?.sr ?? null;
}

/** Whether this item's rate depends on the job rather than on the item alone. */
export function variantAxisForMasterCode(masterCode: string): ScheduleItemMapping['variants'] | null {
  const hit = SCHEDULE_ITEM_MAP.find(m => m.masterCode.toLowerCase() === String(masterCode).trim().toLowerCase());
  return hit?.variants ?? null;
}


/**
 * CLAUSE 4.0 EXCLUSIONS — tank, conservator tank and radiator.
 *
 * "Tank, conservator tank and radiator damage charges are excluded from the 25% / 30%
 * computation." So the figure a circle office measures against the sanction limit is NOT
 * the estimate total: it is the estimate minus these three.
 *
 * ⚠ MASTER CODES, DERIVED FROM THE MAPPING ABOVE, NOT SCHEDULE NUMBERS. The clause names
 * Schedule-A sr 18a, 18b and 20; the estimate's line items carry the app's MASTER codes,
 * and the two numbering systems do not agree - schedule '20' is the app's '21', and the
 * app's '20' is schedule '19' (Testing), which is NOT excluded. Matching the clause's
 * numbers against line-item codes would exclude Testing and keep the radiator: the exact
 * inversion. See SCHEDULE_ITEM_MAP.
 *
 * ⚠ AND IT IS NOT A CODE LIST FOR THE RADIATOR. Above 100 KVA the radiator resolves through
 * RADIATOR_ABOVE_100 rather than a schedule band, because 200 and 500 differ and the band
 * cannot express that. It is still master code '21' on the line item either way, which is
 * why this keys on the LINE ITEM's code rather than on how the rate was found.
 *
 * '18' (main tank) is here although NOTHING EMITS IT TODAY - the tank line is unpriced, no
 * field captures a tank weight (AUDIT O22). Excluding it now is a no-op that costs nothing
 * and means the exclusion is already correct on the day the tank becomes priceable, rather
 * than being a second thing someone has to remember then.
 */
export const CLAUSE_4_EXCLUDED_MASTER_CODES: ReadonlySet<string> = new Set([
  '18',  // Repl. Of Tank            -> Schedule-A 18a  (not emitted today; see O22)
  '4',   // Conservator Tank Repl.   -> Schedule-A 18b
  '21',  // Repl. Of Rediator        -> Schedule-A 20  (and RADIATOR_ABOVE_100 above 100 KVA)
]);

/** Is this line item excluded from the Clause 4.0 sanction-limit computation? */
export function isClause4Excluded(itemCode: unknown): boolean {
  return CLAUSE_4_EXCLUDED_MASTER_CODES.has(String(itemCode ?? '').trim());
}
