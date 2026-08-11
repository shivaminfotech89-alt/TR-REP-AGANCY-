import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { auth } from './lib/firebase';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
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
import { LogOut, Loader2, Settings, LayoutDashboard, ClipboardList, Search, FileSpreadsheet, FileText, Droplet, Truck, Activity } from 'lucide-react';

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const { activeAgency } = useAgency();

  const nav = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/new-job', label: 'MR Intake', icon: ClipboardList },
    { to: '/external-inspection', label: 'External Inspection', icon: Search },
    { to: '/internal-inspection', label: 'Internal Inspection', icon: Search },
    { to: '/estimates/new', label: 'Estimate', icon: FileSpreadsheet },
    { to: '/testing-report', label: 'Testing', icon: Activity },
    { to: '/bills/new', label: 'Bills', icon: FileText },
    { to: '/oil-inward', label: 'Oil Account', icon: Droplet },
    { to: '/challans/new', label: 'Challan', icon: Truck },
    { to: '/agency-settings', label: 'Agency Settings', icon: Settings },
  ];

  return (
    <div className="h-screen bg-slate-100 flex overflow-hidden">
      <aside className="w-60 bg-slate-950 flex flex-col h-full shrink-0 no-print">
        <div className="p-5 border-b border-slate-800">
          <h1 className="text-white font-bold text-sm tracking-[0.15em]">TR REP AGANCY</h1>
          <p className="text-slate-500 text-[10px] uppercase tracking-widest mt-1">Repair Management</p>
          <div className="mt-3 text-[11px] text-slate-300 truncate bg-slate-900 border border-slate-800 px-2 py-1.5 rounded">
            {activeAgency?.name || 'Configure agency →'}
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded text-[12px] font-medium transition-colors ${
                  isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                }`
              }
            >
              <item.icon className="w-3.5 h-3.5 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-800 text-[10px] text-slate-500">
          Firebase: tr-rep-agancy
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-full min-w-0">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 no-print">
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
            {activeAgency ? `${Object.keys(activeAgency.prefixes || {}).length} divisions linked` : 'No agency selected'}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-700 truncate max-w-[200px]">{user.email}</span>
            <button onClick={onLogout} className="p-2 text-slate-400 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-full" title="Sign Out">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-5 md:p-6">
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
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      console.error(err);
      alert('Login failed. Ensure Google sign-in is enabled for project tr-rep-agancy.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 px-4">
        <div className="max-w-md w-full p-8 bg-white/95 shadow-2xl rounded-2xl text-center border border-white/20">
          <div className="w-14 h-14 bg-blue-600 text-white rounded-2xl flex items-center justify-center mx-auto mb-5 text-xl font-bold tracking-tight">
            TR
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1 tracking-tight">TR REP AGANCY</h1>
          <p className="text-slate-500 text-sm mb-8">Transformer Repair Agency Management · Firebase project tr-rep-agancy</p>
          <button onClick={handleLogin} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors">
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <AgencyProvider>
      <BrowserRouter>
        <Shell user={user} onLogout={() => signOut(auth)} />
      </BrowserRouter>
    </AgencyProvider>
  );
}
