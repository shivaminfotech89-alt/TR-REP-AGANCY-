import React, { useState } from 'react';
import { 
  Wrench, 
  Activity, 
  FileText, 
  ShieldCheck, 
  Zap, 
  CheckCircle2, 
  Database, 
  Printer, 
  Layers, 
  ArrowRight, 
  HelpCircle, 
  Building2, 
  FileSpreadsheet, 
  Lock, 
  ChevronRight, 
  Check, 
  Scale, 
  AlertCircle,
  X,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Cpu,
  Flame,
  Award,
  Headphones,
  Truck,
  Clock,
  Send,
  PhoneCall,
  Menu
} from 'lucide-react';
import heroBg from '../assets/images/transformer_hero_bg_1786648256385.jpg';
import { APP_MARK, APP_SUBTITLE } from '../lib/ui';
import { SELLER } from '../lib/seller';

interface LandingPageProps {
  onLogin: () => void;
  isLoading?: boolean;
}

export default function LandingPage({ onLogin, isLoading = false }: LandingPageProps) {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleFaq = (index: number) => {
    setActiveFaq(activeFaq === index ? null : index);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-blue-600 selection:text-white relative">
      
      {/* ⚠ EVERY "24/7 SUPPORT" CLAIM ON THIS PAGE IS GONE (AUDIT G41). There were NINE, not
          the two first counted: this bar, the nav, the mobile menu, a statistic tile, a section
          heading, a "Live Helpdesk" card, an "Enterprise SLA & Support Guarantee" heading, an
          FAQ answer describing a "cloud operations and engineering team", and the footer.

          None of it was true. Support is one person answering a ticket form during working
          hours, and the support panel is unbuilt by explicit decision. A service-level claim a
          product does not meet is a defect anywhere; on a page a payment processor reads before
          approving a merchant, it invites the review to fail on something never needed.

          What replaced them says what IS true - the software runs unattended on Google Cloud,
          so the workshop can use it at any hour. That is the useful half of the claim, and it
          happens to be the accurate half. */}
      <div className="bg-slate-900 text-slate-300 text-[10px] sm:text-[11px] font-medium py-1.5 px-3 sm:px-4 border-b border-slate-800">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-1.5 sm:gap-2 text-center sm:text-left">
          <div className="flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 flex-wrap">
            <span className="flex h-2 w-2 relative shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-white font-bold flex items-center gap-1">
              <Headphones className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-blue-400 shrink-0" />
              Cloud-hosted, available any hour
            </span>
            <span className="hidden md:inline text-slate-500">|</span>
            <span className="hidden md:inline text-slate-400">Dedicated Cloud Assistance for Overhaul Agencies</span>
          </div>
          <div className="flex items-center justify-center gap-3 text-slate-400">
            <span className="flex items-center gap-1 text-emerald-400 font-semibold">
              <FileSpreadsheet className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" /> Multi Reports Generate & Export
            </span>
          </div>
        </div>
      </div>

      {/* Top Professional Navigation */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2.5 sm:space-x-3">
            <img 
              src={APP_MARK} 
              alt="TransRegister" 
              className="w-9 h-9 sm:w-10 sm:h-10 shrink-0" 
              referrerPolicy="no-referrer"
            />
            <div className="min-w-0">
              <span className="font-extrabold text-slate-900 text-sm sm:text-base tracking-tight flex items-center gap-1.5 truncate">
                {/* ⚠ NO VERSION BADGE, AND ONE MUST NOT BE ADDED BACK. It read "v2.5",
                    hardcoded here and nowhere else - not in package.json, not in the
                    manifest, not derived from anything, and never touched by a release. A
                    literal pretending to be a fact, which is the class this codebase keeps
                    removing. And a version number on a login page tells a customer nothing
                    even when it IS true: they cannot choose a version, and the number does
                    not tell them whether the thing they are about to use works. */}
                TransRegister
              </span>
              <p className="text-[9px] sm:text-[10px] text-slate-500 font-medium truncate">{APP_SUBTITLE}</p>
            </div>
          </div>

          <nav className="hidden md:flex items-center space-x-6 lg:space-x-8 text-xs font-semibold text-slate-600">
            <a href="#about" className="hover:text-blue-600 transition-colors">About App</a>
            <a href="#features" className="hover:text-blue-600 transition-colors">Core Modules</a>
            <a href="#workflow" className="hover:text-blue-600 transition-colors">Process Lifecycle</a>
            <a href="#support" className="hover:text-blue-600 transition-colors">Support</a>
            <a href="#terms" className="hover:text-blue-600 transition-colors">Terms & Compliance</a>
            <a href="#faq" className="hover:text-blue-600 transition-colors">FAQ</a>
          </nav>

          <div className="flex items-center space-x-2 sm:space-x-3">
            <button
              onClick={() => {
                const loginCard = document.getElementById('login-section');
                loginCard?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="px-3 py-2 text-xs font-bold text-slate-700 hover:text-blue-600 transition-colors hidden lg:block"
            >
              Sign In
            </button>
            <button
              onClick={onLogin}
              disabled={isLoading}
              className="px-3.5 sm:px-4 py-2 sm:py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-bold rounded-lg shadow-sm transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-50 min-h-[40px] touch-manipulation"
            >
              <span>Access Portal</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            </button>

            {/* Mobile Navigation Menu Toggle */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 text-slate-700 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
              aria-label="Toggle navigation menu"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Menu Drawer */}
        {isMobileMenuOpen && (
          <div className="md:hidden bg-white border-b border-slate-200 px-4 pt-2 pb-4 shadow-lg animate-in slide-in-from-top-2 duration-200">
            <nav className="flex flex-col space-y-1 text-xs font-semibold text-slate-700">
              <a 
                href="#about" 
                onClick={() => setIsMobileMenuOpen(false)}
                className="py-2.5 px-3 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition-colors flex items-center justify-between"
              >
                <span>About App</span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </a>
              <a 
                href="#features" 
                onClick={() => setIsMobileMenuOpen(false)}
                className="py-2.5 px-3 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition-colors flex items-center justify-between"
              >
                <span>Core Modules</span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </a>
              <a 
                href="#workflow" 
                onClick={() => setIsMobileMenuOpen(false)}
                className="py-2.5 px-3 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition-colors flex items-center justify-between"
              >
                <span>Process Lifecycle</span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </a>
              <a 
                href="#support" 
                onClick={() => setIsMobileMenuOpen(false)}
                className="py-2.5 px-3 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition-colors flex items-center justify-between"
              >
                <span>Support</span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </a>
              <a 
                href="#terms" 
                onClick={() => setIsMobileMenuOpen(false)}
                className="py-2.5 px-3 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition-colors flex items-center justify-between"
              >
                <span>Terms & Compliance</span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </a>
              <a 
                href="#faq" 
                onClick={() => setIsMobileMenuOpen(false)}
                className="py-2.5 px-3 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition-colors flex items-center justify-between"
              >
                <span>Frequently Asked Questions</span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </a>
              <div className="pt-2 border-t border-slate-100 flex gap-2">
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    const loginCard = document.getElementById('login-section');
                    loginCard?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="w-full py-2.5 bg-slate-100 text-slate-800 text-center font-bold rounded-lg text-xs hover:bg-slate-200"
                >
                  Sign In Section
                </button>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* Hero Section with Light Workshop Aesthetic */}
      <section className="relative overflow-hidden pt-6 pb-12 sm:pt-8 sm:pb-16 lg:py-20 border-b border-slate-200 bg-gradient-to-b from-slate-100/80 via-white to-slate-50">
        
        {/* Subtle Light Transformer Workshop Backdrop */}
        <div className="absolute inset-0 opacity-[0.14] mix-blend-multiply pointer-events-none overflow-hidden">
          <img 
            src={heroBg} 
            alt="Transformer Manufacturing & Repair Facility" 
            className="w-full h-full object-cover object-center filter grayscale contrast-125" 
            referrerPolicy="no-referrer"
          />
        </div>

        {/* Decorative Grid Blueprint Overlay */}
        <div 
          className="absolute inset-0 opacity-[0.03] pointer-events-none" 
          style={{ backgroundImage: 'radial-gradient(#1e293b 1px, transparent 1px)', backgroundSize: '24px 24px' }}
        />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 sm:gap-12 items-center">
            
            {/* Hero Left Content */}
            <div className="lg:col-span-7 space-y-4 sm:space-y-6">
              <div className="inline-flex items-center space-x-2 bg-blue-50 border border-blue-200/80 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-blue-700 text-[11px] sm:text-xs font-bold tracking-wide">
                <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse shrink-0"></span>
                <span>DISCOM & MSEDCL Specification Compliant ERP</span>
              </div>

              <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black text-slate-900 tracking-tight leading-[1.2] sm:leading-[1.15]">
                Distribution Transformer <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-700">Repair, Overhaul & Testing</span> Suite
              </h1>

              <p className="text-sm sm:text-base text-slate-600 leading-relaxed font-normal">
                End-to-end operational software designed specifically for Electrical Repair Agencies, Overhaul Workshops, and DISCOM Contractors. Full <strong>Start-to-End Support</strong> from <strong>MR Inward</strong> and <strong>Internal Coil Damage Audits</strong> to <strong>Routine Loss Testing</strong>, <strong>Oil Accounting</strong>, <strong>Auto-Generated Estimates & Bills</strong>, and <strong>Final Delivery Challans</strong>.
              </p>

              {/* Quick Feature Pill Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 pt-1 sm:pt-2">
                <div className="flex items-center space-x-2 bg-white/90 border border-slate-200 p-2 sm:p-2.5 rounded-lg shadow-2xs hover:border-blue-300 transition-colors">
                  <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600 shrink-0" />
                  <span className="text-[11px] sm:text-xs font-semibold text-slate-700 truncate">Dashboard</span>
                </div>
                <div className="flex items-center space-x-2 bg-white/90 border border-slate-200 p-2 sm:p-2.5 rounded-lg shadow-2xs hover:border-emerald-300 transition-colors">
                  <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-600 shrink-0" />
                  <span className="text-[11px] sm:text-xs font-semibold text-slate-700 truncate">Multi Reports</span>
                </div>
                <div className="flex items-center space-x-2 bg-white/90 border border-slate-200 p-2 sm:p-2.5 rounded-lg shadow-2xs hover:border-indigo-300 transition-colors">
                  <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-600 shrink-0" />
                  <span className="text-[11px] sm:text-xs font-semibold text-slate-700 truncate">Auto Estimates</span>
                </div>
                <div className="flex items-center space-x-2 bg-white/90 border border-slate-200 p-2 sm:p-2.5 rounded-lg shadow-2xs hover:border-purple-300 transition-colors">
                  <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-purple-600 shrink-0" />
                  <span className="text-[11px] sm:text-xs font-semibold text-slate-700 truncate">Auto Bills</span>
                </div>
                <div className="flex items-center space-x-2 bg-white/90 border border-slate-200 p-2 sm:p-2.5 rounded-lg shadow-2xs hover:border-amber-300 transition-colors">
                  <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-600 shrink-0" />
                  <span className="text-[11px] sm:text-xs font-semibold text-slate-700 truncate">Oil Accounting</span>
                </div>
                <div className="flex items-center space-x-2 bg-white/90 border border-slate-200 p-2 sm:p-2.5 rounded-lg shadow-2xs hover:border-teal-300 transition-colors">
                  <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-teal-600 shrink-0" />
                  <span className="text-[11px] sm:text-xs font-semibold text-slate-700 truncate">Multi-Agencies</span>
                </div>
              </div>

              {/* Trust Metric Counters */}
              <div className="pt-3 sm:pt-4 border-t border-slate-200 grid grid-cols-3 gap-2 sm:gap-6 text-slate-600">
                <div className="text-center sm:text-left">
                  <div className="text-base sm:text-lg font-extrabold text-slate-900 flex items-center justify-center sm:justify-start gap-1 sm:gap-1.5">
                    <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-600 shrink-0" />
                    <span className="truncate">Reports</span>
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-slate-500 font-medium">Auto-Generate</div>
                </div>
                <div className="text-center sm:text-left border-x sm:border-x-0 border-slate-200 px-1 sm:px-0">
                  <div className="text-base sm:text-lg font-extrabold text-slate-900 flex items-center justify-center sm:justify-start gap-1 sm:gap-1.5">
                    <Headphones className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600 shrink-0" />
                    <span className="truncate">Email</span>
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-slate-500 font-medium">Direct support</div>
                </div>
                <div className="text-center sm:text-left">
                  <div className="text-base sm:text-lg font-extrabold text-slate-900 flex items-center justify-center sm:justify-start gap-1 sm:gap-1.5">
                    <Building2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-600 shrink-0" />
                    <span className="truncate">Agencies</span>
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-slate-500 font-medium">Multi-Tenant</div>
                </div>
              </div>
            </div>

            {/* Hero Right: Sign In / Login Card */}
            <div className="lg:col-span-5" id="login-section">
              <div className="bg-white rounded-2xl shadow-xl border border-slate-200/90 p-5 sm:p-8 lg:p-9 relative">
                
                {/* Visual Accent Bar */}
                <div className="absolute top-0 left-6 right-6 sm:left-8 sm:right-8 h-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-full"></div>

                <div className="text-center mb-5 sm:mb-6">
                  <div className="inline-block relative mb-2 sm:mb-3">
                    <img 
                      src={APP_MARK} 
                      alt="TransRegister" 
                      className="w-14 h-14 sm:w-16 sm:h-16 mx-auto" 
                      referrerPolicy="no-referrer"
                    />
                    <span className="absolute -bottom-1 -right-1 bg-emerald-600 text-white text-[8px] sm:text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border-2 border-white shadow-xs">
                      ACTIVE
                    </span>
                  </div>
                  <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Agency Portal Access</h2>
                  <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">Authorized Workshop Engineers & Admin Personnel</p>
                </div>

                <div className="space-y-3 sm:space-y-4">
                  <button
                    onClick={onLogin}
                    disabled={isLoading}
                    className="w-full bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white font-bold py-3 sm:py-3.5 px-4 rounded-xl shadow-md transition-all flex items-center justify-center gap-2.5 sm:gap-3 text-xs sm:text-sm cursor-pointer disabled:opacity-60 border border-slate-800 min-h-[48px] touch-manipulation"
                  >
                    <svg className="w-4 h-4 fill-current text-white shrink-0" viewBox="0 0 24 24">
                      <path d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.761H12.545z"/>
                    </svg>
                    <span>{isLoading ? 'Authenticating...' : 'Sign In with Google SSO'}</span>
                  </button>

                  <div className="bg-slate-50 p-3 sm:p-3.5 rounded-xl border border-slate-200/80 text-[10px] sm:text-[11px] text-slate-600 space-y-1 sm:space-y-1.5">
                    <div className="flex items-center text-slate-800 font-semibold gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600 shrink-0" />
                      <span>Enterprise Security Protocol</span>
                    </div>
                    <p className="text-slate-500 leading-relaxed">
                      Access is restricted to authorized workshop emails. All session credentials and data logs are protected with Google Cloud Firebase security rules.
                    </p>
                  </div>

                  <div className="pt-1 text-center">
                    <p className="text-[10px] sm:text-[11px] text-slate-400 leading-relaxed">
                      {/* ⚠ REAL URLS, NOT MODAL TRIGGERS (AUDIT G41). These opened dialogs, so
                          the documents a user was agreeing to had no address at all: they could
                          not be linked to, bookmarked, sent to anyone, crawled, or opened by a
                          payment processor's reviewer. A term you accept by signing in has to be
                          one you can read without signing in. */}
                      By signing in, you agree to our{' '}
                      <a href="/terms" className="text-blue-600 hover:underline font-semibold">
                        Terms of Service
                      </a>{' '}
                      and{' '}
                      <a href="/privacy" className="text-blue-600 hover:underline font-semibold">
                        Privacy Policy
                      </a>.
                    </p>
                  </div>
                </div>

              </div>
            </div>

          </div>
        </div>
      </section>

      {/* About the Application Section */}
      <section id="about" className="py-10 sm:py-16 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-8 sm:mb-12">
            <span className="text-[10px] sm:text-xs font-extrabold uppercase tracking-widest text-blue-600 bg-blue-50 px-2.5 sm:px-3 py-1 rounded-full border border-blue-100">
              Application Overview
            </span>
            <h2 className="text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 tracking-tight mt-2.5 sm:mt-3">
              Purpose-Built for Electrical Transformer Repair Industry
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 mt-2 sm:mt-3 leading-relaxed">
              Designed in collaboration with certified transformer overhaul workshops and licensed DISCOM repairers to eliminate manual paper registers, prevent calculation errors, and provide complete start-to-end delivery tracking and instant ISO-grade documentation.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
            <div className="bg-slate-50 p-4 sm:p-6 rounded-2xl border border-slate-200 hover:border-blue-200 transition-colors shadow-2xs">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 mb-3 sm:mb-4 font-bold">
                <Building2 className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 mb-1.5 sm:mb-2">Multi-Agencies Supported</h3>
              <p className="text-[11px] sm:text-xs text-slate-600 leading-relaxed">
                Seamlessly manage multiple transformer repair workshops under dedicated agency workspaces (e.g. Ideal Engineering, Apex Transformers) with custom letterheads, addresses, GSTIN, and authorized signatories.
              </p>
            </div>

            <div className="bg-slate-50 p-4 sm:p-6 rounded-2xl border border-slate-200 hover:border-indigo-200 transition-colors shadow-2xs">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 mb-3 sm:mb-4 font-bold">
                <Scale className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 mb-1.5 sm:mb-2">Auto-Generate Estimates & Bills</h3>
              <p className="text-[11px] sm:text-xs text-slate-600 leading-relaxed">
                Automated Schedule of Rates (SOR) pricing engine. Instant cost estimation, scrap copper/aluminum deductions, and automated 1-click GST tax bill generation for utility approvals.
              </p>
            </div>

            <div className="bg-slate-50 p-4 sm:p-6 rounded-2xl border border-slate-200 hover:border-emerald-200 transition-colors shadow-2xs">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600 mb-3 sm:mb-4 font-bold">
                <Printer className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 mb-1.5 sm:mb-2">Generate Reports & Oil Accounting</h3>
              <p className="text-[11px] sm:text-xs text-slate-600 leading-relaxed">
                Generate standardized test certificates, comprehensive oil accounting stock ledgers, gate passes, and export ready-to-print A4 stationery documents with zero formatting headaches.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Core Modules Showcase */}
      <section id="features" className="py-10 sm:py-16 bg-slate-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-8 sm:mb-12">
            <span className="text-[10px] sm:text-xs font-extrabold uppercase tracking-widest text-indigo-600 bg-indigo-50 px-2.5 sm:px-3 py-1 rounded-full border border-indigo-100">
              Full Suite Modules
            </span>
            <h2 className="text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 tracking-tight mt-2.5 sm:mt-3">
              Comprehensive Operations Management
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 mt-2">
              Everything required to maintain rigorous engineering control, audit compliance, and fast turnarounds.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            
            {/* Module 1 */}
            <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-2xs hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-3 mb-2.5 sm:mb-3">
                <div className="p-2 sm:p-2.5 bg-blue-50 text-blue-600 rounded-lg font-bold">
                  <Database className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-900">MR Inward Registry</h4>
                  <span className="text-[9px] sm:text-[10px] text-blue-600 font-semibold">Step 1: Inward Receipt</span>
                </div>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-600 leading-relaxed mb-3">
                Records incoming DISCOM Material Receipts (MR), division codes, vehicle entry, transformer capacity, serial numbers, and warranty classification (GP vs non-GP).
              </p>
              <ul className="text-[10px] sm:text-[11px] text-slate-500 space-y-1">
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> Multi-transformer job entry</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> Division & Sub-division tagging</li>
              </ul>
            </div>

            {/* Module 2 */}
            <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-2xs hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-3 mb-2.5 sm:mb-3">
                <div className="p-2 sm:p-2.5 bg-amber-50 text-amber-600 rounded-lg font-bold">
                  <Wrench className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-900">Inspection & Diagnostics</h4>
                  <span className="text-[9px] sm:text-[10px] text-amber-600 font-semibold">Step 2: Technical Audit</span>
                </div>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-600 leading-relaxed mb-3">
                Audit physical accessories, HV/LV bushings, core condition, damaged winding weights, conservator tank, and calculate instant oil shortfall.
              </p>
              <ul className="text-[10px] sm:text-[11px] text-slate-500 space-y-1">
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> Bushing and metal parts count</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> Instant Oil Available computation</li>
              </ul>
            </div>

            {/* Module 3 */}
            <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-2xs hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-3 mb-2.5 sm:mb-3">
                <div className="p-2 sm:p-2.5 bg-emerald-50 text-emerald-600 rounded-lg font-bold">
                  <Scale className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-900">Auto-Generate Estimates</h4>
                  <span className="text-[9px] sm:text-[10px] text-emerald-600 font-semibold">Step 3: AT Costing Engine</span>
                </div>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-600 leading-relaxed mb-3">
                Schedule of Rates calculator configured with DISCOM AT contractual rates. Computes repair cost, scrap deduction, and net taxable proposal with zero manual arithmetic.
              </p>
              <ul className="text-[10px] sm:text-[11px] text-slate-500 space-y-1">
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> Tender rate schedule presets</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> Automated GST & scrap offsets</li>
              </ul>
            </div>

            {/* Module 4 */}
            <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-2xs hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-3 mb-2.5 sm:mb-3">
                <div className="p-2 sm:p-2.5 bg-purple-50 text-purple-600 rounded-lg font-bold">
                  <Activity className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-900">Electrical Testing Lab</h4>
                  <span className="text-[9px] sm:text-[10px] text-purple-600 font-semibold">Step 4: Quality Assurance</span>
                </div>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-600 leading-relaxed mb-3">
                Record all routine test observations: HV Withstand (21kV/3kV 60s), DVDF, No-Load Loss, Full-Load Loss, Ratio, % Impedance, and Oil BDV in kV.
              </p>
              <ul className="text-[10px] sm:text-[11px] text-slate-500 space-y-1">
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> Supervised testing format</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> High-speed bulk data fill</li>
              </ul>
            </div>

            {/* Module 5 */}
            <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-2xs hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-3 mb-2.5 sm:mb-3">
                <div className="p-2 sm:p-2.5 bg-indigo-50 text-indigo-600 rounded-lg font-bold">
                  <FileSpreadsheet className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-900">Auto-Generate Bills</h4>
                  <span className="text-[9px] sm:text-[10px] text-indigo-600 font-semibold">Step 5: Estimate & Billing Stage</span>
                </div>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-600 leading-relaxed mb-3">
                Generate verified DISCOM tax invoices and billing summaries directly from inspection & test records with auto-calculated GST, HSN codes, and scrap credits.
              </p>
              <ul className="text-[10px] sm:text-[11px] text-slate-500 space-y-1">
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> 1-Click Tax Invoice generation</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> Printable billing summaries</li>
              </ul>
            </div>

            {/* Module 6 */}
            <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-2xs hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-3 mb-2.5 sm:mb-3">
                <div className="p-2 sm:p-2.5 bg-sky-50 text-sky-600 rounded-lg font-bold">
                  <Truck className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-900">Challan & Delivery Support</h4>
                  <span className="text-[9px] sm:text-[10px] text-sky-600 font-semibold">Step 6: Start to End Delivery</span>
                </div>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-600 leading-relaxed mb-3">
                Start-to-end delivery tracking: generate official Delivery Challans, vehicle dispatch notes, gate passes, and reconcile final oil accounting stock with DISCOM divisions.
              </p>
              <ul className="text-[10px] sm:text-[11px] text-slate-500 space-y-1">
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> DISCOM Delivery Challan & Gate Pass</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> Full lifecycle job completion audit</li>
              </ul>
            </div>

          </div>
        </div>
      </section>

      {/* Workflow Process Pipeline - Full Start to End Support */}
      <section id="workflow" className="py-10 sm:py-16 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-8 sm:mb-12">
            <span className="text-[10px] sm:text-xs font-extrabold uppercase tracking-widest text-emerald-600 bg-emerald-50 px-2.5 sm:px-3 py-1 rounded-full border border-emerald-100">
              Start to End Lifecycle
            </span>
            <h2 className="text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 tracking-tight mt-2.5 sm:mt-3">
              Comprehensive 6-Stage Overhaul & Delivery Pipeline
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 mt-2">
              End-to-end operational visibility with start-to-end challan and delivery support for utility engineers and overhaul contractors.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 sm:gap-4">
            {[
              { 
                num: '01', 
                title: 'MR Inward Entry', 
                desc: 'Receipt of damaged units, job assignment, division tagging, and initial vehicle verification.' 
              },
              { 
                num: '02', 
                title: 'Inspection Audit', 
                desc: 'Joint inspection for missing accessories, coil damage weights, and tank condition status.' 
              },
              { 
                num: '03', 
                title: 'Overhaul & Rewind', 
                desc: 'Coil rewinding, core re-stacking, insulation baking, fresh gaskets fitting & tank assembly.' 
              },
              { 
                num: '04', 
                title: 'Testing & Lab Reports', 
                desc: 'Loss measurements at rated voltage, BDV test, HV withstand, and instant test report generation.' 
              },
              { 
                num: '05', 
                title: 'Estimate & Billing Stage', 
                desc: 'Auto-generate estimates, tender rate calculation, scrap credit offsets, and GST Tax Invoices.' 
              },
              { 
                num: '06', 
                title: 'Challan & Delivery', 
                desc: 'Start-to-end delivery tracking, official Delivery Challan, Gate Pass, and final oil stock sign-off.' 
              }
            ].map((step, idx) => (
              <div key={idx} className="bg-slate-50 p-3.5 sm:p-4 rounded-xl border border-slate-200 relative flex flex-col justify-between hover:border-blue-300 transition-colors shadow-2xs">
                <div>
                  <span className="text-xl sm:text-2xl font-black text-blue-600/30">{step.num}</span>
                  <h4 className="text-xs font-bold text-slate-900 mt-1 mb-1">{step.title}</h4>
                  <p className="text-[10px] sm:text-[11px] text-slate-500 leading-relaxed">{step.desc}</p>
                </div>
                <div className="mt-2.5 pt-2 border-t border-slate-200 flex items-center justify-between text-[10px] font-semibold text-slate-400">
                  <span className="text-blue-600 font-bold">Stage {idx + 1}</span>
                  <Check className="w-3 h-3 text-emerald-600" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Support and reliability. See the note at the top of this file about what stood here. */}
      <section id="support" className="py-10 sm:py-16 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white border-b border-slate-800 relative overflow-hidden">
        {/* Glow decoration */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-center">
            
            <div className="lg:col-span-7 space-y-3.5 sm:space-y-4">
              <div className="inline-flex items-center space-x-2 bg-blue-500/10 border border-blue-400/20 px-2.5 sm:px-3 py-1 rounded-full text-blue-400 text-[11px] sm:text-xs font-bold">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>Built for tender deadlines</span>
              </div>
              {/* ⚠ THIS CLAIMED 24*7 SUPPORT AND A "cloud operations team". There is neither:
                  support is one person answering a ticket form during working hours, and the
                  support panel is unbuilt by decision. What replaced it is true and is a better
                  claim anyway - the service running unattended is a real property of hosting it
                  on Google Cloud; a team that does not exist is not. */}
              <h2 className="text-xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white leading-tight">
                Your records, available whenever the workshop is
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                Transformer overhaul runs to tight DISCOM turnaround deadlines. The application
                runs on Google Cloud and is available around the clock, so a job card can be
                raised or a bill printed at whatever hour the work actually happens. Support
                questions are answered by email during working hours.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 pt-1 sm:pt-2">
                <div className="bg-slate-800/80 border border-slate-700/80 p-3.5 sm:p-4 rounded-xl">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs mb-1">
                    <FileSpreadsheet className="w-4 h-4 shrink-0" />
                    <span>Multi Reports Generate</span>
                  </div>
                  <p className="text-[10px] sm:text-[11px] text-slate-400 leading-relaxed">
                    One-click generation of Testing Certificates, Estimates, Tax Invoices, Delivery Challans, and Registers.
                  </p>
                </div>

                <div className="bg-slate-800/80 border border-slate-700/80 p-3.5 sm:p-4 rounded-xl">
                  <div className="flex items-center gap-2 text-blue-400 font-bold text-xs mb-1">
                    <Headphones className="w-4 h-4 shrink-0" />
                    <span>Direct email support</span>
                  </div>
                  <p className="text-[10px] sm:text-[11px] text-slate-400 leading-relaxed">
                    Questions about print margins, DISCOM AT rate setup or your data go straight to the person who built the software. Answered during working hours.
                  </p>
                </div>
              </div>
            </div>

            <div className="lg:col-span-5 bg-white/5 border border-white/10 rounded-2xl p-5 sm:p-7 backdrop-blur-md">
              <h3 className="text-sm sm:text-base font-bold text-white mb-2 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400 shrink-0" />
                {/* ⚠ THERE IS NO SLA, NO GUARANTEE AND NO MEASURED 99.9%. The Terms now say so in as
                      many words. "Enterprise" described nothing, and a percentage nobody
                      measures is a number invented to look like one. */}
                  <span>Where your data lives</span>
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-300 mb-3 sm:mb-4 leading-relaxed">
                Records are held in Google Cloud Firestore with per-agency access rules, and can be exported to Excel or PDF at any time from the screens that produce them.
              </p>

              <div className="space-y-2 text-[11px] sm:text-xs text-slate-300">
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400 shrink-0" />
                  <span>Real-time Google Cloud Firestore synchronization</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400 shrink-0" />
                  <span>Automated PDF stationery & report rendering support</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400 shrink-0" />
                  <span>Instant Multi-Agency workspace onboarding</span>
                </div>
              </div>

              <div className="mt-5 sm:mt-6 pt-3 sm:pt-4 border-t border-white/10 flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium text-[11px] sm:text-xs">Have an inquiry?</span>
                <button
                  onClick={() => {
                    const loginCard = document.getElementById('login-section');
                    loginCard?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1 cursor-pointer min-h-[36px] touch-manipulation"
                >
                  <span>Connect with Engineering</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* Terms and Conditions Section */}
      <section id="terms" className="py-10 sm:py-16 bg-slate-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-8 sm:mb-12">
            <span className="text-[10px] sm:text-xs font-extrabold uppercase tracking-widest text-slate-600 bg-slate-200 px-2.5 sm:px-3 py-1 rounded-full">
              Legal & Compliance Framework
            </span>
            <h2 className="text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 tracking-tight mt-2.5 sm:mt-3">
              Terms & Conditions of Software Use
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 mt-2">
              Clear operational agreements, safety standards compliance, and data confidentiality guidelines.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 max-w-5xl mx-auto">
            
            <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex items-center space-x-2.5 mb-2.5 text-slate-900 font-bold text-xs sm:text-sm">
                <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                <h3>1. Authorized Agency Operation</h3>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-600 leading-relaxed">
                This software is intended strictly for licensed Electrical Contractors, Transformer Repair Workshops, and authorized DISCOM personnel. Users must maintain active agency registration and provide accurate company GSTIN credentials.
              </p>
            </div>

            <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex items-center space-x-2.5 mb-2.5 text-slate-900 font-bold text-xs sm:text-sm">
                <Activity className="w-4 h-4 text-indigo-600 shrink-0" />
                <h3>2. Technical & Testing Guarantee</h3>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-600 leading-relaxed">
                Testing records generated via this portal must correspond to real physical measurements taken with calibrated test benches in accordance with IS 1180 (Part 1) and IS 2026. The agency takes full legal responsibility for test report accuracy.
              </p>
            </div>

            <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex items-center space-x-2.5 mb-2.5 text-slate-900 font-bold text-xs sm:text-sm">
                <Lock className="w-4 h-4 text-emerald-600 shrink-0" />
                <h3>3. Data Confidentiality & Cloud Isolation</h3>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-600 leading-relaxed">
                All Material Receipts, rates, job records, and inspection logs are securely partitioned per registered agency. Data is stored on Google Cloud Firestore with enterprise-grade encryption at rest and in transit.
              </p>
            </div>

            <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex items-center space-x-2.5 mb-2.5 text-slate-900 font-bold text-xs sm:text-sm">
                <Scale className="w-4 h-4 text-purple-600 shrink-0" />
                <h3>4. Schedule of Rates & Invoicing Calculations</h3>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-600 leading-relaxed">
                Tender rate calculation outputs, scrap deductions, and GST invoices are computed in accordance with user-configured rate tables and DISCOM contract terms. Users must verify final invoice figures before tax filing.
              </p>
            </div>

          </div>

          <div className="text-center mt-6 sm:mt-8">
            {/* ⚠ "SLA Agreement" IS NOT OFFERED AND WAS NEVER OFFERED. The Terms carry no
                service level and now say so explicitly; a button promising one is the same
                false claim as the 24*7 support it sat beside. */}
            <a
              href="/terms"
              className="inline-flex items-center space-x-2 px-4 sm:px-5 py-2.5 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold rounded-lg border border-slate-300 shadow-2xs cursor-pointer transition-colors min-h-[44px] touch-manipulation"
            >
              <span>Read the full Terms of Service</span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
            </a>
          </div>
        </div>
      </section>

      {/* Frequently Asked Questions (FAQ) */}
      <section id="faq" className="py-10 sm:py-16 bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8 sm:mb-10">
            <span className="text-[10px] sm:text-xs font-extrabold uppercase tracking-widest text-blue-600 bg-blue-50 px-2.5 sm:px-3 py-1 rounded-full border border-blue-100">
              Support & Guidance
            </span>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-2.5 sm:mt-3">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="space-y-2.5 sm:space-y-3">
            {[
              {
                q: "What does Start-to-End Challan and Delivery Support include?",
                a: "The system provides complete lifecycle tracking: from recording incoming damaged transformer vehicle batches (MR Inward), conducting external and core audits, logging lab testing loss reports, calculating AT rates, to generating official DISCOM Delivery Challans, Gate Passes, and closing the job."
              },
              {
                q: "How does support work?",
                a: "Write to the support address, or use the support form inside the application - both reach the proprietor directly, who answers during Indian business hours on working days. There is no call centre and no overnight desk. The software itself runs on Google Cloud and is available at any hour, so a job card can be raised or a bill printed whenever the work happens."
              },
              {
                q: "Can I print reports directly on my company's physical pre-printed letterhead?",
                a: "Yes! In the Agency Settings tab, you can enable 'Print on Physical Letterhead' and customize the exact top margin (in millimeters) to match your physical stationery header height. When printing, the app automatically suppresses the digital header."
              },
              {
                q: "How does the system handle multi-page landscape reports?",
                a: "For large batches of transformers (e.g. 10 to 50 transformers in a single MR), the software automatically partitions the data into neat A4 landscape pages (8–9 transformers per sheet) with repeated column headers and signature blocks on the final page."
              },
              {
                q: "Can multiple engineers use the application simultaneously?",
                a: "Yes. All data updates sync in real-time through Google Cloud Firestore. The testing engineer can record loss lab measurements in the testing bay while the admin staff prepares delivery challans and invoices in the office."
              },
              {
                q: "What transformer capacities and star ratings are supported?",
                a: "The system natively supports all standard distribution transformer capacities and ratings in both Aluminum and Copper windings, for Level 1, Level 2, and Level 3 energy efficiency ratings."
              }
            ].map((faq, i) => (
              <div key={i} className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50">
                <button
                  onClick={() => toggleFaq(i)}
                  className="w-full px-4 sm:px-5 py-3.5 sm:py-4 text-left flex items-center justify-between text-xs font-bold text-slate-800 hover:text-blue-600 transition-colors min-h-[48px] touch-manipulation gap-3"
                >
                  <span>{faq.q}</span>
                  {activeFaq === i ? <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />}
                </button>
                {activeFaq === i && (
                  <div className="px-4 sm:px-5 pb-3.5 sm:pb-4 text-[11px] sm:text-xs text-slate-600 leading-relaxed border-t border-slate-200/60 pt-3 bg-white">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Call to Action Bar */}
      <section className="py-10 sm:py-12 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-3 sm:space-y-4">
          <h2 className="text-xl sm:text-2xl font-black tracking-tight">Ready to streamline your repair workshop operations?</h2>
          <p className="text-xs text-slate-400 max-w-xl mx-auto leading-relaxed">
            Log in with your Google account to reach your agency dashboard, active job orders and testing reports.
          </p>
          <div className="pt-1 sm:pt-2">
            <button
              onClick={onLogin}
              disabled={isLoading}
              className="px-5 sm:px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-lg transition-all inline-flex items-center gap-2 cursor-pointer min-h-[48px] touch-manipulation"
            >
              <span>Launch Agency Portal</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Professional Footer */}
      <footer className="bg-slate-950 text-slate-400 py-8 sm:py-10 border-t border-slate-800 text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 sm:gap-6">
            <div className="flex items-center space-x-3 text-center md:text-left">
              <img 
                src={APP_MARK} 
                alt="TransRegister" 
                className="w-8 h-8 shrink-0" 
                referrerPolicy="no-referrer"
              />
              <div>
                <div className="text-white font-extrabold text-xs sm:text-sm">TransRegister</div>
                <div className="text-[9px] sm:text-[10px] text-slate-500">Transformer Repair Management ERP System</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-[10px] sm:text-[11px]">
              {/* ⚠ EVERY POLICY IS LINKED FROM HERE. A merchant reviewer looks in the footer
                  first, and a policy that exists but is not linked from the front page is one
                  they will not find (AUDIT G41). */}
              <a href="/pricing" className="hover:text-white transition-colors py-1">Pricing</a>
              <a href="/terms" className="hover:text-white transition-colors py-1">Terms of Service</a>
              <a href="/privacy" className="hover:text-white transition-colors py-1">Privacy Policy</a>
              <a href="/refunds" className="hover:text-white transition-colors py-1">Refunds &amp; Cancellation</a>
              <a href="/shipping" className="hover:text-white transition-colors py-1">Delivery</a>
              <a href="/contact" className="hover:text-white transition-colors py-1">Contact</a>
              <span className="text-slate-600 hidden sm:inline">&bull;</span>
              {/* ⚠ "24*7 Support" WAS HERE AND WAS NOT TRUE. One person answers a ticket form.
                  A service-level claim the product does not meet is a defect anywhere; in a
                  footer a payment processor reads before approving a merchant, it invites the
                  review to fail on something that was never needed. */}
              <span className="text-slate-400 font-semibold flex items-center gap-1 py-1">
                <Headphones className="w-3 h-3" /> Email support
              </span>
            </div>

            <div className="text-[9px] sm:text-[10px] text-slate-500 text-center md:text-right">
              {/* ⚠ THE OPERATOR IS NAMED. The site identified itself as "TransRegister" and
                  nothing else - no legal entity anywhere on any page - and a payment processor
                  must be able to check that whoever takes the money is whoever the site says
                  runs it. A proprietorship's legal party is the PROPRIETOR; the trade name is a
                  style, not an entity. */}
              © {new Date().getFullYear()} {SELLER.legalName}, trading as {SELLER.tradeName}.
              GSTIN {SELLER.gstin}. All rights reserved.
            </div>
          </div>
        </div>
      </footer>

      {/* ⚠ THE TWO MODALS ARE GONE (AUDIT G41). The Terms and the Privacy Policy lived here
          as dialog state, which meant the documents a user agreed to by signing in had no URL:
          nothing to link, bookmark, send, crawl, or hand to a payment processor's reviewer. They
          are now pages at /terms and /privacy, reachable signed out, and the links above point
          at them. Six policy pages exist; a modal cannot be one of them. */}

    </div>
  );
}
