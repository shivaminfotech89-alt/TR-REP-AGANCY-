import React, { useState, useRef, useEffect } from 'react';
import { useAgency } from '../lib/AgencyContext';
import { 
  Loader2, Plus, Trash2, FileUp, Check, Building2, 
  CreditCard, Landmark, GitBranch, Eye, HelpCircle, ShieldCheck, MapPin,
  Lock, Unlock, AlertTriangle, RotateCcw
} from 'lucide-react';

export default function EditAgencyForm({ agency }: { agency: any }) {
  const { updateAgency } = useAgency();

  // Active Tab for intuitive categorization
  const [activeTab, setActiveTab] = useState<'agency' | 'discom' | 'bank' | 'divisions' | 'preview'>('agency');

  // Agency (Supplier) Details
  const [agencyName, setAgencyName] = useState(agency.name || '');
  const [address, setAddress] = useState(agency.address || '');
  const [agencyState, setAgencyState] = useState(agency.agencyState || 'Gujarat');
  const [agencyStateCode, setAgencyStateCode] = useState(agency.agencyStateCode || '24');
  const [gstin, setGstin] = useState(agency.gstin || '');
  const [pan, setPan] = useState(agency.pan || '');
  const [phone, setPhone] = useState(agency.phone || '');
  const [email, setEmail] = useState(agency.email || '');
  const [msmeNo, setMsmeNo] = useState(agency.msmeNo || '');
  const [gpValidationMonths, setGpValidationMonths] = useState(agency.gpValidationMonths ?? 18);

  // DISCOM / Client (Buyer) & Tax Details
  const [discomName, setDiscomName] = useState(agency.discomName || 'Uttar Gujarat Vij Company Ltd.');
  const [discomGstin, setDiscomGstin] = useState(agency.discomGstin || '24AAACU6551F1ZI');
  const [discomPan, setDiscomPan] = useState(agency.discomPan || 'AAACU6551F');
  const [discomAddress, setDiscomAddress] = useState(
    agency.discomAddress || 'Registered Office: Sardar Patel Vidyut Bhavan, Race Course, Vadodara - 390007'
  );
  const [discomState, setDiscomState] = useState(agency.discomState || 'Gujarat');
  const [discomStateCode, setDiscomStateCode] = useState(agency.discomStateCode || '24');
  const [serviceSacCode, setServiceSacCode] = useState(agency.serviceSacCode || '998719');

  // Authorities & Document Routing
  const [circleOfficeName, setCircleOfficeName] = useState(agency.circleOfficeName || 'SABARMATI');
  const [circleAuthority, setCircleAuthority] = useState(agency.circleAuthority || 'Superintending Engineer (O & M)');
  const [divisionAuthority, setDivisionAuthority] = useState(agency.divisionAuthority || 'The Executive Engineer');
  const [estimateCcTemplate, setEstimateCcTemplate] = useState(agency.estimateCcTemplate || 'E. E. (O & M) DIVISION - {division}');
  const [billCcTemplate, setBillCcTemplate] = useState(agency.billCcTemplate || '');
  const [forwardingSubject, setForwardingSubject] = useState(agency.forwardingSubject || 'Submiting Inspection Report & Estimate of Transformer');

  // Lock state & Unlock Alert Modal for Estimate C.C. Template
  const [isCcTemplateLocked, setIsCcTemplateLocked] = useState(true);
  const [showCcUnlockModal, setShowCcUnlockModal] = useState(false);

  // Bank & Payment Details
  const [bankName, setBankName] = useState(agency.bankName || '');
  const [bankBranch, setBankBranch] = useState(agency.bankBranch || '');
  const [accountNumber, setAccountNumber] = useState(agency.accountNumber || '');
  const [ifscCode, setIfscCode] = useState(agency.ifscCode || '');

  // Divisions & Prefixes
  const [divisions, setDivisions] = useState<any[]>([]);

  // Letterhead PDF
  const [letterheadBase64, setLetterheadBase64] = useState(agency.letterheadUrl || '');
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [updatePopupData, setUpdatePopupData] = useState<{
    agencyName: string;
    changes: { field: string; oldVal: string; newVal: string }[];
  } | null>(null);

  useEffect(() => {
    setAgencyName(agency.name || '');
    setAddress(agency.address || '');
    setAgencyState(agency.agencyState || 'Gujarat');
    setAgencyStateCode(agency.agencyStateCode || '24');
    setGstin(agency.gstin || '');
    setPan(agency.pan || '');
    setPhone(agency.phone || '');
    setEmail(agency.email || '');
    setMsmeNo(agency.msmeNo || '');
    setGpValidationMonths(agency.gpValidationMonths ?? 18);

    setDiscomName(agency.discomName || 'Uttar Gujarat Vij Company Ltd.');
    setDiscomGstin(agency.discomGstin || '24AAACU6551F1ZI');
    setDiscomPan(agency.discomPan || 'AAACU6551F');
    setDiscomAddress(
      agency.discomAddress || 'Registered Office: Sardar Patel Vidyut Bhavan, Race Course, Vadodara - 390007'
    );
    setDiscomState(agency.discomState || 'Gujarat');
    setDiscomStateCode(agency.discomStateCode || '24');
    setServiceSacCode(agency.serviceSacCode || '998719');

    setCircleOfficeName(agency.circleOfficeName || 'SABARMATI');
    setCircleAuthority(agency.circleAuthority || 'Superintending Engineer (O & M)');
    setDivisionAuthority(agency.divisionAuthority || 'The Executive Engineer');
    setEstimateCcTemplate(agency.estimateCcTemplate || 'E. E. (O & M) DIVISION - {division}');
    setBillCcTemplate(agency.billCcTemplate || '');
    setForwardingSubject(agency.forwardingSubject || 'Submiting Inspection Report & Estimate of Transformer');

    setBankName(agency.bankName || '');
    setBankBranch(agency.bankBranch || '');
    setAccountNumber(agency.accountNumber || '');
    setIfscCode(agency.ifscCode || '');
    setLetterheadBase64(agency.letterheadUrl || '');

    // Parse divisions
    const divs: any[] = [];
    Object.entries(agency.prefixes || {}).forEach(([name, prefixData]: [string, any]) => {
      if (typeof prefixData === 'string') {
        divs.push({
          name,
          prefixCRGO: prefixData,
          prefixAmorphous: prefixData,
          prefixWoundCore: prefixData,
          prefixLSTC: prefixData,
          prefixOH: prefixData,
          allotmentCRGO: agency.allotments?.[name]?.['CRGO'] || '',
          allotmentAmorphous: agency.allotments?.[name]?.['Amorphous'] || '',
          allotmentWoundCore: agency.allotments?.[name]?.['Wound Core'] || ''
        });
      } else {
        divs.push({
          name,
          prefixCRGO: prefixData['CRGO'] || '',
          prefixAmorphous: prefixData['Amorphous'] || '',
          prefixWoundCore: prefixData['Wound Core'] || '',
          prefixLSTC: prefixData['LSTC'] || '',
          prefixOH: prefixData['OH'] || '',
          allotmentCRGO: agency.allotments?.[name]?.['CRGO'] || '',
          allotmentAmorphous: agency.allotments?.[name]?.['Amorphous'] || '',
          allotmentWoundCore: agency.allotments?.[name]?.['Wound Core'] || ''
        });
      }
    });

    if (divs.length === 0) {
      divs.push({
        name: 'SABARMATI',
        prefixCRGO: '21 IS',
        prefixAmorphous: 'AM21 IS',
        prefixWoundCore: 'WC21 IS',
        prefixLSTC: 'LS21 IS',
        prefixOH: 'OH21 IS',
        allotmentCRGO: '20',
        allotmentAmorphous: '15',
        allotmentWoundCore: '10'
      });
    }
    setDivisions(divs);
  }, [agency]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        setLetterheadBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddDivision = () => {
    setDivisions([
      ...divisions,
      {
        name: '',
        prefixCRGO: '',
        prefixAmorphous: '',
        prefixWoundCore: '',
        prefixLSTC: '',
        prefixOH: '',
        allotmentCRGO: '',
        allotmentAmorphous: '',
        allotmentWoundCore: ''
      }
    ]);
  };

  const handleRemoveDivision = (index: number) => {
    if (divisions.length === 1) return;
    const newDivs = [...divisions];
    newDivs.splice(index, 1);
    setDivisions(newDivs);
  };

  const handleDivisionChange = (index: number, field: string, value: string) => {
    const newDivs = [...divisions];
    (newDivs[index] as any)[field] = value.toUpperCase();
    setDivisions(newDivs);
  };

  const handleUpdateAgency = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const prefixes: Record<string, Record<string, string>> = {};
      const allotments: Record<string, Record<string, number>> = {};
      const lastJobNumbers: Record<string, number> = { ...(agency.lastJobNumbers || {}) };

      divisions.forEach(d => {
        if (d.name.trim() && d.prefixCRGO.trim()) {
          const divName = d.name.trim();
          prefixes[divName] = {
            'CRGO': d.prefixCRGO.trim(),
            'Amorphous': d.prefixAmorphous.trim() || d.prefixCRGO.trim(),
            'Wound Core': d.prefixWoundCore.trim() || d.prefixCRGO.trim(),
            'LSTC': d.prefixLSTC.trim() || d.prefixCRGO.trim(),
            'OH': d.prefixOH.trim() || d.prefixCRGO.trim(),
          };
          allotments[divName] = {
            'CRGO': Number(d.allotmentCRGO) || 0,
            'Amorphous': Number(d.allotmentAmorphous) || 0,
            'Wound Core': Number(d.allotmentWoundCore) || 0,
          };
          if (lastJobNumbers[`${divName}_CRGO`] === undefined) {
            lastJobNumbers[`${divName}_CRGO`] = lastJobNumbers[divName] || 0;
          }
          if (lastJobNumbers[`${divName}_AMORPHOUS`] === undefined) {
            lastJobNumbers[`${divName}_AMORPHOUS`] = 0;
          }
          if (lastJobNumbers[`${divName}_WOUND_CORE`] === undefined) {
            lastJobNumbers[`${divName}_WOUND_CORE`] = 0;
          }
          if (lastJobNumbers[`${divName}_OH`] === undefined) {
            lastJobNumbers[`${divName}_OH`] = 0;
          }
          if (lastJobNumbers[divName] === undefined) {
            lastJobNumbers[divName] = 0;
          }
        }
      });

      const changes: { field: string; oldVal: string; newVal: string }[] = [];

      const checkChange = (field: string, oldV: any, newV: any) => {
        const o = (oldV === undefined || oldV === null) ? '' : String(oldV).trim();
        const n = (newV === undefined || newV === null) ? '' : String(newV).trim();
        if (o !== n) {
          changes.push({
            field,
            oldVal: o || '(Empty)',
            newVal: n || '(Empty)'
          });
        }
      };

      checkChange('Agency Name', agency.name, agencyName);
      checkChange('Agency GSTIN', agency.gstin, gstin);
      checkChange('Agency PAN', agency.pan, pan);
      checkChange('Agency State', agency.agencyState, agencyState);
      checkChange('Agency State Code', agency.agencyStateCode, agencyStateCode);
      checkChange('Agency Address', agency.address, address);
      checkChange('Phone Number', agency.phone, phone);
      checkChange('Email Address', agency.email, email);
      checkChange('MSME / Udyam No', agency.msmeNo, msmeNo);
      checkChange('GP Validation (Months)', agency.gpValidationMonths ?? 18, gpValidationMonths);

      checkChange('DISCOM Name', agency.discomName, discomName);
      checkChange('DISCOM GSTIN', agency.discomGstin, discomGstin);
      checkChange('DISCOM PAN', agency.discomPan, discomPan);
      checkChange('DISCOM Registered Address', agency.discomAddress, discomAddress);
      checkChange('DISCOM State', agency.discomState, discomState);
      checkChange('DISCOM State Code', agency.discomStateCode, discomStateCode);
      checkChange('Service SAC / HSN Code', agency.serviceSacCode, serviceSacCode);

      checkChange('Circle Office Name', agency.circleOfficeName, circleOfficeName);
      checkChange('Circle Authority (Estimate)', agency.circleAuthority, circleAuthority);
      checkChange('Division Authority (Bills)', agency.divisionAuthority, divisionAuthority);
      checkChange('Estimate C.C. Template', agency.estimateCcTemplate, estimateCcTemplate);
      checkChange('Bill C.C. Template', agency.billCcTemplate, billCcTemplate);

      checkChange('Bank Name', agency.bankName, bankName);
      checkChange('Bank Branch', agency.bankBranch, bankBranch);
      checkChange('Account Number', agency.accountNumber, accountNumber);
      checkChange('IFSC Code', agency.ifscCode, ifscCode);

      if (letterheadBase64 !== (agency.letterheadUrl || '')) {
        changes.push({
          field: 'Letterhead PDF Document',
          oldVal: agency.letterheadUrl ? 'Existing PDF' : '(None)',
          newVal: letterheadBase64 ? 'New PDF Uploaded' : '(Removed)'
        });
      }

      await updateAgency(agency.id, {
        name: agencyName,
        letterheadUrl: letterheadBase64,
        gpValidationMonths,
        
        // Agency details
        address,
        agencyState,
        agencyStateCode,
        gstin,
        pan,
        phone,
        email,
        msmeNo,

        // DISCOM details
        discomName,
        discomGstin,
        discomPan,
        discomAddress,
        discomState,
        discomStateCode,
        serviceSacCode,

        // Routing & Authorities
        circleOfficeName,
        circleAuthority,
        divisionAuthority,
        estimateCcTemplate,
        billCcTemplate,
        forwardingSubject,

        // Bank details
        bankName,
        bankBranch,
        accountNumber,
        ifscCode,

        // Divisions & quotas
        prefixes,
        allotments,
        lastJobNumbers
      });

      setUpdatePopupData({
        agencyName: agencyName,
        changes
      });
    } catch (err) {
      console.error(err);
      alert('Failed to update agency');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleUpdateAgency} className="space-y-6 pt-1">
      {/* Top Navigation Tabs */}
      <div className="flex border-b border-slate-200 overflow-x-auto space-x-1 pb-1">
        <button
          type="button"
          onClick={() => setActiveTab('agency')}
          className={`px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-t-lg transition-colors flex items-center whitespace-nowrap ${
            activeTab === 'agency'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <Building2 className="w-3.5 h-3.5 mr-1.5" /> Agency & Tax Profile
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('discom')}
          className={`px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-t-lg transition-colors flex items-center whitespace-nowrap ${
            activeTab === 'discom'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <Landmark className="w-3.5 h-3.5 mr-1.5" /> DISCOM & Routing
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('bank')}
          className={`px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-t-lg transition-colors flex items-center whitespace-nowrap ${
            activeTab === 'bank'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <CreditCard className="w-3.5 h-3.5 mr-1.5" /> Bank & Payment
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('divisions')}
          className={`px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-t-lg transition-colors flex items-center whitespace-nowrap ${
            activeTab === 'divisions'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <GitBranch className="w-3.5 h-3.5 mr-1.5" /> Divisions & Prefixes
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('preview')}
          className={`px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-t-lg transition-colors flex items-center whitespace-nowrap ${
            activeTab === 'preview'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
          }`}
        >
          <Eye className="w-3.5 h-3.5 mr-1.5" /> Live Previews
        </button>
      </div>

      {/* ================= TAB 1: AGENCY & TAX PROFILE ================= */}
      {activeTab === 'agency' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="bg-slate-50 p-4 border border-slate-200 rounded-lg space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-800 flex items-center">
                <Building2 className="w-4 h-4 mr-1.5 text-blue-600" /> Supplier / Contractor Details
              </h4>
              <span className="text-[10px] text-slate-500 font-medium">Printed on Header & Tax Invoices</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  Agency Name *
                </label>
                <input
                  required
                  type="text"
                  value={agencyName}
                  onChange={e => setAgencyName(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. H. E. ELECTRICALS"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  Agency GSTIN *
                </label>
                <input
                  type="text"
                  value={gstin}
                  onChange={e => setGstin(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 text-sm font-mono font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. 24ABCDE1234F1Z5"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  Agency PAN Number *
                </label>
                <input
                  type="text"
                  value={pan}
                  onChange={e => setPan(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 text-sm font-mono font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. ABCDE1234F"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  Supplier State
                </label>
                <input
                  type="text"
                  value={agencyState}
                  onChange={e => setAgencyState(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. Gujarat"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  State Code (GST)
                </label>
                <input
                  type="text"
                  value={agencyStateCode}
                  onChange={e => setAgencyStateCode(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. 24"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  Company Registered Address
                </label>
                <textarea
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="Full office & workshop address"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  Phone / Mobile Number
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. +91 98765 43210"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. info@agency.com"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  MSME / Udyam Reg. No (Optional)
                </label>
                <input
                  type="text"
                  value={msmeNo}
                  onChange={e => setMsmeNo(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. UDYAM-GJ-01-XXXXXXX"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  GP Validation Period (Months)
                </label>
                <input
                  type="number"
                  value={gpValidationMonths}
                  onChange={e => setGpValidationMonths(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="18"
                />
              </div>

              <div className="md:col-span-2 pt-2 border-t border-slate-200">
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  Letterhead Document (PDF)
                </label>
                <input
                  type="file"
                  accept="application/pdf"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="flex items-center space-x-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 text-xs font-bold uppercase tracking-widest bg-slate-200 text-slate-800 rounded border border-slate-300 hover:bg-slate-300 transition-colors flex items-center"
                  >
                    <FileUp className="w-4 h-4 mr-2" /> {letterheadBase64 ? 'Change PDF' : 'Upload PDF'}
                  </button>
                  {fileName && <span className="text-xs text-slate-700 font-medium truncate">{fileName}</span>}
                  {!fileName && letterheadBase64 && (
                    <span className="text-xs text-emerald-700 font-semibold flex items-center">
                      <Check className="w-3.5 h-3.5 mr-1" /> Existing Letterhead PDF is Active
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 2: DISCOM & DOCUMENT ROUTING ================= */}
      {activeTab === 'discom' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="bg-slate-50 p-4 border border-slate-200 rounded-lg space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-800 flex items-center">
                <Landmark className="w-4 h-4 mr-1.5 text-blue-600" /> DISCOM (Client / Buyer) Tax & Authority Setup
              </h4>
              <span className="text-[10px] text-slate-500 font-medium">Automatic Routing for Estimates & Bills</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  DISCOM / Company Full Name *
                </label>
                <input
                  type="text"
                  value={discomName}
                  onChange={e => setDiscomName(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. Uttar Gujarat Vij Company Ltd."
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  DISCOM GSTIN *
                </label>
                <input
                  type="text"
                  value={discomGstin}
                  onChange={e => setDiscomGstin(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 text-sm font-mono font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. 24AAACU6551F1ZI"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  DISCOM PAN Number *
                </label>
                <input
                  type="text"
                  value={discomPan}
                  onChange={e => setDiscomPan(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 text-sm font-mono font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. AAACU6551F"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  DISCOM State
                </label>
                <input
                  type="text"
                  value={discomState}
                  onChange={e => setDiscomState(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. Gujarat"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  State Code (GST)
                </label>
                <input
                  type="text"
                  value={discomStateCode}
                  onChange={e => setDiscomStateCode(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. 24"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  DISCOM Registered / Corporate Office Address
                </label>
                <textarea
                  value={discomAddress}
                  onChange={e => setDiscomAddress(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="Registered Office Address"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  SAC / HSN Service Code
                </label>
                <input
                  type="text"
                  value={serviceSacCode}
                  onChange={e => setServiceSacCode(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="998719"
                />
                <span className="text-[10px] text-slate-500">Service accounting code for transformer repair</span>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  Default Circle Office Name
                </label>
                <input
                  type="text"
                  value={circleOfficeName}
                  onChange={e => setCircleOfficeName(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white font-bold"
                  placeholder="e.g. SABARMATI"
                />
              </div>
            </div>

            <div className="border-t border-slate-200 pt-3">
              <h5 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Designated Authorities & C.C. Rules
              </h5>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                    Circle Authority (For Estimates)
                  </label>
                  <input
                    type="text"
                    value={circleAuthority}
                    onChange={e => setCircleAuthority(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white font-medium"
                    placeholder="e.g. Superintending Engineer (O & M)"
                  />
                  <span className="text-[10px] text-slate-500">Addressed on all Estimate Forwarding Letters</span>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                    Division Authority (For Bills)
                  </label>
                  <input
                    type="text"
                    value={divisionAuthority}
                    onChange={e => setDivisionAuthority(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white font-medium"
                    placeholder="e.g. The Executive Engineer"
                  />
                  <span className="text-[10px] text-slate-500">Addressed on all Bill Covering Letters & Invoices</span>
                </div>

                <div className="md:col-span-2 bg-white p-3.5 rounded-lg border border-slate-300 shadow-sm space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-700 flex items-center gap-1.5">
                        {isCcTemplateLocked ? (
                          <span className="inline-flex items-center gap-1 text-slate-800 font-bold">
                            <Lock className="w-3.5 h-3.5 text-amber-600" /> Estimate C.C. Template (Copy To)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-blue-700 font-bold">
                            <Unlock className="w-3.5 h-3.5 text-blue-600" /> Estimate C.C. Template (Unlocked for Editing)
                          </span>
                        )}
                      </label>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Standard official forwarding letter routing format for Superintending & Executive Engineer offices
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {isCcTemplateLocked ? (
                        <button
                          type="button"
                          onClick={() => setShowCcUnlockModal(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded transition-colors shadow-sm"
                          title="Click to unlock this template with authorization warning"
                        >
                          <Unlock className="w-3.5 h-3.5 text-amber-600" />
                          Unlock for Edit
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setEstimateCcTemplate('E. E. (O & M) DIVISION - {division}')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 transition-colors"
                            title="Reset to default DISCOM standard"
                          >
                            <RotateCcw className="w-3.5 h-3.5 text-slate-600" />
                            Default Format
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsCcTemplateLocked(true)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded transition-colors"
                            title="Lock this template back"
                          >
                            <Lock className="w-3.5 h-3.5 text-slate-600" />
                            Lock Template
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="relative">
                    <input
                      type="text"
                      readOnly={isCcTemplateLocked}
                      value={estimateCcTemplate}
                      onChange={e => setEstimateCcTemplate(e.target.value)}
                      className={`w-full px-3 py-2 text-xs font-mono rounded border transition-all ${
                        isCcTemplateLocked
                          ? 'bg-slate-100 text-slate-700 border-slate-300 font-bold select-none cursor-not-allowed pr-36'
                          : 'bg-white text-slate-900 border-blue-500 font-bold ring-2 ring-blue-100'
                      }`}
                      placeholder="e.g. E. E. (O & M) DIVISION - {division}"
                    />
                    {isCcTemplateLocked && (
                      <span className="absolute right-2.5 top-2 flex items-center text-[10px] uppercase font-bold text-amber-800 bg-amber-100/90 px-2 py-0.5 rounded border border-amber-200 pointer-events-none">
                        <Lock className="w-3 h-3 mr-1 text-amber-600" /> Locked Standard
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-600 pt-0.5">
                    <span>
                      Standard format: <strong className="font-mono text-slate-800">E. E. (O & M) DIVISION - {'{division}'}</strong>
                    </span>
                    <span className="text-slate-500">
                      Use <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700 font-bold">{'{division}'}</code> to automatically insert the job's concern division name.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 3: BANK & PAYMENT DETAILS ================= */}
      {activeTab === 'bank' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="bg-slate-50 p-4 border border-slate-200 rounded-lg space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-800 flex items-center">
                <CreditCard className="w-4 h-4 mr-1.5 text-blue-600" /> Bank & Settlement Details
              </h4>
              <span className="text-[10px] text-slate-500 font-medium">Printed on Tax Invoices & Advance Stamp Receipts</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  Bank Name
                </label>
                <input
                  type="text"
                  value={bankName}
                  onChange={e => setBankName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. State Bank of India"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  Branch Name
                </label>
                <input
                  type="text"
                  value={bankBranch}
                  onChange={e => setBankBranch(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. Sanand Branch, Ahmedabad"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  Account Number
                </label>
                <input
                  type="text"
                  value={accountNumber}
                  onChange={e => setAccountNumber(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. 12345678901234"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  IFSC Code
                </label>
                <input
                  type="text"
                  value={ifscCode}
                  onChange={e => setIfscCode(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 text-sm font-mono font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. SBIN0001234"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 4: DIVISIONS & PREFIXES ================= */}
      {activeTab === 'divisions' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="bg-slate-50 p-4 border border-slate-200 rounded-lg space-y-4">
            <div className="flex justify-between items-center border-b border-slate-200 pb-2">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-800 flex items-center">
                  <GitBranch className="w-4 h-4 mr-1.5 text-blue-600" /> Divisions, Core Prefixes & Allotment Quotas
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Configure Job Number Prefixes and Capacity Quotas for each Division
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddDivision}
                className="text-xs font-bold uppercase tracking-wider text-blue-600 hover:text-blue-800 flex items-center bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded border border-blue-200 transition-colors"
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add Division
              </button>
            </div>

            <div className="space-y-4">
              {divisions.map((div, index) => (
                <div key={index} className="p-4 bg-white border border-slate-300 rounded-lg shadow-sm space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <div className="flex-1 max-w-sm">
                      <label className="block text-[10px] uppercase font-bold text-slate-500 mb-0.5">Division Name *</label>
                      <input
                        required
                        type="text"
                        value={div.name}
                        onChange={e => handleDivisionChange(index, 'name', e.target.value)}
                        className="w-full px-3 py-1.5 text-sm font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50"
                        placeholder="e.g. SABARMATI"
                      />
                    </div>
                    {divisions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveDivision(index)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Remove Division"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Core Prefixes Grid */}
                  <div>
                    <span className="block text-[10px] uppercase font-bold tracking-wider text-slate-600 mb-1">Job Number Prefixes:</span>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      <div>
                        <label className="block text-[9px] uppercase font-semibold text-slate-500">CRGO Prefix *</label>
                        <input
                          required
                          type="text"
                          value={div.prefixCRGO}
                          onChange={e => handleDivisionChange(index, 'prefixCRGO', e.target.value)}
                          className="w-full px-2 py-1 text-xs font-mono font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                          placeholder="21 IS"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-semibold text-slate-500">Amorphous Prefix</label>
                        <input
                          type="text"
                          value={div.prefixAmorphous}
                          onChange={e => handleDivisionChange(index, 'prefixAmorphous', e.target.value)}
                          className="w-full px-2 py-1 text-xs font-mono font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                          placeholder="AM21 IS"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-semibold text-slate-500">Wound Core Prefix</label>
                        <input
                          type="text"
                          value={div.prefixWoundCore}
                          onChange={e => handleDivisionChange(index, 'prefixWoundCore', e.target.value)}
                          className="w-full px-2 py-1 text-xs font-mono font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                          placeholder="WC21 IS"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-semibold text-slate-500">LSTC Prefix</label>
                        <input
                          type="text"
                          value={div.prefixLSTC}
                          onChange={e => handleDivisionChange(index, 'prefixLSTC', e.target.value)}
                          className="w-full px-2 py-1 text-xs font-mono font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                          placeholder="LS21 IS"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-semibold text-slate-500">Overhauling (OH)</label>
                        <input
                          type="text"
                          value={div.prefixOH}
                          onChange={e => handleDivisionChange(index, 'prefixOH', e.target.value)}
                          className="w-full px-2 py-1 text-xs font-mono font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                          placeholder="OH21 IS"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Allotment Quotas Grid */}
                  <div className="pt-2 border-t border-slate-100">
                    <span className="block text-[10px] uppercase font-bold tracking-wider text-slate-600 mb-1">Division Allotment Quotas:</span>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[9px] uppercase font-semibold text-slate-500">CRGO Quota</label>
                        <input
                          type="number"
                          value={div.allotmentCRGO}
                          onChange={e => handleDivisionChange(index, 'allotmentCRGO', e.target.value)}
                          className="w-full px-2 py-1 text-xs font-mono border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                          placeholder="20"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-semibold text-slate-500">Amorphous Quota</label>
                        <input
                          type="number"
                          value={div.allotmentAmorphous}
                          onChange={e => handleDivisionChange(index, 'allotmentAmorphous', e.target.value)}
                          className="w-full px-2 py-1 text-xs font-mono border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                          placeholder="15"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-semibold text-slate-500">Wound Core Quota</label>
                        <input
                          type="number"
                          value={div.allotmentWoundCore}
                          onChange={e => handleDivisionChange(index, 'allotmentWoundCore', e.target.value)}
                          className="w-full px-2 py-1 text-xs font-mono border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                          placeholder="10"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 5: LIVE PREVIEWS ================= */}
      {activeTab === 'preview' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Estimate Header Preview */}
            <div className="bg-white p-4 rounded-lg border border-blue-200 text-xs shadow-sm space-y-2">
              <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-800 rounded font-bold text-[10px] uppercase tracking-wider">
                Estimate Letter Header (Circle Office)
              </span>
              <div className="font-mono text-[11px] text-slate-800 leading-tight whitespace-pre-wrap bg-slate-50 p-3 rounded border border-slate-200">
                {`TO,\n${circleAuthority || 'Superintending Engineer (O & M)'},\n${discomName || 'Uttar Gujarat Vij Company Ltd.'},\nCircle Office : ${circleOfficeName || 'SABARMATI'}`}
              </div>
              <p className="text-[11px] text-slate-600">
                <strong>C.C.:</strong> {estimateCcTemplate ? estimateCcTemplate.replace(/{division}/gi, 'SABARMATI') : 'E. E. (O & M) DIVISION - SABARMATI'}
              </p>
            </div>

            {/* Billed Copy Header Preview */}
            <div className="bg-white p-4 rounded-lg border border-emerald-200 text-xs shadow-sm space-y-2">
              <span className="inline-block px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-[10px] uppercase tracking-wider">
                Billed Copy Header (Division Office)
              </span>
              <div className="font-mono text-[11px] text-slate-800 leading-tight whitespace-pre-wrap bg-slate-50 p-3 rounded border border-slate-200">
                {`To,\n${divisionAuthority || 'The Executive Engineer'},\n${discomName || 'Uttar Gujarat Vij Company Ltd.'},\nDivision Office : SABARMATI`}
              </div>
              <p className="text-[11px] text-slate-600">
                Automatically uses each MR / Job's specific Division Office.
              </p>
            </div>
          </div>

          {/* Tax Invoice Header & Billed To Card Preview */}
          <div className="bg-white p-4 rounded-lg border border-slate-300 shadow-sm text-xs space-y-3">
            <span className="inline-block px-2 py-0.5 bg-slate-800 text-white rounded font-bold text-[10px] uppercase tracking-wider">
              Tax Invoice Header & Consignee Box Preview
            </span>
            <div className="border border-black p-3 space-y-2">
              <div className="grid grid-cols-2 border-b border-black pb-2">
                <div>
                  <h4 className="font-black text-sm uppercase">{agencyName || 'AGENCY NAME'}</h4>
                  <p className="text-[10px] text-slate-600">{address || 'Company Address'}</p>
                  <p className="text-[10px]"><strong>State:</strong> {agencyState} ({agencyStateCode})</p>
                </div>
                <div className="text-right text-[11px]">
                  <p className="font-bold">TAX INVOICE</p>
                  <p><strong>Supplier GSTIN:</strong> <span className="font-mono">{gstin || '-'}</span></p>
                  <p><strong>Supplier PAN:</strong> <span className="font-mono">{pan || '-'}</span></p>
                </div>
              </div>
              <div className="grid grid-cols-2 pt-1 text-[11px]">
                <div>
                  <p className="font-bold uppercase text-slate-600 text-[10px]">Billed To (Client / Consignee):</p>
                  <p className="font-bold">{divisionAuthority} (O&M)</p>
                  <p>{discomName}</p>
                  <p>Division Office : SABARMATI</p>
                </div>
                <div>
                  <p><strong>DISCOM GSTIN:</strong> <span className="font-mono">{discomGstin || '-'}</span></p>
                  <p><strong>DISCOM PAN:</strong> <span className="font-mono">{discomPan || '-'}</span></p>
                  <p><strong>Service SAC:</strong> <span className="font-mono">{serviceSacCode || '998719'}</span></p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save Action Footer Bar */}
      <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
        <div className="text-xs text-slate-500 flex items-center">
          <ShieldCheck className="w-4 h-4 mr-1 text-emerald-600" />
          <span>All updates will instantly reflect across Tax Invoices, Estimates & Forwarding Letters</span>
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-5 py-2.5 text-xs font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center shadow-sm"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> Saving Changes...
            </>
          ) : (
            <>
              <Check className="w-3.5 h-3.5 mr-1.5" /> Save Agency Profile
            </>
          )}
        </button>
      </div>

      {/* Save Confirmation Change-Log Modal */}
      {updatePopupData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-lg w-full border border-slate-200 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center space-x-3 mb-4 pb-3 border-b border-slate-100">
              <div className="bg-emerald-100 text-emerald-600 p-2.5 rounded-full flex-shrink-0">
                <Check className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Active Agency Updated</h3>
                <p className="text-xs text-slate-500">Agency: <span className="font-semibold text-slate-700">{updatePopupData.agencyName}</span></p>
              </div>
            </div>

            <div className="my-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                {updatePopupData.changes.length > 0 ? 'Summary of Changes Made:' : 'Status:'}
              </h4>

              {updatePopupData.changes.length > 0 ? (
                <div className="max-h-60 overflow-y-auto space-y-2.5 pr-1 divide-y divide-slate-100">
                  {updatePopupData.changes.map((ch, idx) => (
                    <div key={idx} className="pt-2 first:pt-0 text-xs">
                      <span className="font-bold text-slate-800">{ch.field}</span>
                      <div className="flex items-center space-x-2 mt-0.5 text-slate-600">
                        <span className="line-through text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded truncate max-w-[140px]" title={ch.oldVal}>{ch.oldVal}</span>
                        <span className="text-slate-400 font-bold">➔</span>
                        <span className="text-emerald-700 font-medium bg-emerald-50 px-1.5 py-0.5 rounded truncate max-w-[180px]" title={ch.newVal}>{ch.newVal}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-600 bg-slate-50 p-3 rounded border border-slate-200">
                  All agency details and default tax values have been saved.
                </p>
              )}
            </div>

            <div className="mt-6 pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setUpdatePopupData(null)}
                className="px-5 py-2 text-xs font-bold uppercase tracking-wider bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors shadow-sm"
              >
                Close & Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alert / Warning Modal for Unlocking Estimate C.C. Template */}
      {showCcUnlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start space-x-3.5">
              <div className="p-3 bg-amber-100 text-amber-700 rounded-xl flex-shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-slate-900">
                  Unlock Estimate C.C. Template?
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Standard DISCOM Routing Security Check
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 text-xs text-amber-900 space-y-2">
              <p className="font-semibold text-amber-900">
                The standard C.C. (Copy To) routing is locked to prevent formatting mismatches:
              </p>
              <div className="p-2 bg-white rounded border border-amber-300 font-mono font-bold text-slate-800 text-center select-all shadow-xs">
                E. E. (O & M) DIVISION - {'{division}'}
              </div>
              <p className="text-[11px] text-amber-800 leading-normal">
                <strong>Attention:</strong> Editing this template directly alters how forwarding letters and copy recipients are generated for all transformer estimates submitted to the Superintending & Executive Engineer.
              </p>
            </div>

            <p className="text-xs text-slate-600">
              Do you want to unlock this field to customize the C.C. routing format?
            </p>

            <div className="flex items-center justify-end space-x-2.5 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowCcUnlockModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Keep Locked (Recommended)
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCcTemplateLocked(false);
                  setShowCcUnlockModal(false);
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors flex items-center space-x-1.5 shadow-sm"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>Yes, Unlock for Edit</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
