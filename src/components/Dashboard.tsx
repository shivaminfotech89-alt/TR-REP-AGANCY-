import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAgency, atScope, NO_ACTIVE_AT } from '../lib/AgencyContext';
import { AllotmentWidget } from './AllotmentWidget';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { 
  PlusCircle, 
  FileText, 
  Wrench, 
  Zap, 
  Truck, 
  ShieldAlert, 
  Droplet, 
  Clock, 
  CheckCircle2, 
  RefreshCw, 
  Activity,
  ChevronRight,
  ShieldCheck,
  Building2,
  Filter,
  CheckSquare,
  RotateCcw,
  BarChart3,
  PackageCheck,
  Layers,
  ArrowUpRight,
  Sparkles
} from 'lucide-react';
import appLogo from '../assets/images/transformer_app_logo_1786648240128.jpg';

/** The Dashboard's "every tender" scope. Its own value - see the note on dashScope. */
const DASH_ALL = '__all_tenders__';

export default function Dashboard() {
  const { activeAgency, activeAtMaster, atMasters } = useAgency();
  
  const [jobs, setJobs] = useState<any[]>([]);
  const [oilTransactions, setOilTransactions] = useState<any[]>([]);
  /**
   * EVERY job of this agency, across all tenders — for guarantee tracking only.
   *
   * Deliberately separate from `jobs`, which is the selected tender's work. Two sets on one
   * screen is a cost, and it is paid because a guarantee claim references a repair from a
   * previous tender: filtering guarantees to the current tender would report zero the day
   * after a rollover (AUDIT F85).
   */
  const [allAgencyJobs, setAllAgencyJobs] = useState<any[]>([]);

  /**
   * THE DASHBOARD CHOOSES ITS OWN SCOPE — and changes nothing else (AUDIT F86).
   *
   * ⚠ LOCAL, AND THIS IS THE SAME DECISION AS THE ESTIMATE MASTER TENDER SELECTOR (F79).
   * Written out here so a third scope selector follows it rather than re-deciding: a control
   * on a VIEWING screen must not change what the app WORKS in. Letting this set the active
   * AT would mean opening the overview silently re-points what New Job books against, which
   * allotment is checked, and what every other screen shows - a read causing a mutation,
   * the shape removed in F70 and F72.
   *
   * It DEFAULTS to the sidebar's tender, so the two agree unless the operator chooses
   * otherwise, and the divergence is stated when it exists.
   *
   * ⚠ `DASH_ALL` IS ITS OWN VALUE, NOT AN OVERLOADED null. Null already means "no tender /
   * not loaded yet"; during the initial load it would otherwise read as "show every tender
   * at once" and flash cross-tender figures before the real ones arrive.
   */
  const [dashScope, setDashScope] = useState<string | null>(null);
  const effectiveScope = dashScope ?? activeAtMaster?.id ?? DASH_ALL;
  const showingAll = effectiveScope === DASH_ALL;
  const scopedAt = showingAll ? null : (atMasters.find(t => t.id === effectiveScope) || null);
  const dashDiverged = !showingAll && Boolean(activeAtMaster) && effectiveScope !== activeAtMaster?.id;

  /** The jobs the counts are built from: one tender's, or every tender's. */
  const scopedJobs = useMemo(
    () => showingAll ? allAgencyJobs : allAgencyJobs.filter((j: any) => String(j.atId ?? '') === effectiveScope),
    [allAgencyJobs, showingAll, effectiveScope],
  );
  const scopedOil = useMemo(
    () => showingAll ? oilTransactions : oilTransactions.filter((t: any) => String(t.atId ?? '') === effectiveScope),
    [oilTransactions, showingAll, effectiveScope],
  );
  const [loading, setLoading] = useState(true);
  const [selectedDivision, setSelectedDivision] = useState<string>('All');
  const [activeKvaTab, setActiveKvaTab] = useState<'repaired' | 'under_repair' | 'scrap'>('repaired');

  // Fetch real jobs & oil transactions from Firestore
  const fetchDashboardData = async () => {
    if (!auth.currentUser || !activeAgency) {
      setJobs([]);
      setOilTransactions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // ⚠ THE ACTIVE TENDER (AUDIT F85). Every count on this screen is "how much work is in
      // each state RIGHT NOW", and right now means the tender being worked. A work list
      // showing eight jobs awaiting internal inspection, five of them under a closed tender,
      // is a number the operator cannot act on and should not be chasing.
      //
      // GUARANTEES ARE THE ONE EXCEPTION and are fetched agency-wide below - see
      // guaranteeStats. A GP claim is by definition against a PREVIOUS tender's repair, the
      // same reason New Job's GP lookup is not filtered either: scoping it to the current
      // tender would show zero the day after a rollover and hide the entire population that
      // panel exists to watch.
      // ONE AGENCY-WIDE READ, scoped in memory. The Dashboard's scope is a LOCAL control
      // that can be "all tenders", so re-querying on every change would cost a round trip
      // to answer a question the data already in hand can answer. It also removes the one
      // way a tender-scoped query and an agency-wide one can disagree: there is only one.
      const [allJobsSnap, allOilSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'jobs'),
          where('ownerId', '==', auth.currentUser.uid),
          where('agencyId', '==', activeAgency.id)
        )),
        getDocs(query(
          collection(db, 'oilTransactions'),
          where('ownerId', '==', auth.currentUser.uid),
          where('agencyId', '==', activeAgency.id)
        ))
      ]);

      const fetchedAllJobs = allJobsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const fetchedJobs = fetchedAllJobs;
      const fetchedOil = allOilSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAllAgencyJobs(fetchedAllJobs);

      // Sort newest jobs first
      fetchedJobs.sort((a: any, b: any) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });

      setJobs(fetchedJobs);
      setOilTransactions(fetchedOil);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [activeAgency?.id]);

  // Extract all available divisions from prefixes and real jobs
  const availableDivisions = useMemo(() => {
    const set = new Set<string>();
    const currentPrefixes = (activeAtMaster && activeAtMaster.prefixes && Object.keys(activeAtMaster.prefixes).length > 0) 
        ? activeAtMaster.prefixes 
        : (activeAgency?.prefixes || {});
    
    Object.keys(currentPrefixes).forEach(d => {
      if (d && d.trim()) set.add(d.trim());
    });

    jobs.forEach(j => {
      if (j.division && j.division.trim()) set.add(j.division.trim());
    });

    return Array.from(set).sort();
  }, [activeAtMaster, activeAgency, jobs]);

  // Filter jobs based on selected Division on top
  // ⚠ scopedJobs, NOT `jobs` (AUDIT F86). `jobs` now holds every tender's work - the fetch
  // is agency-wide so the local scope can switch without a round trip - and every count on
  // this screen must respect the scope the operator chose.
  const filteredJobs = useMemo(() => {
    if (selectedDivision === 'All') return scopedJobs;
    return scopedJobs.filter((j: any) => (j.division || '').trim().toLowerCase() === selectedDivision.trim().toLowerCase());
  }, [scopedJobs, selectedDivision]);

  // Primary Metrics and Pipeline Calculations
  const stats = useMemo(() => {
    let pendingExternal = 0;
    let pendingInternal = 0;
    let pendingTesting = 0;
    let readyForDispatch = 0;
    let dispatchedRepairable = 0;

    let scrapDeclared = 0;
    let scrapPendingDelivery = 0;
    let scrapDelivered = 0;

    let gpTotal = 0;
    let gpPending = 0;
    let gpDispatched = 0;
    let ogpTotal = 0;
    let ogpPending = 0;
    let ogpDispatched = 0;

    // Capacity mappings
    const repairedByKva: Record<number, { ready: number; dispatched: number; total: number }> = {};
    const underRepairByKva: Record<number, { awaitingExt: number; awaitingInt: number; awaitingTest: number; total: number }> = {};
    const scrapByKva: Record<number, { pendingDelivery: number; delivered: number; total: number }> = {};

    const mrSet = new Set<string>();

    filteredJobs.forEach(j => {
      if (j.mrNo) mrSet.add(j.mrNo);
      const cap = Number(j.capacityKva) || 0;
      const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
      const isGP = j.repairType === 'GP';

      // GP / OGP counters
      if (isGP) {
        gpTotal++;
        if (j.status === 'Dispatched') {
          gpDispatched++;
        } else if (!isScrap) {
          gpPending++;
        }
      } else {
        ogpTotal++;
        if (j.status === 'Dispatched') {
          ogpDispatched++;
        } else if (!isScrap) {
          ogpPending++;
        }
      }

      if (isScrap) {
        scrapDeclared++;
        const isDispatched = j.status === 'Dispatched' || j.isClosed === true;
        if (isDispatched) {
          scrapDelivered++;
        } else {
          scrapPendingDelivery++;
        }

        if (cap > 0) {
          if (!scrapByKva[cap]) scrapByKva[cap] = { pendingDelivery: 0, delivered: 0, total: 0 };
          scrapByKva[cap].total++;
          if (isDispatched) scrapByKva[cap].delivered++;
          else scrapByKva[cap].pendingDelivery++;
        }
      } else if (j.status === 'Dispatched') {
        dispatchedRepairable++;
        if (cap > 0) {
          if (!repairedByKva[cap]) repairedByKva[cap] = { ready: 0, dispatched: 0, total: 0 };
          repairedByKva[cap].dispatched++;
          repairedByKva[cap].total++;
        }
      } else if (j.status === 'Tested - Ready for Dispatch') {
        readyForDispatch++;
        if (cap > 0) {
          if (!repairedByKva[cap]) repairedByKva[cap] = { ready: 0, dispatched: 0, total: 0 };
          repairedByKva[cap].ready++;
          repairedByKva[cap].total++;
        }
      } else if (j.status === 'Internal Done') {
        pendingTesting++;
        if (cap > 0) {
          if (!underRepairByKva[cap]) underRepairByKva[cap] = { awaitingExt: 0, awaitingInt: 0, awaitingTest: 0, total: 0 };
          underRepairByKva[cap].awaitingTest++;
          underRepairByKva[cap].total++;
        }
      } else if (j.status === 'External Done') {
        pendingInternal++;
        if (cap > 0) {
          if (!underRepairByKva[cap]) underRepairByKva[cap] = { awaitingExt: 0, awaitingInt: 0, awaitingTest: 0, total: 0 };
          underRepairByKva[cap].awaitingInt++;
          underRepairByKva[cap].total++;
        }
      } else {
        pendingExternal++;
        if (cap > 0) {
          if (!underRepairByKva[cap]) underRepairByKva[cap] = { awaitingExt: 0, awaitingInt: 0, awaitingTest: 0, total: 0 };
          underRepairByKva[cap].awaitingExt++;
          underRepairByKva[cap].total++;
        }
      }
    });

    const totalRepaired = readyForDispatch + dispatchedRepairable;
    const totalUnderRepair = pendingExternal + pendingInternal + pendingTesting;

    return {
      totalJobs: filteredJobs.length,
      totalMrs: mrSet.size,
      totalRepaired,
      totalUnderRepair,
      pendingExternal,
      pendingInternal,
      pendingTesting,
      readyForDispatch,
      dispatchedRepairable,
      scrapDeclared,
      scrapPendingDelivery,
      scrapDelivered,
      gpTotal,
      gpPending,
      gpDispatched,
      ogpTotal,
      ogpPending,
      ogpDispatched,
      repairedByKva,
      underRepairByKva,
      scrapByKva
    };
  }, [filteredJobs]);

  // Division-wise distribution
  const divisionDistribution = useMemo(() => {
    const map: Record<string, { total: number; repaired: number; underRepair: number; scrap: number }> = {};
    jobs.forEach(j => {
      const div = (j.division || 'Unassigned').trim();
      if (!map[div]) map[div] = { total: 0, repaired: 0, underRepair: 0, scrap: 0 };
      map[div].total++;

      const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
      if (isScrap) {
        map[div].scrap++;
      } else if (j.status === 'Dispatched' || j.status === 'Tested - Ready for Dispatch') {
        map[div].repaired++;
      } else {
        map[div].underRepair++;
      }
    });
    return map;
  }, [jobs]);

  // Oil Accounting Summary
  const oilMetrics = useMemo(() => {
    let totalGrossLiters = 0;
    let totalBarrels = 0;

    scopedOil.forEach((tx: any) => {
      totalGrossLiters += Number(tx.grossLiters || 0);
      totalBarrels += Number(tx.barrels || 0);
    });

    const filtrationLoss = totalGrossLiters * 0.05;
    const netUsableLiters = totalGrossLiters - filtrationLoss;

    return {
      totalGrossLiters,
      totalBarrels,
      filtrationLoss,
      netUsableLiters,
      transactionCount: scopedOil.length
    };
  }, [scopedOil]);

  // Guarantee Monitoring
  const guaranteeStats = useMemo(() => {
    const now = Date.now();
    const eighteenMonthsMs = 18 * 30.4375 * 24 * 60 * 60 * 1000;
    let activeGuaranteeCount = 0;

    // ⚠ ACROSS ALL TENDERS, not `filteredJobs` (AUDIT F85). A unit dispatched under 26-27 is
    // inside its guarantee window for eighteen months, which outlives the tender. Counting
    // only the current tender's would empty this panel at every rollover and hide exactly
    // the units a guarantee claim will come back against.
    allAgencyJobs.forEach((j: any) => {
      if (j.status === 'Dispatched') {
        // Nothing ever writes `dispatchDate` - the dispatch batch writes deliveryDate
        // and challanDate. Reading the unwritten field fell through to `updatedAt`,
        // so any later edit to a dispatched job restarted its 18-month guarantee
        // clock. Read the fields that are actually written.
        const dispatchStamp = j.deliveryDate || j.challanDate;
        const dispatchTime = dispatchStamp
          ? new Date(dispatchStamp).getTime()
          : (j.updatedAt ? new Date(j.updatedAt).getTime() : now);
        if (now - dispatchTime <= eighteenMonthsMs) {
          activeGuaranteeCount++;
        }
      }
    });

    return { activeGuaranteeCount };
  }, [allAgencyJobs]);

  // Pending Backlog Items
  const pendingBacklog = useMemo(() => {
    return filteredJobs
      .filter(j => j.status !== 'Dispatched' && j.status !== 'Scrap')
      .slice(0, 5);
  }, [filteredJobs]);

  return (
    <div className="space-y-4 max-w-[1440px] mx-auto pb-10 px-1 sm:px-2">
      
      {/* THE DASHBOARD'S OWN SCOPE — local, and it changes nothing else (AUDIT F86).
          Same decision as the Estimate Master tender selector (F79): a control on a viewing
          screen must not change what the app works in. Defaults to the sidebar's tender;
          says so when the two differ. */}
      <div className="flex flex-wrap items-center gap-2 bg-white rounded-xl border border-slate-200 px-3 py-2">
        <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Showing</span>
        <select
          value={effectiveScope}
          onChange={e => setDashScope(e.target.value)}
          className="px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-300 bg-white text-slate-900"
        >
          <option value={DASH_ALL}>All tenders</option>
          {atMasters
            .filter(t => t.agencyId === activeAgency?.id)
            .slice()
            .sort((x, y) => (y.startDate || 0) - (x.startDate || 0))
            .map(t => (
              <option key={t.id} value={t.id}>
                AT {t.atNumber || t.name}
                {String(t.status || '').toLowerCase() === 'closed' ? ' — closed' : ''}
              </option>
            ))}
        </select>
        {showingAll && (
          <span className="text-[11px] font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
            totals across every tender
          </span>
        )}
        {dashDiverged && (
          <span className="text-[11px] text-amber-900 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded-full">
            Not the tender you are working in &mdash; New Job books against AT{' '}
            {activeAtMaster?.atNumber || activeAtMaster?.name}
          </span>
        )}
        {showingAll && activeAtMaster && (
          <span className="text-[11px] text-slate-600">
            New Job books against AT {activeAtMaster.atNumber || activeAtMaster.name}
          </span>
        )}
      </div>

      {/* 1. COMPACT HEADER & TOP DIVISION SELECTOR BAR */}
      <div className="bg-slate-900 rounded-xl sm:rounded-2xl p-3.5 sm:p-4 text-white shadow-md border border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img 
              src={appLogo} 
              alt="Logo" 
              className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl border border-blue-400/40 object-cover shrink-0" 
              referrerPolicy="no-referrer"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-black text-white truncate tracking-tight">
                  {activeAgency?.name || 'TR REP AGENCY'}
                </h1>
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  Circle: {activeAgency?.circleOfficeName || 'SABARMATI'}
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate">
                Live Workshop Dashboard &bull; {stats.totalJobs} Units ({stats.totalMrs} MRs)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link 
              to="/new-job" 
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg shadow-sm transition-all flex items-center justify-center gap-1.5 flex-1 sm:flex-none"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>+ New MR</span>
            </Link>
            <button 
              type="button"
              onClick={fetchDashboardData}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-all flex items-center justify-center"
              title="Refresh Data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* COMPACT SCROLLABLE DIVISION FILTER */}
        <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center gap-2 overflow-hidden">
          <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400 shrink-0 uppercase tracking-wider">
            <Filter className="w-3 h-3 text-cyan-400" />
            <span className="hidden xs:inline">Division:</span>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none text-xs flex-1 no-scrollbar">
            <button
              type="button"
              onClick={() => setSelectedDivision('All')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 shrink-0 ${
                selectedDivision === 'All'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
              }`}
            >
              <span>All Divisions</span>
              <span className="text-[10px] px-1.5 py-0.2 bg-black/30 rounded-full font-mono">
                {jobs.length}
              </span>
            </button>

            {availableDivisions.map(div => {
              const count = jobs.filter(j => (j.division || '').trim().toLowerCase() === div.toLowerCase()).length;
              const isSelected = selectedDivision.toLowerCase() === div.toLowerCase();
              return (
                <button
                  key={div}
                  type="button"
                  onClick={() => setSelectedDivision(div)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 shrink-0 ${
                    isSelected
                      ? 'bg-cyan-600 text-white shadow-xs'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                  }`}
                >
                  <span>{div}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${isSelected ? 'bg-black/30 text-white' : 'bg-slate-900 text-slate-400'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {selectedDivision !== 'All' && (
            <button
              type="button"
              onClick={() => setSelectedDivision('All')}
              className="text-[10px] text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-0.5 bg-cyan-950/60 border border-cyan-800/60 px-2 py-1 rounded-lg shrink-0"
              title="Reset Division Filter"
            >
              <RotateCcw className="w-2.5 h-2.5" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* 2. THE 4 HERO OPERATIONAL METRIC CARDS (COMPACT MOBILE 2x2 / DESKTOP 4-COL) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
        
        {/* 1. TRANSFORMER REPAIRED */}
        <div className="bg-white border border-emerald-200 rounded-xl p-3 sm:p-4 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] sm:text-xs font-black uppercase text-emerald-800 flex items-center gap-1 truncate">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="truncate">TRANSFORMER REPAIRED</span>
              </span>
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl sm:text-3xl font-black text-emerald-950 font-mono">{stats.totalRepaired}</span>
              <span className="text-[10px] text-slate-400">units</span>
            </div>

            <div className="grid grid-cols-2 gap-1 mt-2 pt-2 border-t border-emerald-100 text-[10px]">
              <div className="bg-emerald-50/70 p-1.5 rounded">
                <span className="text-slate-500 block leading-none">Ready</span>
                <span className="font-bold text-emerald-900 font-mono text-xs">{stats.readyForDispatch}</span>
              </div>
              <div className="bg-emerald-50/70 p-1.5 rounded">
                <span className="text-slate-500 block leading-none">Dispatched</span>
                <span className="font-bold text-emerald-900 font-mono text-xs">{stats.dispatchedRepairable}</span>
              </div>
            </div>
          </div>

          <Link to="/challan/new" className="mt-2.5 pt-1.5 border-t border-slate-100 text-[11px] text-emerald-700 font-bold flex items-center justify-between hover:underline">
            <span>Challan</span>
            <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        {/* 2. TRANSFORMER UNDER REPAIRING */}
        <div className="bg-white border border-blue-200 rounded-xl p-3 sm:p-4 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] sm:text-xs font-black uppercase text-blue-800 flex items-center gap-1 truncate">
                <Wrench className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="truncate">UNDER REPAIRING</span>
              </span>
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl sm:text-3xl font-black text-blue-950 font-mono">{stats.totalUnderRepair}</span>
              <span className="text-[10px] text-slate-400">units WIP</span>
            </div>

            <div className="grid grid-cols-3 gap-1 mt-2 pt-2 border-t border-blue-100 text-[10px] text-center">
              <div className="bg-blue-50/70 p-1 rounded">
                <span className="text-slate-500 block text-[9px] leading-none">Ext</span>
                <span className="font-bold text-blue-900 font-mono">{stats.pendingExternal}</span>
              </div>
              <div className="bg-amber-50/70 p-1 rounded">
                <span className="text-amber-700 block text-[9px] leading-none">Core</span>
                <span className="font-bold text-amber-900 font-mono">{stats.pendingInternal}</span>
              </div>
              <div className="bg-teal-50/70 p-1 rounded">
                <span className="text-teal-700 block text-[9px] leading-none">Test</span>
                <span className="font-bold text-teal-900 font-mono">{stats.pendingTesting}</span>
              </div>
            </div>
          </div>

          <Link to="/internal-inspection" className="mt-2.5 pt-1.5 border-t border-slate-100 text-[11px] text-blue-700 font-bold flex items-center justify-between hover:underline">
            <span>Floor WIP</span>
            <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        {/* 3. SCRAP DECLARED */}
        <div className="bg-white border border-rose-200 rounded-xl p-3 sm:p-4 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] sm:text-xs font-black uppercase text-rose-800 flex items-center gap-1 truncate">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span className="truncate">SCRAP DECLARED</span>
              </span>
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl sm:text-3xl font-black text-rose-950 font-mono">{stats.scrapDeclared}</span>
              <span className="text-[10px] text-slate-400">
                ({filteredJobs.length > 0 ? ((stats.scrapDeclared / filteredJobs.length) * 100).toFixed(0) : 0}%)
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1 mt-2 pt-2 border-t border-rose-100 text-[10px]">
              <div className="bg-amber-50/70 p-1.5 rounded">
                <span className="text-amber-800 block leading-none">In Yard</span>
                <span className="font-bold text-amber-950 font-mono text-xs">{stats.scrapPendingDelivery}</span>
              </div>
              <div className="bg-slate-100 p-1.5 rounded">
                <span className="text-slate-600 block leading-none">Returned</span>
                <span className="font-bold text-slate-900 font-mono text-xs">{stats.scrapDelivered}</span>
              </div>
            </div>
          </div>

          <Link to="/reports" className="mt-2.5 pt-1.5 border-t border-slate-100 text-[11px] text-rose-700 font-bold flex items-center justify-between hover:underline">
            <span>Scrap Report</span>
            <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        {/* 4. SCRAP PENDING TO DELIVERED */}
        <div className="bg-white border-2 border-amber-300 rounded-xl p-3 sm:p-4 shadow-xs flex flex-col justify-between bg-gradient-to-b from-amber-50/30 to-white">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] sm:text-xs font-black uppercase text-amber-900 flex items-center gap-1 truncate">
                <Truck className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span className="truncate">SCRAP PENDING DELIVERY</span>
              </span>
            </div>

            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl sm:text-3xl font-black text-amber-950 font-mono">{stats.scrapPendingDelivery}</span>
              <span className="text-[10px] text-amber-700">units to DISCOM</span>
            </div>

            <div className="mt-2 pt-2 border-t border-amber-200/60 text-[10px] text-amber-900 leading-tight">
              {stats.scrapPendingDelivery > 0 
                ? 'Condemned units in workshop awaiting return challan.'
                : 'All scrap units dispatched back to store.'}
            </div>
          </div>

          <Link to="/challan/new" className="mt-2.5 pt-1.5 border-t border-amber-200 text-[11px] text-amber-900 font-bold flex items-center justify-between hover:underline">
            <span>Generate Return Challan</span>
            <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

      </div>

      {/* 3. COMPACT LIVE WORKSHOP PIPELINE */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 shadow-xs">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-xs sm:text-sm font-bold text-slate-800 flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-blue-600" />
            <span>Live Workshop Lifecycle Stages</span>
          </h2>
          <span className="text-[11px] text-slate-500 font-mono font-bold">
            {stats.totalJobs} Active TRs
          </span>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 text-center">
          {/* 1. Intake */}
          <Link to="/external-inspection" className="p-2 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors">
            <span className="text-[9px] text-slate-500 uppercase block font-bold truncate">Ext. Insp</span>
            <span className="text-lg font-black text-slate-800 font-mono">{stats.pendingExternal}</span>
          </Link>

          {/* 2. Core/Wind */}
          <Link to="/internal-inspection" className="p-2 rounded-lg bg-amber-50/70 hover:bg-amber-100 border border-amber-200 transition-colors">
            <span className="text-[9px] text-amber-700 uppercase block font-bold truncate">Internal</span>
            <span className="text-lg font-black text-amber-900 font-mono">{stats.pendingInternal}</span>
          </Link>

          {/* 3. Testing */}
          <Link to="/testing-report" className="p-2 rounded-lg bg-teal-50/70 hover:bg-teal-100 border border-teal-200 transition-colors">
            <span className="text-[9px] text-teal-700 uppercase block font-bold truncate">Testing</span>
            <span className="text-lg font-black text-teal-900 font-mono">{stats.pendingTesting}</span>
          </Link>

          {/* 4. Ready */}
          <Link to="/challan/new" className="p-2 rounded-lg bg-blue-50/70 hover:bg-blue-100 border border-blue-200 transition-colors">
            <span className="text-[9px] text-blue-700 uppercase block font-bold truncate">Ready</span>
            <span className="text-lg font-black text-blue-900 font-mono">{stats.readyForDispatch}</span>
          </Link>

          {/* 5. Dispatched */}
          <Link to="/reports" className="p-2 rounded-lg bg-emerald-50/70 hover:bg-emerald-100 border border-emerald-200 transition-colors">
            <span className="text-[9px] text-emerald-700 uppercase block font-bold truncate">Delivered</span>
            <span className="text-lg font-black text-emerald-900 font-mono">{stats.dispatchedRepairable}</span>
          </Link>

          {/* 6. GP Guarantee */}
          <Link to="/mr-ledger" className="p-2 rounded-lg bg-amber-100/60 hover:bg-amber-200/60 border border-amber-300 transition-colors">
            <span className="text-[9px] text-amber-900 uppercase block font-bold truncate">GP (Wty)</span>
            <span className="text-lg font-black text-amber-950 font-mono">{stats.gpTotal}</span>
          </Link>

          {/* 7. Scrap */}
          <Link to="/reports" className="p-2 rounded-lg bg-rose-50/70 hover:bg-rose-100 border border-rose-200 transition-colors col-span-2 sm:col-span-1">
            <span className="text-[9px] text-rose-700 uppercase block font-bold truncate">Scrap</span>
            <span className="text-lg font-black text-rose-900 font-mono">{stats.scrapDeclared}</span>
          </Link>
        </div>
      </div>

      {/* 4. TABBED KVA BREAKDOWN MATRIX (COMPACT & MOBILE-FIRST) */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-3 border-b border-slate-100 pb-2.5">
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-indigo-600" />
              <span>KVA Capacity Breakdown Matrix</span>
            </h3>
          </div>

          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setActiveKvaTab('repaired')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all flex items-center gap-1 ${
                activeKvaTab === 'repaired'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CheckCircle2 className="w-3 h-3" />
              <span>Repaired ({stats.totalRepaired})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveKvaTab('under_repair')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all flex items-center gap-1 ${
                activeKvaTab === 'under_repair'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Wrench className="w-3 h-3" />
              <span>Under Repair ({stats.totalUnderRepair})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveKvaTab('scrap')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all flex items-center gap-1 ${
                activeKvaTab === 'scrap'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldAlert className="w-3 h-3" />
              <span>Scrap ({stats.scrapDeclared})</span>
            </button>
          </div>
        </div>

        {/* TAB 1: REPAIRED TABLE */}
        {activeKvaTab === 'repaired' && (
          <div className="overflow-x-auto">
            {Object.keys(stats.repairedByKva).length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400 bg-slate-50 rounded-lg">
                No Repaired transformers recorded yet.
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-emerald-50/70 text-emerald-900 border-b border-emerald-200">
                    <th className="py-2 px-2.5 font-bold">Capacity</th>
                    <th className="py-2 px-2.5 font-bold text-center">Ready in Workshop</th>
                    <th className="py-2 px-2.5 font-bold text-center">Dispatched</th>
                    <th className="py-2 px-2.5 font-bold text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(Object.entries(stats.repairedByKva) as [string, { ready: number; dispatched: number; total: number }][])
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([kva, data]) => (
                      <tr key={kva} className="hover:bg-emerald-50/30">
                        <td className="py-1.5 px-2.5 font-bold text-slate-900 font-mono">{kva} KVA</td>
                        <td className="py-1.5 px-2.5 text-center font-mono font-bold text-blue-700">{data.ready}</td>
                        <td className="py-1.5 px-2.5 text-center font-mono font-bold text-emerald-700">{data.dispatched}</td>
                        <td className="py-1.5 px-2.5 text-right font-black font-mono text-emerald-950">{data.total}</td>
                      </tr>
                    ))}
                  <tr className="bg-emerald-100/60 font-black text-emerald-950 border-t-2 border-emerald-300">
                    <td className="py-2 px-2.5">TOTAL</td>
                    <td className="py-2 px-2.5 text-center font-mono">{stats.readyForDispatch}</td>
                    <td className="py-2 px-2.5 text-center font-mono">{stats.dispatchedRepairable}</td>
                    <td className="py-2 px-2.5 text-right font-mono">{stats.totalRepaired} units</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* TAB 2: UNDER REPAIR TABLE */}
        {activeKvaTab === 'under_repair' && (
          <div className="overflow-x-auto">
            {Object.keys(stats.underRepairByKva).length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400 bg-slate-50 rounded-lg">
                No transformers currently under repair.
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-blue-50/70 text-blue-900 border-b border-blue-200">
                    <th className="py-2 px-2.5 font-bold">Capacity</th>
                    <th className="py-2 px-2.5 font-bold text-center">Ext. Insp</th>
                    <th className="py-2 px-2.5 font-bold text-center">Core & Wind</th>
                    <th className="py-2 px-2.5 font-bold text-center">Testing</th>
                    <th className="py-2 px-2.5 font-bold text-right">Total WIP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(Object.entries(stats.underRepairByKva) as [string, { awaitingExt: number; awaitingInt: number; awaitingTest: number; total: number }][])
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([kva, data]) => (
                      <tr key={kva} className="hover:bg-blue-50/30">
                        <td className="py-1.5 px-2.5 font-bold text-slate-900 font-mono">{kva} KVA</td>
                        <td className="py-1.5 px-2.5 text-center font-mono text-slate-700">{data.awaitingExt}</td>
                        <td className="py-1.5 px-2.5 text-center font-mono text-amber-700 font-bold">{data.awaitingInt}</td>
                        <td className="py-1.5 px-2.5 text-center font-mono text-teal-700 font-bold">{data.awaitingTest}</td>
                        <td className="py-1.5 px-2.5 text-right font-black font-mono text-blue-950">{data.total}</td>
                      </tr>
                    ))}
                  <tr className="bg-blue-100/60 font-black text-blue-950 border-t-2 border-blue-300">
                    <td className="py-2 px-2.5">TOTAL WIP</td>
                    <td className="py-2 px-2.5 text-center font-mono">{stats.pendingExternal}</td>
                    <td className="py-2 px-2.5 text-center font-mono">{stats.pendingInternal}</td>
                    <td className="py-2 px-2.5 text-center font-mono">{stats.pendingTesting}</td>
                    <td className="py-2 px-2.5 text-right font-mono">{stats.totalUnderRepair} units</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* TAB 3: SCRAP TABLE */}
        {activeKvaTab === 'scrap' && (
          <div className="overflow-x-auto">
            {Object.keys(stats.scrapByKva).length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400 bg-slate-50 rounded-lg">
                Zero Scrap transformers recorded.
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-rose-50/70 text-rose-900 border-b border-rose-200">
                    <th className="py-2 px-2.5 font-bold">Capacity</th>
                    <th className="py-2 px-2.5 font-bold text-center text-amber-900">Scrap Pending Delivery</th>
                    <th className="py-2 px-2.5 font-bold text-center">Returned Store</th>
                    <th className="py-2 px-2.5 font-bold text-right">Total Scrap</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(Object.entries(stats.scrapByKva) as [string, { pendingDelivery: number; delivered: number; total: number }][])
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([kva, data]) => (
                      <tr key={kva} className="hover:bg-rose-50/30">
                        <td className="py-1.5 px-2.5 font-bold text-slate-900 font-mono">{kva} KVA</td>
                        <td className="py-1.5 px-2.5 text-center font-mono font-bold text-amber-900 bg-amber-100/50">{data.pendingDelivery}</td>
                        <td className="py-1.5 px-2.5 text-center font-mono text-slate-700">{data.delivered}</td>
                        <td className="py-1.5 px-2.5 text-right font-black font-mono text-rose-950">{data.total}</td>
                      </tr>
                    ))}
                  <tr className="bg-rose-100/60 font-black text-rose-950 border-t-2 border-rose-300">
                    <td className="py-2 px-2.5">TOTAL SCRAP</td>
                    <td className="py-2 px-2.5 text-center font-mono text-amber-900">{stats.scrapPendingDelivery}</td>
                    <td className="py-2 px-2.5 text-center font-mono">{stats.scrapDelivered}</td>
                    <td className="py-2 px-2.5 text-right font-mono">{stats.scrapDeclared} units</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* 5. COMPACT WORKSHOP SHORTCUTS (Mobile 3-col / Desktop 6-col) */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 shadow-xs">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-xs sm:text-sm font-bold text-slate-800">Quick Workshop Actions</h2>
          <Link to="/reports" className="text-[11px] font-bold text-blue-600 hover:underline">
            All Reports &rarr;
          </Link>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          <Link to="/new-job" className="p-2.5 bg-emerald-50/70 hover:bg-emerald-100 border border-emerald-200 rounded-lg text-center transition-colors">
            <span className="text-[10px] font-black text-emerald-800 block">MR INTAKE</span>
            <span className="text-[11px] text-emerald-950 font-bold block truncate mt-0.5">New Job</span>
          </Link>

          <Link to="/mr-ledger" className="p-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-center transition-colors">
            <span className="text-[10px] font-black text-slate-600 block">REGISTER</span>
            <span className="text-[11px] text-slate-900 font-bold block truncate mt-0.5">MR Ledger</span>
          </Link>

          <Link to="/external-inspection" className="p-2.5 bg-cyan-50/70 hover:bg-cyan-100 border border-cyan-200 rounded-lg text-center transition-colors">
            <span className="text-[10px] font-black text-cyan-800 block">INSPECTION</span>
            <span className="text-[11px] text-cyan-950 font-bold block truncate mt-0.5">External</span>
          </Link>

          <Link to="/internal-inspection" className="p-2.5 bg-amber-50/70 hover:bg-amber-100 border border-amber-200 rounded-lg text-center transition-colors">
            <span className="text-[10px] font-black text-amber-800 block">WINDING</span>
            <span className="text-[11px] text-amber-950 font-bold block truncate mt-0.5">Internal</span>
          </Link>

          <Link to="/testing-report" className="p-2.5 bg-teal-50/70 hover:bg-teal-100 border border-teal-200 rounded-lg text-center transition-colors">
            <span className="text-[10px] font-black text-teal-800 block">TESTING</span>
            <span className="text-[11px] text-teal-950 font-bold block truncate mt-0.5">Report</span>
          </Link>

          <Link to="/estimates/new" className="p-2.5 bg-purple-50/70 hover:bg-purple-100 border border-purple-200 rounded-lg text-center transition-colors">
            <span className="text-[10px] font-black text-purple-800 block">ESTIMATE</span>
            <span className="text-[11px] text-purple-950 font-bold block truncate mt-0.5">Rates</span>
          </Link>

          <Link to="/challan/new" className="p-2.5 bg-blue-50/70 hover:bg-blue-100 border border-blue-200 rounded-lg text-center transition-colors">
            <span className="text-[10px] font-black text-blue-800 block">DELIVERY</span>
            <span className="text-[11px] text-blue-950 font-bold block truncate mt-0.5">Challan</span>
          </Link>

          <Link to="/bills/new" className="p-2.5 bg-indigo-50/70 hover:bg-indigo-100 border border-indigo-200 rounded-lg text-center transition-colors">
            <span className="text-[10px] font-black text-indigo-800 block">INVOICE</span>
            <span className="text-[11px] text-indigo-950 font-bold block truncate mt-0.5">Billing</span>
          </Link>

          <Link to="/oil-inward" className="p-2.5 bg-sky-50/70 hover:bg-sky-100 border border-sky-200 rounded-lg text-center transition-colors">
            <span className="text-[10px] font-black text-sky-800 block">OIL</span>
            <span className="text-[11px] text-sky-950 font-bold block truncate mt-0.5">Ledger</span>
          </Link>

          <Link to="/reports" className="p-2.5 bg-rose-50/70 hover:bg-rose-100 border border-rose-200 rounded-lg text-center transition-colors">
            <span className="text-[10px] font-black text-rose-800 block">REPORTS</span>
            <span className="text-[11px] text-rose-950 font-bold block truncate mt-0.5">Hub</span>
          </Link>

          <Link to="/agency-settings?section=estimate-master" className="p-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg text-center transition-colors">
            <span className="text-[10px] font-black text-slate-700 block">MASTER</span>
            <span className="text-[11px] text-slate-900 font-bold block truncate mt-0.5">AT Rates</span>
          </Link>

          <Link to="/agency-settings" className="p-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-center transition-colors">
            <span className="text-[10px] font-black text-slate-600 block">SETTINGS</span>
            <span className="text-[11px] text-slate-900 font-bold block truncate mt-0.5">Agency</span>
          </Link>
        </div>
      </div>

      {/* 6. SECONDARY INSIGHTS GRID (ALLOTMENT, OIL, WARRANTY, DIVISION DISTRIBUTION & BACKLOG) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">

        {/* Card 1: Allotment Status */}
        {activeAtMaster && (
          <div className="md:col-span-2 lg:col-span-3">
            <AllotmentWidget atMaster={activeAtMaster} />
          </div>
        )}

        {/* Card 2: Guarantee Period (GP) & Warranty */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-amber-600" />
                <h3 className="text-xs font-bold text-slate-800">Guarantee Period (GP) & Warranty</h3>
              </div>
              <span className="text-[10px] font-bold px-1.5 py-0.2 bg-amber-100 text-amber-800 rounded">
                18 Months
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5 p-2 bg-amber-50/60 rounded-lg border border-amber-100 text-center mb-2.5">
              <div>
                <span className="text-[9px] text-slate-500 uppercase block">GP Intake</span>
                <span className="font-mono font-black text-amber-950 text-sm">{stats.gpTotal}</span>
              </div>
              <div className="border-x border-amber-200">
                <span className="text-[9px] text-amber-700 uppercase block">In Shop</span>
                <span className="font-mono font-black text-amber-700 text-sm">{stats.gpPending}</span>
              </div>
              <div>
                <span className="text-[9px] text-emerald-700 uppercase block">Delivered</span>
                <span className="font-mono font-black text-emerald-700 text-sm">{stats.gpDispatched}</span>
              </div>
            </div>

            <div className="space-y-1 text-[11px]">
              {/* ⚠ ACROSS ALL TENDERS, and it says so (AUDIT F85/F86). A unit dispatched
                  under 26-27 stays inside its guarantee window for eighteen months, which
                  outlives the tender - so this panel alone ignores the scope above. Unlabelled
                  it would read as this tender's figure and be wrong by every earlier tender. */}
              <div className="flex justify-between items-baseline gap-2">
                <span className="text-slate-500">
                  Active Warranty Cover:
                  <span className="ml-1 text-[9px] uppercase font-bold tracking-wide text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1 py-0.5">
                    across all tenders
                  </span>
                </span>
                <span className="font-bold text-slate-900">{guaranteeStats.activeGuaranteeCount} Units</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Standard OGP Intake:</span>
                <span className="font-bold text-slate-700">{stats.ogpTotal} Units ({stats.ogpPending} WIP)</span>
              </div>
            </div>
          </div>

          <Link to="/mr-ledger" className="mt-3 pt-2 border-t border-slate-100 text-[11px] text-amber-800 font-bold flex items-center justify-between hover:underline">
            <span>Filter GP Jobs in Ledger</span>
            <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Card 3: Oil Accounting */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Droplet className="w-4 h-4 text-sky-600" />
                <h3 className="text-xs font-bold text-slate-800">Oil Account Ledger</h3>
              </div>
              <Link to="/oil-inward" className="text-[10px] font-bold text-sky-600 hover:underline">
                Manage
              </Link>
            </div>

            {oilMetrics.transactionCount === 0 ? (
              <div className="bg-slate-50 p-3 rounded-lg text-center text-xs text-slate-400">
                No oil records logged yet.
              </div>
            ) : (
              <div className="space-y-1.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">Total Received:</span>
                  <span className="font-mono font-bold text-slate-900">{oilMetrics.totalGrossLiters.toLocaleString()} L ({oilMetrics.totalBarrels} bbl)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">5% Filtration Norm:</span>
                  <span className="font-mono text-red-600 font-bold">-{oilMetrics.filtrationLoss.toFixed(1)} L</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-slate-100">
                  <span className="font-bold text-slate-900">Net Usable:</span>
                  <span className="font-mono font-black text-emerald-600">{oilMetrics.netUsableLiters.toFixed(1)} L</span>
                </div>
              </div>
            )}
          </div>

          <Link to="/oil-inward" className="mt-3 pt-2 border-t border-slate-100 text-[11px] text-sky-700 font-bold flex items-center justify-between hover:underline">
            <span>Open Oil Statements</span>
            <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Card 4: Division Workload */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-cyan-600" />
                <h3 className="text-xs font-bold text-slate-800">Division Distribution</h3>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">{availableDivisions.length} Divs</span>
            </div>

            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {availableDivisions.map(div => {
                const data = divisionDistribution[div] || { total: 0, repaired: 0, underRepair: 0, scrap: 0 };
                const isCurrent = selectedDivision.toLowerCase() === div.toLowerCase();
                return (
                  <div
                    key={div}
                    onClick={() => setSelectedDivision(selectedDivision === div ? 'All' : div)}
                    className={`p-1.5 rounded-lg border text-xs cursor-pointer flex items-center justify-between transition-colors ${
                      isCurrent ? 'bg-cyan-50 border-cyan-300' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <span className="font-bold text-slate-800 truncate">{div}</span>
                    <div className="flex items-center gap-1 text-[10px]">
                      <span className="text-emerald-700 font-bold">{data.repaired}R</span>
                      <span className="text-blue-700 font-bold">{data.underRepair}W</span>
                      <span className="text-rose-700 font-bold">{data.scrap}S</span>
                      <span className="font-mono font-bold bg-white px-1 border rounded">{data.total}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-2 pt-1 text-[10px] text-slate-400 text-center">
            Tap any division to filter entire dashboard
          </div>
        </div>

      </div>

      {/* 7. ACTIVE BACKLOG ACTION QUEUE */}
      {pendingBacklog.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 shadow-xs">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-xs sm:text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-500" />
              <span>Pending Action Backlog</span>
            </h3>
            <Link to="/mr-ledger" className="text-[11px] font-bold text-blue-600 hover:underline">
              View All &rarr;
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            {pendingBacklog.map((job) => {
              let badgeColor = 'bg-slate-100 text-slate-800';
              let nextLink = '/external-inspection';
              let actionLabel = 'External';

              if (job.status === 'External Done') {
                badgeColor = 'bg-amber-100 text-amber-800';
                nextLink = '/internal-inspection';
                actionLabel = 'Internal';
              } else if (job.status === 'Internal Done') {
                badgeColor = 'bg-teal-100 text-teal-800';
                nextLink = '/testing-report';
                actionLabel = 'Testing';
              } else if (job.status === 'Tested - Ready for Dispatch') {
                badgeColor = 'bg-blue-100 text-blue-800';
                nextLink = '/challan/new';
                actionLabel = 'Challan';
              }

              return (
                <Link 
                  key={job.id} 
                  to={nextLink}
                  className="p-2.5 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 flex flex-col justify-between transition-colors group"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-900 truncate">{job.jobNo || 'TR'}</span>
                    <span className="text-[10px] font-mono text-slate-500 font-bold">{job.capacityKva || '-'} KVA</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
                    <span className="truncate">{job.division || '-'}</span>
                    <span className={`px-1 rounded font-bold ${badgeColor}`}>{actionLabel}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
