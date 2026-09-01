import React, { useState, useEffect, useMemo } from 'react';
import { useAgency, getCircleLimitsEstimateMaster } from '../lib/AgencyContext';
import { CARD, CARD_PAD, NUM } from '../lib/ui';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { Wrench, Search, Loader2, ArrowLeft, Save, Download, Printer, Cpu, Zap, CheckCircle2, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { formatDDMMYYYY, byDateDesc, byNumericDesc } from '../lib/utils';
import { GP_TEXT_CLASS, GpChip, GP_FILTER_OPTIONS, matchesGpFilter, GpFilter } from '../lib/jobDisplay';
import { PrintableA4Page } from './LetterheadHeader';
import { classifyCoreType } from './SingleJobEstimateReport';
import SetupGapDialog, { SetupGap } from './SetupGapDialog';
import { triggerUniversalPrint } from '../lib/printUtils';
import { isJobInternallyDone, isMrInternalComplete, isJobExternallyDone, isMrExternalComplete, latestJobDate } from '../lib/inspectionStage';
import { getJobFullEstimate, checkJobCircleLimit } from '../lib/estimateCalc';
import { atForJob, matchesAtScope } from '../lib/AgencyContext';
import { OtherTenderNote } from './OtherTenderNote';

export interface InternalData {
  windingType: string;
  hvCoilLimb: string;
  damR: string;
  damY: string;
  damB: string;
  totCoil: string;
  wtOfCoil: string;
  totWt: string;
  lvCoilR: string;
  lvCoilY: string;
  lvCoilB: string;
  wtOfCoilLv: string;
  totWtLv: string;
  /**
   * Weight of coils marked RI, kept separate from totWtLv (which is DAM only).
   *
   * They are different ITEMS at different rates - Schedule-A 13A replacement at Rs 149/kg
   * against item 14 re-insulation at Rs 115/kg - so one number cannot carry both. It used
   * to: `badCount` counted anything not OK, so a re-insulated coil was billed as a
   * replacement.
   */
  totWtLvReIns: string;
  wasring: string;
  inPnt: string;
  tstTrn: string;
  dc: string;
  insula: string;
  inspectionId?: string;
  condition?: string;
}

export default function InternalInspection() {
  const { activeAgency, activeAtMaster, atMasters, viewingAllTenders } = useAgency();
  const [jobs, setJobs] = useState<any[]>([]);
  const [inspections, setInspections] = useState<any[]>([]); // Internal-type only
  const [externalInspections, setExternalInspections] = useState<any[]>([]);

  /**
   * ⚠ THE SCOPE IS APPLIED HERE, NOT AT THE QUERY (AUDIT F99). This screen fetches jobs on
   * mount AND after a save; filtering where the list is built leaves one place to get right
   * instead of two, and the second is the one that produces a list correct on load and wrong
   * after a save. The same agency-wide read also answers "how much is out of scope" for the
   * note, with no extra round trip.
   */
  const scopedJobs = useMemo(
    () => jobs.filter(j => matchesAtScope(j, activeAtMaster, viewingAllTenders)),
    [jobs, activeAtMaster, viewingAllTenders],
  );

  /** Pending INTERNAL inspections under a different tender: externally done, internally not. */
  const otherTenderPending = useMemo(() => {
    if (viewingAllTenders) return 0;
    return jobs.filter(j =>
      !matchesAtScope(j, activeAtMaster, viewingAllTenders) &&
      j.status !== 'Cancelled' && !j.isCancelled && j.mrStatus !== 'Cancelled' &&
      isJobExternallyDone(j, externalInspections) &&
      !isJobInternallyDone(j, inspections)).length;
  }, [jobs, inspections, externalInspections, activeAtMaster, viewingAllTenders]);
  const [loading, setLoading] = useState(true);
  
  const [selectedMrNo, setSelectedMrNo] = useState<string | null>(null);
  const [internalInspectionDate, setInternalInspectionDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [formsData, setFormsData] = useState<Record<string, InternalData>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [divisionFilter, setDivisionFilter] = useState<string>('All');
  const [gpFilter, setGpFilter] = useState<GpFilter>('All');
  
  const [statusFilter, setStatusFilter] = useState<'Pending' | 'Completed'>('Pending');
  /** Blocking setup gap awaiting the operator's decision - see SetupGapDialog. */
  const [setupGap, setSetupGap] = useState<SetupGap | null>(null);

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
        const [jobsSnap, inspSnap, extInspSnap] = await Promise.all([
          getDocs(jobsQ),
          getDocs(query(
            collection(db, 'inspections'),
            where('ownerId', '==', auth.currentUser.uid),
            where('type', '==', 'Internal')
          )),
          getDocs(query(
            collection(db, 'inspections'),
            where('ownerId', '==', auth.currentUser.uid),
            where('type', '==', 'External')
          ))
        ]);

        setJobs(jobsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
        setInspections(inspSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setExternalInspections(extInspSnap.docs.map(d => ({ id: d.id, ...d.data() })));
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
    jobsForMr.sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));

    const sampleJob = jobsForMr[0];
    const internalInsps = allInspections.filter(i => i.type === 'Internal');
    const existingSampleInsp = internalInsps.find(i => jobsForMr.some(j => j.id === i.jobId));
    
    // Pick saved internalInspectionDate if already recorded, or default to current date
    const initialDate = sampleJob?.internalInspectionDate || existingSampleInsp?.data?.inspectionDate || new Date().toISOString().split('T')[0];
    setInternalInspectionDate(initialDate);

    const initialForms: Record<string, InternalData> = {};
    jobsForMr.forEach(j => {
      const existingInsp = internalInsps.find(i => i.jobId === j.id);
      
      if (existingInsp && existingInsp.data) {
        const damR = existingInsp.data.damR || '';
        const damY = existingInsp.data.damY || '';
        const damB = existingInsp.data.damB || '';
        const wtOfCoil = existingInsp.data.wtOfCoil || '';
        const lvCoilR = existingInsp.data.lvCoilR || 'OK';
        const lvCoilY = existingInsp.data.lvCoilY || 'OK';
        const lvCoilB = existingInsp.data.lvCoilB || 'OK';
        const wtOfCoilLv = existingInsp.data.wtOfCoilLv || '';

        // totCoil/totWt/totWtLv are now read-only in the UI, so a legacy record
        // whose stored value was manually overwritten before that would otherwise
        // be frozen wrong with no way to fix it - recompute from the same inputs
        // used everywhere else instead of trusting what's stored.
        const r = parseInt(damR || '0', 10);
        const y = parseInt(damY || '0', 10);
        const b = parseInt(damB || '0', 10);
        const recomputedTotCoil = ((!isNaN(r) ? r : 0) + (!isNaN(y) ? y : 0) + (!isNaN(b) ? b : 0)) + '';
        const recomputedTotWt = ((Number(recomputedTotCoil) || 0) * (Number(wtOfCoil) || 0)).toFixed(2);

        const damCountLv = [lvCoilR, lvCoilY, lvCoilB].filter(v => v === 'DAM').length;
        const riCountLv = [lvCoilR, lvCoilY, lvCoilB].filter(v => v === 'RI').length;
        const recomputedTotWtLv = (damCountLv * (Number(wtOfCoilLv) || 0)).toFixed(2);
        const recomputedTotWtLvReIns = (riCountLv * (Number(wtOfCoilLv) || 0)).toFixed(2);

        if (existingInsp.data.totCoil !== undefined && Number(existingInsp.data.totCoil) !== Number(recomputedTotCoil)) {
          console.log(`Internal inspection totCoil mismatch for job ${j.jobNo}: stored=${existingInsp.data.totCoil}, recomputed=${recomputedTotCoil}`);
        }
        if (existingInsp.data.totWt !== undefined && Number(existingInsp.data.totWt) !== Number(recomputedTotWt)) {
          console.log(`Internal inspection totWt mismatch for job ${j.jobNo}: stored=${existingInsp.data.totWt}, recomputed=${recomputedTotWt}`);
        }
        if (existingInsp.data.totWtLv !== undefined && Number(existingInsp.data.totWtLv) !== Number(recomputedTotWtLv)) {
          console.log(`Internal inspection totWtLv mismatch for job ${j.jobNo}: stored=${existingInsp.data.totWtLv}, recomputed=${recomputedTotWtLv}`);
        }

        initialForms[j.id] = {
          windingType: existingInsp.data.windingType || 'AL',
          condition: existingInsp.data.condition || 'Repairable',
          hvCoilLimb: existingInsp.data.hvCoilLimb || '4',
          damR,
          damY,
          damB,
          totCoil: recomputedTotCoil,
          wtOfCoil,
          totWt: recomputedTotWt,
          lvCoilR,
          lvCoilY,
          lvCoilB,
          wtOfCoilLv,
          totWtLv: recomputedTotWtLv,
          totWtLvReIns: recomputedTotWtLvReIns,
          wasring: existingInsp.data.wasring || '6',
          // 'N', not '-'. Every sibling flag on this row defaults to 'Y' or 'N'; only this
          // one defaulted to '-', which the selector offers FIRST, so it was what an
          // untouched form carried. Combined with the old "anything not N charges" test
          // that made Inside Painting the one item billed by default on a job nobody had
          // inspected. Charging is now affirmative-only (F46), so the default no longer
          // decides money - but a default that means "not applicable" is still the wrong
          // resting state for a field whose real answer is yes or no.
          inPnt: existingInsp.data.inPnt || 'N',
          tstTrn: existingInsp.data.tstTrn || 'Y',
          dc: existingInsp.data.dc || 'Y',
          insula: existingInsp.data.insula || 'Y',
          inspectionId: existingInsp.id
        };
      } else {
        initialForms[j.id] = {
          windingType: 'AL',
          condition: 'Repairable',
          hvCoilLimb: '4',
          damR: '',
          damY: '',
          damB: '',
          totCoil: '',
          wtOfCoil: '',
          totWt: '',
          lvCoilR: 'OK',
          lvCoilY: 'OK',
          lvCoilB: 'OK',
          wtOfCoilLv: '',
          totWtLv: '',
          totWtLvReIns: '',
          wasring: '6',
          inPnt: 'N',
          tstTrn: 'Y',
          dc: 'Y',
          insula: 'Y'
        };
      }
    });

    setFormsData(initialForms);
    setSelectedMrNo(mrNo);
  };

  const handleChange = (jobId: string, field: keyof InternalData, value: string) => {
    setFormsData(prev => {
      const current = { ...prev[jobId], [field]: value };
      
      // Auto-calculate Tot Wt for HV if we have both coil and weight
      if (['damR', 'damY', 'damB', 'wtOfCoil', 'totCoil'].includes(field)) {
        if (['damR', 'damY', 'damB'].includes(field)) {
           const r = parseInt(current.damR || '0', 10);
           const y = parseInt(current.damY || '0', 10);
           const b = parseInt(current.damB || '0', 10);
           current.totCoil = (!isNaN(r) ? r : 0) + (!isNaN(y) ? y : 0) + (!isNaN(b) ? b : 0) + '';
        }
        const tCoil = Number(current.totCoil) || 0;
        const wCoil = Number(current.wtOfCoil) || 0;
        current.totWt = (tCoil * wCoil).toFixed(2);
      }

      // Auto-calculate Tot Wt for LV based on damaged coils
      if (['lvCoilR', 'lvCoilY', 'lvCoilB', 'wtOfCoilLv'].includes(field)) {
        // Two weights, not one. DAM drives replacement (Schedule-A 13A, Rs 149/kg); RI
        // drives re-insulation (item 14, Rs 115/kg). Collapsing them into a single
        // "not OK" count billed every re-insulated coil at the replacement rate.
        const states = [current.lvCoilR, current.lvCoilY, current.lvCoilB];
        const wLv = Number(current.wtOfCoilLv) || 0;
        current.totWtLv = (states.filter(v => v === 'DAM').length * wLv).toFixed(2);
        current.totWtLvReIns = (states.filter(v => v === 'RI').length * wLv).toFixed(2);
      }

      return {
        ...prev,
        [jobId]: current
      };
    });
  };

  const mrJobs = useMemo(() => {
    if (!selectedMrNo) return [];
    return scopedJobs.filter(j => j.mrNo === selectedMrNo).sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));
  }, [scopedJobs, selectedMrNo]);

  // Agency's configured "Circle Authority Estimate Approval Limit" master, for the
  // live Clause 4.0 indicator below - resolved once per agency, not per job.
  const circleLimitsData = useMemo(() => getCircleLimitsEstimateMaster(activeAgency), [activeAgency]);

  const handleExportExcel = () => {
    if (!selectedMrNo) return;
    const sampleJob = mrJobs[0];
    const mrDateStr = formatDDMMYYYY(sampleJob?.dateOfIssue || sampleJob?.mrDate || sampleJob?.createdAt);
    const extInspDate = latestJobDate(mrJobs, 'externalInspectionDate') || '-';
    
    const wsData = [
      ['INTERNAL INSPECTION & COIL DAMAGE ASSESSMENT REPORT'],
      ['Agency:', activeAgency?.name || '', 'Division:', sampleJob?.division || '', 'MR Number:', selectedMrNo, 'MR Date:', mrDateStr, 'Ext. Insp Date:', extInspDate, 'Int. Insp Date:', internalInspectionDate],
      [],
      [
        '#',
        'JOB NO',
        'TRANS. SR. NO',
        'MAKE',
        'DIVISION',
        'MR NO',
        'MR DATE',
        'KVA',
        'TYPE / CORE',
        'EXT. INSP DATE',
        'INT. INSP DATE',
        'WIND',
        'HV LIMB',
        'DAMAGED HV COIL R',
        'DAMAGED HV COIL Y',
        'DAMAGED HV COIL B',
        'TOT COIL (HT)',
        'WT/COIL (KG) HT',
        'TOT WT (HT)',
        'LV COIL R',
        'LV COIL Y',
        'LV COIL B',
        'WT/COIL (KG) LT',
        'TOT WT (LT)',
        'WAS RING',
        'IN PNT',
        'TST TRN',
        'DC',
        'INSULA',
        'CONDITION'
      ]
    ];
    
    mrJobs.forEach((job, index) => {
      const data = formsData[job.id] || {} as InternalData;
      wsData.push([
        index + 1,
        job.jobNo + (job.repairType === 'GP' ? ' (GP)' : ''),
        job.serialNo || '-',
        job.make || '-',
        job.division || '-',
        job.mrNo,
        mrDateStr,
        job.capacityKva,
        job.coreType || 'CRGO',
        job.externalInspectionDate || extInspDate,
        internalInspectionDate,
        data.windingType || 'AL',
        data.hvCoilLimb || '4',
        data.damR || '0',
        data.damY || '0',
        data.damB || '0',
        data.totCoil || '0',
        data.wtOfCoil || '0',
        data.totWt || '0',
        data.lvCoilR || 'OK',
        data.lvCoilY || 'OK',
        data.lvCoilB || 'OK',
        data.wtOfCoilLv || '0',
        data.totWtLv || '0',
        data.wasring || '6',
        data.inPnt || '-',
        data.tstTrn || 'Y',
        data.dc || 'Y',
        data.insula || 'Y',
        data.condition || 'Repairable'
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Internal Inspection");
    XLSX.writeFile(wb, `Internal_Inspection_MR_${selectedMrNo}.xlsx`);
  };

  const handlePrint = () => {
    setIsPrintOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !selectedMrNo) return;

    // Enforce the cycle: internal inspection cannot save for a job until it's
    // genuinely externally done. The Inspect/Edit button is disabled for this
    // already, but that's not enforcement by itself - guard the write too, in case
    // this form is reached another way.
    const notExternallyDone = mrJobs
      .filter(job => !isJobExternallyDone(job, externalInspections))
      .map(job => job.jobNo);
    if (notExternallyDone.length > 0) {
      alert(`⚠️ External inspection is not complete for: ${notExternallyDone.join(', ')}.\n\nInternal inspection cannot be saved until every job in this MR has been externally inspected.`);
      return;
    }

    // Damaged HV coil counts (damR/damY/damB) cannot exceed the job's HV coil limb
    // count - there is no such thing as more damaged coils on a phase than the
    // number of coils it has. The inputs already reject an over-limit entry as it's
    // typed, but a legacy record saved before that limit existed could still carry
    // one through unchanged - catch that here too.
    const limbRangeErrors: string[] = [];
    for (const job of mrJobs) {
      if (job.status === 'Dispatched' || job.isClosed === true) continue;
      const jobData = formsData[job.id];
      if (!jobData) continue;
      const limbRaw = jobData.hvCoilLimb;
      const limbMax = limbRaw !== undefined && limbRaw.trim() !== '' && !isNaN(Number(limbRaw)) ? Number(limbRaw) : undefined;
      if (limbMax === undefined) continue;

      const checks: Array<[string, string | undefined]> = [
        ['Damaged HV Coil R', jobData.damR],
        ['Damaged HV Coil Y', jobData.damY],
        ['Damaged HV Coil B', jobData.damB],
      ];
      for (const [label, value] of checks) {
        if (value !== undefined && value.trim() !== '' && Number(value) > limbMax) {
          limbRangeErrors.push(`${job.jobNo}: ${label} cannot exceed ${limbMax}.`);
        }
      }
    }
    if (limbRangeErrors.length > 0) {
      alert(`⚠️ Value out of range:\n\n${limbRangeErrors.join('\n')}`);
      return;
    }

    // Catch jobs where nothing appears to have actually been reviewed. The existing
    // check below only requires HV coil weight when damage was actually recorded
    // against that job (damR/damY/damB > 0) - a job left entirely at its blank
    // defaults (no damage, no weight, condition still 'Repairable') passes it
    // trivially without anyone having looked. Coil/winding weight, a recorded
    // per-phase damage note, or an explicit Scrap decision are the only fields that
    // genuinely default to blank, so require at least one of them.
    const emptyJobs = mrJobs
      .filter(job => !(job.status === 'Dispatched' || job.isClosed === true))
      .filter(job => {
        // Amorphous/Wound Core is fixed-rate and never uses coil weight data (see the
        // isAmorphousOrWound exemption in the validation below), so this check simply
        // doesn't apply to them - don't flag them here.
        const coreTypeUpper = (job.coreType || '').toUpperCase();
        const isAmorphousOrWound = coreTypeUpper.includes('AMORPHOUS') || coreTypeUpper.includes('AM') || coreTypeUpper.includes('WOUND') || coreTypeUpper.includes('WC');
        if (isAmorphousOrWound) return false;

        const jobData = formsData[job.id];
        if (!jobData) return true;
        const hasCoilWeight = [jobData.totWt, jobData.wtOfCoil, jobData.totWtLv, jobData.wtOfCoilLv]
          .some(v => v !== undefined && v !== null && String(v).trim() !== '');
        const hasDamageNote = [jobData.damR, jobData.damY, jobData.damB]
          .some(v => v !== undefined && v !== null && String(v).trim() !== '');
        const isScrapDecision = jobData.condition === 'Scrap';
        return !(hasCoilWeight || hasDamageNote || isScrapDecision);
      })
      .map(job => job.jobNo);

    if (emptyJobs.length > 0) {
      alert(`⚠️ ${emptyJobs.join(', ')} ${emptyJobs.length === 1 ? 'has' : 'have'} no inspection data entered.\n\nPlease review each transformer before saving.`);
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
      if (!jobData.windingType || jobData.windingType.trim() === '') missing.push('Winding Type');
      if (!jobData.condition || jobData.condition.trim() === '') missing.push('Condition (Repairable / Scrap)');
      if (!jobData.wasring || jobData.wasring.trim() === '') missing.push('WAS Ring');
      if (!jobData.inPnt || jobData.inPnt.trim() === '') missing.push('Inside Paint');

      const isAmorphousOrWound = (job.coreType || '').toUpperCase().includes('AMORPHOUS') || (job.coreType || '').toUpperCase().includes('AM') || (job.coreType || '').toUpperCase().includes('WOUND') || (job.coreType || '').toUpperCase().includes('WC');
      if (jobData.condition === 'Repairable' && !isAmorphousOrWound) {
        const totalHvDam = (Number(jobData.damR) || 0) + (Number(jobData.damY) || 0) + (Number(jobData.damB) || 0);
        if (totalHvDam > 0 && (!jobData.wtOfCoil || jobData.wtOfCoil.trim() === '')) {
          missing.push('HV Coil Weight (Kg)');
        }
      }

      if (missing.length > 0) {
        incompleteJobs.push(`Job #${job.jobNo}: Missing (${missing.join(', ')})`);
      }
    }

    if (incompleteJobs.length > 0) {
      alert(`⚠️ Blank or incomplete internal inspection forms are NOT acceptable!\n\nPlease fill in all required inspection details before saving:\n\n${incompleteJobs.join('\n')}`);
      return;
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
        
        const payload = {
          jobId: job.id,
          type: 'Internal',
          inspectionDate: internalInspectionDate,
          data: {
            inspectionDate: internalInspectionDate,
            windingType: jobData.windingType,
            condition: jobData.condition || 'Repairable',
            hvCoilLimb: jobData.hvCoilLimb,
            damR: jobData.damR,
            damY: jobData.damY,
            damB: jobData.damB,
            totCoil: jobData.totCoil,
            wtOfCoil: jobData.wtOfCoil,
            totWt: jobData.totWt,
            lvCoilR: jobData.lvCoilR,
            lvCoilY: jobData.lvCoilY,
            lvCoilB: jobData.lvCoilB,
            wtOfCoilLv: jobData.wtOfCoilLv,
            totWtLv: jobData.totWtLv,
            totWtLvReIns: jobData.totWtLvReIns,
            wasring: jobData.wasring,
            inPnt: jobData.inPnt,
            tstTrn: jobData.tstTrn,
            dc: jobData.dc,
            insula: jobData.insula
          },
          updatedAt: now,
          ownerId: auth.currentUser.uid,
          // Stamped for future agency-scoped queries. Existing records predate this
          // field, so nothing may filter on it until they're backfilled.
          //
          // ⚠ NOT `activeAgency?.id` (AUDIT F99). Optional chaining here writes `undefined`,
          // which Firestore drops - producing an inspection with NO agencyId, invisible to
          // every agency-scoped query and indistinguishable from the pre-backfill records
          // this comment is about. The same shape as an empty-string atId: a value that
          // silently means "belongs to nothing" rather than failing.
          //
          // Safe because the COMPONENT returns early when there is no active agency, so this
          // form cannot be on screen without one - not because this handler checks. If that
          // render guard is ever removed, this line needs its own.
          agencyId: activeAgency.id,
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

        // Update Job Status and internal inspection date
        const jobRef = doc(db, 'jobs', job.id);
        const jobUpdates: any = {
          internalInspectionDate: internalInspectionDate,
          updatedAt: now
        };
        if (job.status === 'External Done' || job.status === 'Received' || job.status === 'Internal Done' || job.status === 'Scrap') {
          jobUpdates.status = jobData.condition === 'Scrap' ? 'Scrap' : 'Internal Done';
        }

        // `condition` records what the unit WAS, not where it is.
        //
        // This field exists because scrap identity used to live only in `status`, and
        // dispatch overwrites status with 'Dispatched' - erasing the fact that a unit
        // was scrap, leaving no way to tell it from a repaired one. Identity must not
        // live in a field that moves. It is written here, at the moment the
        // scrap/repairable decision is declared, and nothing else in the app writes it.
        //
        // Permitted transitions are deliberately ASYMMETRIC:
        //   unset       -> Scrap / Repairable   allowed (first determination)
        //   Repairable  -> Scrap                allowed (discovered late)
        //   Scrap       -> Repairable           NEVER
        //   anything    -> empty / cleared      NEVER
        // Scrap is a terminal determination made with the unit open on the bench: it
        // can be discovered late, but it cannot be undiscovered. A later inspection
        // may find damage that condemns a unit previously called repairable; nothing
        // can un-condemn one that was already opened and found to be scrap.
        const declaredScrap = jobData.condition === 'Scrap';
        if (!job.condition) {
          jobUpdates.condition = declaredScrap ? 'Scrap' : 'Repairable';
        } else if (job.condition !== 'Scrap' && declaredScrap) {
          jobUpdates.condition = 'Scrap';
        }

        batch.update(jobRef, jobUpdates);
      }

      await batch.commit();

      // Refresh data
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
          where('type', '==', 'Internal')
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

  const mrGroups: Record<string, any[]> = {};
  scopedJobs.forEach(j => {
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
  
  const availableDivisions = Array.from(new Set(scopedJobs.map(j => j.division).filter(Boolean))).sort();
  
  const uniqueMrNos = Object.keys(mrGroups).filter(mr => {
    const jobsForMr = mrGroups[mr];
    const isComplete = isMrInternalComplete(jobsForMr, inspections);
    if (statusFilter === 'Completed') {
      return isComplete;
    }
    return !isComplete && jobsForMr.some(j => !inspections.some(i => i.jobId === j.id) && (j.status === 'External Done' || j.status === 'Received' || !j.status));
  }).sort(byDateDesc(mr => mrSortDate(mr), byNumericDesc(mr => mr)));

  const filteredMrNos = uniqueMrNos.filter(mr => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return mr.toLowerCase().includes(q) || mrGroups[mr].some(j => j.jobNo.toLowerCase().includes(q));
  });

  const renderInputField = (jobId: string, field: keyof InternalData, type = 'text', widthClass = 'w-full', step?: string) => (
    <input
      type={type}
      value={formsData[jobId]?.[field] || ''}
      onChange={(e) => handleChange(jobId, field, e.target.value)}
      className={`px-1.5 py-1 text-[10px] font-mono tabular-nums border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white text-slate-800 text-center shadow-2xs ${widthClass}`}
      step={step !== undefined ? step : (type === 'number' ? '0.01' : undefined)}
    />
  );

  const renderIntegerField = (jobId: string, field: keyof InternalData, widthClass = 'w-12', max?: number) => (
    <input
      type="number"
      value={formsData[jobId]?.[field] || ''}
      onChange={(e) => {
        const raw = e.target.value;
        // Reject rather than clamp: a clamped value looks entered, but this one
        // wasn't - the operator typed something out of range and should see that
        // rejection, not a silently substituted number.
        if (max !== undefined && raw !== '' && Number(raw) > max) return;
        handleChange(jobId, field, raw);
      }}
      className={`px-1.5 py-1 text-[10px] font-mono tabular-nums border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white text-slate-800 text-center shadow-2xs ${widthClass}`}
      step="1"
      min="0"
      max={max}
    />
  );

  const renderReadOnlyField = (jobId: string, field: keyof InternalData, widthClass = 'w-16') => (
    <input
      type="text"
      value={formsData[jobId]?.[field] ?? ''}
      readOnly
      disabled
      tabIndex={-1}
      className={`px-1.5 py-1 text-[10px] font-mono tabular-nums border border-slate-200 rounded bg-slate-100 text-slate-500 text-center cursor-not-allowed ${widthClass}`}
    />
  );

  const renderSelectField = (jobId: string, field: keyof InternalData, options: string[], widthClass = 'w-full', title?: string) => (
    <select
      title={title}
      value={formsData[jobId]?.[field] || ''}
      onChange={(e) => handleChange(jobId, field, e.target.value)}
      className={`px-1 py-1 text-[10px] font-bold border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white text-slate-800 text-center shadow-2xs cursor-pointer ${widthClass}`}
    >
      {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  );

  // Live Clause 4.0 Circle Estimate Power Limit indicator - CRGO jobs only (Amorphous
  // / Wound Core are fixed-rate by capacity, so nothing the operator enters here can
  // move the amount; OH cannot realistically approach the limit). Computed from the
  // CURRENT UNSAVED form values, so it reflects what's on the bench right now, not
  // whatever was last saved.
  const renderCircleLimitIndicator = (job: any) => {
    // NOT blank. Amorphous and Wound Core price from Schedule-B at a fixed rate per
    // capacity, so nothing entered on this form can move the amount and there is nothing
    // to check against the circle limit; OH cannot realistically approach it. That is a
    // reason, and an empty cell does not convey a reason - it is indistinguishable from a
    // broken one, which is the ambiguity this audit keeps removing.
    if (classifyCoreType(job.coreType || 'CRGO') !== 'CRGO') {
      return (
        <span className="block text-[9px] font-semibold text-slate-400 italic"
              title="Amorphous and CRGO Wound Core are priced at a fixed rate per capacity from UGVCL Schedule-B, so the circle approval limit is not checked here.">
          Fixed rate - no limit check
        </span>
      );
    }

    const internalDataLive = formsData[job.id];
    if (!internalDataLive) return null;

    const externalDataSaved = externalInspections.find(i => i.jobId === job.id)?.data;

    const est = getJobFullEstimate(job, externalDataSaved, internalDataLive, activeAgency, atForJob(job, atMasters) ?? activeAtMaster);
    const check = checkJobCircleLimit(job, externalDataSaved, internalDataLive, activeAgency, atForJob(job, atMasters) ?? activeAtMaster, circleLimitsData);

    // Never show a figure that rests on missing data. Each case says what is actually
    // missing - "Limit not configured" must mean the limit, nothing else.
    // Ordered by what the operator can act on FIRST, and each message names the thing
    // that is actually missing. "Rate not configured" used to cover both a missing rate
    // and a missing measurement - see EstimateRateError - which sent an operator to the
    // Estimate Master to fix a field on the row in front of them.
    const inputErrors = est.rateErrors.filter(e => e.kind === 'missing-input');
    const rateProblems = est.rateErrors.filter(e => e.kind === 'missing-rate');
    const blockedMessage = !externalDataSaved
      ? 'External inspection missing - cannot estimate'
      : inputErrors.length > 0
        ? (inputErrors.some(e => e.message.includes('Wt of Coil LV'))
            ? 'Enter Wt of Coil LV to estimate'
            : inputErrors.some(e => e.message.includes('Wt of Coil'))
              ? 'Enter Wt of Coil to estimate'
              : 'Inspection incomplete - cannot estimate')
        : !check.hasLimit
          ? 'Limit not configured'
          : rateProblems.length > 0
            ? 'Rate not configured - cannot estimate'
            : null;
    if (blockedMessage) {
      // "Limit not configured" is a setup gap - offer the route, not just the message.
      if (!check.hasLimit && inputErrors.length === 0) {
        return (
          <button
            type="button"
            onClick={() => setSetupGap({
              title: 'Circle approval limit not configured',
              problem: `No Clause 4.0 circle approval limit is recorded for ${job.capacityKva} KVA at "${check.ratingLabel}", so this job cannot be checked against the SE's sanction power.`,
              detail: [
                `Capacity: ${job.capacityKva} KVA`,
                `Rating / voltage class: ${check.ratingLabel}`,
                'Set it under Estimate Master - Circle Authority Estimate Approval Limit.',
              ],
              actionLabel: 'Open Estimate Master',
              actionTo: '/agency-settings?section=estimate-master',
            })}
            className="block text-[9px] font-semibold text-slate-500 italic underline hover:text-slate-800"
            title="Click to set the circle approval limit"
          >
            Limit not configured
          </button>
        );
      }
      // An input problem is the operator's own next action, so it is amber rather than
      // grey - grey reads as "nothing to do here", which is the opposite of the case.
      const isInput = inputErrors.length > 0;
      return (
        <span className={`block text-[9px] font-semibold italic ${isInput ? 'text-amber-700' : 'text-slate-400'}`}
              title={est.rateErrors.map(x => x.message).join('\n') || undefined}>
          {blockedMessage}
        </span>
      );
    }

    const finalRs = Math.round(check.finalAmt).toLocaleString('en-IN');
    const limitRs = Math.round(check.limit).toLocaleString('en-IN');
    const diffRs = Math.round(Math.abs(check.diff)).toLocaleString('en-IN');
    const isRed = check.exceeds;
    const isAmber = !isRed && check.diffPct >= -10;
    const colorClasses = isRed
      ? 'bg-red-50 border-red-300 text-red-800'
      : isAmber
        ? 'bg-amber-50 border-amber-300 text-amber-800'
        : 'bg-green-50 border-green-300 text-green-800';

    // The rating/voltage class defaults to "3 Star & other" inside the lookup when
    // unset on the job - surface that rather than let it pass as a real value.
    const ratingWasAssumed = !job.starRating && !job.ratingLevel;

    return (
      <div className={`px-1.5 py-1 rounded border text-[9px] font-bold leading-tight text-left whitespace-normal ${colorClasses}`}>
        <div>Rs {finalRs} / limit Rs {limitRs}</div>
        <div>{isRed ? `EXCEEDS by Rs ${diffRs}` : isAmber ? 'approaching limit' : 'within limit'}</div>
        <div className="text-[8px] font-normal opacity-70">
          {check.ratingLabel}{ratingWasAssumed ? ' (assumed - voltage class not set on job)' : ''}
        </div>
        {isRed && (
          <div className="mt-1 text-[8px] font-bold text-red-900">
            Exceeds 25% approval limit - repair needs SE approval, or mark as Scrap.
          </div>
        )}
      </div>
    );
  };

  if (!activeAgency) {
    return (
      <div className="p-8 text-center text-slate-500">
        Please select or create an agency first.
      </div>
    );
  }

  const scrapJobs = mrJobs.filter(job => formsData[job.id]?.condition === 'Scrap').map(j => j.jobNo);
  const scrapNote = scrapJobs.length > 0 
    ? `NOTE : JOB NO ${scrapJobs.join(' & ')} FOUND HEAVILY DAMAGED WITH CORE & LT, HENCE PROPOSED FOR SCRAP ONLY`
    : null;

  if (isPrintOpen && selectedMrNo) {
    const sampleJob = mrJobs[0];
    const mrDateStr = formatDDMMYYYY(sampleJob?.dateOfIssue || sampleJob?.mrDate || sampleJob?.createdAt);
    /**
     * NINE ROWS A PAGE - AND IT IS NOT A VERTICAL LIMIT (AUDIT G20).
     *
     * ⚠ THE BINDING CONSTRAINT IS WIDTH, WHICH IS THE OPPOSITE OF WHAT A ROW COUNT IMPLIES.
     * This sheet is LANDSCAPE A4 and the table has 27 columns across 297mm. Vertically it is
     * nowhere near full: content area ~176mm, and nine rows plus the header, title and
     * signature block use about 68mm - roughly 115mm SPARE. The page is two-thirds empty.
     *
     * So a reader wondering whether 9 can go up should be asking about column width, not
     * height. And a reader making the text bigger - as G20 did, 7.5px to 9.5px - is spending
     * from a very large vertical surplus and a very small horizontal one.
     *
     * ⚠ IF THE TEXT EVER OVERFLOWS 297mm, the honest fixes are FEWER COLUMNS PER PAGE or a
     * SMALLER CHUNK_SIZE. Not smaller type: unreadable print is the fault this number's
     * neighbours were just changed to fix, and compensating horizontally by shrinking would
     * undo that silently.
     *
     * There is no mm budget behind this the way layoutEstimatePages has one - 9 is a measured
     * number with no model, and this comment is the model it never had.
     */
    const CHUNK_SIZE = 9;
    const jobChunks: typeof mrJobs[] = [];
    for (let i = 0; i < mrJobs.length; i += CHUNK_SIZE) {
      jobChunks.push(mrJobs.slice(i, i + CHUNK_SIZE));
    }
    if (jobChunks.length === 0) jobChunks.push([]);

    return (
      <div className="bg-slate-100 min-h-screen text-black p-4 print:p-0 print:bg-white">
        <div className="print:hidden max-w-[297mm] mx-auto mb-4 flex justify-between items-center bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200">
          <div>
            <p className="text-sm font-bold text-slate-800">Internal Inspection Report - Print Preview</p>
            <p className="text-xs text-slate-500">
              MR No: <strong className="font-mono tabular-nums">{selectedMrNo}</strong> ({mrDateStr}) • {mrJobs.length} Transformers • {jobChunks.length} Landscape A4 Page{jobChunks.length > 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => triggerUniversalPrint('printable-internal-inspection-sheet', `Internal_Inspection_MR_${selectedMrNo}`, `Internal_Inspection_MR_${selectedMrNo}.pdf`, 'landscape')} 
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

        <div id="printable-internal-inspection-sheet" className="p-0 bg-transparent flex flex-col items-center">
          {jobChunks.map((chunk, pageIdx) => {
            const isLastPage = pageIdx === jobChunks.length - 1;
            return (
              <PrintableA4Page
                key={pageIdx}
                agency={activeAgency}
                orientation="landscape"
                documentTitle="INTERNAL INSPECTION & COIL DAMAGE REPORT"
                subtitle={jobChunks.length > 1 ? `Sheet ${pageIdx + 1} of ${jobChunks.length}` : undefined}
                className={pageIdx > 0 ? 'print-page-break-before mb-6' : 'mb-6'}
              >
                <div className="flex flex-col justify-between h-full">
                  <div>
                    <div className="flex justify-between items-center text-[10px] font-bold border-b border-black pb-1 mb-1.5 flex-wrap gap-y-1">
                      <span>MR NO: <strong className="font-mono">{selectedMrNo}</strong></span>
                      <span>MR DATE: <strong className="font-mono">({mrDateStr})</strong></span>
                      <span>DIVISION: <strong className="uppercase">{sampleJob?.division || '-'}</strong></span>
                      <span>EXT. INSP DATE: <strong className="font-mono">{sampleJob?.externalInspectionDate || '-'}</strong></span>
                      <span>INT. INSP DATE: <strong className="font-mono">{formatDDMMYYYY(internalInspectionDate)}</strong></span>
                      <span>TOTAL TRANSFORMERS: <strong>{mrJobs.length}</strong></span>
                    </div>

                    <table className="w-full border-collapse border border-black text-[9.5px] text-center">
                      <thead>
                        {/* Grouped High-Level Header */}
                        <tr className="bg-slate-100 print:bg-transparent font-bold">
                          <th className="border border-black p-0.5 w-6" rowSpan={2}>Sr</th>
                          <th className="border border-black p-0.5 min-w-[60px]" rowSpan={2}>Job No</th>
                          <th className="border border-black p-0.5 min-w-[55px]" rowSpan={2}>Trans S.No</th>
                          <th className="border border-black p-0.5 min-w-[45px]" rowSpan={2}>Make</th>
                          <th className="border border-black p-0.5 w-8" rowSpan={2}>KVA</th>
                          <th className="border border-black p-0.5 min-w-[50px]" rowSpan={2}>Type / Core</th>
                          <th className="border border-black p-0.5 w-8" rowSpan={2}>Wind</th>
                          <th className="border border-black p-0.5 w-8" rowSpan={2}>HV Limb</th>
                          
                          {/* HV SIDE COIL DAMAGE GROUP */}
                          <th className="border-t border-b border-black border-l-2 border-r-2 border-black p-0.5 bg-slate-200 print:bg-transparent font-black" colSpan={3}>
                            DAMAGED HV COIL (R / Y / B)
                          </th>
                          
                          <th className="border border-black p-0.5 w-9" rowSpan={2}>Tot Coil (HT)</th>
                          <th className="border border-black p-0.5 w-10" rowSpan={2}>Wt/Coil (Kg)</th>
                          <th className="border border-black p-0.5 w-10" rowSpan={2}>Tot Wt (HT)</th>
                          
                          {/* LV SIDE COIL DAMAGE GROUP */}
                          <th className="border-t border-b border-black border-l-2 border-r-2 border-black p-0.5 bg-slate-200 print:bg-transparent font-black" colSpan={3}>
                            LV COIL (DMG / RI / OK)
                          </th>
                          
                          <th className="border border-black p-0.5 w-10" rowSpan={2}>Wt/Coil (LT)</th>
                          <th className="border border-black p-0.5 w-10" rowSpan={2}>Tot Wt (LT)</th>
                          <th className="border border-black p-0.5 w-7" rowSpan={2}>Was Ring</th>
                          <th className="border border-black p-0.5 w-6" rowSpan={2}>In Pnt</th>
                          <th className="border border-black p-0.5 w-6" rowSpan={2}>Tst Trn</th>
                          <th className="border border-black p-0.5 w-6" rowSpan={2} title="DC (Dismantling Charge / Dismantling of Transformer)">DC</th>
                          <th className="border border-black p-0.5 w-6" rowSpan={2}>Insula</th>
                          <th className="border border-black p-0.5 w-14" rowSpan={2}>Condition</th>
                        </tr>
                        {/* Sub-Headers for HV & LV Phases */}
                        <tr className="bg-slate-100 print:bg-transparent font-bold">
                          <th className="border-b border-black border-l-2 border-r border-black p-0.5 w-6">R</th>
                          <th className="border-b border-black border-r border-black p-0.5 w-6">Y</th>
                          <th className="border-b border-black border-r-2 border-black p-0.5 w-6">B</th>
                          <th className="border-b border-black border-l-2 border-r border-black p-0.5 w-6">R</th>
                          <th className="border-b border-black border-r border-black p-0.5 w-6">Y</th>
                          <th className="border-b border-black border-r-2 border-black p-0.5 w-6">B</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chunk.map((job, cIdx) => {
                          const globalIdx = pageIdx * CHUNK_SIZE + cIdx;
                          const data = formsData[job.id] || {} as any;
                          const transCore = job.coreType || 'CRGO';

                          return (
                            <tr key={job.id} className="border border-black h-6">
                              <td className="border border-black p-0.5 font-bold">{globalIdx + 1}</td>
                              <td className="border border-black p-0.5 font-bold font-mono uppercase text-left pl-1">
                                {job.jobNo} {job.repairType === 'GP' ? '(GP)' : ''}
                              </td>
                              <td className="border border-black p-0.5 font-mono text-[8.5px] truncate max-w-[55px]">{job.serialNo || '-'}</td>
                              <td className="border border-black p-0.5 truncate max-w-[45px]">{job.make || '-'}</td>
                              <td className="border border-black p-0.5 font-bold">{job.capacityKva}</td>
                              <td className="border border-black p-0.5 font-bold uppercase text-[8.5px] text-blue-900">
                                {transCore}
                              </td>
                              <td className="border border-black p-0.5 font-bold">{data.windingType || 'AL'}</td>
                              <td className="border border-black p-0.5">{data.hvCoilLimb || '4'}</td>
                              
                              {/* HV Coil Group Columns */}
                              <td className="border-b border-black border-l-2 border-r border-black p-0.5 font-mono">{data.damR || '0'}</td>
                              <td className="border-b border-black border-r border-black p-0.5 font-mono">{data.damY || '0'}</td>
                              <td className="border-b border-black border-r-2 border-black p-0.5 font-mono">{data.damB || '0'}</td>
                              
                              <td className="border border-black p-0.5 font-bold">{data.totCoil || '0'}</td>
                              <td className="border border-black p-0.5">{data.wtOfCoil || '0'}</td>
                              <td className="border border-black p-0.5 font-bold">{data.totWt || '0'}</td>
                              
                              {/* LV Coil Group Columns */}
                              <td className="border-b border-black border-l-2 border-r border-black p-0.5 font-bold">{data.lvCoilR || 'OK'}</td>
                              <td className="border-b border-black border-r border-black p-0.5 font-bold">{data.lvCoilY || 'OK'}</td>
                              <td className="border-b border-black border-r-2 border-black p-0.5 font-bold">{data.lvCoilB || 'OK'}</td>
                              
                              <td className="border border-black p-0.5">{data.wtOfCoilLv || '0'}</td>
                              <td className="border border-black p-0.5 font-bold">{data.totWtLv || '0'}</td>
                              
                              <td className="border border-black p-0.5">{data.wasring || '6'}</td>
                              <td className="border border-black p-0.5">{data.inPnt || '-'}</td>
                              <td className="border border-black p-0.5">{data.tstTrn || 'Y'}</td>
                              <td className="border border-black p-0.5">{data.dc || 'Y'}</td>
                              <td className="border border-black p-0.5">{data.insula || 'Y'}</td>
                              <td className={`border border-black p-0.5 font-bold ${data.condition === 'Scrap' ? 'text-red-600' : 'text-slate-800'}`}>
                                {data.condition || 'Repairable'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {scrapNote && isLastPage && (
                      <div className="mt-2 p-1.5 bg-amber-50 print:bg-transparent border border-amber-300 print:border-black text-[9px] font-bold text-amber-900 print:text-black uppercase">
                        {scrapNote}
                      </div>
                    )}
                  </div>

                  {isLastPage && (
                    <div className="mt-2 pt-2 border-t border-black flex justify-between items-end px-6 text-[9.5px] font-bold uppercase">
                      <div className="text-center">
                        <div className="h-8"></div>
                        <div className="border-t border-dotted border-black pt-0.5">INSPECTED BY</div>
                        <div className="text-[9px] text-slate-700 font-normal">Junior Engineer</div>
                      </div>
                      <div className="text-center">
                        <div className="h-8"></div>
                        <div className="border-t border-dotted border-black pt-0.5">EXECUTIVE ENGINEER</div>
                      </div>
                      <div className="text-center">
                        <div className="h-8 flex items-center justify-center">
                          <div className="border border-dashed border-slate-400 px-2 py-0.5 rounded text-[8.5px] text-slate-500 font-normal">
                            OFFICIAL STAMP
                          </div>
                        </div>
                        <div className="border-t border-dotted border-black pt-0.5">FOR {activeAgency?.name}</div>
                        <div className="text-[9px] text-slate-700 font-normal">Authorized Signatory</div>
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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-900 print:text-black flex items-center">
            <Wrench className="w-6 h-6 mr-3 text-blue-600" />
            Internal Inspection
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Capture internal coil damage details, winding weights, insulation status, and scrap proposals for transformers.
          </p>
        </div>
        <div className="mt-3 md:mt-0 bg-blue-50 border border-blue-200 rounded-lg p-3 max-w-lg text-xs text-blue-900 shadow-2xs">
          <p className="font-semibold flex items-center gap-1.5 text-blue-800">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-600"></span>
            Amorphous & Wound Core Note
          </p>
          <p className="mt-1 text-[11px] text-blue-700 leading-relaxed">
            Amorphous & Wound Core transformers have fixed tender package rates and can be estimated directly. Internal inspection is used for coil analysis or when proposing heavily damaged units for <strong>SCRAP</strong>.
          </p>
        </div>
      </div>

      {!selectedMrNo && <OtherTenderNote count={otherTenderPending} noun="internal inspection" />}

      {!selectedMrNo ? (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
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
                  className={`px-4 py-1.5 text-xs font-bold uppercase rounded cursor-pointer transition-colors ${statusFilter === 'Pending' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 print:text-black'}`}
                >
                  Pending
                </button>
                <button
                  onClick={() => setStatusFilter('Completed')}
                  className={`px-4 py-1.5 text-xs font-bold uppercase rounded cursor-pointer transition-colors ${statusFilter === 'Completed' ? 'bg-white text-green-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 print:text-black'}`}
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
                    <th className="px-3 py-3 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">Ext. Insp.</th>
                    <th className="px-3 py-3 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">Internal Insp. Status</th>
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

                    // Latest date across the MR's jobs - it's only complete once every job is.
                    const extInspDate = latestJobDate(jobsForMr, 'externalInspectionDate');
                    const intInspDate = latestJobDate(jobsForMr, 'internalInspectionDate');
                    const isDone = isMrInternalComplete(jobsForMr, inspections);
                    const inspectedCount = jobsForMr.filter(j => isJobInternallyDone(j, inspections)).length;

                    // Internal inspection cannot start until every job in the MR is
                    // genuinely externally done (real data, not just a record).
                    const isExternallyReady = isMrExternalComplete(jobsForMr, externalInspections);
                    const externallyDoneCount = jobsForMr.filter(j => isJobExternallyDone(j, externalInspections)).length;
                    const externalPendingJobNos = jobsForMr.filter(j => !isJobExternallyDone(j, externalInspections)).map(j => j.jobNo);

                    return (
                    <React.Fragment key={mr}>
                    <tr className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-3 text-center font-mono tabular-nums font-bold text-xs text-slate-400">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-mono tabular-nums font-bold text-slate-900 text-sm">{mr}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                          <span>MR Date:</span>
                          <span className="font-mono tabular-nums text-slate-700 font-semibold">{mrDateStr}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 uppercase">
                          {sampleJob?.division || '-'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <div className="font-medium text-slate-800">{capSummary}</div>
                        <div className="text-[11px] text-blue-600 font-bold font-mono tabular-nums mt-0.5">Total: {totalKva} KVA</div>
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        <span className="font-mono tabular-nums font-bold text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-100">
                          {jobsForMr.length} {jobsForMr.length === 1 ? 'Unit' : 'Units'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500 max-w-[180px] truncate" title={jobsForMr.map(j => j.jobNo).join(', ')}>
                        <span className="font-mono tabular-nums text-slate-700 font-medium">
                          {jobsForMr.map(j => j.jobNo).join(', ')}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        {extInspDate ? (
                          <div className="inline-flex flex-col items-center">
                            <span className="text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded font-mono tabular-nums">
                              {formatDDMMYYYY(extInspDate)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">Pending</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        {isDone ? (
                          <div className="inline-flex flex-col items-center">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-green-50 text-green-700 border border-green-200">
                              <CheckCircle2 className="w-3 h-3 text-green-600" /> Completed
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono tabular-nums mt-0.5">
                              {inspectedCount} of {jobsForMr.length} inspected
                            </span>
                            {intInspDate && (
                              <span className="text-[10px] text-slate-500 font-mono tabular-nums mt-0.5">
                                Date: {formatDDMMYYYY(intInspDate)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="inline-flex flex-col items-center">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              Pending
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono tabular-nums mt-0.5">
                              {inspectedCount} of {jobsForMr.length} inspected
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => isExternallyReady && handleSelectMr(mr)}
                            disabled={!isExternallyReady}
                            title={isExternallyReady ? undefined : 'External inspection must be completed for every job in this MR first'}
                            className={`flex items-center px-3 py-1.5 text-xs font-bold rounded transition-colors shadow-2xs ${
                              isExternallyReady
                                ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'
                                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            }`}
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
                              title="Print Internal Inspection Report"
                            >
                              <Printer className="w-3.5 h-3.5 mr-1 text-slate-600" /> Print
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {!isExternallyReady && (
                      <tr>
                        <td colSpan={9} className="px-4 py-2 bg-amber-50 border-t border-amber-200">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            Awaiting external inspection - {externallyDoneCount} of {jobsForMr.length} done. Outstanding: {externalPendingJobNos.join(', ')}
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                    );
                  })}
                  {filteredMrNos.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
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
                  Internal Inspection
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  Division: <strong className="text-white uppercase">{mrJobs[0]?.division || '-'}</strong>
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <p className="text-xl font-mono tabular-nums font-bold text-white tracking-tight">MR No: {selectedMrNo}</p>
                <span className="text-xs bg-slate-800 text-slate-300 font-mono tabular-nums px-2.5 py-1 rounded border border-slate-700">
                  MR Date: <strong className="text-white">({formatDDMMYYYY(mrJobs[0]?.dateOfIssue || mrJobs[0]?.mrDate || mrJobs[0]?.createdAt)})</strong>
                </span>
                {mrJobs[0]?.externalInspectionDate && (
                  <span className="text-xs bg-indigo-950 text-indigo-200 font-mono tabular-nums px-2.5 py-1 rounded border border-indigo-800">
                    Ext. Insp: <strong>{formatDDMMYYYY(mrJobs[0].externalInspectionDate)}</strong>
                  </span>
                )}
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
                  value={internalInspectionDate}
                  onChange={(e) => setInternalInspectionDate(e.target.value)}
                  className="bg-slate-900 text-white font-mono tabular-nums text-xs px-2 py-1 rounded border border-slate-600 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
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

          <div className="bg-amber-50 border-l-4 border-amber-500 p-3 rounded text-amber-900 text-xs flex items-center gap-2 shadow-sm print:hidden">
            <span className="font-bold text-sm">⚠️ Mandatory Rule:</span>
            <span>Blank internal inspection reports are <strong>NOT acceptable</strong>. You must select Winding Type, Condition, WAS Ring, and fill damaged coil weights before submitting.</span>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto print:border-none print:shadow-none print:overflow-visible">
            <form onSubmit={handleSubmit}>
              <div className="min-w-max">
                <table className="w-full text-left print:text-black print:text-[8px] border-collapse">
                  <thead>
                    {/* Top Grouped Header Row */}
                    <tr className="border-b border-slate-200">
                      <th className="p-2 bg-slate-50 text-[10px] font-bold text-slate-600 uppercase tracking-wider sticky left-0 z-20 w-8 border-r border-slate-200 text-center" rowSpan={2}>#</th>
                      <th className="p-2 bg-slate-50 text-[10px] font-bold text-slate-600 uppercase tracking-wider sticky left-8 z-20 min-w-[100px] border-r border-slate-200" rowSpan={2}>JOB NO</th>
                      <th className="p-2 bg-slate-50 text-[10px] font-bold text-slate-600 uppercase tracking-wider min-w-[90px] border-r border-slate-200" rowSpan={2}>TRANS. S.NO</th>
                      <th className="p-2 bg-slate-50 text-[10px] font-bold text-slate-600 uppercase tracking-wider min-w-[70px] border-r border-slate-200" rowSpan={2}>MAKE</th>
                      <th className="p-2 bg-slate-50 text-[10px] font-bold text-slate-600 uppercase tracking-wider min-w-[50px] border-r border-slate-200 text-center" rowSpan={2}>KVA</th>
                      <th className="p-2 bg-indigo-50/80 text-[10px] font-bold text-indigo-950 uppercase tracking-wider min-w-[90px] border-r border-slate-200 text-center" rowSpan={2}>
                        <div className="flex items-center justify-center gap-1">
                          <Cpu className="w-3.5 h-3.5 text-indigo-600" />
                          <span>TYPE / CORE</span>
                        </div>
                      </th>
                      <th className="p-2 bg-blue-50/80 text-[10px] font-bold text-blue-950 uppercase tracking-wider min-w-[85px] border-r border-slate-200 text-center" rowSpan={2}>
                        EXT. INSP
                      </th>
                      <th className="p-2 bg-amber-50/80 text-[10px] font-bold text-amber-950 uppercase tracking-wider min-w-[60px] border-r border-slate-200 text-center" rowSpan={2}>
                        <div className="flex items-center justify-center gap-1">
                          <Zap className="w-3.5 h-3.5 text-amber-600" />
                          <span>WIND</span>
                        </div>
                      </th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[48px] border-r border-slate-200 text-center" rowSpan={2}>HV<br/>LIMB</th>
                      
                      {/* HV SIDE COIL DAMAGE GROUP */}
                      <th className="p-1.5 bg-blue-100 text-[10px] font-black text-blue-950 uppercase tracking-wider text-center border-t-2 border-l-2 border-r-2 border-blue-500 shadow-xs" colSpan={3}>
                        DAMAGED HV COIL (R / Y / B)
                      </th>
                      
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[55px] border-r border-slate-200 text-center" rowSpan={2}>TOT.<br/>COIL (HT)</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[65px] border-r border-slate-200 text-center" rowSpan={2}>WT/COIL<br/>(KG) (HT)</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[65px] border-r border-slate-200 text-center" rowSpan={2}>TOT.<br/>WT (HT)</th>
                      
                      {/* LV SIDE COIL DAMAGE GROUP */}
                      <th className="p-1.5 bg-indigo-100 text-[10px] font-black text-indigo-950 uppercase tracking-wider text-center border-t-2 border-l-2 border-r-2 border-indigo-500 shadow-xs" colSpan={3}>
                        LV COIL (DMG / RI / OK)
                      </th>
                      
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[65px] border-r border-slate-200 text-center" rowSpan={2}>WT/COIL<br/>(KG) LT</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[65px] border-r border-slate-200 text-center" rowSpan={2}>TOT.<br/>WT (LT)</th>
                      
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[48px] border-r border-slate-200 text-center" rowSpan={2}>WAS<br/>RING</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[45px] border-r border-slate-200 text-center" rowSpan={2}>IN.<br/>PNT</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[45px] border-r border-slate-200 text-center" rowSpan={2}>TST<br/>TRN</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[45px] border-r border-slate-200 text-center" rowSpan={2} title="DC (Dismantling Charge / Dismantling of Transformer)">DC</th>
                      <th className="p-1 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[45px] border-r border-slate-200 text-center" rowSpan={2}>INSU<br/>LA</th>
                      <th className="p-2 bg-rose-50/80 text-[10px] font-bold text-rose-950 uppercase tracking-wider min-w-[95px] text-center" rowSpan={2}>
                        CONDITION
                      </th>
                      <th className="p-2 bg-slate-50 text-[9px] font-bold text-slate-600 uppercase tracking-wider min-w-[180px] text-center" rowSpan={2} title="Live estimate cost vs Clause 4.0 Circle Estimate Power Limit - CRGO jobs only">
                        Est. vs Circle Limit
                      </th>
                    </tr>

                    {/* Sub-Headers for HV and LV Coils */}
                    <tr className="border-b border-slate-300 text-[9px]">
                      {/* HV Sub-columns */}
                      <th className="p-1 bg-blue-50 text-blue-900 font-bold text-center border-l-2 border-r border-b-2 border-blue-500 min-w-[40px]" title="Damaged HV Coil - Phase R">
                        R
                      </th>
                      <th className="p-1 bg-blue-50 text-blue-900 font-bold text-center border-r border-b-2 border-blue-500 min-w-[40px]" title="Damaged HV Coil - Phase Y">
                        Y
                      </th>
                      <th className="p-1 bg-blue-50 text-blue-900 font-bold text-center border-r-2 border-b-2 border-blue-500 min-w-[40px]" title="Damaged HV Coil - Phase B">
                        B
                      </th>
                      
                      {/* LV Sub-columns */}
                      <th className="p-1 bg-indigo-50 text-indigo-900 font-bold text-center border-l-2 border-r border-b-2 border-indigo-500 min-w-[50px]" title="LV Coil Status - Phase R">
                        R
                      </th>
                      <th className="p-1 bg-indigo-50 text-indigo-900 font-bold text-center border-r border-b-2 border-indigo-500 min-w-[50px]" title="LV Coil Status - Phase Y">
                        Y
                      </th>
                      <th className="p-1 bg-indigo-50 text-indigo-900 font-bold text-center border-r-2 border-b-2 border-indigo-500 min-w-[50px]" title="LV Coil Status - Phase B">
                        B
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {mrJobs.map((job, index) => {
                      const isScrap = formsData[job.id]?.condition === 'Scrap';
                      const limbRaw = formsData[job.id]?.hvCoilLimb;
                      const hvLimbMax = limbRaw !== undefined && limbRaw.trim() !== '' && !isNaN(Number(limbRaw)) ? Number(limbRaw) : undefined;
                      return (
                      <tr key={job.id} className={`hover:bg-slate-50/80 transition-colors group ${isScrap ? 'bg-red-50/30' : ''}`}>
                        <td className="p-2 text-xs font-mono tabular-nums text-slate-500 sticky left-0 bg-white group-hover:bg-slate-50 border-r border-slate-200 z-10 text-center font-bold">
                          {index + 1}
                        </td>
                        <td className="p-2 text-xs font-mono tabular-nums font-bold sticky left-8 bg-white group-hover:bg-slate-50 border-r border-slate-200 min-w-[100px] z-10">
                          <div className="flex items-center gap-1.5">
                            <span className={matchesGpFilter(job, 'GP') ? GP_TEXT_CLASS : 'text-slate-900'}>{job.jobNo}</span>
                            {matchesGpFilter(job, 'GP') && <GpChip />}
                          </div>
                        </td>
                        <td className="p-2 text-xs font-mono tabular-nums font-medium text-slate-700 min-w-[90px] border-r border-slate-200">
                          {job.serialNo || '-'}
                        </td>
                        <td className="p-2 text-xs text-slate-800 font-semibold min-w-[70px] truncate max-w-[90px] border-r border-slate-200" title={job.make}>
                          {job.make || '-'}
                        </td>
                        <td className="p-2 text-xs text-slate-900 font-mono tabular-nums font-bold text-center border-r border-slate-200">
                          {job.capacityKva}
                        </td>
                        <td className="p-1.5 text-[10px] text-indigo-900 font-bold text-center border-r border-slate-200 bg-indigo-50/30">
                          <span className="px-1.5 py-0.5 bg-indigo-100/80 text-indigo-900 rounded font-bold uppercase tracking-tight">
                            {job.coreType || 'CRGO'}
                          </span>
                        </td>
                        <td className="p-1.5 text-[11px] text-center border-r border-slate-200 bg-blue-50/20 font-mono tabular-nums text-blue-900 font-semibold">
                          {job.externalInspectionDate ? formatDDMMYYYY(job.externalInspectionDate) : '-'}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center bg-amber-50/30">
                          {renderSelectField(job.id, 'windingType', ['AL', 'CU'], 'w-14')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderInputField(job.id, 'hvCoilLimb', 'number', 'w-12')}
                        </td>
                        
                        {/* HV Damaged Coil Inputs with Group Border */}
                        <td className="p-1 border-l-2 border-r border-blue-400 bg-blue-50/20 text-center">
                          {renderIntegerField(job.id, 'damR', 'w-10', hvLimbMax)}
                        </td>
                        <td className="p-1 border-r border-blue-400 bg-blue-50/20 text-center">
                          {renderIntegerField(job.id, 'damY', 'w-10', hvLimbMax)}
                        </td>
                        <td className="p-1 border-r-2 border-blue-400 bg-blue-50/20 text-center">
                          {renderIntegerField(job.id, 'damB', 'w-10', hvLimbMax)}
                        </td>

                        <td className="p-1 border-r border-slate-200 text-center font-bold">
                          {renderReadOnlyField(job.id, 'totCoil', 'w-14')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderInputField(job.id, 'wtOfCoil', 'number', 'w-16')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center font-bold text-blue-900">
                          {renderReadOnlyField(job.id, 'totWt', 'w-16')}
                        </td>
                        
                        {/* LV Damaged Coil Selectors with Group Border */}
                        <td className="p-1 border-l-2 border-r border-indigo-400 bg-indigo-50/20 text-center">
                          {renderSelectField(job.id, 'lvCoilR', ['OK', 'RI', 'DAM'], 'w-14', 'OK = sound, no charge.  RI = heated but conductor intact - re-insulation, Schedule-A item 14 at Rs 115/kg.  DAM = damaged - replacement, item 13A at Rs 149/kg.')}
                        </td>
                        <td className="p-1 border-r border-indigo-400 bg-indigo-50/20 text-center">
                          {renderSelectField(job.id, 'lvCoilY', ['OK', 'RI', 'DAM'], 'w-14', 'OK = sound, no charge.  RI = heated but conductor intact - re-insulation, Schedule-A item 14 at Rs 115/kg.  DAM = damaged - replacement, item 13A at Rs 149/kg.')}
                        </td>
                        <td className="p-1 border-r-2 border-indigo-400 bg-indigo-50/20 text-center">
                          {renderSelectField(job.id, 'lvCoilB', ['OK', 'RI', 'DAM'], 'w-14', 'OK = sound, no charge.  RI = heated but conductor intact - re-insulation, Schedule-A item 14 at Rs 115/kg.  DAM = damaged - replacement, item 13A at Rs 149/kg.')}
                        </td>
                        
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderInputField(job.id, 'wtOfCoilLv', 'number', 'w-16')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center font-bold text-indigo-900">
                          {renderReadOnlyField(job.id, 'totWtLv', 'w-16')}
                          {/* EXCLUSIVITY, MADE VISIBLE. Display only - no calculation is
                              touched here.

                              LV coil replacement (Schedule-A 13A) and re-insulation (item
                              14) are alternatives, and the estimate picks between them from
                              totWtLv: any weight routes to 13A, zero routes to 14. An
                              operator marking a coil therefore switches one line off and
                              another on, and the total can move DOWN - which reads as
                              nothing having changed. Saying which line applies is the point;
                              inferring it from a total is not something anyone should have
                              to do. */}
                          {(() => {
                            const d = formsData[job.id];
                            if (!d) return null;
                            const dam = Number(d.totWtLv || 0);
                            const ri = Number(d.totWtLvReIns || 0);
                            const noWeight = !(Number(d.wtOfCoilLv) > 0) &&
                              [d.lvCoilR, d.lvCoilY, d.lvCoilB].some(v => v === 'DAM' || v === 'RI');
                            if (noWeight) return (
                              <div className="text-[9px] text-red-700 leading-tight mt-0.5 font-normal">
                                enter Wt of Coil LV -<br />the charge cannot be calculated
                              </div>
                            );
                            if (dam === 0 && ri === 0) return (
                              <div className="text-[9px] text-slate-500 leading-tight mt-0.5 font-normal">
                                all LV coils OK -<br />no LV coil charge
                              </div>
                            );
                            return (
                              <div className="text-[9px] text-amber-700 leading-tight mt-0.5 font-normal">
                                {dam > 0 && <>{dam.toFixed(2)} kg replacement (13A)<br /></>}
                                {ri > 0 && <>{ri.toFixed(2)} kg re-insulation (14)</>}
                              </div>
                            );
                          })()}
                        </td>
                        
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderInputField(job.id, 'wasring', 'text', 'w-12')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderSelectField(job.id, 'inPnt', ['Y', 'N', '-'], 'w-12')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderSelectField(job.id, 'tstTrn', ['Y', 'N', '-'], 'w-12')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderSelectField(job.id, 'dc', ['Y', 'N', '-'], 'w-12')}
                        </td>
                        <td className="p-1 border-r border-slate-200 text-center">
                          {renderSelectField(job.id, 'insula', ['Y', 'N', '-'], 'w-12')}
                        </td>
                        <td className="p-1 text-center">
                          <select
                            value={formsData[job.id]?.condition || 'Repairable'}
                            onChange={(e) => handleChange(job.id, 'condition', e.target.value)}
                            className={`px-2 py-1 text-xs font-bold border rounded focus:ring-1 bg-white cursor-pointer shadow-2xs w-full ${
                              isScrap 
                                ? 'border-red-500 text-red-700 bg-red-50 focus:ring-red-500 ring-1 ring-red-400' 
                                : 'border-slate-300 text-slate-800 focus:ring-blue-500'
                            }`}
                          >
                            <option value="Repairable">Repairable</option>
                            <option value="Scrap">Scrap</option>
                          </select>
                        </td>
                        <td className="p-1.5 text-center align-top">
                          {renderCircleLimitIndicator(job)}
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
              
              <SetupGapDialog gap={setupGap} onCancel={() => setSetupGap(null)} />

      {scrapNote && (
                <div className="p-4 text-xs font-bold text-red-900 bg-red-50 uppercase tracking-wider border-t border-red-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{scrapNote}</span>
                </div>
              )}
              
              <div className="p-4 bg-slate-50 print:bg-transparent border-t border-slate-200 flex justify-end print:hidden">
                <button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="px-8 py-2.5 text-xs font-bold uppercase tracking-widest bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg transition-colors flex items-center shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save All {mrJobs.length} Inspections
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
