import EstimateMaster from './EstimateMaster';
import AtMasters from './AtMasters';
import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAgency, type PublishedAt } from '../lib/AgencyContext';
import { gstinScopeError } from '../lib/utils';
import EditAgencyForm from "./EditAgencyForm";
import { Loader2, Plus, Building, Trash2, FileUp, CheckCircle2, AlertTriangle, ArrowRight, Layers, FileText } from 'lucide-react';
import { validateDivisionPrefixes } from '../lib/prefixValidation';
import { LetterheadCalibrator } from './LetterheadCalibrator';

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
  const [newAgencyName, setNewAgencyName] = useState('');
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

  const handleAddAgency = async (e: React.FormEvent) => {
    e.preventDefault();

    // SCOPE LIMIT - the creation form collects GSTIN optionally, so it is checked here too.
    // The authoritative enforcement is at save in EditAgencyForm and again in
    // missingForTaxInvoice, so an agency that acquired a non-Gujarat GSTIN by any route
    // still cannot issue an invoice. See D6.
    const scopeError = gstinScopeError(gstin);
    if (scopeError) {
      alert(scopeError);
      return;
    }

    const validation = validateDivisionPrefixes(divisions);
    if (!validation.isValid) {
      alert(`Cannot create agency due to division prefix validation error:\n\n${validation.errors.join('\n')}`);
      return;
    }

    setIsSubmitting(true);
    try {
      const prefixes: Record<string, Record<string, string>> = {};
      const allotments: Record<string, Record<string, number>> = {};
      const lastJobNumbers: Record<string, number> = {};
      
      divisions.forEach(d => {
        if (d.name.trim() && d.prefixCRGO.trim()) {
          const divName = d.name.trim();
          prefixes[divName] = {
            'CRGO': d.prefixCRGO.trim(),
            'Amorphous': (d.prefixAmorphous || '').trim(),
            'Wound Core': (d.prefixWoundCore || '').trim(),
            'LSTC': (d.prefixLSTC || '').trim(),
            'OH': (d.prefixOH || '').trim(),
          };
          allotments[d.name.trim()] = {
            'CRGO': Number(d.allotmentCRGO) || 0,
            'Amorphous': Number(d.allotmentAmorphous) || 0,
            'Wound Core': Number(d.allotmentWoundCore) || 0,
          };
          lastJobNumbers[d.name.trim()] = 0;
          lastJobNumbers[d.name.trim() + '_OH'] = 0;
        }
      });

      await addAgency({
        name: newAgencyName,
        letterheadUrl: letterheadBase64,
        letterheadMode,
        letterheadHeaderHeightMm: headerHeightMm,
        letterheadFooterHeightMm: footerHeightMm,
        letterheadMarginLeftMm: marginLeftMm,
        letterheadMarginRightMm: marginRightMm,
        // NOT seeded. An agency's own registration state is a fact about that agency and
        // the app has no way to know it - a seeded '24' asserted Gujarat registration for
        // every agency (AUDIT O8). The state CODE is derived from the agency's own GSTIN
        // (its first two digits), so it cannot disagree with the GSTIN; the state NAME is
        // entered. Both start empty.
        agencyState: '',
        agencyStateCode: '',
        // DISCOM IDENTITY IS NOT SEEDED. It used to be pre-filled with UGVCL's real
        // registration - name, GSTIN, PAN, address, circle office - so every new agency
        // was created carrying another company's tax identity, and printed it. Because
        // the values were WRITTEN they were truthy, so no fallback fired and nothing
        // marked them as unchosen (AUDIT O7).
        //
        // discomName comes from the required select on the creation form. GSTIN, PAN and
        // address are entered by the agency from its own tender paperwork - deliberately
        // NOT prefilled from a built-in table, because only UGVCL's is verified and only
        // because it happened to be in this codebase.
        discomName: discomName.trim(),
        discomGstin: '',
        discomPan: '',
        discomAddress: '',
        discomState: 'Gujarat',
        // Not agency-specific: all four DISCOMs are Gujarat entities, and this drives the
        // CGST/SGST vs IGST determination rather than appearing on the document.
        discomStateCode: '24',
        serviceSacCode: '998719',
        circleOfficeName: '',
        // AUTHORITY TITLES AND THE CC TEMPLATE ARE NOT SEEDED.
        //
        // These were UGVCL's specific wording written into every agency regardless of which
        // of the four DISCOMs it had selected. Unlike discomState / discomStateCode /
        // serviceSacCode - which FOLLOW from that required choice and are correct for all
        // four Gujarat entities - these are one DISCOM's phrasing presented as everyone's.
        //
        // They are the shape this audit keeps finding: a value that looks configured, never
        // blocks, and prints. The estimate and tax-invoice gates now require them
        // (missingForEstimate, missingForTaxInvoice), so they are asked for rather than
        // assumed, and the render fallbacks that used to re-supply them are gone.
        forwardingSubject: 'Submiting Inspection Report & Estimate of Transformer',
        gpValidationMonths: 18,
        prefixes,
        lastJobNumbers,
        allotments,
        address,
        gstin,
        pan,
        bankName,
        accountNumber,
        ifscCode,
        email,
        phone
      });
      
      setShowAddForm(false);
      setNewAgencyName('');
      setAddress('');
      setGstin('');
      setPan('');
      setBankName('');
      setAccountNumber('');
      setIfscCode('');
      setEmail('');
      setPhone('');
      setLetterheadBase64('');
      setDivisions([{
        name: '', prefixCRGO: '', prefixAmorphous: '', prefixWoundCore: '',
        prefixLSTC: '', prefixOH: '', allotmentCRGO: '', allotmentAmorphous: '', allotmentWoundCore: ''
      }]);
      setDiscomName('');
    } catch (err) {
      console.error(err);
      alert('Failed to add agency');
    } finally {
      setIsSubmitting(false);
    }
  };

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
      return { tone: 'blocking' as const, label: 'No AT selected', detail: 'Rates belong to a tender. Create or select one above.' };
    }
    const atLabel = activeAtMaster.atNumber || activeAtMaster.name || activeAtMaster.id;
    const src = String((activeAtMaster as any).ratesSource || '').trim();
    if (!src) {
      return {
        tone: 'blocking' as const,
        label: 'NO RATES',
        detail: `AT ${atLabel} has no rate schedule. Estimates and bills are blocked until it does.`,
      };
    }
    if (src === 'inherited-agency') {
      return {
        tone: 'warn' as const,
        label: 'Inherited from the agency',
        detail: `AT ${atLabel} — figures carried over when rates moved onto tenders. Not confirmed against this tender.`,
      };
    }
    if (src.startsWith('published:')) {
      const tpl: PublishedAt | undefined = publishedAts.find(t => t.id === src.slice('published:'.length));
      const used = Number((activeAtMaster as any).publishedAtVersion ?? 0);
      const behind = tpl && Number(tpl.version) > used;
      return {
        tone: behind ? ('warn' as const) : ('ok' as const),
        label: behind ? `Template v${used} — v${tpl?.version} available` : `From template v${used}`,
        detail: `AT ${atLabel} — copied from "${tpl?.name || 'a published template'}".`,
      };
    }
    return { tone: 'ok' as const, label: 'Entered for this tender', detail: `AT ${atLabel} carries its own rate schedule.` };
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
      {/* ============================ CONTEXT BAR ============================
          The SCOPE everything below sits in, not a section you edit. "Switch Agency" was
          a card list, which implied it was content; it is the frame.

          Both selectors write IMMEDIATELY - they are the only immediate writes on this
          page, and gathering them here is what makes that predictable rather than
          scattered. Add Agency sits beside the selector because it creates a frame rather
          than editing anything within one; it does not belong under "This Agency".

          The AT selector states "none active" explicitly. An absent selector and an
          unset one are indistinguishable, and that ambiguity cost real time. */}
      <div className="bg-slate-900 text-white p-5 rounded-xl shadow-sm border border-slate-800">
        {/* STACKED, not side by side. Two flex-1 selectors plus the Add button inside a
            672px page left the agency select roughly 190px wide, and `min-w-0` - required
            so a flex child CAN shrink - let it shrink below its content, truncating the
            name. Nothing set a width or a truncate class; the truncation was emergent.
            Full-width rows remove the competition rather than trading one squeeze for
            another. */}
        <div className="flex flex-col gap-3">
          <div className="flex-1 min-w-0">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
              Agency
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
      {showAddForm && (
      <div className="bg-white p-5 rounded-xl shadow-xs border-2 border-blue-200">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Add New Agency</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Creates a separate agency. Nothing is copied from {activeAgency?.name || 'the current agency'} -
              its estimate master is seeded from the published shared default.
            </p>
          </div>
        </div>

          <form onSubmit={handleAddAgency} className="space-y-6 border-t border-slate-100 pt-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Agency Name</label>
              <input required type="text" value={newAgencyName} onChange={e => setNewAgencyName(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">
                DISCOM <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={discomName}
                onChange={e => setDiscomName(e.target.value)}
                className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50"
              >
                <option value="">Select the DISCOM this agency works with…</option>
                {DISCOM_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Name only. Enter the DISCOM's GSTIN, PAN and address afterwards in Edit
                Agency, from your own tender paperwork - they are not pre-filled, and the
                tax invoice and estimate will not generate until they are set.
              </p>
            </div>

            <div className="border-t border-slate-200 pt-6 mt-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-800 mb-4">Company Profile (Billing Details)</h3>

              <div className="space-y-5">
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Identity</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Company Address</label>
                      <textarea value={address} onChange={e => setAddress(e.target.value)} rows={3} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="Full address" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Email</label>
                      <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="Email Address" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Phone Number</label>
                      <input type="text" value={phone} onChange={e => setPhone(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="Phone Number" />
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Tax details</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">GSTIN</label>
                      <input type="text" value={gstin} onChange={e => setGstin(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="GST Number" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">PAN Number</label>
                      <input type="text" value={pan} onChange={e => setPan(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="PAN Number" />
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Bank details</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Bank Name</label>
                      <input type="text" value={bankName} onChange={e => setBankName(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="Bank Name" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Account Number</label>
                      <input type="text" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="Account Number" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">IFSC Code</label>
                      <input type="text" value={ifscCode} onChange={e => setIfscCode(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="IFSC Code" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-2">
              {/* LETTERHEAD IS NOT SET UP HERE - one entry point only.
                  It used to appear twice: once on this create panel and once in the agency
                  form. Two calibrators for one stored value is a mirror in the other
                  direction - whichever was saved last won, and neither said so. The form
                  is the right home because a letterhead is tuned against the real
                  document, which needs the agency to exist first. */}
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Letterhead and print margins are configured after the agency is created -
                open <strong>This Agency</strong> and use the Letterhead section there.
              </p>
            </div>
            
            <div>
              <div className="flex justify-between items-end mb-2 border-b border-slate-100 pb-2">
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500">Divisions & Prefixes</label>
                <button type="button" onClick={handleAddDivision} className="text-[10px] font-bold uppercase tracking-widest text-blue-600 hover:text-blue-800 flex items-center bg-blue-50 px-2 py-1 rounded">
                  <Plus className="w-3 h-3 mr-1" /> Add Division
                </button>
              </div>
              <div className="space-y-3">
                {divisions.map((div, index) => (
                  <div key={index} className="flex items-start space-x-3 p-3 bg-slate-50 border border-slate-200 rounded">
                    <div className="flex-1 space-y-2">
                      <input 
                        required 
                        type="text" 
                        value={div.name} 
                        onChange={e => handleDivisionChange(index, 'name', e.target.value)} 
                        className="w-full px-4 py-2 text-sm font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" 
                        placeholder="Division Name (e.g. SABARMATI)" 
                      />
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div>
                          <label className="block text-[9px] uppercase font-bold text-slate-500 mb-0.5">CRGO Prefix *</label>
                          <input 
                            required 
                            type="text" 
                            value={div.prefixCRGO} 
                            onChange={e => handleDivisionChange(index, 'prefixCRGO', e.target.value)} 
                            className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" 
                            placeholder="e.g. 21 IS" 
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase font-bold text-slate-500 mb-0.5">Amorphous Prefix</label>
                          <input 
                            type="text" 
                            value={div.prefixAmorphous} 
                            onChange={e => handleDivisionChange(index, 'prefixAmorphous', e.target.value)} 
                            className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" 
                            placeholder="e.g. AM21 IS" 
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase font-bold text-slate-500 mb-0.5">Wound Core Prefix</label>
                          <input 
                            type="text" 
                            value={div.prefixWoundCore} 
                            onChange={e => handleDivisionChange(index, 'prefixWoundCore', e.target.value)} 
                            className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" 
                            placeholder="e.g. WC21 IS" 
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase font-bold text-slate-500 mb-0.5">LSTC Prefix</label>
                          <input 
                            type="text" 
                            value={div.prefixLSTC} 
                            onChange={e => handleDivisionChange(index, 'prefixLSTC', e.target.value)} 
                            className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" 
                            placeholder="e.g. LS21 IS" 
                          />
                        </div>
                      </div>
                    </div>
                    {divisions.length > 1 && (
                      <button type="button" onClick={() => handleRemoveDivision(index)} className="p-2 mt-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end space-x-2">
              <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-100 rounded transition-colors">Cancel</button>
              <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-xs font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center">
                {isSubmitting && <Loader2 className="w-3 h-3 mr-2 animate-spin" />} Save Agency
              </button>
            </div>
          </form>
      </div>

      )}

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
          <div className="bg-white p-5 rounded-xl shadow-xs border border-slate-200 border-l-4 border-l-slate-400">
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
            <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-5">
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
            className={`w-full text-left rounded-xl border-2 p-4 transition-colors ${
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
    </div>
  );
}
