import React, { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { useAgency, isIntakeOpen, ALL_TENDERS } from '../lib/AgencyContext';
import { useTheme } from '../lib/ThemeContext';
import { auth } from '../lib/firebase';
import { User, signOut } from 'firebase/auth';
import { 
  LayoutDashboard, 
  FileText, 
  Wrench, 
  Zap, 
  Truck, 
  Receipt, 
  Droplets, 
  BarChart3, 
  Settings, 
  Database, 
  FileSignature,
  BookOpen, 
  LogOut, 
  Menu, 
  X,
  Building2,
  Palette,
  LifeBuoy,
  ShieldCheck,
  Crown,
  Sun,
  Moon,
  ChevronsUpDown
} from 'lucide-react';
import ThemeSelectorModal from './ThemeSelectorModal';
import Dashboard from './Dashboard';
import MrLedger from './MrLedger';
import NewJob from './NewJob';
import EditJob from './EditJob';
import ExternalInspection from './ExternalInspection';
import InternalInspection from './InternalInspection';
import TestingReport from './TestingReport';
import EstimateMaster from './EstimateMaster';
import EstimateGenerate from './EstimateGenerate';
import DispatchChallan from './DispatchChallan';
import Reports from './Reports';
import BillingSystem from './BillingSystem';
import OilInward from './OilInward';
import AgencySettings from './AgencySettings';
import AdminPanel from './AdminPanel';
import SupportTickets from './SupportTickets';
import AgencySwitcher from './AgencySwitcher';
import appLogo from '../assets/images/transformer_app_logo_1786648240128.jpg';

export default function AppLayout({ user }: { user: User }) {
  const { activeAgency, activeAtMaster, atMasters, setActiveAtMasterId, viewingAllTenders,
          atSupersededNotice, dismissAtSupersededNotice } = useAgency();
  const { currentTheme, themeId } = useTheme();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [logoutErrorMsg, setLogoutErrorMsg] = useState<string | null>(null);

  // Auto-hide mobile sidebar when route/pathname changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Lock body scroll on mobile when menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  // Super Admin Check (case-insensitive for safety)
  const isSuperAdmin = user?.email?.toLowerCase().trim() === 'shivaminfotech89@gmail.com';

  const handleLogoutClick = () => {
    setMobileMenuOpen(false);
    setShowLogoutConfirm(true);
  };

  const confirmLogout = async () => {
    setShowLogoutConfirm(false);
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Failed to log out', error);
      setLogoutErrorMsg("Failed to log out: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  const navLinks = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/new-job', label: 'New Job Intake', icon: FileText },
    { to: '/mr-ledger', label: 'MR Register', icon: BookOpen },
    { to: '/external-inspection', label: 'External Inspection', icon: Wrench },
    { to: '/internal-inspection', label: 'Internal Inspection', icon: Zap },
    { to: '/testing-report', label: 'Testing Report', icon: Zap },
    { to: '/estimates/new', label: 'Estimate Generator', icon: FileText },
    { to: '/challan/new', label: 'Delivery Challan', icon: Truck },
    { to: '/bills/new', label: 'Billing System', icon: Receipt },
    { to: '/oil-inward', label: 'Oil Account', icon: Droplets },
    /**
     * A SHORTCUT, NOT A SECOND HOME (AUDIT F79).
     *
     * This points at the Agency Settings section, which already expands and scrolls to the
     * rates. It deliberately does NOT render EstimateMaster at its own route: that would
     * mount a 2,600-line component in two places, and every deep link to the rates - three
     * setup-gap dialogs, the Dashboard, the AT seed panel - would then have two possible
     * destinations that could drift apart. One component, one place it lives, two ways in.
     *
     * The NO RATES warning therefore also stays where tenders are created, because the
     * section never left.
     */
    { to: '/agency-settings?section=estimate-master', label: 'Estimate Master', icon: Database },
    { to: '/reports', label: 'Report Hub', icon: BarChart3 },
  ];

  const isLight = currentTheme.isLightSidebar;

  const handleSidebarItemClick = () => {
    setMobileMenuOpen(false);
  };

  return (
    <div className={`h-screen ${currentTheme.mainBg} flex overflow-hidden print:h-auto print:overflow-visible font-sans text-slate-900 transition-colors duration-200`}>
      
      {/* Theme Selector Modal */}
      <ThemeSelectorModal 
        isOpen={showThemeModal} 
        onClose={() => setShowThemeModal(false)} 
      />

      {/* Mobile Backdrop Overlay with smooth transition */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-slate-950/70 z-40 md:hidden backdrop-blur-xs transition-opacity animate-in fade-in"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar (Responsive drawer on mobile, fixed width on md+) */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-72 md:w-64 ${currentTheme.sidebarBg} flex flex-col h-full ${currentTheme.sidebarBorder} border-r shrink-0 print:hidden transition-transform duration-250 ease-in-out md:static md:translate-x-0
        ${mobileMenuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* Brand Header */}
        <div className={`p-4 sm:p-5 ${currentTheme.sidebarBorder} border-b flex items-center justify-between`}>
          <Link 
            to="/" 
            onClick={handleSidebarItemClick} 
            className="flex items-center gap-3 min-w-0"
          >
            <img 
              src={appLogo} 
              alt="Transformer Logo" 
              className="w-10 h-10 rounded-lg object-cover border border-slate-300/40 shadow-xs shrink-0" 
              referrerPolicy="no-referrer"
            />
            <div className="min-w-0">
              <h1 className={`${currentTheme.sidebarTitleText} text-base tracking-wide leading-none truncate`}>TR REP AGENCY</h1>
              <p className={`${currentTheme.sidebarSubText} text-[10px] uppercase tracking-wider mt-1 truncate`}>Transformer Repair Portal</p>
            </div>
          </Link>
          
          {/* Mobile Close Button */}
          <button 
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className={`md:hidden p-2 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${
              isLight ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100 active:bg-slate-200' : 'text-slate-400 hover:text-white hover:bg-white/10 active:bg-white/20'
            }`}
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Agency Info Badge in Sidebar */}
        <div className={`px-4 py-3 border-b ${currentTheme.sidebarBorder} ${isLight ? 'bg-slate-100/60' : 'bg-black/20'}`}>
          <Link 
            to="/agency-settings" 
            onClick={handleSidebarItemClick}
            className={`block ${currentTheme.sidebarCardBg} p-2.5 rounded-lg border ${currentTheme.sidebarCardBorder} hover:opacity-95 transition-opacity`}
          >
            <span className={`text-[9px] uppercase font-bold tracking-wider ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>Current Workspace</span>
            <div className="flex items-center space-x-2 mt-0.5">
              <Building2 className={`w-4 h-4 shrink-0 ${isLight ? 'text-blue-600' : 'text-blue-400'}`} />
              <span className={`text-xs font-bold truncate ${currentTheme.sidebarCardTitle}`} title={activeAgency?.name || 'No Agency Selected'}>
                {activeAgency?.name || 'No Agency Selected'}
              </span>
            </div>
          </Link>

          {/* THE TENDER, BESIDE THE AGENCY AND SWITCHABLE FROM HERE (AUDIT F84).
              Every screen filters on the active AT, and until now the only way to change it
              was to navigate to Agency Settings, scroll past the agency form and click an AT
              card. A control that governs what every screen shows belongs where the operator
              always is.

              IT SHOWS THE INTAKE STATE, not only the name. "Can I book a new MR against
              this?" is the difference between a tender you work in and one you can only
              read, and it is needed BEFORE starting rather than when a save is refused. */}
          {activeAgency && (() => {
            const mine = atMasters.filter(t => t.agencyId === activeAgency.id);
            const gate = isIntakeOpen(activeAtMaster, mine);
            if (mine.length === 0) {
              return (
                <Link
                  to="/agency-settings?section=at"
                  className="mt-2 block p-2.5 rounded-lg border border-amber-400/50 bg-amber-500/10"
                >
                    <span className={`text-[9px] uppercase font-bold tracking-wider ${isLight ? 'text-amber-700' : 'text-amber-400'}`}>Tender</span>
                  {/* Theme-aware for the same reason as the control below (AUDIT F98). */}
                  <div className={`text-xs font-bold mt-0.5 ${isLight ? 'text-amber-800' : 'text-amber-300'}`}>No tender — set one up</div>
                </Link>
              );
            }
            /**
             * ⚠ THE ONLY TENDER SCOPE CONTROL IN THE APP (AUDIT F87).
             *
             * The Dashboard had a second one, local to itself, and two controls for one word
             * turned out to be worse than the problem it solved: the operator could not tell
             * which governed what New Job would book into. This is the survivor because scope
             * is a WORKING setting - removing it and keeping the Dashboard's would have left
             * the only route to changing the working tender running through a read-only
             * screen, which is the read-causing-a-mutation shape rejected in F70, F72 and F86.
             *
             * "ALL TENDERS" IS A VIEWING STATE and says so. Intake refuses in it - there is no
             * single AT to book into - and the caption below states that rather than letting
             * New Job explain it after the operator has started typing.
             */
            const all = viewingAllTenders;

            /**
             * ⚠ IT HAS TO LOOK LIKE A CONTROL, AND IT DID NOT (AUDIT F98).
             *
             * The select was `bg-transparent`, borderless, with no chevron and text styled
             * almost identically to the caption beneath it. Three lines - label, value,
             * state - read as one block of static text, so nothing said the middle line
             * could be clicked. The only way to find the other tenders was to click it and
             * meet the native option list, which is what "a cramped stack of options" was:
             * the OPEN dropdown, not a layout. A collapsed native select shows one option.
             *
             * ⚠ IT IS DELIBERATELY THE SAME KIND OF CONTROL AS THE AGENCY SWITCHER. Both
             * choose the scope you work in; they sit in different places only because one
             * is the outer scope. The same ChevronsUpDown glyph, the same rounded-lg field,
             * the same bold-primary / quiet-secondary weighting - so the tender does not
             * read as a lesser setting than the agency.
             *
             * STILL A NATIVE <select>. Keyboard behaviour and the mobile picker are earned
             * by the native control and would have to be re-earned by a popover; the option
             * list is drawn by the OS and is not stylable, which is accepted rather than
             * worked around.
             */
            const tone = all ? 'indigo' : gate.open ? 'emerald' : 'amber';
            const card = all ? 'border-indigo-400/50 bg-indigo-500/10'
              : gate.open ? 'border-emerald-500/40 bg-emerald-500/10'
              : 'border-amber-400/50 bg-amber-500/10';
            // ⚠ THEME-AWARE. The previous colours were fixed light-on-dark (text-emerald-200),
            // which is close to invisible on a light sidebar - a latent fault this restyle
            // would otherwise have preserved.
            const dot = all ? 'bg-indigo-400' : gate.open ? 'bg-emerald-400' : 'bg-amber-400';
            const chipText = all ? (isLight ? 'text-indigo-700' : 'text-indigo-300')
              : gate.open ? (isLight ? 'text-emerald-700' : 'text-emerald-300')
              : (isLight ? 'text-amber-700' : 'text-amber-300');
            const labelText = isLight ? 'text-slate-500' : 'text-slate-400';
            const fieldText = isLight ? 'text-slate-900' : 'text-white';
            const fieldBg = isLight
              ? 'bg-white border-slate-300 hover:bg-slate-50'
              : 'bg-white/10 border-white/20 hover:bg-white/15';
            const stateLabel = all ? 'All tenders' : gate.open ? 'Open' : 'Closed';

            return (
              <div className={`mt-2 p-2.5 rounded-lg border ${card}`} data-tone={tone}>
                {/* THE STATE AS A CHIP ON THE LABEL ROW, not a line of body text beneath the
                    value. "Can I book against this?" is a property of the tender, so it sits
                    with the tender rather than reading as a third equal row. */}
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[9px] uppercase font-bold tracking-wider ${labelText}`}>
                    Tender
                  </span>
                  <span
                    title={all
                      ? 'Viewing every tender. New work is recorded against one tender, so intake is refused in this scope.'
                      : gate.open ? 'Open to new work — New Job books against this tender.' : gate.reason}
                    className={`flex items-center gap-1 text-[9px] uppercase font-bold tracking-wider ${chipText}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${dot} shrink-0`} />
                    {stateLabel}
                  </span>
                </div>

                <div className="relative mt-1">
                  <select
                    value={all ? ALL_TENDERS : (activeAtMaster?.id || '')}
                    onChange={e => setActiveAtMasterId(e.target.value || null)}
                    title="Change the tender every screen is scoped to"
                    className={`appearance-none w-full min-h-[38px] pl-2.5 pr-7 py-1.5 rounded-lg border text-xs sm:text-sm font-bold cursor-pointer outline-none transition-colors focus:ring-2 focus:ring-blue-500/40 ${fieldBg} ${fieldText}`}
                  >
                    {mine
                      .slice()
                      .sort((x, y) => (y.startDate || 0) - (x.startDate || 0))
                      .map(t => (
                        <option key={t.id} value={t.id} className="text-slate-900">
                          AT {t.atNumber || t.name}
                          {String(t.status || '').toLowerCase() === 'closed' ? ' — closed' : ''}
                        </option>
                      ))}
                    <option value={ALL_TENDERS} className="text-slate-900">All tenders — viewing only</option>
                  </select>
                  {/* The agency switcher's glyph, on purpose - see the note above. */}
                  <ChevronsUpDown
                    className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 shrink-0 ${labelText}`}
                  />
                </div>
              </div>
            );
          })()}
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto custom-scrollbar">
          <div className="px-3 pb-1 pt-1">
            <span className={`text-[10px] uppercase font-bold tracking-widest ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>Main Workflow</span>
          </div>

          {navLinks.map((link) => {
            const Icon = link.icon;
            // Compare the PATH ONLY. A nav entry carrying a query string ("?section=") would
            // never match `location.pathname` and would sit permanently unhighlighted.
            const linkPath = link.to.split('?')[0];
            const isActive = location.pathname === linkPath || (linkPath !== '/' && location.pathname.startsWith(linkPath));
            return (
              <Link 
                key={link.to}
                to={link.to} 
                onClick={handleSidebarItemClick}
                className={`px-3 py-2.5 min-h-[42px] rounded-lg flex items-center gap-2.5 text-xs font-semibold transition-all ${
                  isActive 
                    ? `${currentTheme.sidebarActiveBg} ${currentTheme.sidebarActiveText} shadow-xs font-bold` 
                    : `${currentTheme.sidebarText} ${currentTheme.sidebarHoverBg}`
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'opacity-80'}`} />
                <span className="truncate">{link.label}</span>
              </Link>
            );
          })}
          
          <div className={`mt-4 pt-3 border-t ${currentTheme.sidebarBorder} space-y-1`}>
            {/* SETUP, IN THE ORDER IT HAS TO HAPPEN (AUDIT F74).
                agency -> tender -> divisions -> allotment -> rates. The New Job gates
                already enforce exactly this sequence; the nav used to contradict it by
                listing Estimate Master among the working screens, where a new agency
                reached it first and met a wall - it cannot save rates without a tender to
                save them to. Divisions and allotment are not listed because they are set
                on a tender, inside the Tenders screen. */}
            <div className="px-3 pb-1">
              <span className={`text-[10px] uppercase font-bold tracking-widest ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>System &amp; Customization</span>
            </div>

            <Link 
              to="/agency-settings" 
              onClick={handleSidebarItemClick}
              className={`px-3 py-2.5 min-h-[42px] rounded-lg flex items-center gap-2.5 text-xs font-semibold transition-all ${
                location.pathname === '/agency-settings' 
                  ? (isLight ? 'text-blue-700 bg-blue-50 font-bold border border-blue-200' : 'text-white bg-white/10 font-bold') 
                  : `${currentTheme.sidebarText} ${currentTheme.sidebarHoverBg}`
              }`}
            >
              <Settings className="w-4 h-4 opacity-80" />
              <span>Agency Settings</span>
            </Link>

            {/* TENDERS AND ESTIMATE MASTER ARE NOT NAV ENTRIES.
                Both are agency SETUP, and both live as sections of the Agency Settings
                page: tenders (with divisions, prefixes and allotments nested), then the
                estimate master for the selected tender. Listing them here made them look
                like destinations of their own, and Estimate Master in particular cannot
                stand alone - it has nothing to save to without a tender (AUDIT F74). */}

            <Link 
              to="/support" 
              onClick={handleSidebarItemClick}
              className={`px-3 py-2.5 min-h-[42px] rounded-lg flex items-center gap-2.5 text-xs font-semibold transition-all ${
                location.pathname === '/support' 
                  ? `${currentTheme.sidebarActiveBg} ${currentTheme.sidebarActiveText} font-bold` 
                  : `${currentTheme.sidebarText} ${currentTheme.sidebarHoverBg}`
              }`}
            >
              <LifeBuoy className={`w-4 h-4 ${isLight ? 'text-blue-600' : 'text-blue-400'}`} />
              <span>Support Desk</span>
            </Link>

            {/* Change Theme Option */}
            <button
              type="button"
              onClick={() => {
                setShowThemeModal(true);
                setMobileMenuOpen(false);
              }}
              className={`w-full px-3 py-2.5 min-h-[42px] rounded-lg flex items-center justify-between text-xs font-semibold transition-all ${currentTheme.sidebarText} ${currentTheme.sidebarHoverBg}`}
            >
              <div className="flex items-center gap-2.5">
                <Palette className="w-4 h-4 text-pink-500 shrink-0" />
                <span>Theme / Appearance</span>
              </div>
              <div className="flex items-center gap-1.5">
                {currentTheme.themeMode === 'light' ? (
                  <Sun className="w-3 h-3 text-amber-500" />
                ) : (
                  <Moon className="w-3 h-3 text-cyan-400" />
                )}
                <div 
                  className="w-3.5 h-3.5 rounded-full border border-slate-300 shadow-2xs shrink-0"
                  style={{ backgroundColor: currentTheme.previewColors.accent }}
                  title={currentTheme.name}
                />
              </div>
            </button>

            {/* Admin Portal TAB: STRICTLY ONLY VISIBLE TO SUPER ADMIN (shivaminfotech89@gmail.com) */}
            {isSuperAdmin && (
              <Link 
                to="/admin" 
                onClick={handleSidebarItemClick}
                className={`px-3 py-2.5 min-h-[42px] rounded-lg flex items-center justify-between text-xs font-bold transition-all ${
                  location.pathname === '/admin' 
                    ? 'bg-amber-500 text-slate-950 shadow-xs' 
                    : (isLight ? 'text-amber-800 bg-amber-50 hover:bg-amber-100' : 'text-amber-400 hover:bg-slate-800 hover:text-amber-300')
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>Admin Portal</span>
                </div>
                <span className="text-[9px] bg-amber-400/20 text-amber-600 font-extrabold px-1.5 py-0.2 rounded border border-amber-400/30">
                  SUPER
                </span>
              </Link>
            )}
          </div>

        </nav>

        {/* Mobile footer user info */}
        <div className={`p-3 border-t ${currentTheme.sidebarBorder} md:hidden ${isLight ? 'bg-slate-50' : 'bg-black/30'} flex items-center justify-between`}>
          <div className="min-w-0 pr-2">
            <p className={`text-xs font-medium truncate ${isLight ? 'text-slate-800' : 'text-slate-300'}`}>{user.email}</p>
            <p className="text-[10px] text-slate-500">Logged in</p>
          </div>
          <button
            onClick={handleLogoutClick}
            className={`p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${
              isLight ? 'text-slate-500 hover:text-red-600 hover:bg-red-50' : 'text-slate-400 hover:text-red-400 bg-white/10'
            }`}
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
              className="md:hidden p-2 text-slate-700 hover:text-slate-900 hover:bg-slate-100 active:bg-slate-200 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <AgencySwitcher appLogo={appLogo} />
          </div>
          
          <div className="flex items-center space-x-1.5 sm:space-x-3 shrink-0">
            {/* Theme Switcher Quick Button */}
            <button
              type="button"
              onClick={() => setShowThemeModal(true)}
              className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 min-h-[38px] text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100/90 hover:bg-slate-200/90 rounded-lg border border-slate-200 transition-colors shadow-2xs"
              title={`Active Theme: ${currentTheme.name}. Click to change theme`}
            >
              {currentTheme.themeMode === 'light' ? (
                <Sun className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              )}
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
              onClick={handleLogoutClick}
              className="p-2 min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-500 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg transition-colors border border-slate-200"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overflow-x-hidden print:overflow-visible p-2.5 sm:p-4 md:p-6 print:p-0 relative custom-scrollbar">
          {/* SAID ONCE WHEN SIGN-IN MOVED THEM (AUDIT F84). A selection changing underneath
              is the shape this audit has spent its length removing - the job number, the
              estimate master, the reservation - so the one place it is now allowed to
              happen announces itself. */}
          {atSupersededNotice && (
            <div className="mb-3 rounded-xl border-2 border-indigo-300 bg-indigo-50 p-3 flex items-start gap-2.5">
              <Building2 className="w-4 h-4 text-indigo-700 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1 text-xs text-indigo-900">
                <strong className="font-bold">
                  AT {atSupersededNotice.movedTo} is now the current tender; you were last working
                  in {atSupersededNotice.wasOn}.
                </strong>
                <p className="mt-0.5">
                  New MRs, jobs and oil entries go to {atSupersededNotice.movedTo}. Everything under
                  {' '}{atSupersededNotice.wasOn} is still there &mdash; switch to it in the sidebar to
                  see it, or to finish inspections and documents on units already booked under it.
                </p>
              </div>
              <button
                type="button"
                onClick={dismissAtSupersededNotice}
                className="shrink-0 text-[11px] font-bold text-indigo-700 hover:text-indigo-900"
              >
                Dismiss
              </button>
            </div>
          )}

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
            <Route path="/estimate-master" element={<Navigate to={{ pathname: '/agency-settings', search: '?section=estimate-master' }} replace />} />
            <Route path="/estimates/new" element={<EstimateGenerate />} />
            <Route path="/challan/new" element={<DispatchChallan />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/bills" element={<BillingSystem />} />
            <Route path="/bills/new" element={<BillingSystem />} />
            <Route path="/bills/:mrNo" element={<BillingSystem />} />
            <Route path="/bills/view/:mrNo" element={<BillingSystem />} />
            <Route path="/oil-inward" element={<OilInward />} />
            {/* REDIRECTS, NOT DELETIONS. Both were real routes and both were linked from
                setup-gap dialogs, the Dashboard and each other. A removed route would send
                every one of those - and any bookmark - to the catch-all, which redirects to
                the Dashboard and says nothing. `location.search` is carried through because
                AtSettings reads atId / section / division / coreType from it to open the
                named AT on the right tab; dropping them lands the operator on a settings
                page with the problem still to find (AUDIT F74). */}
            <Route path="/at-masters" element={<Navigate to={{ pathname: '/agency-settings', search: location.search || '?section=at' }} replace />} />
            <Route path="/agency-settings" element={<AgencySettings />} />
            <Route path="/admin" element={isSuperAdmin ? <AdminPanel /> : <Navigate to="/" replace />} />
            <Route path="/support" element={<SupportTickets />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-sm w-full p-6 text-center animate-in fade-in zoom-in-95 duration-200">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
              <LogOut className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">Confirm Sign Out</h3>
            <p className="text-sm text-slate-600 mb-6">Are you sure you want to log out of your session?</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmLogout}
                className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-colors text-sm shadow-sm"
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logout Error Modal */}
      {logoutErrorMsg && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-red-200 max-w-sm w-full p-6 text-center animate-in fade-in zoom-in-95 duration-200">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
              <X className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">Logout Failed</h3>
            <p className="text-sm text-slate-600 mb-6">{logoutErrorMsg}</p>
            <button
              type="button"
              onClick={() => setLogoutErrorMsg(null)}
              className="w-full px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl transition-colors text-sm shadow-sm"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

