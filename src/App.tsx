import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
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
import { BillGenerate, OilInward } from './components/Placeholders';
import { LogOut, Home, Loader2, Settings } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
      alert('Login failed');
    }
  };

  const handleLogout = () => {
    signOut(auth);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <div className="max-w-md w-full p-8 bg-white shadow-lg rounded-xl border border-gray-100 text-center">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
             <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">TR Rep Agency</h1>
          <p className="text-gray-500 mb-8">Transformer Repair Management System</p>
          <button
            onClick={handleLogin}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <AgencyProvider>
      <BrowserRouter>
        <div className="h-screen bg-slate-50 flex overflow-hidden font-sans text-slate-900">
        
        {/* Sidebar */}
        <aside className="w-64 bg-slate-900 flex flex-col h-full border-r border-slate-800 shrink-0">
          <div className="p-6 border-b border-slate-800">
            <h1 className="text-white font-bold text-lg tracking-wider">TR REP AGANCY</h1>
            <p className="text-slate-400 text-xs uppercase tracking-widest mt-1">Repair Management System</p>
            <div className="mt-4 inline-flex items-center space-x-2 bg-slate-800 px-3 py-1.5 rounded border border-slate-700">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              <span className="text-xs font-medium text-slate-300 truncate max-w-[150px]">
                Active Agency Configured
              </span>
            </div>
          </div>
          <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
            <Link to="/" className="bg-blue-600 text-white px-4 py-2 rounded flex items-center gap-3 text-sm font-medium">
              <span>Dashboard Overview</span>
            </Link>
            <Link to="/new-job" className="text-slate-400 px-4 py-2 hover:bg-slate-800 hover:text-white rounded flex items-center gap-3 text-sm transition-colors">
              <span>Intake (MR Registry)</span>
            </Link>
            <Link to="/external-inspection" className="text-slate-400 px-4 py-2 hover:bg-slate-800 hover:text-white rounded flex items-center gap-3 text-sm transition-colors">
              <span>External Inspection</span>
            </Link>
            <Link to="/internal-inspection" className="text-slate-400 px-4 py-2 hover:bg-slate-800 hover:text-white rounded flex items-center gap-3 text-sm transition-colors">
              <span>Internal Inspection</span>
            </Link>
            <Link to="/testing-report" className="text-slate-400 px-4 py-2 hover:bg-slate-800 hover:text-white rounded flex items-center gap-3 text-sm transition-colors">
              <span>Testing Report</span>
            </Link>
            <Link to="/estimates/new" className="text-slate-400 px-4 py-2 hover:bg-slate-800 hover:text-white rounded flex items-center gap-3 text-sm transition-colors">
              <span>Estimate Generate</span>
            </Link>
            <Link to="/bills/new" className="text-slate-400 px-4 py-2 hover:bg-slate-800 hover:text-white rounded flex items-center gap-3 text-sm transition-colors">
              <span>Bills & Dispatch</span>
            </Link>
            <Link to="/oil-inward" className="text-slate-400 px-4 py-2 hover:bg-slate-800 hover:text-white rounded flex items-center gap-3 text-sm transition-colors">
              <span>Oil Ledger</span>
            </Link>
            <Link to="/agency-settings" className="text-slate-400 px-4 py-2 hover:bg-slate-800 hover:text-white rounded flex items-center gap-3 text-sm transition-colors mt-8 border-t border-slate-800 pt-4">
              <Settings className="w-4 h-4" />
              <span>Agency Settings</span>
            </Link>
          </nav>
          <div className="p-4 border-t border-slate-800">
            <div className="bg-slate-800 p-3 rounded">
              <p className="text-slate-400 text-[10px] uppercase font-bold">System Status</p>
              <p className="text-white text-xs mt-1">Circle Office Connected</p>
            </div>
          </div>
        </aside>

        <main className="flex-1 flex flex-col h-full min-w-0">
          <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0">
            <div className="flex gap-6 items-center">
              <div className="text-sm font-semibold border-r border-slate-200 pr-6">DIV: SABARMATI</div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm font-medium text-slate-700">{user.email}</span>
              <button
                onClick={handleLogout}
                className="p-2 text-slate-400 hover:text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-full transition-colors"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-auto p-6">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/new-job" element={<NewJob />} />
              <Route path="/external-inspection/:jobId?" element={<ExternalInspection />} />
              <Route path="/internal-inspection/:jobId?" element={<InternalInspection />} />
              <Route path="/testing-report/:jobId?" element={<TestingReport />} />
              <Route path="/estimates/new" element={<EstimateGenerate />} />
              <Route path="/bills/new" element={<BillGenerate />} />
              <Route path="/oil-inward" element={<OilInward />} />
              <Route path="/agency-settings" element={<AgencySettings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
    </AgencyProvider>
  );
}
