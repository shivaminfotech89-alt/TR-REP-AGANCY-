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
  // ⚠ NO S.E. OR ORIGINALS-MISSING ROWS HERE, BY DECISION (2026-09-11, AUDIT O20). Schedule-A holds
  // sixteen coil rows per tender; the master holds these four without-S.E. rows. That is not an
  // unfinished set. Pricing reads Schedule-A whenever the master has no row, so an S.E. job prices
  // 12A-b1 / 13A-b1 correctly without one - and every row added is another cell that can disagree
  // with the tender. Do not "complete" it.
  { masterCode: '12A(a)',   masterName: 'HV Wdg. (Not Miss) -CU', sr: '12A-a', srName: 'HT coil: Copper per kg, without S.E.' },
  { masterCode: '12A(b)',   masterName: 'HV Wdg. (Not Miss) -AL', sr: '12A-b', srName: 'HT coil: Aluminium per kg, without S.E.' },
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
      note: "The without-S.E. rows. An S.E. job reads 12A-a1 / 12A-b1 from Schedule-A directly and never this code, as the HV S.E. answer on the inspection selects (G61). Copper priced from 12A-a since F52; it previously blocked, which mixed a rate question with a scrap question that the circle-limit indicator already answers. Originals-missing ('12B-*') is unreachable - nothing records it (O21)." } },

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
 * Master rows that exist once PER WINDING MATERIAL, and the single line the estimate
 * builder emits for them.
 *
 * The builder produces one coil line per job, coded '12A' / '13A' / '14', because a job has
 * one winding material. The master carries two rows, one per material. Anything rendering
 * the master's rows against a job's estimate therefore needs to know which of the two rows
 * the job's line belongs on - putting it on both would double it, and matching on the
 * generic code alone would put it on neither.
 */
export const MATERIAL_SPECIFIC_MASTER_ROWS: Record<string, { material: 'Copper' | 'Aluminium'; builderCode: string }> = {
  '12a(a)':   { material: 'Copper',    builderCode: '12A' },
  '12a(b)':   { material: 'Aluminium', builderCode: '12A' },
  '13a(a)':   { material: 'Copper',    builderCode: '13A' },
  '13b(b)':   { material: 'Aluminium', builderCode: '13A' },
  '14(ii)cu': { material: 'Copper',    builderCode: '14'  },
  '14(ii)al': { material: 'Aluminium', builderCode: '14'  },
};

/**
 * The builder line code a master row should read, or null if this row does not apply to
 * this job. Null for the material that was not used, and null when the material is unknown -
 * an unresolved material must not silently land the charge on one of the two rows.
 */
export function builderCodeForMasterRow(
  masterCode: string,
  material: 'Copper' | 'Aluminium' | null,
): string | null {
  const raw = String(masterCode ?? '').trim();
  const split = MATERIAL_SPECIFIC_MASTER_ROWS[raw.toLowerCase()];
  if (!split) return raw;
  if (material === null) return null;
  return split.material === material ? split.builderCode : null;
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
