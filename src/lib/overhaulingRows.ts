// WHICH OVERHAULING ROW IS WHICH - ONE ANSWER, FOR THE ESTIMATE AND FOR THE GRID (AUDIT O67, G68).
//
// The estimate decides what each overhauling master row is charged on; the Estimate Master grid decides what an empty
// cell in that row shows. If the two decided separately they could disagree about which row is the overhaul - so both
// ask here.
//
// Rows are identified by the overhauling master's own codes, which every stored section holds. Names are only a
// fallback for a renumbered section, and they match the master's full descriptions: a row that merely MENTIONS
// overhauling or a tank is not taken for one (O67's first version charged "Some other overhauling extra" as an
// overhaul).
//
// ⚠ THESE CODES MEAN NOTHING OUTSIDE THE OVERHAULING SECTION. '5' is complete radiator replacement here and the oil
// gauge glass in CRGO; '3' is tank replacement here and inside painting there.

export type OverhaulingRowKind = 'overhaul' | 'radiator' | 'conservator' | 'tank' | 'sealing' | 'other';

export function overhaulingRowKind(itemCode: unknown, itemName: unknown): OverhaulingRowKind {
  const code = String(itemCode ?? '').trim();
  const name = String(itemName ?? '').toLowerCase();
  return code === '7' ? 'overhaul' : code === '5' ? 'radiator' : code === '4' ? 'conservator'
    : code === '3' ? 'tank' : code === '6' ? 'sealing'
    : name.includes('overhauling of complete transformer') ? 'overhaul'
    : name.includes('conservator tank replacement') ? 'conservator'
    : name.includes('radiator replacement') ? 'radiator'
    : name.includes('sealing of uneconomical') ? 'sealing'
    : name.includes('tank replacement') ? 'tank' : 'other';
}
