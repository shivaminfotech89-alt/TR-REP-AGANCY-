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
  PhoneCall
} from 'lucide-react';
import appLogo from '../assets/images/transformer_app_logo_1786648240128.jpg';
import heroBg from '../assets/images/transformer_hero_bg_1786648256385.jpg';

interface LandingPageProps {
  onLogin: () => void;
  isLoading?: boolean;
}

export default function LandingPage({ onLogin, isLoading = false }: LandingPageProps) {
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setActiveFaq(activeFaq === index ? null : index);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-blue-600 selection:text-white relative">
      
      {/* Top 24/7 Technical Support & Compliance Notice Bar */}
      <div className="bg-slate-900 text-slate-300 text-[11px] font-medium py-1.5 px-4 border-b border-slate-800">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-white font-bold flex items-center gap-1">
              <Headphones className="w-3.5 h-3.5 text-blue-400" />
              24/7 Technical Support Active
            </span>
            <span className="hidden sm:inline text-slate-500">|</span>
            <span className="hidden sm:inline text-slate-400">Dedicated Engineering & Cloud Assistance for Overhaul Agencies</span>
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span className="flex items-center gap-1 text-emerald-400 font-semibold">
              <FileSpreadsheet className="w-3.5 h-3.5" /> Multi Reports Generate & Instant Export
            </span>
          </div>
        </div>
      </div>

      {/* Top Professional Navigation */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img 
              src={appLogo} 
              alt="TR Rep Agency" 
              className="w-10 h-10 rounded-lg object-cover border border-slate-200 shadow-xs" 
              referrerPolicy="no-referrer"
            />
            <div>
              <span className="font-extrabold text-slate-900 text-base tracking-tight flex items-center gap-1.5">
                TR REP AGENCY <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-1.5 py-0.5 rounded">PRO v2.5</span>
              </span>
              <p className="text-[10px] text-slate-500 font-medium">Transformer Repair & Overhaul ERP</p>
            </div>
          </div>

          <nav className="hidden md:flex items-center space-x-8 text-xs font-semibold text-slate-600">
            <a href="#about" className="hover:text-blue-600 transition-colors">About App</a>
            <a href="#features" className="hover:text-blue-600 transition-colors">Core Modules</a>
            <a href="#workflow" className="hover:text-blue-600 transition-colors">Process Lifecycle</a>
            <a href="#support" className="hover:text-blue-600 transition-colors">24/7 Support</a>
            <a href="#terms" className="hover:text-blue-600 transition-colors">Terms & Compliance</a>
            <a href="#faq" className="hover:text-blue-600 transition-colors">FAQ</a>
          </nav>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => {
                const loginCard = document.getElementById('login-section');
                loginCard?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="px-4 py-2 text-xs font-bold text-slate-700 hover:text-blue-600 transition-colors hidden sm:block"
            >
              Sign In
            </button>
            <button
              onClick={onLogin}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-bold rounded-lg shadow-sm transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
            >
              <span>Access Portal</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section with Light Workshop Aesthetic */}
      <section className="relative overflow-hidden pt-8 pb-16 lg:py-20 border-b border-slate-200 bg-gradient-to-b from-slate-100/80 via-white to-slate-50">
        
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
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            
            {/* Hero Left Content */}
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center space-x-2 bg-blue-50 border border-blue-200/80 px-3 py-1.5 rounded-full text-blue-700 text-xs font-bold tracking-wide">
                <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
                <span>DISCOM & MSEDCL Specification Compliant ERP</span>
              </div>

              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-slate-900 tracking-tight leading-[1.15]">
                Distribution Transformer <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-700">Repair, Overhaul & Testing</span> Suite
              </h1>

              <p className="text-base text-slate-600 leading-relaxed font-normal">
                End-to-end operational software designed specifically for Electrical Repair Agencies, Overhaul Workshops, and DISCOM Contractors. Full <strong>Start-to-End Support</strong> from <strong>MR Inward</strong> and <strong>Internal Coil Damage Audits</strong> to <strong>Routine Loss Testing</strong>, <strong>Oil Accounting</strong>, <strong>Auto-Generated Estimates & Bills</strong>, and <strong>Final Delivery Challans</strong>.
              </p>

              {/* Quick Feature Pill Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
                <div className="flex items-center space-x-2 bg-white/90 border border-slate-200 p-2.5 rounded-lg shadow-2xs hover:border-blue-300 transition-colors">
                  <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="text-xs font-semibold text-slate-700">User-Friendly Dashboard</span>
                </div>
                <div className="flex items-center space-x-2 bg-white/90 border border-slate-200 p-2.5 rounded-lg shadow-2xs hover:border-emerald-300 transition-colors">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-xs font-semibold text-slate-700">Multi Reports Generate</span>
                </div>
                <div className="flex items-center space-x-2 bg-white/90 border border-slate-200 p-2.5 rounded-lg shadow-2xs hover:border-indigo-300 transition-colors">
                  <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span className="text-xs font-semibold text-slate-700">Auto-Generate Estimates</span>
                </div>
                <div className="flex items-center space-x-2 bg-white/90 border border-slate-200 p-2.5 rounded-lg shadow-2xs hover:border-purple-300 transition-colors">
                  <CheckCircle2 className="w-4 h-4 text-purple-600 shrink-0" />
                  <span className="text-xs font-semibold text-slate-700">Auto-Generate Bills</span>
                </div>
                <div className="flex items-center space-x-2 bg-white/90 border border-slate-200 p-2.5 rounded-lg shadow-2xs hover:border-amber-300 transition-colors">
                  <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="text-xs font-semibold text-slate-700">Oil Accounting</span>
                </div>
                <div className="flex items-center space-x-2 bg-white/90 border border-slate-200 p-2.5 rounded-lg shadow-2xs hover:border-teal-300 transition-colors">
                  <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                  <span className="text-xs font-semibold text-slate-700">Multi-Agencies Supported</span>
                </div>
              </div>

              {/* Trust Metric Counters */}
              <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center gap-6 text-slate-600">
                <div>
                  <div className="text-lg font-extrabold text-slate-900 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-emerald-600" />
                    <span>Multi-Reports</span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-medium">Auto-Generate & Print</div>
                </div>
                <div className="h-8 w-px bg-slate-200"></div>
                <div>
                  <div className="text-lg font-extrabold text-slate-900 flex items-center gap-1.5">
                    <Headphones className="w-4 h-4 text-blue-600" />
                    <span>24*7 Support</span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-medium">Technical & Cloud Assistance</div>
                </div>
                <div className="h-8 w-px bg-slate-200"></div>
                <div>
                  <div className="text-lg font-extrabold text-slate-900 flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-indigo-600" />
                    <span>Multi-Agency</span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-medium">Isolated Workspaces</div>
                </div>
              </div>
            </div>

            {/* Hero Right: Sign In / Login Card */}
            <div className="lg:col-span-5" id="login-section">
              <div className="bg-white rounded-2xl shadow-xl border border-slate-200/90 p-8 sm:p-9 relative">
                
                {/* Visual Accent Bar */}
                <div className="absolute top-0 left-8 right-8 h-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-full"></div>

                <div className="text-center mb-6">
                  <div className="inline-block relative mb-3">
                    <img 
                      src={appLogo} 
                      alt="TR Rep Agency" 
                      className="w-16 h-16 rounded-xl mx-auto border-2 border-blue-100 shadow-sm object-cover" 
                      referrerPolicy="no-referrer"
                    />
                    <span className="absolute -bottom-1 -right-1 bg-emerald-600 text-white text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border-2 border-white shadow-xs">
                      ACTIVE
                    </span>
                  </div>
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">Agency Portal Access</h2>
                  <p className="text-xs text-slate-500 mt-1">Authorized Workshop Engineers & Admin Personnel</p>
                </div>

                <div className="space-y-4">
                  <button
                    onClick={onLogin}
                    disabled={isLoading}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-4 rounded-xl shadow-md transition-all flex items-center justify-center gap-3 text-sm cursor-pointer disabled:opacity-60 border border-slate-800"
                  >
                    <svg className="w-4 h-4 fill-current text-white" viewBox="0 0 24 24">
                      <path d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.761H12.545z"/>
                    </svg>
                    <span>{isLoading ? 'Authenticating...' : 'Sign In with Google SSO'}</span>
                  </button>

                  <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 text-[11px] text-slate-600 space-y-1.5">
                    <div className="flex items-center text-slate-800 font-semibold gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-blue-600" />
                      <span>Enterprise Security Protocol</span>
                    </div>
                    <p className="text-slate-500 leading-snug">
                      Access is restricted to authorized workshop emails. All session credentials and data logs are protected with Google Cloud Firebase security rules.
                    </p>
                  </div>

                  <div className="pt-2 text-center">
                    <p className="text-[11px] text-slate-400">
                      By signing in, you agree to our{' '}
                      <button 
                        onClick={() => setIsTermsModalOpen(true)}
                        className="text-blue-600 hover:underline font-semibold"
                      >
                        Terms of Service
                      </button>{' '}
                      and{' '}
                      <button 
                        onClick={() => setIsPrivacyModalOpen(true)}
                        className="text-blue-600 hover:underline font-semibold"
                      >
                        Privacy Policy
                      </button>.
                    </p>
                  </div>
                </div>

              </div>
            </div>

          </div>
        </div>
      </section>

      {/* About the Application Section */}
      <section id="about" className="py-16 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <span className="text-xs font-extrabold uppercase tracking-widest text-blue-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
              Application Overview
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mt-3">
              Purpose-Built for Electrical Transformer Repair Industry
            </h2>
            <p className="text-sm text-slate-600 mt-3 leading-relaxed">
              Designed in collaboration with certified transformer overhaul workshops and licensed DISCOM repairers to eliminate manual paper registers, prevent calculation errors, and provide complete start-to-end delivery tracking and instant ISO-grade documentation.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 hover:border-blue-200 transition-colors shadow-2xs">
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 mb-4 font-bold">
                <Building2 className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-2">Multi-Agencies Supported</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Seamlessly manage multiple transformer repair workshops under dedicated agency workspaces (e.g. Ideal Engineering, Apex Transformers) with custom letterheads, addresses, GSTIN, and authorized signatories.
              </p>
            </div>

            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 hover:border-indigo-200 transition-colors shadow-2xs">
              <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 mb-4 font-bold">
                <Scale className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-2">Auto-Generate Estimates & Bills</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Automated Schedule of Rates (SOR) pricing engine. Instant cost estimation, scrap copper/aluminum deductions, and automated 1-click GST tax bill generation for utility approvals.
              </p>
            </div>

            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 hover:border-emerald-200 transition-colors shadow-2xs">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600 mb-4 font-bold">
                <Printer className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-2">Generate Reports & Oil Accounting</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Generate standardized test certificates, comprehensive oil accounting stock ledgers, gate passes, and export ready-to-print A4 stationery documents with zero formatting headaches.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Core Modules Showcase */}
      <section id="features" className="py-16 bg-slate-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <span className="text-xs font-extrabold uppercase tracking-widest text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
              Full Suite Modules
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mt-3">
              Comprehensive Operations Management
            </h2>
            <p className="text-sm text-slate-600 mt-2">
              Everything required to maintain rigorous engineering control, audit compliance, and fast turnarounds.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            
            {/* Module 1 */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-3 mb-3">
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg font-bold">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">MR Inward Registry</h4>
                  <span className="text-[10px] text-blue-600 font-semibold">Step 1: Inward Receipt</span>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-3">
                Records incoming DISCOM Material Receipts (MR), division codes, vehicle entry, transformer capacity, serial numbers, and warranty classification (GP vs non-GP).
              </p>
              <ul className="text-[11px] text-slate-500 space-y-1">
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600" /> Multi-transformer job entry</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600" /> Division & Sub-division tagging</li>
              </ul>
            </div>

            {/* Module 2 */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-3 mb-3">
                <div className="p-2.5 bg-amber-50 text-amber-600 rounded-lg font-bold">
                  <Wrench className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Inspection & Diagnostics</h4>
                  <span className="text-[10px] text-amber-600 font-semibold">Step 2: Technical Audit</span>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-3">
                Audit physical accessories, HV/LV bushings, core condition, damaged winding weights, conservator tank, and calculate instant oil shortfall.
              </p>
              <ul className="text-[11px] text-slate-500 space-y-1">
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600" /> Bushing and metal parts count</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600" /> Instant Oil Available computation</li>
              </ul>
            </div>

            {/* Module 3 */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-3 mb-3">
                <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-lg font-bold">
                  <Scale className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Auto-Generate Estimates</h4>
                  <span className="text-[10px] text-emerald-600 font-semibold">Step 3: AT Costing Engine</span>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-3">
                Schedule of Rates calculator configured with DISCOM AT contractual rates. Computes repair cost, scrap deduction, and net taxable proposal with zero manual arithmetic.
              </p>
              <ul className="text-[11px] text-slate-500 space-y-1">
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600" /> Tender rate schedule presets</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600" /> Automated GST & scrap offsets</li>
              </ul>
            </div>

            {/* Module 4 */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-3 mb-3">
                <div className="p-2.5 bg-purple-50 text-purple-600 rounded-lg font-bold">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Electrical Testing Lab</h4>
                  <span className="text-[10px] text-purple-600 font-semibold">Step 4: Quality Assurance</span>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-3">
                Record all routine test observations: HV Withstand (21kV/3kV 60s), DVDF, No-Load Loss, Full-Load Loss, Ratio, % Impedance, and Oil BDV in kV.
              </p>
              <ul className="text-[11px] text-slate-500 space-y-1">
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600" /> Supervised testing format</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600" /> High-speed bulk data fill</li>
              </ul>
            </div>

            {/* Module 5 */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-3 mb-3">
                <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg font-bold">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Auto-Generate Bills</h4>
                  <span className="text-[10px] text-indigo-600 font-semibold">Step 5: Estimate & Billing Stage</span>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-3">
                Generate verified DISCOM tax invoices and billing summaries directly from inspection & test records with auto-calculated GST, HSN codes, and scrap credits.
              </p>
              <ul className="text-[11px] text-slate-500 space-y-1">
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600" /> 1-Click Tax Invoice generation</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600" /> Printable billing summaries</li>
              </ul>
            </div>

            {/* Module 6 */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs hover:shadow-md transition-shadow">
              <div className="flex items-center space-x-3 mb-3">
                <div className="p-2.5 bg-sky-50 text-sky-600 rounded-lg font-bold">
                  <Truck className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Challan & Delivery Support</h4>
                  <span className="text-[10px] text-sky-600 font-semibold">Step 6: Start to End Delivery</span>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-3">
                Start-to-end delivery tracking: generate official Delivery Challans, vehicle dispatch notes, gate passes, and reconcile final oil accounting stock with DISCOM divisions.
              </p>
              <ul className="text-[11px] text-slate-500 space-y-1">
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600" /> DISCOM Delivery Challan & Gate Pass</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600" /> Full lifecycle job completion audit</li>
              </ul>
            </div>

          </div>
        </div>
      </section>

      {/* Workflow Process Pipeline - Full Start to End Support */}
      <section id="workflow" className="py-16 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <span className="text-xs font-extrabold uppercase tracking-widest text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">
              Start to End Lifecycle
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mt-3">
              Comprehensive 6-Stage Overhaul & Delivery Pipeline
            </h2>
            <p className="text-sm text-slate-600 mt-2">
              End-to-end operational visibility with start-to-end challan and delivery support for utility engineers and overhaul contractors.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
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
              <div key={idx} className="bg-slate-50 p-4 rounded-xl border border-slate-200 relative flex flex-col justify-between hover:border-blue-300 transition-colors shadow-2xs">
                <div>
                  <span className="text-2xl font-black text-blue-600/30">{step.num}</span>
                  <h4 className="text-xs font-bold text-slate-900 mt-1 mb-1.5">{step.title}</h4>
                  <p className="text-[11px] text-slate-500 leading-normal">{step.desc}</p>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-200 flex items-center justify-between text-[10px] font-semibold text-slate-400">
                  <span className="text-blue-600 font-bold">Stage {idx + 1}</span>
                  <Check className="w-3 h-3 text-emerald-600" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 24*7 Technical Support Section */}
      <section id="support" className="py-16 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white border-b border-slate-800 relative overflow-hidden">
        {/* Glow decoration */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            
            <div className="lg:col-span-7 space-y-4">
              <div className="inline-flex items-center space-x-2 bg-blue-500/10 border border-blue-400/20 px-3 py-1 rounded-full text-blue-400 text-xs font-bold">
                <Clock className="w-3.5 h-3.5" />
                <span>Round-the-Clock Reliability</span>
              </div>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white">
                24*7 Technical Support & Cloud Reliability
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                We understand transformer overhaul facilities operate on tight DISCOM turnaround deadlines. Our dedicated technical support and cloud operations team are available around the clock to assist your workshop.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="bg-slate-800/80 border border-slate-700/80 p-4 rounded-xl">
                  <div className="flex items-center gap-2.5 text-emerald-400 font-bold text-xs mb-1">
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>Multi Reports Generate</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal">
                    One-click generation of Testing Certificates, Estimates, Tax Invoices, Delivery Challans, and Registers.
                  </p>
                </div>

                <div className="bg-slate-800/80 border border-slate-700/80 p-4 rounded-xl">
                  <div className="flex items-center gap-2.5 text-blue-400 font-bold text-xs mb-1">
                    <Headphones className="w-4 h-4" />
                    <span>24*7 Live Helpdesk</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal">
                    Direct technical assistance for stationery print margins, DISCOM AT rates setup, and database syncing.
                  </p>
                </div>
              </div>
            </div>

            <div className="lg:col-span-5 bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-7 backdrop-blur-md">
              <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <span>Enterprise SLA & Support Guarantee</span>
              </h3>
              <p className="text-xs text-slate-300 mb-4 leading-relaxed">
                Continuous automated database backups, 99.9% uptime cloud architecture, and priority engineer assistance.
              </p>

              <div className="space-y-2.5 text-xs text-slate-300">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Real-time Google Cloud Firestore synchronization</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Automated PDF stationery & report rendering support</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Instant Multi-Agency workspace onboarding</span>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Have an inquiry?</span>
                <button
                  onClick={() => {
                    const loginCard = document.getElementById('login-section');
                    loginCard?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="text-blue-400 hover:text-blue-300 font-bold flex items-center gap-1 cursor-pointer"
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
      <section id="terms" className="py-16 bg-slate-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <span className="text-xs font-extrabold uppercase tracking-widest text-slate-600 bg-slate-200 px-3 py-1 rounded-full">
              Legal & Compliance Framework
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mt-3">
              Terms & Conditions of Software Use
            </h2>
            <p className="text-sm text-slate-600 mt-2">
              Clear operational agreements, safety standards compliance, and data confidentiality guidelines.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto">
            
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex items-center space-x-2.5 mb-3 text-slate-900 font-bold text-sm">
                <ShieldCheck className="w-4 h-4 text-blue-600" />
                <h3>1. Authorized Agency Operation</h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                This software is intended strictly for licensed Electrical Contractors, Transformer Repair Workshops, and authorized DISCOM personnel. Users must maintain active agency registration and provide accurate company GSTIN credentials.
              </p>
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex items-center space-x-2.5 mb-3 text-slate-900 font-bold text-sm">
                <Activity className="w-4 h-4 text-indigo-600" />
                <h3>2. Technical & Testing Guarantee</h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Testing records generated via this portal must correspond to real physical measurements taken with calibrated test benches in accordance with IS 1180 (Part 1) and IS 2026. The agency takes full legal responsibility for test report accuracy.
              </p>
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex items-center space-x-2.5 mb-3 text-slate-900 font-bold text-sm">
                <Lock className="w-4 h-4 text-emerald-600" />
                <h3>3. Data Confidentiality & Cloud Isolation</h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                All Material Receipts, rates, job records, and inspection logs are securely partitioned per registered agency. Data is stored on Google Cloud Firestore with enterprise-grade encryption at rest and in transit.
              </p>
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs">
              <div className="flex items-center space-x-2.5 mb-3 text-slate-900 font-bold text-sm">
                <Scale className="w-4 h-4 text-purple-600" />
                <h3>4. Schedule of Rates & Invoicing Calculations</h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Tender rate calculation outputs, scrap deductions, and GST invoices are computed in accordance with user-configured rate tables and DISCOM contract terms. Users must verify final invoice figures before tax filing.
              </p>
            </div>

          </div>

          <div className="text-center mt-8">
            <button
              onClick={() => setIsTermsModalOpen(true)}
              className="inline-flex items-center space-x-2 px-5 py-2.5 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold rounded-lg border border-slate-300 shadow-2xs cursor-pointer transition-colors"
            >
              <span>Read Full Legal Terms & SLA Agreement</span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
            </button>
          </div>
        </div>
      </section>

      {/* Frequently Asked Questions (FAQ) */}
      <section id="faq" className="py-16 bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <span className="text-xs font-extrabold uppercase tracking-widest text-blue-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
              Support & Guidance
            </span>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight mt-3">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="space-y-3">
            {[
              {
                q: "What does Start-to-End Challan and Delivery Support include?",
                a: "The system provides complete lifecycle tracking: from recording incoming damaged transformer vehicle batches (MR Inward), conducting external and core audits, logging lab testing loss reports, calculating AT rates, to generating official DISCOM Delivery Challans, Gate Passes, and closing the job."
              },
              {
                q: "How does the 24*7 Technical Support work?",
                a: "Our cloud operations and engineering team offer 24*7 uptime monitoring, automated real-time database backups on Google Cloud Firestore, and live assistance with stationery margin adjustments, tender schedule setups, and user permissions."
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
                  className="w-full px-5 py-4 text-left flex items-center justify-between text-xs font-bold text-slate-800 hover:text-blue-600 transition-colors"
                >
                  <span>{faq.q}</span>
                  {activeFaq === i ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                </button>
                {activeFaq === i && (
                  <div className="px-5 pb-4 text-xs text-slate-600 leading-relaxed border-t border-slate-200/60 pt-3 bg-white">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Call to Action Bar */}
      <section className="py-12 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-4">
          <h2 className="text-2xl font-black tracking-tight">Ready to streamline your repair workshop operations?</h2>
          <p className="text-xs text-slate-400 max-w-xl mx-auto">
            Log in with your authorized Google account to access your agency dashboard, active job orders, and testing reports with 24*7 technical assistance.
          </p>
          <div className="pt-2">
            <button
              onClick={onLogin}
              disabled={isLoading}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-lg transition-all inline-flex items-center gap-2 cursor-pointer"
            >
              <span>Launch Agency Portal</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Professional Footer */}
      <footer className="bg-slate-950 text-slate-400 py-10 border-t border-slate-800 text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center space-x-3">
              <img 
                src={appLogo} 
                alt="TR Rep Agency" 
                className="w-8 h-8 rounded-lg object-cover border border-slate-700" 
                referrerPolicy="no-referrer"
              />
              <div>
                <div className="text-white font-extrabold text-sm">TR REP AGENCY</div>
                <div className="text-[10px] text-slate-500">Transformer Repair Management ERP System</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-[11px]">
              <button onClick={() => setIsTermsModalOpen(true)} className="hover:text-white transition-colors">
                Terms of Service
              </button>
              <button onClick={() => setIsPrivacyModalOpen(true)} className="hover:text-white transition-colors">
                Privacy Policy
              </button>
              <a href="#about" className="hover:text-white transition-colors">Documentation</a>
              <span className="text-slate-600">•</span>
              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                <Headphones className="w-3 h-3" /> 24*7 Technical Support
              </span>
            </div>

            <div className="text-[10px] text-slate-500 text-center md:text-right">
              © {new Date().getFullYear()} TR Rep Agency Suite. All rights reserved.
            </div>
          </div>
        </div>
      </footer>

      {/* Full Terms and Conditions Modal */}
      {isTermsModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-200">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900">Terms of Service & License Agreement</h3>
                <p className="text-xs text-slate-500">Effective Date: August 2026 • Version 2.5</p>
              </div>
              <button
                onClick={() => setIsTermsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs text-slate-600 leading-relaxed">
              <h4 className="font-bold text-slate-900 text-sm">1. Acceptance of Terms</h4>
              <p>
                By logging into or accessing the TR Rep Agency Transformer Repair Management Suite ("Software"), you agree to be bound by these Terms of Service. If you do not agree to these terms, you must not access or use the application.
              </p>

              <h4 className="font-bold text-slate-900 text-sm">2. Authorized Use & Contractor Credentials</h4>
              <p>
                Access to this ERP platform is strictly granted to registered electrical repair agencies, transformer overhaul workshops, certified electrical testing laboratories, and authorized utility (DISCOM) inspectors. You are responsible for ensuring that all login credentials remain secure.
              </p>

              <h4 className="font-bold text-slate-900 text-sm">3. Technical Data Integrity & Electrical Standards</h4>
              <p>
                The software provides automated calculations for excitation current, no-load loss, full-load loss, % impedance, oil BDV, and AT repair rates. Users agree that all entered test values must reflect true, calibrated measurements conducted in compliance with <strong>IS 1180 (Part 1): 2014</strong>, <strong>IS 2026</strong>, and relevant DISCOM specifications. The software developer assumes no liability for fraudulent, incorrect, or miscalibrated field entries.
              </p>

              <h4 className="font-bold text-slate-900 text-sm">4. Data Ownership & Cloud Storage</h4>
              <p>
                All transformer job cards, inspection records, delivery challans, and financial invoices entered by your agency remain the sole intellectual and proprietary property of your agency. Data is stored on isolated Google Cloud Firestore partitions with restricted access controls.
              </p>

              <h4 className="font-bold text-slate-900 text-sm">5. Schedule of Rates & Financial Disclaimer</h4>
              <p>
                The AT rate estimation module computes billing items based on tender contract rate schedules inputted by the user. Users must independently verify final GST tax computations before submitting invoices to state utility divisions.
              </p>

              <h4 className="font-bold text-slate-900 text-sm">6. Termination & Service Availability</h4>
              <p>
                The software service is provided on an "as is" and "as available" basis with high-availability cloud architecture and 24*7 support monitoring. Agencies may export their data to Excel/PDF formats at any time.
              </p>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex justify-end">
              <button
                onClick={() => setIsTermsModalOpen(false)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
              >
                I Understand & Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Privacy Policy Modal */}
      {isPrivacyModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-200">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900">Privacy Policy & Data Security</h3>
                <p className="text-xs text-slate-500">How we protect your workshop records</p>
              </div>
              <button
                onClick={() => setIsPrivacyModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs text-slate-600 leading-relaxed">
              <h4 className="font-bold text-slate-900 text-sm">1. Information We Collect</h4>
              <p>
                We collect your Google email address and display name upon authentication for access verification and audit logs. We also store the operational records you input, including Material Receipts (MR), transformer serial numbers, inspection notes, test readings, and agency configuration details.
              </p>

              <h4 className="font-bold text-slate-900 text-sm">2. Use of Information</h4>
              <p>
                Your data is used solely to provide ERP functionality: tracking repair workflow, generating printable A4 letterhead reports, calculating oil accounts, and drafting GST delivery challans. We never sell, share, or monetize your business records.
              </p>

              <h4 className="font-bold text-slate-900 text-sm">3. Security & Cloud Encryption</h4>
              <p>
                All data transmission between your browser and the server occurs over HTTPS with SSL/TLS encryption. Database persistence is secured via Firebase Firestore security rules ensuring strict multi-tenant agency isolation.
              </p>

              <h4 className="font-bold text-slate-900 text-sm">4. Data Export & Retention</h4>
              <p>
                You retain complete control of your data and can export all records into standard XLSX and PDF formats at any time from the respective module dashboards.
              </p>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex justify-end">
              <button
                onClick={() => setIsPrivacyModalOpen(false)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
              >
                Close Privacy Policy
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
