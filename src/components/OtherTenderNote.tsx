import { AlertTriangle } from 'lucide-react';

/**
 * WORK THAT EXISTS BUT IS NOT ON THIS SCREEN, BECAUSE IT BELONGS TO ANOTHER TENDER
 * (AUDIT F99).
 *
 * ⚠ A CORRECT FILTER THAT MAKES WORK VANISH WITH NOTHING EXPLAINING WHERE IT WENT READS AS
 * DATA LOSS. An operator on AT 27-28 whose 26-27 inspections have disappeared has no way to
 * tell "filtered" from "gone" - and the second reading is the one that prompts a support call
 * or, worse, re-entering the job. This is the same reasoning as the MR Ledger's unassigned
 * backlog banner (F82, F87): the filter is right, and the disappearance still has to be
 * accounted for.
 *
 * ⚠ IT SAYS WHERE TO GO, NOT MERELY THAT THEY EXIST. "3 pending inspections belong to other
 * tenders" states a fact and leaves the operator stuck; naming the control that reaches them
 * turns it into an instruction. A notice that reports a problem without its remedy is the
 * shape this audit has recorded repeatedly in checks.
 *
 * Shown ONLY when the count is non-zero, so a clean agency never sees it, and never in
 * "all tenders" mode - there is no elsewhere when the scope is everywhere.
 */
export function OtherTenderNote({ count, noun }: { count: number; noun: string }) {
  if (count <= 0) return null;
  return (
    <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
      <p className="text-xs text-amber-900">
        <strong>
          {count} pending {noun}
          {count === 1 ? '' : 's'} belong{count === 1 ? 's' : ''} to other tenders
        </strong>{' '}
        &mdash; switch tender in the sidebar to work on them. Work stays with the tender it was
        booked into.
      </p>
    </div>
  );
}

export default OtherTenderNote;
