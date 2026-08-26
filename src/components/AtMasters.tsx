import { Link } from 'react-router-dom';
import { FileSignature, ArrowRight, Building2, LayoutGrid, Scale, Database, AlertTriangle } from 'lucide-react';
import { useAgency } from '../lib/AgencyContext';
import { AtSettings } from './AtSettings';

/**
 * TENDERS (ATs) AS A DESTINATION OF THEIR OWN.
 *
 * AtSettings existed with no route to it: it rendered inside the Agency Settings page,
 * below the agency form, reachable only by scrolling past the thing the operator had just
 * finished. Every link that claimed to go there - `/agency-settings?section=at` from the
 * setup gaps, from Estimate Master, from AtSettings itself - carried a query parameter
 * NOTHING READS. AgencySettings has no `useSearchParams`; the parameter looked specific and
 * did nothing (AUDIT F74).
 *
 * That mattered more once rates moved onto the AT (F73). The app's own ordering taught
 * rates-before-tenders: the only blocking gate is "no agency", the nav had no Tenders entry,
 * and Estimate Master sat in the working nav where a new agency would reach it first - and
 * meet a wall saying it could not save, because there was no tender to save to.
 *
 * The order the New Job gates already enforce is agency -> AT -> divisions -> allotment.
 * The nav now follows the same order instead of contradicting it, and this page is the
 * second step. Divisions and allotments are not separate screens: AtSettings nests them per
 * AT, which is correct - they are properties OF a tender and cannot exist without one.
 */
export default function AtMasters() {
  const { activeAgency, atMasters, activeAtMaster } = useAgency();

  const mine = activeAgency ? atMasters.filter(t => t.agencyId === activeAgency.id) : [];
  const hasAny = mine.length > 0;
  const activeHasRates = Boolean((activeAtMaster as any)?.ratesSource);

  return (
    <div className="w-full max-w-full space-y-4">
      <div className="bg-white p-5 sm:p-6 rounded-xl shadow-xs border border-slate-200">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl font-bold text-slate-900 flex items-center">
            <FileSignature className="w-6 h-6 mr-2.5 text-indigo-600" />
            Tenders (AT)
          </h1>
          {activeAgency && (
            <span className="px-2.5 py-0.5 text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 rounded-full">
              {activeAgency.name}
            </span>
          )}
        </div>
        <p className="text-xs sm:text-sm text-slate-500 mt-1.5">
          A tender carries its own job-number prefixes, its allotment, its AT percentage and
          its <strong>rate schedule</strong>. Everything priced is priced against the tender the
          job was booked under &mdash; not against whichever tender is selected today.
        </p>

        {/* THE SETUP ORDER, SHOWN. The gates in New Job already enforce this sequence; the
            operator was never told what it was. */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
          <span className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1">
            <Building2 className="w-3 h-3" /> Agency
          </span>
          <ArrowRight className="w-3 h-3 text-slate-400" />
          <span className={`px-2 py-1 rounded-lg border inline-flex items-center gap-1 ${
            hasAny ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-300'
          }`}>
            <FileSignature className="w-3 h-3" /> Tender {hasAny ? '' : '— you are here'}
          </span>
          <ArrowRight className="w-3 h-3 text-slate-400" />
          <span className="px-2 py-1 rounded-lg bg-slate-50 text-slate-700 border border-slate-200 inline-flex items-center gap-1">
            <LayoutGrid className="w-3 h-3" /> Divisions &amp; prefixes
          </span>
          <ArrowRight className="w-3 h-3 text-slate-400" />
          <span className="px-2 py-1 rounded-lg bg-slate-50 text-slate-700 border border-slate-200 inline-flex items-center gap-1">
            <Scale className="w-3 h-3" /> Allotment
          </span>
          <ArrowRight className="w-3 h-3 text-slate-400" />
          <span className={`px-2 py-1 rounded-lg border inline-flex items-center gap-1 ${
            activeHasRates ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-50 text-slate-700 border-slate-200'
          }`}>
            <Database className="w-3 h-3" /> Rates
          </span>
        </div>
        <p className="text-[11px] text-slate-500 mt-2">
          Divisions and allotments are set <strong>on each tender below</strong> &mdash; they are
          properties of a tender, so there is no separate screen for them.
        </p>

        {!activeAgency && (
          <div className="mt-4 bg-rose-50 border border-rose-300 rounded-lg p-3 text-xs text-rose-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">No agency selected.</p>
              <p>A tender belongs to an agency. Create or select one first.</p>
              <Link to="/agency-settings" className="font-bold underline">Go to Agency Settings</Link>
            </div>
          </div>
        )}

        {activeAgency && hasAny && !activeHasRates && (
          <div className="mt-4 bg-amber-50 border border-amber-300 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">
                The selected tender has no rates yet, so nothing can be estimated or billed against it.
              </p>
              <p className="mt-0.5">
                Set its prefixes and allotment below, then enter its rates.
              </p>
              <Link to="/estimate-master" className="font-bold underline">Open Estimate Master</Link>
            </div>
          </div>
        )}
      </div>

      <AtSettings />
    </div>
  );
}
