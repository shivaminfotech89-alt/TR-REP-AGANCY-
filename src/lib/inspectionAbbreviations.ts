/**
 * WHAT THE INSPECTION SCREENS' ABBREVIATIONS MEAN - THE ONE PLACE IT IS WRITTEN (AUDIT G98).
 *
 * Both inspection screens' legends and their header tooltips read from here. Before this, the
 * meanings lived only in five scattered `title` attributes, which do not work on a phone - and
 * those screens are used on phones - and had already begun to disagree with the screens around
 * them: the LV coil header said DMG while its dropdown said DAM, and the DC tooltip offered two
 * meanings at once.
 *
 * ⚠⚠ EVERY MEANING BELOW WAS CONFIRMED BY THE OPERATOR, NOT INFERRED FROM A FIELD NAME.
 *
 * A first pass derived meanings from field names, option lists and code comments, and marked each
 * as certain or guessed. The operator then answered every one. That list is the source here; the
 * inference is not. An expansion that is plausible and wrong is worse than none, because an
 * operator reading a legend treats it as authoritative.
 *
 * ⚠ AND SOME HEADERS ARE DELIBERATELY ABSENT, because nobody has confirmed them:
 *
 *     HV/LV Rod   the first pass guessed "3 HV + 4 LV bushing rods" from a default of 7. The owner
 *                 asked for this to be asked again rather than shipped as an inference.
 *     OIL AVL     not in the operator's answers. The export's own wording ("OIL AVAIL LTRS")
 *     NET SHRT    suggests "oil available" and "net shortage", but that is still a reading.
 *     HV LIMB     not in the answers.
 *     HV S.E.     not in the answers here (its code tooltip explains the Schedule-A pricing).
 *
 * `UNCONFIRMED_HEADERS` lists them, and a test fails if any is given a meaning below without being
 * removed from that list first. Add one when the operator confirms it - never from a field name.
 *
 * ⚠ SCREEN ONLY. Nothing here may reach a printed inspection report: the legend is `print:hidden`
 * and sits outside the `printable-*-inspection-sheet` element the Print button copies. The printed
 * tables carry their own `title` attributes and were deliberately left unedited, so their source
 * could be proved byte-identical by hash.
 */

export interface Abbreviation {
  /** Exactly as it appears in a header or a cell. */
  short: string;
  meaning: string;
  /** Anything an operator needs beyond the words, e.g. how it prices. */
  detail?: string;
}

export const COLUMN_ABBREVIATIONS = {
  KVA:       { short: 'KVA',      meaning: 'Kilo-Volt-Ampere - load capacity' },
  KV:        { short: 'KV',       meaning: 'Kilo-Volt - voltage class, 11 or 22' },
  CRGO:      { short: 'CRGO',     meaning: 'Cold-Rolled Grain-Oriented - the core steel' },

  OIL_CAP:   { short: 'Oil Cap (L)',  meaning: 'Oil capacity, in litres' },
  LESS_OIL:  { short: 'Less Oil (L)', meaning: 'Oil missing or short, in litres' },
  SL_BL:     { short: 'SL / BL',  meaning: 'Sealed / Bolted - the tank seal type',
               detail: 'Also records whether a Sealed-to-Bolted conversion is required.' },
  DRY_ACT:   { short: 'Dry Act',  meaning: 'Dry Active Parts - drying the internal core and windings' },
  CLN_TANK:  { short: 'Cln Tank', meaning: 'Clean Tank' },
  OIL_LEV:   { short: 'Oil Lev',  meaning: 'Oil Level Indicator / Glass' },
  OUT_PAINT: { short: 'Out Paint', meaning: 'Outside Paint' },
  NAME_PLT:  { short: 'Name Plt', meaning: 'Name Plate' },
  DAM_CT:    { short: 'Dam CT',   meaning: 'Damaged Conservator Tank' },
  DAM_RAD:   { short: 'Dam Rad',  meaning: 'Damaged Radiator (fins / pipes)' },
  B:         { short: 'B',        meaning: 'Bushing' },
  M:         { short: 'M',        meaning: 'Metal Parts' },
  CC:        { short: 'CC',       meaning: 'Cap / Connector - the bushing cap and the connector together' },

  WIND:      { short: 'Wind',     meaning: 'Winding material - AL aluminium, CU copper' },
  HV_HT:     { short: 'HV / HT',  meaning: 'High Voltage / High Tension - the two are used interchangeably' },
  LV_LT:     { short: 'LV / LT',  meaning: 'Low Voltage / Low Tension - the two are used interchangeably' },
  RYB:       { short: 'R / Y / B', meaning: 'Red, Yellow, Blue - the three phases' },
  WAS_RING:  { short: 'Was Ring', meaning: 'Washers and Rings' },
  IN_PNT:    { short: 'In Pnt',   meaning: 'Inside Paint' },
  TST_TRN:   { short: 'Tst Trn',  meaning: 'Testing of Transformer' },
  DC:        { short: 'DC',       meaning: 'Dismantling Charge' },
  INSULA:    { short: 'Insula',   meaning: 'Insulation - re-insulation materials and process' },
} as const satisfies Record<string, Abbreviation>;

export const VALUE_ABBREVIATIONS = {
  /**
   * ⚠ DMG IS THE OPERATOR'S TERM, AND THE DROPDOWN STILL SHOWS DAM - ON PURPOSE, FOR NOW.
   *
   * The operator confirmed DMG, and that the dropdown emitting DAM is the inconsistency. But DAM
   * is the STORED value, and it is read: SingleJobEstimateReport counts 'DAM' coils to price LV
   * coil replacement (Schedule-A 13A), and InternalInspection uses it for weights. Changing what
   * the dropdown emits would make every one of those comparisons miss - silently, the same failure
   * SingleJobEstimateReport:1283 records having happened once already. Renaming the value is its
   * own change, with the stored data and every consumer, not a side effect of a legend.
   */
  DMG: { short: 'DMG', meaning: 'Damaged - complete replacement; scrap weight is calculated',
         detail: 'Shown as DAM in the LV coil dropdown.' },
  RI:  { short: 'RI',  meaning: 'Re-Insulation - conductor intact, paper insulation burned, needs re-wrapping' },
  OK:  { short: 'OK',  meaning: 'Sound - no repairs needed' },
  TBR: { short: 'TBR', meaning: 'To Be Replaced - not repaired' },
  Y:   { short: 'Y',   meaning: 'Yes' },
  N:   { short: 'N',   meaning: 'No' },
  NA:  { short: '-',   meaning: 'Not applicable' },
} as const satisfies Record<string, Abbreviation>;

export type ColumnKey = keyof typeof COLUMN_ABBREVIATIONS;
export type ValueKey = keyof typeof VALUE_ABBREVIATIONS;

/** Headers on these screens that have NO confirmed meaning yet. See the header comment. */
export const UNCONFIRMED_HEADERS: readonly string[] = ['HV/LV Rod', 'OIL AVL', 'NET SHRT', 'HV LIMB', 'HV S.E.'];

/** What each screen's legend lists - only what that screen actually shows. */
export const EXTERNAL_LEGEND_COLUMNS: readonly ColumnKey[] = [
  'KVA', 'KV', 'CRGO', 'OIL_CAP', 'LESS_OIL', 'SL_BL', 'DRY_ACT', 'CLN_TANK', 'OIL_LEV',
  'OUT_PAINT', 'NAME_PLT', 'DAM_CT', 'DAM_RAD', 'HV_HT', 'LV_LT', 'B', 'M', 'CC',
];
export const EXTERNAL_LEGEND_VALUES: readonly ValueKey[] = ['Y', 'N', 'NA', 'TBR'];

export const INTERNAL_LEGEND_COLUMNS: readonly ColumnKey[] = [
  'KVA', 'CRGO', 'WIND', 'HV_HT', 'LV_LT', 'RYB', 'WAS_RING', 'IN_PNT', 'TST_TRN', 'DC', 'INSULA',
];
export const INTERNAL_LEGEND_VALUES: readonly ValueKey[] = ['DMG', 'RI', 'OK', 'Y', 'N', 'NA'];

/** The meaning of a column, for a `title` attribute. One sentence, no detail. */
export function columnTitle(key: ColumnKey): string {
  return COLUMN_ABBREVIATIONS[key].meaning;
}
