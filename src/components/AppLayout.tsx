import { Link, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAgency } from '../lib/AgencyContext';
import { LogOut, Settings, Building2 } from 'lucide-react';
import { User, signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import appLogo from '../assets/images/transformer_app_logo_1786648240128.jpg';
import Dashboard from './Dashboard';
import NewJob from './NewJob';
import EditJob from './EditJob';
import MrLedger from './MrLedger';
import ExternalInspection from './ExternalInspection';
import InternalInspection from './InternalInspection';
import TestingReport from './TestingReport';
import EstimateGenerate from './EstimateGenerate';
import DispatchChallan from './DispatchChallan';
import Reports from './Reports';
import EstimateMaster from './EstimateMaster';
import AgencySettings from './AgencySettings';
import BillingSystem from './BillingSystem';
import OilInward from './OilInward';

export default function AppLayout({ user }: { user: User }) {
  const { activeAgency, activeAtMaster } = useAgency();
  const location = useLocation();

  const handleLogout = () => {
    signOut(auth);
  };

  const navLinks = [
    { to: '/', label: 'Dashboard Overview' },
    { to: '/mr-ledger', label: 'MR Ledger (List)' },
    { to: '/new-job', label: 'Intake (MR Registry)' },
    { to: '/external-inspection', label: 'External Inspection' },
    { to: '/internal-inspection', label: 'Internal Inspection' },
    { to: '/testing-report', label: 'Testing Report' },
    { to: '/estimate-master', label: 'Estimate Master' },
    { to: '/estimates/new', label: 'Estimate Generate' },
    { to: '/challan/new', label: 'Delivery Challans' },
    { to: '/bills/new', label: 'Billing System' },
    { to: '/reports', label: 'Reports Hub' },
    { to: '/oil-inward', label: 'Oil Ledger' },
  ];

  return (
    <div className="h-screen bg-slate-50 flex overflow-hidden print:h-auto print:overflow-visible font-sans text-slate-900">
      
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 flex flex-col h-full border-r border-slate-800 shrink-0 print:hidden">
        <div className="p-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <img 
              src={appLogo} 
              alt="Transformer Logo" 
              className="w-10 h-10 rounded-lg object-cover border border-blue-500/30 shadow-sm" 
              referrerPolicy="no-referrer"
            />
            <div>
              <h1 className="text-white font-bold text-base tracking-wide leading-none">TR REP AGENCY</h1>
              <p className="text-slate-400 text-[10px] uppercase tracking-wider mt-1">Transformer Repair Portal</p>
            </div>
          </div>

          <div className="mt-4 flex flex-col space-y-2 bg-slate-800/50 p-3 rounded border border-slate-700/50">
            <span className="text-[10px] uppercase font-bold text-slate-400">Current Workspace</span>
            <div className="flex items-center space-x-2">
              <Building2 className="w-4 h-4 text-blue-400 shrink-0" />
              <span className="text-xs font-bold text-white truncate" title={activeAgency?.name || 'No Agency Selected'}>
                {activeAgency?.name || 'No Agency Selected'}
              </span>
            </div>
            {activeAgency && (
              <div className="flex items-center space-x-2 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                <span className="text-[10px] font-medium text-slate-300">Active</span>
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navLinks.map((link) => {
            const isActive = location.pathname === link.to || (link.to !== '/' && location.pathname.startsWith(link.to));
            return (
              <Link 
                key={link.to}
                to={link.to} 
                className={`px-4 py-2 rounded flex items-center gap-3 text-sm transition-colors ${
                  isActive ? 'bg-blue-600 text-white font-medium' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span>{link.label}</span>
              </Link>
            );
          })}
          
          <Link 
            to="/agency-settings" 
            className={`px-4 py-2 rounded flex items-center gap-3 text-sm transition-colors mt-8 border-t border-slate-800 pt-4 ${
              location.pathname === '/agency-settings' ? 'text-white bg-slate-800 font-medium' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Agency Settings</span>
          </Link>

        </nav>
      </aside>

      <main className="flex-1 flex flex-col h-full min-w-0 print:overflow-visible">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 print:hidden">
          <div className="flex gap-4 items-center">
            {activeAgency ? (
              <div className="flex items-center space-x-3">
                <img 
                  src={appLogo} 
                  alt="Logo" 
                  className="w-9 h-9 rounded-lg object-cover border border-blue-200 shadow-sm"
                  referrerPolicy="no-referrer"
                />
                <div>
                  <h2 className="text-sm font-bold text-slate-900 leading-tight">{activeAgency.name}</h2>
                  <p className="text-xs text-slate-500">
                    Active Workspace {activeAtMaster ? `• ${activeAtMaster.atNumber}` : ''}
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-sm font-semibold text-amber-600 flex items-center">
                <span className="w-2 h-2 rounded-full bg-amber-500 mr-2"></span>
                Please select an agency in Settings
              </div>
            )}
          </div>
          
          <div className="flex items-center space-x-4">
            <span className="text-sm font-medium text-slate-700">{user.email}</span>
            <button
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-full transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-auto print:overflow-visible p-6 print:p-0 relative">
          {!activeAgency && location.pathname !== '/agency-settings' && (
             <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] z-10 flex items-center justify-center p-6">
                <div className="bg-white p-6 rounded-lg shadow-xl border border-amber-200 max-w-md w-full text-center">
                   <Building2 className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                   <h3 className="text-lg font-bold text-slate-900 mb-2">No Active Agency</h3>
                   <p className="text-sm text-slate-600 mb-6">You need to select or create an agency before you can manage jobs.</p>
                   <Link to="/agency-settings" className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 transition-colors">
                     <Settings className="w-4 h-4 mr-2" /> Go to Settings
                   </Link>
                </div>
             </div>
          )}
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/mr-ledger" element={<MrLedger />} />
            <Route path="/new-job" element={<NewJob />} />
            <Route path="/edit-job/:jobId" element={<EditJob />} />
            <Route path="/external-inspection/:jobId?" element={<ExternalInspection />} />
            <Route path="/internal-inspection/:jobId?" element={<InternalInspection />} />
            <Route path="/testing-report/:jobId?" element={<TestingReport />} />
            <Route path="/estimate-master" element={<EstimateMaster />} />
            <Route path="/estimates/new" element={<EstimateGenerate />} />
            <Route path="/challan/new" element={<DispatchChallan />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/bills/new" element={<BillingSystem />} />
            <Route path="/oil-inward" element={<OilInward />} />
            <Route path="/agency-settings" element={<AgencySettings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
