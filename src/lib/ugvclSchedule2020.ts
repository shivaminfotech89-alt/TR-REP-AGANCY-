// src/lib/ugvclSchedule2020.ts
//
// UGVCL-2020 Schedule-A (CRGO item-wise) and Schedule-B (Amorphous / CRGO
// Wound Core fixed rate), transcribed from the tender document.
//
// Rates are exclusive of GST. The AT's above/below percentage is applied on
// top, as entered by the user in AT details.
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
  /** Make-specific variant. */
  makeNote?: string;
}

export const SCHEDULE_B: ScheduleBItem[] = [
  // 1 - Aluminium winding
  { sr: '1a',   kva: 10,  winding: 'Aluminium', basis: 'transformer', weightNote: 'Total Al. coil weight 21 to 33 Kg', fixedRate: 4927 },
  { sr: '1b',   kva: 16,  winding: 'Aluminium', basis: 'transformer', weightNote: 'Total Al. coil weight 27 to 39 Kg', fixedRate: 5202 },
  { sr: '1c',   kva: 25,  winding: 'Aluminium', basis: 'transformer', weightNote: 'Total Al. coil weight 26 to 45 Kg', fixedRate: 8395 },
  { sr: '1d-1', kva: 63,  winding: 'Aluminium', basis: 'transformer', weightNote: 'Total Al. coil weight 50 to 67 Kg', fixedRate: 13746 },
  { sr: '1d-2', kva: 63,  winding: 'Aluminium', basis: 'transformer', weightNote: 'Total Al. coil weight 90.21 Kg', fixedRate: 16746, makeNote: 'ADB/1804, Vijay Make' },
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
