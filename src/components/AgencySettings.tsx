import EstimateMaster from './EstimateMaster';
import AtMasters from './AtMasters';
import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAgency, type PublishedAt } from '../lib/AgencyContext';
import { CARD, CARD_PAD } from '../lib/ui';
import { gstinScopeError } from '../lib/utils';
import EditAgencyForm from "./EditAgencyForm";
import { Loader2, Plus, Building, Trash2, FileUp, CheckCircle2, AlertTriangle, ArrowRight, Layers, FileText } from 'lucide-react';
import { validateDivisionPrefixes } from '../lib/prefixValidation';
import { LetterheadCalibrator } from './LetterheadCalibrator';
import AddAgencyFlow from './AddAgencyFlow';
import ManageSubscription from './ManageSubscription';
import { AgencySubscriptionBadge } from './AgencySubscriptionBadge';

/** The four Gujarat DISCOMs. Names only - see AUDIT O7 for why no registration
 *  details are attached to these. */
const DISCOM_OPTIONS = [
  'Uttar Gujarat Vij Company Ltd.',
  'Madhya Gujarat Vij Company Ltd.',
  'Paschim Gujarat Vij Company Ltd.',
  'Dakshin Gujarat Vij Company Ltd.',
];

export default function AgencySettings() {
  const { agencies, activeAgency, setActiveAgencyId, addAgency, updateAgency, atMasters, activeAtMaster, setActiveAtMasterId, publishedAts, loading } = useAgency();
  // ATs belonging to the ACTIVE agency only - the selector must never offer another
  // agency's tender period (AUDIT F20 was exactly that leak).
  const agencyAtsForContext = atMasters.filter(at => at.agencyId === activeAgency?.id);
  const [showAddForm, setShowAddForm] = useState(false);
  /**
   * ⚠ A TAB, BECAUSE SUBSCRIPTION IS A DIFFERENT SUBJECT FROM AGENCY SETUP (AUDIT G38).
   *
   * Everything else on this page is about ONE agency - the one selected in the context bar.
   * Subscription is about the ACCOUNT: every agency it owns, and which of them expires first.
   * Those two scopes fought when the subscription lived in a box at the top, because the box
   * inherited the page's single-agency scope and could only ever answer for one of them.
   */
  const [settingsTab, setSettingsTab] = useState<'agency' | 'subscription'>('agency');
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

  if (loading) return <Loader2 className="w-6 h-6 animate-spin mx-auto mt-10 text-blue-600" />;

  /**
   * ?section= RESOLVES TO A SECTION OF THIS PAGE.
   *
   * Tenders and Estimate Master are parts of agency setup, not separate destinations, so
   * every deep link that used to name a route now names a section here: the setup-gap
   * dialogs in New Job, Estimate Generate and Billing all send `?section=at`,
   * `?section=divisions`, `?section=allotments` or `?section=estimate-master`.
   *
   * The atId / division / coreType parameters are NOT consumed here and must be left in the
   * URL: `AtSettings` reads them itself, to open the named AT on the right tab. Stripping
   * them lands the operator on a settings page with the problem still to find - which is what
   * happened once already when this was retargeted carelessly (AUDIT F74).
   */
  /**
   * THE ESTIMATE MASTER SECTION IS COLLAPSED BY DEFAULT.
   *
   * It is a 2,600-line screen, and most visits to Agency Settings are not about rates -
   * expanded, it buries everything above it. Collapsed, the header has to carry enough that
   * nobody expands it just to find out what state it is in.
   */
  const [estimateOpen, setEstimateOpen] = useState(false);

  /**
   * WHAT THE COLLAPSED HEADER SAYS. Derived exactly as the Estimate Master banner derives
   * it, so the two can never disagree about which state an AT is in.
   *
   * "NO RATES" IS NOT A NEUTRAL STATE and is not styled as one. An AT without rates blocks
   * every estimate and every bill - atRatesReadiness refuses both - so in the collapsed
   * header it is the loudest thing on the row, not a grey chip among others.
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

  const [settingsParams] = useSearchParams();
  useEffect(() => {
    const section = settingsParams.get('section');
    if (!section) return;
    const id = section === 'estimate-master' ? 'estimate-master-section' : 'at-masters-section';
    // ⚠ A DEEP LINK TO THE RATES MUST OPEN THEM, not merely scroll to a closed header.
    //
    // Three setup-gap dialogs send a BLOCKED estimate or bill here - EstimateGenerate and
    // BillingSystem refuse to issue when the AT has no rates, and this is the route they
    // offer out. Landing that on a collapsed header is a worse dead end than the one the
    // collapse was meant to fix: the operator arrives at the answer and cannot see it.
    if (section === 'estimate-master') setEstimateOpen(true);
    // After paint: the sections below render conditionally on activeAgency, so the element
    // does not exist on the first pass.
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 250);
    return () => window.clearTimeout(t);
  }, [settingsParams, activeAgency?.id]);

  return (
    // 900px, not 672px. The form is two-column by construction (grid-cols-1
    // md:grid-cols-2 on every tab) and Tailwind breakpoints are VIEWPORT-based, so on any
    // desktop it goes two-column regardless of the container - which at 672px gave each
    // field ~328px. The content and the container disagreed; 900px gives ~430px per field,
    // which fits the pairs this form is actually made of (GSTIN/PAN, bank/IFSC,
    // DISCOM/circle office). Region B breaks out wider still - see its own note.
    <div className="max-w-[900px] mx-auto space-y-5">
      <div className="flex gap-1 border-b border-slate-200">
        {([['agency', 'Agency setup'], ['subscription', 'Manage subscription']] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setSettingsTab(k)}
            className={`px-4 py-2 text-xs font-bold rounded-t-lg -mb-px border-b-2 ${
              settingsTab === k
                ? 'border-blue-600 text-blue-800 bg-blue-50'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {settingsTab === 'subscription' && <ManageSubscription />}

      {settingsTab === 'agency' && (<>
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

      {/* ======================= REGION A: THIS AGENCY =======================
          Agency-level settings. NONE of this depends on an AT period - it stays available
          and unchanged whichever tender period is selected above, which is the distinction
          the old flat list of seven sections gave no way to see.

          Note what is NOT here: Divisions, prefixes and allotment quotas are AT-scoped and
          belong to Region B, even though one read-only mirror of them still sits inside
          the form below as tab 4. Moving it is Region B's work. */}
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

      {/* ======================= REGION B: THIS AT PERIOD =======================
          AT-scoped settings, nested under the AT selector in the context bar so the
          dependency is structural rather than something the operator has to infer.

          WIDER than Region A on purpose. Region A is forms - a 1400px-wide GSTIN field is
          harder to use than a narrow one. Region B is tables: six core-type prefixes per
          division plus three quota columns do not fit a form-width column. One container
          could suit one or the other, never both, which is why the width question could not
          be answered as a single class on the page.

          EXPANDED, never collapsed by default. AT-scoped content being invisible until you
          know where to look is the problem this region exists to fix; a collapsed panel is
          the same problem in tidier clothes. */}
      {activeAgency && (
        <div className="relative left-1/2 -translate-x-1/2 w-[min(1400px,94vw)]">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mb-2.5 px-1">
            <h2 className="text-base font-black text-slate-900">This AT Period</h2>
            <span className="text-[11px] text-slate-500">
              Tender periods, divisions &amp; job number prefixes, allotment quotas
            </span>
          </div>

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

      {/* ESTIMATE MASTER — a section of agency setup, not a destination.
          It comes AFTER Tenders because rates live on a tender: the screen cannot save
          without one, and listing it earlier is what put a new agency in front of it before
          it had an AT to save to (AUDIT F74). */}
      {activeAgency && (
        <div id="estimate-master-section" className="relative left-1/2 -translate-x-1/2 w-[min(1400px,94vw)]">
          <button
            type="button"
            onClick={() => setEstimateOpen(o => !o)}
            aria-expanded={estimateOpen}
            className={`w-full text-left rounded-lg border p-3 transition-colors ${
              ratesSummary.tone === 'blocking'
                ? 'bg-rose-50 border-rose-400 hover:bg-rose-100/70'
                : ratesSummary.tone === 'warn'
                  ? 'bg-amber-50 border-amber-300 hover:bg-amber-100/70'
                  : 'bg-white border-slate-200 hover:bg-slate-50'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-black text-slate-900">Estimate Master Rates</h2>
                  {/* WHOSE RATES THESE ARE, AT HEADER LEVEL.
                      The section shows the ACTIVE AT's schedule, so switching tender above
                      changes everything below it - and with the section collapsed that
                      change would otherwise be invisible. The AT was named only in the
                      11px line beneath; here it is the same size as the state, because
                      "which tender" and "what state" are the two things a collapsed header
                      exists to answer. */}
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
                  {/* THE STATE, WITHOUT EXPANDING. "No rates" is sized and coloured to be the
                      loudest thing here - it is what stands between the operator and every
                      document they are trying to produce. */}
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
              <span className={`shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg border ${
                ratesSummary.tone === 'blocking'
                  ? 'bg-rose-600 text-white border-rose-700'
                  : 'bg-slate-100 text-slate-700 border-slate-300'
              }`}>
                {estimateOpen ? 'Hide' : (ratesSummary.tone === 'blocking' ? 'Set rates' : 'Show rates')}
              </span>
            </div>
          </button>

          {estimateOpen && (
            <div className="mt-3">
              <EstimateMaster />
            </div>
          )}
        </div>
      )}

      {/* The "Data Tools" card and its "Move ALL My Data To Active Agency" button were
          removed here - see AUDIT.md F28. Nothing replaced them: the orphaned-job case
          they nominally served is empty (0 of 44), and the button's actual behaviour was
          to reassign every job of the signed-in owner to whichever agency was active. */}
      </>)}
    </div>
  );
}
