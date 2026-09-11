// WHAT AN EMPTY ESTIMATE MASTER CELL SHOWS - ASKED OF THE SECTION IT IS IN (AUDIT G68).
//
// An empty cell is not a gap: pricing falls through to the job's own tender, and the grid shows that figure so an
// agency sees what it will be charged. The figure has to be the one PRICING uses - so this answers only where it knows
// how pricing resolves, and refuses everywhere else.
//
// ⚠ THE SECTION IS PART OF THE QUESTION. This lookup used to take an item code alone, and every section's grid called
// it. Item codes belong to their section: '5' is the oil gauge glass in CRGO and complete radiator replacement in
// Overhauling, so the Overhauling radiator row showed 46.00 - a wrong figure, shown exactly as confidently as a right
// one, in the grid someone reads to check a rate. The same shape as the scrap charge sitting under '0' in one section
// and '22' in another.
//
//   CRGO                                   SCHEDULE_ITEM_MAP - the CRGO master's codes - against the AT's own schedule
//   OVERHAULING                            the overhaul row only: Schedule-A Sr 21, as the estimate prices it. Rows 3-6
//                                          have no tender row to inherit from; their rates are the master's or none.
//   AMORPHOUS, WOUND_CORE, CIRCLE_LIMITS   nothing - a CRGO figure is never theirs

import { bandForKva, OH_USES_SCHEDULE_A_ITEM, type ScheduleSet } from './ugvclSchedules';
import { scheduleSrForMasterCode, variantAxisForMasterCode } from './scheduleItemMap';
import { overhaulingRowKind } from './overhaulingRows';

export type GridSection = 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS';

export type Inherited =
  | { kind: 'none' }
  | { kind: 'rate'; value: number }
  | { kind: 'pair'; al: number; cu: number }
  | { kind: 'kv'; value: number; kv: string }
  | { kind: 'radiator'; value: number }
  | { kind: 'marker'; text: string };

export const INHERITS_NOTHING: Inherited = { kind: 'none' };

const positive = (v: unknown): number | null => (typeof v === 'number' && v > 0 ? v : null);

/** A band's rate for one tender row, or null. `> 0` is the estimate's own test: a 0 is "not priced", never "free". */
function bandRate(set: ScheduleSet, sr: string | null | undefined, kva: string): number | null {
  if (!sr) return null;
  const entry = set.scheduleA.find(i => i.sr === sr);
  return entry ? positive(entry.rates[bandForKva(Number(kva) || 0)]) : null;
}

const rateOrNone = (v: number | null): Inherited => (v === null ? INHERITS_NOTHING : { kind: 'rate', value: v });

/** What an EMPTY cell in `section` shows. Callers ask only for cells with nothing stored. */
export function inheritedForCell(section: GridSection, set: ScheduleSet, itemCode: string, itemName: string, kva: string): Inherited {
  if (section === 'CRGO') return inheritedInCrgo(set, itemCode, kva);
  if (section === 'OVERHAULING') {
    // The estimate prices the overhaul row as Schedule-A Sr 21 of the job's own tender (OH_USES_SCHEDULE_A_ITEM).
    return overhaulingRowKind(itemCode, itemName) === 'overhaul' ? rateOrNone(bandRate(set, OH_USES_SCHEDULE_A_ITEM, kva)) : INHERITS_NOTHING;
  }
  return INHERITS_NOTHING;
}

/**
 * CRGO, UNCHANGED FROM THE FUNCTIONS THIS REPLACES in EstimateMaster.tsx - moved, not rewritten:
 *   - an item with one tender row shows that row's band rate;
 *   - WINDING MATERIAL (12C, 13C): both rates, stacked - each is a rate the estimate charges, chosen by a field the
 *     operator fills in; both or neither, so one half is never read as the other being absent from the tender (F52);
 *   - KV CLASS (8): the 11 kV rate, labelled - every transformer these agencies repair is 11 kV (G5);
 *   - CAPACITY (21, radiator): up to 100 kVA the Sr 20 band; above, the exact capacity - 200 and 500 differ, and 315
 *     is not priced, so it keeps its marker, the one cell where the tender genuinely has no answer (G6);
 *   - otherwise a variant row says what it varies by. Never blank - see AUDIT F50.
 */
function inheritedInCrgo(set: ScheduleSet, itemCode: string, kva: string): Inherited {
  const v = variantAxisForMasterCode(itemCode);
  if (!v) return rateOrNone(bandRate(set, scheduleSrForMasterCode(itemCode), kva));
  const options = v.options as Record<string, string>;
  if (v.axis === 'winding-material') {
    const al = bandRate(set, options.Aluminium, kva);
    const cu = bandRate(set, options.Copper, kva);
    if (al !== null && cu !== null) return { kind: 'pair', al, cu };
  } else if (v.axis === 'kv-class') {
    // The 11 kV option, by name - not options[0], so an ordering change in the map cannot relabel the figure.
    const r = bandRate(set, options['11'], kva);
    if (r !== null) return { kind: 'kv', value: r, kv: '11' };
  } else if (v.axis === 'capacity') {
    const n = Number(kva) || 0;
    const r = n > 100 ? positive(set.radiatorAbove100[n]) : bandRate(set, options['upto-100'], kva);
    if (r !== null) return { kind: 'radiator', value: r };
  }
  return {
    kind: 'marker',
    text: v.axis === 'kv-class' ? 'Varies by KV rating' : v.axis === 'winding-material' ? 'Varies by winding material' : 'Varies by capacity',
  };
}
