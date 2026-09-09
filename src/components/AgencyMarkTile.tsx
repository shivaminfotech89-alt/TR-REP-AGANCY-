import React from 'react';
import { AgencyMark, MARK_TILE, MARK_PATH, markFor, SHAPE_LABEL, COLOUR_LABEL } from '../lib/agencyMark';

/**
 * ONE AGENCY'S MARK, rendered as a filled tile with a white glyph.
 *
 * ⚠ THE ONLY PLACE A MARK IS DRAWN. Four screens show one; each renders this rather than
 * building its own tile, so the switcher button and the row beneath it cannot disagree
 * about an agency's colour - which is exactly what happened before, when the dropdown rows
 * coloured themselves from active state while the button used the app logo.
 *
 * ⚠ NOT FOR PRINTED DOCUMENTS. See the rule at the top of lib/agencyMark.ts: printed sheets
 * carry the agency's real letterhead, and a mark this app invented has no business beside it.
 */
export function AgencyMarkTile({
  agency,
  mark,
  size = 'md',
  className = '',
}: {
  /** The agency to draw for. Its chosen mark, or the one derived from its id. */
  agency?: { id: string; name?: string; mark?: AgencyMark | null } | null;
  /** An explicit mark, for the picker's grid where there is no agency yet. */
  mark?: AgencyMark;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const m = mark ?? markFor(agency as any);
  const box = size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-10 h-10' : 'w-7 h-7 sm:w-9 sm:h-9';
  const glyph = size === 'lg' ? 'w-6 h-6' : 'w-4 h-4 sm:w-5 sm:h-5';
  return (
    <span
      className={`${box} ${MARK_TILE[m.colour]} rounded-lg grid place-items-center shrink-0 text-white ${className}`}
      title={agency?.name ? `${agency.name} — ${COLOUR_LABEL[m.colour]} ${SHAPE_LABEL[m.shape].toLowerCase()}` : `${COLOUR_LABEL[m.colour]} ${SHAPE_LABEL[m.shape].toLowerCase()}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
           strokeLinecap="round" strokeLinejoin="round" className={glyph} aria-hidden="true">
        <path d={MARK_PATH[m.shape]} />
      </svg>
    </span>
  );
}
