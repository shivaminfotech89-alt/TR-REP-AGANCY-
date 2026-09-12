import React, { useState, useRef, useEffect } from 'react';
import { stateCodeFromGstin, gstinScopeError } from '../lib/utils';
import { auth } from '../lib/firebase';
import { useAgency } from '../lib/AgencyContext';
import { CARD, CARD_PAD } from '../lib/ui';
import { AgencyMarkTile } from './AgencyMarkTile';
import { AgencyMark, AgencyMarkColour, MARK_COLOURS, COLOUR_LABEL,
         markFor, agenciesUsingMark, deriveMonogram, normaliseMonogram } from '../lib/agencyMark';
import {
  Loader2, FileUp, Check, Building2,
  CreditCard, Landmark, Eye, HelpCircle, ShieldCheck, MapPin,
  Lock, Unlock, AlertTriangle, RotateCcw, FileText
} from 'lucide-react';
import { validateDivisionPrefixes } from '../lib/prefixValidation';
import { LetterheadCalibrator } from './LetterheadCalibrator';
import { AMORPHOUS_ESTIMATE_TEXT } from '../lib/ugvclSchedules';

export default function EditAgencyForm({ agency }: { agency: any }) {
  const { updateAgency, activeAtMaster, agencies } = useAgency();

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


  // Active Tab for intuitive categorization
  const [activeTab, setActiveTab] = useState<'agency' | 'discom' | 'bank' | 'preview'>('agency');

  // Agency (Supplier) Details
  const [agencyName, setAgencyName] = useState(agency.name || '');

  /**
   * THE AGENCY'S MARK. `null` means nothing has been chosen and the derived one is showing -
   * kept as null rather than filled in with the derived value, so the document records
   * "nobody chose" rather than a choice nobody made.
   */
  /**
   * TWO INDEPENDENT FIELDS, EACH EMPTY WHEN AUTOMATIC. The monogram can be typed while the
   * colour stays derived, or the reverse. Storing one object with both filled in would lose
   * that - and an empty box is what keeps "follows the name" true as the name is edited.
   */
  const [markMonogram, setMarkMonogram] = useState<string>((agency as any).mark?.monogram ?? '');
  const [markColour, setMarkColour] = useState<AgencyMarkColour | ''>((agency as any).mark?.colour ?? '');

  /**
   * What the preview draws. The monogram default follows `agencyName` AS IT IS TYPED, not the
   * saved name, so renaming an agency shows its new monogram before the form is submitted.
   */
  const effectiveMark = markFor({
    id: agency.id,
    name: agencyName,
    mark: { ...(markMonogram ? { monogram: markMonogram } : {}), ...(markColour ? { colour: markColour } : {}) },
  } as any);
  const effectiveClash = agenciesUsingMark(effectiveMark, agencies as any, agency.id);
  const [address, setAddress] = useState(agency.address || '');
  const [agencyState, setAgencyState] = useState(agency.agencyState || '');
  // Not defaulted to '24' - see AUDIT O8. Derived from the agency's own GSTIN below.
  const [agencyStateCode, setAgencyStateCode] = useState(agency.agencyStateCode || '');
  // Registered business name for the tax invoice. Defaults to the short name so an agency
  // that never touches this field prints exactly what it printed before.
  const [legalName, setLegalName] = useState(agency.legalName || agency.name || '');
  const [gstin, setGstin] = useState(agency.gstin || '');
  const [pan, setPan] = useState(agency.pan || '');
  const [phone, setPhone] = useState(agency.phone || '');
  const [email, setEmail] = useState(agency.email || '');

  /**
   * IS THE PERSON LOOKING AT THIS THE OWNER, OR A DELEGATED USER? (AUDIT G37)
   *
   * ⚠ THE TWO SEE THE SAME SCREEN AND FACE DIFFERENT CONSEQUENCES ON ONE FIELD. The rules
   * keep `ownerId` immutable, so an owner who mangles the access email can always set it again.
   * A delegated user editing the same field revokes their OWN access on save and cannot undo
   * it: the next write is checked against the new value, which is no longer theirs.
   *
   * Used only to decide whether to warn. It is not a permission - what may actually be written
   * is decided by firestore.rules, and this screen does not gate on it.
   */
  const isOwner = !!auth.currentUser && agency.ownerId === auth.currentUser.uid;
  const [msmeNo, setMsmeNo] = useState(agency.msmeNo || '');

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
    setLegalName(agency.legalName || agency.name || '');
    setGstin(agency.gstin || '');
    setPan(agency.pan || '');
    setPhone(agency.phone || '');
    setEmail(agency.email || '');
    setMsmeNo(agency.msmeNo || '');

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
    // ⚠ KEYED ON THE FIELDS COPIED ABOVE, NOT ON THE AGENCY OBJECT (AUDIT G56).
    //
    // `updateAgency` and `updateAtMaster` put a new object into context on every save, and this
    // effect used to re-run on that - re-seeding every field on this form and discarding
    // whatever had been typed and not saved. Saving a tender's rates or percentage did it too,
    // because `activeAtMaster` was a dependency, for the read-only Divisions copy removed in the
    // same change. With Agency Settings in tabs those saves happen on another tab while this
    // form stays mounted, so the loss would have been the ordinary workflow.
    //
    // A change to one of these fields from elsewhere still re-seeds, and should: the stored
    // value moved, and a form still showing the old one would save it back.
    //
    // ⚠ THIS LIST MUST MATCH THE SETTERS ABOVE. A field copied above but missing here would
    // stop following its stored value; one listed here but not copied does nothing.
  }, [
    agency.id,
    agency.name, agency.address, agency.agencyState, agency.agencyStateCode, agency.legalName,
    agency.gstin, agency.pan, agency.phone, agency.email, agency.msmeNo,
    agency.discomName, agency.discomGstin, agency.discomPan, agency.discomAddress, agency.discomState,
    agency.discomStateCode, agency.serviceSacCode,
    agency.circleOfficeName, agency.circleAuthority, agency.divisionAuthority,
    agency.estimateCcTemplate, agency.billCcTemplate, agency.forwardingSubject,
    agency.amorphousClauseText, agency.amorphousNoteLtCoil, agency.amorphousNoteRadiator,
    agency.bankName, agency.bankBranch, agency.accountNumber, agency.ifscCode,
    agency.letterheadUrl, agency.letterheadMode, agency.letterheadHeaderHeightMm,
    agency.letterheadFooterHeightMm, agency.letterheadMarginLeftMm, agency.letterheadMarginRightMm,
    agency.showPageNumbers,
  ]);

  // handleAddDivision / handleRemoveDivision removed with the inputs. The division set
  // is defined by the AT's prefixes, so adding or removing one here would have written a
  // division the AT does not have - visible on this screen and invisible to job numbering.


  const handleUpdateAgency = async (e: React.FormEvent) => {
    e.preventDefault();

    // The prefix/allotment validation NO LONGER BLOCKS THE SAVE. Those fields are
    // read-only here now, so an agency whose stored prefixes are invalid - a blank CRGO
    // prefix, a duplicate within a division - could not be corrected on this screen, and
    // blocking would deadlock every OTHER agency field behind a fault with no editor.
    // The warnings still render in the Divisions tab, beside the button that reaches the
    // AT where they ARE editable.

    // SCOPE LIMIT, enforced where the GSTIN is SAVED rather than at agency creation - the
    // creation form does not collect it, so a check there would catch nothing. See D6.
    const scopeError = gstinScopeError(gstin);
    if (scopeError) {
      alert(scopeError);
      return;
    }

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
      //
      // Derived here, at save, from the same live prefix list the removed Divisions copy was
      // built from (AUDIT G56), with the same circle fallback it used - so the circles written
      // are exactly the ones that copy used to supply, without this form holding a second
      // rendering of AT data in its state.
      Object.keys(livePrefixes).forEach(name => {
        const divName = String(name || '').trim();
        const circle = agency.divisionCircles?.[name] || agency.circleOfficeName || '';
        if (divName) divisionCircles[divName] = (circle || circleOfficeName || divName).trim();
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
      checkChange('Registered Business Name', agency.legalName || agency.name, legalName);
      checkChange('Agency GSTIN', agency.gstin, gstin);
      checkChange('Agency PAN', agency.pan, pan);
      checkChange('Agency State', agency.agencyState, agencyState);
      checkChange('Agency State Code', agency.agencyStateCode, agencyStateCode);
      checkChange('Agency Address', agency.address, address);
      checkChange('Phone Number', agency.phone, phone);
      // ⚠ THE SUMMARY MUST NOT SAY "Email Address" EITHER. This line is what the save
      // confirmation lists, and it is the last chance to notice that access is being moved.
      checkChange('Access email (who can use this agency)', agency.email, email);
      checkChange('MSME / Udyam No', agency.msmeNo, msmeNo);

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
        // Trimmed on save, for the reason AgencySettings gives at the creation form: a
        // display string a human typed is not an identifier, and the trim cannot live in
        // onChange without making the field impossible to type a space into.
        name: agencyName.trim(),
        // ⚠ EACH HALF OMITTED WHEN AUTOMATIC, never written with its derived value. `null`
        // when neither was set, so "nobody chose" stays distinguishable from "chose the one
        // that happens to match" - the same distinction as a blank AT percentage against a
        // typed zero.
        mark: (markMonogram || markColour)
          ? { ...(markMonogram ? { monogram: markMonogram } : {}), ...(markColour ? { colour: markColour } : {}) } as any
          : null,
        letterheadUrl: letterheadBase64,
        letterheadMode,
        letterheadHeaderHeightMm: headerHeightMm,
        letterheadFooterHeightMm: footerHeightMm,
        letterheadMarginLeftMm: marginLeftMm,
        letterheadMarginRightMm: marginRightMm,
        showPageNumbers,
        
        // Agency details
        address,
        agencyState,
        // Persist the DERIVED code when a GSTIN exists, so the stored value can never
        // drift from the GSTIN it is part of.
        agencyStateCode: stateCodeFromGstin(gstin) || agencyStateCode,
        // Only stored when it actually differs from the short name. Writing it always
        // would make every agency look as though someone had deliberately set a legal
        // name, and the invoice fallback could no longer tell the two cases apart.
        legalName: legalName.trim() && legalName.trim() !== agencyName.trim() ? legalName.trim() : '',
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
              ? 'bg-blue-600 text-white'
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
              ? 'bg-blue-600 text-white'
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
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <CreditCard className="w-3.5 h-3.5 mr-1.5" /> Bank & Payment
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('preview')}
          className={`px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-t-lg transition-colors flex items-center whitespace-nowrap ${
            activeTab === 'preview'
              ? 'bg-emerald-600 text-white'
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

                {/* ⚠ BESIDE THE NAME, BECAUSE THE MONOGRAM IS THE NAME. Choosing them
                    together is how they stay coherent, and the default follows the name field
                    above as it is typed. Deliberately NOT in the agency switcher: picking an
                    identity while switching identity is a way to change the wrong one.

                    ⚠ A TEXT INPUT AND ONE SELECT. This was two selects over eight glyphs and
                    eight colours; the glyphs are gone - see lib/agencyMark.ts for why an icon
                    set could not work at 28px. The monogram is typed because the derived value
                    cannot know what an owner calls their own agency: "ZR" for ZENITH
                    TRANSFORMERS is neither ZE nor ZT nor ZN, and no rule produces it. */}
                <div className="mt-3">
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                    Mark &mdash; how this agency is shown in the switcher
                  </label>

                  <div className="flex items-center gap-2.5">
                    <div className="grid grid-cols-2 gap-2 flex-1 min-w-0">
                      <input
                        type="text"
                        maxLength={2}
                        value={markMonogram}
                        onChange={e => setMarkMonogram(normaliseMonogram(e.target.value))}
                        placeholder={deriveMonogram(agencyName)}
                        className="w-full px-2.5 py-2 text-sm font-black tracking-tight uppercase text-center border border-slate-300 rounded bg-white"
                      />
                      <select
                        value={markColour}
                        onChange={e => setMarkColour(e.target.value as any)}
                        className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded bg-white"
                      >
                        <option value="">Automatic colour</option>
                        {MARK_COLOURS.map(co => {
                          const used = agenciesUsingMark(
                            { monogram: effectiveMark.monogram, colour: co }, agencies as any, agency.id);
                          return (
                            <option key={co} value={co}>
                              {COLOUR_LABEL[co]}{used.length ? ` — used by ${used.join(', ')}` : ''}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {/* THE LIVE PREVIEW. Dashed ring while everything is automatic, solid once
                        anything is chosen - so a typed mark that matches the derived one is
                        still distinguishable from one nobody set. */}
                    <span className={`shrink-0 rounded-lg p-0.5 ${
                      (markMonogram || markColour) ? 'ring-2 ring-slate-900' : 'ring-2 ring-dashed ring-slate-400'
                    }`}>
                      <AgencyMarkTile mark={effectiveMark} size="lg" />
                    </span>
                  </div>

                  <p className="mt-1.5 text-[11px] text-slate-500">
                    {markMonogram ? 'Typed' : 'From the name'} &mdash; <strong>{effectiveMark.monogram}</strong>,{' '}
                    {markColour ? 'chosen' : 'automatic'} {COLOUR_LABEL[effectiveMark.colour].toLowerCase()}.
                    {' '}Leave the box empty to follow the name.
                  </p>

                  {effectiveClash.length > 0 && (
                    <p className="mt-1.5 text-[11px] font-bold text-amber-900 bg-amber-50 border border-amber-300 rounded px-2 py-1">
                      Also used by {effectiveClash.join(', ')} &mdash; two agencies will look the
                      same in the switcher. Type different letters, or pick another colour.
                    </p>
                  )}

                  <p className="mt-1 text-[10px] text-slate-400">Never printed on any document.</p>
                </div>
              </div>

              {/* Placed immediately before the GSTIN it must agree with, because the
                  requirement is a relationship between the two, not a property of either. */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  Registered Business Name
                </label>
                <input
                  type="text"
                  value={legalName}
                  onChange={e => setLegalName(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder={agencyName || 'e.g. H. E. ELECTRICALS & ENGINEERING CO.'}
                />
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  Printed on the <strong>tax invoice only</strong>. It must match the name on
                  your GST registration exactly - a mismatch between the invoice and the GSTIN
                  is a ground for rejection. Every other screen keeps using the short name
                  above; leave this the same as the short name if they are identical.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  Agency GSTIN *
                </label>
                <input
                  type="text"
                  value={gstin}
                  onChange={e => setGstin(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
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
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
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
                  className={`w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 ${stateCodeFromGstin(gstin) ? 'bg-slate-100 text-slate-600 cursor-not-allowed' : 'bg-white'}`}
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

              {/* ⚠ THIS FIELD IS AN ACCESS GRANT, NOT A CONTACT DETAIL (AUDIT G37).
                  firestore.rules:394 and :400 let any signed-in account whose login email
                  equals this value READ AND WRITE this agency - its rates, its estimates, its
                  bills. Six live agencies are delegated to their customers this way, and that
                  is the intended mechanism.

                  It was labelled "Email Address", placeholder "info@agency.com", which reads as
                  a contact detail and nothing else. A customer tidying their details could
                  clear it and lock themselves out, or retype it as their accountant's address
                  and hand over their tender rates - with no warning at either step.

                  Only what the field SAYS ABOUT ITSELF has changed. The value, the state and
                  the write are untouched. */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  Access email
                </label>
                <p className="text-[11px] text-slate-500 mb-1">
                  The login that can use this agency, besides the owner.
                </p>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="the account that signs in to use this agency"
                />
                <p className="mt-1 text-[11px] font-bold text-amber-900 bg-amber-50 border border-amber-300 rounded px-2 py-1.5">
                  Not a contact address. Whoever signs in with this email can view and change
                  this agency&rsquo;s rates, estimates and bills.{' '}
                  <strong>Clearing it removes their access; changing it hands the agency to
                  someone else.</strong>
                </p>
                {/* ⚠ SHOWN ONLY TO A DELEGATED USER, because for them the mistake cannot be
                    undone from this screen - the owner keeps access through the immutable
                    ownerId, and they do not. */}
                {!isOwner && (
                  <p className="mt-1 text-[11px] font-bold text-red-900 bg-red-50 border border-red-300 rounded px-2 py-1.5">
                    You are using this agency through this email. Changing or clearing it will
                    lock you out immediately, and only the owner can restore it.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">
                  MSME / Udyam Reg. No (Optional)
                </label>
                <input
                  type="text"
                  value={msmeNo}
                  onChange={e => setMsmeNo(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. UDYAM-GJ-01-XXXXXXX"
                />
              </div>

              {/* ⚠ "GP VALIDATION PERIOD (MONTHS)" WAS HERE, AND IT ACCEPTED INPUT THAT NOTHING READ (AUDIT G77).
                  The guarantee period became a TENDER term in G42 - it is A/T 1819 clause 38.2, per core type, and
                  a different A/T may set another. From that day `agency.gpValidationMonths` was written by this form
                  and read by nothing: the intake window, the certificate and the Dashboard's warranty count all
                  resolve through `guaranteeMonthsFor` (job -> AT -> clause default) or through the job's own stamped
                  `gpGuaranteeMonths`.

                  ⚠ SO THIS WAS THE G24 DEFECT IN A SECOND PLACE: a control that took a number, saved it, listed it
                  in the change summary as though something had changed, and governed nothing. Removing it is the fix,
                  not tidying - an input that ignores you is worse than an absent one, because it also tells you it
                  worked.

                  The STORED field is deliberately left on the 15 documents that carry it, and the rules validator
                  still accepts it: a production write to delete a field nothing reads buys nothing. It is now
                  unreachable from the UI and unread by code - see the note at its declaration in AgencyContext. */}

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
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
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
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
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
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
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
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
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

                <div className="md:col-span-2 bg-white p-2.5 sm:p-3 rounded-lg border border-slate-300 space-y-2.5">
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
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded transition-colors"
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
                      className={`w-full px-3 py-2 text-xs font-mono tabular-nums rounded border transition-all ${
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
                      Standard format: <strong className="font-mono tabular-nums text-slate-800">E. E. (O & M) DIVISION - {'{division}'}</strong>
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
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
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
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  placeholder="e.g. SBIN0001234"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4, DIVISIONS & PREFIXES, IS GONE (AUDIT G56). It had already been reduced from a
          read-only mirror to a pointer, and the pointer was still a second place for one fact,
          one tab away from the grid that writes it. By then its directions were wrong as well:
          "This AT Period below" is a tab of Agency Settings, not a section below this form.
          Division circle offices, which it described, are still written on save - see
          handleUpdateAgency. */}

      {/* ================= TAB 5: LIVE PREVIEWS ================= */}
      {activeTab === 'preview' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Estimate Header Preview */}
            <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-l-2 border-l-blue-500 border-blue-200 text-xs space-y-2">
              <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-800 rounded font-bold text-[10px] uppercase tracking-wider">
                Estimate Letter Header (Circle Office)
              </span>
              <div className="font-mono tabular-nums text-[11px] text-slate-800 leading-tight whitespace-pre-wrap bg-slate-50 p-3 rounded border border-slate-200">
                {`TO,\n${circleAuthority || 'Superintending Engineer (O & M)'},\n${discomName || '[DISCOM name not set]'},\nCircle Office : ${circleOfficeName || '[Circle office not set]'}`}
              </div>
              <p className="text-[11px] text-slate-600">
                <strong>C.C.:</strong> {estimateCcTemplate ? estimateCcTemplate.replace(/{division}/gi, 'SABARMATI') : 'E. E. (O & M) DIVISION - SABARMATI'}
              </p>
            </div>

            {/* Billed Copy Header Preview */}
            <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-l-2 border-l-emerald-500 border-emerald-200 text-xs space-y-2">
              <span className="inline-block px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-[10px] uppercase tracking-wider">
                Billed Copy Header (Division Office)
              </span>
              <div className="font-mono tabular-nums text-[11px] text-slate-800 leading-tight whitespace-pre-wrap bg-slate-50 p-3 rounded border border-slate-200">
                {`To,\n${divisionAuthority || 'The Executive Engineer'},\n${discomName || '[DISCOM name not set]'},\nDivision Office : SABARMATI`}
              </div>
              <p className="text-[11px] text-slate-600">
                Automatically uses each MR / Job's specific Division Office.
              </p>
            </div>
          </div>

          {/* Tax Invoice Header & Billed To Card Preview */}
          <div className={`${CARD} ${CARD_PAD} text-xs space-y-3`}>
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
                  <p><strong>Supplier GSTIN:</strong> <span className="font-mono tabular-nums">{gstin || '-'}</span></p>
                  <p><strong>Supplier PAN:</strong> <span className="font-mono tabular-nums">{pan || '-'}</span></p>
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
                  <p><strong>DISCOM GSTIN:</strong> <span className="font-mono tabular-nums">{discomGstin || '-'}</span></p>
                  <p><strong>DISCOM PAN:</strong> <span className="font-mono tabular-nums">{discomPan || '-'}</span></p>
                  <p><strong>Service SAC:</strong> <span className="font-mono tabular-nums">{serviceSacCode || '998719'}</span></p>
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
          className="px-5 py-2.5 text-xs font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center"
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
          <div className="bg-white rounded-lg shadow-2xl p-5 max-w-lg w-full border border-slate-200 animate-in fade-in zoom-in duration-200">
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
              <div className="p-2 bg-white rounded border border-amber-300 font-mono tabular-nums font-bold text-slate-800 text-center select-all shadow-xs">
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
