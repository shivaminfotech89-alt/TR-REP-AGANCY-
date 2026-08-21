// Shared presentation for GP (guarantee) jobs. Defined ONCE here and imported by every
// screen that lists jobs - NewJob, External/Internal Inspection, Testing Report,
// Dispatch Challan, Billing and Reports. Do not redefine the colour per file.

/**
 * Dark brown for GP job numbers. #5B3A1A.
 *
 * CONTRAST — measured against every row background a job number actually sits on
 * (WCAG 2.1 relative luminance; AA large/normal text needs 4.5:1, AAA needs 7:1):
 *
 *   white            #FFFFFF   10.2 : 1   AAA
 *   slate-50/100     #F8FAFC   ~9.9 : 1   AAA   (hover / header rows)
 *   amber-50 tint    #FFFBEB    9.8 : 1   AAA   (Dispatch scrap rows)
 *   blue-50          #EFF6FF    9.4 : 1   AAA   (Dispatch selected rows)
 *   rose-100         #FFE4E6    8.5 : 1   AAA   (Dispatch selected scrap rows)
 *
 * One value clears AAA in every context, so there is no second shade and no
 * per-screen override. If a GP job number is ever placed on a DARK surface (the
 * slate-900 header bars, for instance) this constant will fail badly - it is defined
 * for light row backgrounds only. Add a separate light-on-dark token at that point
 * rather than lightening this one, which would weaken it everywhere else.
 */
export const GP_TEXT_CLASS = 'text-[#5B3A1A]';

/**
 * The chip is the ACCESSIBLE signal; the colour only reinforces it.
 *
 * Colour alone must never be the sole indicator - it is invisible to a colour-blind
 * operator and to a photocopied printout, which is how these lists are often read on
 * the shop floor. So the chip is NEVER hidden responsively: no `hidden sm:inline`, no
 * truncation, `shrink-0` so a narrow column squeezes something else instead. If space
 * is short, drop other content before this.
 */
export function GpChip({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center shrink-0 px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wide bg-[#F3E7DA] text-[#5B3A1A] border border-[#C9A88A] ${className}`}
      title="GP - guarantee repair. Repaired free of cost under guarantee; excluded from estimates and bills."
    >
      GP
    </span>
  );
}

// ---------------------------------------------------------------------------
// GP / OGP filter - shared by every screen that lists jobs
// ---------------------------------------------------------------------------

export type GpFilter = 'All' | 'OGP' | 'GP';

export const GP_FILTER_OPTIONS: { value: GpFilter; label: string }[] = [
  { value: 'All', label: 'All Types' },
  { value: 'OGP', label: 'OGP only' },
  { value: 'GP', label: 'GP only' },
];

/**
 * Applies the GP/OGP filter. Keyed on the same `repairType`/`isGp` test the money-path
 * exclusions use (isGpJob in estimateCalc) - deliberately not on `gpSource`, which
 * exists only on jobs saved since it was added.
 */
export function matchesGpFilter(job: any, filter: GpFilter): boolean {
  if (filter === 'All') return true;
  const isGp = job?.repairType === 'GP' || job?.isGp === true;
  return filter === 'GP' ? isGp : !isGp;
}
