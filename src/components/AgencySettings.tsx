import EstimateMaster from './EstimateMaster';
import AtMasters from './AtMasters';
import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAgency, isIntakeOpen, type PublishedAt } from '../lib/AgencyContext';
import { CARD, CARD_PAD } from '../lib/ui';
import { gstinScopeError } from '../lib/utils';
import EditAgencyForm from "./EditAgencyForm";
import { Loader2, Plus, Building, Trash2, FileUp, CheckCircle2, AlertTriangle, ArrowRight, Layers, FileText } from 'lucide-react';
import { validateDivisionPrefixes } from '../lib/prefixValidation';
import { LetterheadCalibrator } from './LetterheadCalibrator';
import AddAgencyFlow from './AddAgencyFlow';
import ManageSubscription from './ManageSubscription';
import { AgencySubscriptionBadge } from './AgencySubscriptionBadge';
import { atRatesReadiness, validateEstimateMaster } from '../lib/estimateMasterHealth';
import { missingForEstimate, missingForTaxInvoice } from '../lib/jobDisplay';
import { settingsTabFor, estimateMasterLink, type SettingsTab } from '../lib/settingsLinks';

/** The four Gujarat DISCOMs. Names only - see AUDIT O7 for why no registration
 *  details are attached to these. */
const DISCOM_OPTIONS = [
  'Uttar Gujarat Vij Company Ltd.',
  'Madhya Gujarat Vij Company Ltd.',
  'Paschim Gujarat Vij Company Ltd.',
  'Dakshin Gujarat Vij Company Ltd.',
];

const SETTINGS_TABS: ReadonlyArray<readonly [SettingsTab, string]> = [
  ['agency', 'Agency setup'],
  ['at', 'AT / Tender periods'],
  ['estimate-master', 'Estimate Master'],
  ['subscription', 'Manage subscription'],
];

/**
 * A core type for each section `validateEstimateMaster` can be asked about. `sectionForCoreType`
 * maps LSTC to CRGO, so these four reach every section a wrong-schedule refusal can name.
 */
const SECTION_PROBES = ['CRGO', 'Amorphous', 'Wound Core', 'OH'];

export default function AgencySettings() {
  const { agencies, activeAgency, setActiveAgencyId, addAgency, updateAgency, atMasters, activeAtMaster, setActiveAtMasterId, publishedAts, loading, agencyPointerNotice, dismissAgencyPointerNotice, viewingAllTenders } = useAgency();
  // ATs belonging to the ACTIVE agency only - the selector must never offer another
  // agency's tender period (AUDIT F20 was exactly that leak).
  const agencyAtsForContext = atMasters.filter(at => at.agencyId === activeAgency?.id);
  const [showAddForm, setShowAddForm] = useState(false);
  /**
   * ⚠ FOUR TABS, AND THE URL DECIDES WHICH (AUDIT G56).
   *
   * Agency setup, AT / Tender periods, Estimate Master, Manage subscription. The middle two
   * used to be stacked below the agency form on one long page, which is why Estimate Master
   * had to be collapsed and the AT list hidden behind "Expand & Manage" - both were ways of
   * making a page shorter. Tabs solve that directly.
   *
   * Subscription was the first tab, BECAUSE IT IS A DIFFERENT SUBJECT (AUDIT G38). Everything
   * else here is about ONE agency - the one selected in the context bar. Subscription is about
   * the ACCOUNT: every agency it owns, and which of them expires first. Those two scopes fought
   * when the subscription lived in a box at the top, because the box inherited the page's
   * single-agency scope and could only ever answer for one of them.
   *
   * The tab is read from `?section=` on every render, never held in state - see settingsLinks
   * for why a tab held in state cannot follow a link.
   */
  const [settingsParams, setSettingsParams] = useSearchParams();
  const settingsTab: SettingsTab = settingsTabFor(settingsParams.get('section'));
  /**
   * ⚠ A TAB IS MOUNTED ON FIRST VISIT AND THEREAFTER ONLY HIDDEN, NEVER UNMOUNTED (AUDIT G56).
   *
   * EditAgencyForm, AtSettings and EstimateMaster each hold edits that are not saved until the
   * operator says so. On one long page, scrolling away lost nothing; `{tab === x && ...}` would
   * discard a half-typed rate table on a tab click, which is worse than the long page was. The
   * old Estimate Master collapse did exactly that - hiding it unmounted it.
   *
   * ⚠ STAYING MOUNTED IS NOT THE WHOLE GUARANTEE. Each of those screens also re-seeds its fields
   * from context, and context objects are replaced on every save anywhere - so a save on one tab
   * re-seeded the others. Each is now keyed on the data it copies rather than on those objects:
   * loadKey in EstimateMaster, the sync effect's dependency list in EditAgencyForm, and the
   * prefix effect in AtDivisions.
   */
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<SettingsTab>>(() => new Set([settingsTab]));
  useEffect(() => {
    setVisitedTabs(prev => (prev.has(settingsTab) ? prev : new Set([...prev, settingsTab])));
  }, [settingsTab]);
  const isMounted = (tab: SettingsTab) => tab === settingsTab || visitedTabs.has(tab);
  const selectTab = (tab: SettingsTab) => {
    // REPLACES THE WHOLE QUERY. A deep link's atId / division / coreType / at / open described
    // where that link sent the operator, not where they are now - left in the URL, a refresh
    // would reopen the linked AT over whatever they had moved on to.
    setSettingsParams(tab === 'agency' ? {} : { section: tab }, { replace: true });
  };
  /** Required at creation, no default. Stores the NAME only - GSTIN, PAN and address are
   *  entered by the agency from its own tender paperwork. */
  const [discomName, setDiscomName] = useState('');

  const [address, setAddress] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // Letterhead Layout & Calibrator States
  const [letterheadBase64, setLetterheadBase64] = useState('');
  const [letterheadMode, setLetterheadMode] = useState<'full_a4' | 'header_only' | 'standard'>('full_a4');
  const [headerHeightMm, setHeaderHeightMm] = useState<number>(38);
  const [footerHeightMm, setFooterHeightMm] = useState<number>(24);
  const [marginLeftMm, setMarginLeftMm] = useState<number>(12);
  const [marginRightMm, setMarginRightMm] = useState<number>(12);



  // Dynamic divisions state
  // Not seeded with SABARMATI / '21 IS' - that is one UGVCL division's numbering
  // scheme, and pre-filling it made every new agency inherit it (AUDIT O7).
  const [divisions, setDivisions] = useState([{
    name: '',
    prefixCRGO: '',
    prefixAmorphous: '',
    prefixWoundCore: '',
    prefixLSTC: '',
    prefixOH: '',
    allotmentCRGO: '',
    allotmentAmorphous: '',
    allotmentWoundCore: ''
  }]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddDivision = () => {
    setDivisions([...divisions, { name: '', prefixCRGO: '', prefixAmorphous: '', prefixWoundCore: '', prefixLSTC: '', prefixOH: '', allotmentCRGO: '', allotmentAmorphous: '', allotmentWoundCore: '' }]);
  };

  const handleRemoveDivision = (index: number) => {
    if (divisions.length === 1) return;
    const newDivs = [...divisions];
    newDivs.splice(index, 1);
    setDivisions(newDivs);
  };

  const handleDivisionChange = (index: number, field: string, value: string) => {
    const newDivs = [...divisions];
    (newDivs[index] as any)[field] = value.toUpperCase(); // Normalize names to uppercase
    setDivisions(newDivs);
  };

  // ⚠ handleAddAgency IS GONE (AUDIT G38). It assembled a whole agency - DISCOM, GSTIN,
  // bank details, letterhead, divisions - from this page's form and called addAgency.
  // Creation is now a purchase: names are collected by AddAgencyFlow, the server creates
  // the agencies in the transaction that records the payment, and every other detail is
  // entered afterwards per agency. Nothing on this page creates an agency any more.

  /**
   * ⚠ EVERY HOOK RUNS BEFORE THE EARLY RETURN BELOW, AND MUST KEEP DOING SO (AUDIT G47).
   *
   * `useState` for the rates section and the `?section=` effect used to sit BELOW
   * `if (loading) return <Loader2 />`. React requires the same hooks in the same order on
   * every render: the render that took the loading branch called fourteen, the next called
   * seventeen, and React threw "Rendered more hooks than during the previous render"
   * (minified #310). The component died during render, so nothing below the tab bar
   * mounted - which looked exactly like an agency that would not load.
   *
   * ⚠ IT ONLY CRASHED ON A COLD LOAD. Navigating here in-session finds `loading` already
   * false, so the first render calls every hook and stays consistent forever. A refresh
   * renders once with `loading` true and once without. That is why it survived two weeks:
   * the failing path was unreachable until the SPA rewrite (G36) made refreshing this URL
   * possible at all - before that, a refresh was a Vercel 404 and never reached React.
   *
   * Both of those hooks are gone (AUDIT G56); the tab hooks at the top of this component
   * stand where they stood, for the same reason.
   *
   * A guard against this runs in scripts/admin/hooks-after-return.js.
   */

  if (loading) return <Loader2 className="w-6 h-6 animate-spin mx-auto mt-10 text-blue-600" />;

  /**
   * ?section= RESOLVES TO A TAB OF THIS PAGE (AUDIT G56).
   *
   * Tenders and Estimate Master are parts of agency setup, not separate destinations, so
   * every deep link that used to name a route now names a tab here: the setup-gap dialogs in
   * New Job, Estimate Generate, Billing and Internal Inspection send `?section=at`,
   * `?section=divisions`, `?section=allotments` or `?section=estimate-master`, and the trial
   * banner sends `?section=subscription`. The mapping lives in settingsLinks.
   *
   * The atId / division / coreType parameters are NOT consumed here and must be left in the
   * URL: `AtSettings` reads them itself, to open the named AT on the right tab. Stripping
   * them lands the operator on a settings page with the problem still to find - which is what
   * happened once already when this was retargeted carelessly (AUDIT F74). Likewise `at` and
   * `open`, which EstimateMaster reads.
   */
  /**
   * ESTIMATE MASTER IS NO LONGER COLLAPSED (AUDIT G56).
   *
   * It was collapsed because it is a 2,600-line screen and most visits to Agency Settings were
   * not about rates - expanded, it buried everything above it. That reason was about sharing
   * a page. In its own tab, arriving means you came for the rates.
   *
   * The five SECTIONS inside it still open closed. Their reason was the screen's own - the
   * frequent case is reading one rate in one section - and a tab does not change it. A refusal
   * that names a section opens that one (`?open=`).
   */

  /**
   * WHAT THE TAB'S HEADER SAYS. Derived exactly as the Estimate Master banner derives it, so
   * the two can never disagree about which state an AT is in.
   *
   * "NO RATES" IS NOT A NEUTRAL STATE and is not styled as one. An AT without rates blocks
   * every estimate and every bill - atRatesReadiness refuses both - so in the header it is
   * the loudest thing on the row, not a grey chip among others.
   */
  const ratesSummary = (() => {
    if (!activeAtMaster) {
      // A LINK, NOT AN INSTRUCTION. A new agency meets this state before any other - the
      // nav has no Tenders entry and AT creation sits inside this page - so "create one
      // above" is the sentence that leaves them looking for it. Rescued from the
      // ratesSource banner that used to carry it (EstimateMaster, removed).
      return {
        tone: 'blocking' as const,
        label: 'No AT selected',
        detail: (
          <>
            Rates belong to a tender.{' '}
            <Link to="/agency-settings?section=at" className="font-bold underline hover:text-rose-950">
              Create or select one
            </Link>{' '}
            before setting them.
          </>
        ),
      };
    }
    const src = String((activeAtMaster as any).ratesSource || '').trim();
    if (!src) {
      return {
        tone: 'blocking' as const,
        label: 'NO RATES',
        detail: `This tender has no rate schedule. Estimates and bills against it are blocked until it does.`,
      };
    }
    if (src === 'inherited-agency') {
      return {
        tone: 'warn' as const,
        label: 'Inherited from the agency',
        detail: `Figures carried over from ${activeAgency?.name || "the agency"} when rates moved onto tenders. Nobody has confirmed them against this tender.`,
      };
    }
    if (src.startsWith('published:')) {
      const tpl: PublishedAt | undefined = publishedAts.find(t => t.id === src.slice('published:'.length));
      const used = Number((activeAtMaster as any).publishedAtVersion ?? 0);
      const behind = tpl && Number(tpl.version) > used;
      return {
        tone: behind ? ('warn' as const) : ('ok' as const),
        label: behind ? `Template v${used} — v${tpl?.version} available` : `From template v${used}`,
        detail: `Copied from "${tpl?.name || 'a published template'}".`,
      };
    }
    return { tone: 'ok' as const, label: 'Entered for this tender', detail: `Entered against this tender and used to price only its jobs.` };
  })();

  /**
   * ⚠ THE TAB BAR CARRIES EVERY REFUSAL THIS PAGE CAN CLEAR, COMPUTED BY THE FUNCTION THAT
   * REFUSES (AUDIT G56).
   *
   * Moving a warning into a tab hides it from everyone on the other three. So a tab whose
   * content can clear a refusal says so on the tab itself - and it asks the same function the
   * refusing screen asks, with the same arguments, so the marker and the refusal cannot
   * disagree. That property matters more than the marker does: a marker that only resembles
   * the check will in time mark a tab that refuses nothing, or stay quiet over one that does.
   *
   * Refusals only. Warnings that do not stop work - inherited rates, a newer template version -
   * stay inside their tab. A marker on everything is a marker on nothing.
   *
   * ⚠ NOT MARKED, AND WHY:
   *   - Scrap charge (BillingSystem, resolveScrapCharge) and circle limit (InternalInspection,
   *     checkJobCircleLimit). Neither needs Estimate Master loaded, but both are questions about
   *     ONE JOB - a scrap job's core type and kVA, an inspected job's rating - and a tab bar has
   *     no job to ask about. A marker would have to invent one.
   *   - Subscription. TrialBanner already stands on every screen of the app.
   */
  // Estimate Generate's blockIfDiscomIncomplete and Billing's, with the same argument.
  const agencyMissing = activeAgency
    ? Array.from(new Set([...missingForEstimate(activeAgency), ...missingForTaxInvoice(activeAgency)]))
    : [];
  // New Job's own intake gate, with New Job's own three arguments.
  const intakeGate = isIntakeOpen(activeAtMaster, agencyAtsForContext, viewingAllTenders);
  // EVERY TENDER OF THE AGENCY, NOT ONLY THE ACTIVE ONE - AND CLOSED ONES TOO. Estimates and bills
  // price from the JOB's AT (atForJob), so an older tender without rates refuses work while the
  // active one looks fine. Closing a tender does not close its jobs: neither `atRatesReadiness`
  // nor `validateEstimateMaster` reads status, so a closed AT still refuses every bill for work
  // booked under it. Leaving it unmarked would hide a live refusal because the tender is retired.
  const isClosedAt = (at: { status?: string }) => String(at.status || '').toLowerCase() === 'closed';
  const atsWithoutRates = agencyAtsForContext.filter(at => atRatesReadiness(at).blocked);
  // In the refusals' own order: they ask about rates first and return, so the section check
  // is only ever reached for a tender that HAS rates. Asking it of one without would mark a
  // fault in the agency fallback that no refusal ever reports.
  const misfiledSections = agencyAtsForContext
    .filter(at => !atRatesReadiness(at).blocked)
    .flatMap(at => SECTION_PROBES
      .map(core => validateEstimateMaster(at, activeAgency, core))
      .filter(health => health.blocking)
      .map(health => ({ at, health })));

  const markers: Partial<Record<SettingsTab, { label: string; title: string }>> = {};
  if (activeAgency && agencyMissing.length > 0) {
    markers.agency = {
      label: 'Details missing',
      title: `Estimates or tax invoices are refused until these are recorded: ${agencyMissing.join(', ')}.`,
    };
  }
  if (activeAgency && !intakeGate.open) {
    markers.at = {
      label: agencyAtsForContext.length === 0 ? 'No tender' : 'Intake closed',
      title: intakeGate.reason,
    };
  }
  if (atsWithoutRates.length > 0 || misfiledSections.length > 0) {
    // ⚠ THE FAULTY SECTION IS NAMED ON THE TAB ITSELF. The section check probes every section,
    // while a refusal asks only about the core types on the MR in hand, so an agency that never
    // books Wound Core can see a Wound Core fault marked. That is left alone on purpose - it is a
    // real stored fault, and suppressing it would mean the app deciding which core types an
    // agency "really" uses. Naming the section lets someone see it is a type they do not book and
    // dismiss it knowingly, rather than being puzzled by "Wrong schedule".
    const faultySections = Array.from(new Set(misfiledSections.map(m => m.health.label)));
    markers['estimate-master'] = {
      label: [
        atsWithoutRates.length > 0 ? 'No rates' : '',
        faultySections.length > 0 ? `Wrong schedule: ${faultySections.join(', ')}` : '',
      ].filter(Boolean).join(' · '),
      title: [
        ...atsWithoutRates.map(at => `AT ${at.atNumber || at.name}${isClosedAt(at) ? ' (closed)' : ''}: no rates - estimates and bills are refused.`),
        ...misfiledSections.map(({ at, health }) => `AT ${at.atNumber || at.name}${isClosedAt(at) ? ' (closed)' : ''}: the ${health.label} section holds the wrong schedule.`),
      ].join('\n'),
    };
  }


  return (
    // 900px, not 672px. The form is two-column by construction (grid-cols-1
    // md:grid-cols-2 on every tab) and Tailwind breakpoints are VIEWPORT-based, so on any
    // desktop it goes two-column regardless of the container - which at 672px gave each
    // field ~328px. The content and the container disagreed; 900px gives ~430px per field,
    // which fits the pairs this form is actually made of (GSTIN/PAN, bank/IFSC,
    // DISCOM/circle office). Region B breaks out wider still - see its own note.
    <div className="max-w-[900px] mx-auto space-y-5">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-slate-200">
        {SETTINGS_TABS.map(([k, label]) => {
          const marker = markers[k];
          const selected = settingsTab === k;
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => selectTab(k)}
              title={marker?.title}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-t-lg -mb-px border-b-2 ${
                selected
                  ? 'border-blue-600 text-blue-800 bg-blue-50'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {label}
              {marker && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-black uppercase tracking-wide">
                  <span className="w-1.5 h-1.5 rounded-full bg-white" aria-hidden="true" />
                  {marker.label}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ⚠ A REFUSED OR REPAIRED SELECTION SAYS SO (AUDIT G39). Every section below is gated
          on `activeAgency`, so a pointer at an agency this session does not hold rendered a
          page with a header and nothing else - no error, no explanation, and twenty jobs sitting
          untouched in a database the operator had no reason to trust any more. Same shape as
          F84's superseded AT selection: the app did something quiet and sensible, and left the
          person to work out why the screen no longer matched what they expected. */}
      {agencyPointerNotice && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <p className="text-[11px] font-bold text-amber-900 flex-1">{agencyPointerNotice}</p>
          <button type="button" onClick={dismissAgencyPointerNotice}
            className="text-[11px] font-bold text-amber-800 hover:text-amber-950 shrink-0">Dismiss</button>
        </div>
      )}

      {/* ⚠ NO SUBSCRIPTION BOX HERE, AND NO AGENCY-SLOTS CARD. Both stood at the top of this
          page and both are gone (AUDIT G38).

          The subscription box was a second answer to a question the Manage Subscription tab
          answers properly: it showed ONE agency's state, on a page whose whole subject is the
          agency you have selected, so an owner with four agencies had to switch between them to
          learn what they owed. The tab shows all of them at once, sorted by expiry.

          The slots card sold an abstract credit. Agencies are now named and paid for together,
          so there is no credit to hold and nothing to show a balance of.

          What survives is the STATUS, inline beside the agency name in the context bar below -
          one word about the agency you are looking at, where the name already is. */}
      {/* ⚠ THE CONTEXT BAR FRAMES THREE TABS, SO IT SITS ABOVE THEM (AUDIT G56). It used to live
          inside Agency setup, but the AT and Estimate Master tabs are scoped by its two selectors.
          Hidden - not unmounted - on Manage subscription, which is about the account rather than
          one agency (G38), so an Add Agency purchase in progress survives a look at that tab. */}
      <div hidden={settingsTab === 'subscription'} className="space-y-5">
      {/* ============================ CONTEXT BAR ============================
          The SCOPE everything below sits in, not a section you edit. "Switch Agency" was
          a card list, which implied it was content; it is the frame.

          Both selectors write IMMEDIATELY - they are the only immediate writes on this
          page, and gathering them here is what makes that predictable rather than
          scattered. Add Agency sits beside the selector because it creates a frame rather
          than editing anything within one; it does not belong under "This Agency".

          The AT selector states "none active" explicitly. An absent selector and an
          unset one are indistinguishable, and that ambiguity cost real time. */}
      <div className="bg-slate-900 text-white p-3 rounded-lg border border-slate-800">
        {/* STACKED, not side by side. Two flex-1 selectors plus the Add button inside a
            672px page left the agency select roughly 190px wide, and `min-w-0` - required
            so a flex child CAN shrink - let it shrink below its content, truncating the
            name. Nothing set a width or a truncate class; the truncation was emergent.
            Full-width rows remove the competition rather than trading one squeeze for
            another. */}
        <div className="flex flex-col gap-3">
          <div className="flex-1 min-w-0">
            {/* ⚠ THE SUBSCRIPTION STATE LIVES HERE NOW - inline, beside the name, one word.
                It was a card twice this size at the top of the page (AUDIT G38). What is
                actually useful before working in an agency is whether it is paid for, and that
                is a badge rather than a panel. It renders nothing while it does not know: a
                failed read shows no chip rather than a reassuring one. */}
            <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
              <span>Agency</span>
              <AgencySubscriptionBadge agencyId={activeAgency?.id} />
            </label>
            <div className="flex items-center gap-2">
              <select
                title={activeAgency?.name || ''}
                value={activeAgency?.id || ''}
                onChange={e => setActiveAgencyId(e.target.value)}
                className="flex-1 min-w-0 px-3 py-2 text-sm font-bold rounded-lg bg-slate-800 border border-slate-700 text-white focus:ring-1 focus:ring-blue-400"
              >
                {agencies.length === 0 && <option value="">No agencies yet</option>}
                {agencies.map(a => (
                  <option key={a.id} value={a.id}>{a.name || '(unnamed)'}</option>
                ))}
              </select>
              {!showAddForm && (
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  className="shrink-0 flex items-center px-3 py-2 text-xs font-bold uppercase tracking-widest bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
                  title="Create a new agency. This creates a separate frame - it does not copy anything from the current one."
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add Agency
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
              AT Period
            </label>
            {agencyAtsForContext.length === 0 ? (
              <div className="px-3 py-2 text-sm font-semibold rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-200">
                None active for {activeAgency?.name || 'this agency'}
              </div>
            ) : (
              <select
                value={activeAtMaster?.id || ''}
                onChange={e => setActiveAtMasterId(e.target.value)}
                className="w-full px-3 py-2 text-sm font-bold rounded-lg bg-slate-800 border border-slate-700 text-white focus:ring-1 focus:ring-blue-400"
              >
                {!activeAtMaster && <option value="">None selected</option>}
                {agencyAtsForContext.map(at => (
                  <option key={at.id} value={at.id}>
                    {at.atNumber || '(no number)'}{at.name ? ` - ${at.name}` : ''}{at.status === 'Closed' ? '  (closed)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* ONE line. The bar frames the content below it, so it must read lighter than
            what it frames - three lines at 11px gave it the visual weight of a section.
            The fact that matters (these are the only immediate writes on the page) is
            kept; the restatement of what each region covers is not, because the region
            headings say it where it applies. */}
        <p className="text-[11px] text-slate-400 mt-2.5">
          Both take effect immediately across the app - everything else on this page saves explicitly.
        </p>
      </div>

      {/* CREATE PANEL, not a section. It is opened from the context bar, because creating
          an agency makes a new FRAME rather than editing anything inside the current one.
          Rendered only while open - a permanently visible "Add New Agency" card sitting
          between the frame and "This Agency" implied it was part of one or the other. */}
      {/* ⚠ NAMES ONLY, AND PAID FOR BEFORE CREATION (AUDIT G38). This was a full
          creation form - name, DISCOM, letterhead, GSTIN - which made sense when creating
          an agency was free and singular. Asking for all of it five times before a customer
          is allowed to pay does not, and those details are exactly what someone wants to
          get right slowly rather than inside a purchase flow. They are filled in afterwards,
          per agency, in the form that already exists for editing one. */}
      {showAddForm && <AddAgencyFlow onDone={() => setShowAddForm(false)} />}
      </div>

      {/* ============================ TAB: AGENCY SETUP ============================ */}
      {isMounted('agency') && (
        <div hidden={settingsTab !== 'agency'} className="space-y-5">
          {/* THE MARKER'S DETAIL, WHERE IT IS FIXED. Same list the tab's marker was computed
              from, so arriving here always explains the marker that sent you. */}
          {activeAgency && agencyMissing.length > 0 && (
            <div className="flex items-start gap-2 bg-rose-50 border border-l-2 border-l-rose-500 border-rose-300 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
              <p className="text-xs text-rose-900 leading-relaxed">
                <strong className="font-bold">Estimates or tax invoices for {activeAgency.name} are refused until these are recorded:</strong>{' '}
                {agencyMissing.join(', ')}.
              </p>
            </div>
          )}

          {/* ======================= REGION A: THIS AGENCY =======================
              Agency-level settings. NONE of this depends on an AT period - it stays available
              and unchanged whichever tender period is selected above, which is the distinction
              the old flat list of seven sections gave no way to see.

              Divisions, prefixes and allotment quotas are AT-scoped and live on the AT / Tender
              periods tab. The read-only copy of them that sat inside the form below is removed
              (AUDIT G56). */}
          {activeAgency && (
            <div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mb-2.5 px-1">
                <h2 className="text-base font-black text-slate-900">This Agency</h2>
                <span className="text-[11px] text-slate-500">
                  {activeAgency.name} - identity, tax, DISCOM routing, bank, letterhead
                </span>
              </div>
              <div className={`${CARD} ${CARD_PAD} border-l-2 border-l-slate-400`}>
                <EditAgencyForm agency={activeAgency} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================= TAB: AT / TENDER PERIODS =========================
          REGION B: THIS AT PERIOD. AT-scoped settings, under the AT selector in the context bar
          so the dependency is structural rather than something the operator has to infer.

          WIDER than Region A on purpose. Region A is forms - a 1400px-wide GSTIN field is
          harder to use than a narrow one. Region B is tables: six core-type prefixes per
          division plus three quota columns do not fit a form-width column. One container
          could suit one or the other, never both, which is why the width question could not
          be answered as a single class on the page.

          EXPANDED, never collapsed by default. AT-scoped content being invisible until you
          know where to look is the problem this region exists to fix; a collapsed panel is
          the same problem in tidier clothes. */}
      {isMounted('at') && (
        <div hidden={settingsTab !== 'at'}>
          {activeAgency && (
            <div className="relative left-1/2 -translate-x-1/2 w-[min(1400px,94vw)]">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mb-2.5 px-1">
                <h2 className="text-base font-black text-slate-900">This AT Period</h2>
                <span className="text-[11px] text-slate-500">
                  Tender periods, divisions &amp; job number prefixes, allotment quotas
                </span>
              </div>

              {/* THE MARKER'S DETAIL when tenders exist but none takes new work - a closed or
                  superseded selection, or the All tenders scope. The no-tender case has its own
                  notice below. Same gate, same reason string as New Job's refusal. */}
              {agencyAtsForContext.length > 0 && !intakeGate.open && (
                <div className="mb-3 flex items-start gap-2 bg-rose-50 border border-l-2 border-l-rose-500 border-rose-300 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                  <p className="text-xs text-rose-900 leading-relaxed">
                    <strong className="font-bold">New Job is refusing work.</strong> {intakeGate.reason}
                  </p>
                </div>
              )}

              {agencyAtsForContext.length === 0 ? (
                /* SAYS WHAT TO DO, not merely that nothing is here. A section that vanishes is
                   indistinguishable from one that does not exist - which is exactly how hours
                   were lost looking for divisions that were never missing, only unreachable. */
                <div className="bg-amber-50 border border-l-2 border-l-amber-500 border-amber-300 rounded-lg p-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <h3 className="font-bold text-amber-900 text-sm">
                        No AT period is active for {activeAgency.name}
                      </h3>
                      <p className="text-[13px] text-amber-900 mt-1 leading-relaxed max-w-2xl">
                        Divisions, prefixes and allotments are recorded against a tender period -
                        create one to configure them.
                      </p>
                      <p className="text-[11px] text-amber-800/80 mt-2 leading-relaxed max-w-2xl">
                        Until then, job numbers fall back to whatever is stored on the agency
                        record, and no allotment quota is checked at intake.
                      </p>
                      <button
                        type="button"
                        onClick={() => { const el = document.getElementById('at-masters-section'); el?.scrollIntoView({ behavior: 'smooth' }); }}
                        className="mt-3 inline-flex items-center px-3.5 py-2 text-xs font-bold uppercase tracking-widest bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1.5" /> Set up an AT period
                      </button>
                    </div>
                  </div>
                  <div id="at-masters-section" className="mt-6">
                    <AtMasters />
                  </div>
                </div>
              ) : (
                <div id="at-masters-section" className="border-l-4 border-l-indigo-400 rounded-l">
                  <AtMasters />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ============================ TAB: ESTIMATE MASTER ============================
          A tab of agency setup, not a destination. It comes AFTER Tenders because rates live on
          a tender: the screen cannot save without one, and listing it earlier is what put a new
          agency in front of it before it had an AT to save to (AUDIT F74). */}
      {isMounted('estimate-master') && (
        <div hidden={settingsTab !== 'estimate-master'}>
          {activeAgency && (
            <div id="estimate-master-section" className="relative left-1/2 -translate-x-1/2 w-[min(1400px,94vw)] space-y-3">
              <div
                className={`rounded-lg border p-3 ${
                  ratesSummary.tone === 'blocking'
                    ? 'bg-rose-50 border-rose-400'
                    : ratesSummary.tone === 'warn'
                      ? 'bg-amber-50 border-amber-300'
                      : 'bg-white border-slate-200'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-black text-slate-900">Estimate Master Rates</h2>
                    {/* WHOSE RATES THESE ARE, AT HEADER LEVEL.
                        The screen below opens on the ACTIVE AT's schedule, so switching tender in
                        the context bar changes everything under this header. The AT was named only
                        in the 11px line beneath; here it is the same size as the state, because
                        "which tender" and "what state" are the two things this header answers. */}
                    {activeAtMaster ? (
                      <span className="px-2.5 py-0.5 text-xs font-black bg-indigo-50 text-indigo-800 border border-indigo-300 rounded-full">
                        AT {activeAtMaster.atNumber || activeAtMaster.name}
                        {String(activeAtMaster.status || '').toLowerCase() === 'closed' && ' · CLOSED'}
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 text-xs font-black bg-slate-100 text-slate-600 border border-slate-300 rounded-full">
                        no AT selected
                      </span>
                    )}
                    {/* THE STATE. "No rates" is sized and coloured to be the loudest thing here -
                        it is what stands between the operator and every document they are trying
                        to produce. */}
                    <span className={`px-2.5 py-0.5 rounded-full border font-black tracking-wide ${
                      ratesSummary.tone === 'blocking'
                        ? 'text-xs bg-rose-600 text-white border-rose-700 uppercase'
                        : ratesSummary.tone === 'warn'
                          ? 'text-[11px] bg-amber-100 text-amber-900 border-amber-300'
                          : 'text-[11px] bg-emerald-50 text-emerald-800 border-emerald-200'
                    }`}>
                      {ratesSummary.label}
                    </span>
                  </div>
                  <p className={`text-[11px] mt-1 ${ratesSummary.tone === 'blocking' ? 'text-rose-900 font-semibold' : 'text-slate-500'}`}>
                    {ratesSummary.detail}
                  </p>
                </div>
              </div>

              {/* ⚠ THE REST OF THE MARKER, ON ARRIVAL (AUDIT G56). The header above speaks for the
                  active tender only; the tab's marker counts every open one. Without this list an
                  operator sent here by "No rates" could find a header reading "Entered for this
                  tender" and no sign of the tender that marked the tab - the marker and the page
                  disagreeing, which is the one thing the marker must never do. Built from the
                  same two arrays as the marker. */}
              {(() => {
                const others = [
                  ...atsWithoutRates
                    .filter(at => at.id !== activeAtMaster?.id)
                    .map(at => ({ key: `${at.id}:rates`, at, text: 'has no rates, so estimates and bills for its jobs are refused.', open: undefined })),
                  ...misfiledSections.map(({ at, health }) => ({
                    key: `${at.id}:${health.section}`, at, text: `holds the wrong schedule in its ${health.label} section.`, open: health.section,
                  })),
                ];
                if (others.length === 0) return null;
                return (
                  <div className="rounded-lg border border-l-2 border-l-rose-500 border-rose-300 bg-rose-50 p-3">
                    <h3 className="text-xs font-black uppercase tracking-wide text-rose-900">Also refusing work</h3>
                    <p className="text-[11px] text-rose-900 mt-0.5">
                      Estimates and bills price from each job&rsquo;s own tender, so these refuse work whichever tender is selected above.
                    </p>
                    <ul className="mt-2 space-y-1">
                      {others.map(o => (
                        <li key={o.key} className="text-xs text-rose-950">
                          <strong className="font-bold">AT {o.at.atNumber || o.at.name}</strong> {o.text}{' '}
                          {/* A CLOSED TENDER IS READ-ONLY IN ESTIMATE MASTER, so "Open it" alone would
                              land on rates nobody can change. Say what the fix actually is. */}
                          {isClosedAt(o.at) && (
                            <span>
                              It is <strong className="font-bold">closed</strong>, but its jobs can still be billed; Estimate Master
                              shows it read-only, so reopen it on the AT / Tender periods tab to correct it.{' '}
                            </span>
                          )}
                          <Link to={estimateMasterLink(o.at, o.open)} className="font-bold underline hover:text-rose-700">
                            Open it
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}

              <EstimateMaster />
            </div>
          )}
        </div>
      )}

      {/* ========================== TAB: MANAGE SUBSCRIPTION ========================== */}
      {isMounted('subscription') && (
        <div hidden={settingsTab !== 'subscription'}>
          <ManageSubscription />
        </div>
      )}

      {/* The "Data Tools" card and its "Move ALL My Data To Active Agency" button were
          removed here - see AUDIT.md F28. Nothing replaced them: the orphaned-job case
          they nominally served is empty (0 of 44), and the button's actual behaviour was
          to reassign every job of the signed-in owner to whichever agency was active. */}
    </div>
  );
}
