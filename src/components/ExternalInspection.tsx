
import React, { useState, useEffect, useMemo } from 'react';
import { useAgency } from '../lib/AgencyContext';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { ClipboardCheck, Loader2, ArrowLeft, Search, Save, Filter, Download, Printer, Sparkles, Scale, Cpu, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { formatDDMMYYYY, byDateDesc, byNumericDesc } from '../lib/utils';
import { GP_TEXT_CLASS, GpChip, GP_FILTER_OPTIONS, matchesGpFilter, GpFilter } from '../lib/jobDisplay';
import { LetterheadHeader, PrintableA4Page } from './LetterheadHeader';
import { triggerUniversalPrint } from '../lib/printUtils';
import { RATING_LEVEL_OPTIONS } from '../lib/estimateData';
import { isJobExternallyDone, isMrExternalComplete, latestJobDate } from '../lib/inspectionStage';

export const TRANSFORMER_CORE_TYPES = [
  'CRGO',
  'Amorphous',
  'Wound Core',
  'LSTC',
  'OH'
];

export interface ExternalData {
  kv: string;
  oilCapLtrs: string;
  lessOilLtrs: string;
  sealType: string;
  gasket: string;
  hvLvRod: string;
  nuteBolt: string;
  dryActPart: string;
  clnDrtyTank: string;
  breather: string;
  oilLevGls: string;
  outsidePaint: string;
  namePlate: string;
  damCtTank: string;
  damRadNo: string;
  hvSideHvb: string;
  hvSideHvm: string;
  hvSideHvCc: string;
  lvSideLvb: string;
  lvSideLvm: string;
  lvSideLvCc: string;
  transType: string;
  starRating?: string;
  ratingLevel?: string;
  inspectionId?: string; // added to track existing inspection ID
}

interface PendingChange {
  jobId: string;
  jobNo: string;
  field: 'transType' | 'starRating';
  oldValue: string;
  newValue: string;
  mrIntakeValue: string;
  kva: string;
  make: string;
}

export const getStandardOilCapacity = (kva: number | string): number => {
  const k = Number(kva) || 25;
  if (k <= 10) return 140;
  if (k <= 16) return 140;
  if (k <= 25) return 184;
  if (k <= 50) return 220;
  if (k <= 63) return 240;
  if (k <= 100) return 323;
  if (k <= 160) return 410;
  if (k <= 200) return 450;
  if (k <= 315) return 620;
  if (k <= 500) return 950;
  return Math.round(k * 3.5);
};

export default function ExternalInspection() {
  const { activeAgency } = useAgency();
  const [jobs, setJobs] = useState<any[]>([]);
  const [inspections, setInspections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedMrNo, setSelectedMrNo] = useState<string | null>(null);
  const [externalInspectionDate, setExternalInspectionDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [formsData, setFormsData] = useState<Record<string, ExternalData>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [divisionFilter, setDivisionFilter] = useState<string>('All');
  const [gpFilter, setGpFilter] = useState<GpFilter>('All');
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  
  const [statusFilter, setStatusFilter] = useState<'Pending' | 'Completed'>('Pending');

  useEffect(() => {
    const fetchData = async () => {
      if (!auth.currentUser || !activeAgency) return;
      try {
        setLoading(true);
        const jobsQ = query(
          collection(db, 'jobs'),
          where('ownerId', '==', auth.currentUser.uid),
          where('agencyId', '==', activeAgency.id)
        );
        const [jobsSnap, inspSnap] = await Promise.all([
          getDocs(jobsQ),
          getDocs(query(
            collection(db, 'inspections'),
            where('ownerId', '==', auth.currentUser.uid),
            where('type', '==', 'External')
          ))
        ]);
        
        setJobs(jobsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
        setInspections(inspSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, null);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [activeAgency]);

  const handleSelectMr = (mrNo: string, allJobs = jobs, allInspections = inspections) => {
    const jobsForMr = allJobs.filter(j => j.mrNo === mrNo);
    
    // Sort by Job No conceptually
    jobsForMr.sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));

    // Find any existing inspection date
    let existingDate = '';
    const sampleJob = jobsForMr[0];
    if (sampleJob?.externalInspectionDate) {
      existingDate = sampleJob.externalInspectionDate;
    } else {
      const existingInsp = allInspections.find(i => jobsForMr.some(j => j.id === i.jobId));
      if (existingInsp?.data?.inspectionDate) {
        existingDate = existingInsp.data.inspectionDate;
      } else if (existingInsp?.inspectionDate) {
        existingDate = existingInsp.inspectionDate;
      }
    }
    setExternalInspectionDate(existingDate || new Date().toISOString().split('T')[0]);

    const initialForms: Record<string, ExternalData> = {};
    jobsForMr.forEach(j => {
      const existingInsp = allInspections.find(i => i.jobId === j.id);
      const currentStar = j.starRating || j.ratingLevel || '3 Star & other';
      const coreTypeFromJob = j.coreType || 'CRGO';
      
      if (existingInsp && existingInsp.data) {
        // A saved oil capacity - including a genuine 0 - loads back exactly as
        // stored. No fallback to the standard capacity table: that's an assumption,
        // not what the operator measured.
        const savedOil = existingInsp.data.oilCapLtrs !== undefined && existingInsp.data.oilCapLtrs !== null
          ? String(existingInsp.data.oilCapLtrs)
          : '';

        const savedLessOil = existingInsp.data.lessOilLtrs !== undefined && existingInsp.data.lessOilLtrs !== null
          ? Math.round(Number(existingInsp.data.lessOilLtrs) || 0).toString()
          : '0';

        const savedTransType = existingInsp.data.transType && existingInsp.data.transType !== 'C'
          ? existingInsp.data.transType
          : coreTypeFromJob;

        initialForms[j.id] = {
          kv: existingInsp.data.kv || '11',
          oilCapLtrs: savedOil,
          lessOilLtrs: savedLessOil,
          sealType: existingInsp.data.sealType || 'BL',
          gasket: (existingInsp.data.gasket !== undefined ? String(existingInsp.data.gasket) : '1').replace(/[^0-9]/g, '') || '1',
          hvLvRod: (existingInsp.data.hvLvRod !== undefined ? String(existingInsp.data.hvLvRod) : '7').replace(/[^0-9]/g, '') || '7',
          nuteBolt: existingInsp.data.nuteBolt || 'Y',
          dryActPart: existingInsp.data.dryActPart || 'Y',
          clnDrtyTank: existingInsp.data.clnDrtyTank || 'Y',
          breather: existingInsp.data.breather || 'Y',
          oilLevGls: existingInsp.data.oilLevGls || 'Y',
          outsidePaint: existingInsp.data.outsidePaint || 'Y',
          namePlate: existingInsp.data.namePlate || '-',
          damCtTank: (existingInsp.data.damCtTank !== undefined ? String(Math.round(Number(existingInsp.data.damCtTank) || 0)) : '0'),
          damRadNo: (existingInsp.data.damRadNo !== undefined ? String(Math.round(Number(existingInsp.data.damRadNo) || 0)) : '0'),
          hvSideHvb: (existingInsp.data.hvSideHvb !== undefined ? String(existingInsp.data.hvSideHvb) : '3').replace(/[^0-9]/g, ''),
          hvSideHvm: (existingInsp.data.hvSideHvm !== undefined ? String(existingInsp.data.hvSideHvm) : '3').replace(/[^0-9]/g, ''),
          hvSideHvCc: (existingInsp.data.hvSideHvCc !== undefined ? String(existingInsp.data.hvSideHvCc) : '3').replace(/[^0-9]/g, ''),
          lvSideLvb: (existingInsp.data.lvSideLvb !== undefined ? String(existingInsp.data.lvSideLvb) : '4').replace(/[^0-9]/g, ''),
          lvSideLvm: (existingInsp.data.lvSideLvm !== undefined ? String(existingInsp.data.lvSideLvm) : '4').replace(/[^0-9]/g, ''),
          lvSideLvCc: (existingInsp.data.lvSideLvCc !== undefined ? String(existingInsp.data.lvSideLvCc) : '4').replace(/[^0-9]/g, ''),
          transType: savedTransType,
          starRating: existingInsp.data.starRating || existingInsp.data.ratingLevel || currentStar,
          ratingLevel: existingInsp.data.starRating || existingInsp.data.ratingLevel || currentStar,
          inspectionId: existingInsp.id
        };
      } else {
        // Oil capacity and HV/LV side counts are measured/counted from the actual
        // transformer, not assumptions - they open blank, not pre-filled from the
        // standard capacity table or a guessed bushing count.
        initialForms[j.id] = {
          kv: '11',
          oilCapLtrs: '',
          lessOilLtrs: '0',
          sealType: 'BL',
          gasket: '1',
          hvLvRod: '7',
          nuteBolt: 'Y',
          dryActPart: 'Y',
          clnDrtyTank: 'Y',
          breather: 'Y',
          oilLevGls: 'Y',
          outsidePaint: 'Y',
          namePlate: '-',
          damCtTank: '0',
          damRadNo: '0',
          hvSideHvb: '',
          hvSideHvm: '',
          hvSideHvCc: '',
          lvSideLvb: '',
          lvSideLvm: '',
          lvSideLvCc: '',
          transType: coreTypeFromJob,
          starRating: currentStar,
          ratingLevel: currentStar
        };
      }
    });

    setFormsData(initialForms);
    setSelectedMrNo(mrNo);
  };

  const handleChange = (jobId: string, field: keyof ExternalData, value: string) => {
    let sanitized = value;
    // Strict integer restriction: No decimals or non-numeric characters allowed in count/numeric measurement fields
    const integerFields: (keyof ExternalData)[] = [
      'oilCapLtrs', 'lessOilLtrs', 'gasket', 'hvLvRod', 'damRadNo', 'damCtTank',
      'hvSideHvb', 'hvSideHvm', 'hvSideHvCc', 'lvSideLvb', 'lvSideLvm', 'lvSideLvCc'
    ];
    
    if (integerFields.includes(field)) {
      sanitized = sanitized.replace(/[^0-9]/g, '');
    }

    setFormsData(prev => {
      const updated = {
        ...prev[jobId],
        [field]: sanitized
      };
      if (field === 'starRating') {
        updated.ratingLevel = sanitized;
      }
      return {
        ...prev,
        [jobId]: updated
      };
    });
  };

  // Trigger alert confirmation when user manually modifies Transformer Type from MR intake
  const handleCoreTypeChangeAttempt = (job: any, newCoreType: string) => {
    const currentVal = formsData[job.id]?.transType || job.coreType || 'CRGO';
    const mrIntakeVal = job.coreType || 'CRGO';

    if (newCoreType === currentVal) return;

    if (newCoreType !== mrIntakeVal) {
      // Trigger interactive alert modal
      setPendingChange({
        jobId: job.id,
        jobNo: job.jobNo,
        field: 'transType',
        oldValue: currentVal,
        newValue: newCoreType,
        mrIntakeValue: mrIntakeVal,
        kva: String(job.capacityKva || ''),
        make: String(job.make || '')
      });
    } else {
      // Reverting back to MR Intake type directly
      handleChange(job.id, 'transType', newCoreType);
    }
  };

  const handleConfirmPendingChange = () => {
    if (!pendingChange) return;
    handleChange(pendingChange.jobId, pendingChange.field, pendingChange.newValue);
    setPendingChange(null);
  };

  const handleCancelPendingChange = () => {
    setPendingChange(null);
  };

  const mrJobs = useMemo(() => {
    if (!selectedMrNo) return [];
    return jobs.filter(j => j.mrNo === selectedMrNo).sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));
  }, [jobs, selectedMrNo]);

  const handleExportExcel = () => {
    if (!selectedMrNo) return;
    const sampleJob = mrJobs[0];
    const mrDateStr = formatDDMMYYYY(sampleJob?.dateOfIssue || sampleJob?.mrDate || sampleJob?.createdAt);
    const wsData = [
      ['EXTERNAL INSPECTION & PRELIMINARY ASSESSMENT REPORT'],
      ['Agency:', activeAgency?.name || '', 'Division:', sampleJob?.division || '', 'MR Number:', selectedMrNo, 'MR Date:', mrDateStr, 'Inspection Date:', externalInspectionDate],
      [],
      [
        '#', 'JOB NO', 'TRANS. SR. NO', 'MAKE', 'DIVISION', 'MR NO', 'MR DATE', 'KVA', 'TRANS. TYPE / CORE', 'RATING / LEVEL', 'INSP. DATE', 'KV', 'OIL CAP LTRS', 'LESS OIL LTRS', 'OIL AVAIL LTRS', 'NET SHORT LTRS', 'SEAL TYPE', 'GASKET', 'H.V.L.V ROD', 'NUTE/BOLT', 'DRY ACT. PART', 'CLN DRTY TANK', 'BREATHER', 'OIL LEV. GLS', 'OUTSIDE PAINT', 'NAME PLATE', 'DAM. CT. TANK', 'DAM. RAD. NO', 'H.V.B', 'H.V.M', 'H.V.C.C', 'L.V.B', 'L.V.M', 'L.V.C.C'
      ]
    ];
    
    mrJobs.forEach((job, index) => {
      const data = formsData[job.id] || {} as ExternalData;
      const oilCap = Number(data.oilCapLtrs) || 0;
      const lessOil = Number(data.lessOilLtrs) || 0;
      const oilAvl = Math.max(0, oilCap - lessOil);
      const netShrt = Math.round((oilAvl * 0.05) + lessOil);

      wsData.push([
        index + 1,
        job.jobNo + (job.repairType === 'GP' ? ' (GP)' : ''),
        job.serialNo || '-',
        job.make || '-',
        job.division || '-',
        job.mrNo,
        mrDateStr,
        job.capacityKva,
        data.transType || job.coreType || 'CRGO',
        data.starRating || job.starRating || '3 Star & other',
        externalInspectionDate,
        data.kv || '11',
        data.oilCapLtrs || '',
        data.lessOilLtrs || '',
        oilAvl,
        netShrt,
        data.sealType || '',
        data.gasket || '',
        data.hvLvRod || '',
        data.nuteBolt || '',
        data.dryActPart || '',
        data.clnDrtyTank || '',
        data.breather || '',
        data.oilLevGls || '',
        data.outsidePaint || '',
        data.namePlate || '',
        data.damCtTank || '',
        data.damRadNo || '',
        data.hvSideHvb || '',
        data.hvSideHvm || '',
        data.hvSideHvCc || '',
        data.lvSideLvb || '',
        data.lvSideLvm || '',
        data.lvSideLvCc || ''
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "External Inspection");
    XLSX.writeFile(wb, `External_Inspection_${selectedMrNo}.xlsx`);
  };

  const handlePrint = () => {
    setIsPrintOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !selectedMrNo) return;

    // HV/LV side counts have hard maximums (3 bushings/metal-parts/connectors on the
    // HV side, 4 on the LV side). The input already rejects entries above the max as
    // they're typed, but a legacy record saved before that limit existed could still
    // carry an over-range value through unchanged - catch that here too.
    const HV_MAX = 3;
    const LV_MAX = 4;
    const rangeErrors: string[] = [];
    for (const job of mrJobs) {
      if (job.status === 'Dispatched' || job.isClosed === true) continue;
      const jobData = formsData[job.id];
      if (!jobData) continue;

      const checks: Array<[string, string | undefined, number]> = [
        ['HV Side B', jobData.hvSideHvb, HV_MAX],
        ['HV Side M', jobData.hvSideHvm, HV_MAX],
        ['HV Side CC', jobData.hvSideHvCc, HV_MAX],
        ['LV Side B', jobData.lvSideLvb, LV_MAX],
        ['LV Side M', jobData.lvSideLvm, LV_MAX],
        ['LV Side CC', jobData.lvSideLvCc, LV_MAX],
      ];
      for (const [label, value, max] of checks) {
        if (value !== undefined && value.trim() !== '' && Number(value) > max) {
          rangeErrors.push(`${job.jobNo}: ${label} cannot exceed ${max}.`);
        }
      }
    }
    if (rangeErrors.length > 0) {
      alert(`⚠️ Value out of range:\n\n${rangeErrors.join('\n')}`);
      return;
    }

    // Strict validation: Ensure no blank or incomplete inspection form is submitted
    const incompleteJobs: string[] = [];
    for (const job of mrJobs) {
      if (job.status === 'Dispatched' || job.isClosed === true) continue;
      const jobData = formsData[job.id];
      if (!jobData) {
        incompleteJobs.push(`Job #${job.jobNo}: Form is completely blank`);
        continue;
      }

      const missing: string[] = [];
      if (!jobData.oilCapLtrs || jobData.oilCapLtrs.trim() === '') missing.push('Oil Capacity (Ltrs)');
      if (jobData.lessOilLtrs === undefined || jobData.lessOilLtrs.trim() === '') missing.push('Less Oil (Ltrs)');
      if (!jobData.kv || jobData.kv.trim() === '') missing.push('KV Rating');
      if (!jobData.sealType || jobData.sealType.trim() === '') missing.push('Seal Type');
      if (!jobData.gasket || jobData.gasket.trim() === '') missing.push('Gasket');
      if (!jobData.transType || jobData.transType.trim() === '') missing.push('Transformer Type');
      if (jobData.hvSideHvb === undefined || jobData.hvSideHvb.trim() === '') missing.push('HV Side B');
      if (jobData.hvSideHvm === undefined || jobData.hvSideHvm.trim() === '') missing.push('HV Side M');
      if (jobData.hvSideHvCc === undefined || jobData.hvSideHvCc.trim() === '') missing.push('HV Side CC');
      if (jobData.lvSideLvb === undefined || jobData.lvSideLvb.trim() === '') missing.push('LV Side B');
      if (jobData.lvSideLvm === undefined || jobData.lvSideLvm.trim() === '') missing.push('LV Side M');
      if (jobData.lvSideLvCc === undefined || jobData.lvSideLvCc.trim() === '') missing.push('LV Side CC');

      if (missing.length > 0) {
        incompleteJobs.push(`Job #${job.jobNo}: Missing (${missing.join(', ')})`);
      }
    }

    if (incompleteJobs.length > 0) {
      alert(`⚠️ Blank or incomplete inspection forms are NOT acceptable!\n\nPlease fill in all required inspection details before saving:\n\n${incompleteJobs.join('\n')}`);
      return;
    }

    // Check for any modified Core Types compared to original MR Intake
    const modifiedCoreJobs = mrJobs.filter(j => {
      const chosenType = formsData[j.id]?.transType || j.coreType || 'CRGO';
      const mrType = j.coreType || 'CRGO';
      return chosenType !== mrType;
    });

    if (modifiedCoreJobs.length > 0) {
      const listStr = modifiedCoreJobs.map(j => `• Job #${j.jobNo} (${j.capacityKva} KVA): MR intake "${j.coreType || 'CRGO'}" ➔ Physical Inspection "${formsData[j.id]?.transType}"`).join('\n');
      const userConfirmed = window.confirm(`⚠️ ALERT: Transformer Core Type Modifications Detected\n\nThe following transformers have different Core Types than originally entered during MR Intake:\n\n${listStr}\n\nBy accepting, these changes will be permanently finalized across the WHOLE JOB CYCLE (Estimate Master template, rate calculation, scrap allowances, and testing specs).\n\nDo you want to finalize these changes?`);
      if (!userConfirmed) {
        return;
      }
    }
    
    setIsSubmitting(true);
    try {
      const now = Date.now();
      const batch = writeBatch(db);
      
      for (const job of mrJobs) {
        if (job.status === 'Dispatched' || job.isClosed === true) continue;
        const jobData = formsData[job.id];
        
        let inspectionRef;
        if (jobData.inspectionId) {
          inspectionRef = doc(db, 'inspections', jobData.inspectionId);
        } else {
          inspectionRef = doc(collection(db, 'inspections'));
        }
        
        const currentStarRating = jobData.starRating || jobData.ratingLevel || job.starRating || job.ratingLevel || '3 Star & other';
        const currentCoreType = jobData.transType || job.coreType || 'CRGO';

        const payload = {
          jobId: job.id,
          type: 'External',
          inspectionDate: externalInspectionDate,
          data: {
            inspectionDate: externalInspectionDate,
            kv: jobData.kv,
            oilCapLtrs: Math.round(Number(jobData.oilCapLtrs) || 0),
            lessOilLtrs: Math.round(Number(jobData.lessOilLtrs) || 0),
            oilAvailable: Math.round((Number(jobData.oilCapLtrs) || 0) - (Number(jobData.lessOilLtrs) || 0)),
            netShortage: Math.round((((Number(jobData.oilCapLtrs) || 0) - (Number(jobData.lessOilLtrs) || 0)) * 0.05) + (Number(jobData.lessOilLtrs) || 0)),
            sealType: jobData.sealType,
            gasket: jobData.gasket,
            hvLvRod: jobData.hvLvRod,
            nuteBolt: jobData.nuteBolt,
            dryActPart: jobData.dryActPart,
            clnDrtyTank: jobData.clnDrtyTank,
            breather: jobData.breather,
            oilLevGls: jobData.oilLevGls,
            outsidePaint: jobData.outsidePaint,
            namePlate: jobData.namePlate,
            damCtTank: Math.round(Number(jobData.damCtTank) || 0),
            damRadNo: Math.round(Number(jobData.damRadNo) || 0),
            hvSideHvb: jobData.hvSideHvb,
            hvSideHvm: jobData.hvSideHvm,
            hvSideHvCc: jobData.hvSideHvCc,
            lvSideLvb: jobData.lvSideLvb,
            lvSideLvm: jobData.lvSideLvm,
            lvSideLvCc: jobData.lvSideLvCc,
            transType: currentCoreType,
            starRating: currentStarRating,
            ratingLevel: currentStarRating
          },
          updatedAt: now,
          ownerId: auth.currentUser.uid,
          // Stamped for future agency-scoped queries. Existing records predate this
          // field, so nothing may filter on it until they're backfilled.
          agencyId: activeAgency?.id,
        };
        
        if (!jobData.inspectionId) {
          // Date.now(), NOT serverTimestamp() - reverted, see AUDIT F45.
          //
          // firestore.rules:96 requires createdAt on an inspection to be a number or a
          // string. A serverTimestamp() resolves to a Firestore Timestamp, which is
          // neither, so isValidInspection() returned false and EVERY new inspection was
          // denied. Edits still worked (createdAt is written on first create only), which
          // is why it looked intermittent rather than broken.
          //
          // The property that was lost is smaller than it looked: `inspectionDate` is
          // typed by hand anyway, so a server-stamped createdAt sits beside an
          // operator-entered date and corroborates nothing on its own. Widening the rule
          // to accept a Timestamp can be a deliberate change later; it is not worth a
          // rules deploy in the middle of a save outage.
          (payload as any).createdAt = now;
        }

        batch.set(inspectionRef, payload, { merge: true });

        // Update Job Status, persist inspected Star Rating, Transformer Core Type, and External Inspection Date directly on Job
        const jobRef = doc(db, 'jobs', job.id);
        const jobUpdate: any = {
          coreType: currentCoreType,
          starRating: currentStarRating,
          ratingLevel: currentStarRating,
          externalInspectionDate: externalInspectionDate,
          updatedAt: now
        };
        
        if (job.status === 'Received') {
          jobUpdate.status = 'External Done';
        }

        batch.update(jobRef, jobUpdate);
      }

      await batch.commit();

      // Refresh data
      const jobsQ = query(
        collection(db, 'jobs'),
        where('ownerId', '==', auth.currentUser.uid),
        where('agencyId', '==', activeAgency?.id)
      );
      const [jobsSnap, inspSnap] = await Promise.all([
        getDocs(jobsQ),
        getDocs(query(
          collection(db, 'inspections'),
          where('ownerId', '==', auth.currentUser.uid),
          where('type', '==', 'External')
        ))
      ]);
      setJobs(jobsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
      setInspections(inspSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      
      setSelectedMrNo(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, null);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Group OGP jobs by MR No for the selection list
  const mrGroups: Record<string, any[]> = {};
  jobs.forEach(j => {
    if (j.status === 'Cancelled' || j.isCancelled === true || j.mrStatus === 'Cancelled') return;
    if (divisionFilter !== 'All' && j.division !== divisionFilter) return;
    if (!matchesGpFilter(j, gpFilter)) return;
    if (!mrGroups[j.mrNo]) mrGroups[j.mrNo] = [];
    mrGroups[j.mrNo].push(j);
  });

  /** MR date for sorting: MR NUMBERS ARE NOT CHRONOLOGICAL, so number is the tiebreak
   *  only. Undated MRs sink via byDateDesc. */
  const mrSortDate = (mr: string): string => {
    const g = mrGroups[mr] || [];
    for (const j of g) {
      const d = j.dateOfIssue || j.mrDate || '';
      if (d) return d;
    }
    return '';
  };
  
  const availableDivisions = Array.from(new Set(jobs.map(j => j.division).filter(Boolean))).sort();
  
  // Filter MRs by Pending/Completed based on job statuses
  const uniqueMrNos = Object.keys(mrGroups).filter(mr => {
    const jobsForMr = mrGroups[mr];
    const isComplete = isMrExternalComplete(jobsForMr, inspections);
    if (statusFilter === 'Completed') {
      return isComplete;
    }
    return !isComplete && jobsForMr.some(j => !j.status || j.status === 'Received');
  }).sort(byDateDesc(mr => mrSortDate(mr), byNumericDesc(mr => mr)));

  const filteredMrNos = uniqueMrNos.filter(mr => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return mr.toLowerCase().includes(q) || mrGroups[mr].some(j => j.jobNo.toLowerCase().includes(q));
  });

  const renderIntegerField = (jobId: string, field: keyof ExternalData, widthClass = 'w-14', placeholder = '0', max?: number) => (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      min={max !== undefined ? 0 : undefined}
      max={max}
      value={formsData[jobId]?.[field] ?? ''}
      onChange={(e) => {
        if (max !== undefined) {
          const digitsOnly = e.target.value.replace(/[^0-9]/g, '');
          // Reject rather than clamp: a clamped value looks entered, but this one
          // wasn't - the operator typed something out of range and should see that
          // rejection, not a silently substituted number.
          if (digitsOnly !== '' && Number(digitsOnly) > max) return;
        }
        handleChange(jobId, field, e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === '.' || e.key === 'e' || e.key === 'E' || e.key === ',' || e.key === '-') {
          e.preventDefault();
        }
      }}
      placeholder={placeholder}
      className={`px-1.5 py-1 text-xs font-mono font-bold text-center border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-2xs print:border-0 print:shadow-none print:p-0 print:bg-transparent print:appearance-none print:text-black print:text-center ${widthClass}`}
    />
  );

  const renderInputField = (jobId: string, field: keyof ExternalData, type = 'text', widthClass = 'w-full') => (
    <input
      type={type}
      value={formsData[jobId]?.[field] || ''}
      onChange={(e) => handleChange(jobId, field, e.target.value)}
      className={`px-1.5 py-1 text-xs font-medium text-center border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-2xs print:border-0 print:shadow-none print:p-0 print:bg-transparent print:appearance-none print:text-black print:text-center ${widthClass}`}
    />
  );

  const renderSelectField = (jobId: string, field: keyof ExternalData, options: string[], widthClass = 'w-14') => (
    <select
      value={formsData[jobId]?.[field] || ''}
      onChange={(e) => handleChange(jobId, field, e.target.value)}
      className={`px-1 py-1 text-xs font-bold text-center border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-2xs print:border-0 print:shadow-none print:p-0 print:bg-transparent print:appearance-none print:text-black print:text-center ${widthClass}`}
    >
      {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  );

  if (!activeAgency) {
    return (
      <div className="p-8 text-center text-slate-500">
        Please select or create an agency first.
      </div>
    );
  }

  if (isPrintOpen && selectedMrNo) {
    const sampleJob = mrJobs[0];
    const mrDateStr = formatDDMMYYYY(sampleJob?.dateOfIssue || sampleJob?.mrDate || sampleJob?.createdAt);
    const CHUNK_SIZE = 9;
    const jobChunks: typeof mrJobs[] = [];
    for (let i = 0; i < mrJobs.length; i += CHUNK_SIZE) {
      jobChunks.push(mrJobs.slice(i, i + CHUNK_SIZE));
    }
    if (jobChunks.length === 0) jobChunks.push([]);

    return (
      <div className="bg-slate-100 min-h-screen text-black p-4 print:p-0 print:bg-white">
        <div className="print:hidden max-w-[297mm] mx-auto mb-4 flex justify-between items-center bg-white p-4 rounded-xl shadow-md border border-slate-200">
          <div>
            <p className="text-sm font-bold text-slate-800">External Inspection Report - Print Preview</p>
            <p className="text-xs text-slate-500">
              MR No: <strong className="font-mono">{selectedMrNo}</strong> ({mrDateStr}) • {mrJobs.length} Transformers • {jobChunks.length} Landscape A4 Page{jobChunks.length > 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => triggerUniversalPrint('printable-external-inspection-sheet', `External_Inspection_MR_${selectedMrNo}`, `External_Inspection_MR_${selectedMrNo}.pdf`, 'landscape')} 
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg flex items-center shadow-sm font-bold text-xs cursor-pointer transition-colors"
              title="Print document on Landscape A4 / Letterhead"
            >
              <Printer className="w-4 h-4 mr-2" /> Print (Landscape)
            </button>
            <button
              onClick={handleExportExcel}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold text-xs cursor-pointer transition-colors flex items-center"
            >
              <Download className="w-3.5 h-3.5 mr-1.5" /> Excel
            </button>
            <button 
              onClick={() => setIsPrintOpen(false)} 
              className="px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg font-bold text-xs cursor-pointer transition-colors"
            >
              Close Preview
            </button>
          </div>
        </div>

        <div id="printable-external-inspection-sheet" className="p-0 bg-transparent flex flex-col items-center">
          {jobChunks.map((chunk, pageIdx) => {
            const isLastPage = pageIdx === jobChunks.length - 1;
            return (
              <PrintableA4Page
                key={pageIdx}
                agency={activeAgency}
                orientation="landscape"
                documentTitle="EXTERNAL INSPECTION & PRELIMINARY ASSESSMENT REPORT"
                subtitle={jobChunks.length > 1 ? `Sheet ${pageIdx + 1} of ${jobChunks.length}` : undefined}
                className={pageIdx > 0 ? 'print-page-break-before mb-6' : 'mb-6'}
              >
                <div className="flex flex-col justify-between h-full">
                  <div>
                    <div className="flex justify-between items-center text-[10px] font-bold border-b border-black pb-1 mb-1.5">
                      <span>MR NO: <strong className="font-mono">{selectedMrNo}</strong></span>
                      <span>MR DATE: <strong className="font-mono">({mrDateStr})</strong></span>
                      <span>DIVISION: <strong className="uppercase">{sampleJob?.division || '-'}</strong></span>
                      <span>TOTAL TRANSFORMERS: <strong>{mrJobs.length}</strong></span>
                    </div>

                    <table className="w-full border-collapse border border-black text-[7.5px] text-center">
                      <thead>
                        {/* Grouped High-Level Header */}
                        <tr className="bg-slate-100 print:bg-transparent font-bold">
                          <th className="border border-black p-0.5 w-6" rowSpan={2}>Sr</th>
                          <th className="border border-black p-0.5 min-w-[65px]" rowSpan={2}>Job No</th>
                          <th className="border border-black p-0.5 min-w-[50px]" rowSpan={2}>Make</th>
                          <th className="border border-black p-0.5 w-10" rowSpan={2}>KVA</th>
                          <th className="border border-black p-0.5 min-w-[55px]" rowSpan={2}>Type / Core</th>
                          <th className="border border-black p-0.5 min-w-[55px]" rowSpan={2}>Rating / Level</th>
                          <th className="border border-black p-0.5 w-6" rowSpan={2}>KV</th>
                          <th className="border border-black p-0.5 w-9" rowSpan={2}>Oil Cap (L)</th>
                          <th className="border border-black p-0.5 w-9" rowSpan={2}>Less Oil (L)</th>
                          <th className="border border-black p-0.5 w-7" rowSpan={2}>SL/BL</th>
                          <th className="border border-black p-0.5 w-6" rowSpan={2}>Gasket</th>
                          <th className="border border-black p-0.5 w-6" rowSpan={2}>HV/LV Rod</th>
                          <th className="border border-black p-0.5 w-6" rowSpan={2}>Nut/Bolt</th>
                          <th className="border border-black p-0.5 w-6" rowSpan={2}>Dry Act</th>
                          <th className="border border-black p-0.5 w-6" rowSpan={2}>Cln Tank</th>
                          <th className="border border-black p-0.5 w-6" rowSpan={2}>Breather</th>
                          <th className="border border-black p-0.5 w-6" rowSpan={2}>Oil Lev</th>
                          <th className="border border-black p-0.5 w-6" rowSpan={2}>Out Paint</th>
                          <th className="border border-black p-0.5 w-6" rowSpan={2}>Name Plt</th>
                          <th className="border border-black p-0.5 w-8" rowSpan={2} title="Damage Conservator (Damaged Conservator Tank)">Dam CT</th>
                          <th className="border border-black p-0.5 w-8" rowSpan={2} title="Damage Radiator (Damaged Radiator fins/pipes)">Dam Rad</th>
                          {/* HV SIDE GROUP WITH DISTINCT OUTER LINE */}
                          <th className="border-t border-b border-black border-l-2 border-r-2 border-black p-0.5 bg-slate-200 print:bg-transparent font-black" colSpan={3}>
                            HV SIDE (B / M / CC)
                          </th>
                          {/* LV SIDE GROUP WITH DISTINCT OUTER LINE */}
                          <th className="border-t border-b border-black border-l-2 border-r-2 border-black p-0.5 bg-slate-200 print:bg-transparent font-black" colSpan={3}>
                            LV SIDE (B / M / CC)
                          </th>
                        </tr>
                        {/* Sub-Headers for HV & LV Bushing / Metal / CC */}
                        <tr className="bg-slate-100 print:bg-transparent font-bold">
                          <th className="border-b border-black border-l-2 border-r border-black p-0.5 w-6">B</th>
                          <th className="border-b border-black border-r border-black p-0.5 w-6">M</th>
                          <th className="border-b border-black border-r-2 border-black p-0.5 w-6">CC</th>
                          <th className="border-b border-black border-l-2 border-r border-black p-0.5 w-6">B</th>
                          <th className="border-b border-black border-r border-black p-0.5 w-6">M</th>
                          <th className="border-b border-black border-r-2 border-black p-0.5 w-6">CC</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chunk.map((job, cIdx) => {
                          const globalIdx = pageIdx * CHUNK_SIZE + cIdx;
                          const data = formsData[job.id] || {} as any;
                          const rating = data.starRating || job.starRating || '3 Star & other';
                          const transCore = data.transType || job.coreType || 'CRGO';

                          return (
                            <tr key={job.id} className="border border-black h-6">
                              <td className="border border-black p-0.5 font-bold">{globalIdx + 1}</td>
                              <td className="border border-black p-0.5 font-bold font-mono uppercase text-left pl-1">
                                {job.jobNo} {job.repairType === 'GP' ? '(GP)' : ''}
                              </td>
                              <td className="border border-black p-0.5 truncate max-w-[50px]">{job.make || '-'}</td>
                              <td className="border border-black p-0.5 font-bold">{job.capacityKva}</td>
                              <td className="border border-black p-0.5 font-bold uppercase text-[7px] text-blue-900">
                                {transCore}
                              </td>
                              <td className="border border-black p-0.5 text-[6.5px] font-semibold truncate max-w-[55px]" title={rating}>
                                {rating}
                              </td>
                              <td className="border border-black p-0.5">{data.kv || '11'}</td>
                              <td className="border border-black p-0.5 font-bold">{data.oilCapLtrs !== undefined && data.oilCapLtrs !== null && data.oilCapLtrs !== '' ? data.oilCapLtrs : '-'}</td>
                              <td className="border border-black p-0.5">{data.lessOilLtrs || '0'}</td>
                              <td className="border border-black p-0.5 font-bold">{data.sealType || 'BL'}</td>
                              <td className="border border-black p-0.5">{data.gasket || '1'}</td>
                              <td className="border border-black p-0.5">{data.hvLvRod || '7'}</td>
                              <td className="border border-black p-0.5">{data.nuteBolt || 'Y'}</td>
                              <td className="border border-black p-0.5">{data.dryActPart || 'Y'}</td>
                              <td className="border border-black p-0.5">{data.clnDrtyTank || 'Y'}</td>
                              <td className="border border-black p-0.5">{data.breather || 'Y'}</td>
                              <td className="border border-black p-0.5">{data.oilLevGls || 'Y'}</td>
                              <td className="border border-black p-0.5">{data.outsidePaint || 'Y'}</td>
                              <td className="border border-black p-0.5">{data.namePlate || '-'}</td>
                              <td className="border border-black p-0.5">{data.damCtTank || '0'}</td>
                              <td className="border border-black p-0.5">{data.damRadNo || '0'}</td>
                              
                              {/* HV Side Group Enclosed Columns */}
                              <td className="border-b border-black border-l-2 border-r border-black p-0.5 font-bold">{data.hvSideHvb !== undefined && data.hvSideHvb !== null && data.hvSideHvb !== '' ? data.hvSideHvb : '-'}</td>
                              <td className="border-b border-black border-r border-black p-0.5 font-bold">{data.hvSideHvm !== undefined && data.hvSideHvm !== null && data.hvSideHvm !== '' ? data.hvSideHvm : '-'}</td>
                              <td className="border-b border-black border-r-2 border-black p-0.5 font-bold">{data.hvSideHvCc !== undefined && data.hvSideHvCc !== null && data.hvSideHvCc !== '' ? data.hvSideHvCc : '-'}</td>

                              {/* LV Side Group Enclosed Columns */}
                              <td className="border-b border-black border-l-2 border-r border-black p-0.5 font-bold">{data.lvSideLvb !== undefined && data.lvSideLvb !== null && data.lvSideLvb !== '' ? data.lvSideLvb : '-'}</td>
                              <td className="border-b border-black border-r border-black p-0.5 font-bold">{data.lvSideLvm !== undefined && data.lvSideLvm !== null && data.lvSideLvm !== '' ? data.lvSideLvm : '-'}</td>
                              <td className="border-b border-black border-r-2 border-black p-0.5 font-bold">{data.lvSideLvCc !== undefined && data.lvSideLvCc !== null && data.lvSideLvCc !== '' ? data.lvSideLvCc : '-'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {isLastPage && (
                    <div className="mt-2 pt-2 border-t border-black flex justify-between items-end px-6 text-[9.5px] font-bold uppercase">
                      <div className="text-center">
                        <div className="h-8"></div>
                        <div className="border-t border-dotted border-black pt-0.5">INSPECTED BY</div>
                        <div className="text-[8px] text-slate-700 font-normal">Junior Engineer</div>
                      </div>
                      <div className="text-center">
                        <div className="h-8"></div>
                        <div className="border-t border-dotted border-black pt-0.5">EXECUTIVE ENGINEER</div>
                      </div>
                      <div className="text-center">
                        <div className="h-8 flex items-center justify-center">
                          <div className="border border-dashed border-slate-400 px-2 py-0.5 rounded text-[7.5px] text-slate-500 font-normal">
                            OFFICIAL STAMP
                          </div>
                        </div>
                        <div className="border-t border-dotted border-black pt-0.5">FOR {activeAgency?.name}</div>
                        <div className="text-[8px] text-slate-700 font-normal">Authorized Signatory</div>
                      </div>
                    </div>
                  )}
                </div>
              </PrintableA4Page>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 print:space-y-0">
      {/* PENDING CHANGE INTERACTIVE ALERT MODAL */}
      {pendingChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden">
            <div className="bg-amber-500 p-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-5 h-5 text-white shrink-0" />
                <h3 className="font-bold text-sm uppercase tracking-wide">
                  Confirm Transformer Type Change
                </h3>
              </div>
              <button 
                onClick={handleCancelPendingChange}
                className="text-amber-100 hover:text-white p-1 rounded-full hover:bg-amber-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="text-xs text-slate-600">
                You are manually changing the core specifications for:
              </div>

              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 font-medium">Job Number:</span>
                  <span className="font-mono font-bold text-slate-900">{pendingChange.jobNo}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 font-medium">Capacity & Make:</span>
                  <span className="font-semibold text-slate-800">{pendingChange.kva} KVA • {pendingChange.make}</span>
                </div>
              </div>

              {/* Comparison Box */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-100 rounded-lg border border-slate-200 text-center">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                    MR Intake Type
                  </span>
                  <span className="font-mono font-bold text-slate-700 text-sm">
                    {pendingChange.mrIntakeValue}
                  </span>
                </div>

                <div className="p-3 bg-amber-50 rounded-lg border border-amber-300 text-center shadow-xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 block mb-1">
                    Physical Inspection
                  </span>
                  <span className="font-mono font-black text-amber-900 text-sm">
                    {pendingChange.newValue}
                  </span>
                </div>
              </div>

              <div className="bg-amber-50/80 p-3 rounded-lg border-l-4 border-amber-500 text-xs text-amber-950 space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  Impact on Whole Job Cycle:
                </p>
                <p className="text-[11px] leading-relaxed text-amber-900">
                  Accepting this change will update the core type permanently for this job. It directly determines which <strong>Estimate Master template</strong> (e.g. CRGO, Amorphous, Wound Core, LSTC, OH) and material scrap calculations will be used.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleCancelPendingChange}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel / Keep MR Type
                </button>
                <button
                  type="button"
                  onClick={handleConfirmPendingChange}
                  className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Accept & Finalize Change
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded shadow-sm border border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-900 print:text-black flex items-center">
            <ClipboardCheck className="w-6 h-6 mr-3 text-blue-600" />
            External Inspection
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Capture physical external inspection parameters, transformer type (CRGO, Amorphous, Wound Core, LSTC, OH), star rating levels, and bushing parts.
          </p>
        </div>
      </div>

      {!selectedMrNo ? (
        <div className="bg-white rounded shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 print:bg-transparent flex flex-col md:flex-row justify-between items-center gap-4">
            <h2 className="text-sm font-bold text-slate-700 print:text-black uppercase tracking-widest">Select MR to Inspect</h2>
            <div className="flex flex-wrap items-center space-x-4 w-full md:w-auto gap-y-2">
              <select
                value={gpFilter}
                onChange={(e) => setGpFilter(e.target.value as GpFilter)}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                title="Filter by repair type - GP repairs are done under guarantee at no cost"
              >
                {GP_FILTER_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>

              <select
                value={divisionFilter}
                onChange={(e) => setDivisionFilter(e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="All">All Divisions</option>
                {availableDivisions.map(div => (
                  <option key={div as string} value={div as string}>{div as string}</option>
                ))}
              </select>
              <div className="flex bg-slate-200 p-1 rounded-md">
                <button
                  onClick={() => setStatusFilter('Pending')}
                  className={`px-4 py-1.5 text-xs font-bold uppercase rounded ${statusFilter === 'Pending' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 print:text-black'}`}
                >
                  Pending
                </button>
                <button
                  onClick={() => setStatusFilter('Completed')}
                  className={`px-4 py-1.5 text-xs font-bold uppercase rounded ${statusFilter === 'Completed' ? 'bg-white text-green-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 print:text-black'}`}
                >
                  Completed
                </button>
              </div>
              <div className="relative flex-1 md:w-64">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search MR or Job No..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                />
              </div>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-12 flex justify-center text-slate-500">
                <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
              </div>
            ) : (
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-100/70 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-3 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider w-10">#</th>
                    <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">MR Number & Date</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Division</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Capacity Summary</th>
                    <th className="px-3 py-3 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Units</th>
                    <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Job Numbers</th>
                    <th className="px-3 py-3 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">External Insp. Status</th>
                    <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {filteredMrNos.map((mr, idx) => {
                    const jobsForMr = mrGroups[mr] || [];
                    const sampleJob = jobsForMr[0];
                    const mrDateStr = formatDDMMYYYY(sampleJob?.dateOfIssue || sampleJob?.mrDate || sampleJob?.createdAt);
                    
                    // Capacity summary calculation
                    const capCountMap: Record<number, number> = {};
                    let totalKva = 0;
                    jobsForMr.forEach(j => {
                      const k = Number(j.capacityKva) || 0;
                      capCountMap[k] = (capCountMap[k] || 0) + 1;
                      totalKva += k;
                    });
                    const capSummary = Object.entries(capCountMap)
                      .sort((a, b) => Number(a[0]) - Number(b[0]))
                      .map(([k, count]) => `${k} KVA (${count})`)
                      .join(', ');

                    // Check inspection date
                    const inspDate = latestJobDate(jobsForMr, 'externalInspectionDate');
                    const isDone = isMrExternalComplete(jobsForMr, inspections);
                    const inspectedCount = jobsForMr.filter(j => isJobExternallyDone(j, inspections)).length;

                    return (
                    <React.Fragment key={mr}>
                    <tr className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-3 text-center font-mono font-bold text-xs text-slate-400">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-mono font-bold text-slate-900 text-sm">{mr}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                          <span>MR Date:</span>
                          <span className="font-mono text-slate-700 font-semibold">{mrDateStr}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 uppercase">
                          {sampleJob?.division || '-'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <div className="font-medium text-slate-800">{capSummary}</div>
                        <div className="text-[11px] text-blue-600 font-bold font-mono mt-0.5">Total: {totalKva} KVA</div>
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        <span className="font-mono font-bold text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-100">
                          {jobsForMr.length} {jobsForMr.length === 1 ? 'Unit' : 'Units'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500 max-w-[200px] truncate" title={jobsForMr.map(j => j.jobNo).join(', ')}>
                        <span className="font-mono text-slate-700 font-medium">
                          {jobsForMr.map(j => j.jobNo).join(', ')}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        {isDone ? (
                          <div className="inline-flex flex-col items-center">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-green-50 text-green-700 border border-green-200">
                              <CheckCircle2 className="w-3 h-3 text-green-600" /> Completed
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono mt-0.5">
                              {inspectedCount} of {jobsForMr.length} inspected
                            </span>
                            {inspDate && (
                              <span className="text-[10px] text-slate-500 font-mono mt-0.5">
                                Date: {formatDDMMYYYY(inspDate)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="inline-flex flex-col items-center">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              Pending
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono mt-0.5">
                              {inspectedCount} of {jobsForMr.length} inspected
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <button 
                            onClick={() => handleSelectMr(mr)}
                            className="flex items-center px-3 py-1.5 text-xs font-bold bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors shadow-2xs cursor-pointer"
                          >
                            {statusFilter === 'Pending' ? 'Inspect MR' : 'Edit Inspection Report'} <ArrowLeft className="w-3.5 h-3.5 ml-1 rotate-180" />
                          </button>
                          {statusFilter === 'Completed' && (
                            <button 
                              onClick={() => {
                                handleSelectMr(mr);
                                setIsPrintOpen(true);
                              }}
                              className="flex items-center px-3 py-1.5 text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 rounded border border-slate-200 transition-colors cursor-pointer"
                              title="Print External Inspection Report"
                            >
                              <Printer className="w-3.5 h-3.5 mr-1 text-slate-600" /> Print
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    </React.Fragment>
                    );
                  })}
                  {filteredMrNos.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                        No {statusFilter.toLowerCase()} MR numbers found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-wrap justify-between items-center text-white shadow-md print:hidden gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-widest bg-blue-600/30 text-blue-300 px-2 py-0.5 rounded border border-blue-500/30">
                  External Inspection
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  Division: <strong className="text-white uppercase">{mrJobs[0]?.division || '-'}</strong>
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <p className="text-xl font-mono font-bold text-white tracking-tight">MR No: {selectedMrNo}</p>
                <span className="text-xs bg-slate-800 text-slate-300 font-mono px-2.5 py-1 rounded border border-slate-700">
                  MR Date: <strong className="text-white">({formatDDMMYYYY(mrJobs[0]?.dateOfIssue || mrJobs[0]?.mrDate || mrJobs[0]?.createdAt)})</strong>
                </span>
                <span className="text-xs bg-blue-950 text-blue-200 font-semibold px-2.5 py-1 rounded border border-blue-800">
                  {mrJobs.length} Transformers • {mrJobs.reduce((acc, j) => acc + (Number(j.capacityKva) || 0), 0)} Total KVA
                </span>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="flex items-center bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-2">
                  INSP. DATE:
                </label>
                <input
                  type="date"
                  value={externalInspectionDate}
                  onChange={(e) => setExternalInspectionDate(e.target.value)}
                  className="bg-slate-900 text-white font-mono text-xs px-2 py-1 rounded border border-slate-600 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                />
              </div>

              <button
                type="button"
                onClick={handleExportExcel}
                className="flex items-center text-xs font-bold text-green-400 hover:text-green-300 bg-green-950/40 border border-green-500/30 px-3 py-2 rounded-lg transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 mr-1.5" /> Excel
              </button>
              <button 
                type="button"
                onClick={handlePrint}
                className="flex items-center text-xs font-bold text-slate-300 hover:text-white bg-slate-800 border border-slate-700 px-3 py-2 rounded-lg transition-colors cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 mr-1.5" /> Print
              </button>
              <button 
                onClick={() => setSelectedMrNo(null)}
                className="text-xs font-bold text-slate-300 hover:text-white bg-slate-800 border border-slate-700 px-3 py-2 rounded-lg transition-colors cursor-pointer"
              >
                Back to List
              </button>
            </div>
          </div>

          {mrJobs.some(j => j.repairType === 'GP') && (
            <div className="bg-amber-50 border-l-4 border-amber-500 p-3 rounded-lg text-amber-950 text-xs flex items-center justify-between shadow-2xs print:hidden">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  <strong>GP (Guarantee Period) Jobs Detected:</strong> Standard oil capacities (140L for ≤16KVA, 184L for 25KVA, 240L for 63KVA, 323L for 100KVA, etc.) and full oil level (0 Less Oil) have been automatically initialized.
                </span>
              </div>
            </div>
          )}

          <div className="bg-blue-50 border-l-4 border-blue-500 p-3 rounded text-blue-950 text-xs flex items-center justify-between gap-2 shadow-sm print:hidden">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm">💡 Estimate Master Linkage:</span>
              <span>Verify the <strong>Transformer Type / Core</strong> (CRGO, Amorphous, Wound Core, LSTC, OH) and <strong>Rating / Level</strong>. Any manual change from MR intake triggers an alert to confirm finalizing the change across the entire job cycle.</span>
            </div>
          </div>

          <div className="bg-white rounded shadow-sm border border-slate-200 overflow-x-auto print:border-none print:shadow-none print:overflow-visible">
            <form onSubmit={handleSubmit}>
              <div className="min-w-max">
                <table className="w-full text-left print:text-black print:text-[8px] border-collapse">
                  <thead>
                    {/* Top Grouped Header Row */}
                    <tr className="border-b border-slate-200">
                      <th className="p-2 bg-slate-50 text-[10px] font-bold text-slate-600 uppercase tracking-wider sticky left-0 z-20 w-8 border-r border-slate-200" rowSpan={2}>#</th>
                      <th className="p-2 bg-slate-50 text-[10px] font-bold text-slate-600 uppercase tracking-wider sticky left-8 z-20 min-w-[100px] border-r border-slate-200" rowSpan={2}>JOB NO</th>
                      <th className="p-2 bg-slate-50 text-[10px] font-bold text-slate-600 uppercase tracking-wider min-w-[90px] border-r border-slate-200" rowSpan={2}>TRANS. S.NO</th>
                      <th className="p-2 bg-slate-50 text-[10px] font-bold text-slate-600 uppercase tracking-wider min-w-[70px] border-r border-slate-200" rowSpan={2}>MAKE</th>
                      <th className="p-2 bg-slate-50 text-[10px] font-bold text-slate-600 uppercase tracking-wider min-w-[50px] border-r border-slate-200 text-center" rowSpan={2}>KVA</th>
                      
                      {/* Transformer Type / Core dropdown column */}
                      <th className="p-2 bg-indigo-50/80 text-[10px] font-bold text-indigo-950 uppercase tracking-wider min-w-[140px] border-r border-slate-200 text-center" rowSpan={2}>
                        <div className="flex items-center justify-center gap-1">
                          <Cpu className="w-3.5 h-3.5 text-indigo-600" />
                          <span>TYPE / CORE</span>
                        </div>
                      </th>

                      {/* Rating / Star Level beside KVA */}
                      <th className="p-2 bg-blue-50/80 text-[10px] font-bold text-blue-900 uppercase tracking-wider min-w-[170px] border-r border-slate-200 text-center" rowSpan={2}>
                        <div className="flex items-center justify-center gap-1">
                          <Scale className="w-3.5 h-3.5 text-blue-600" />
                          <span>RATING / LEVEL (Clause 4.0)</span>
                        </div>
                      </th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[45px] border-r border-slate-200 text-center" rowSpan={2}>KV</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[55px] border-r border-slate-200 text-center" rowSpan={2}>OIL<br/>CAP (L)</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[55px] border-r border-slate-200 text-center" rowSpan={2}>LESS<br/>OIL (L)</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[50px] border-r border-slate-200 text-center" rowSpan={2}>SEAL<br/>TYPE</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[45px] border-r border-slate-200 text-center" rowSpan={2}>GAS<br/>KET</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[45px] border-r border-slate-200 text-center" rowSpan={2}>HV/LV<br/>ROD</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[45px] border-r border-slate-200 text-center" rowSpan={2}>NUT/<br/>BOLT</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[45px] border-r border-slate-200 text-center" rowSpan={2}>DRY<br/>ACT</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[45px] border-r border-slate-200 text-center" rowSpan={2}>CLN<br/>TANK</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[45px] border-r border-slate-200 text-center" rowSpan={2}>BRE<br/>ATHER</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[45px] border-r border-slate-200 text-center" rowSpan={2}>OIL<br/>LEV</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[45px] border-r border-slate-200 text-center" rowSpan={2}>OUT<br/>PAINT</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[45px] border-r border-slate-200 text-center" rowSpan={2}>NAME<br/>PLT</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[50px] border-r border-slate-200 text-center" rowSpan={2} title="Damage Conservator (Damaged Conservator Tank)">DAM<br/>CT</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[50px] border-r-2 border-blue-400 text-center" rowSpan={2} title="Damage Radiator (Damaged Radiator fins/pipes)">DAM<br/>RAD</th>
                      
                      {/* HV SIDE GROUP WITH DISTINCT OUTER BORDER */}
                      <th className="p-1.5 bg-blue-100 text-[10px] font-black text-blue-950 uppercase tracking-wider text-center border-t-2 border-l-2 border-r-2 border-blue-500 shadow-xs" colSpan={3}>
                        HV SIDE (B / M / CC)
                      </th>
                      
                      {/* LV SIDE GROUP WITH DISTINCT OUTER BORDER */}
                      <th className="p-1.5 bg-indigo-100 text-[10px] font-black text-indigo-950 uppercase tracking-wider text-center border-t-2 border-l-2 border-r-2 border-indigo-500 shadow-xs" colSpan={3}>
                        LV SIDE (B / M / CC)
                      </th>
                      
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[50px] border-r border-slate-200 text-center" rowSpan={2}>OIL<br/>AVL</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[50px] text-center" rowSpan={2}>NET<br/>SHRT</th>
                    </tr>

                    {/* Sub-Headers for HV and LV Bushing/Metal/Cap */}
                    <tr className="border-b border-slate-300 text-[9px]">
                      {/* HV Sub-columns */}
                      <th className="p-1 bg-blue-50 text-blue-900 font-bold text-center border-l-2 border-r border-b-2 border-blue-500 min-w-[44px]" title="HV Bushing">
                        B (Bush)
                      </th>
                      <th className="p-1 bg-blue-50 text-blue-900 font-bold text-center border-r border-b-2 border-blue-500 min-w-[44px]" title="HV Metal Parts">
                        M (Metal)
                      </th>
                      <th className="p-1 bg-blue-50 text-blue-900 font-bold text-center border-r-2 border-b-2 border-blue-500 min-w-[44px]" title="HV Bushing Cap / Connector">
                        CC (Cap)
                      </th>
                      
                      {/* LV Sub-columns */}
                      <th className="p-1 bg-indigo-50 text-indigo-900 font-bold text-center border-l-2 border-r border-b-2 border-indigo-500 min-w-[44px]" title="LV Bushing">
                        B (Bush)
                      </th>
                      <th className="p-1 bg-indigo-50 text-indigo-900 font-bold text-center border-r-2 border-b-2 border-indigo-500 min-w-[44px]" title="LV Metal Parts">
                        M (Metal)
                      </th>
                      <th className="p-1 bg-indigo-50 text-indigo-900 font-bold text-center border-r-2 border-b-2 border-indigo-500 min-w-[44px]" title="LV Bushing Cap / Connector">
                        CC (Cap)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {mrJobs.map((job, index) => {
                      const oilCap = Number(formsData[job.id]?.oilCapLtrs) || 0;
                      const lessOil = Number(formsData[job.id]?.lessOilLtrs) || 0;
                      const oilAvl = oilCap - lessOil;
                      const netShrt = Math.round((oilAvl * 0.05) + lessOil);
                      const currentChosenCore = formsData[job.id]?.transType || job.coreType || 'CRGO';
                      const isModifiedFromMr = currentChosenCore !== (job.coreType || 'CRGO');

                      return (
                      <tr key={job.id} className="hover:bg-slate-50/80 transition-colors group">
                        <td className="p-2 text-xs font-mono text-slate-500 sticky left-0 bg-white group-hover:bg-slate-50 border-r border-slate-200 z-10 text-center font-bold">
                          {index + 1}
                        </td>
                        <td className="p-2 text-xs font-mono font-bold sticky left-8 bg-white group-hover:bg-slate-50 border-r border-slate-200 min-w-[100px] z-10">
                          <div className="flex items-center gap-1.5">
                            <span className={matchesGpFilter(job, 'GP') ? GP_TEXT_CLASS : 'text-slate-900'}>{job.jobNo}</span>
                            {matchesGpFilter(job, 'GP') && <GpChip />}
                          </div>
                        </td>
                        <td className="p-2 text-xs font-mono font-medium text-slate-700 min-w-[90px] border-r border-slate-200">
                          {job.serialNo || '-'}
                        </td>
                        <td className="p-2 text-xs text-slate-800 font-semibold min-w-[70px] truncate max-w-[90px] border-r border-slate-200" title={job.make}>
                          {job.make}
                        </td>
                        <td className="p-2 text-xs text-slate-900 font-mono font-bold text-center border-r border-slate-200">
                          {job.capacityKva}
                        </td>

                        {/* Transformer Type / Core dropdown column with modification alert trigger */}
                        <td className="p-1 border-r border-slate-200 bg-indigo-50/20">
                          <select
                            value={currentChosenCore}
                            onChange={(e) => handleCoreTypeChangeAttempt(job, e.target.value)}
                            className={`w-full px-2 py-1 text-xs font-bold border rounded focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-white cursor-pointer shadow-2xs ${
                              isModifiedFromMr 
                                ? 'border-amber-500 text-amber-950 ring-1 ring-amber-400 bg-amber-50/40' 
                                : 'border-indigo-300 text-indigo-950'
                            }`}
                          >
                            {TRANSFORMER_CORE_TYPES.map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                          {isModifiedFromMr && (
                            <span className="text-[8px] font-bold text-amber-800 bg-amber-100/80 px-1 py-0.5 rounded block text-center mt-0.5 border border-amber-300" title={`Original MR Intake: ${job.coreType || 'CRGO'}`}>
                              ⚠️ Modified (MR: {job.coreType || 'CRGO'})
                            </span>
                          )}
                        </td>
                        
                        {/* Rating Level selector directly beside KVA */}
                        <td className="p-1 border-r border-slate-200 bg-blue-50/20">
                          <select
                            value={formsData[job.id]?.starRating || '3 Star & other'}
                            onChange={(e) => handleChange(job.id, 'starRating', e.target.value)}
                            className="w-full px-2 py-1 text-xs font-bold border border-blue-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white text-blue-950 cursor-pointer shadow-2xs"
                          >
                            {RATING_LEVEL_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </td>

                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderInputField(job.id, 'kv', 'text', 'w-12')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderIntegerField(job.id, 'oilCapLtrs', 'w-14')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderIntegerField(job.id, 'lessOilLtrs', 'w-14')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderSelectField(job.id, 'sealType', ['BL', 'SL'], 'w-14')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderIntegerField(job.id, 'gasket', 'w-12', '1')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderIntegerField(job.id, 'hvLvRod', 'w-12', '7')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderSelectField(job.id, 'nuteBolt', ['Y', 'N', '-', 'TBR'], 'w-12')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderSelectField(job.id, 'dryActPart', ['Y', 'N', '-', 'TBR'], 'w-12')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderSelectField(job.id, 'clnDrtyTank', ['Y', 'N', '-', 'TBR'], 'w-12')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderSelectField(job.id, 'breather', ['Y', 'N', '-', 'TBR'], 'w-12')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderSelectField(job.id, 'oilLevGls', ['Y', 'N', '-', 'TBR'], 'w-12')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderSelectField(job.id, 'outsidePaint', ['Y', 'N', '-', 'TBR'], 'w-12')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderSelectField(job.id, 'namePlate', ['-', 'Y', 'N', 'TBR'], 'w-12')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderIntegerField(job.id, 'damCtTank', 'w-12', '0')}
                        </td>
                        <td className="p-1 border-r-2 border-blue-400 text-center">
                          {renderIntegerField(job.id, 'damRadNo', 'w-12', '0')}
                        </td>
                        
                        {/* HV Side Grouped with distinct border */}
                        <td className="p-1 bg-blue-50/30 border-l-2 border-r border-blue-500 text-center">
                          {renderIntegerField(job.id, 'hvSideHvb', 'w-12', '3', 3)}
                        </td>
                        <td className="p-1 bg-blue-50/30 border-r border-blue-500 text-center">
                          {renderIntegerField(job.id, 'hvSideHvm', 'w-12', '3', 3)}
                        </td>
                        <td className="p-1 bg-blue-50/30 border-r-2 border-blue-500 text-center">
                          {renderIntegerField(job.id, 'hvSideHvCc', 'w-12', '3', 3)}
                        </td>
                        
                        {/* LV Side Grouped with distinct border */}
                        <td className="p-1 bg-indigo-50/30 border-l-2 border-r border-indigo-500 text-center">
                          {renderIntegerField(job.id, 'lvSideLvb', 'w-12', '4', 4)}
                        </td>
                        <td className="p-1 bg-indigo-50/30 border-r border-indigo-500 text-center">
                          {renderIntegerField(job.id, 'lvSideLvm', 'w-12', '4', 4)}
                        </td>
                        <td className="p-1 bg-indigo-50/30 border-r-2 border-indigo-500 text-center">
                          {renderIntegerField(job.id, 'lvSideLvCc', 'w-12', '4', 4)}
                        </td>
                        
                        <td className="p-1 text-xs font-mono font-bold text-slate-800 bg-slate-50 text-center border-r border-slate-200">
                          {oilAvl >= 0 ? Math.round(oilAvl) : '-'}
                        </td>
                        <td className="p-1 text-xs font-mono font-bold text-amber-700 bg-amber-50/50 text-center">
                          {netShrt >= 0 ? Math.round(netShrt) : '-'}
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
              
              <div className="p-6 bg-slate-50 print:bg-transparent border-t border-slate-200 flex justify-between items-center print:hidden">
                <div className="text-xs text-slate-500">
                  Total Transformers: <strong className="text-slate-800 font-mono">{mrJobs.length}</strong>
                </div>
                <button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="px-8 py-3 text-sm font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center shadow-sm cursor-pointer"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  <Save className="w-4 h-4 mr-2" /> Save All {mrJobs.length} Inspections
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
