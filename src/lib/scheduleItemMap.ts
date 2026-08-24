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

  // ---- variant-dependent: the rate depends on the job, not on the item alone ----
  { masterCode: '21', masterName: 'Repl. Of Rediator',
    variants: { axis: 'capacity', options: { 'upto-100': '20', 'above-100': 'RADIATOR_ABOVE_100' },
      note: "Schedule '20' up to 100 KVA. Above 100 the schedule's single B_ABOVE_100 band cannot express per-capacity rates, so RADIATOR_ABOVE_100 holds them - 200 and 500 differ, and 315 is not priced by the tender." } },

  { masterCode: '8',  masterName: 'HV Bushing',
    variants: { axis: 'kv-class', options: { '11': '8-A', '22': '8-B' },
      note: 'From externalData.kv. Anything other than 11 or 22 blocks rather than defaulting (F48).' } },

  { masterCode: '12A', masterName: 'HV Coil',
    variants: { axis: 'winding-material', options: { Aluminium: '12A-b', Copper: 'BLOCKED' },
      note: "Without-S.E. variant - an agency fact, not derived (O20). Copper blocks: '12A-a' vs '12A-a1' is a Rs 50/kg swing the app cannot resolve. Originals-missing ('12B-*') is unreachable - nothing records it (O21)." } },

  { masterCode: '13A', masterName: 'LV Coil',
    variants: { axis: 'winding-material', options: { Aluminium: '13A-b', Copper: 'BLOCKED' },
      note: "As 12A. Originals-missing ('13B-*') likewise unreachable (O21)." } },

  { masterCode: '14', masterName: 'Re-insulation LV Coil',
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
