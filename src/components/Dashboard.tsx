import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAgency } from '../lib/AgencyContext';
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
  AlertCircle, 
  ArrowRight, 
  RefreshCw, 
  Layers, 
  Activity,
  Calendar,
  Sparkles,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';
import appLogo from '../assets/images/transformer_app_logo_1786648240128.jpg';
import heroBg from '../assets/images/transformer_hero_bg_1786648256385.jpg';

export default function Dashboard() {
  const { activeAgency, activeAtMaster } = useAgency();
  
  const [jobs, setJobs] = useState<any[]>([]);
  const [oilTransactions, setOilTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
      const [jobsSnap, oilSnap] = await Promise.all([
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

      const fetchedJobs = jobsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const fetchedOil = oilSnap.docs.map(d => ({ id: d.id, ...d.data() }));

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

  const currentPrefixes = (activeAtMaster && activeAtMaster.prefixes && Object.keys(activeAtMaster.prefixes).length > 0) 
      ? activeAtMaster.prefixes 
      : (activeAgency?.prefixes || {});
  const divisions = Object.keys(currentPrefixes);

  // 1. Real Pipeline Calculations
  const stats = useMemo(() => {
    let pendingExternal = 0;
    let pendingInternal = 0;
    let pendingTesting = 0;
    let readyForDispatch = 0;
    let dispatched = 0;
    let scrap = 0;

    // Unique MR Count
    const mrSet = new Set<string>();

    // Capacity distribution map
    const capacityCounts: Record<number, number> = {};

    jobs.forEach(j => {
      if (j.mrNo) mrSet.add(j.mrNo);
      if (j.capacityKva) {
        const cap = Number(j.capacityKva);
        capacityCounts[cap] = (capacityCounts[cap] || 0) + 1;
      }

      const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
      if (isScrap) {
        scrap++;
      } else if (j.status === 'Dispatched') {
        dispatched++;
      } else if (j.status === 'Tested - Ready for Dispatch') {
        readyForDispatch++;
      } else if (j.status === 'Internal Done') {
        pendingTesting++;
      } else if (j.status === 'External Done') {
        pendingInternal++;
      } else {
        pendingExternal++;
      }
    });

    return {
      totalJobs: jobs.length,
      totalMrs: mrSet.size,
      pendingExternal,
      pendingInternal,
      pendingTesting,
      readyForDispatch,
      dispatched,
      scrap,
      capacityCounts
    };
  }, [jobs]);

  // 2. Real Oil Accounting Summary (Sum from real Firestore records)
  const oilMetrics = useMemo(() => {
    let totalGrossLiters = 0;
    let totalBarrels = 0;

    oilTransactions.forEach((tx: any) => {
      const gross = Number(tx.grossLiters || 0);
      const barrels = Number(tx.barrels || 0);
      totalGrossLiters += gross;
      totalBarrels += barrels;
    });

    const filtrationLoss = totalGrossLiters * 0.05;
    const netUsableLiters = totalGrossLiters - filtrationLoss;

    return {
      totalGrossLiters,
      totalBarrels,
      filtrationLoss,
      netUsableLiters,
      transactionCount: oilTransactions.length
    };
  }, [oilTransactions]);

  // 3. Real Guarantee Monitoring
  const guaranteeStats = useMemo(() => {
    const now = Date.now();
    const eighteenMonthsMs = 18 * 30.4375 * 24 * 60 * 60 * 1000;
    let activeGuaranteeCount = 0;

    jobs.forEach(j => {
      if (j.status === 'Dispatched') {
        const dispatchTime = j.dispatchDate 
          ? new Date(j.dispatchDate).getTime() 
          : (j.updatedAt ? new Date(j.updatedAt).getTime() : now);
        if (now - dispatchTime <= eighteenMonthsMs) {
          activeGuaranteeCount++;
        }
      }
    });

    return {
      activeGuaranteeCount,
      fixedMonths: 18
    };
  }, [jobs]);

  // 4. Real Pending Backlog Items (Active jobs needing action)
  const pendingBacklog = useMemo(() => {
    return jobs
      .filter(j => j.status !== 'Dispatched' && j.status !== 'Scrap')
      .slice(0, 5);
  }, [jobs]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-[1400px] mx-auto pb-10">
      
      {/* Landing Banner Header */}
      <div className="lg:col-span-12 bg-slate-900 rounded-2xl overflow-hidden shadow-xl relative border border-slate-800">
        <div className="absolute inset-0 opacity-25 mix-blend-overlay">
          <img 
            src={heroBg} 
            alt="Transformer Workshop" 
            className="w-full h-full object-cover object-center" 
            referrerPolicy="no-referrer"
          />
        </div>
        <div className="relative z-10 p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 bg-gradient-to-r from-slate-950 via-slate-900/95 to-slate-900/80">
          <div className="flex items-center gap-5">
            <img 
              src={appLogo} 
              alt="Transformer Logo" 
              className="w-20 h-20 rounded-2xl border-2 border-blue-500/40 shadow-md object-cover shrink-0" 
              referrerPolicy="no-referrer"
            />
            <div>
              <div className="inline-flex items-center gap-2 bg-blue-500/20 border border-blue-500/30 px-3 py-1 rounded-full text-blue-300 text-xs font-bold mb-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                Live Workshop Portal &bull; Real Database Sync
              </div>
              <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">
                {activeAgency?.name || 'TR REP AGENCY'}
              </h1>
              <p className="text-slate-300 text-xs md:text-sm mt-1 max-w-xl">
                Distribution Transformer Repair & Testing &bull; Circle: <span className="text-white font-semibold">{activeAgency?.circleOfficeName || 'SABARMATI'}</span> &bull; {divisions.length} Division Zones
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 w-full md:w-auto shrink-0">
            <Link 
              to="/new-job" 
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all text-center flex-1 md:flex-none flex items-center justify-center gap-2"
            >
              <PlusCircle className="w-4 h-4" />
              + Register New MR Intake
            </Link>
            <button 
              type="button"
              onClick={fetchDashboardData}
              className="px-3.5 py-2.5 bg-slate-800/90 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl border border-slate-700 transition-all flex items-center justify-center gap-2"
              title="Refresh Real Data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Real Content Column (8 cols) */}
      <div className="lg:col-span-8 space-y-6">

        {/* Real Live Workshop Stage Stats */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-600" />
                Live Workshop Transformer Pipeline
              </h2>
              <p className="text-xs text-slate-500">Live counts calculated from active Firestore records for {activeAgency?.name}</p>
            </div>
            <span className="text-xs font-bold px-3 py-1 bg-slate-100 text-slate-700 rounded-full border border-slate-200">
              {stats.totalJobs} Total Units ({stats.totalMrs} MR Lots)
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {/* Intake / Pending External */}
            <Link 
              to="/external-inspection" 
              className="p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-all group flex flex-col justify-between"
            >
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Awaiting Ext.</span>
              <div className="my-1">
                <span className="text-2xl font-black text-slate-800">{stats.pendingExternal}</span>
              </div>
              <span className="text-[10px] text-blue-600 font-bold flex items-center gap-1 group-hover:underline">
                Inspect <ChevronRight className="w-3 h-3" />
              </span>
            </Link>

            {/* Awaiting Internal */}
            <Link 
              to="/internal-inspection" 
              className="p-3 bg-amber-50/80 hover:bg-amber-100/90 border border-amber-200 rounded-xl transition-all group flex flex-col justify-between"
            >
              <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Internal Insp.</span>
              <div className="my-1">
                <span className="text-2xl font-black text-amber-900">{stats.pendingInternal}</span>
              </div>
              <span className="text-[10px] text-amber-700 font-bold flex items-center gap-1 group-hover:underline">
                Core & Wind <ChevronRight className="w-3 h-3" />
              </span>
            </Link>

            {/* Awaiting Testing */}
            <Link 
              to="/testing-report" 
              className="p-3 bg-teal-50/80 hover:bg-teal-100/90 border border-teal-200 rounded-xl transition-all group flex flex-col justify-between"
            >
              <span className="text-[10px] font-bold text-teal-700 uppercase tracking-wider">Awaiting Test</span>
              <div className="my-1">
                <span className="text-2xl font-black text-teal-900">{stats.pendingTesting}</span>
              </div>
              <span className="text-[10px] text-teal-700 font-bold flex items-center gap-1 group-hover:underline">
                Electrical <ChevronRight className="w-3 h-3" />
              </span>
            </Link>

            {/* Ready for Dispatch */}
            <Link 
              to="/challan/new" 
              className="p-3 bg-blue-50/80 hover:bg-blue-100/90 border border-blue-200 rounded-xl transition-all group flex flex-col justify-between"
            >
              <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Ready Dispatch</span>
              <div className="my-1">
                <span className="text-2xl font-black text-blue-900">{stats.readyForDispatch}</span>
              </div>
              <span className="text-[10px] text-blue-700 font-bold flex items-center gap-1 group-hover:underline">
                Challan <ChevronRight className="w-3 h-3" />
              </span>
            </Link>

            {/* Dispatched */}
            <Link 
              to="/reports" 
              className="p-3 bg-emerald-50/80 hover:bg-emerald-100/90 border border-emerald-200 rounded-xl transition-all group flex flex-col justify-between"
            >
              <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Dispatched</span>
              <div className="my-1">
                <span className="text-2xl font-black text-emerald-900">{stats.dispatched}</span>
              </div>
              <span className="text-[10px] text-emerald-700 font-bold flex items-center gap-1 group-hover:underline">
                Delivered <ChevronRight className="w-3 h-3" />
              </span>
            </Link>

            {/* Scrap */}
            <Link 
              to="/reports" 
              className="p-3 bg-rose-50/80 hover:bg-rose-100/90 border border-rose-200 rounded-xl transition-all group flex flex-col justify-between"
            >
              <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider">Scrap / GP</span>
              <div className="my-1">
                <span className="text-2xl font-black text-rose-900">{stats.scrap}</span>
              </div>
              <span className="text-[10px] text-rose-700 font-bold flex items-center gap-1 group-hover:underline">
                Declared <ChevronRight className="w-3 h-3" />
              </span>
            </Link>
          </div>
        </div>

        {/* Quick Operations Module Grid */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-slate-900">Workshop Modules & Operations</h2>
            <Link to="/reports" className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1">
              View Master Report Hub &rarr;
            </Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <Link to="/new-job" className="p-3.5 border border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100/80 rounded-xl transition-all group shadow-2xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-200/60 px-1.5 py-0.5 rounded">INTAKE</span>
                <h3 className="font-bold text-emerald-900 text-xs mt-1.5 group-hover:underline">MR Entry</h3>
                <p className="text-[11px] text-emerald-700 mt-0.5 leading-tight">Intake damaged TRs</p>
              </div>
            </Link>

            <Link to="/mr-ledger" className="p-3.5 border border-slate-200 bg-slate-50/60 hover:bg-slate-100 rounded-xl transition-all group shadow-2xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded">REGISTER</span>
                <h3 className="font-bold text-slate-800 text-xs mt-1.5 group-hover:underline">MR Register</h3>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">Search & filter logs</p>
              </div>
            </Link>

            <Link to="/external-inspection" className="p-3.5 border border-cyan-200 bg-cyan-50/60 hover:bg-cyan-100/80 rounded-xl transition-all group shadow-2xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-cyan-700 bg-cyan-200/60 px-1.5 py-0.5 rounded">INSPECTION</span>
                <h3 className="font-bold text-cyan-900 text-xs mt-1.5 group-hover:underline">External Insp.</h3>
                <p className="text-[11px] text-cyan-700 mt-0.5 leading-tight">Accessories & oil</p>
              </div>
            </Link>

            <Link to="/internal-inspection" className="p-3.5 border border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100/80 rounded-xl transition-all group shadow-2xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-indigo-700 bg-indigo-200/60 px-1.5 py-0.5 rounded">CORE/WIND</span>
                <h3 className="font-bold text-indigo-900 text-xs mt-1.5 group-hover:underline">Internal Insp.</h3>
                <p className="text-[11px] text-indigo-700 mt-0.5 leading-tight">HT/LT winding, core</p>
              </div>
            </Link>

            <Link to="/testing-report" className="p-3.5 border border-teal-200 bg-teal-50/60 hover:bg-teal-100/80 rounded-xl transition-all group shadow-2xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-teal-700 bg-teal-200/60 px-1.5 py-0.5 rounded">TESTING</span>
                <h3 className="font-bold text-teal-900 text-xs mt-1.5 group-hover:underline">Testing Report</h3>
                <p className="text-[11px] text-teal-700 mt-0.5 leading-tight">Losses, IR, Megger</p>
              </div>
            </Link>

            <Link to="/estimates/new" className="p-3.5 border border-amber-200 bg-amber-50/60 hover:bg-amber-100/80 rounded-xl transition-all group shadow-2xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-amber-700 bg-amber-200/60 px-1.5 py-0.5 rounded">ESTIMATE</span>
                <h3 className="font-bold text-amber-900 text-xs mt-1.5 group-hover:underline">Estimate Gen.</h3>
                <p className="text-[11px] text-amber-700 mt-0.5 leading-tight">AT rates & forward</p>
              </div>
            </Link>

            <Link to="/challan/new" className="p-3.5 border border-purple-200 bg-purple-50/60 hover:bg-purple-100/80 rounded-xl transition-all group shadow-2xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-purple-700 bg-purple-200/60 px-1.5 py-0.5 rounded">DISPATCH</span>
                <h3 className="font-bold text-purple-900 text-xs mt-1.5 group-hover:underline">Delivery Challan</h3>
                <p className="text-[11px] text-purple-700 mt-0.5 leading-tight">Dispatch tested TRs</p>
              </div>
            </Link>

            <Link to="/bills/new" className="p-3.5 border border-blue-200 bg-blue-50/60 hover:bg-blue-100/80 rounded-xl transition-all group shadow-2xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-blue-700 bg-blue-200/60 px-1.5 py-0.5 rounded">BILLING</span>
                <h3 className="font-bold text-blue-900 text-xs mt-1.5 group-hover:underline">Billing System</h3>
                <p className="text-[11px] text-blue-700 mt-0.5 leading-tight">GST Invoices & covering</p>
              </div>
            </Link>

            <Link to="/oil-inward" className="p-3.5 border border-sky-200 bg-sky-50/60 hover:bg-sky-100/80 rounded-xl transition-all group shadow-2xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-sky-700 bg-sky-200/60 px-1.5 py-0.5 rounded">OIL LEDGER</span>
                <h3 className="font-bold text-sky-900 text-xs mt-1.5 group-hover:underline">Oil Account</h3>
                <p className="text-[11px] text-sky-700 mt-0.5 leading-tight">Inward & 5% filtration</p>
              </div>
            </Link>

            <Link to="/reports" className="p-3.5 border border-rose-200 bg-rose-50/60 hover:bg-rose-100/80 rounded-xl transition-all group shadow-2xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-rose-700 bg-rose-200/60 px-1.5 py-0.5 rounded">REPORTS</span>
                <h3 className="font-bold text-rose-900 text-xs mt-1.5 group-hover:underline">Report Hub</h3>
                <p className="text-[11px] text-rose-700 mt-0.5 leading-tight">DISCOM analytics</p>
              </div>
            </Link>

            <Link to="/estimate-master" className="p-3.5 border border-slate-300 bg-slate-100/80 hover:bg-slate-200 rounded-xl transition-all group shadow-2xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-700 bg-slate-300/70 px-1.5 py-0.5 rounded">MASTER</span>
                <h3 className="font-bold text-slate-900 text-xs mt-1.5 group-hover:underline">Estimate Master</h3>
                <p className="text-[11px] text-slate-600 mt-0.5 leading-tight">KVA rates & schedules</p>
              </div>
            </Link>

            <Link to="/agency-settings" className="p-3.5 border border-slate-200 bg-white hover:bg-slate-50 rounded-xl transition-all group shadow-2xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">SETTINGS</span>
                <h3 className="font-bold text-slate-800 text-xs mt-1.5 group-hover:underline">Agencies & AT</h3>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">Tender prefixes & logos</p>
              </div>
            </Link>
          </div>
        </div>

        {/* Allotment Status Widget */}
        {activeAtMaster && divisions.length > 0 && (
          <AllotmentWidget atMaster={activeAtMaster} />
        )}

        {/* Real Oil Accounting & Real Guarantee Tracking Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 1. Real Oil Accounting */}
          <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-sky-50 text-sky-600 rounded-lg border border-sky-100">
                  <Droplet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Real Oil Accounting Ledger</h3>
                  <p className="text-[10px] text-slate-400">Calculated from {oilMetrics.transactionCount} inward entries</p>
                </div>
              </div>
              <Link to="/oil-inward" className="text-xs font-bold text-sky-600 hover:underline">
                Manage &rarr;
              </Link>
            </div>

            {oilMetrics.transactionCount === 0 ? (
              <div className="bg-slate-50 p-4 rounded-xl border border-dashed border-slate-200 text-center">
                <p className="text-xs text-slate-500">No Oil Inward records entered yet for this agency.</p>
                <Link to="/oil-inward" className="inline-block mt-2 px-3 py-1.5 bg-sky-600 text-white rounded-lg text-xs font-bold hover:bg-sky-500 transition-colors">
                  + Record Oil Inward
                </Link>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Total Received Oil:</span>
                  <span className="font-mono font-bold text-slate-900">{oilMetrics.totalGrossLiters.toLocaleString()} Litres ({oilMetrics.totalBarrels} Barrels)</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Filtration Loss (5% Norm):</span>
                  <span className="font-mono text-red-600 font-bold">-{oilMetrics.filtrationLoss.toFixed(1)} Litres</span>
                </div>
                <div className="flex justify-between text-xs pt-2 border-t border-dashed border-slate-200">
                  <span className="font-bold text-slate-900">Adjusted Usable Balance:</span>
                  <span className="font-mono font-black text-emerald-600">{oilMetrics.netUsableLiters.toFixed(1)} Litres</span>
                </div>
                <Link to="/oil-inward" className="block w-full mt-3 bg-slate-900 text-white text-[11px] py-2 rounded-xl font-bold uppercase text-center hover:bg-slate-800 transition-colors">
                  Open Oil Ledger & Shortage Statements
                </Link>
              </div>
            )}
          </section>
          
          {/* 2. Real Guarantee Monitoring */}
          <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-100">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Guarantee Period Tracker</h3>
                  <p className="text-[10px] text-slate-400">18-Month Standard DISCOM Warranty</p>
                </div>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
                Active Policy
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-slate-900">{guaranteeStats.activeGuaranteeCount}</span>
              <span className="text-xs text-slate-500">Units currently under active guarantee window</span>
            </div>
            
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-[11px] text-slate-500 leading-normal">
                {stats.dispatched > 0 
                  ? `${stats.dispatched} units total have been dispatched from this workshop. All dispatched units are tracked against their 18-month guarantee period.`
                  : `No transformers have been dispatched yet. Once units are dispatched via Delivery Challan, their 18-month guarantee timer is tracked automatically.`}
              </p>
            </div>
          </section>
        </div>
      </div>

      {/* Sidebar Real Activity & Pending Work Column (4 cols) */}
      <aside className="lg:col-span-4 space-y-6">

        {/* Real Pending Action Items */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-500" />
              Active Job Backlog ({pendingBacklog.length})
            </h3>
            <Link to="/mr-ledger" className="text-[11px] text-blue-600 font-semibold hover:underline">
              View All
            </Link>
          </div>

          {pendingBacklog.length === 0 ? (
            <div className="p-4 bg-emerald-50/60 border border-emerald-200/80 rounded-xl text-center">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto mb-1" />
              <p className="text-xs font-bold text-emerald-900">All Caught Up!</p>
              <p className="text-[11px] text-emerald-700 mt-0.5">No pending inspection or testing backlog in this agency.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {pendingBacklog.map((job) => {
                let badgeColor = 'bg-slate-100 text-slate-800 border-slate-300';
                let nextLink = '/external-inspection';
                let actionLabel = 'External Inspection';

                if (job.status === 'External Done') {
                  badgeColor = 'bg-amber-100 text-amber-800 border-amber-300';
                  nextLink = '/internal-inspection';
                  actionLabel = 'Internal Inspection';
                } else if (job.status === 'Internal Done') {
                  badgeColor = 'bg-teal-100 text-teal-800 border-teal-300';
                  nextLink = '/testing-report';
                  actionLabel = 'Testing Report';
                } else if (job.status === 'Tested - Ready for Dispatch') {
                  badgeColor = 'bg-blue-100 text-blue-800 border-blue-300';
                  nextLink = '/challan/new';
                  actionLabel = 'Generate Challan';
                }

                return (
                  <Link 
                    key={job.id} 
                    to={nextLink}
                    className="p-3 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200/80 block transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-slate-900 group-hover:text-blue-600">
                        {job.jobNo || 'Unassigned'} ({job.capacityKva || '-'} KVA)
                      </span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${badgeColor}`}>
                        {job.status || 'Received'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                      <span>MR: {job.mrNo || '-'} &bull; {job.division || 'Unknown'}</span>
                      <span className="text-blue-600 font-bold text-[10px] group-hover:underline">
                        Next: {actionLabel} &rarr;
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* Real Workshop Capacity Breakdown */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-blue-500" />
            Transformer Capacities in Workshop
          </h3>

          {Object.keys(stats.capacityCounts).length === 0 ? (
            <p className="text-xs text-slate-400 italic">No capacity records registered yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(stats.capacityCounts)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([kva, count]) => (
                  <div key={kva} className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700">{kva} KVA</span>
                    <span className="text-xs font-black bg-blue-100 text-blue-800 px-2 py-0.5 rounded-md">
                      {count} {count === 1 ? 'unit' : 'units'}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </section>

        {/* Real Agency Profile Card */}
        <section className="bg-gradient-to-br from-slate-900 to-slate-950 text-white rounded-2xl p-5 shadow-md border border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-cyan-400">Active Workshop Profile</span>
            <span className="text-[10px] bg-white/10 text-white px-2 py-0.5 rounded-full border border-white/20">
              Live Agency
            </span>
          </div>

          <h4 className="text-base font-bold text-white">{activeAgency?.name}</h4>
          <p className="text-xs text-slate-400 mt-1">{activeAgency?.address || 'Address configured in Agency Settings'}</p>

          <div className="mt-4 pt-3 border-t border-slate-800 space-y-1.5 text-xs text-slate-300">
            <div className="flex justify-between">
              <span className="text-slate-400">GSTIN:</span>
              <span className="font-mono text-white">{activeAgency?.gstin || 'Not set'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Circle Office:</span>
              <span className="text-white font-medium">{activeAgency?.circleOfficeName || 'SABARMATI'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Assigned Divisions:</span>
              <span className="text-cyan-300 font-bold">{divisions.length} Division(s)</span>
            </div>
          </div>

          <Link 
            to="/agency-settings" 
            className="mt-4 block text-center w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-colors shadow-sm"
          >
            Manage Agency Config
          </Link>
        </section>

      </aside>
    </div>
  );
}
