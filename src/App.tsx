import { useState, useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { auth } from './lib/firebase';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { AgencyProvider } from './lib/AgencyContext';
import { Loader2 } from 'lucide-react';
import AppLayout from './components/AppLayout';
import appLogo from './assets/images/transformer_app_logo_1786648240128.jpg';
import heroBg from './assets/images/transformer_hero_bg_1786648256385.jpg';

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 relative overflow-hidden p-4">
        {/* Background Image Overlay */}
        <div className="absolute inset-0 opacity-30 mix-blend-overlay pointer-events-none">
          <img 
            src={heroBg} 
            alt="Transformer Repair Workshop" 
            className="w-full h-full object-cover object-center" 
            referrerPolicy="no-referrer"
          />
        </div>
        
        {/* Login Card */}
        <div className="max-w-md w-full bg-slate-900/90 backdrop-blur-md shadow-2xl rounded-2xl border border-slate-800 p-8 text-center relative z-10">
          <div className="relative inline-block mb-6">
            <img 
              src={appLogo} 
              alt="TR Rep Agency Logo" 
              className="w-24 h-24 rounded-2xl mx-auto border-2 border-blue-500/40 shadow-xl object-cover" 
              referrerPolicy="no-referrer"
            />
            <span className="absolute -bottom-2 -right-2 bg-blue-600 text-white text-[9px] font-black uppercase px-2 py-0.5 rounded-full border border-slate-900">
              PRO v2
            </span>
          </div>

          <h1 className="text-2xl font-black text-white tracking-tight mb-1">TR REP AGENCY</h1>
          <p className="text-blue-400 text-xs font-bold uppercase tracking-wider mb-2">Transformer Repair Management System</p>
          <p className="text-slate-400 text-xs mb-8 leading-relaxed">
            Distribution Transformer Overhaul • Electrical Testing • AT Rate Calculations • Oil Account & GST Tax Invoicing
          </p>

          <button
            onClick={handleLogin}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg transition-all flex items-center justify-center gap-3 text-sm tracking-wide"
          >
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.761H12.545z"/>
            </svg>
            <span>Sign in with Google</span>
          </button>

          <p className="text-[10px] text-slate-500 mt-6">
            Authorized Personnel Access Only • Secure Firebase Authentication
          </p>
        </div>
      </div>
    );
  }

  return (
    <AgencyProvider>
      <BrowserRouter>
        <AppLayout user={user} />
      </BrowserRouter>
    </AgencyProvider>
  );
}

