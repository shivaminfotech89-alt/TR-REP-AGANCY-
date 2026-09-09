import React from 'react';
import { AgencyMark, MARK_TILE, markFor, COLOUR_LABEL } from '../lib/agencyMark';

/**
 * ONE AGENCY'S MARK — two white letters on a filled tile.
 *
 * ⚠ THE ONLY PLACE A MARK IS DRAWN. Three screens show one; each renders this rather than
 * building its own tile, so the switcher button and the row beneath it cannot disagree about
 * an agency's colour - which is what happened before, when the dropdown rows coloured
 * themselves from active state.
 *
 * ⚠ THE LETTERS ARE ALWAYS WHITE and the tile always carries the colour. That is the
 * nine-theme constraint: the switcher sits on nine sidebar themes, light and dark, and white
 * on a saturated fill is the one treatment that reads on all of them.
 *
 * ⚠ NOT FOR PRINTED DOCUMENTS. See the rule at the top of lib/agencyMark.ts.
 */
export function AgencyMarkTile({
  agency,
  mark,
  size = 'md',
  className = '',
}: {
  agency?: { id: string; name?: string; mark?: Partial<AgencyMark> | null } | null;
  /** An explicit mark, for the picker's preview where the choice is not saved yet. */
  mark?: AgencyMark;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const m = mark ?? markFor(agency as any);
  const box = size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-10 h-10' : 'w-7 h-7 sm:w-9 sm:h-9';
  // Two characters at these sizes measure well inside the tile; see MONOGRAM_LENGTH for why
  // a third would not. `tracking-tight` buys back a pixel on wide pairs like "MW".
  const type = size === 'sm' ? 'text-[11px]' : size === 'lg' ? 'text-base' : 'text-[11px] sm:text-sm';
  return (
    <span
      className={`${box} ${MARK_TILE[m.colour]} rounded-lg grid place-items-center shrink-0 text-white ${className}`}
      title={agency?.name ? `${agency.name} — ${m.monogram}, ${COLOUR_LABEL[m.colour].toLowerCase()}` : `${m.monogram}, ${COLOUR_LABEL[m.colour].toLowerCase()}`}
    >
      <span className={`${type} font-black tracking-tight leading-none select-none`}>
        {m.monogram}
      </span>
    </span>
  );
}
