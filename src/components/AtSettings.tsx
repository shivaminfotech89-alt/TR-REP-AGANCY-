import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAgency, AtMaster, AtSeedReport } from '../lib/AgencyContext';
import { Plus, Check, Loader2, Calendar, ChevronDown, ChevronUp, Edit2, Save, X, Briefcase, FileText, Layers, Building, Trash2, AlertTriangle } from 'lucide-react';
import { AtAllotments } from './AtAllotments';
import { AtDivisions } from './AtDivisions';
import { formatDDMMYYYY } from '../lib/utils';
import { deleteIfEmpty, GuardedDeleteError } from '../lib/guardedDelete';
import { computeOilBalance, openingMapFrom } from '../lib/oilBalance';
import { otherActiveAts } from '../lib/AgencyContext';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';

// Live hint for an AT percentage field while it's still a string mid-edit (e.g. "-",
// "-.", "." are valid intermediate states that aren't a usable number yet).
function atPercentageHint(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') return '';
  const n = Number(trimmed);
  if (isNaN(n)) return '';
  if (n > 0) return `+${n}% above tender`;
  if (n < 0) return `${n}% below tender`;
  return 'at tender rate';
}

export function AtSettings() {
  const { activeAgency, atMasters, activeAtMaster, setActiveAtMasterId, addAtMaster, updateAtMaster, forgetAtMaster, carryOilBalanceForward } = useAgency();
  const [showAddForm, setShowAddForm] = useState(false);
  // Kept until dismissed, not a toast. It reports what the new AT's job numbering will
  // start from, and any job number that could not be read - the operator creating the AT
  // is the person who needs that, and a console log reaches the wrong person entirely.
  const [seedReport, setSeedReport] = useState<AtSeedReport | null>(null);
  const [seedReportAtNo, setSeedReportAtNo] = useState<string>('');
  /** The new AT's document id, so "Set rates" can name the tender rather than assume it. */
  const [seedReportAtId, setSeedReportAtId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeAtTab, setActiveAtTab] = useState<'divisions' | 'allotments'>('divisions');

  /**
   * HOW MANY JOBS SIT UNDER EACH AT — read from Firestore, not held in context.
   *
   * The delete button exists only where this is 0. It is a COUNT FOR THE UI, not the guard:
   * the guard runs inside the callable, in the same invocation as the delete, and refuses
   * whatever this screen believed (AUDIT F77). A number read at render is stale the moment
   * another tab saves an intake, so it decides what to SHOW and nothing else.
   *
   * `limit(1)` - the question is "any?", not "how many?". Reading a whole agency's jobs to
   * decide whether to draw a button is a cost paid on every visit for an action taken twice
   * a year.
   */
  const [emptyAtIds, setEmptyAtIds] = useState<Set<string>>(new Set());
  const [deletingAtId, setDeletingAtId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ title: string; message: string; advice: string; items: string[] } | null>(null);
  const [confirmDeleteAt, setConfirmDeleteAt] = useState<AtMaster | null>(null);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !activeAgency) { setEmptyAtIds(new Set()); return; }
    let cancelled = false;
    (async () => {
      const empty = new Set<string>();
      for (const at of atMasters.filter(t => t.agencyId === activeAgency.id)) {
        try {
          const snap = await getDocs(query(
            collection(db, 'jobs'),
            where('ownerId', '==', uid),
            where('atId', '==', at.id),
            limit(1),
          ));
          if (snap.empty) empty.add(at.id);
        } catch {
          // A failed read means UNKNOWN, and unknown must not read as empty - leaving it out
          // of the set hides the button, which is the safe direction.
        }
      }
      if (!cancelled) setEmptyAtIds(empty);
    })();
    return () => { cancelled = true; };
  }, [atMasters, activeAgency?.id, auth.currentUser?.uid]);

  /**
   * THE CLOSING OIL BALANCE OF EACH TENDER, for the carry-forward offer (AUDIT F82).
   *
   * Computed with `computeOilBalance`, the same function the Oil Account register uses. A
   * second implementation is how the figure someone confirms comes to differ from the figure
   * the register shows, and this one is the balance the DISCOM is owed against.
   *
   * A tender's closing balance is what it OPENED with plus what it moved - a tender that
   * opened owing 210 and consumed none still owes 210.
   */
  const [oilByAt, setOilByAt] = useState<Record<string, { net: number; jobs: number; txns: number; byDivision: Record<string, number> }>>({});

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !activeAgency) { setOilByAt({}); return; }
    let cancelled = false;
    (async () => {
      try {
        const [jobSnap, inspSnap, txSnap] = await Promise.all([
          getDocs(query(collection(db, 'jobs'), where('ownerId', '==', uid), where('agencyId', '==', activeAgency.id))),
          getDocs(query(collection(db, 'inspections'), where('ownerId', '==', uid))),
          getDocs(query(collection(db, 'oilTransactions'), where('ownerId', '==', uid), where('agencyId', '==', activeAgency.id))),
        ]);
        const jobs = jobSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        const inspections = inspSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        const txns = txSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

        const out: Record<string, { net: number; jobs: number; txns: number; byDivision: Record<string, number> }> = {};
        for (const at of atMasters.filter(t => t.agencyId === activeAgency.id)) {
          const b = computeOilBalance({
            jobs: jobs.filter(j => String(j.atId ?? '') === at.id),
            inspections,
            transactions: txns.filter(t => String(t.atId ?? '') === at.id),
          });
          // ⚠ THE OPENING BALANCE IS ADDED PER DIVISION, not to the total alone (AUDIT F86).
          // A tender that opened owing 40 in SABARMATI still owes it at close, and folding
          // that into one number would let another division's surplus cancel it - which is
          // the concealment the per-division split exists to prevent.
          const openingMap = ((at as any).openingOilBalanceByDivision || {}) as Record<string, number>;
          const closing = openingMapFrom(b);
          for (const [div, v] of Object.entries(openingMap)) {
            closing[div] = Number(((closing[div] || 0) + (Number(v) || 0)).toFixed(2));
          }
          const opening = Number((at as any).openingOilBalance);
          out[at.id] = {
            net: Number(((Number.isFinite(opening) ? opening : 0) + b.net).toFixed(2)),
            jobs: b.jobsCounted,
            txns: b.transactionsCounted,
            byDivision: closing,
          };
        }
        if (!cancelled) setOilByAt(out);
      } catch {
        if (!cancelled) setOilByAt({});   // unknown, and an unknown balance is never offered
      }
    })();
    return () => { cancelled = true; };
  }, [atMasters, activeAgency?.id, auth.currentUser?.uid]);

  /**
   * THE TENDER A GIVEN AT WOULD CARRY ITS OPENING BALANCE FROM: the agency's most recent
   * tender that STARTED EARLIER. `startDate` is the tender period the operator typed, which
   * is the right ordering for "the one before this" - creation order is not.
   */
  const previousAtFor = (at: AtMaster): AtMaster | null => {
    const earlier = atMasters
      .filter(t => t.agencyId === at.agencyId && t.id !== at.id && (t.startDate || 0) < (at.startDate || 0))
      .sort((a, b) => (b.startDate || 0) - (a.startDate || 0));
    return earlier[0] || null;
  };

  const [carryTarget, setCarryTarget] = useState<{ to: AtMaster; from: AtMaster; litres: number; byDivision: Record<string, number> } | null>(null);
  const [carrying, setCarrying] = useState(false);

  const runCarry = async () => {
    if (!carryTarget) return;
    setCarrying(true);
    try {
      await carryOilBalanceForward(carryTarget.to.id, carryTarget.from.id, carryTarget.byDivision, carryTarget.litres);
      setCarryTarget(null);
    } catch (err) {
      alert('Could not record the opening balance. Nothing was changed.\n\n' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setCarrying(false);
    }
  };

  const runDelete = async (at: AtMaster) => {
    setConfirmDeleteAt(null);
    setDeletingAtId(at.id);
    setDeleteError(null);
    try {
      await deleteIfEmpty('atMasters', at.id);
      setEmptyAtIds(prev => { const n = new Set(prev); n.delete(at.id); return n; });

      // ⚠ TELL THE CONTEXT. The delete happened in a Cloud Function, so nothing in the
      // client knows unless it is told - and an earlier version of this line claimed "the
      // context refetches on its own", which is simply not true: `atMasters` is fetched
      // once and thereafter only added to and updated. The deleted tender stayed in every
      // list, kept its chip on the Estimate Master header and stayed selectable (F78).
      forgetAtMaster(at.id);

      // THE SEED PANEL IS KEYED ON AN AT, and that AT may be the one just deleted -
      // creating a tender and immediately thinking better of it is the exact case the
      // delete button exists for. Left alone it would go on offering "Set rates for this
      // AT" for a record that no longer exists.
      if (seedReportAtNo && seedReportAtNo === (at.atNumber || at.name)) {
        setSeedReport(null);
        setSeedReportAtNo('');
      }
    } catch (err) {
      const e = err as GuardedDeleteError;
      setDeleteError({
        title: e.kind === 'not-deployed' ? 'The delete function is not deployed'
             : e.kind === 'blocked' ? 'This AT cannot be deleted'
             : e.kind === 'denied' ? 'Not allowed'
             : e.kind === 'gone' ? 'Already gone'
             : 'The delete could not be completed',
        message: e.message,
        advice: e.advice,
        items: e.blockers.flatMap(b => b.items),
      });
    } finally {
      setDeletingAtId(null);
    }
  };


  // Deep link from a setup-gap dialog: /agency-settings?section=allotments&atId=...
  // Opens the named AT on the right tab so the operator lands where the fix is, rather
  // than on a settings page with the problem still to find.
  const [searchParams] = useSearchParams();
  const deepLinkAtId = searchParams.get('atId');
  const deepLinkSection = searchParams.get('section');

  useEffect(() => {
    if (!deepLinkAtId && deepLinkSection !== 'allotments' && deepLinkSection !== 'divisions' && deepLinkSection !== 'at') return;
    setIsExpanded(true);                       // open the AT Masters section
    if (deepLinkSection === 'allotments') setActiveAtTab('allotments');
    if (deepLinkSection === 'divisions') setActiveAtTab('divisions');
    // The allotments panel renders for the ACTIVE AT, so make the named one active.
    if (deepLinkAtId && atMasters.some(a => a.id === deepLinkAtId)) {
      setActiveAtMasterId(deepLinkAtId);
    }
  }, [deepLinkAtId, deepLinkSection, atMasters]);
  
  const [editingAtId, setEditingAtId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<{
    atNumber: string;
    name: string;
    startDate: string;
    endDate: string;
    atPercentageCRGO: string;
    atPercentageAmorphous: string;
    atPercentageWoundCore: string;
  } | null>(null);

  const [newAt, setNewAt] = useState({
    atNumber: '',
    name: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0],
    atPercentageCRGO: '4',
    atPercentageAmorphous: '4',
    atPercentageWoundCore: '4',
  });

  const agencyAts = atMasters.filter(at => at.agencyId === activeAgency?.id);

  /**
   * The AT a new one would carry its percentages over from - the agency's most recent by
   * startDate. `startDate` is a tender date the operator types, not a creation time, so
   * this is a best guess and is LABELLED as one wherever it is used.
   */
  const carryOverSource = agencyAts.length
    ? [...agencyAts].sort((x, y) => (y.startDate || 0) - (x.startDate || 0))[0]
    : null;

  /**
   * Opens the create form PRE-FILLED from the previous AT rather than defaulting the write.
   *
   * Deliberately not an inherited default applied at save time. An inherited value is MORE
   * dangerous than a placeholder: 4% is obviously unset, whereas last year's 8% looks
   * deliberate and would price a whole tender wrongly while appearing configured - the F1
   * shape exactly. Pre-filling puts the numbers on screen before the operator submits, so
   * they are chosen by the act of submitting rather than applied behind it, and the panel
   * says where they came from.
   */
  /**
   * THE AT THE SEED PANEL IS ABOUT, AS IT IS NOW — not as it was when created.
   *
   * `seedReport` is a snapshot taken at creation and held until dismissed. Everything it
   * says is therefore a claim about a moment that has passed, and one of those claims -
   * "this AT has no rates yet" - stopped being true the moment the operator saved rates,
   * while the panel went on asserting it (AUDIT F80).
   *
   * Reading the live document is what makes the panel describe the tender rather than the
   * event.
   */
  const seedAtNow = seedReportAtId ? atMasters.find(t => t.id === seedReportAtId) : undefined;
  const seedAtHasRates = Boolean((seedAtNow as any)?.ratesSource);

  /**
   * ⚠ THE WHOLE PANEL GOES ONCE THE TENDER IS SET UP.
   *
   * Both halves are creation-time facts. "Numbering continues from N" answers a question
   * asked once, at creation; "this AT has no rates" answers one that has now been answered.
   * A panel whose every statement is about a moment in the past, sitting permanently above a
   * configured tender, is a header that says nothing - and worse, one whose most prominent
   * line is false.
   *
   * It also disappears if the AT itself is gone: creating a tender and immediately deleting
   * it is what the delete button exists for.
   */
  const seedPanel = seedReport && seedAtNow && !seedAtHasRates && (
    <div className="p-4 rounded-xl border-2 border-indigo-200 bg-indigo-50/60 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-xs font-bold uppercase tracking-widest text-indigo-900">
          AT {seedReportAtNo} is ready &mdash; two things to know
        </h4>
        <button type="button" onClick={() => setSeedReport(null)}
          className="text-[11px] font-bold text-indigo-700 hover:text-indigo-900 shrink-0">Dismiss</button>
      </div>
      {Object.keys(seedReport.counters).length === 0 ? (
        <p className="text-[11px] text-indigo-900">
          No existing job numbers found for this agency, so numbering starts at 1.
        </p>
      ) : (
        <>
          <p className="text-[11px] text-indigo-900">
            Continues the agency's existing series - it does not restart. Scanned {seedReport.jobsScanned} job(s).
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(seedReport.counters).sort().map(([k, v]) => (
              <span key={k} className="px-2 py-0.5 rounded bg-white border border-indigo-200 text-[10px] font-mono text-indigo-900">
                {k}: next is {Number(v) + 1}
              </span>
            ))}
          </div>
        </>
      )}
      {/* THE SECOND FACT, AND THE ONE THAT BLOCKS WORK (AUDIT F74).
          This panel is the only thing shown at the moment an AT is created, and it used to
          say one thing: that job NUMBERING continues from the agency's series. Nothing
          anywhere in this component mentioned rates - so the operator was told about a
          counter they had not asked about, and not about the rate schedule that refuses
          every estimate and every bill they will try to produce against the new tender.

          The route out links to this same page with ?section=estimate-master, which the
          settings page consumes to EXPAND the collapsed rates section and scroll to it. */}
      {/* Gated on the LIVE document, not on the panel being open. Belt and braces with the
          condition above: if the panel is ever kept alive for another reason, this half must
          still not claim something that has stopped being true. */}
      {!seedAtHasRates && (
      <div className="p-2.5 rounded-lg bg-rose-100 border-2 border-rose-400 text-[11px] text-rose-900 leading-relaxed">
        <strong className="font-bold block uppercase tracking-wide">This AT has no rates yet.</strong>
        <p className="mt-1">
          A new tender starts with no rate schedule of its own, so <strong>estimates and bills
          against AT {seedReportAtNo} are blocked</strong> until it has one. Enter its rates, or copy
          them from a published AT.
        </p>
        {/* ?at=<id> SELECTS THE TENDER THAT WAS JUST CREATED.
            Without it the rates screen shows whichever AT is globally active, which is
            usually - but only usually - the new one: addAtMaster makes it active, and
            depending on that side effect staying true is how a button silently starts
            opening the wrong tender. The id is explicit (AUDIT F79). */}
        <Link
          to={`/agency-settings?section=estimate-master&at=${encodeURIComponent(seedReportAtId)}`}
          className="mt-2 inline-flex items-center px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold"
        >
          Set rates for AT {seedReportAtNo}
        </Link>
      </div>
      )}

      {/* THE "N JOB NUMBERS COULD NOT BE READ" WARNING IS DELETED (AUDIT F81).
          It reported a disagreement between two parsers rather than a problem with the
          data: the seeder's own rule rejected numbers that the rule deciding real job
          numbers reads perfectly well. There is now one reading - jobNoSequence - so there
          is nothing left to disagree about and nothing to report.

          Deleted rather than moved somewhere better, because "somewhere better" would have
          been a permanent warning about a value nothing reads: lastJobNumbers is advanced
          at save and consulted by nothing that numbers or prices anything, and it only ever
          moves upward, so a low counter corrects itself at the next save. */}
    </div>
  );

  const openAddForm = () => {
    if (carryOverSource) {
      setNewAt(prev => ({
        ...prev,
        atPercentageCRGO: String(carryOverSource.atPercentageCRGO ?? carryOverSource.atPercentage ?? 4),
        atPercentageAmorphous: String(carryOverSource.atPercentageAmorphous ?? carryOverSource.atPercentage ?? 4),
        atPercentageWoundCore: String(carryOverSource.atPercentageWoundCore ?? carryOverSource.atPercentage ?? 4),
      }));
    }
    setShowAddForm(true);
  };


  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAt.atNumber) return;
    // Guard the agency explicitly rather than writing `agencyId: activeAgency?.id || ''`.
    // That fallback produced an AT belonging to no agency - written successfully,
    // invisible everywhere. The context throws on an empty agencyId too; this catches it
    // before the round trip and says something more useful than a generic failure.
    if (!activeAgency?.id) {
      alert('Select an agency before creating an AT. An AT belongs to one agency, and one created without it would not appear under any.');
      return;
    }
    setIsSubmitting(true);
    try {
      const created = await addAtMaster({
        atNumber: newAt.atNumber,
        name: newAt.name,
        startDate: new Date(newAt.startDate).getTime(),
        endDate: new Date(newAt.endDate).getTime(),
        status: 'Active',
        agencyId: activeAgency.id,
        lastJobNumbers: {},
        atPercentage: Number(newAt.atPercentageCRGO) || 0,
        atPercentageCRGO: Number(newAt.atPercentageCRGO) || 0,
        atPercentageAmorphous: Number(newAt.atPercentageAmorphous) || 0,
        atPercentageWoundCore: Number(newAt.atPercentageWoundCore) || 0,
      });
      // Creating an AT is a clear signal of intent to work with it, so make it active.
      // The Divisions & Allotments panel renders only for the ACTIVE AT, so without this
      // a newly created AT showed a card with no way into its configuration.
      if (created?.id) setActiveAtMasterId(created.id);
      if (created?.seed) { setSeedReport(created.seed); setSeedReportAtNo(newAt.atNumber); setSeedReportAtId(created.id); }
      setShowAddForm(false);
      setNewAt({
        atNumber: '',
        name: '',
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0],
        atPercentageCRGO: '4',
        atPercentageAmorphous: '4',
        atPercentageWoundCore: '4',
      });
    } catch (err: any) {
      // Surface the real reason - the context throws a named error for an orphan AT.
      alert(err?.message || 'Failed to create AT Master');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartEdit = (at: AtMaster, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingAtId(at.id);
    setEditFormData({
      atNumber: at.atNumber || '',
      name: at.name || '',
      startDate: at.startDate ? new Date(at.startDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      endDate: at.endDate ? new Date(at.endDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      atPercentageCRGO: String(at.atPercentageCRGO ?? at.atPercentage ?? 4),
      atPercentageAmorphous: String(at.atPercentageAmorphous ?? at.atPercentage ?? 4),
      atPercentageWoundCore: String(at.atPercentageWoundCore ?? at.atPercentage ?? 4),
    });
  };

  const handleSaveEdit = async (atId: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!editFormData) return;
    setIsSubmitting(true);
    try {
      await updateAtMaster(atId, {
        atNumber: editFormData.atNumber,
        name: editFormData.name,
        startDate: editFormData.startDate ? new Date(editFormData.startDate).getTime() : Date.now(),
        endDate: editFormData.endDate ? new Date(editFormData.endDate).getTime() : Date.now(),
        atPercentage: Number(editFormData.atPercentageCRGO) || 0,
        atPercentageCRGO: Number(editFormData.atPercentageCRGO) || 0,
        atPercentageAmorphous: Number(editFormData.atPercentageAmorphous) || 0,
        atPercentageWoundCore: Number(editFormData.atPercentageWoundCore) || 0,
      });
      setEditingAtId(null);
      setEditFormData(null);
    } catch (err) {
      alert("Failed to update AT Period");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async (at: AtMaster) => {
    const newStatus = at.status === 'Active' ? 'Closed' : 'Active';
    try {
      await updateAtMaster(at.id, { status: newStatus });
    } catch (err) {
      alert("Failed to update status");
    }
  };

  if (!activeAgency) return null;

  return (
    <div className="bg-white p-6 rounded-xl shadow-xs border border-slate-200">
      {/* Header with Title and Minimize/Expand Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-lg shadow-xs shrink-0">
            <Briefcase className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">AT / Tender Periods</h2>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                {agencyAts.length} Periods
              </span>
            </div>
            <p className="text-xs text-slate-500">Manage tender contracts, validity dates & core type percentage markups</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all self-end sm:self-auto ${
            isExpanded 
              ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-300' 
              : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-200 shadow-2xs'
          }`}
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              <span>Minimise</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              <span>Expand & Manage</span>
            </>
          )}
        </button>
      </div>

      {/* Minimized Summary View */}
      {!isExpanded && (
        <div className="pt-3">
          {activeAtMaster ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900">{activeAtMaster.atNumber}</span>
                  {activeAtMaster.name && <span className="text-slate-500 font-normal">({activeAtMaster.name})</span>}
                  <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded font-bold text-[10px]">
                    Active
                  </span>
                </div>
                <div className="text-slate-500 text-[11px] flex items-center gap-2">
                  <span>{formatDDMMYYYY(activeAtMaster.startDate)} - {formatDDMMYYYY(activeAtMaster.endDate)}</span>
                  <span>•</span>
                  <span>CRGO: {activeAtMaster.atPercentageCRGO ?? activeAtMaster.atPercentage ?? 4}%</span>
                  <span>•</span>
                  <span>Amorphous: {activeAtMaster.atPercentageAmorphous ?? activeAtMaster.atPercentage ?? 4}%</span>
                  <span>•</span>
                  <span>Wound: {activeAtMaster.atPercentageWoundCore ?? activeAtMaster.atPercentage ?? 4}%</span>
                </div>
              </div>
              <span className="text-[11px] text-indigo-600 font-semibold self-end sm:self-center">
                Click "Expand & Manage" to edit or add periods
              </span>
            </div>
          ) : (
            <div className="text-xs text-slate-500 p-2">
              No AT period currently active. Click "Expand & Manage" to add or configure AT periods.
            </div>
          )}
        </div>
      )}

      {/* THE CARRY-FORWARD CONFIRMATION — the figure, and the tender it closes. */}
      {carryTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-5 sm:p-6 max-w-md w-full border border-indigo-200">
            <h3 className="text-base font-bold text-slate-900">
              Carry the oil balance into AT {carryTarget.to.atNumber || carryTarget.to.name}?
            </h3>
            <div className="mt-3 p-3 rounded-lg bg-indigo-50 border border-indigo-300">
              <div className="text-[11px] uppercase font-bold tracking-widest text-indigo-700">
                Closing balance of AT {carryTarget.from.atNumber || carryTarget.from.name}
              </div>
              {/* PER DIVISION, because that is what is carried and what is settled.
                  The total is shown too, and is what gets recorded as openingOilBalance -
                  a person confirms both (AUDIT F86). */}
              <div className="mt-1 space-y-0.5">
                {Object.entries(carryTarget.byDivision).sort(([a], [b]) => a.localeCompare(b)).map(([div, v]) => (
                  <div key={div} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="font-bold text-indigo-900">{div}</span>
                    <span className="font-mono font-black text-indigo-900">
                      {v >= 0 ? '+' : ''}{v.toFixed(2)} LTR
                    </span>
                  </div>
                ))}
                {Object.keys(carryTarget.byDivision).length === 0 && (
                  <div className="text-xs text-indigo-800">No division has any oil movement in this tender.</div>
                )}
              </div>
              <div className="mt-1.5 pt-1.5 border-t border-indigo-300 flex items-baseline justify-between gap-3">
                <span className="text-[11px] uppercase font-bold tracking-widest text-indigo-700">Agency total</span>
                <span className="font-mono font-black text-xl text-indigo-900">
                  {carryTarget.litres >= 0 ? '+' : ''}{carryTarget.litres.toFixed(2)} LTR
                </span>
              </div>
              <div className="text-[11px] text-indigo-800 mt-0.5">
                {carryTarget.litres > 0
                  ? 'The agency owes this much oil.'
                  : carryTarget.litres < 0 ? 'The agency is owed this much oil.' : 'The tender closes level.'}
                {' '}From {oilByAt[carryTarget.from.id]?.jobs ?? 0} job(s) and{' '}
                {oilByAt[carryTarget.from.id]?.txns ?? 0} transaction(s).
              </div>
            </div>

            {/* WHICH TENDER IS BEING CLOSED, said plainly - and whether it is still open.
                A tender still marked Active can move again after this is recorded, which
                does not make the figure wrong, only provisional. */}
            {String(carryTarget.from.status || '').toLowerCase() !== 'closed' && (
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg p-3 mt-3">
                <strong>AT {carryTarget.from.atNumber || carryTarget.from.name} is still marked Active.</strong>{' '}
                Its balance can change after this is recorded, and the figure carried here will not
                follow it. Mark it Closed first if it is finished.
              </p>
            )}

            <p className="text-[11px] text-slate-600 mt-3">
              This is recorded, not computed on the fly &mdash; it will not move if an old
              transaction is later edited. The source tender is stored with it so the number can
              be checked.
            </p>

            <div className="flex flex-col sm:flex-row justify-end gap-2 mt-4">
              <button type="button" onClick={() => setCarryTarget(null)} disabled={carrying}
                      className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-300">
                Cancel
              </button>
              <button type="button" onClick={runCarry} disabled={carrying}
                      className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50">
                {carrying ? 'Recording…' : `Record ${carryTarget.litres.toFixed(2)} LTR as the opening balance`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM — names what is about to go, and what it is not. */}
      {confirmDeleteAt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-5 sm:p-6 max-w-md w-full border border-rose-200">
            <div className="flex items-center gap-3 mb-3 text-rose-700">
              <div className="bg-rose-100 p-2.5 rounded-xl shrink-0"><Trash2 className="w-6 h-6" /></div>
              <h3 className="text-base font-bold text-slate-900">
                Delete AT {confirmDeleteAt.atNumber || confirmDeleteAt.name}?
              </h3>
            </div>
            <p className="text-sm text-slate-700">
              No jobs are booked under it, so there is no repair history to lose.
            </p>

            {/* ⚠ THE RATE SCHEDULE GOES WITH IT, SAID ON ITS OWN (AUDIT F80).
                This used to be the word "rates", fourth in a list of four, at the end of a
                sentence about prefixes and counters. Rates live ON the AT document now
                (F73), so deleting the tender deletes its whole schedule - and that is not
                something anyone infers from "delete this AT". Prefixes and counters are
                configuration; a rate schedule is a negotiated tender document that may have
                taken an afternoon to enter, or been copied from a published template that
                has since moved on. It gets its own block, with the counts. */}
            {(() => {
              const SECTIONS: Array<[string, string]> = [
                ['CRGO', 'estimateMasterCRGO'],
                ['Amorphous', 'estimateMasterAmorphous'],
                ['Wound Core', 'estimateMasterWoundCore'],
                ['Overhauling', 'estimateMasterOverhauling'],
                ['Circle Limits', 'estimateMasterCircleLimits'],
              ];
              const held = SECTIONS
                .map(([label, key]) => [label, ((confirmDeleteAt as any)[key] || []).length] as [string, number])
                .filter(([, n]) => n > 0);
              const src = String((confirmDeleteAt as any).ratesSource || '');
              if (held.length === 0) {
                return (
                  <p className="text-xs text-slate-600 mt-2">
                    It carries no rate schedule, so there are no rates to lose.
                  </p>
                );
              }
              return (
                <div className="mt-3 p-3 rounded-lg bg-amber-50 border-2 border-amber-300 text-xs text-amber-900">
                  <strong className="font-bold block">Its rate schedule goes with it.</strong>
                  <p className="mt-1">
                    Rates belong to a tender, so they are stored on this record and are deleted with it:
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {held.map(([label, n]) => (
                      <span key={label} className="px-2 py-0.5 rounded bg-white border border-amber-300 font-mono text-[10px]">
                        {label} — {n} row{n === 1 ? '' : 's'}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5">
                    {src === 'inherited-agency'
                      ? <>They came from the agency&rsquo;s own sections, so the same figures are still there
                         and a new tender would inherit them again.</>
                      : src.startsWith('published:')
                        ? <>They were copied from a published template, so they can be copied again &mdash;
                           though the template may have been revised since.</>
                        : <><strong>They were entered by hand for this tender and exist nowhere else.</strong>{' '}
                           Nothing recreates them.</>}
                  </p>
                </div>
              );
            })()}
            <p className="text-xs text-slate-600 mt-2">
              The check runs again on the server before anything is removed &mdash; if a job has been
              booked against this tender since this screen loaded, the delete is refused.
            </p>
            <div className="flex flex-col sm:flex-row justify-end gap-2 mt-4">
              <button type="button" onClick={() => setConfirmDeleteAt(null)}
                      className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-300">
                Cancel
              </button>
              <button type="button" onClick={() => runDelete(confirmDeleteAt)}
                      className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm">
                Delete this AT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* THE REFUSAL, AND THE MISSING-FUNCTION CASE, SAID PLAINLY.
          "not-deployed" is the one that must never read as a network blip: an operator
          would retry it forever. It names the state and offers the admin script, which
          performs the identical check and is not going anywhere (AUDIT F75, F77). */}
      {deleteError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-5 sm:p-6 max-w-lg w-full border border-rose-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3 mb-3 text-rose-700">
              <div className="bg-rose-100 p-2.5 rounded-xl shrink-0"><AlertTriangle className="w-6 h-6" /></div>
              <h3 className="text-base font-bold text-slate-900">{deleteError.title}</h3>
            </div>
            <p className="text-sm text-slate-700 whitespace-pre-line">{deleteError.message}</p>
            {deleteError.items.length > 0 && (
              <div className="mt-3 border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-48 overflow-y-auto">
                {deleteError.items.map((it, i) => (
                  <div key={i} className="px-3 py-1.5 text-xs font-mono text-slate-700">{it}</div>
                ))}
              </div>
            )}
            {deleteError.advice && (
              <p className="text-xs text-slate-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mt-3">
                {deleteError.advice}
              </p>
            )}
            <div className="flex justify-end mt-4">
              <button type="button" onClick={() => setDeleteError(null)}
                      className="px-4 py-2 text-xs font-bold text-white bg-slate-800 hover:bg-slate-900 rounded-lg">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expanded View */}
      {isExpanded && (
        <div className="pt-4 space-y-4">
          {agencyAts.length === 0 ? (
            <p className="text-sm text-slate-500 py-2">No AT periods defined yet for this agency.</p>
          ) : (
            <div className="space-y-3">
              {agencyAts.map(at => {
                const crgoVal = at.atPercentageCRGO ?? at.atPercentage ?? 4;
                const amVal = at.atPercentageAmorphous ?? at.atPercentage ?? 4;
                const wcVal = at.atPercentageWoundCore ?? at.atPercentage ?? 4;
                const isEditing = editingAtId === at.id;

                return (
                  <div key={at.id} className="space-y-2">
                    <div 
                      className={`p-4 border rounded-xl flex flex-col md:flex-row md:items-center justify-between cursor-pointer transition-colors gap-4 ${
                        activeAtMaster?.id === at.id ? 'border-indigo-500 bg-indigo-50/40 ring-1 ring-indigo-500/20' : 'border-slate-200 hover:border-indigo-300 bg-slate-50/30'
                      }`}
                      onClick={() => setActiveAtMasterId(at.id)}
                    >
                      {!isEditing ? (
                        <>
                          <div className="space-y-1">
                            <div className="flex items-center flex-wrap gap-2">
                              <h3 className="font-bold text-slate-900">{at.atNumber}</h3>
                              {at.name && <span className="text-slate-500 font-normal">- {at.name}</span>}
                              {activeAtMaster?.id === at.id ? (
                                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full flex items-center">
                                  <Check className="w-3 h-3 mr-1"/> Active AT
                                </span>
                              ) : (
                                /* The Divisions & Allotments panel renders only for the
                                   ACTIVE AT, and the only way in was an unlabelled click
                                   on a card that does not look clickable. Say so. */
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 bg-slate-100 border border-slate-300 px-2 py-0.5 rounded-full flex items-center">
                                  Select to configure divisions &amp; allotments
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                              <span className="flex items-center"><Calendar className="w-3.5 h-3.5 mr-1 text-slate-400" /> {formatDDMMYYYY(at.startDate)} to {formatDDMMYYYY(at.endDate)}</span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${at.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>
                                {at.status}
                              </span>
                            </div>
                            
                            {/* Core Type Percentages Breakdown */}
                            <div className="flex flex-wrap gap-2 pt-2 text-xs">
                              <span className="bg-white text-slate-800 px-2.5 py-1 rounded border border-slate-200 font-medium shadow-2xs">
                                <strong className="text-blue-700">CRGO:</strong> {crgoVal >= 0 ? `+${crgoVal}` : crgoVal}%
                              </span>
                              <span className="bg-white text-slate-800 px-2.5 py-1 rounded border border-slate-200 font-medium shadow-2xs">
                                <strong className="text-amber-700">Amorphous:</strong> {amVal >= 0 ? `+${amVal}` : amVal}%
                              </span>
                              <span className="bg-white text-slate-800 px-2.5 py-1 rounded border border-slate-200 font-medium shadow-2xs">
                                <strong className="text-emerald-700">Wound Core:</strong> {wcVal >= 0 ? `+${wcVal}` : wcVal}%
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2.5 self-end md:self-center">
                            <button 
                              onClick={(e) => handleStartEdit(at, e)}
                              className="flex items-center text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 px-2.5 py-1.5 rounded-lg shadow-2xs transition-colors"
                            >
                              <Edit2 className="w-3 h-3 mr-1" /> Edit
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleToggleStatus(at); }}
                              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-2.5 py-1.5 rounded-lg border border-indigo-100 transition-colors"
                            >
                              Mark as {at.status === 'Active' ? 'Closed' : 'Active'}
                            </button>
                            {/* DELETE APPEARS ONLY WHERE NOTHING IS BOOKED (AUDIT F77).
                                Absent - not disabled, not greyed - for an AT with jobs: a
                                disabled control still says "this is a thing you might do to
                                this tender", and for a live tender it is not.

                                Hiding it is not the guard. The callable re-queries and
                                refuses whatever this screen believed, because the count
                                behind `emptyAtIds` is stale the moment another tab saves an
                                intake. This decides what to show; the function decides what
                                happens. */}
                            {/* MORE THAN ONE TENDER MARKED ACTIVE (AUDIT F83).
                                isIntakeOpen handles it safely by taking the one with the
                                latest start date, so nothing breaks - but a data fault the
                                app can see and does not mention is one nobody fixes. UPENDRA
                                has exactly this in live data. */}
                            {(() => {
                              const others = otherActiveAts(at, agencyAts);
                              if (others.length === 0) return null;
                              return (
                                <span
                                  title="Only one tender should be Active at a time"
                                  className="text-[11px] font-bold text-amber-900 bg-amber-50 border border-amber-300 px-2.5 py-1.5 rounded-lg max-w-xs"
                                >
                                  Also Active: {others.map(o => o.atNumber || o.name).join(', ')} &mdash;
                                  new work goes to whichever started latest
                                </span>
                              );
                            })()}
                            {/* CARRY THE PREVIOUS TENDER'S CLOSING BALANCE IN (AUDIT F82).
                                A SEPARATE ACT, deliberately not part of creating the AT: at
                                creation the operator is naming a tender and setting dates,
                                and an oil balance appearing in that flow is a number they
                                would confirm without reading. Here it is a decision.

                                REPEATABLE-SAFE: once carried, the card says so and does not
                                offer it again. Re-carrying after a correction is possible
                                through the same action only because the stamp records when
                                it last happened. */}
                            {(() => {
                              const carried = Number((at as any).openingOilBalance);
                              if (Number.isFinite(carried)) {
                                const src = atMasters.find(x => x.id === (at as any).openingOilBalanceFromAtId);
                                return (
                                  <span
                                    title={`Carried from AT ${src?.atNumber || src?.name || '(unknown)'} — ` +
                                      Object.entries(((at as any).openingOilBalanceByDivision || {}) as Record<string, number>)
                                        .map(([d, v]) => `${d} ${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}`)
                                        .join(', ')}
                                    className="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-lg"
                                  >
                                    Opening oil {carried >= 0 ? '+' : ''}{carried.toFixed(2)} L
                                    {Object.keys(((at as any).openingOilBalanceByDivision || {})).length > 0 &&
                                      ` (${Object.keys((at as any).openingOilBalanceByDivision).length} div)`}
                                  </span>
                                );
                              }
                              const prev = previousAtFor(at);
                              const bal = prev ? oilByAt[prev.id] : undefined;
                              if (!prev || !bal) return null;
                              return (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setCarryTarget({ to: at, from: prev, litres: bal.net, byDivision: bal.byDivision }); }}
                                  className="text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2.5 py-1.5 rounded-lg"
                                >
                                  Carry oil from {prev.atNumber || prev.name}
                                </button>
                              );
                            })()}
                            {emptyAtIds.has(at.id) && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteAt(at); }}
                                disabled={deletingAtId === at.id}
                                title="No jobs are booked under this AT, so it can be removed"
                                className="flex items-center text-xs font-bold text-rose-700 hover:text-rose-900 bg-rose-50 hover:bg-rose-100 px-2.5 py-1.5 rounded-lg border border-rose-200 transition-colors disabled:opacity-50"
                              >
                                {deletingAtId === at.id
                                  ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  : <Trash2 className="w-3 h-3 mr-1" />}
                                Delete
                              </button>
                            )}
                          </div>
                        </>
                      ) : (
                        <form onClick={e => e.stopPropagation()} onSubmit={e => handleSaveEdit(at.id, e)} className="w-full space-y-3 bg-white p-4 rounded-xl border border-indigo-300 shadow-xs">
                          <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-800">Edit AT / Tender Period</h4>
                            <button type="button" onClick={() => { setEditingAtId(null); setEditFormData(null); }} className="text-slate-400 hover:text-slate-600">
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-0.5">AT Number</label>
                              <input required type="text" value={editFormData?.atNumber || ''} onChange={e => setEditFormData(prev => prev ? {...prev, atNumber: e.target.value} : null)} className="w-full px-2.5 py-1.5 text-xs border rounded-lg focus:ring-1 focus:ring-indigo-500" />
                            </div>
                            <div>
                              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-0.5">Description (Optional)</label>
                              <input type="text" value={editFormData?.name || ''} onChange={e => setEditFormData(prev => prev ? {...prev, name: e.target.value} : null)} className="w-full px-2.5 py-1.5 text-xs border rounded-lg focus:ring-1 focus:ring-indigo-500" />
                            </div>
                            <div>
                              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-0.5">Start Date</label>
                              <input required type="date" value={editFormData?.startDate || ''} onChange={e => setEditFormData(prev => prev ? {...prev, startDate: e.target.value} : null)} className="w-full px-2.5 py-1.5 text-xs border rounded-lg focus:ring-1 focus:ring-indigo-500" />
                            </div>
                            <div>
                              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-0.5">End Date</label>
                              <input required type="date" value={editFormData?.endDate || ''} onChange={e => setEditFormData(prev => prev ? {...prev, endDate: e.target.value} : null)} className="w-full px-2.5 py-1.5 text-xs border rounded-lg focus:ring-1 focus:ring-indigo-500" />
                            </div>
                          </div>

                          <div className="border-t border-slate-100 pt-2 mt-2">
                            <label className="block text-[10px] uppercase font-bold text-slate-600 mb-1.5">Estimate % Above (+) or Below (-) per Core Type</label>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div className="bg-slate-50 p-2 rounded-lg border border-slate-200">
                                <label className="block text-[9px] uppercase font-bold text-slate-700 mb-1">CRGO Core %</label>
                                <input required type="number" step="0.01" value={editFormData?.atPercentageCRGO ?? ''} onChange={e => setEditFormData(prev => prev ? {...prev, atPercentageCRGO: e.target.value} : null)} className="w-full px-2 py-1 text-xs border rounded font-semibold bg-white" placeholder="e.g. 4 or -2.5" />
                                {editFormData && atPercentageHint(editFormData.atPercentageCRGO) && (
                                  <span className="block mt-0.5 text-[9px] text-slate-500">{atPercentageHint(editFormData.atPercentageCRGO)}</span>
                                )}
                              </div>
                              <div className="bg-slate-50 p-2 rounded-lg border border-slate-200">
                                <label className="block text-[9px] uppercase font-bold text-slate-700 mb-1">Amorphous Core %</label>
                                <input required type="number" step="0.01" value={editFormData?.atPercentageAmorphous ?? ''} onChange={e => setEditFormData(prev => prev ? {...prev, atPercentageAmorphous: e.target.value} : null)} className="w-full px-2 py-1 text-xs border rounded font-semibold bg-white" placeholder="e.g. 4 or -2.5" />
                                {editFormData && atPercentageHint(editFormData.atPercentageAmorphous) && (
                                  <span className="block mt-0.5 text-[9px] text-slate-500">{atPercentageHint(editFormData.atPercentageAmorphous)}</span>
                                )}
                              </div>
                              <div className="bg-slate-50 p-2 rounded-lg border border-slate-200">
                                <label className="block text-[9px] uppercase font-bold text-slate-700 mb-1">Wound Core %</label>
                                <input required type="number" step="0.01" value={editFormData?.atPercentageWoundCore ?? ''} onChange={e => setEditFormData(prev => prev ? {...prev, atPercentageWoundCore: e.target.value} : null)} className="w-full px-2 py-1 text-xs border rounded font-semibold bg-white" placeholder="e.g. 4 or -2.5" />
                                {editFormData && atPercentageHint(editFormData.atPercentageWoundCore) && (
                                  <span className="block mt-0.5 text-[9px] text-slate-500">{atPercentageHint(editFormData.atPercentageWoundCore)}</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex justify-end space-x-2 pt-2">
                            <button type="button" onClick={() => { setEditingAtId(null); setEditFormData(null); }} className="px-3 py-1.5 text-xs font-bold uppercase text-slate-500 hover:bg-slate-100 rounded-lg">Cancel</button>
                            <button type="submit" disabled={isSubmitting} className="flex items-center px-3.5 py-1.5 text-xs font-bold uppercase bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                              {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />} Save Changes
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                    
                    {/* Combined Details (Divisions & Prefixes + Allotment Quotas) for this active AT */}
                    {activeAtMaster?.id === at.id && !isEditing && (
                      <div className="border border-t-0 border-indigo-300 bg-white p-4 rounded-b-xl space-y-4 shadow-xs">
                        {/* Sub-tabs to seamlessly switch between Divisions & Prefixes and Allotment Quotas */}
                        <div className="flex border-b border-slate-200">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setActiveAtTab('divisions'); }}
                            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold border-b-2 transition-all ${
                              activeAtTab === 'divisions'
                                ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
                                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <Layers className="w-3.5 h-3.5" />
                            <span>Divisions & Core Prefixes</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setActiveAtTab('allotments'); }}
                            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold border-b-2 transition-all ${
                              activeAtTab === 'allotments'
                                ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50'
                                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>Allotment Quotas & Letters</span>
                          </button>
                        </div>

                        {/* Active Tab Content */}
                        <div onClick={e => e.stopPropagation()} className="pt-1">
                          {activeAtTab === 'divisions' ? (
                            <AtDivisions at={at} />
                          ) : (
                            <AtAllotments at={at} />
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Add Form & Buttons */}
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="px-3.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Minimise Table
            </button>

            {!showAddForm ? (
              <button 
                onClick={openAddForm} 
                className="flex items-center px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add AT Period
              </button>
            ) : null}
          </div>

          {seedPanel}

      {showAddForm && (
            <form onSubmit={handleAdd} className="space-y-4 bg-slate-50 p-4 border border-indigo-200 rounded-xl">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <h4 className="text-xs font-bold uppercase text-indigo-900">Create New AT / Tender Period</h4>
                <button type="button" onClick={() => setShowAddForm(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">AT Number</label>
                  <input required type="text" value={newAt.atNumber} onChange={e => setNewAt({...newAt, atNumber: e.target.value})} className="w-full px-3 py-2 text-xs border rounded-lg bg-white" placeholder="e.g. AT-2026-27" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Description (Optional)</label>
                  <input type="text" value={newAt.name} onChange={e => setNewAt({...newAt, name: e.target.value})} className="w-full px-3 py-2 text-xs border rounded-lg bg-white" placeholder="e.g. Annual Tender" />
                </div>
                {carryOverSource && (
                  <div className="sm:col-span-2 p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-[11px] text-amber-900 leading-relaxed">
                    <strong className="font-bold">AT percentages below are carried over from {carryOverSource.atNumber || 'the previous AT'}.</strong>{' '}
                    They are a starting point, not defaults - check them against the new tender before creating.
                    A carried-over percentage prices every estimate under this AT and looks deliberate whether it is or not.
                  </div>
                )}
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Start Date</label>
                  <input required type="date" value={newAt.startDate} onChange={e => setNewAt({...newAt, startDate: e.target.value})} className="w-full px-3 py-2 text-xs border rounded-lg bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">End Date</label>
                  <input required type="date" value={newAt.endDate} onChange={e => setNewAt({...newAt, endDate: e.target.value})} className="w-full px-3 py-2 text-xs border rounded-lg bg-white" />
                </div>
              </div>

              <div className="border-t border-slate-200 pt-3">
                <label className="block text-xs font-bold uppercase text-slate-600 mb-2">Estimate % Above (+) or Below (-) per Core Type</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                    <label className="block text-xs font-bold text-slate-700 mb-1">CRGO Core %</label>
                    <input required type="number" step="0.01" value={newAt.atPercentageCRGO} onChange={e => setNewAt({...newAt, atPercentageCRGO: e.target.value})} className="w-full px-3 py-1.5 text-xs border rounded font-semibold bg-slate-50" placeholder="e.g. 4 or -2.5" />
                    {atPercentageHint(newAt.atPercentageCRGO) && (
                      <span className="block mt-0.5 text-[10px] text-slate-500">{atPercentageHint(newAt.atPercentageCRGO)}</span>
                    )}
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                    <label className="block text-xs font-bold text-slate-700 mb-1">Amorphous Core %</label>
                    <input required type="number" step="0.01" value={newAt.atPercentageAmorphous} onChange={e => setNewAt({...newAt, atPercentageAmorphous: e.target.value})} className="w-full px-3 py-1.5 text-xs border rounded font-semibold bg-slate-50" placeholder="e.g. 4 or -2.5" />
                    {atPercentageHint(newAt.atPercentageAmorphous) && (
                      <span className="block mt-0.5 text-[10px] text-slate-500">{atPercentageHint(newAt.atPercentageAmorphous)}</span>
                    )}
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                    <label className="block text-xs font-bold text-slate-700 mb-1">Wound Core %</label>
                    <input required type="number" step="0.01" value={newAt.atPercentageWoundCore} onChange={e => setNewAt({...newAt, atPercentageWoundCore: e.target.value})} className="w-full px-3 py-1.5 text-xs border rounded font-semibold bg-slate-50" placeholder="e.g. 4 or -2.5" />
                    {atPercentageHint(newAt.atPercentageWoundCore) && (
                      <span className="block mt-0.5 text-[10px] text-slate-500">{atPercentageHint(newAt.atPercentageWoundCore)}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 text-xs font-bold uppercase text-slate-500 hover:bg-slate-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-xs font-bold uppercase bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save AT Period'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}


