import { useState, useEffect } from 'react';
import { Link, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAgency } from '../lib/AgencyContext';
import { useTheme } from '../lib/ThemeContext';
import { 
  LogOut, Settings, Building2, ShieldCheck, LifeBuoy, Crown,
  LayoutDashboard, PlusCircle, ClipboardList, Eye, Wrench, Activity,
  FileText, Truck, Receipt, BarChart3, Database, Droplets, Menu, X,
  Palette, Sparkles
} from 'lucide-react';
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
import AdminPanel from './AdminPanel';
import SupportTickets from './SupportTickets';
import ThemeSelectorModal from './ThemeSelectorModal';

export default function AppLayout({ user }: { user: User }) {
  const { activeAgency, activeAtMaster } = useAgency();
  const { currentTheme, themeId } = useTheme();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showThemeModal, setShowThemeModal] = useState(false);

  const isSuperAdmin = user.email === 'shivaminfotech89@gmail.com';

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    signOut(auth);
  };

  // Fixed sequence as requested:
  // 1. Dashboard
  // 2. MR Entry
  // 3. MR Register
  // 4. External Inspection
  // 5. Internal Inspection
  // 6. Testing Report
  // 7. Estimate Generator
  // 8. Delivery Challan
  // 9. Billing System
  // 10. Oil Account / Oil Ledger (placed right after Billing System)
  // 11. Report Hub
  // 12. Estimate Master
  const navLinks = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/new-job', label: 'MR Entry', icon: PlusCircle },
    { to: '/mr-ledger', label: 'MR Register', icon: ClipboardList },
    { to: '/external-inspection', label: 'External Inspection', icon: Eye },
    { to: '/internal-inspection', label: 'Internal Inspection', icon: Wrench },
    { to: '/testing-report', label: 'Testing Report', icon: Activity },
    { to: '/estimates/new', label: 'Estimate Generator', icon: FileText },
    { to: '/challan/new', label: 'Delivery Challan', icon: Truck },
    { to: '/bills/new', label: 'Billing System', icon: Receipt },
    { to: '/oil-inward', label: 'Oil Account', icon: Droplets },
    { to: '/reports', label: 'Report Hub', icon: BarChart3 },
    { to: '/estimate-master', label: 'Estimate Master', icon: Database },
  ];

  return (
    <div className={`h-screen ${currentTheme.mainBg} flex overflow-hidden print:h-auto print:overflow-visible font-sans text-slate-900 transition-colors duration-200`}>
      
      {/* Theme Selector Modal */}
      <ThemeSelectorModal 
        isOpen={showThemeModal} 
        onClose={() => setShowThemeModal(false)} 
      />

      {/* Mobile Backdrop Overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-slate-950/70 z-40 md:hidden backdrop-blur-xs transition-opacity animate-in fade-in"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar (Responsive drawer on mobile, fixed width on md+) */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-72 md:w-64 ${currentTheme.sidebarBg} flex flex-col h-full ${currentTheme.sidebarBorder} border-r shrink-0 print:hidden transition-transform duration-200 ease-in-out md:static md:translate-x-0
        ${mobileMenuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className={`p-4 sm:p-5 ${currentTheme.sidebarBorder} border-b flex items-center justify-between`}>
          <div className="flex items-center gap-3">
            <img 
              src={appLogo} 
              alt="Transformer Logo" 
              className="w-10 h-10 rounded-lg object-cover border border-white/20 shadow-sm" 
              referrerPolicy="no-referrer"
            />
            <div>
              <h1 className="text-white font-bold text-base tracking-wide leading-none">TR REP AGENCY</h1>
              <p className="text-slate-400 text-[10px] uppercase tracking-wider mt-1">Transformer Repair Portal</p>
            </div>
          </div>
          
          {/* Mobile Close Button */}
          <button 
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="md:hidden p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Agency Info Badge in Sidebar */}
        <div className={`px-4 py-3 border-b ${currentTheme.sidebarBorder} bg-black/20`}>
          <div className="flex flex-col space-y-1.5 bg-white/5 p-2.5 rounded-lg border border-white/10">
            <span className="text-[9px] uppercase font-bold tracking-wider text-slate-400">Current Workspace</span>
            <div className="flex items-center space-x-2">
              <Building2 className="w-4 h-4 text-blue-400 shrink-0" />
              <span className="text-xs font-bold text-white truncate" title={activeAgency?.name || 'No Agency Selected'}>
                {activeAgency?.name || 'No Agency Selected'}
              </span>
            </div>
            {activeAgency && (
              <div className="flex items-center space-x-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span className="text-[10px] font-medium text-slate-300">Active Workspace</span>
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto custom-scrollbar">
          <div className="px-3 pb-1 pt-1">
            <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Main Workflow</span>
          </div>

          {navLinks.map((link) => {
            const Icon = link.icon;
            const isActive = location.pathname === link.to || (link.to !== '/' && location.pathname.startsWith(link.to));
            return (
              <Link 
                key={link.to}
                to={link.to} 
                className={`px-3 py-2.5 rounded-lg flex items-center gap-2.5 text-xs font-semibold transition-all ${
                  isActive 
                    ? `${currentTheme.sidebarActiveBg} ${currentTheme.sidebarActiveText} shadow-sm font-bold` 
                    : `${currentTheme.sidebarText} ${currentTheme.sidebarHoverBg} hover:text-white`
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'opacity-80'}`} />
                <span className="truncate">{link.label}</span>
              </Link>
            );
          })}
          
          <div className={`mt-4 pt-3 border-t ${currentTheme.sidebarBorder} space-y-1`}>
            <div className="px-3 pb-1">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">System & Customization</span>
            </div>

            <Link 
              to="/agency-settings" 
              className={`px-3 py-2 rounded-lg flex items-center gap-2.5 text-xs font-semibold transition-all ${
                location.pathname === '/agency-settings' ? 'text-white bg-white/10 font-bold' : `${currentTheme.sidebarText} ${currentTheme.sidebarHoverBg} hover:text-white`
              }`}
            >
              <Settings className="w-4 h-4 opacity-80" />
              <span>Agency Settings</span>
            </Link>

            <Link 
              to="/support" 
              className={`px-3 py-2 rounded-lg flex items-center gap-2.5 text-xs font-semibold transition-all ${
                location.pathname === '/support' ? `${currentTheme.sidebarActiveBg} text-white font-bold` : `${currentTheme.sidebarText} ${currentTheme.sidebarHoverBg} hover:text-white`
              }`}
            >
              <LifeBuoy className="w-4 h-4 text-blue-400" />
              <span>Support Desk</span>
            </Link>

            {/* Change Theme Option BELOW Support Desk */}
            <button
              type="button"
              onClick={() => setShowThemeModal(true)}
              className={`w-full px-3 py-2 rounded-lg flex items-center justify-between text-xs font-semibold transition-all ${currentTheme.sidebarText} ${currentTheme.sidebarHoverBg} hover:text-white`}
            >
              <div className="flex items-center gap-2.5">
                <Palette className="w-4 h-4 text-pink-400 shrink-0" />
                <span>Theme / Appearance</span>
              </div>
              <div 
                className="w-3.5 h-3.5 rounded-full border border-white/50 shadow-2xs shrink-0"
                style={{ backgroundColor: currentTheme.previewColors.accent }}
                title={currentTheme.name}
              />
            </button>

            {/* Admin Portal TAB: STRICTLY ONLY VISIBLE TO SUPER ADMIN (shivaminfotech89@gmail.com) */}
            {isSuperAdmin && (
              <Link 
                to="/admin" 
                className={`px-3 py-2 rounded-lg flex items-center justify-between text-xs font-bold transition-all ${
                  location.pathname === '/admin' ? 'bg-amber-500 text-slate-950' : 'text-amber-400 hover:bg-slate-800 hover:text-amber-300'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Admin Portal</span>
                </div>
                <span className="text-[9px] bg-amber-400/20 text-amber-300 font-extrabold px-1.5 py-0.2 rounded border border-amber-400/30">
                  SUPER
                </span>
              </Link>
            )}
          </div>

        </nav>

        {/* Mobile footer user info */}
        <div className={`p-3 border-t ${currentTheme.sidebarBorder} md:hidden bg-black/30 flex items-center justify-between`}>
          <div className="min-w-0 pr-2">
            <p className="text-xs font-medium text-slate-300 truncate">{user.email}</p>
            <p className="text-[10px] text-slate-500">Logged in</p>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 text-slate-400 hover:text-red-400 bg-white/10 rounded-lg"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-full min-w-0 print:overflow-visible overflow-hidden">
        {/* Header with Mobile Menu Button & Theme Selector */}
        <header className={`h-14 sm:h-16 ${currentTheme.headerBg} border-b ${currentTheme.headerBorder} flex items-center justify-between px-3 sm:px-6 shrink-0 print:hidden z-30 transition-colors duration-200`}>
          <div className="flex gap-2 sm:gap-4 items-center min-w-0">
            {/* Mobile Hamburger Toggle Button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            {activeAgency ? (
              <div className="flex items-center space-x-2.5 min-w-0">
                <img 
                  src={appLogo} 
                  alt="Logo" 
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg object-cover border border-blue-200 shadow-xs shrink-0" 
                  referrerPolicy="no-referrer"
                />
                <div className="min-w-0">
                  <h2 className="text-xs sm:text-sm font-bold text-slate-900 leading-tight truncate">{activeAgency.name}</h2>
                  <p className="text-[10px] sm:text-xs text-slate-500 truncate hidden xs:block">
                    Active Workspace {activeAtMaster ? `• ${activeAtMaster.atNumber}` : ''}
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-xs sm:text-sm font-semibold text-amber-600 flex items-center truncate">
                <span className="w-2 h-2 rounded-full bg-amber-500 mr-1.5 shrink-0"></span>
                <span className="truncate">Select agency in Settings</span>
              </div>
            )}
          </div>
          
          <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
            {/* Theme Switcher Quick Button */}
            <button
              type="button"
              onClick={() => setShowThemeModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100/90 hover:bg-slate-200/90 rounded-lg border border-slate-200 transition-colors shadow-2xs"
              title={`Active Theme: ${currentTheme.name}. Click to change theme`}
            >
              <Palette className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span className="hidden sm:inline font-medium text-slate-800">{currentTheme.name}</span>
              <span 
                className="w-2.5 h-2.5 rounded-full border border-slate-300 shrink-0"
                style={{ backgroundColor: currentTheme.previewColors.accent }}
              />
            </button>

            {isSuperAdmin && (
              <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] sm:text-[11px] font-black px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full flex items-center gap-1 shadow-xs">
                <Crown className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-600 fill-amber-500" />
                <span className="hidden sm:inline">Super Admin</span>
              </span>
            )}
            <span className="text-xs font-medium text-slate-700 hidden lg:inline max-w-[180px] truncate">{user.email}</span>
            <button
              onClick={handleLogout}
              className="p-2 text-slate-500 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors border border-slate-200"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overflow-x-hidden print:overflow-visible p-3 sm:p-6 print:p-0 relative custom-scrollbar">
          {!activeAgency && location.pathname !== '/agency-settings' && location.pathname !== '/admin' && location.pathname !== '/support' && (
             <div className="absolute inset-0 bg-white/70 backdrop-blur-[2px] z-10 flex items-center justify-center p-4 sm:p-6">
                <div className="bg-white p-6 rounded-xl shadow-xl border border-amber-200 max-w-md w-full text-center">
                   <Building2 className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                   <h3 className="text-lg font-bold text-slate-900 mb-2">No Active Agency</h3>
                   <p className="text-sm text-slate-600 mb-6">You need to select or create an agency before you can manage jobs.</p>
                   <Link to="/agency-settings" className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm">
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
            <Route path="/admin" element={isSuperAdmin ? <AdminPanel /> : <Navigate to="/" replace />} />
            <Route path="/support" element={<SupportTickets />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
