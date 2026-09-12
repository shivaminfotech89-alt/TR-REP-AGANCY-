import React, { useState, useEffect } from 'react';
import { formatDDMMYYYY } from '../lib/utils';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, getDocs, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { useAgency, Agency } from '../lib/AgencyContext';
import {
  defaultEstimateData, defaultAmorphousEstimateData, defaultWoundCoreEstimateData,
  defaultOverhaulingEstimateData, defaultCircleLimitsEstimateData,
} from '../lib/estimateData';
import { selectableSchedules, SCHEDULES, ScheduleId } from '../lib/ugvclSchedules';
import { CARD, CARD_PAD } from '../lib/ui';
import { formatPrice, gstBreakdown } from '../lib/pricing';
import {
  classifySubscription, daysRemaining, type SubscriptionRecord,
} from '../lib/subscriptionStatus';
import { SubscriptionActions } from './SubscriptionActions';
import { deleteIfEmpty, GuardedDeleteError, type DeleteBlocker } from '../lib/guardedDelete';
import { countContents, filterAgencies, holdsNothing, statusCounts, type StatusFilter } from '../lib/adminAgencyFilter';
import { runLiveGatewayCheck } from '../lib/adminSubscription';
import { CheckoutDismissed, PaymentTakenButUnverified, GatewayDeclined } from '../lib/subscriptionClient';
import { SupportTicket, TicketStatus, UserRoleRecord, UserRoleType, RazorpaySettings, SystemSettings } from '../types/admin';
import { 
  ShieldCheck, Users, Building2, CreditCard, LifeBuoy, Settings, 
  RefreshCw, Search, CheckCircle2, AlertTriangle, Clock, PlusCircle, 
  Trash2, Lock, Key, DollarSign, Sparkles, MessageSquare, Send, Check, AlertCircle, ToggleLeft, ToggleRight, Database
, Loader2 } from 'lucide-react';

export default function AdminPanel() {
  // ⚠ `updateAgency` is deliberately NOT destructured here (AUDIT G1). AdminPanel's agency
  // list is an unfiltered read across every account, so any writer reached from this screen
  // is a cross-account write by construction. Leaving the function in scope is leaving the
  // hazard one line from being used again.
  const { agencies, publishedAts, atMasters, publishAtTemplate } = useAgency();
  const currentUser = auth.currentUser;
  const isSuperAdminEmail = currentUser?.email === 'shivaminfotech89@gmail.com';

  /**
   * ⚠ DEFAULTS TO 'templates', WHICH IS THE LEAST-USED TAB. Deliberate: it is the only one
   * that is a JOB rather than a place to look something up, and an admin opens this screen in
   * order to publish a tender template. Landing on the reason for visiting.
   *
   * No `?tab=` deep link. Nothing in the app links into the Admin Panel at all - the sidebar
   * entry is the only way in - so there is no caller to serve. The estimate screen gained one
   * this session because the Dashboard's follow-up tiles needed to land on a stage; if a link
   * ever wants one here, that is the shape to copy. AUDIT O54.
   */
  const [activeTab, setActiveTab] = useState<'templates' | 'agencies' | 'users' | 'tickets' | 'razorpay' | 'system'>('templates');

  /**
   * AUTHORING A RATE TEMPLATE, WITH NO AGENCY AND NO AT.
   *
   * Publishing used to be reachable only from Estimate Master, which requires an agency
   * (`EstimateMaster.tsx:608`) and an AT under it, with all five schedules already typed in.
   * So the administrator had to create an agency and a tender of their own purely to have
   * somewhere for the rates to sit before they could be published - and the template then
   * carried whatever that AT happened to hold.
   *
   * ⚠ THE RATES ARE SEEDED FROM THE SHIPPED TRANSCRIPTION, NOT TYPED. `estimateData.ts` is
   * the UGVCL schedule as transcribed from the tender document, and the evidence says a new
   * tender does not reprice it: the schedule has been transcribed once and never revised,
   * and four of the five sections are byte-identical across every AT and agency in the
   * database - spanning periods labelled 2020-21, 24-25, 26-27 and 2026-28. Repricing is
   * carried by the AT percentage, which is per-tender AND per-agency.
   *
   * A figure that genuinely differs is corrected afterwards in Estimate Master and
   * republished as a new version. That keeps ONE rate grid in the app: a second one here
   * would be the second implementation this codebase keeps retiring.
   */
  const [showTplForm, setShowTplForm] = useState(false);
  const [tplTargetId, setTplTargetId] = useState('');
  const [tplName, setTplName] = useState('');
  const [tplAtNumber, setTplAtNumber] = useState('');
  const [tplNotes, setTplNotes] = useState('');
  const [tplStart, setTplStart] = useState('');
  /**
   * WHICH UGVCL SCHEDULE THIS TEMPLATE IS PUBLISHED AGAINST.
   *
   * ⚠ NO DEFAULT. It decides what every job under every adopting AT costs, and the two
   * schedules differ on 255 of Schedule-A's 306 cells - a pre-selected value would be a
   * pricing decision nobody made, the same argument that emptied the AT percentages.
   *
   * Offers only COMPLETE schedules. An incomplete one prices nothing and blocks every AT
   * that names it, so publishing a template against one would produce a template that
   * cannot be used - a failure discovered by the adopting agency rather than here.
   */
  const [tplScheduleId, setTplScheduleId] = useState<string>('');
  /** The tender's accepted percentage - ONE figure for every core type. Optional. */
  const [tplPct, setTplPct] = useState('');
  const [tplEnd, setTplEnd] = useState('');
  const [tplSaving, setTplSaving] = useState(false);
  const [tplMsg, setTplMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const resetTplForm = () => {
    setTplTargetId(''); setTplName(''); setTplAtNumber(''); setTplNotes('');
    setTplStart(''); setTplEnd(''); setTplScheduleId('');
  };

  const handlePublishNewTemplate = async () => {
    if (!tplName.trim()) {
      alert('Give the template a name operators will recognise, e.g. "UGVCL 2026-28 Schedule A".');
      return;
    }
    if (!tplScheduleId) {
      alert(
        'Choose the UGVCL schedule this template is published against.\n\n'
        + 'It travels with the rates onto every AT that adopts this template, and decides what every '
        + 'item on every job under those tenders costs. A template without one leaves the adopting AT '
        + 'to fall back to whichever schedule its form defaulted to.'
      );
      return;
    }
    setTplSaving(true);
    try {
      // ALL FIVE SECTIONS, ALWAYS. publishAtTemplate refuses a partial template by name,
      // and a partial one would produce an AT that is a mixture labelled as though it all
      // came from one place.
      const id = await publishAtTemplate(
        {
          id: tplTargetId || undefined,
          name: tplName.trim(),
          atNumber: tplAtNumber.trim(),
          notes: tplNotes.trim(),
          startDate: tplStart ? new Date(tplStart).getTime() : undefined,
          endDate: tplEnd ? new Date(tplEnd).getTime() : undefined,
          scheduleId: tplScheduleId,
          atPercentage: tplPct.trim() === '' ? undefined : Number(tplPct),
        },
        {
          estimateMasterCRGO: JSON.parse(JSON.stringify(defaultEstimateData)),
          estimateMasterAmorphous: JSON.parse(JSON.stringify(defaultAmorphousEstimateData)),
          estimateMasterWoundCore: JSON.parse(JSON.stringify(defaultWoundCoreEstimateData)),
          estimateMasterOverhauling: JSON.parse(JSON.stringify(defaultOverhaulingEstimateData)),
          estimateMasterCircleLimits: JSON.parse(JSON.stringify(defaultCircleLimitsEstimateData)),
        },
      );
      const tpl = publishedAts.find(t => t.id === id);
      setTplMsg(
        `Published "${tplName.trim()}"${tpl ? ` v${tpl.version}` : ''}. `
        + `Any agency can now select it when creating an AT, or copy it onto an existing one from Estimate Master. `
        + `Nobody's existing rates changed.`
      );
      setShowTplForm(false);
      resetTplForm();
      setTimeout(() => setTplMsg(null), 10000);
    } catch (err: any) {
      console.error(err);
      alert(err?.message || 'Could not publish the template. Nothing was written.');
    } finally {
      setTplSaving(false);
    }
  };

  // Firestore Data State
  const [allAgencies, setAllAgencies] = useState<Agency[]>([]);
  const [userRoles, setUserRoles] = useState<UserRoleRecord[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  /**
   * ⚠ THE REAL SUBSCRIPTIONS, READ FROM THE COLLECTION (AUDIT G34). This table used to hardcode
   * NOT BILLED on every row and never open `subscriptions` at all. That was TRUE when it was
   * written - nothing had been billed - and it stopped being true the moment the first payment
   * landed, with no code change to mark the transition.
   *
   * It is the same shape as the defect it replaced (G28): a screen asserting something about
   * state it is not reading. That one overstated - twelve agencies shown as ACTIVE PAID - and
   * this one understated. Understating is safer and is still an assertion made without looking.
   *
   * `null` distinguishes NOT YET LOADED from LOADED AND EMPTY. Rendering "not billed" while a
   * read is in flight would reintroduce the same lie for a second per page load.
   */
  const [subsByAgency, setSubsByAgency] = useState<Record<string, SubscriptionRecord> | null>(null);
  const [subActionNote, setSubActionNote] = useState<string | null>(null);
  /** Bumped after an admin action so the rows re-read rather than showing what they showed. */
  const [subReload, setSubReload] = useState(0);
  const [gatewayCheck, setGatewayCheck] = useState<
    { kind: 'busy' | 'ok' | 'bad'; text: string } | null
  >(null);
  const [razorpaySettings, setRazorpaySettings] = useState<RazorpaySettings>({
    enabled: true,
    testMode: true,
    keyId: '',
  });
  const [systemSettings, setSystemSettings] = useState<SystemSettings>({
    maintenanceMode: false,
    maintenanceMessage: 'System undergoes scheduled maintenance. Normal ops resume shortly.',
    announcementBanner: '',
    announcementActive: true,
    superAdminEmail: 'shivaminfotech89@gmail.com'
  });

  // UI state for search & modals
  const [searchTerm, setSearchTerm] = useState('');
  const [ticketStatusFilter, setTicketStatusFilter] = useState<string>('ALL');

  /**
   * FINDING AN AGENCY, AND SEEING WHAT IT HOLDS (AUDIT G73). Seventeen agencies across ten owners, listed
   * unfiltered and saying nothing about their contents.
   *
   * ⚠ THE CONTENTS COLUMN IS THE DELETE GUARD'S OWN QUESTION, ASKED BEFORE THE BUTTON IS PRESSED. `deleteIfEmpty`
   * refuses an agency that still has ATs or jobs; showing both counts makes the refusal predictable instead of a
   * surprise. It does NOT promise a delete will succeed - the server also refuses on inspections, oil and a payment,
   * none of which this row can see.
   */
  const [agencySearch, setAgencySearch] = useState('');
  const [agencyStatus, setAgencyStatus] = useState<StatusFilter>('ALL');
  const [onlyEmptyAgencies, setOnlyEmptyAgencies] = useState(false);
  /** Every AT and job on the system - the vendor's view, not the signed-in owner's. See the fetch. */
  const [adminAts, setAdminAts] = useState<Array<{ agencyId?: string }>>([]);
  const [adminJobs, setAdminJobs] = useState<Array<{ agencyId?: string }>>([]);
  const [deletingAgencyId, setDeletingAgencyId] = useState<string | null>(null);
  const [agencyDeleteNote, setAgencyDeleteNote] = useState<
    { kind: 'ok' | 'bad'; text: string; blockers?: DeleteBlocker[]; advice?: string } | null
  >(null);
  
  // Ticket Reply Drawer
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [replyText, setReplyText] = useState('');
  const [newStatus, setNewStatus] = useState<TicketStatus>('In Progress');
  const [replySubmitting, setReplySubmitting] = useState(false);

  // User Role Add/Edit Modal
  const [showUserModal, setShowUserModal] = useState(false);
  const [userModalEmail, setUserModalEmail] = useState('');
  const [userModalRole, setUserModalRole] = useState<UserRoleType>('manager');
  const [userModalAgencyId, setUserModalAgencyId] = useState('');

  // Fetch all admin data
  const fetchAdminData = async () => {
    if (!isSuperAdminEmail) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // 1. Fetch Agencies
      const agSnap = await getDocs(collection(db, 'agencies'));
      const agList = agSnap.docs.map(d => ({ id: d.id, ...d.data() } as Agency));
      setAllAgencies(agList.length > 0 ? agList : agencies);

      /**
       * 1b. WHAT SITS UNDER EACH AGENCY - read across every account, which only this screen may do.
       *
       * ⚠ NOT `atMasters` FROM useAgency(): that list is the SIGNED-IN OWNER'S, fetched by ownerId, so every other
       * owner's agency would show 0 ATs and read as empty - a count that is wrong in the direction that invites a
       * delete. The rules allow a super admin to list both collections unfiltered.
       */
      try {
        const [atSnap, jobSnap] = await Promise.all([
          getDocs(collection(db, 'atMasters')),
          getDocs(collection(db, 'jobs')),
        ]);
        setAdminAts(atSnap.docs.map(d => d.data() as { agencyId?: string }));
        setAdminJobs(jobSnap.docs.map(d => d.data() as { agencyId?: string }));
      } catch (e) {
        // Left empty on failure - and the Contents column says so rather than printing 0, which would read as
        // "holds nothing" on the strength of a failed read (AUDIT G34, G70).
        console.warn('admin contents read failed', e);
        setAdminAts([]);
        setAdminJobs([]);
      }

      // 2. Fetch User Roles
      const roleSnap = await getDocs(collection(db, 'user_roles'));
      const roleList = roleSnap.docs.map(d => ({ id: d.id, ...d.data() } as UserRoleRecord));
      setUserRoles(roleList);

      // 3. Fetch Support Tickets
      const ticketSnap = await getDocs(collection(db, 'support_tickets'));
      const tktList = ticketSnap.docs.map(d => ({ id: d.id, ...d.data() } as SupportTicket));
      tktList.sort((a, b) => b.createdAt - a.createdAt);
      setTickets(tktList);

      // 4. Fetch System Settings if present
      // Super admin may list `subscriptions` (firestore.rules); no client may write it.
      try {
        const subSnap = await getDocs(collection(db, 'subscriptions'));
        const map: Record<string, SubscriptionRecord> = {};
        subSnap.forEach(d => { map[d.id] = d.data() as SubscriptionRecord; });
        setSubsByAgency(map);
      } catch (e) {
        // ⚠ LEFT AS null ON FAILURE, WHICH RENDERS "not read" RATHER THAN "not billed". A
        // failed read must not be reported as an absence of subscriptions.
        console.warn('subscriptions read failed', e);
        setSubsByAgency(null);
      }

      const sysSnap = await getDocs(collection(db, 'system_config'));
      sysSnap.docs.forEach(doc => {
        if (doc.id === 'razorpay') setRazorpaySettings(doc.data() as RazorpaySettings);
        if (doc.id === 'general') setSystemSettings(doc.data() as SystemSettings);
      });

    } catch (err) {
      console.error('Error loading admin data:', err);
      // Fallback gracefully without breaking UI
      setLoading(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, [currentUser?.email, subReload]);

  if (!isSuperAdminEmail) {
    return (
      <div className="max-w-3xl mx-auto my-12 bg-white rounded-lg border border-slate-200 p-8 text-center space-y-4">
        <div className="w-16 h-16 bg-amber-100 border border-amber-300 rounded-full flex items-center justify-center mx-auto text-amber-600">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black text-slate-900">Super Admin Access Restricted</h2>
        <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
          The Super Admin Command Center and Razorpay Subscription Gateway control panel is reserved exclusively for <strong className="text-blue-700">shivaminfotech89@gmail.com</strong>.
        </p>
        <div className="pt-2">
          <span className="text-[11px] text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg border inline-block">
            Logged in as: <strong className="text-slate-800">{currentUser?.email || 'Guest'}</strong>
          </span>
        </div>
      </div>
    );
  }

  /**
   * ⚠ THE SUBSCRIPTION WRITER IS REMOVED, NOT COMMENTED OUT (AUDIT G1).
   *
   * It called `updateAgency` against `allAgencies`, which is an UNFILTERED read of every
   * agency on every account - so it wrote to customers' documents. The rules no longer allow
   * that, and the fields it wrote were read by nothing anywhere in the codebase (O34): an
   * admin set an expiry, saw a confirmation, and no screen or gate ever consulted it.
   *
   * When subscription is built for real it belongs in a VENDOR-OWNED collection keyed by
   * agency id - never as fields on the agency document. That is what lets the vendor hold
   * its own commercial data without holding write access to the customer's records, and it
   * is the reason the rules could be tightened before the billing work rather than after.
   *
   * Deleted rather than left dormant because a cross-account write path one call site away
   * from being reused is exactly what this change exists to remove.
   */

  // --- USER ROLE ACTIONS ---
  const handleSaveUserRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userModalEmail.trim()) return;

    try {
      const docId = userModalEmail.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      const payload: UserRoleRecord = {
        id: docId,
        email: userModalEmail.trim().toLowerCase(),
        role: userModalRole,
        agencyId: userModalAgencyId || 'all',
        agencyName: allAgencies.find(a => a.id === userModalAgencyId)?.name || 'All Agencies',
        status: 'active',
        updatedAt: Date.now(),
        updatedBy: currentUser?.email || 'admin'
      };

      await setDoc(doc(db, 'user_roles', docId), payload);
      alert(`User ${userModalEmail} role updated to ${userModalRole.toUpperCase()}`);
      setShowUserModal(false);
      setUserModalEmail('');
      fetchAdminData();
    } catch (err) {
      console.error('Error saving user role:', err);
      alert('Failed to update user role.');
    }
  };

  const handleToggleUserStatus = async (roleRecord: UserRoleRecord) => {
    try {
      const newStatus = roleRecord.status === 'active' ? 'suspended' : 'active';
      await updateDoc(doc(db, 'user_roles', roleRecord.id), { status: newStatus, updatedAt: Date.now() });
      fetchAdminData();
    } catch (err) {
      console.error('Error toggling user status:', err);
    }
  };

  // --- TICKET REPLY ACTIONS ---
  const handleReplyTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !replyText.trim()) return;

    setReplySubmitting(true);
    try {
      const now = Date.now();
      const ticketRef = doc(db, 'support_tickets', selectedTicket.id);
      await updateDoc(ticketRef, {
        adminReply: replyText.trim(),
        repliedAt: now,
        repliedBy: currentUser?.email || 'shivaminfotech89@gmail.com',
        status: newStatus,
        updatedAt: now
      });

      alert(`Reply saved and ticket status updated to ${newStatus}!`);
      setSelectedTicket(null);
      setReplyText('');
      fetchAdminData();
    } catch (err) {
      console.error('Error replying to ticket:', err);
      alert('Failed to send reply.');
    } finally {
      setReplySubmitting(false);
    }
  };

  // --- SYSTEM & RAZORPAY CONFIG ACTIONS ---
  const handleSaveRazorpayConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setDoc(doc(db, 'system_config', 'razorpay'), razorpaySettings);
      alert('Razorpay settings saved.');
    } catch (err) {
      console.error('Error saving Razorpay settings:', err);
      alert('Failed to save settings.');
    }
  };

  const handleSaveSystemSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setDoc(doc(db, 'system_config', 'general'), {
        ...systemSettings,
        updatedAt: Date.now()
      });
      alert('Global Web App & Maintenance settings updated!');
    } catch (err) {
      console.error('Error saving system settings:', err);
      alert('Failed to update settings.');
    }
  };

  // ---- AGENCY LIST: contents, filtering, and the guarded delete (AUDIT G73) ----------------------------------
  const contentsOf = (agencyId: string) => countContents(agencyId, adminAts, adminJobs);
  const ownerEmailOf = (a: { id: string }) => (subsByAgency ? subsByAgency[a.id]?.ownerEmail : undefined);
  const agencyStatusCounts = statusCounts(allAgencies, subsByAgency, Date.now());
  const visibleAgencies = filterAgencies({
    agencies: allAgencies,
    subsByAgency,
    contentsOf,
    ownerEmailOf,
    term: agencySearch,
    status: agencyStatus,
    onlyEmpty: onlyEmptyAgencies,
    now: Date.now(),
  }) as Agency[];

  const removeAgency = async (agency: Agency) => {
    const contents = contentsOf(agency.id);
    const sub = subsByAgency ? (subsByAgency[agency.id] ?? null) : null;
    const cls = classifySubscription(sub, Date.now());
    const ok = window.confirm(
      `Delete "${agency.name || '(unnamed)'}"?\n\n`
      + `It holds ${contents.ats} tender(s) and ${contents.jobs} job(s).\n`
      + (sub && !cls.wasPaid ? `Its ${cls.word.toLowerCase()} subscription record goes with it.\n` : '')
      + `\nThe server refuses if anything is found beneath it, including inspections, oil records or a payment. `
      + `This cannot be undone.`);
    if (!ok) return;
    setDeletingAgencyId(agency.id);
    setAgencyDeleteNote(null);
    try {
      const res = await deleteIfEmpty('agencies', agency.id);
      setAllAgencies(prev => prev.filter(a => a.id !== agency.id));
      setAgencyDeleteNote({
        kind: 'ok',
        text: `Deleted "${res.name || agency.name}"`
          + (res.removedSubscription ? `, and its ${res.removedSubscription} subscription record.` : '.')
          // ⚠ SAID OUT LOUD, because it is the reason that account cannot start another trial (AUDIT G76).
          + (res.keptSubscription === 'trial'
            ? ' Its trial record was KEPT - that is what stops this account being granted a second free trial.'
            : '')
          + ' Payments and payment orders were not touched.',
      });
    } catch (err) {
      const e = err as GuardedDeleteError;
      setAgencyDeleteNote({
        kind: 'bad',
        text: e?.message || 'That agency could not be deleted.',
        blockers: e?.blockers,
        advice: e?.advice,
      });
    } finally {
      setDeletingAgencyId(null);
    }
  };

  // Compute metrics
  const totalAgenciesCount = allAgencies.length;
  // ⚠ NOT YET COUNTABLE, AND THE OLD COUNT SAID OTHERWISE. `activeAgenciesCount` counted an
  // agency with NO subscription field as active - `|| !a.subscriptionStatus` - so the panel
  // reported all twelve agencies as active paying subscribers when not one had ever paid or
  // carried a single subscription field. Absence was being read as consent.
  //
  // Subscription state lives in `subscriptions/{agencyId}`, which this screen now READS - see
  // `subsByAgency` above and AUDIT G34. The counts below come from that collection.
  //
  // ⚠ A `const subscriptionsKnown = false` STOOD HERE AND WAS READ BY NOTHING. It encoded
  // "no subscriptions exist" as a literal, was true when written, and survived the fix that
  // made this screen read the collection - so a later reader wiring it up would have got a
  // permanent `false` from a line that looked like state. A fact about the database belongs
  // in the database.
  const openTicketsCount = tickets.filter(t => t.status === 'Open' || t.status === 'In Progress').length;

  // Filtered ticket list
  const filteredTickets = tickets.filter(t => {
    const matchesSearch = t.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          t.ticketNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          t.userEmail.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = ticketStatusFilter === 'ALL' || t.status === ticketStatusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      
      {/* Top Admin Header */}
      <div className="bg-slate-900 rounded-lg p-3 text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border border-slate-700">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-amber-500/20 border border-amber-400/40 rounded-lg text-amber-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black tracking-tight">SUPER ADMIN COMMAND CENTER</h1>
                <span className="bg-amber-400 text-slate-950 font-black text-[10px] px-2 py-0.5 rounded uppercase">
                  Full Access
                </span>
              </div>
              <p className="text-slate-400 text-xs mt-0.5">
                Authorized Super Admin: <span className="text-amber-300 font-bold">shivaminfotech89@gmail.com</span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-slate-800/80 p-1.5 rounded-lg border border-slate-700/80 text-xs">
          <button 
            onClick={fetchAdminData}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Sync Data</span>
          </button>
        </div>
      </div>

      {/* Overview Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={`${CARD} ${CARD_PAD} flex items-center gap-4`}>
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-600">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Registered Agencies</span>
            <span className="text-xl font-black text-slate-900">{totalAgenciesCount}</span>
            <span className="text-[11px] text-slate-500 font-semibold block">
              {subsByAgency === null ? 'Subscriptions not read' : `${Object.keys(subsByAgency).length} with a subscription record`}
            </span>
          </div>
        </div>

        <div className={`${CARD} ${CARD_PAD} flex items-center gap-4`}>
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-600">
            <CreditCard className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Paid Subscriptions</span>
            {/* ⚠ COUNTS ONLY WHAT WAS PAID FOR. A grant and an admin-created agency are both
                "not expired" and neither is revenue; folding them in would restate G28's
                error in a metric instead of a row. `wasPaid` is the classification's own
                answer, so the count and the badges cannot disagree. */}
            <span className="text-xl font-black text-slate-900">
              {subsByAgency === null ? '—' : Object.values(subsByAgency).filter(sb => classifySubscription(sb, Date.now()).wasPaid).length}
            </span>
            {/* ⚠ THE MANUAL SHARE IS NAMED, NOT FOLDED IN. A cheque is revenue and belongs
                in the count - but `wasPaid && !verified` is exactly the set that has to be
                reconciled by hand against a cheque book rather than a gateway statement, and a
                single number would hide how much work that is. */}
            <span className="text-[11px] text-slate-500 font-semibold block">
              {subsByAgency === null ? 'Not read' : (() => {
                const paid = Object.values(subsByAgency)
                  .map(sb => classifySubscription(sb, Date.now())).filter(c => c.wasPaid);
                const manual = paid.filter(c => !c.verified).length;
                return `of ${totalAgenciesCount} agencies${manual ? ` \u00b7 ${manual} recorded manually` : ''}`;
              })()}
            </span>
          </div>
        </div>

        <div className={`${CARD} ${CARD_PAD} flex items-center gap-4`}>
          <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-purple-600">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Managed User Roles</span>
            <span className="text-xl font-black text-slate-900">{userRoles.length} Users</span>
            <span className="text-[11px] text-purple-600 font-semibold block">Full RBAC Control</span>
          </div>
        </div>

        <div className={`${CARD} ${CARD_PAD} flex items-center gap-4`}>
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-600">
            <LifeBuoy className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Support Tickets</span>
            <span className="text-xl font-black text-slate-900">{tickets.length}</span>
            <span className="text-[11px] text-amber-700 font-bold block">{openTicketsCount} Pending Admin Action</span>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex flex-wrap border-b border-slate-200 bg-white p-1.5 rounded-xl border shadow-sm gap-2">
        <button
          onClick={() => setActiveTab('templates')}
          className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all ${
            activeTab === 'templates' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Tender Templates</span>
        </button>
        <button
          onClick={() => setActiveTab('agencies')}
          className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all ${
            activeTab === 'agencies' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Agencies &amp; Subscriptions ({formatPrice()}/yr)</span>
        </button>

        <button
          onClick={() => setActiveTab('tickets')}
          className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all relative ${
            activeTab === 'tickets' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <LifeBuoy className="w-4 h-4" />
          <span>Support Tickets Desk</span>
          {openTicketsCount > 0 && (
            <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ml-1">
              {openTicketsCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('users')}
          className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all ${
            activeTab === 'users' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>User & Role Management</span>
        </button>

        <button
          onClick={() => setActiveTab('razorpay')}
          className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all ${
            activeTab === 'razorpay' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>Razorpay Integration</span>
        </button>

        <button
          onClick={() => setActiveTab('system')}
          className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all ${
            activeTab === 'system' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Web App Controls</span>
        </button>
      </div>

      {/* --- TAB: TENDER TEMPLATES ---
           ⚠ A TAB, NOT A BLOCK ABOVE THE TABS. It used to sit between the tab bar and
           the tab content, so it cost EVERY other tab 200px collapsed and about 600px
           with the form open - an admin opening Support Tickets scrolled past a rate
           register to reach them.

           It is FIRST, and not because it is most used - it is the least used, touched
           once or twice a year at a rollover. It is first because it is the only tab
           that is a JOB: an admin arrives at this screen IN ORDER TO publish a
           template. The others are places you look something up. The reason for
           visiting goes first, which is also why activeTab defaults here. */}
      {activeTab === 'templates' && (
        <>
      {/* --- THE PUBLISHED AT REGISTER (AUDIT F73) ---
           Read-only here. Templates are PUBLISHED from Estimate Master, where the rates
           being published are on screen and can be checked - publishing from a list would
           mean publishing figures nobody is looking at.

           This exists because the register was otherwise visible only on Estimate Master,
           under the AT the admin happens to have selected. "Which templates exist, at what
           version, and who is on an old one" is an administrative question and had no
           screen. */}
      <>
        <div className={`${CARD} p-6 space-y-4 mb-6`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Published AT rate templates</h2>
              <p className="text-xs text-slate-500">
                Tender schedules any user can copy onto their own AT &mdash; when creating one, or from
                Estimate Master. Revising a template bumps its version and changes nobody&rsquo;s existing rates.
              </p>
            </div>
            {isSuperAdminEmail && !showTplForm && (
              <button
                type="button"
                onClick={() => { resetTplForm(); setShowTplForm(true); }}
                className="shrink-0 flex items-center px-3 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-sm"
              >
                <PlusCircle className="w-4 h-4 mr-1.5" /> New tender template
              </button>
            )}
          </div>

          {tplMsg && (
            <div className="text-xs bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-lg p-3 font-medium">
              {tplMsg}
            </div>
          )}

          {/* AUTHORING FORM - metadata only. See handlePublishNewTemplate for why the five
              rate schedules are seeded from the shipped transcription rather than typed. */}
          {isSuperAdminEmail && showTplForm && (
            <div className="border-2 border-purple-200 bg-purple-50/40 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-purple-950">
                  {tplTargetId ? 'Revise a published template' : 'New tender template'}
                </h3>
                <button type="button" onClick={() => { setShowTplForm(false); resetTplForm(); }}
                        className="text-slate-400 hover:text-slate-600 text-xs font-bold">Cancel</button>
              </div>

              {publishedAts.length > 0 && (
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Publish as</label>
                  <select
                    value={tplTargetId}
                    onChange={e => {
                      setTplTargetId(e.target.value);
                      const t = publishedAts.find(x => x.id === e.target.value);
                      if (t) {
                        setTplName(t.name);
                        setTplAtNumber(t.atNumber || '');
                        setTplStart(t.startDate ? new Date(t.startDate).toISOString().split('T')[0] : '');
                        setTplEnd(t.endDate ? new Date(t.endDate).toISOString().split('T')[0] : '');
                        // A template published before this field existed has none. Left
                        // empty so the admin must choose rather than inherit a blank.
                        setTplScheduleId(t.scheduleId ?? '');
                        // ⚠ THE PERCENTAGES MUST BE PREFILLED OR REVISING WIPES THEM.
                        // publishAtTemplate writes with `merge: false`, so a field left out
                        // of the payload is DELETED. Loading a template to correct its name
                        // and publishing would silently strip the tender's accepted
                        // percentage from every future adopter - a data loss with no error
                        // and nothing on screen to notice.
                        const pv = (v: unknown) =>
                          v === undefined || v === null || !Number.isFinite(Number(v)) ? '' : String(v);
                        setTplPct(pv((t as any).atPercentage));
                      }
                    }}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">A NEW template</option>
                    {publishedAts.map(t => (
                      <option key={t.id} value={t.id}>Revise &ldquo;{t.name}&rdquo; &mdash; currently v{t.version}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Template name</label>
                  <input value={tplName} onChange={e => setTplName(e.target.value)} maxLength={200}
                         placeholder="UGVCL 2026-28 Schedule A"
                         className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">AT / tender number</label>
                  {/* FREE TEXT, AND IT MUST STAY FREE TEXT. The DISCOM's references carry
                      slashes, spaces and mixed case. This value is only ever displayed - it is
                      never a document id, a path segment or a map key anywhere in the app - so
                      nothing here needs escaping, and nothing truncates it below the 150
                      characters firestore.rules allows. */}
                  <input value={tplAtNumber} onChange={e => setTplAtNumber(e.target.value)} maxLength={150}
                         placeholder="UGVCL/EE-T-1/TRANS REP/2026-28/01/AT/1819"
                         className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white font-mono" />
                </div>
                {/* ⚠ OPTIONAL, AND DELIBERATELY NOT REQUIRED. A required field makes an
                    admin who does not know type something, and a wrong percentage carried
                    onto every adopting agency is worse than a blank each of them answers
                    from its own acceptance letter.

                    This does NOT reinstate F43's pre-fill. F43 removed the carry-forward of
                    LAST YEAR'S percentages, because an unread default cannot be told apart
                    from an answered one. A figure the TENDER states, carried by that
                    tender's template and labelled with its source on the AT form, is a
                    different object. Both hold. */}
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                    Accepted percentage &mdash; optional
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={tplPct}
                    onChange={e => setTplPct(e.target.value)}
                    placeholder="e.g. 7"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white font-mono tabular-nums"
                  />
                  <p className="mt-1 text-[11px] text-slate-600">
                    Positive for ABOVE the tender schedule, negative for below &mdash; A/T 1819 accepts
                    7.00% above, so enter 7. One figure, every core type.
                    <br />
                    Fill this only if the tender sets one rate for every agency. Leave blank when
                    agencies bid separately &mdash; each will then answer from its own acceptance letter.
                  </p>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">UGVCL schedule this template is published against</label>
                  <select
                    value={tplScheduleId}
                    onChange={e => setTplScheduleId(e.target.value)}
                    className={`w-full px-3 py-2 text-xs border rounded-lg bg-white ${tplScheduleId ? 'border-slate-300' : 'border-amber-400 bg-amber-50'}`}
                  >
                    <option value="">-- choose --</option>
                    {selectableSchedules().map(s => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-slate-600 leading-relaxed">
                    Travels with the rates onto every AT that adopts this template, and decides what
                    every item on every job under those tenders costs. Only fully transcribed schedules
                    are offered &mdash; a template published against an incomplete one could not price
                    anything.
                  </p>
                  {/* ⚠ A SCHEDULE CAN BE USABLE WITHOUT BEING FINISHED, and the admin must know
                      before publishing rather than the adopting agency finding out afterwards.
                      UGVCL-2026's Schedule-A is transcribed while its Schedule-B and Clause 4.0
                      pages are borrowed from 2020 - a real, temporary mixture (see borrowedFrom).
                      The Estimate Master notices tell the agency once they hold it; this one
                      tells the person choosing to send it. */}
                  {tplScheduleId && Object.keys(SCHEDULES[tplScheduleId as ScheduleId]?.borrowedFrom ?? {}).length > 0 && (
                    <div className="mt-1.5 p-2 rounded border border-amber-400 bg-amber-50 text-amber-900 text-[11px] leading-relaxed">
                      <strong className="font-bold">
                        {SCHEDULES[tplScheduleId as ScheduleId].label} is not fully transcribed yet.
                      </strong>{' '}
                      {Object.entries(SCHEDULES[tplScheduleId as ScheduleId].borrowedFrom).map(([part, from]) => (
                        <span key={part}>
                          {part === 'scheduleB' ? 'The Amorphous / Wound Core fixed rates' : 'The Clause 4.0 circle limits'}
                          {' '}come from {SCHEDULES[from as ScheduleId].label}.{' '}
                        </span>
                      ))}
                      Anyone adopting this template gets that mixture. It is shown to them on their
                      Estimate Master, and it stops being a mixture when you publish a new version with
                      the missing pages transcribed.
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Tender period from</label>
                  <input type="date" value={tplStart} onChange={e => setTplStart(e.target.value)}
                         className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Tender period to</label>
                  <input type="date" value={tplEnd} onChange={e => setTplEnd(e.target.value)}
                         className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">What changed in this version</label>
                  <textarea value={tplNotes} onChange={e => setTplNotes(e.target.value)} rows={2} maxLength={2000}
                            placeholder="Shown to anyone whose copy is behind this version."
                            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white" />
                </div>
              </div>

              <div className="text-[11px] leading-relaxed bg-white border border-purple-200 rounded-lg p-3 text-slate-700">
                <strong className="font-bold text-purple-950">The five rate schedules come from the app&rsquo;s UGVCL transcription</strong>
                {' '}&mdash; CRGO, Amorphous, Wound Core, Overhauling and Circle Limits, complete. A new tender
                normally reprices through the AT percentage rather than the schedule itself, so this is the
                schedule as tendered. If a figure genuinely differs, publish this, copy it onto an AT,
                correct the figure in Estimate Master and publish again as a new version.
                <div className="mt-1.5 pt-1.5 border-t border-purple-100">
                  <strong className="font-bold">The AT percentage is not part of a template.</strong> It is what each
                  agency quoted above or below the schedule, so it stays on their own AT.
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setShowTplForm(false); resetTplForm(); }}
                        className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-300">
                  Cancel
                </button>
                <button type="button" onClick={handlePublishNewTemplate} disabled={tplSaving || !tplName.trim()}
                        className="px-4 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-sm disabled:opacity-50">
                  {tplSaving ? 'Publishing...' : tplTargetId ? 'Publish new version' : 'Publish template'}
                </button>
              </div>
            </div>
          )}

          {publishedAts.length === 0 ? (
            <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
              None published yet. Use <strong>New tender template</strong> above &mdash; it needs no agency and
              no AT, and carries the five UGVCL schedules as transcribed. Publishing an existing
              AT&rsquo;s rates instead is still available from Estimate Master.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-3 font-bold">Template</th>
                    <th className="py-2 pr-3 font-bold">Version</th>
                    <th className="py-2 pr-3 font-bold">Published</th>
                    <th className="py-2 pr-3 font-bold">In use by</th>
                    <th className="py-2 font-bold">On an older version</th>
                  </tr>
                </thead>
                <tbody>
                  {publishedAts.map(t => {
                    const adopters = atMasters.filter(a => String((a as any).ratesSource || '') === `published:${t.id}`);
                    // WHO IS BEHIND. A copy never follows the template, so this is the only
                    // place the drift is visible across everyone at once - each operator
                    // sees only their own AT.
                    const behind = adopters.filter(a => Number((a as any).publishedAtVersion ?? 0) < Number(t.version));
                    return (
                      <tr key={t.id} className="border-b border-slate-100 align-top">
                        <td className="py-2 pr-3">
                          <div className="font-bold text-slate-800">{t.name}</div>
                          {t.atNumber && <div className="text-slate-500">AT {t.atNumber}</div>}
                          {t.notes && <div className="text-slate-500 mt-0.5 max-w-md">{t.notes}</div>}
                        </td>
                        <td className="py-2 pr-3 font-mono tabular-nums font-bold text-slate-800">v{t.version}</td>
                        <td className="py-2 pr-3 text-slate-600">
                          {t.publishedAt ? new Date(t.publishedAt).toLocaleDateString('en-IN') : '-'}
                          {t.publishedBy && <div className="text-slate-400">{t.publishedBy}</div>}
                        </td>
                        <td className="py-2 pr-3 font-bold text-slate-800">{adopters.length}</td>
                        <td className="py-2">
                          {behind.length === 0
                            ? <span className="text-emerald-700 font-semibold">none</span>
                            : (
                              <span className="text-amber-800 font-semibold">
                                {behind.length}
                                <span className="font-normal text-amber-700">
                                  {' '}({[...new Set(behind.map(a => `v${(a as any).publishedAtVersion ?? '?'}`))].join(', ')})
                                </span>
                              </span>
                            )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>

        </>
      )}

      {/* --- TAB 1: AGENCIES & SUBSCRIPTION MANAGEMENT --- */}
      {activeTab === 'agencies' && (
        <div className={`${CARD} p-6 space-y-6`}>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">Registered Agencies & Razorpay Subscriptions</h2>
              <p className="text-xs text-slate-500">Registered agencies, with the subscription recorded for each. Status is read from the subscriptions collection, which no client can write.</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 p-2.5 rounded-xl text-xs text-blue-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <span>Standard Agency Subscription: <strong>{formatPrice()} / year per agency</strong>, inclusive of {gstBreakdown().ratePercent}% GST</span>
            </div>
          </div>

          {/* SEARCH, STATUS, AND "HOLDS NOTHING" (AUDIT G73) */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search name, email, GSTIN, owner, id..."
                value={agencySearch}
                onChange={e => setAgencySearch(e.target.value)}
                className="pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500 w-72 max-w-full"
              />
            </div>

            {/* ⚠ THE COUNTS ARE null WHEN THE SUBSCRIPTIONS COULD NOT BE READ, and the chips say so rather than
                showing every agency as NOT BILLED (AUDIT G28, G34). */}
            {([
              ['ALL', `All ${allAgencies.length}`],
              ['active', 'Paid'], ['granted', 'Granted'], ['trial', 'Trial'],
              ['trial_ended', 'Trial ended'], ['expired', 'Expired'], ['admin', 'Admin'], ['none', 'Not billed'],
            ] as Array<[StatusFilter, string]>).map(([key, label]) => {
              const n = key === 'ALL' ? null : (agencyStatusCounts ? agencyStatusCounts[key] : null);
              if (key !== 'ALL' && agencyStatusCounts && n === 0) return null;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAgencyStatus(key)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
                    agencyStatus === key
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                >
                  {key === 'ALL' ? label : `${label}${n === null ? '' : ` ${n}`}`}
                </button>
              );
            })}
            {!agencyStatusCounts && (
              <span className="text-[11px] font-bold text-amber-700">subscriptions not read &mdash; counts unavailable</span>
            )}

            <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 px-2.5 py-1.5 border border-slate-300 rounded-lg cursor-pointer">
              <input type="checkbox" checked={onlyEmptyAgencies} onChange={e => setOnlyEmptyAgencies(e.target.checked)} />
              Holds nothing
            </label>

            <span className="text-[11px] text-slate-500">
              {visibleAgencies.length} of {allAgencies.length} shown
            </span>
          </div>

          {agencyDeleteNote && (
            <div role="alert" className={`rounded-lg border px-3 py-2 text-[11px] ${
              agencyDeleteNote.kind === 'ok'
                ? 'bg-green-50 border-green-300 text-green-900'
                : 'bg-red-50 border-red-300 text-red-900'}`}>
              <div className="flex items-start gap-2">
                {agencyDeleteNote.kind === 'ok'
                  ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                <div className="flex-1">
                  <p className="font-bold">{agencyDeleteNote.text}</p>
                  {agencyDeleteNote.blockers?.map(b => (
                    <p key={b.what} className="mt-1">
                      <span className="font-bold">{b.count} {b.what}{b.count === '1' ? '' : 's'}:</span>{' '}
                      {b.items.join('; ')}
                      <span className="block text-[10px] opacity-80">{b.consequence}</span>
                    </p>
                  ))}
                  {agencyDeleteNote.advice && <p className="mt-1 text-[10px] opacity-80">{agencyDeleteNote.advice}</p>}
                </div>
                <button type="button" onClick={() => setAgencyDeleteNote(null)} className="font-bold shrink-0">Dismiss</button>
              </div>
            </div>
          )}

          {subActionNote && (
            <div className="flex items-start gap-2 bg-green-50 border border-green-300 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-4 h-4 text-green-700 shrink-0 mt-0.5" />
              <p className="text-[11px] font-bold text-green-900 flex-1">{subActionNote}</p>
              <button type="button" onClick={() => setSubActionNote(null)}
                className="text-[11px] font-bold text-green-800 shrink-0">Dismiss</button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 uppercase tracking-wider font-bold text-[10px]">
                  <th className="p-3">Agency Name</th>
                  <th className="p-3">Contact Email & GSTIN</th>
                  <th className="p-3">Subscription Status</th>
                  <th className="p-3">Plan Price</th>
                  <th className="p-3">Expiry Date</th>
                  {/* What the delete guard will ask about, before it is asked (AUDIT G73). */}
                  <th className="p-3">Contents</th>
                  <th className="p-3 text-right">Admin Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleAgencies.map((agency) => {
                  /* ⚠ THIS ROW USED TO INVENT A SUBSCRIPTION. It read
                     `subscriptionStatus || 'active'`, `subscriptionExpiryDate || (now + 365
                     days)` and `subscriptionPlanAmount || 3999` - against a database where NO
                     agency carries any of the three. So every agency rendered as ACTIVE PAID,
                     Rs 3999/yr, expiring one year from whenever the page happened to load: a
                     figure that changed daily and had never been true of anyone.

                     The same sentinel shape as the Dashboard's product-name fallback (G26) and
                     the rest of this audit - a plausible value standing where a missing one
                     belongs, so the absence renders as a fact. On a payments screen it is the
                     worst version of it: the panel would have shown twelve paying customers to
                     the one person deciding whether to chase them. */

                  const sub = subsByAgency ? (subsByAgency[agency.id] ?? null) : null;
                  const contents = contentsOf(agency.id);
                  const empty = holdsNothing(contents);
                  const cls = classifySubscription(sub, Date.now());
                  const left = daysRemaining(sub, Date.now());
                  const unread = subsByAgency === null;

                  return (
                    <tr key={agency.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-bold text-slate-900">
                        {agency.name}
                        <span className="block text-[10px] font-mono tabular-nums text-slate-400">ID: {agency.id}</span>
                      </td>
                      <td className="p-3 text-slate-600">
                        <div>{agency.email || 'No email set'}</div>
                        <span className="text-[10px] text-slate-400">GSTIN: {agency.gstin || 'N/A'}</span>
                      </td>
                      <td className="p-3">
                        {/* ⚠ "NOT READ" AND "NOT BILLED" ARE DIFFERENT ANSWERS AND MUST LOOK
                            DIFFERENT. If the subscriptions read failed, this row knows nothing
                            about this agency - and reporting that as "not billed" would be a
                            confident claim built on a failure, which is precisely the shape
                            this table is being fixed for. */}
                        {unread ? (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300">
                            NOT READ
                          </span>
                        ) : (
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${cls.tone}`}>
                            {cls.word}
                          </span>
                        )}
                        {cls.key === 'granted' && !unread && (
                          <span className="block text-[10px] text-slate-400 mt-0.5">no invoice behind it</span>
                        )}
                        {/* ⚠ CANCELLED AND LAPSED SHARE A STATE AND ARE NOT THE SAME FACT. The
                            badge says which; this says why, because a year later that is the
                            only place the answer exists. */}
                        {cls.cancelled && !unread && (
                          <span className="block text-[10px] text-red-700 mt-0.5">
                            ended: {sub?.cancelReason || 'no reason recorded'}
                          </span>
                        )}
                        {/* Revenue with nothing to reconcile it against. */}
                        {cls.wasPaid && !cls.verified && !unread && (
                          <span className="block text-[10px] text-amber-700 mt-0.5">
                            ref {sub?.paymentReference || '(none)'} &mdash; no gateway record
                          </span>
                        )}
                        {sub?.invoicePending && (
                          <span className="block text-[10px] text-amber-700 mt-0.5">invoice pending</span>
                        )}
                      </td>
                      <td className="p-3 font-extrabold text-slate-900">
                        {/* ⚠ WHAT WAS ACTUALLY CHARGED, WHEN ANYTHING WAS. `planAmount` is the
                            figure recorded at the time of payment and is deliberately NOT
                            recomputed from today's price - a subscription that recalculated its
                            own amount would rewrite history on a record a GST invoice points at.
                            Where nothing was charged the rate is still shown, and still labelled
                            as a rate rather than a charge. */}
                        {!unread && cls.wasPaid && Number(sub?.planAmount || 0) > 0 ? (
                          <>
                            {formatPrice(Number(sub?.planAmount))}
                            <span className="text-[10px] font-normal text-slate-400"> paid</span>
                          </>
                        ) : (
                          <>
                            <span className="text-slate-400">{formatPrice()}</span>
                            <span className="text-[10px] font-normal text-slate-400"> / yr</span>
                            <span className="block text-[10px] font-normal text-slate-400">the rate, not a charge made</span>
                          </>
                        )}
                      </td>
                      <td className="p-3 font-medium">
                        {/* ⚠ AN EM DASH FOR admin AND none, NOT A DATE. An admin-created agency
                            has no expiry because nothing was bought; printing one would invent
                            a deadline no payment supports. `hasExpiry` is the classification's
                            own answer, so this cannot disagree with the badge beside it. */}
                        {unread || !cls.hasExpiry ? (
                          <span className="text-slate-400">&mdash;</span>
                        ) : (
                          <span className={cls.key === 'expired' ? 'text-red-700' : 'text-slate-600'}>
                            {formatDDMMYYYY(Number(sub?.expiryDate || 0))}
                            {left !== null && (
                              <span className="block text-[10px] text-slate-400">
                                {left < 0 ? `${Math.abs(left)} days ago` : `${left} days left`}
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className={empty ? 'text-slate-400' : 'text-slate-700 font-medium'}>
                          {contents.ats} {contents.ats === 1 ? 'tender' : 'tenders'}
                          <span className="block">{contents.jobs} {contents.jobs === 1 ? 'job' : 'jobs'}</span>
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {/* ⚠ THESE GO THROUGH A CALLABLE, NOT A CLIENT WRITE (AUDIT G40). The
                            buttons that stood here wrote to the customer's AGENCY document
                            across accounts and were disabled by G1; they were then relabelled
                            "Server-written", which described the obstacle rather than removing
                            it. `subscriptions/{agencyId}` is write-denied to every client, so
                            the only way an admin action can land is a function that checks the
                            verified token - which is what adminSubscriptionAction does. */}
                        <SubscriptionActions
                          agencyId={agency.id}
                          agencyName={agency.name || '(unnamed)'}
                          sub={sub}
                          onDone={(msg) => { setSubActionNote(msg); setSubReload(x => x + 1); }}
                        />
                        {/* ⚠ OFFERED ONLY WHERE THIS ROW CAN SEE NOTHING UNDER IT, AND THE SERVER DECIDES ANYWAY
                            (AUDIT G73). The guard refuses on inspections, oil and a payment too - none of which is
                            visible here - so this button is a shortcut past an obvious refusal, not a permission. */}
                        <div className="mt-1">
                          {empty ? (
                            <button
                              type="button"
                              onClick={() => removeAgency(agency)}
                              disabled={deletingAgencyId === agency.id}
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700 hover:bg-red-50 border border-red-200 rounded px-2 py-1 disabled:opacity-50"
                            >
                              {deletingAgencyId === agency.id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <Trash2 className="w-3 h-3" />}
                              Delete
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-400" title={`Holds ${contents.ats} tender(s) and ${contents.jobs} job(s)`}>
                              not empty
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visibleAgencies.length === 0 && (
                  <tr><td colSpan={7} className="p-4 text-slate-500">
                    {allAgencies.length === 0 ? 'No agencies found.' : 'No agency matches these filters.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- TAB 2: USER & ROLE MANAGEMENT --- */}
      {activeTab === 'users' && (
        <div className={`${CARD} p-6 space-y-6`}>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-slate-100">
            <div>
              {/* ⚠ RENAMED FROM "User Role & RBAC Permissions Management", WHICH WAS THE
                  DANGEROUS PART. That title reads as a security control, and someone could
                  reasonably assign a restricted role believing it takes effect. It does not:
                  nothing outside this panel reads `user_roles`. Access is decided by
                  isSuperAdmin() on the email in firestore.rules, and by nothing else. These
                  are RECORDS of an intention, not a mechanism - so the heading says record.
                  AUDIT O52. */}
              {/* ⚠ THIS NOTICE SAID "these records do not grant or restrict anything yet" and
                  "nothing reads this collection". Both were true, and both were PROMISES THAT
                  EXPIRE - dangerously, in the direction that matters. If RBAC is ever
                  implemented and this text is not updated in the same change, an administrator
                  reads that a role is inert, assigns a restricted one to test, and restricts a
                  real user.

                  What replaced it POINTS AT THE AUTHORITY INSTEAD OF CACHING ITS ANSWER.
                  "What a role permits is whatever firestore.rules says" is true today, true
                  after RBAC lands, and true after it changes again - and it sends the reader to
                  the one place that can actually answer. A screen that repeats what a rule
                  currently does has no way of being told when the rule changes. */}
              <h2 className="text-base font-bold text-slate-900">User role records</h2>
              <p className="text-xs text-slate-500">A register of who is meant to hold which role</p>
              <p className={`mt-2 text-[11px] font-bold text-slate-700 bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5`}>
                This register records an intention. What a role actually permits is decided by
                <span className="font-mono"> firestore.rules</span> &mdash; read the rules to
                know what any role allows, rather than inferring it from what is written here.
              </p>
            </div>
            <button
              onClick={() => setShowUserModal(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-2 shadow"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Assign / Add User Role</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 uppercase tracking-wider font-bold text-[10px]">
                  <th className="p-3">User Email</th>
                  <th className="p-3">Assigned Role</th>
                  <th className="p-3">Agency Scope</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Last Updated</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {/* Default Super Admin row */}
                <tr className="bg-amber-50/50">
                  <td className="p-3 font-bold text-slate-900 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-amber-600" />
                    <span>shivaminfotech89@gmail.com</span>
                    <span className="text-[9px] bg-amber-500 text-white font-black px-1.5 py-0.2 rounded">SUPER ADMIN</span>
                  </td>
                  <td className="p-3">
                    <span className="px-2.5 py-1 rounded text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300">
                      SUPER ADMIN
                    </span>
                  </td>
                  <td className="p-3 font-bold text-indigo-700">Global (All Agencies)</td>
                  <td className="p-3">
                    <span className="text-green-700 font-bold">Active</span>
                  </td>
                  <td className="p-3 text-slate-400">System Core</td>
                  <td className="p-3 text-right text-slate-400 text-[10px]">Protected Master</td>
                </tr>

                {userRoles.map((ur) => (
                  <tr key={ur.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-semibold text-slate-900">{ur.email}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-800 border uppercase">
                        {ur.role}
                      </span>
                    </td>
                    <td className="p-3 text-slate-600">{ur.agencyName || 'All Agencies'}</td>
                    <td className="p-3">
                      {ur.status === 'active' ? (
                        <span className="text-green-600 font-bold">Active</span>
                      ) : (
                        <span className="text-red-600 font-bold">Suspended</span>
                      )}
                    </td>
                    <td className="p-3 text-slate-500">{formatDDMMYYYY(ur.updatedAt)}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleToggleUserStatus(ur)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-bold"
                      >
                        {ur.status === 'active' ? 'Suspend' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- TAB 3: SUPPORT TICKETS DESK --- */}
      {activeTab === 'tickets' && (
        <div className={`${CARD} p-6 space-y-6`}>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">User Generated Support Tickets</h2>
              <p className="text-xs text-slate-500">Manage questions and issues raised by users across the web application</p>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search ticket, email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <select
                value={ticketStatusFilter}
                onChange={(e) => setTicketStatusFilter(e.target.value)}
                className="p-1.5 border border-slate-300 rounded-lg text-xs font-semibold outline-none bg-white"
              >
                <option value="ALL">All Statuses</option>
                <option value="Open">Open Only</option>
                <option value="In Progress">In Progress</option>
                <option value="Resolved">Resolved</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 uppercase tracking-wider font-bold text-[10px]">
                  <th className="p-3">Ticket #</th>
                  <th className="p-3">User Email & Agency</th>
                  <th className="p-3">Subject & Category</th>
                  <th className="p-3">Priority</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Created Date</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTickets.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-extrabold text-blue-700">#{t.ticketNo}</td>
                    <td className="p-3">
                      <div className="font-bold text-slate-900">{t.userEmail}</div>
                      {/* Only when given. A blank line where a number would be reads as
                          "they declined" rather than "the field did not exist yet" - and
                          every ticket written before today has none. */}
                      {(t as any).userPhone && (
                        <a href={`tel:${String((t as any).userPhone).replace(/[^+\d]/g, '')}`}
                           className="text-[11px] font-mono text-blue-700 hover:underline">
                          {(t as any).userPhone}
                        </a>
                      )}
                      <div className="text-[10px] text-slate-400">{t.agencyName || 'General'}</div>
                    </td>
                    <td className="p-3">
                      <div className="font-bold text-slate-900 line-clamp-1">{t.subject}</div>
                      <span className="text-[10px] text-slate-500 font-medium bg-slate-100 px-1.5 py-0.2 rounded">
                        {t.category}
                      </span>
                    </td>
                    <td className="p-3 font-bold">{t.priority}</td>
                    <td className="p-3 font-bold">{t.status}</td>
                    <td className="p-3 text-slate-500">{formatDDMMYYYY(t.createdAt)}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => {
                          setSelectedTicket(t);
                          setReplyText(t.adminReply || '');
                          setNewStatus(t.status);
                        }}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg shadow-sm inline-flex items-center gap-1"
                      >
                        <MessageSquare className="w-3.5 h-3.5" /> Reply & Resolve
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- TAB 4: RAZORPAY INTEGRATION CONFIG --- */}
      {activeTab === 'razorpay' && (
        <div className={`${CARD} p-6 space-y-6`}>
          <div className="pb-4 border-b border-slate-100">
            {/* ⚠ THIS NOTICE USED TO SAY "there is no Razorpay integration in the app, so
                enabled enables nothing and no payment is taken or checked". Payments have
                worked end to end since G30-G31, and the sentence was still on the payments
                screen telling its reader that payments did not exist.

                What replaced it describes what this tab HOLDS rather than what the rest of
                the app does with it. That is a sentence that cannot expire: the secret's
                location and the price's location are facts about this screen, and they stay
                true whatever is built next. */}
            <h2 className="text-base font-bold text-slate-900">Razorpay settings</h2>
            <p className="text-xs text-slate-500">Gateway mode and the publishable Key ID</p>
            <p className={`mt-2 text-[11px] font-bold text-slate-700 bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5`}>
              The key <strong>secret</strong> is not here &mdash; it is the Functions secret
              <span className="font-mono"> RAZORPAY_KEY_SECRET</span>, readable only by the
              server. The price is not here either: it is set in
              <span className="font-mono"> src/lib/pricing.ts</span>, in version control.
            </p>
          </div>

          <form onSubmit={handleSaveRazorpayConfig} className="max-w-2xl space-y-5">
            <div className="bg-slate-900 text-white p-5 rounded-2xl space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold uppercase text-slate-300">Gateway Status</span>
                <button
                  type="button"
                  onClick={() => setRazorpaySettings(prev => ({ ...prev, enabled: !prev.enabled }))}
                  className={`px-3 py-1 rounded-full text-xs font-black uppercase ${
                    razorpaySettings.enabled ? 'bg-green-500 text-slate-950' : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {razorpaySettings.enabled ? 'ENABLED' : 'DISABLED'}
                </button>
              </div>

              <div className="flex justify-between items-center border-t border-slate-800 pt-3">
                <span className="text-xs font-bold uppercase text-slate-300">Mode</span>
                <button
                  type="button"
                  onClick={() => setRazorpaySettings(prev => ({ ...prev, testMode: !prev.testMode }))}
                  className={`px-3 py-1 rounded-full text-xs font-black uppercase ${
                    razorpaySettings.testMode ? 'bg-amber-400 text-slate-950' : 'bg-blue-500 text-white'
                  }`}
                >
                  {razorpaySettings.testMode ? 'TEST MODE' : 'LIVE PRODUCTION'}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Razorpay Key ID</label>
              <input
                type="text"
                value={razorpaySettings.keyId}
                onChange={(e) => setRazorpaySettings(prev => ({ ...prev, keyId: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-mono tabular-nums focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            {/* ⚠ THERE IS NO KEY SECRET FIELD, AND ONE MUST NOT BE ADDED. It wrote to
                `system_config/razorpay`, which was world-readable - the first Save would have
                published the secret to the open internet, with no error to notice. The rule is
                fixed, and the field is still gone: a secret belongs in a Functions secret the
                client cannot read at all, not in a database the client talks to. A webhook
                secret would be the same, and is gone with it. */}
            {/* ================= THE ONE-RUPEE GATEWAY CHECK (AUDIT G44) =================
                ⚠ IT WRITES NO SUBSCRIPTION. It proves the round trip - the keys authenticate,
                the order is created, checkout opens, the signature verifies server-side, and the
                idempotency record lands. A subscription would prove nothing extra and would then
                need a flag on the document, a branch in classifySubscription, a case in the
                revenue metric and a row saying "ignore me": four things that can be got wrong,
                against zero for a document never created.

                ⚠ AND THE MODE IS THE KEY PAIR, NOT A SWITCH. Against test keys this costs
                nothing and runs identical code; after the live swap it costs a rupee and proves
                the live configuration. There is deliberately no TEST_MODE flag anywhere - a
                value someone can change that decides whether real money moves has the failure
                mode of believing you are testing. */}
            <div className="rounded-lg border border-slate-300 bg-white p-3 space-y-2">
              <div>
                <p className="text-xs font-bold text-slate-900">Gateway check &mdash; &#8377;1</p>
                <p className="text-[11px] text-slate-600">
                  Takes a real &#8377;1 payment through whichever key pair is deployed, verifies
                  the signature, and writes nothing but a payment record. No subscription, no
                  invoice queue entry, no agency touched.
                </p>
              </div>
              <button
                type="button"
                disabled={gatewayCheck?.kind === 'busy'}
                onClick={async () => {
                  setGatewayCheck({ kind: 'busy', text: 'Opening checkout…' });
                  try {
                    const r = await runLiveGatewayCheck();
                    setGatewayCheck({
                      kind: 'ok',
                      text: `Gateway verified. Payment ${r.paymentId} — look it up in the Razorpay `
                        + `dashboard to confirm which mode it landed in.`,
                    });
                  } catch (e: any) {
                    if (e instanceof CheckoutDismissed) setGatewayCheck(null);
                    else if (e instanceof PaymentTakenButUnverified) {
                      // ⚠ MONEY MOVED. A rupee, but the message must not say "failed".
                      setGatewayCheck({ kind: 'bad', text: e.message });
                    } else if (e instanceof GatewayDeclined) {
                      setGatewayCheck({ kind: 'bad', text: `${e.message} ${e.detail}` });
                    } else {
                      setGatewayCheck({ kind: 'bad', text: String(e?.message || 'Failed.') });
                    }
                  }
                }}
                className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-bold text-xs px-4 py-2 rounded-lg"
              >
                {gatewayCheck?.kind === 'busy'
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <ShieldCheck className="w-4 h-4" />}
                {gatewayCheck?.kind === 'busy' ? 'Working…' : 'Run the \u20b91 check'}
              </button>
              {gatewayCheck && gatewayCheck.kind !== 'busy' && (
                <p className={`text-[11px] font-bold rounded px-2.5 py-2 border ${
                  gatewayCheck.kind === 'ok'
                    ? 'bg-green-50 border-green-300 text-green-900'
                    : 'bg-red-50 border-red-300 text-red-900'}`}>
                  {gatewayCheck.text}
                </p>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] text-slate-600">
                The key <strong>secret</strong> is not stored here. It is held as the Firebase
                Functions secret <span className="font-mono">RAZORPAY_KEY_SECRET</span> and read
                only by the server, which is what lets a signature be verified where the browser
                cannot see the key.
              </p>
            </div>

            {/* ⚠ THE PRICE IS DISPLAYED, NOT EDITED. A price editable from a browser can
                disagree with a GST invoice already issued, and a tax invoice is corrected by a
                credit note rather than by editing it. It lives in src/lib/pricing.ts. */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Annual Subscription Fee per Agency</label>
              <div className="w-full border border-slate-200 bg-slate-50 rounded-lg p-2.5">
                <span className="text-sm font-black text-slate-900">{formatPrice()}</span>
                <span className="text-[11px] text-slate-500"> inclusive &mdash; {formatPrice(gstBreakdown().taxable)} + {formatPrice(gstBreakdown().tax)} GST at {gstBreakdown().ratePercent}%</span>
                <span className="block text-[10px] text-slate-400 mt-0.5">Set in src/lib/pricing.ts, not here.</span>
              </div>
            </div>

            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-6 py-3 rounded-xl shadow-md"
            >
              Save Razorpay Settings
            </button>
          </form>
        </div>
      )}

      {/* --- TAB 5: WEB APP & MAINTENANCE CONTROLS --- */}
      {activeTab === 'system' && (
        <div className={`${CARD} p-6 space-y-6`}>
          <div className="pb-4 border-b border-slate-100">
            {/* ⚠ THIS NOTICE SAID "nothing reads these yet" and, explicitly, that switching
                maintenance mode on "does not lock anyone out". True when written, and the most
                dangerous sentence in this panel to leave standing: the day a maintenance check
                is added, an administrator who trusts this text flips the switch to see what it
                does and locks out every customer mid-tender.

                A notice that says what a control DOES cannot expire. A notice that promises
                what it does NOT do expires the moment someone implements the thing. So this
                describes the write and stops - and if flipping the switch turns out to change
                nothing, the absence says so more reliably than a sentence can. */}
            <h2 className="text-base font-bold text-slate-900">Maintenance &amp; broadcast settings</h2>
            <p className="text-xs text-slate-500">Written to system_config/general</p>
            <p className={`mt-2 text-[11px] font-bold text-slate-700 bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5`}>
              Saving records the maintenance flag, its message and the banner text. Whether the
              app acts on them is decided in the app&rsquo;s own load path, not here &mdash; so
              treat this as arming a setting, and verify the effect rather than assuming it.
            </p>
          </div>

          <form onSubmit={handleSaveSystemSettings} className="max-w-2xl space-y-5">
            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 space-y-3">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-sm text-amber-900">System Maintenance Mode</h3>
                  <p className="text-xs text-amber-700">When enabled, non-admin users see a maintenance banner</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSystemSettings(prev => ({ ...prev, maintenanceMode: !prev.maintenanceMode }))}
                  className={`px-4 py-1.5 rounded-full text-xs font-black ${
                    systemSettings.maintenanceMode ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {systemSettings.maintenanceMode ? 'MAINTENANCE ON' : 'NORMAL MODE'}
                </button>
              </div>

              {systemSettings.maintenanceMode && (
                <input
                  type="text"
                  value={systemSettings.maintenanceMessage}
                  onChange={(e) => setSystemSettings(prev => ({ ...prev, maintenanceMessage: e.target.value }))}
                  placeholder="Maintenance message..."
                  className="w-full border border-amber-300 rounded-lg p-2 text-xs font-medium bg-white"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Global Broadcast Notice Banner</label>
              <textarea
                rows={2}
                value={systemSettings.announcementBanner}
                onChange={(e) => setSystemSettings(prev => ({ ...prev, announcementBanner: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-6 py-3 rounded-xl shadow-md"
            >
              Save System Broadcast Settings
            </button>
          </form>
        </div>
      )}

      {/* Modal: Add User Role */}
      {showUserModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 p-6 space-y-4">
            <h3 className="font-bold text-base text-slate-900">Assign User Role (RBAC)</h3>
            
            <form onSubmit={handleSaveUserRole} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">User Email Address</label>
                <input
                  type="email"
                  required
                  value={userModalEmail}
                  onChange={(e) => setUserModalEmail(e.target.value)}
                  placeholder="e.g. operator@agency.com"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-medium outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Role Type</label>
                <select
                  value={userModalRole}
                  onChange={(e) => setUserModalRole(e.target.value as UserRoleType)}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-medium outline-none bg-white"
                >
                  <option value="manager">Manager (Full Agency Ops)</option>
                  <option value="operator">Operator (Inspection Data Entry)</option>
                  <option value="viewer">Viewer (Read-Only Reports)</option>
                  <option value="admin">Super Admin (System Control)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Agency Scope</label>
                <select
                  value={userModalAgencyId}
                  onChange={(e) => setUserModalAgencyId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-medium outline-none bg-white"
                >
                  <option value="">Global / All Agencies</option>
                  {allAgencies.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowUserModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700"
                >
                  Save User Role
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reply Support Ticket */}
      {selectedTicket && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-bold text-base text-slate-900">Reply to Ticket #{selectedTicket.ticketNo}</h3>
              <button onClick={() => setSelectedTicket(null)} className="text-slate-400 hover:text-slate-700 font-bold">✕</button>
            </div>

            <div className="bg-slate-50 p-3 rounded-lg text-xs space-y-1">
              <div><strong>User:</strong> {selectedTicket.userEmail} ({selectedTicket.agencyName})</div>
              {(selectedTicket as any).userPhone && (
                <div>
                  <strong>Phone:</strong>{' '}
                  <a href={`tel:${String((selectedTicket as any).userPhone).replace(/[^+\d]/g, '')}`}
                     className="font-mono text-blue-700 hover:underline">
                    {(selectedTicket as any).userPhone}
                  </a>
                </div>
              )}
              <div><strong>Subject:</strong> {selectedTicket.subject}</div>
              <div className="text-slate-700 italic border-t pt-2 mt-2">{selectedTicket.description}</div>
            </div>

            <form onSubmit={handleReplyTicket} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Update Ticket Status</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as TicketStatus)}
                  className="w-full border border-slate-300 rounded-lg p-2 text-xs font-medium bg-white"
                >
                  <option value="In Progress">In Progress</option>
                  <option value="Resolved">Resolved</option>
                  <option value="Closed">Closed</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Admin Response Message</label>
                <textarea
                  required
                  rows={4}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type official admin response..."
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setSelectedTicket(null)}
                  className="px-4 py-2 border rounded-lg text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={replySubmitting}
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> Save Reply & Update
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
