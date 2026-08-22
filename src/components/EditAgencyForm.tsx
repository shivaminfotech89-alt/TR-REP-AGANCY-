import React, { useState, useRef, useEffect } from 'react';
import { stateCodeFromGstin } from '../lib/utils';
import { useAgency } from '../lib/AgencyContext';
import {
  Loader2, FileUp, Check, Building2,
  CreditCard, Landmark, GitBranch, Eye, HelpCircle, ShieldCheck, MapPin,
  Lock, Unlock, AlertTriangle, RotateCcw, FileText
} from 'lucide-react';
import { validateDivisionPrefixes } from '../lib/prefixValidation';
import SetupGapDialog, { SetupGap } from './SetupGapDialog';
import { LetterheadCalibrator } from './LetterheadCalibrator';
import { AMORPHOUS_ESTIMATE_TEXT } from '../lib/ugvclSchedule2020';

export default function EditAgencyForm({ agency }: { agency: any }) {
  const { updateAgency, activeAtMaster } = useAgency();

  /**
   * WHERE JOB NUMBER PREFIXES ACTUALLY COME FROM.
   *
   * `getNextJobNoInfo` (AgencyContext) reads `activeAtMaster.prefixes` when the AT has
   * any, and `activeAgency.prefixes` ONLY when it has none. The AT is the authority; the
   * agency copy is a legacy fallback for ATs created before prefixes moved there. That
   * matches the domain - divisions and prefixes are issued with a tender, and allotments
   * arrive against that tender - so both belong to the AT.
   *
   * This form therefore SHOWS them and does not edit them. The expression below mirrors
   * the resolution order exactly rather than picking one side: the panel must display
   * what the app will use, which is not always the agency record this form is editing.
   */
  const atHasPrefixes = Boolean(
    activeAtMaster?.prefixes && Object.keys(activeAtMaster.prefixes).length > 0
  );
  const livePrefixes: Record<string, any> = atHasPrefixes
    ? (activeAtMaster as any).prefixes
    : (agency.prefixes || {});
  /** 'at' - from the tender. 'agency' - legacy fallback, still live. 'none' - nothing set. */
  const prefixSource: 'at' | 'agency' | 'none' =
    atHasPrefixes ? 'at' : (Object.keys(agency.prefixes || {}).length > 0 ? 'agency' : 'none');

  const [setupGap, setSetupGap] = useState<SetupGap | null>(null);

  // Active Tab for intuitive categorization
  const [activeTab, setActiveTab] = useState<'agency' | 'discom' | 'bank' | 'divisions' | 'preview'>('agency');

  // Agency (Supplier) Details
  const [agencyName, setAgencyName] = useState(agency.name || '');
  const [address, setAddress] = useState(agency.address || '');
  const [agencyState, setAgencyState] = useState(agency.agencyState || '');
  // Not defaulted to '24' - see AUDIT O8. Derived from the agency's own GSTIN below.
  const [agencyStateCode, setAgencyStateCode] = useState(agency.agencyStateCode || '');
  const [gstin, setGstin] = useState(agency.gstin || '');
  const [pan, setPan] = useState(agency.pan || '');
  const [phone, setPhone] = useState(agency.phone || '');
  const [email, setEmail] = useState(agency.email || '');
  const [msmeNo, setMsmeNo] = useState(agency.msmeNo || '');
  const [gpValidationMonths, setGpValidationMonths] = useState(agency.gpValidationMonths ?? 18);

  // Letterhead Layout & Calibrator States
  const [letterheadBase64, setLetterheadBase64] = useState(agency.letterheadUrl || '');
  const [letterheadMode, setLetterheadMode] = useState<'full_a4' | 'header_only' | 'standard'>(
    agency.letterheadMode || (agency.letterheadUrl ? 'full_a4' : 'standard')
  );
  const [headerHeightMm, setHeaderHeightMm] = useState<number>(agency.letterheadHeaderHeightMm ?? 38);
  const [footerHeightMm, setFooterHeightMm] = useState<number>(agency.letterheadFooterHeightMm ?? 24);
  const [marginLeftMm, setMarginLeftMm] = useState<number>(agency.letterheadMarginLeftMm ?? 12);
  const [marginRightMm, setMarginRightMm] = useState<number>(agency.letterheadMarginRightMm ?? 12);
  const [showPageNumbers, setShowPageNumbers] = useState<boolean>(agency.showPageNumbers !== false);

  // DISCOM / Client (Buyer) & Tax Details
  const [discomName, setDiscomName] = useState(agency.discomName || '');
  const [discomGstin, setDiscomGstin] = useState(agency.discomGstin || '');
  const [discomPan, setDiscomPan] = useState(agency.discomPan || '');
  const [discomAddress, setDiscomAddress] = useState(
    agency.discomAddress || 'Registered Office: Sardar Patel Vidyut Bhavan, Race Course, Vadodara - 390007'
  );
  const [discomState, setDiscomState] = useState(agency.discomState || 'Gujarat');
  const [discomStateCode, setDiscomStateCode] = useState(agency.discomStateCode || '24');
  const [serviceSacCode, setServiceSacCode] = useState(agency.serviceSacCode || '998719');

  // Authorities & Document Routing
  const [circleOfficeName, setCircleOfficeName] = useState(agency.circleOfficeName || '');
  const [circleAuthority, setCircleAuthority] = useState(agency.circleAuthority || 'Superintending Engineer (O & M)');
  const [divisionAuthority, setDivisionAuthority] = useState(agency.divisionAuthority || 'The Executive Engineer');
  const [estimateCcTemplate, setEstimateCcTemplate] = useState(agency.estimateCcTemplate || 'E. E. (O & M) DIVISION - {division}');
  const [billCcTemplate, setBillCcTemplate] = useState(agency.billCcTemplate || '');
  const [forwardingSubject, setForwardingSubject] = useState(agency.forwardingSubject || 'Submiting Inspection Report & Estimate of Transformer');

  // Amorphous / Wound Core Fixed-Rate Estimate Report Text (Schedule-B)
  const [amorphousClauseText, setAmorphousClauseText] = useState(agency.amorphousClauseText || AMORPHOUS_ESTIMATE_TEXT.clause);
  const [amorphousNoteLtCoil, setAmorphousNoteLtCoil] = useState(agency.amorphousNoteLtCoil || AMORPHOUS_ESTIMATE_TEXT.noteLtCoil);
  const [amorphousNoteRadiator, setAmorphousNoteRadiator] = useState(agency.amorphousNoteRadiator || AMORPHOUS_ESTIMATE_TEXT.noteRadiator);

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
  const divisionValidation = validateDivisionPrefixes(divisions);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [updatePopupData, setUpdatePopupData] = useState<{
    agencyName: string;
    changes: { field: string; oldVal: string; newVal: string }[];
  } | null>(null);

  useEffect(() => {
    setAgencyName(agency.name || '');
    setAddress(agency.address || '');
    setAgencyState(agency.agencyState || '');
    setAgencyStateCode(agency.agencyStateCode || '');
    setGstin(agency.gstin || '');
    setPan(agency.pan || '');
    setPhone(agency.phone || '');
    setEmail(agency.email || '');
    setMsmeNo(agency.msmeNo || '');
    setGpValidationMonths(agency.gpValidationMonths ?? 18);

    setDiscomName(agency.discomName || '');
    setDiscomGstin(agency.discomGstin || '');
    setDiscomPan(agency.discomPan || '');
    setDiscomAddress(
      agency.discomAddress || 'Registered Office: Sardar Patel Vidyut Bhavan, Race Course, Vadodara - 390007'
    );
    setDiscomState(agency.discomState || 'Gujarat');
    setDiscomStateCode(agency.discomStateCode || '24');
    setServiceSacCode(agency.serviceSacCode || '998719');

    setCircleOfficeName(agency.circleOfficeName || '');
    setCircleAuthority(agency.circleAuthority || 'Superintending Engineer (O & M)');
    setDivisionAuthority(agency.divisionAuthority || 'The Executive Engineer');
    setEstimateCcTemplate(agency.estimateCcTemplate || 'E. E. (O & M) DIVISION - {division}');
    setBillCcTemplate(agency.billCcTemplate || '');
    setForwardingSubject(agency.forwardingSubject || 'Submiting Inspection Report & Estimate of Transformer');

    setAmorphousClauseText(agency.amorphousClauseText || AMORPHOUS_ESTIMATE_TEXT.clause);
    setAmorphousNoteLtCoil(agency.amorphousNoteLtCoil || AMORPHOUS_ESTIMATE_TEXT.noteLtCoil);
    setAmorphousNoteRadiator(agency.amorphousNoteRadiator || AMORPHOUS_ESTIMATE_TEXT.noteRadiator);

    setBankName(agency.bankName || '');
    setBankBranch(agency.bankBranch || '');
    setAccountNumber(agency.accountNumber || '');
    setIfscCode(agency.ifscCode || '');
    setLetterheadBase64(agency.letterheadUrl || '');
    setLetterheadMode(agency.letterheadMode || (agency.letterheadUrl ? 'full_a4' : 'standard'));
    setHeaderHeightMm(agency.letterheadHeaderHeightMm ?? 38);
    setFooterHeightMm(agency.letterheadFooterHeightMm ?? 24);
    setMarginLeftMm(agency.letterheadMarginLeftMm ?? 12);
    setMarginRightMm(agency.letterheadMarginRightMm ?? 12);
    setShowPageNumbers(agency.showPageNumbers !== false);

    // Parse divisions from the LIVE prefix source, not unconditionally from the agency
    // record. When an AT carries prefixes the agency copy may be stale or absent, and a
    // panel listing the stale one would be a confident wrong answer - the exact shape
    // this audit keeps finding. `circle` is still read from the agency: division circle
    // offices are routing data, not tender data, and are not stored on the AT.
    // Allotments resolve PER CELL, unlike prefixes which resolve as a whole object:
    // NewJob.tsx:1223-1226 takes the AT's number for that division+core type and falls
    // back to the agency's only when it is absent or zero. Mirrored here so a displayed
    // quota is the one the intake check will actually apply, and `from` records which
    // side it came from so the panel can say so.
    const resolveAllotment = (name: string, core: string) => {
      const atVal = Number((activeAtMaster as any)?.allotments?.[name]?.[core]);
      if (atVal) return { value: atVal, from: 'at' as const };
      const agVal = Number(agency.allotments?.[name]?.[core]);
      if (agVal) return { value: agVal, from: 'agency' as const };
      return { value: 0, from: 'none' as const };
    };

    const divs: any[] = [];
    Object.entries(livePrefixes).forEach(([name, prefixData]: [string, any]) => {
      const circle = agency.divisionCircles?.[name] || agency.circleOfficeName || '';
      // A prefix stored as a bare string is the oldest shape. getNextJobNoInfo uses it
      // for EVERY core type, so the panel shows it on every row and flags it, rather
      // than showing it against CRGO alone and implying the others are unset.
      const flat = typeof prefixData === 'string';
      divs.push({
        name,
        circle,
        legacyFlatPrefix: flat,
        prefixCRGO: flat ? prefixData : (prefixData['CRGO'] || ''),
        prefixAmorphous: flat ? prefixData : (prefixData['Amorphous'] || ''),
        prefixWoundCore: flat ? prefixData : (prefixData['Wound Core'] || ''),
        prefixLSTC: flat ? prefixData : (prefixData['LSTC'] || ''),
        prefixOH: flat ? prefixData : (prefixData['OH'] || ''),
        allotCRGO: resolveAllotment(name, 'CRGO'),
        allotAmorphous: resolveAllotment(name, 'Amorphous'),
        allotWoundCore: resolveAllotment(name, 'Wound Core'),
      });
    });

    // No blank placeholder row any more. It existed so the operator had something to type
    // into; with the section read-only it would render as a division that does not exist.
    setDivisions(divs);
  }, [agency, activeAtMaster]);

  // handleAddDivision / handleRemoveDivision removed with the inputs. The division set
  // is defined by the AT's prefixes, so adding or removing one here would have written a
  // division the AT does not have - visible on this screen and invisible to job numbering.

  const handleDivisionChange = (index: number, field: string, value: string) => {
    const newDivs = [...divisions];
    (newDivs[index] as any)[field] = value.toUpperCase();
    setDivisions(newDivs);
  };

  const handleUpdateAgency = async (e: React.FormEvent) => {
    e.preventDefault();

    // The prefix/allotment validation NO LONGER BLOCKS THE SAVE. Those fields are
    // read-only here now, so an agency whose stored prefixes are invalid - a blank CRGO
    // prefix, a duplicate within a division - could not be corrected on this screen, and
    // blocking would deadlock every OTHER agency field behind a fault with no editor.
    // The warnings still render in the Divisions tab, beside the button that reaches the
    // AT where they ARE editable.

    setIsSubmitting(true);
    try {
      // PASSED THROUGH VERBATIM, NOT REBUILT. Rebuilding from `divisions` state was safe
      // only while the inputs existed: the loop kept a division only `if (d.name.trim()
      // && d.prefixCRGO.trim())`, so a stored division with a blank CRGO prefix would be
      // dropped from the agency record by an unrelated save of, say, a bank account. That
      // was unreachable while validation refused such a save; removing that block would
      // have made it reachable and silent. Nothing on this form can change these two
      // objects now, so the correct write is the stored value unchanged.
      //
      // This also honours the rule that `agency.prefixes` is never deleted - it is still
      // read by getNextJobNoInfo whenever the active AT has no prefixes of its own.
      const prefixes = agency.prefixes || {};
      const allotments = agency.allotments || {};
      const divisionCircles: Record<string, string> = { ...(agency.divisionCircles || {}) };
      const lastJobNumbers: Record<string, number> = { ...(agency.lastJobNumbers || {}) };

      // Division circle offices ARE still editable. They are agency routing data, are not
      // stored on the AT, and `AtDivisions` has no field for them - this form is their
      // only editor. Merged over the stored map rather than replacing it, so a division
      // absent from the live prefix list keeps the circle it already had.
      divisions.forEach(d => {
        const divName = String(d.name || '').trim();
        if (divName) divisionCircles[divName] = (d.circle || circleOfficeName || divName).trim();
      });

      // Counter-key seeding, unchanged, over the same set as before: the AGENCY's stored
      // divisions that carry a CRGO prefix. Deliberately not the live AT list - these are
      // the agency's own counters, and seeding keys for AT-only divisions would create
      // agency counters that nothing reads.
      Object.entries(prefixes).forEach(([rawName, prefixData]: [string, any]) => {
        const divName = String(rawName || '').trim();
        const crgo = typeof prefixData === 'string' ? prefixData : (prefixData?.['CRGO'] || '');
        if (divName && String(crgo).trim()) {
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
        letterheadMode,
        letterheadHeaderHeightMm: headerHeightMm,
        letterheadFooterHeightMm: footerHeightMm,
        letterheadMarginLeftMm: marginLeftMm,
        letterheadMarginRightMm: marginRightMm,
        showPageNumbers,
        gpValidationMonths,
        
        // Agency details
        address,
        agencyState,
        // Persist the DERIVED code when a GSTIN exists, so the stored value can never
        // drift from the GSTIN it is part of.
        agencyStateCode: stateCodeFromGstin(gstin) || agencyStateCode,
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

        // Amorphous / Wound Core fixed-rate estimate report text
        amorphousClauseText,
        amorphousNoteLtCoil,
        amorphousNoteRadiator,

        // Bank details
        bankName,
        bankBranch,
        accountNumber,
        ifscCode,

        // Divisions & quotas
        divisionCircles,
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
                {/* DERIVED, not entered: the first two digits of a GSTIN ARE the state
                    code, so deriving it means the two can never disagree. Editable only
                    while no GSTIN is set. */}
                <input
                  type="text"
                  readOnly={Boolean(stateCodeFromGstin(gstin))}
                  value={stateCodeFromGstin(gstin) || agencyStateCode}
                  onChange={e => setAgencyStateCode(e.target.value)}
                  className={`w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 ${stateCodeFromGstin(gstin) ? 'bg-slate-100 text-slate-600 cursor-not-allowed' : 'bg-white'}`}
                  placeholder="Set the agency GSTIN above"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  {stateCodeFromGstin(gstin)
                    ? `Derived from the agency GSTIN (${gstin.slice(0, 2)}…).`
                    : 'Enter the agency GSTIN above and this fills in from its first two digits.'}
                </p>
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

              <div className="md:col-span-2 pt-4 border-t border-slate-200">
                <LetterheadCalibrator
                  letterheadUrl={letterheadBase64}
                  letterheadMode={letterheadMode}
                  headerHeightMm={headerHeightMm}
                  footerHeightMm={footerHeightMm}
                  marginLeftMm={marginLeftMm}
                  marginRightMm={marginRightMm}
                  agencyName={agencyName}
                  onLetterheadChange={setLetterheadBase64}
                  onModeChange={setLetterheadMode}
                  onHeaderHeightChange={setHeaderHeightMm}
                  onFooterHeightChange={setFooterHeightMm}
                  onMarginLeftChange={setMarginLeftMm}
                  onMarginRightChange={setMarginRightMm}
                />
              </div>

              <div className="md:col-span-2">
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showPageNumbers}
                    onChange={e => setShowPageNumbers(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-1 focus:ring-blue-500"
                  />
                  Print page numbers (turn off if your letterhead already shows them)
                </label>
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

          <div className="bg-slate-50 p-4 border border-slate-200 rounded-lg space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-800 flex items-center">
                <FileText className="w-4 h-4 mr-1.5 text-blue-600" /> Amorphous / Wound Core Fixed-Rate Estimate Text
              </h4>
              <span className="text-[10px] text-slate-500 font-medium">Printed on Fixed-Rate Estimation Reports (Schedule-B)</span>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                Tender Clause Paragraph
              </label>
              <textarea
                value={amorphousClauseText}
                onChange={e => setAmorphousClauseText(e.target.value)}
                rows={6}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white leading-relaxed"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                Note - LT Coil Damage
              </label>
              <textarea
                value={amorphousNoteLtCoil}
                onChange={e => setAmorphousNoteLtCoil(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white leading-relaxed"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                Note - Radiator / Conservator Tank Replacement
              </label>
              <textarea
                value={amorphousNoteRadiator}
                onChange={e => setAmorphousNoteRadiator(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white leading-relaxed"
              />
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

      {/* ================= TAB 4: DIVISIONS & PREFIXES (READ-ONLY) ================= */}
      {/*
        READ-ONLY BY DESIGN. The AT is the authority for divisions, prefixes and
        allotments - see the note on `atHasPrefixes` at the top of this file - so this
        panel displays them and routes to the AT for editing rather than offering a
        second editor whose writes the first would overwrite.

        The one thing still editable here is each division's CIRCLE OFFICE: agency
        routing data, not tender data, with no field for it anywhere on the AT.
      */}
      {activeTab === 'divisions' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="bg-slate-50 p-4 border border-slate-200 rounded-lg space-y-4">
            <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-3 border-b border-slate-200 pb-3">
              <div className="min-w-0">
                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-800 flex items-center flex-wrap gap-x-1.5 gap-y-1">
                  <GitBranch className="w-4 h-4 mr-0.5 text-blue-600 shrink-0" />
                  <span>Divisions &amp; Prefixes</span>
                  {prefixSource === 'at' && (
                    <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-300 text-[10px] font-bold normal-case tracking-normal">
                      from AT {activeAtMaster?.atNumber || activeAtMaster?.name || '(unnamed)'}
                    </span>
                  )}
                  {prefixSource === 'agency' && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold normal-case tracking-normal">
                      from agency record - legacy fallback
                    </span>
                  )}
                  {prefixSource === 'none' && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 border border-slate-300 text-[10px] font-bold normal-case tracking-normal">
                      none configured
                    </span>
                  )}
                </h4>
                <p className="text-[11px] text-slate-500 mt-1 flex items-start gap-1">
                  <Lock className="w-3 h-3 mt-0.5 shrink-0 text-slate-400" />
                  <span>
                    Divisions and prefixes are issued with a tender, so they are held on the AT
                    period and shown here read-only. Job numbering reads the AT first, and this
                    agency record only when the AT has no divisions of its own.
                  </span>
                </p>
              </div>

              {/* Routes reuse the deep-link params AtSettings already reads:
                  ?section=divisions|allotments|at &atId=<id>. No new params invented. */}
              <div className="flex flex-wrap gap-2 shrink-0">
                {activeAtMaster ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setSetupGap({
                        title: 'Job number prefixes are held on the AT',
                        problem: `Divisions and their per-core-type prefixes belong to AT ${activeAtMaster.atNumber || activeAtMaster.name || ''}, not to the agency record. Editing them there is what job numbering reads.`,
                        detail: [
                          'Saving there also refreshes this agency copy, which stays as the fallback for ATs that have no divisions of their own.',
                        ],
                        actionLabel: 'Edit Job Number Prefixes',
                        actionTo: `/agency-settings?section=divisions&atId=${encodeURIComponent(activeAtMaster.id)}`,
                        unsavedWarning: 'Any unsaved changes on this Agency form will be lost.',
                      })}
                      className="text-xs font-bold uppercase tracking-wider text-blue-700 hover:text-blue-900 flex items-center bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded border border-blue-200 transition-colors"
                    >
                      <GitBranch className="w-3.5 h-3.5 mr-1.5" /> Edit Job Number Prefixes
                    </button>
                    <button
                      type="button"
                      onClick={() => setSetupGap({
                        title: 'Allotment quotas are held on the AT',
                        problem: `Quotas and their allotment letters arrive against AT ${activeAtMaster.atNumber || activeAtMaster.name || ''} over the life of the tender, so they are recorded there.`,
                        detail: [
                          'An unrecorded quota blocks intake for that division and core type rather than passing silently.',
                        ],
                        actionLabel: 'Add Allotment Quota & Letter',
                        actionTo: `/agency-settings?section=allotments&atId=${encodeURIComponent(activeAtMaster.id)}`,
                        unsavedWarning: 'Any unsaved changes on this Agency form will be lost.',
                      })}
                      className="text-xs font-bold uppercase tracking-wider text-emerald-700 hover:text-emerald-900 flex items-center bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded border border-emerald-200 transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5 mr-1.5" /> Add Allotment Quota &amp; Letter
                    </button>
                  </>
                ) : (
                  /* No active AT: nothing to edit and nowhere to send them. One button,
                     to the step that has to happen first. */
                  <button
                    type="button"
                    onClick={() => setSetupGap({
                      title: 'No AT period is active',
                      problem: 'Divisions, prefixes and allotment quotas are held on an AT period, and this agency has none active. There is nothing to configure until one exists.',
                      detail: [
                        'An AT carries the tender number, its dates and the AT percentage per core type.',
                        'Jobs created with no AT get no percentage and no allotment check.',
                      ],
                      actionLabel: 'Set up an AT period',
                      actionTo: '/agency-settings?section=at',
                      unsavedWarning: 'Any unsaved changes on this Agency form will be lost.',
                    })}
                    className="text-xs font-bold uppercase tracking-wider text-amber-800 hover:text-amber-900 flex items-center bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded border border-amber-300 transition-colors"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 mr-1.5" /> Set up an AT period
                  </button>
                )}
              </div>
            </div>

            {!activeAtMaster && (
              <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg flex items-start gap-2 text-xs text-amber-900">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-bold">No AT period is active for this agency.</strong>
                  <p className="mt-0.5 text-[11px] leading-relaxed">
                    {prefixSource === 'agency'
                      ? 'The divisions below are the agency record, and with no AT active they are what job numbering is using right now. They cannot be edited here - set up an AT period, then configure its divisions.'
                      : 'Nothing is configured, so job numbers would fall back to the JOB prefix. Set up an AT period first.'}
                  </p>
                </div>
              </div>
            )}

            {prefixSource === 'agency' && activeAtMaster && (
              <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg flex items-start gap-2 text-xs text-amber-900">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-bold">
                    AT {activeAtMaster.atNumber || activeAtMaster.name || ''} has no divisions of its own.
                  </strong>
                  <p className="mt-0.5 text-[11px] leading-relaxed">
                    Job numbering is falling back to this agency record. Opening
                    <em> Edit Job Number Prefixes </em> loads these same divisions against the AT and
                    saves them there, which ends the fallback.
                  </p>
                </div>
              </div>
            )}

            {/* Validation still reported - it no longer blocks the save, because the
                fields it validates cannot be corrected on this screen. */}
            {divisions.length > 0 && !divisionValidation.isValid && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-xs text-red-800">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-bold">Division Prefix Warnings:</strong>
                  <ul className="list-disc list-inside mt-0.5 text-[11px] text-red-700">
                    {divisionValidation.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[11px]">
                    These are corrected on the AT, not here. Other agency details still save normally.
                  </p>
                </div>
              </div>
            )}

            {divisions.length === 0 ? (
              <div className="p-4 bg-white border border-dashed border-slate-300 rounded-lg text-center text-xs text-slate-500">
                No divisions configured. Job numbers would use the{' '}
                <span className="font-mono font-bold">JOB</span> prefix.
              </div>
            ) : (
              <div className="space-y-3">
                {divisions.map((div, index) => (
                  <div key={index} className="p-4 bg-white border border-slate-300 rounded-lg shadow-sm space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-slate-100 pb-2">
                      <div>
                        <span className="block text-[10px] uppercase font-bold text-slate-500 mb-0.5">Division</span>
                        <span className="text-sm font-bold text-slate-900">{div.name}</span>
                      </div>
                      {/* The only editable field in this tab - see the save-path note. */}
                      <div className="flex-1 w-full max-w-xs">
                        <label className="block text-[10px] uppercase font-bold text-slate-500 mb-0.5">
                          Circle Office (Routing / Forwarding)
                        </label>
                        <input
                          type="text"
                          value={div.circle || ''}
                          onChange={e => handleDivisionChange(index, 'circle', e.target.value)}
                          className="w-full px-3 py-1.5 text-sm font-semibold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                          placeholder={circleOfficeName || 'e.g. SABARMATI'}
                        />
                      </div>
                    </div>

                    {div.legacyFlatPrefix && (
                      <div className="p-2 bg-amber-50 border border-amber-300 rounded text-[11px] text-amber-900 flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <span>
                          Stored as a single prefix for the whole division, so every core type uses
                          <strong className="font-mono"> {div.prefixCRGO}</strong>. Set per-core prefixes on the AT to separate them.
                        </span>
                      </div>
                    )}

                    <div>
                      <span className="block text-[10px] uppercase font-bold tracking-wider text-slate-600 mb-1">Job Number Prefixes:</span>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        {[
                          { label: 'CRGO', value: div.prefixCRGO, required: true },
                          { label: 'Amorphous', value: div.prefixAmorphous, required: false },
                          { label: 'Wound Core', value: div.prefixWoundCore, required: false },
                          { label: 'LSTC', value: div.prefixLSTC, required: false },
                          { label: 'Overhauling (OH)', value: div.prefixOH, required: false },
                        ].map(f => (
                          <div key={f.label}>
                            <span className="block text-[9px] uppercase font-semibold text-slate-500">{f.label}</span>
                            <div className={`w-full px-2 py-1 text-xs font-mono font-bold rounded border ${
                              String(f.value || '').trim()
                                ? 'bg-slate-50 border-slate-200 text-slate-800'
                                : f.required
                                  ? 'bg-red-50 border-red-200 text-red-700'
                                  : 'bg-slate-50 border-slate-200 text-slate-400'
                            }`}>
                              {String(f.value || '').trim() || (f.required ? 'not set' : '-')}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100">
                      <span className="block text-[10px] uppercase font-bold tracking-wider text-slate-600 mb-1">Division Allotment Quotas:</span>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { label: 'CRGO Quota', cell: div.allotCRGO },
                          { label: 'Amorphous Quota', cell: div.allotAmorphous },
                          { label: 'Wound Core Quota', cell: div.allotWoundCore },
                        ].map(q => (
                          <div key={q.label}>
                            <span className="block text-[9px] uppercase font-semibold text-slate-500">{q.label}</span>
                            <div className={`w-full px-2 py-1 text-xs font-mono rounded border ${
                              q.cell?.from === 'none'
                                ? 'bg-slate-50 border-slate-200 text-slate-400'
                                : 'bg-slate-50 border-slate-200 text-slate-800 font-bold'
                            }`}>
                              {q.cell?.from === 'none' ? 'not recorded' : q.cell?.value}
                            </div>
                            {/* Allotments resolve per cell, so the source is stated per cell. */}
                            {q.cell?.from === 'agency' && (
                              <span className="block text-[9px] text-amber-700 mt-0.5">from agency record</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
                {`TO,\n${circleAuthority || 'Superintending Engineer (O & M)'},\n${discomName || '[DISCOM name not set]'},\nCircle Office : ${circleOfficeName || '[Circle office not set]'}`}
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
                {`To,\n${divisionAuthority || 'The Executive Engineer'},\n${discomName || '[DISCOM name not set]'},\nDivision Office : SABARMATI`}
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
      {/* Routing out of this form to the AT, where divisions/prefixes/allotments live.
          Uses the shared dialog rather than a bare navigate() so the two-step
          unsaved-work confirmation is the same here as everywhere else. */}
      <SetupGapDialog gap={setupGap} onCancel={() => setSetupGap(null)} />
    </form>
  );
}
