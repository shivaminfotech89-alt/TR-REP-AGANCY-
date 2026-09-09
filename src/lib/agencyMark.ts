/**
 * AN AGENCY'S MARK — a shape and a colour, so an owner with sixteen agencies can tell them
 * apart at a glance.
 *
 * Every agency showed the same app logo, which means the picture carried no information at
 * exactly the point it was supposed to: a switcher listing sixteen identical rows.
 *
 * ⚠ SHIPPED, NOT UPLOADED. Uploads would need storage, sizing and trust in a file that can
 * be anything, and none of that helps at 28px beside eight other 28px things. A fixed set
 * is pickable, predictable and cannot arrive broken.
 *
 * ⚠ MARKS x COLOURS, NOT SIXTEEN DRAWINGS. At 28px a transformer and a substation are the
 * same grey blob. Shape carries five or six reliable distinctions at that size; colour
 * carries ten or twelve. Eight of each gives 64 combinations that separate on the axis the
 * eye actually uses first.
 *
 * ⚠ THE TILE CARRIES THE COLOUR AND THE GLYPH IS ALWAYS WHITE, and that is the nine-theme
 * constraint rather than a style choice. The switcher sits on nine sidebar themes, some
 * light and some dark. A multi-colour glyph would read on some and vanish on others; a white
 * glyph on a filled tile reads on all of them. It also means ONE definition per shape - eight
 * - rather than one per shape-and-colour, which would be sixty-four.
 *
 * ⚠⚠ NEVER ON A PRINTED DOCUMENT. THIS IS A RULE, NOT A PREFERENCE, AND IT IS STATED HERE
 * BECAUSE HERE IS WHERE SOMEONE WOULD LOOK BEFORE "IMPROVING" THE CHALLAN OR THE ESTIMATE.
 *
 *     The printed documents carry the AGENCY'S OWN LETTERHEAD - a real business identity, on
 *     paper going to a UGVCL division office. A decorative mark this app invented, sitting
 *     beside that letterhead, asserts something about the sender that is not true. It is not
 *     the agency's logo; it is a colour someone picked from a grid to find a row in a menu.
 *
 * No printed surface references this module, and none should. `DispatchChallan` imports the
 * APP mark, but that use is inside a `print:hidden` header and never reaches paper.
 */

export type AgencyMarkShape =
  | 'transformer' | 'coil' | 'bushing' | 'radiator'
  | 'bolt' | 'pylon' | 'gauge' | 'oil';

export type AgencyMarkColour =
  | 'blue' | 'emerald' | 'amber' | 'rose'
  | 'violet' | 'cyan' | 'orange' | 'slate';

export interface AgencyMark {
  shape: AgencyMarkShape;
  colour: AgencyMarkColour;
}

export const MARK_SHAPES: AgencyMarkShape[] =
  ['transformer', 'coil', 'bushing', 'radiator', 'bolt', 'pylon', 'gauge', 'oil'];

export const MARK_COLOURS: AgencyMarkColour[] =
  ['blue', 'emerald', 'amber', 'rose', 'violet', 'cyan', 'orange', 'slate'];

/** Human names, for the picker's tooltips and for the duplicate warning. */
export const SHAPE_LABEL: Record<AgencyMarkShape, string> = {
  transformer: 'Transformer', coil: 'Winding coil', bushing: 'Bushing', radiator: 'Radiator',
  bolt: 'Lightning', pylon: 'Pylon', gauge: 'Meter', oil: 'Oil drop',
};
export const COLOUR_LABEL: Record<AgencyMarkColour, string> = {
  blue: 'Blue', emerald: 'Green', amber: 'Amber', rose: 'Rose',
  violet: 'Violet', cyan: 'Cyan', orange: 'Orange', slate: 'Slate',
};

/**
 * Tile background per colour. Solid 600-weight: dark enough for a white glyph on a light
 * theme, saturated enough not to disappear on a dark one.
 */
export const MARK_TILE: Record<AgencyMarkColour, string> = {
  blue: 'bg-blue-600', emerald: 'bg-emerald-600', amber: 'bg-amber-500', rose: 'bg-rose-600',
  violet: 'bg-violet-600', cyan: 'bg-cyan-600', orange: 'bg-orange-600', slate: 'bg-slate-600',
};

/**
 * THE GLYPHS. `currentColor` throughout so the tile's text colour drives them - always
 * white in practice. Drawn on a 24x24 box, stroke-based so they hold at 28px.
 */
export const MARK_PATH: Record<AgencyMarkShape, string> = {
  // tank with two bushings and a fin
  transformer: 'M7 9h10v9H7z M9 9V6 M15 9V6 M5 12h2 M17 12h2 M5 15h2 M17 15h2',
  // a wound coil, three turns round a core
  coil: 'M12 4v16 M8 7c-2 0-2 3 0 3s2 3 0 3 M16 7c2 0 2 3 0 3s-2 3 0 3 M8 16c-2 0-2 2 0 2 M16 16c2 0 2 2 0 2',
  // insulator bushing, stacked sheds
  bushing: 'M12 3v18 M8 7h8 M7 11h10 M6 15h12 M9 19h6',
  // radiator fins
  radiator: 'M5 5v14 M9 5v14 M13 5v14 M17 5v14 M5 9h12 M5 15h12',
  // lightning
  bolt: 'M13 3L5 13h6l-2 8 8-10h-6z',
  // transmission pylon
  pylon: 'M12 3v18 M6 21l6-18 6 18 M8 10h8 M7 15h10',
  // dial gauge
  gauge: 'M12 20a8 8 0 1 1 0-16 8 8 0 0 1 0 16z M12 12l4-3',
  // oil drop
  oil: 'M12 3c4 6 6 8 6 11a6 6 0 0 1-12 0c0-3 2-5 6-11z',
};

/**
 * THE DERIVED MARK, FOR AN AGENCY THAT HAS NOT CHOSEN ONE.
 *
 * ⚠ KEYED ON THE AGENCY ID, NEVER THE NAME. A rename must not change the mark - an owner who
 * has learned "the amber coil is MEGHA" should not lose that by correcting a spelling.
 *
 * ⚠ AND IT IS NOT WRITTEN TO THE DOCUMENT. The field stays genuinely absent until someone
 * picks, so "nobody chose" and "chose the one that happens to match" remain different facts.
 * Same distinction as a blank AT percentage against a typed zero.
 *
 * ⚠ PURE HASH, WITH COLLISIONS ACCEPTED ON PURPOSE. Sixteen agencies into 64 combinations is
 * a birthday problem: only a 12.9% chance of no clash at all, and about 1.9 colliding pairs
 * expected. A CLASH IS THE NORMAL CASE. It was tempting to de-collide by walking to the next
 * free slot, and that was rejected: the result would depend on the SET of agencies, so
 * adding a seventeenth could silently reshuffle a mark the owner had already learned. A
 * stable mark that sometimes repeats beats a unique one that moves. The picker names the
 * clash instead - see `agenciesUsingMark`.
 */
export function derivedMark(agencyId: string): AgencyMark {
  const s = String(agencyId ?? '');
  let h = 2166136261;                       // FNV-1a, for a good spread over short ids
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h = h >>> 0;
  return {
    shape: MARK_SHAPES[h % MARK_SHAPES.length],
    colour: MARK_COLOURS[(h >>> 8) % MARK_COLOURS.length],
  };
}

/** The mark in force: the chosen one, or the derived one. Never null. */
export function markFor(agency: { id: string; mark?: AgencyMark | null } | null | undefined): AgencyMark {
  if (!agency) return { shape: 'transformer', colour: 'slate' };
  const m = agency.mark;
  if (m && MARK_SHAPES.includes(m.shape) && MARK_COLOURS.includes(m.colour)) return m;
  return derivedMark(agency.id);
}

/** Whether this agency has actually chosen, as opposed to showing its derived mark. */
export function hasChosenMark(agency: { mark?: AgencyMark | null } | null | undefined): boolean {
  const m = agency?.mark;
  return Boolean(m && MARK_SHAPES.includes(m.shape) && MARK_COLOURS.includes(m.colour));
}

export const sameMark = (a: AgencyMark, b: AgencyMark) => a.shape === b.shape && a.colour === b.colour;

/**
 * OTHER AGENCIES ALREADY SHOWING THIS MARK.
 *
 * Counts DERIVED marks too, not only chosen ones - an owner looking at two identical rows
 * does not care which of them picked it. This is what makes the 87% clash rate liveable:
 * the duplicate is named at the moment of choosing, where it can be resolved.
 */
export function agenciesUsingMark(
  mark: AgencyMark,
  agencies: Array<{ id: string; name: string; mark?: AgencyMark | null }>,
  exceptId?: string,
): string[] {
  return agencies
    .filter(a => a.id !== exceptId && sameMark(markFor(a), mark))
    .map(a => a.name);
}
