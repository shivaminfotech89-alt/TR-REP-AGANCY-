/**
 * AN AGENCY'S MARK — a two-letter monogram on a coloured tile, so an owner with sixteen
 * agencies can tell them apart at a glance.
 *
 * ⚠ THIS WAS AN ICON SET AND THE ICONS DID NOT WORK. Eight electrical glyphs - transformer,
 * coil, bushing, radiator, pylon, meter, bolt, oil drop - were drawn and discarded. Two
 * problems, and only the second is fatal:
 *
 *   THE SIZE CAPS THE INFORMATION. The tile renders at 28px. A 1.8px stroke on a 24-unit box
 *   loses everything below about 2 units, so six of the eight reduced to "some straight lines
 *   in a rounded square". Only the three with a distinctive filled outline - bolt, drop,
 *   circle - survived at all.
 *
 *   AND THE SUBJECT MATTER IS HOMOGENEOUS. A transformer, a radiator, a bushing and a pylon
 *   are all "rectilinear industrial object made of straight lines" - near-neighbours in shape
 *   space BY NATURE. Eight animals would separate perfectly at 28px; eight pieces of
 *   switchgear cannot, however well drawn. Redrawing them better would have produced the same
 *   three silhouette families.
 *
 * ⚠ AND AN ICON IS THE WRONG KIND OF ANSWER. An owner scanning sixteen rows is looking for a
 * NAME. A monogram is the shortest form of the name; an icon is a symbol standing in for it,
 * which has to be learned first. "Amber coil = MEGHA" is a fact to memorise; "ME" is not.
 *
 * ⚠ TWO LETTERS, NOT ONE, AND THE PAIR IS WHY IT WORKS. Across the twelve live agencies a
 * single initial collides three times (A, D and M each twice - half the agencies). Two letters
 * collide zero times. Neither letter separates alone: the second concentrates badly (four
 * agencies end in T, four in E, because so many are called "... TRANSFORMER"), and the first
 * collides three times. Together they are 12 of 12 distinct.
 *
 * ⚠ NEVER ON A PRINTED DOCUMENT. THIS IS A RULE, NOT A PREFERENCE, AND IT IS STATED HERE
 * BECAUSE HERE IS WHERE SOMEONE WOULD LOOK BEFORE "IMPROVING" THE CHALLAN OR THE ESTIMATE.
 *
 *     The printed documents carry the AGENCY'S OWN LETTERHEAD - a real business identity, on
 *     paper going to a UGVCL division office. A monogram this app derived, sitting beside that
 *     letterhead, asserts something about the sender that is not true. It is not the agency's
 *     logo; it is two letters and a colour for finding a row in a menu.
 *
 * `scripts/admin/print-subtree-hashes.js` proves the separation by hashing every printed
 * subtree rather than by anyone remembering this paragraph.
 */

export type AgencyMarkColour =
  | 'blue' | 'emerald' | 'amber' | 'rose'
  | 'violet' | 'cyan' | 'orange' | 'slate';

export interface AgencyMark {
  /** Two characters, uppercase. Derived from the name unless the operator typed otherwise. */
  monogram: string;
  colour: AgencyMarkColour;
}

export const MARK_COLOURS: AgencyMarkColour[] =
  ['blue', 'emerald', 'amber', 'rose', 'violet', 'cyan', 'orange', 'slate'];

export const COLOUR_LABEL: Record<AgencyMarkColour, string> = {
  blue: 'Blue', emerald: 'Green', amber: 'Amber', rose: 'Rose',
  violet: 'Violet', cyan: 'Cyan', orange: 'Orange', slate: 'Slate',
};

/**
 * Tile background per colour. Solid 600-weight: dark enough for white letters on a light
 * theme, saturated enough not to disappear on a dark one. The switcher sits on nine sidebar
 * themes and the letters are always white, which is what makes one definition serve all nine.
 */
export const MARK_TILE: Record<AgencyMarkColour, string> = {
  blue: 'bg-blue-600', emerald: 'bg-emerald-600', amber: 'bg-amber-500', rose: 'bg-rose-600',
  violet: 'bg-violet-600', cyan: 'bg-cyan-600', orange: 'bg-orange-600', slate: 'bg-slate-600',
};

/** THE MONOGRAM IS TWO CHARACTERS AND MUST STAY TWO. See `deriveMonogram`. */
export const MONOGRAM_LENGTH = 2;

/**
 * THE DERIVED MONOGRAM: the first letter of each of the first two words.
 *
 *   ZENITH TRANSFORMERS  -> ZT      GUJARAT ENERGY TRANSMISSION -> GE
 *   megha transformer    -> MT      IDEAL ENGINEERING COMPANY   -> IE
 *
 * A SINGLE-WORD NAME takes its first two letters - ADMIN -> AD, suchit -> SU. Five of the
 * twelve live agencies are single-word, so this is the common path, not the edge case. A
 * one-character name repeats that character.
 *
 * "M/S." and a leading "THE" are dropped: they are how a business is addressed, not what it
 * is called, and every agency using them would otherwise monogram to MS or TH.
 */
export function deriveMonogram(name: string): string {
  const cleaned = String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/^(M\/?S\.?|THE)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter(Boolean);
  if (!words.length) return '??';
  const raw = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return normaliseMonogram(raw || words[0][0]);
}

/**
 * Two uppercase characters, always.
 *
 * ⚠ THREE WOULD NOT FIT. The tile is 28px at its smallest; with rounded corners and optical
 * padding the usable inner width is about 20-22px. Two characters at 12px bold measure
 * roughly 15-16px and sit comfortably; three measure 23-24px and overflow, and shrinking them
 * to fit puts the type near 8px - below the 9.5px legibility floor this app already holds
 * itself to on paper, at the one size the whole feature exists for.
 */
export function normaliseMonogram(v: string): string {
  const s = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MONOGRAM_LENGTH);
  if (!s) return '??';
  return s.length === 1 ? s + s : s;
}

/**
 * THE DERIVED COLOUR, for an agency that has not chosen one.
 *
 * ⚠ KEYED ON THE AGENCY ID, NEVER THE NAME. A rename must not change a colour an owner has
 * learned. (The MONOGRAM does follow the name, deliberately - it IS the name.)
 */
export function derivedColour(agencyId: string): AgencyMarkColour {
  const s = String(agencyId ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return MARK_COLOURS[(h >>> 0) % MARK_COLOURS.length];
}

/**
 * The mark in force: whatever was chosen, falling back per-field.
 *
 * ⚠ THE FIELD STAYS ABSENT UNTIL SOMEONE CHOOSES. The derived value is never written back, so
 * "nobody chose" and "chose the one that happens to match" remain different facts - the same
 * distinction as a blank AT percentage against a typed zero.
 */
export function markFor(
  agency: { id: string; name?: string; mark?: Partial<AgencyMark> | null } | null | undefined,
): AgencyMark {
  if (!agency) return { monogram: '??', colour: 'slate' };
  const m = agency.mark;
  const monogram = m?.monogram ? normaliseMonogram(m.monogram) : deriveMonogram(agency.name || '');
  const colour = m?.colour && MARK_COLOURS.includes(m.colour as AgencyMarkColour)
    ? (m.colour as AgencyMarkColour)
    : derivedColour(agency.id);
  return { monogram, colour };
}

export const sameMark = (a: AgencyMark, b: AgencyMark) =>
  a.monogram === b.monogram && a.colour === b.colour;

/**
 * OTHER AGENCIES ALREADY SHOWING THIS MARK.
 *
 * Counts derived marks too, not only chosen ones - an owner looking at two identical rows
 * does not care which of them picked it.
 *
 * ⚠ MUCH RARER NOW THAN WITH THE ICON SET. That was a birthday problem over 64 arbitrary
 * slots: sixteen agencies had an 87% chance of a clash, from hash coincidence. A monogram
 * clash means two agencies genuinely share their first two initials, which across the twelve
 * live agencies happens zero times. The warning stays because it now fires on a real fact,
 * and because typing over the derived value is how two that do collide separate.
 */
export function agenciesUsingMark(
  mark: AgencyMark,
  agencies: Array<{ id: string; name?: string; mark?: Partial<AgencyMark> | null }>,
  exceptId?: string,
): string[] {
  return agencies
    .filter(a => a.id !== exceptId && sameMark(markFor(a), mark))
    .map(a => a.name || '(unnamed)');
}
