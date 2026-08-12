import { Link } from 'react-router-dom';
import { useAgency, AtMaster } from '../lib/AgencyContext';
import { AllotmentWidget } from './AllotmentWidget';

export default function Dashboard() {
  const { activeAgency, activeAtMaster } = useAgency();
  
  const divisions = activeAgency ? Object.keys(activeAgency.prefixes || {}) : [];


  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-[1400px] mx-auto">
      <div className="lg:col-span-8 space-y-6">
        <div className="bg-white border border-slate-200 rounded p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-800 mb-2">Welcome to {activeAgency?.name || 'TR Rep Agency'}</h2>
          <p className="text-sm text-slate-600 mb-6">Manage your repair jobs, track material receipts, and generate reports.</p>
          
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
            <Link to="/mr-ledger" className="block p-4 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors group">
              <h3 className="font-bold text-blue-800 text-sm mb-1 group-hover:underline">MR Ledger</h3>
              <p className="text-xs text-blue-600">View and search Material Receipts (MR)</p>
            </Link>
            
            <Link to="/new-job" className="block p-4 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors group">
              <h3 className="font-bold text-emerald-800 text-sm mb-1 group-hover:underline">Intake (New MR)</h3>
              <p className="text-xs text-emerald-600">Register incoming transformers</p>
            </Link>

            <Link to="/estimates/new" className="block p-4 border border-amber-200 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors group">
              <h3 className="font-bold text-amber-800 text-sm mb-1 group-hover:underline">Generate Estimate</h3>
              <p className="text-xs text-amber-600">Create repair cost estimates</p>
            </Link>
            <Link to="/challan/new" className="block p-4 border border-purple-200 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors group">
              <h3 className="font-bold text-purple-800 text-sm mb-1 group-hover:underline">Delivery Challan</h3>
              <p className="text-xs text-purple-600">Dispatch tested transformers</p>
            </Link>
            <Link to="/reports" className="block p-4 border border-rose-200 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors group">
              <h3 className="font-bold text-rose-800 text-sm mb-1 group-hover:underline">Reports & Excel</h3>
              <p className="text-xs text-rose-600">Export Div-wise testing/delivery</p>
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
            <p className="text-xl font-bold mt-2">$12,450.00</p>
            <p className="text-[10px] opacity-60">Estimate Power Limit: $15,000.00</p>
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
