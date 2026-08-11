import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useSearchParams } from 'react-router-dom';
import { auth } from './lib/firebase';
import { onAuthStateChanged, User, signOut, getRedirectResult } from 'firebase/auth';
import { AgencyProvider, useAgency } from './lib/AgencyContext';
import Dashboard from './components/Dashboard';
import NewJob from './components/NewJob';
import ExternalInspection from './components/ExternalInspection';
import InternalInspection from './components/InternalInspection';
import TestingReport from './components/TestingReport';
import EstimateGenerate from './components/EstimateGenerate';
import AgencySettings from './components/AgencySettings';
import BillGenerate from './components/BillGenerate';
import OilAccount from './components/OilAccount';
import ChallanGenerate from './components/ChallanGenerate';
import LoginScreen from './components/LoginScreen';
import DataModification from './components/DataModification';
import ApprovalAmount from './components/ApprovalAmount';
import ChangeDivision from './components/ChangeDivision';
import ModulePlaceholder from './components/ModulePlaceholder';
import { LogOut, Loader2, LayoutDashboard, ClipboardList, FileEdit, FileSearch, FileSpreadsheet, FileText, Droplet, Truck, Settings, BadgeIndianRupee, Building2 } from 'lucide-react';

function CoreJobsRedirect() {
  const [params] = useSearchParams();
  const core = params.get('core') || '';
  return (
    <ModulePlaceholder
      title={core ? `${core} Entry` : 'Special Core Entry'}
      hint={`Use New Job Entry and set transformer type/core to ${core || 'Amorphous / Wound'}. Dedicated form coming next.`}
    />
  );
}

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const { activeAgency } = useAgency();
  const [division, setDivision] = useState(localStorage.getItem('activeDivision') || '');

  useEffect(() => {
    const first = activeAgency ? Object.keys(activeAgency.prefixes || {})[0] : '';
    if (!division && first) setDivision(first);
  }, [activeAgency, division]);

  const nav = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/new-job', label: 'New Job Entry', icon: ClipboardList },
    { to: '/external-inspection', label: 'OGP External', icon: FileEdit },
    { to: '/internal-inspection', label: 'OGP Internal', icon: FileSearch },
    { to: '/data-modification', label: 'Data Modification', icon: FileEdit },
    { to: '/estimates/new', label: 'Estimate Generate', icon: FileSpreadsheet },
    { to: '/approval-amount', label: 'Approval Amount', icon: BadgeIndianRupee },
    { to: '/bills/new', label: 'Bill Generate', icon: FileText },
    { to: '/oil-inward', label: 'Oil Inward', icon: Droplet },
    { to: '/challans/new', label: 'Challan Generate', icon: Truck },
    { to: '/change-division', label: 'Change Division', icon: Building2 },
    { to: '/agency-settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="h-screen bg-slate-100 flex overflow-hidden">
      <aside className="w-56 bg-slate-950 flex flex-col h-full shrink-0 no-print">
        <div className="p-4 border-b border-slate-800">
          <h1 className="text-white font-bold text-sm tracking-[0.12em]">TR REP AGANCY</h1>
          <p className="text-slate-500 text-[10px] uppercase tracking-widest mt-1 truncate">
            {activeAgency?.name || 'Ideal Engineering Co.'}
          </p>
          <div className="mt-2 text-[11px] font-semibold text-amber-300 bg-slate-900 border border-slate-800 px-2 py-1 rounded">
            DIV: {division || '—'}
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2 px-2.5 py-2 rounded text-[11px] font-medium transition-colors ${
                  isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                }`
              }
            >
              <item.icon className="w-3.5 h-3.5 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="flex-1 flex flex-col h-full min-w-0">
        <header className="h-12 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 no-print">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Transformer Management System
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-600 truncate max-w-[180px]">{user.email}</span>
            <button onClick={onLogout} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100" title="Sign Out">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4 md:p-5">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/new-job" element={<NewJob />} />
            <Route path="/external-inspection/:jobId?" element={<ExternalInspection />} />
            <Route path="/internal-inspection/:jobId?" element={<InternalInspection />} />
            <Route path="/testing-report/:jobId?" element={<TestingReport />} />
            <Route path="/estimates/new" element={<EstimateGenerate />} />
            <Route path="/bills/new" element={<BillGenerate />} />
            <Route path="/oil-inward" element={<OilAccount />} />
            <Route path="/challans/new" element={<ChallanGenerate />} />
            <Route path="/data-modification" element={<DataModification />} />
            <Route path="/approval-amount" element={<ApprovalAmount />} />
            <Route path="/change-division" element={<ChangeDivision />} />
            <Route path="/jobs" element={<CoreJobsRedirect />} />
            <Route path="/barrel-delivery" element={<ModulePlaceholder title="Barrel Delivery" hint="Barrel delivery entry & report — use Oil Inward for oil accounting now." />} />
            <Route path="/reports/inspection" element={<ModulePlaceholder title="Inspection Report" hint="Print from External/Internal after entry. Dedicated report viewer next." />} />
            <Route path="/reports/inspection-blank" element={<ModulePlaceholder title="Inspection Report Blank" hint="Blank inspection form print template." />} />
            <Route path="/reports/stock" element={<ModulePlaceholder title="Stock Statement" hint="Stock of transformers under repair by status/division." />} />
            <Route path="/agency-settings" element={<AgencySettings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getRedirectResult(auth).catch((err) => console.error('Redirect sign-in error', err));
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  return (
    <AgencyProvider>
      <BrowserRouter>
        <Shell user={user} onLogout={() => signOut(auth)} />
      </BrowserRouter>
    </AgencyProvider>
  );
}
