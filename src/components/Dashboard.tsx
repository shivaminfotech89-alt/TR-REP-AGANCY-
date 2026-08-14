import { Link } from 'react-router-dom';
import { useAgency } from '../lib/AgencyContext';
import { AllotmentWidget } from './AllotmentWidget';
import appLogo from '../assets/images/transformer_app_logo_1786648240128.jpg';
import heroBg from '../assets/images/transformer_hero_bg_1786648256385.jpg';

export default function Dashboard() {
  const { activeAgency, activeAtMaster } = useAgency();
  
  const currentPrefixes = (activeAtMaster && activeAtMaster.prefixes && Object.keys(activeAtMaster.prefixes).length > 0) 
      ? activeAtMaster.prefixes 
      : (activeAgency?.prefixes || {});
  const divisions = Object.keys(currentPrefixes);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-[1400px] mx-auto">
      {/* Landing Banner Header */}
      <div className="lg:col-span-12 bg-slate-900 rounded-xl overflow-hidden shadow-lg relative border border-slate-800">
        <div className="absolute inset-0 opacity-25 mix-blend-overlay">
          <img 
            src={heroBg} 
            alt="Transformer Workshop" 
            className="w-full h-full object-cover object-center" 
            referrerPolicy="no-referrer"
          />
        </div>
        <div className="relative z-10 p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 bg-gradient-to-r from-slate-950 via-slate-900/90 to-transparent">
          <div className="flex items-center gap-5">
            <img 
              src={appLogo} 
              alt="Transformer Logo" 
              className="w-20 h-20 rounded-2xl border-2 border-blue-500/30 shadow-md object-cover" 
              referrerPolicy="no-referrer"
            />
            <div>
              <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 px-3 py-1 rounded-full text-blue-400 text-xs font-semibold mb-2">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
                Distribution Transformer Repair & Overhaul Portal
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
                {activeAgency?.name || 'TR REP AGENCY'}
              </h1>
              <p className="text-slate-300 text-xs md:text-sm mt-1 max-w-xl">
                Comprehensive Management System for Distribution Transformer Inspection, Winding, Core Repair, Electrical Testing, Oil Shortage Accounting & Tax Billing.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 w-full md:w-auto">
            <Link 
              to="/new-job" 
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow transition-all text-center flex-1 md:flex-none"
            >
              + Register New MR Intake
            </Link>
            <Link 
              to="/estimates/new" 
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs uppercase tracking-wider rounded-lg border border-slate-700 transition-all text-center flex-1 md:flex-none"
            >
              Generate Estimate
            </Link>
          </div>
        </div>
      </div>

      <div className="lg:col-span-8 space-y-6">
        <div className="bg-white border border-slate-200 rounded p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-800 mb-2">Welcome to {activeAgency?.name || 'TR Rep Agency'}</h2>
          <p className="text-sm text-slate-600 mb-6">Manage your repair jobs, track material receipts, and generate reports.</p>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            <Link to="/new-job" className="p-3.5 border border-emerald-200 bg-emerald-50/80 hover:bg-emerald-100/90 rounded-xl transition-all group shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-200/60 px-1.5 py-0.5 rounded">INTAKE</span>
                <h3 className="font-bold text-emerald-900 text-xs mt-1.5 group-hover:underline">MR Entry</h3>
                <p className="text-[11px] text-emerald-700 mt-0.5 leading-tight">Intake damaged TRs</p>
              </div>
            </Link>

            <Link to="/mr-ledger" className="p-3.5 border border-slate-300 bg-white hover:bg-slate-50 rounded-xl transition-all group shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">REGISTER</span>
                <h3 className="font-bold text-slate-800 text-xs mt-1.5 group-hover:underline">MR Register</h3>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">Search & filter intake logs</p>
              </div>
            </Link>

            <Link to="/external-inspection" className="p-3.5 border border-cyan-200 bg-cyan-50/80 hover:bg-cyan-100/90 rounded-xl transition-all group shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-cyan-700 bg-cyan-200/60 px-1.5 py-0.5 rounded">INSPECTION</span>
                <h3 className="font-bold text-cyan-900 text-xs mt-1.5 group-hover:underline">External Insp.</h3>
                <p className="text-[11px] text-cyan-700 mt-0.5 leading-tight">Physical accessories & oil</p>
              </div>
            </Link>

            <Link to="/internal-inspection" className="p-3.5 border border-indigo-200 bg-indigo-50/80 hover:bg-indigo-100/90 rounded-xl transition-all group shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-indigo-700 bg-indigo-200/60 px-1.5 py-0.5 rounded">CORE & WINDING</span>
                <h3 className="font-bold text-indigo-900 text-xs mt-1.5 group-hover:underline">Internal Insp.</h3>
                <p className="text-[11px] text-indigo-700 mt-0.5 leading-tight">HT/LT winding, core & limbs</p>
              </div>
            </Link>

            <Link to="/testing-report" className="p-3.5 border border-teal-200 bg-teal-50/80 hover:bg-teal-100/90 rounded-xl transition-all group shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-teal-700 bg-teal-200/60 px-1.5 py-0.5 rounded">TESTING</span>
                <h3 className="font-bold text-teal-900 text-xs mt-1.5 group-hover:underline">Testing Report</h3>
                <p className="text-[11px] text-teal-700 mt-0.5 leading-tight">Losses, IR, ratio & megger</p>
              </div>
            </Link>

            <Link to="/estimates/new" className="p-3.5 border border-amber-200 bg-amber-50/80 hover:bg-amber-100/90 rounded-xl transition-all group shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-amber-700 bg-amber-200/60 px-1.5 py-0.5 rounded">ESTIMATE</span>
                <h3 className="font-bold text-amber-900 text-xs mt-1.5 group-hover:underline">Estimate Gen.</h3>
                <p className="text-[11px] text-amber-700 mt-0.5 leading-tight">AT rates & forward letter</p>
              </div>
            </Link>

            <Link to="/challan/new" className="p-3.5 border border-purple-200 bg-purple-50/80 hover:bg-purple-100/90 rounded-xl transition-all group shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-purple-700 bg-purple-200/60 px-1.5 py-0.5 rounded">DISPATCH</span>
                <h3 className="font-bold text-purple-900 text-xs mt-1.5 group-hover:underline">Delivery Challan</h3>
                <p className="text-[11px] text-purple-700 mt-0.5 leading-tight">Dispatch tested TRs</p>
              </div>
            </Link>

            <Link to="/bills/new" className="p-3.5 border border-blue-200 bg-blue-50/80 hover:bg-blue-100/90 rounded-xl transition-all group shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-blue-700 bg-blue-200/60 px-1.5 py-0.5 rounded">BILLING</span>
                <h3 className="font-bold text-blue-900 text-xs mt-1.5 group-hover:underline">Billing System</h3>
                <p className="text-[11px] text-blue-700 mt-0.5 leading-tight">GST Invoices & covering</p>
              </div>
            </Link>

            {/* Oil Account placed right after Billing System */}
            <Link to="/oil-inward" className="p-3.5 border border-sky-200 bg-sky-50/80 hover:bg-sky-100/90 rounded-xl transition-all group shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-sky-700 bg-sky-200/60 px-1.5 py-0.5 rounded">OIL LEDGER</span>
                <h3 className="font-bold text-sky-900 text-xs mt-1.5 group-hover:underline">Oil Account</h3>
                <p className="text-[11px] text-sky-700 mt-0.5 leading-tight">Inward oil & 5% filtration</p>
              </div>
            </Link>

            <Link to="/reports" className="p-3.5 border border-rose-200 bg-rose-50/80 hover:bg-rose-100/90 rounded-xl transition-all group shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-rose-700 bg-rose-200/60 px-1.5 py-0.5 rounded">HUB</span>
                <h3 className="font-bold text-rose-900 text-xs mt-1.5 group-hover:underline">Report Hub</h3>
                <p className="text-[11px] text-rose-700 mt-0.5 leading-tight">Monthly DISCOM analytics</p>
              </div>
            </Link>

            <Link to="/estimate-master" className="p-3.5 border border-slate-300 bg-slate-100/90 hover:bg-slate-200 rounded-xl transition-all group shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-700 bg-slate-300/70 px-1.5 py-0.5 rounded">MASTER</span>
                <h3 className="font-bold text-slate-900 text-xs mt-1.5 group-hover:underline">Estimate Master</h3>
                <p className="text-[11px] text-slate-600 mt-0.5 leading-tight">KVA rates & item schedule</p>
              </div>
            </Link>
          </div>
        </div>

        {/* Allotment Status Widget */}
        {activeAtMaster && divisions.length > 0 && (
          <AllotmentWidget atMaster={activeAtMaster} />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <section className="bg-white border border-slate-200 rounded p-4">
            <h3 className="text-xs font-bold uppercase text-slate-500 mb-4">Oil Accounting Ledger</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Received Qty:</span>
                <span className="font-mono">1,200 Litres</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Filtration Loss (5%):</span>
                <span className="font-mono text-red-500">-60.0 Litres</span>
              </div>
              <div className="flex justify-between text-xs pt-2 border-t border-dashed">
                <span className="font-bold">Adjusted Receivable:</span>
                <span className="font-mono font-bold">1,140 Litres</span>
              </div>
              <Link to="/oil-inward" className="block w-full mt-2 bg-slate-900 text-white text-[10px] py-2 rounded font-bold uppercase text-center hover:bg-slate-800 transition-colors">
                View Oil Shortage Report
              </Link>
            </div>
          </section>
          
          <section className="bg-white border border-slate-200 rounded p-4">
            <h3 className="text-xs font-bold uppercase text-slate-500 mb-4">Guarantee Monitoring</h3>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-bold">18</span>
              <span className="text-xs text-slate-500 mb-1">Months Fixed Period</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-2 leading-tight">GP Return Policy: Use existing Job No. Internal inspection required only for scrap declaration.</p>
          </section>
        </div>
      </div>

      <aside className="lg:col-span-4 space-y-6">
        <section className="bg-slate-900 text-white rounded p-5 shadow-lg relative overflow-hidden">
          <div className="relative z-10">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-blue-400">Circle Office Approval</h3>
            <p className="text-xl font-bold mt-2">₹1,24,500.00</p>
            <p className="text-[10px] opacity-60">Estimate Power Limit: ₹1,50,000.00</p>
            <div className="mt-4 h-1 w-full bg-slate-700 rounded-full">
              <div className="h-full bg-blue-500 rounded-full w-[83%]"></div>
            </div>
            <Link to="/estimates/new" className="block text-center mt-6 w-full border border-blue-400 text-blue-400 py-2 rounded text-[10px] font-bold uppercase hover:bg-blue-400 hover:text-slate-900 transition-colors">
              Generate New Estimate
            </Link>
          </div>
          <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-blue-500 opacity-10 rounded-full"></div>
        </section>

        <section className="bg-white border border-slate-200 rounded p-4">
          <h3 className="text-xs font-bold uppercase text-slate-500 mb-3">Pending Tasks</h3>
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="w-1 bg-orange-400 rounded"></div>
              <div>
                <p className="text-xs font-bold">Upload SP Estimate.pdf</p>
                <p className="text-[10px] text-slate-400">Job: TR-2023-892 • North Division</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-1 bg-blue-400 rounded"></div>
              <div>
                <p className="text-xs font-bold">Create Dispatch Challan</p>
                <p className="text-[10px] text-slate-400">MR-5510 • Completed Unit</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-1 bg-red-400 rounded"></div>
              <div>
                <p className="text-xs font-bold">Declare Non-Repairable</p>
                <p className="text-[10px] text-slate-400">GP-2022-104 • Scrap Report Needed</p>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-blue-50 border border-blue-100 rounded p-4">
          <div className="flex justify-between items-start">
            <div>
              <h4 className="text-blue-800 text-xs font-bold">Quick Billing</h4>
              <p className="text-[10px] text-blue-600 mt-1">Generate SP Bill & Letter for approved estimates.</p>
              <Link to="/bills/new" className="mt-3 inline-block text-[10px] font-bold text-blue-700 uppercase hover:underline">
                Create Bill &rarr;
              </Link>
            </div>
            <div className="text-blue-200">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"></path></svg>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}

