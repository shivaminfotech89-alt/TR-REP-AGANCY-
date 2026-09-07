// src/lib/ugvclSchedules.ts
//
// THE UGVCL RATE SCHEDULES, ONE SET PER TENDER. Schedule-A (CRGO item-wise) and
// Schedule-B (Amorphous / CRGO Wound Core fixed rate), transcribed from the
// tender documents.
//
// ⚠ THERE IS MORE THAN ONE SCHEDULE NOW, AND THE TENDER DECIDES WHICH APPLIES.
//
// The file was `ugvclSchedule2020.ts` and held exactly one, on the evidence that
// the schedule had been transcribed once and never revised. That evidence was
// about this repository, not about UGVCL: AT 1819 (2026-28) reprices nearly
// every row of Schedule-A by roughly 0.85%, so a second schedule exists and both
// have to be live at once. Jobs still being finished under AT 26-27 must keep
// pricing at 2020 rates while anything booked under 1819 uses 2026 - which is
// exactly what F72 and F73 built the per-tender resolution for.
//
// Rates are exclusive of GST. The AT's above/below percentage is applied on
// top, as entered by the user in AT details - and it is per AGENCY as well as
// per tender, because it is what that agency bid. It is never part of a schedule.
//
// ---------------------------------------------------------------------------
// THE CAPACITY BAND PROBLEM
//
// Schedule-A does NOT price per capacity. It prices in six BANDS:
//
//     5 KVA | 10 & 16 | 25 | 50, 63, 75 | 100 | above 100
//
// The app's EstimateRates interface has ten discrete keys
// (5,10,16,25,50,63,100,200,315,500). 200, 315 and 500 all fall in the single
// "above 100 KVA" band, and that band has DIFFERENT rates from the 100 KVA
// column - not the same ones. Because those keys were never populated, every
// estimate above 100 KVA silently fell back to lower-band rates.
// ---------------------------------------------------------------------------

export type ScheduleBand = 'B5' | 'B10_16' | 'B25' | 'B50_63_75' | 'B100' | 'B_ABOVE_100';

/** Maps a transformer capacity to its Schedule-A rate band. */
export function bandForKva(kva: number): ScheduleBand {
  if (kva <= 5) return 'B5';
  if (kva <= 16) return 'B10_16';
  if (kva <= 25) return 'B25';
  if (kva <= 75) return 'B50_63_75';   // covers 50, 63 and 75
  if (kva <= 100) return 'B100';
  return 'B_ABOVE_100';                // 200, 315, 500
}

export interface BandRates {
  B5: number;
  B10_16: number;
  B25: number;
  B50_63_75: number;
  B100: number;
  B_ABOVE_100: number;
}

export interface ScheduleAItem {
  sr: string;
  name: string;
  unit: string;
  rates: BandRates;
}

const flat = (v: number): BandRates => ({
  B5: v, B10_16: v, B25: v, B50_63_75: v, B100: v, B_ABOVE_100: v,
});

// ---------------------------------------------------------------------------
// SCHEDULE-A — item-wise rate for repairing 11/22 KV, 5 to 500 KVA CRGO
// (STACK / DRY / PAT / SDT) distribution transformers
// ---------------------------------------------------------------------------

export const SCHEDULE_A: ScheduleAItem[] = [
  { sr: '1a', name: 'Labour charge only (loading/unloading, draining oil, untanking, re-assembly)', unit: 'Job',
    rates: { B5: 1374, B10_16: 1603, B25: 2061, B50_63_75: 2061, B100: 2061, B_ABOVE_100: 2061 } },

  { sr: '1b', name: 'Replacement of top cover gasket, oil gauge, air plug, oil cap, breather cap, thermometer pocket cap, explosion vent flat gaskets', unit: 'No.',
    rates: { B5: 28.75, B10_16: 40, B25: 46, B50_63_75: 46, B100: 46, B_ABOVE_100: 46 } },

  { sr: '1c', name: 'Replacement of HV/LV rod gaskets (flat gasket, D bush, cone bush)', unit: 'Rod',
    rates: { B5: 20.7, B10_16: 28.75, B25: 34, B50_63_75: 34, B100: 34, B_ABOVE_100: 57 } },

  { sr: '1d', name: 'Replacement of insulation (core-LV wrap, LV-HV wrap, phase barriers, yoke-channel barrier, wedges, intercoil spacers, blocks, main lead, interlayer)', unit: 'Job',
    rates: { B5: 115, B10_16: 229, B25: 286, B50_63_75: 286, B100: 286, B_ABOVE_100: 389 } },

  { sr: '1e', name: 'Replacement of M.S. bolt-nuts (top lid bolts, HV bushing studs, oil gauge studs, conservator bolts, explosion vent bolts & nuts)', unit: 'Job',
    rates: { B5: 34, B10_16: 46, B25: 57, B50_63_75: 57, B100: 57, B_ABOVE_100: 80 } },

  { sr: '1f', name: 'Drying of active part by ovening 48-72 hours at 90-100°C', unit: 'Job',
    rates: { B5: 137, B10_16: 183, B25: 229, B50_63_75: 229, B100: 229, B_ABOVE_100: 344 } },

  { sr: '2a', name: 'Cleaning dirty tank outside surface & preparing outer surface for painting', unit: 'No.',
    rates: { B5: 23, B10_16: 28.75, B25: 34, B50_63_75: 34, B100: 34, B_ABOVE_100: 34 } },

  { sr: '2b', name: 'Spray painting by synthetic enamel paint', unit: 'No.',
    rates: { B5: 86, B10_16: 115, B25: 149, B50_63_75: 149, B100: 149, B_ABOVE_100: 195 } },

  { sr: '3', name: 'Inside painting of tank', unit: 'No.',
    rates: { B5: 115, B10_16: 137, B25: 156, B50_63_75: 156, B100: 156, B_ABOVE_100: 176 } },

  { sr: '4i',  name: 'Replacement of valve (gun metal brass), size 3/4"',   unit: 'No.', rates: flat(137) },
  { sr: '4ii', name: 'Replacement of valve (gun metal brass), size 1 1/4"', unit: 'No.', rates: flat(203) },

  { sr: '5', name: 'Replacement of glass of oil level gauge', unit: 'No.', rates: flat(46) },

  { sr: '6', name: 'Replacement of breather, dully charged', unit: 'No.',
    rates: { B5: 0, B10_16: 309, B25: 309, B50_63_75: 309, B100: 309, B_ABOVE_100: 309 } },

  { sr: '7', name: 'Replacement of tap changing switch', unit: 'No.',
    rates: { B5: 0, B10_16: 0, B25: 0, B50_63_75: 3435, B100: 4008, B_ABOVE_100: 5153 } },

  { sr: '8-A', name: 'Replacement of HT bushing porcelain, 11 KV', unit: 'No.', rates: flat(176) },
  { sr: '8-B', name: 'Replacement of HT bushing porcelain, 22 KV', unit: 'No.', rates: flat(265) },

  { sr: '9A', name: 'Replacement of HT metal parts complete per piece, brass metal parts', unit: 'No.', rates: flat(131) },
  { sr: '9B', name: 'Providing HV connectors for cable connection', unit: 'No.', rates: flat(80) },

  { sr: '10', name: 'Replacement of LT bushing porcelain', unit: 'No.',
    rates: { B5: 59.8, B10_16: 59.8, B25: 59.8, B50_63_75: 59.8, B100: 59.8, B_ABOVE_100: 98 } },

  { sr: '11A', name: 'Replacement of LT metal parts complete set', unit: 'No.',
    rates: { B5: 156, B10_16: 156, B25: 156, B50_63_75: 156, B100: 156, B_ABOVE_100: 289 } },

  { sr: '11B', name: 'Providing LV connectors for cable connection', unit: 'No.',
    rates: { B5: 149, B10_16: 149, B25: 149, B50_63_75: 149, B100: 149, B_ABOVE_100: 183 } },

  // 12A - HT coil replacement, original coils NOT missing. Rates net of salvage.
  { sr: '12A-a',   name: 'HT coil: Copper per kg, without S.E.',    unit: 'Kg', rates: flat(357) },
  { sr: '12A-a1',  name: 'HT coil: Copper per kg, with S.E.',       unit: 'Kg', rates: flat(407) },
  { sr: '12A-b',   name: 'HT coil: Aluminium per kg, without S.E.', unit: 'Kg', rates: flat(163) },
  { sr: '12A-b1',  name: 'HT coil: Aluminium per kg, with S.E.',    unit: 'Kg', rates: flat(213) },

  // 12B - as 12A but original coils ARE missing
  { sr: '12B-a',   name: 'HT coil (originals missing): Copper per kg, without S.E.',    unit: 'Kg', rates: flat(519) },
  { sr: '12B-a1',  name: 'HT coil (originals missing): Copper per kg, with S.E.',       unit: 'Kg', rates: flat(569) },
  { sr: '12B-b',   name: 'HT coil (originals missing): Aluminium per kg, without S.E.', unit: 'Kg', rates: flat(219) },
  { sr: '12B-b1',  name: 'HT coil (originals missing): Aluminium per kg, with S.E.',    unit: 'Kg', rates: flat(269) },

  { sr: '12C-a', name: 'Labour charge for HV coil winding: Copper per kg',    unit: 'Kg', rates: flat(11) },
  { sr: '12C-b', name: 'Labour charge for HV coil winding: Aluminium per kg', unit: 'Kg', rates: flat(34) },

  // 13A - LT coil replacement, original coils NOT missing
  { sr: '13A-a',  name: 'LT coil: Copper per kg, without S.E.',    unit: 'Kg', rates: flat(314) },
  { sr: '13A-a1', name: 'LT coil: Copper per kg, with S.E.',       unit: 'Kg', rates: flat(364) },
  { sr: '13A-b',  name: 'LT coil: Aluminium per kg, without S.E.', unit: 'Kg', rates: flat(149) },
  { sr: '13A-b1', name: 'LT coil: Aluminium per kg, with S.E.',    unit: 'Kg', rates: flat(199) },

  // 13B - as 13A but original coils ARE missing
  { sr: '13B-a',  name: 'LT coil (originals missing): Copper per kg, without S.E.',    unit: 'Kg', rates: flat(491) },
  { sr: '13B-a1', name: 'LT coil (originals missing): Copper per kg, with S.E.',       unit: 'Kg', rates: flat(541) },
  { sr: '13B-b',  name: 'LT coil (originals missing): Aluminium per kg, without S.E.', unit: 'Kg', rates: flat(205) },
  { sr: '13B-b1', name: 'LT coil (originals missing): Aluminium per kg, with S.E.',    unit: 'Kg', rates: flat(255) },

  { sr: '13C-a', name: 'Labour charge for LV coil winding: Copper per kg',    unit: 'Kg', rates: flat(17) },
  { sr: '13C-b', name: 'Labour charge for LV coil winding: Aluminium per kg', unit: 'Kg', rates: flat(51.75) },

  { sr: '14-i',  name: 'Re-insulation of LV coils with existing conductor: Copper per kg',    unit: 'Kg', rates: flat(101) },
  { sr: '14-ii', name: 'Re-insulation of LV coils with existing conductor: Aluminium per kg', unit: 'Kg', rates: flat(115) },

  { sr: '15', name: 'Insulation washer ring for coils (per job six)', unit: 'No.', rates: flat(54) },
  { sr: '16', name: 'Rating plate charge for WNP transformer',        unit: 'No.', rates: flat(143) },
  { sr: '17', name: 'Extra payment for conversion of sealed transformer into bolted type', unit: 'No.', rates: flat(1511) },

  { sr: '18a', name: 'Tank replacement charge (per kg)',             unit: 'Kg', rates: flat(54) },
  { sr: '18b', name: 'Conservator tank replacement charge (per kg)', unit: 'Kg', rates: flat(54) },

  { sr: '19', name: 'Testing of transformer', unit: 'No.',
    rates: { B5: 115, B10_16: 115, B25: 172, B50_63_75: 172, B100: 172, B_ABOVE_100: 172 } },

  // NOTE: the "above 100" cell for radiator is split by capacity in the
  // document: 1971.69 for 200 KVA and 2630.06 for 500 KVA. It is therefore NOT
  // a single band value - see RADIATOR_ABOVE_100 below.
  { sr: '20', name: 'Replacement of radiator, rate per radiator', unit: 'No.',
    rates: { B5: 0, B10_16: 1052, B25: 1052, B50_63_75: 1248, B100: 1446, B_ABOVE_100: 1971.69 } },

  { sr: '21', name: 'Overhauling of transformer including outside cleaning and painting (physical damages charged extra at above rates)', unit: 'No.',
    rates: { B5: 1992, B10_16: 2460, B25: 3162, B50_63_75: 3162, B100: 3162, B_ABOVE_100: 3481 } },
];

/** Radiator replacement is capacity-specific inside the "above 100" band. */
export const RADIATOR_ABOVE_100: Record<number, number> = {
  200: 1971.69,
  500: 2630.06,
  // 315 KVA is not listed in the document. Do not interpolate - block and ask.
};

// ---------------------------------------------------------------------------
// SCHEDULE-B — Amorphous / CRGO Wound Core, FIXED RATE (internal & external)
// ---------------------------------------------------------------------------

export interface ScheduleBItem {
  sr: string;
  kva: number;
  winding: 'Aluminium' | 'Copper';
  /** 'transformer' = rate is per whole transformer; 'coil' = rate is per coil/limb. */
  basis: 'transformer' | 'coil';
  /** Weight range or limb weight quoted in the schedule, for reference. */
  weightNote: string;
  fixedRate: number;
  /** Separate labour charge per transformer, where the schedule lists one. */
  labourPerTransformer?: number;
  /**
   * The SUPPLY ORDER this row is specific to, where the schedule prices one.
   *
   * Replaces the old `makeNote` free-text description as the thing the code MATCHES ON.
   * 1d-2 is not "the Vijay rate" - it is the rate for units supplied under ADB/1804, which
   * happen to be Vijay make and carry a heavier coil (90.21 kg against 1d-1's 50 to 67 kg).
   * The order is the identifying fact; the maker is a description of it.
   */
  supplyOrder?: string;
  /** Make-specific variant, for display. NEVER MATCH ON THIS - see supplyOrder. */
  makeNote?: string;
}

/**
 * The supply-order values a job can carry, and what they mean to the rate lookup.
 *
 * ⚠ THIS IS NOT AN "AT NUMBER". In this codebase AT means ANNUAL TENDER - `atMasters`,
 * `job.atId`, the rate contract a job is priced under. ADB/1804 is a supply order: the
 * consignment a particular transformer arrived under. An operator will reasonably call both
 * "the AT number", and naming this field that way would put a third meaning on the word in
 * the field that chooses between two rates. See the terminology entry in AUDIT.
 */
export const SUPPLY_ORDER_ADB_1804 = 'ADB/1804';
/** An affirmative "this unit is not from that order" - NOT the same as unanswered. */
export const SUPPLY_ORDER_OTHER = 'OTHER';

export const SUPPLY_ORDER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '' },
  { value: SUPPLY_ORDER_ADB_1804, label: 'ADB/1804' },
  { value: SUPPLY_ORDER_OTHER, label: 'Other - not ADB/1804' },
];

export const SCHEDULE_B: ScheduleBItem[] = [
  // 1 - Aluminium winding
  { sr: '1a',   kva: 10,  winding: 'Aluminium', basis: 'transformer', weightNote: 'Total Al. coil weight 21 to 33 Kg', fixedRate: 4927 },
  { sr: '1b',   kva: 16,  winding: 'Aluminium', basis: 'transformer', weightNote: 'Total Al. coil weight 27 to 39 Kg', fixedRate: 5202 },
  { sr: '1c',   kva: 25,  winding: 'Aluminium', basis: 'transformer', weightNote: 'Total Al. coil weight 26 to 45 Kg', fixedRate: 8395 },
  { sr: '1d-1', kva: 63,  winding: 'Aluminium', basis: 'transformer', weightNote: 'Total Al. coil weight 50 to 67 Kg', fixedRate: 13746 },
  { sr: '1d-2', kva: 63,  winding: 'Aluminium', basis: 'transformer', weightNote: 'Total Al. coil weight 90.21 Kg', fixedRate: 16746, supplyOrder: SUPPLY_ORDER_ADB_1804, makeNote: 'ADB/1804, Vijay Make' },
  { sr: '1e',   kva: 100, winding: 'Aluminium', basis: 'transformer', weightNote: 'Total Al. coil weight 67 to 84 Kg', fixedRate: 17970 },
  { sr: '1f',   kva: 200, winding: 'Aluminium', basis: 'coil',        weightNote: 'Each coil, limb weight 69 Kg', fixedRate: 10148, labourPerTransformer: 2345 },

  // 2 - Copper winding
  { sr: '2a', kva: 5,   winding: 'Copper', basis: 'transformer', weightNote: '', fixedRate: 4208 },
  { sr: '2b', kva: 63,  winding: 'Copper', basis: 'coil', weightNote: 'Each coil, limb weight 32 Kg', fixedRate: 9642,  labourPerTransformer: 2345 },
  { sr: '2c', kva: 100, winding: 'Copper', basis: 'coil', weightNote: 'Each coil, limb weight 63 Kg', fixedRate: 18961, labourPerTransformer: 2345 },
  { sr: '2d', kva: 200, winding: 'Copper', basis: 'coil', weightNote: 'Each coil, limb weight 92 Kg', fixedRate: 27720, labourPerTransformer: 2345 },
];

/**
 * Radiator / tank / conservator replacement under Schedule-B (items 3 to 6).
 * Charged extra, only when the UGVCL engineer demands replacement instead of
 * repair. Old material must be credited to the divisional store.
 */
export const SCHEDULE_B_EXTRAS = {
  tankReplacementPerKg: 54,             // item 3
  conservatorReplacementPerKg: 54,      // item 4
  completeRadiatorReplacement: {        // item 5
    25: 1057,
    63: 1256,
    100: 1452,
  } as Record<number, number>,
  sealingUneconomicalUnit: 189,         // item 6, welding at six places for return
};

/** Overhauling (Schedule-B item 7) is priced by Schedule-A item 21. */
export const OH_USES_SCHEDULE_A_ITEM = '21';

// ---------------------------------------------------------------------------
// Notes carried from the tender
// ---------------------------------------------------------------------------

export const SCHEDULE_NOTES = {
  gst: 'Rates quoted by bidder are exclusive of GST plus 4% above. Any escalation in GST during the contract is paid by UGVCL as statutory variation on production of document.',
  salvage: 'Above rates quoted are net of the salvage value.',
  coilOverweight: 'Additional charge is paid on proportional weight where the coil/limb weight exceeds the maximum specified at Sr. No. 1(a) to 1(f) and 2(a) to 2(d) of Schedule-B.',
  ltCoilDamage: 'In case of damage to the LT coil, the damaged coil is replaced at the same cost, without extra charge.',
  estimateApproval: 'Repairing cost is capped at 25% of the cost of a NEW transformer. Failed transformers may not be opened before approval of the estimate, except in the presence of an authorised UGVCL representative.',
};

/**
 * Default printed text for the Amorphous / CRGO Wound Core fixed-rate estimate report
 * (verbatim from the tender). Agencies can override each via amorphousClauseText /
 * amorphousNoteLtCoil / amorphousNoteRadiator, since another DISCOM's tender wording
 * may differ - these are only the fallback when an agency hasn't set its own.
 */
export const AMORPHOUS_ESTIMATE_TEXT = {
  clause: 'Repairing of the transformer of below rating, winding material and winding design for internal items including Re-insulation/replacement of all the LV windings, Replacement of all the HV windings, replacement of burnt/damaged external parts like bushing/nut-bolts/breather with Dismantling of bushing replacement of all the old gaskets by new, opening welding of top cover plate if necessary un-tanking of the winding, removal of the core plate assembly and reassembly of the same including replacement of all types of insulations whenever necessary replacement of diaphragm of explosion vent, drying out of the repaired transformers, internal & external painting, testing of the same, assembly of LV/HV coils and connectors, loading & unloading of transformers, repairing of Tanks & radiators by welding to stop leakage of oil, dismantling includes removing of core, lamination and rebuilding after cleaning, fixing of name plates on unit rate basis as mentioned herein and wherever mentioned in this tender.',
  noteLtCoil: 'Note: In case of damage of LT coil if any, the damaged coil should be replaced at the same cost i.e. without any extra charge.',
  noteRadiator: "If the Radiator/s of tank or Conservator tank required to replace instead of repairing as demanded by the concerned UGVCL Engineer, the charges for that is required to pay extra as per the 'Item No. 3 to 6' of schedule, for which old material is required to credit in the respective Division Store.",
};

// ---------------------------------------------------------------------------
// SCHEDULE-A — UGVCL-2026, A/T UGVCL/EE-T-1/TRANS-REP/2026-28/01/AT/1819
// dated 07.09.2026, accepted at 7.00% above the estimated rate.
// ---------------------------------------------------------------------------
//
// ⚠ RATES ONLY. The item NAMES and UNITS are taken from the 2020 rows by `sr`, because the
// two schedules describe the same 51 items in the same order - the tender reissues prices,
// not the work. Repeating the descriptions would create a second place for them to be
// wrong, and the 2026 paper's wording differs cosmetically (fuller scope text) without
// naming a different item.
//
// The bands are UNCHANGED - the 2026 heading states the same six explicitly. Only the
// figures moved: 255 of 306 cells, by roughly 0.85%, with five rows untouched (5, 9B,
// 12C-a, 12C-b, 13C-a). Every cell above ~1.2% is a 2020 decimal rounded to an integer
// (28.75 -> 29, 59.8 -> 61, 51.75 -> 52), not a larger rise.
//
// Transcribed from schedule-a-ugvcl-2026.md, and diffed cell-by-cell against 2020 before
// commit rather than read across by eye.
const SCHEDULE_A_2026_RATES: Array<[string, BandRates]> = [
  ['3', { B5: 116, B10_16: 138, B25: 157, B50_63_75: 157, B100: 157, B_ABOVE_100: 177 }],
  ['5', flat(46)],
  ['6', { B5: 0, B10_16: 312, B25: 312, B50_63_75: 312, B100: 312, B_ABOVE_100: 312 }],
  ['7', { B5: 0, B10_16: 0, B25: 0, B50_63_75: 3464, B100: 4042, B_ABOVE_100: 5196 }],
  ['10', { B5: 61, B10_16: 61, B25: 61, B50_63_75: 61, B100: 61, B_ABOVE_100: 99 }],
  ['15', flat(55)],
  ['16', flat(144)],
  ['17', flat(1524)],
  ['19', { B5: 116, B10_16: 116, B25: 174, B50_63_75: 174, B100: 174, B_ABOVE_100: 174 }],
  ['20', { B5: 0, B10_16: 1061, B25: 1061, B50_63_75: 1258, B100: 1458, B_ABOVE_100: 1988.29 }],
  ['21', { B5: 2009, B10_16: 2481, B25: 3189, B50_63_75: 3189, B100: 3189, B_ABOVE_100: 3510 }],
  ['1a', { B5: 1386, B10_16: 1617, B25: 2079, B50_63_75: 2079, B100: 2079, B_ABOVE_100: 2079 }],
  ['1b', { B5: 29, B10_16: 40, B25: 46, B50_63_75: 46, B100: 46, B_ABOVE_100: 46 }],
  ['1c', { B5: 21, B10_16: 29, B25: 34, B50_63_75: 34, B100: 34, B_ABOVE_100: 58 }],
  ['1d', { B5: 116, B10_16: 230, B25: 288, B50_63_75: 288, B100: 288, B_ABOVE_100: 392 }],
  ['1e', { B5: 34, B10_16: 46, B25: 58, B50_63_75: 58, B100: 58, B_ABOVE_100: 80 }],
  ['1f', { B5: 138, B10_16: 184, B25: 230, B50_63_75: 230, B100: 230, B_ABOVE_100: 347 }],
  ['2a', { B5: 24, B10_16: 29, B25: 34, B50_63_75: 34, B100: 34, B_ABOVE_100: 34 }],
  ['2b', { B5: 86, B10_16: 116, B25: 150, B50_63_75: 150, B100: 150, B_ABOVE_100: 197 }],
  ['4i', flat(138)],
  ['4ii', flat(205)],
  ['8-A', flat(177)],
  ['8-B', flat(268)],
  ['9A', flat(132)],
  ['9B', flat(80)],
  ['11A', { B5: 157, B10_16: 157, B25: 157, B50_63_75: 157, B100: 157, B_ABOVE_100: 291 }],
  ['11B', { B5: 150, B10_16: 150, B25: 150, B50_63_75: 150, B100: 150, B_ABOVE_100: 184 }],
  ['12A-a', flat(360)],
  ['12A-a1', flat(411)],
  ['12A-b', flat(165)],
  ['12A-b1', flat(215)],
  ['12B-a', flat(524)],
  ['12B-a1', flat(574)],
  ['12B-b', flat(221)],
  ['12B-b1', flat(272)],
  ['12C-a', flat(11)],
  ['12C-b', flat(34)],
  ['13A-a', flat(317)],
  ['13A-a1', flat(367)],
  ['13A-b', flat(150)],
  ['13A-b1', flat(201)],
  ['13B-a', flat(495)],
  ['13B-a1', flat(545)],
  ['13B-b', flat(207)],
  ['13B-b1', flat(257)],
  ['13C-a', flat(17)],
  ['13C-b', flat(52)],
  ['14-i', flat(102)],
  ['14-ii', flat(116)],
  ['18a', flat(55)],
  ['18b', flat(55)],
];

/**
 * The 2026 Schedule-A, built by pairing the rates above with the 2020 rows' names and units.
 *
 * A row present in 2026 but absent from 2020 would be dropped silently, so it throws instead:
 * the two schedules are the same 51 items and a mismatch means the transcription is wrong,
 * not that a rate is missing.
 */
export const SCHEDULE_A_2026: ScheduleAItem[] = SCHEDULE_A_2026_RATES.map(([sr, rates]) => {
  const base = SCHEDULE_A.find(i => i.sr === sr);
  if (!base) throw new Error(`UGVCL-2026 prices Schedule-A item "${sr}", which the 2020 schedule does not describe. Add the item's name and unit rather than letting it resolve to nothing.`);
  return { sr, name: base.name, unit: base.unit, rates };
});

/** Radiator replacement above 100 KVA — the one place 2026 keeps decimals. */
export const RADIATOR_ABOVE_100_2026: Record<number, number> = {
  200: 1988.29,
  500: 2652.20,
  // 315 KVA is not listed in the 2026 document either. Do not interpolate - block and ask.
};

// ---------------------------------------------------------------------------
// THE SCHEDULE REGISTRY — one ScheduleSet per tender
// ---------------------------------------------------------------------------

export type ScheduleId = 'UGVCL-2020' | 'UGVCL-2026';

export interface ScheduleSet {
  id: ScheduleId;
  /** What an operator picks it by. */
  label: string;
  /**
   * ⚠ FALSE WHILE THE TRANSCRIPTION IS INCOMPLETE, and it is load-bearing.
   *
   * A schedule that is registered but not yet transcribed must never price anything. An
   * incomplete set resolves no rates, so `resolveRate` returns null and the estimate blocks
   * by name - the safe failure - but an operator would meet that as a wall of blocked jobs
   * with no explanation. `scheduleReadiness` turns it into one sentence instead, and the AT
   * form refuses to offer an incomplete schedule at all.
   */
  complete: boolean;
  /** Why it is incomplete, shown wherever that matters. Empty when complete. */
  incompleteReason: string;
  /**
   * PARTS OF THIS SET BORROWED FROM ANOTHER SCHEDULE, pending their own pages.
   *
   * A schedule can be usable without being finished. UGVCL-2026's Schedule-A is
   * transcribed; its Schedule-B has not been supplied, so it uses 2020's rather than
   * blocking every Amorphous job under the new tender. That is a deliberate, temporary
   * mixture and it is DECLARED rather than left to be inferred from equal-looking arrays -
   * an estimate carrying 2026 itemised rows beside 2020 fixed rates, with nothing saying
   * so, is the failure that would never be reported.
   *
   * Rendered wherever rates are shown. Deliberately NOT on the printed sheet: the tender
   * governs what is charged, and a note about this app's transcription state is not part
   * of a document sent to a DISCOM.
   */
  borrowedFrom: Partial<Record<'scheduleB' | 'circleLimits', ScheduleId>>;
  scheduleA: ScheduleAItem[];
  scheduleB: ScheduleBItem[];
  /** Radiator replacement above 100 KVA, priced per capacity rather than by band. */
  radiatorAbove100: Record<number, number>;
  extras: typeof SCHEDULE_B_EXTRAS;
  notes: typeof SCHEDULE_NOTES;
  amorphousText: typeof AMORPHOUS_ESTIMATE_TEXT;
}

export const SCHEDULES: Record<ScheduleId, ScheduleSet> = {
  'UGVCL-2020': {
    id: 'UGVCL-2020',
    label: 'UGVCL 2020 (Schedule-A & B)',
    complete: true,
    incompleteReason: '',
    borrowedFrom: {},
    scheduleA: SCHEDULE_A,
    scheduleB: SCHEDULE_B,
    radiatorAbove100: RADIATOR_ABOVE_100,
    extras: SCHEDULE_B_EXTRAS,
    notes: SCHEDULE_NOTES,
    amorphousText: AMORPHOUS_ESTIMATE_TEXT,
  },

  /**
   * UGVCL-2026 — A/T UGVCL/EE-T-1/TRANS-REP/2026-28/01/AT/1819 dated 07.09.2026,
   * accepted at 7.00% above the estimated rate.
   *
   * Schedule-A is transcribed and diffed: 255 of 306 cells moved, five rows unchanged.
   *
   * ⚠ SCHEDULE-B AND THE CIRCLE LIMITS ARE 2020'S, PENDING THEIR OWN PAGES - see
   * `borrowedFrom`. The alternative was leaving the whole schedule unselectable, which
   * blocks the tender the agency is actually working under. The mixture is temporary,
   * declared, and shown on screen wherever rates are displayed.
   *
   * ⚠ AND IT MAY BE THE WRONG MIXTURE. The 2026 heading widened from "CRGO
   * (STACK/DRY/PAT/SDT)" to "CRGO (STACK/Wound/DRY/PAT/SDT) / Amorphous Core". If that
   * means Amorphous and Wound Core are ITEMISED under Schedule-A in this tender rather
   * than carrying a separate fixed rate, then borrowing 2020's Schedule-B is not a
   * placeholder for the right answer - it is the wrong model, and the fixed-rate branch in
   * buildSingleJobEstimateData should not run for 1819 jobs at all. Which branch prices a
   * core type is currently decided by `coreClass` alone; it would have to become
   * schedule-dependent. AUDIT records this as the open question the Schedule-B pages must
   * settle first. DO NOT let the fallback quietly become the answer because it works.
   */
  'UGVCL-2026': {
    id: 'UGVCL-2026',
    label: 'UGVCL 2026-28 (AT/1819)',
    complete: true,
    incompleteReason: '',
    borrowedFrom: { scheduleB: 'UGVCL-2020', circleLimits: 'UGVCL-2020' },
    scheduleA: SCHEDULE_A_2026,
    scheduleB: SCHEDULE_B,
    radiatorAbove100: RADIATOR_ABOVE_100_2026,
    extras: SCHEDULE_B_EXTRAS,
    notes: SCHEDULE_NOTES,
    amorphousText: AMORPHOUS_ESTIMATE_TEXT,
  },
};

/**
 * THE SCHEDULE AN AT WITH NO `scheduleId` USES.
 *
 * ⚠ 2020 IS THE RIGHT ANSWER FOR EXISTING RECORDS AND THE WRONG ONE FOR NEW.
 *
 * Every AT created before this field existed prices from the 2020 schedule today, because
 * it was the only one - so resolving absent to 2020 preserves what those tenders are
 * already charging, which is the whole requirement. It is verifiable rather than inferred:
 * they all predate the 2026 tender.
 *
 * But a NEW AT falling through to this default would silently price a 2026 tender at 2020
 * rates - the defect this registry exists to prevent - so the AT form requires an explicit
 * choice and the pre-existing ATs are stamped by `scripts/admin/backfill-schedule-id.js`.
 * After that backfill, an absent `scheduleId` means "nobody chose", not "created early".
 *
 * ⚠ THE BACKFILL HOLDS ONE AT BACK, and the reason generalises. Nine ATs exist and eight are
 * pre-2026 tenders that genuinely price from 2020. The ninth is ZENITH's
 * `UGVCL/EE-T-1/TRANS-REP/2026-28/01/AT/1819` - A/T 1819 itself, the tender this whole
 * change is for. Stamping it 2020 along with the rest would have priced the new tender at
 * the old schedule, introduced by the very migration meant to prevent that. A blanket
 * backfill is only safe where the value is the same for every row, and here it was not.
 */
export const DEFAULT_SCHEDULE_ID: ScheduleId = 'UGVCL-2020';

export function isScheduleId(v: unknown): v is ScheduleId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SCHEDULES, v);
}

/** The schedule id an AT names, or the dated default. Never throws. */
export function scheduleIdForAt(at: any): ScheduleId {
  const raw = String(at?.scheduleId ?? '').trim();
  return isScheduleId(raw) ? raw : DEFAULT_SCHEDULE_ID;
}

/** The whole schedule set an AT prices from. */
export function scheduleSetForAt(at: any): ScheduleSet {
  return SCHEDULES[scheduleIdForAt(at)];
}

/**
 * Is this AT's schedule usable, and if not, why?
 *
 * Returns null when fine. Mirrors `atRatesReadiness`'s shape deliberately: both answer
 * "can this tender price work", and a second differently-shaped answer to that question is
 * how the two would drift.
 */
export function scheduleReadiness(at: any): string | null {
  const raw = String(at?.scheduleId ?? '').trim();
  if (raw && !isScheduleId(raw)) {
    return `This tender names rate schedule "${raw}", which this version of the app does not have. `
      + `Estimates and bills against it are blocked - the alternative is pricing from a different schedule than the one named.`;
  }
  const set = scheduleSetForAt(at);
  return set.complete ? null : set.incompleteReason;
}

/** Schedules an AT may be created against - the incomplete ones are not offered. */
export function selectableSchedules(): ScheduleSet[] {
  return Object.values(SCHEDULES).filter(s => s.complete);
}

/**
 * DOES THIS TENDER'S SCHEDULE STILL NEED CONFIRMING?
 *
 * True when the schedule was inherited from the previous tender or defaulted, and nobody
 * has since said it is right. False for a schedule that arrived with a rate template - the
 * administrator chose that one when publishing and the agency saw it before adopting - and
 * false once someone has confirmed.
 *
 * ⚠ THE GATE THIS FEEDS SITS BEFORE THE FIRST ISSUED ESTIMATE, not before the AT is created
 * and not before jobs are booked. An inherited schedule is usually right, so blocking
 * creation would stop a yard over a question that is nearly always answered "yes"; but the
 * schedule appears on no printed document, so an estimate priced from the wrong one is
 * complete, plausible and unreported. The issue point is where those two facts meet.
 */
export function scheduleNeedsConfirmation(at: any): boolean {
  if (!at) return false;
  const source = String(at.scheduleSource ?? '').trim();
  if (source === 'template') return false;
  if (Number(at.scheduleConfirmedAt) > 0) return false;
  // A record predating these fields has no source. It carries a scheduleId from the
  // backfill, which was verified against what the tender was already charging, so it is
  // treated as needing confirmation only if it never got one - the same question, asked of
  // an AT whose answer was established by script rather than by a person.
  return true;
}

/** One sentence naming where an AT's schedule came from. Never blank - see AUDIT F50. */
export function scheduleProvenance(at: any, atMasters: any[]): string {
  const set = scheduleSetForAt(at);
  const source = String(at?.scheduleSource ?? '').trim();
  if (source === 'template') return `${set.label}, which came with the rate template this tender adopted.`;
  if (source === 'inherited') {
    const from = atMasters.find(a => a.id === at?.scheduleInheritedFromAtId);
    return `${set.label}, carried over from ${from?.atNumber || 'the previous tender'} when this tender was created.`;
  }
  if (source === 'default') return `${set.label}, applied because this was the agency's first tender and there was none to carry over from.`;
  return `${set.label}, recorded before this app tracked where a schedule came from.`;
}
