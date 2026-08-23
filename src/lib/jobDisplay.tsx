import { getAgencyStateCode } from './utils';

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

// ---------------------------------------------------------------------------
// DISCOM identity gates - per document, on the fields that document prints
// ---------------------------------------------------------------------------
// Deliberately NOT one agency-wide "is the DISCOM configured" check. Each document
// carries different fields, so each is gated on its own, and the dialog names the
// specific field that is missing rather than "DISCOM not configured".
//
// The delivery challan, oil statement and forwarding letter are NOT gated: they carry no
// tax registration, and blocking a dispatch over a missing GSTIN would stop physical
// work for a gap that does not affect the document being produced.

const LABELS: Record<string, string> = {
  discomName: 'DISCOM name',
  discomGstin: "DISCOM GSTIN",
  discomAddress: 'DISCOM address',
  circleOfficeName: 'Circle office name',
  gstin: "Agency GSTIN (your own, printed as Supplier GSTIN)",
  pan: 'Agency PAN (your own, printed as Supplier PAN)',
};

function missingFields(agency: any, required: string[]): string[] {
  return required.filter(f => !String(agency?.[f] ?? '').trim()).map(f => LABELS[f] || f);
}

/**
 * The tax invoice prints BOTH parties' tax registrations - the DISCOM's as buyer and the
 * agency's own as supplier.
 *
 * It used to gate on the buyer's three fields only. That is one side of a two-sided fact,
 * and the omission was not theoretical: an invoice went out with "Supplier GSTIN: -" and
 * "Supplier PAN: -" printed on it. An invoice carrying no seller registration is not a
 * valid tax invoice and can be rejected on that basis alone, so it blocks exactly as the
 * missing buyer GSTIN does.
 */
export function missingForTaxInvoice(agency: any): string[] {
  const missing = missingFields(agency, [
    'discomName', 'discomGstin', 'discomAddress',   // buyer
    'gstin', 'pan',                                  // seller - this is what was missing
  ]);

  // The supplier State Code is DERIVED from the agency's own GSTIN (its first two digits
  // ARE the state code - AUDIT O8), so it is normally implied by the GSTIN check above and
  // reporting it too would just restate one fault as two.
  //
  // It earns its own line in exactly one case: a GSTIN is present but does not begin with
  // two digits, so nothing can be derived from it and `agencyStateCode` is empty as well.
  // That is a malformed GSTIN, which the field-presence check cannot see.
  const hasGstin = Boolean(String(agency?.gstin ?? '').trim());
  if (hasGstin && !getAgencyStateCode(agency)) {
    missing.push('Agency State Code (cannot be derived - the GSTIN does not start with a two-digit state code)');
  }

  return missing;
}

/** The estimate prints the DISCOM's name and the circle office it is addressed to. */
export function missingForEstimate(agency: any): string[] {
  return missingFields(agency, ['discomName', 'circleOfficeName']);
}

// ---------------------------------------------------------------------------
// MR stage progress - one renderer, both screens
// ---------------------------------------------------------------------------
// Defined here rather than in either screen so the Estimate Generator and Billing cannot
// present the same stage differently. The completeness rules themselves live in
// lib/inspectionStage.ts; this only renders what that file decides.

import type { StageState } from './inspectionStage';
import { formatDDMMYYYY } from './utils';

/**
 * One stage cell: the completion DATE when every applicable job is done, otherwise the
 * count still outstanding.
 *
 * Showing the outstanding count rather than a bare "Pending" is the point - partial
 * progress must not read as "not started". `notDoneLabel` exists because dispatch is
 * thought about as a yes/no event ("not dispatched") while inspections are thought about
 * as a queue ("3 of 5 pending").
 */
export function StageCell({ label, state, notDoneLabel }: {
  label: string;
  state: StageState;
  notDoneLabel?: string;
}) {
  const outstanding = Math.max(0, state.total - state.doneCount);
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[10px] uppercase tracking-wide text-slate-400 w-14 shrink-0">{label}</span>
      {state.total === 0 ? (
        <span className="text-[11px] text-slate-400">none applicable</span>
      ) : state.complete ? (
        <span className="text-[11px] font-mono font-semibold text-emerald-700">
          {state.date ? formatDDMMYYYY(state.date) : 'done'}
        </span>
      ) : (
        <span className="text-[11px] font-semibold text-amber-700">
          {notDoneLabel || `${outstanding} of ${state.total} pending`}
        </span>
      )}
    </div>
  );
}
