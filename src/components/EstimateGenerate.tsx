
import { useAgency, getAtPercentageForCore, getEstimateMasterForCore, getEstimateCircleRecipient, getEstimateCcText } from '../lib/AgencyContext';
import React, { useState, useEffect, useMemo } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, doc, writeBatch } from 'firebase/firestore';
import { 
  Loader2, Printer, Search, FileSpreadsheet, Download, Edit3, Check, Save, FileText, X,
  Lock, Unlock, AlertTriangle, RotateCcw, Calendar, Send, CheckCircle2, Clock, CheckSquare,
  Eye, ArrowLeft, ArrowUpRight, Filter, IndianRupee
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { defaultEstimateData, EstimateItem } from '../lib/estimateData';
import { ExternalData } from './ExternalInspection';
import { LetterheadHeader } from './LetterheadHeader';
import { downloadHtmlAsWord } from '../lib/wordExport';

export default function EstimateGenerate() {
  const { activeAgency, activeAtMaster, updateAgency } = useAgency();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Tab state: 'generator' | 'sent' | 'approvals'
  const [activeTab, setActiveTab] = useState<'generator' | 'sent' | 'approvals'>('generator');

  const [selectedMrNo, setSelectedMrNo] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDivision, setSelectedDivision] = useState<string>('All');
  const [savingEstimateDates, setSavingEstimateDates] = useState(false);
  const [savedSuccessMsg, setSavedSuccessMsg] = useState('');

  // Send Estimate Modal State
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendTargetMr, setSendTargetMr] = useState<string>('');
  const [sendRefNo, setSendRefNo] = useState('');
  const [sendDate, setSendDate] = useState(new Date().toISOString().split('T')[0]);
  const [sendRemarks, setSendRemarks] = useState('');
  const [submittingSend, setSubmittingSend] = useState(false);

  // Approval Received Modal State
  const [showApprModal, setShowApprModal] = useState(false);
  const [apprTargetMr, setApprTargetMr] = useState<string>('');
  const [apprNo, setApprNo] = useState('');
  const [apprDate, setApprDate] = useState(new Date().toISOString().split('T')[0]);
  const [apprAmount, setApprAmount] = useState<number | string>('');
  const [apprRemarks, setApprRemarks] = useState('');
  const [submittingAppr, setSubmittingAppr] = useState(false);

  // Sent Estimates List Filters
  const [sentSearchQuery, setSentSearchQuery] = useState('');
  const [sentFilterDivision, setSentFilterDivision] = useState<string>('All');

  // Received Approvals List Filters
  const [apprSearchQuery, setApprSearchQuery] = useState('');
  const [apprFilterDivision, setApprFilterDivision] = useState<string>('All');

  // Customizable Forwarding Letter Fields
  const [forwardingTo, setForwardingTo] = useState('');
  const [forwardingSub, setForwardingSub] = useState('');
  const [forwardingCc, setForwardingCc] = useState('');
  const [refNoText, setRefNoText] = useState('');
  const [letterDateText, setLetterDateText] = useState('');
  const [refBodyText, setRefBodyText] = useState('');
  const [closingText, setClosingText] = useState('');
  const [signedByText, setSignedByText] = useState('');
  
  const [showEditModal, setShowEditModal] = useState(false);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [isCcLocked, setIsCcLocked] = useState(true);
  const [showCcUnlockModal, setShowCcUnlockModal] = useState(false);

  // Derive current division for selected MR
  const currentSelectedDivision = useMemo(() => {
    if (!selectedMrNo) return activeAgency?.circleOfficeName || 'SABARMATI';
    const mrJobs = jobs.filter(j => j.mrNo === selectedMrNo);
    return mrJobs[0]?.division || activeAgency?.circleOfficeName || 'SABARMATI';
  }, [jobs, selectedMrNo, activeAgency]);

  // Sync letter fields whenever activeAgency or selectedMrNo changes
  useEffect(() => {
    if (activeAgency) {
      setForwardingTo(getEstimateCircleRecipient(activeAgency, currentSelectedDivision));
      setForwardingSub(activeAgency.forwardingSubject || 'Submiting Inspection Report & Estimate of Transformer');
      setForwardingCc(getEstimateCcText(activeAgency, currentSelectedDivision));
      setSignedByText(`For, ${activeAgency.name || ''}`);
    }
  }, [activeAgency, currentSelectedDivision]);

  useEffect(() => {
    const todayStr = new Date().toLocaleDateString('en-GB');
    setLetterDateText(todayStr);
    setRefNoText(`UGVCL/EE-T-1/TRANS-REP/${selectedMrNo || '001'}`);
    setRefBodyText(`With reference to the abvoe subject , we are submitting you inspection reports and estimates of following transformers received from ${currentSelectedDivision}`);
    setClosingText('We Request you to send the approval of above transformers earliest as possible.');
  }, [selectedMrNo, currentSelectedDivision]);

  useEffect(() => {
    async function fetchJobs() {
      if (!auth.currentUser || !activeAgency) { setLoading(false); return; }
      try {
        const q = query(
          collection(db, 'jobs'),
          where('ownerId', '==', auth.currentUser.uid), 
          where('agencyId', '==', activeAgency.id)
        );
        const snapshot = await getDocs(q);
        const fetchedJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setJobs(fetchedJobs);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'jobs');
      } finally {
        setLoading(false);
      }
    }
    fetchJobs();
  }, [activeAgency]);

  const mrGroups = useMemo(() => {
    const groups: Record<string, any[]> = {};
    jobs.forEach(j => {
      if (!j.mrNo) return;
      if (!groups[j.mrNo]) groups[j.mrNo] = [];
      groups[j.mrNo].push(j);
    });
    return groups;
  }, [jobs]);

  const divisions = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach(j => {
      if (j.division) set.add(j.division);
    });
    return Array.from(set).sort();
  }, [jobs]);

  const selectedJobsData = useMemo(() => {
    if (!selectedMrNo) return [];
    return jobs.filter(j => j.mrNo === selectedMrNo).sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));
  }, [jobs, selectedMrNo]);
  
  const filteredMrNos = Object.keys(mrGroups).filter(mr => {
    const groupJobs = mrGroups[mr] || [];
    const matchesSearch = !searchQuery || mr.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDivision = selectedDivision === 'All' || groupJobs.some(j => j.division === selectedDivision);
    return matchesSearch && matchesDivision;
  }).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const handlePrint = () => {
    window.print();
  };

  const handleExportExcel = () => {
    if (!selectedMrNo || selectedJobsData.length === 0) return;

    const wsData: any[][] = [];
    wsData.push([`ESTIMATE REPORT - MR NO: ${selectedMrNo}`]);
    wsData.push([`Division: ${selectedJobsData[0]?.division || 'SABARMATI'}`, `Date: ${dateString}`]);
    wsData.push([]);

    // Header row
    const headerRow = ['SR.', 'ITEM DESCRIPTION', ...selectedJobsData.map(j => `JOB ${j.jobNo} (${j.capacityKva} KVA)`)];
    wsData.push(headerRow);

    // Items
    const itemsList = selectedJobsData.length > 0 
      ? getEstimateMasterForCore(activeAgency, selectedJobsData[0].coreType)
      : (activeAgency?.estimateMaster?.length > 0 ? activeAgency.estimateMaster : defaultEstimateData);

    itemsList.forEach((item) => {
      const row = [item.itemCode, item.itemName];
      selectedJobsData.forEach((job) => {
        const kva = String(job.capacityKva);
        const jobMasterData = getEstimateMasterForCore(activeAgency, job.coreType);
        const itemForJob = jobMasterData.find(m => m.itemCode === item.itemCode || m.itemName === item.itemName) || item;
        const rawRate = itemForJob.rates[kva as keyof typeof itemForJob.rates] || 0;
        const rate = typeof rawRate === 'string' ? parseFloat(rawRate) : Number(rawRate);
        
        let qty = 0;
        const isScrapJob = job.status === 'Scrap' || job.condition === 'Scrap';
        const isScrapItem = item.itemName.toLowerCase().includes('scrap') || item.itemName.toLowerCase().includes('dismental') || item.itemCode === '1a' || item.itemCode === '19';
        
        if (isScrapItem === isScrapJob && rate > 0) {
          if (item.unit === 'Y') qty = 1;
          else if (item.unit === 'QTY') {
            qty = 1;
            if (item.itemCode === '1c') qty = 7;
            if (item.itemCode === '8' || item.itemCode === '9A' || item.itemCode === '9B') qty = 3;
            if (item.itemCode === '10' || item.itemCode === '11A' || item.itemCode === '11B') qty = 4;
            if (item.itemCode === '15') qty = 6;
          } else if (item.unit === 'KG') {
            qty = kva === '10' || kva === '16' ? 14 : kva === '25' ? 15.54 : 45.36;
          }
        }
        if (item.unit === 'N') qty = 0;

        const amt = qty * rate;
        row.push(amt.toFixed(2));
      });
      wsData.push(row);
    });

    // Totals
    const baseTotalsRow = ['-', 'BASE REPAIR COST'];
    selectedJobsData.forEach(job => {
      baseTotalsRow.push(calculateJobTotal(job).toFixed(2));
    });
    wsData.push(baseTotalsRow);

    const riseTotalsRow = ['-', 'AT % RISE / FALL TOTAL'];
    selectedJobsData.forEach(job => {
      const atPct = getAtPercentageForCore(activeAtMaster, job.coreType);
      const baseTot = calculateJobTotal(job);
      const riseAmt = baseTot * (atPct / 100);
      riseTotalsRow.push(riseAmt.toFixed(2));
    });
    wsData.push(riseTotalsRow);

    const grandTotalsRow = ['-', 'GRAND TOTAL'];
    selectedJobsData.forEach(job => {
      const atPct = getAtPercentageForCore(activeAtMaster, job.coreType);
      const baseTot = calculateJobTotal(job);
      const grandTot = baseTot * (1 + atPct / 100);
      grandTotalsRow.push(grandTot.toFixed(2));
    });
    wsData.push(grandTotalsRow);

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Estimate");
    XLSX.writeFile(wb, `Estimate_Report_MR_${selectedMrNo}.xlsx`);
  };

  const handleSaveEstimateDates = async () => {
    if (!selectedMrNo || selectedJobsData.length === 0 || !auth.currentUser) return;
    setSavingEstimateDates(true);
    setSavedSuccessMsg('');
    try {
      const batch = writeBatch(db);
      const todayIso = new Date().toISOString().split('T')[0];

      selectedJobsData.forEach(job => {
        const baseTot = calculateJobTotal(job);
        const atPct = getAtPercentageForCore(activeAtMaster, job.coreType);
        const grandTot = Math.round(baseTot * (1 + atPct / 100));

        const jobRef = doc(db, 'jobs', job.id);
        batch.update(jobRef, {
          estimateSentDate: todayIso,
          estimateRefNo: refNoText || `UGVCL/EST/${selectedMrNo}`,
          estimateAmount: grandTot,
          updatedAt: new Date().toISOString()
        });
      });

      await batch.commit();

      // Update local state
      setJobs(prev => prev.map(j => {
        if (j.mrNo === selectedMrNo) {
          const baseTot = calculateJobTotal(j);
          const atPct = getAtPercentageForCore(activeAtMaster, j.coreType);
          const grandTot = Math.round(baseTot * (1 + atPct / 100));
          return {
            ...j,
            estimateSentDate: todayIso,
            estimateRefNo: refNoText || `UGVCL/EST/${selectedMrNo}`,
            estimateAmount: grandTot
          };
        }
        return j;
      }));

      setSavedSuccessMsg('Estimate Sent Date & Ref No saved to all jobs in this MR!');
      setTimeout(() => setSavedSuccessMsg(''), 4000);
    } catch (err: any) {
      console.error(err);
      alert('Error saving estimate dates: ' + (err.message || err.toString()));
    } finally {
      setSavingEstimateDates(false);
    }
  };

  const today = new Date();
  const dateString = today.toLocaleDateString('en-GB'); // dd/mm/yyyy

  const calculateJobTotal = (job: any) => {
    let jobTotal = 0;
    const kva = String(job.capacityKva);
    const isScrapJob = job.status === 'Scrap' || job.condition === 'Scrap';
    const jobMasterData = getEstimateMasterForCore(activeAgency, job.coreType);

    jobMasterData.forEach(item => {
      const rawRate = item.rates[kva as keyof typeof item.rates] || 0;
      const rate = typeof rawRate === "string" ? parseFloat(rawRate) : Number(rawRate);
      let qty = 0;
      const isScrapItem = item.itemName.toLowerCase().includes('scrap') || item.itemName.toLowerCase().includes('dismental') || item.itemCode === '1a' || item.itemCode === '19';
      
      if (isScrapItem === isScrapJob && rate > 0) {
        if (item.unit === 'Y') qty = 1;
        else if (item.unit === 'QTY') {
          qty = 1;
          if (item.itemCode === '1c') qty = 7;
          if (item.itemCode === '8' || item.itemCode === '9A' || item.itemCode === '9B') qty = 3;
          if (item.itemCode === '10' || item.itemCode === '11A' || item.itemCode === '11B') qty = 4;
          if (item.itemCode === '15') qty = 6;
        } else if (item.unit === 'KG') {
          qty = kva === '10' || kva === '16' ? 14 : kva === '25' ? 15.54 : 45.36;
        }
      }
      if (item.unit === 'N') {
        qty = 0;
      }
      jobTotal += (qty * rate);
    });
    return jobTotal;
  };

  const calculateMrEstimateTotal = (mr: string) => {
    const mrJobs = mrGroups[mr] || [];
    let total = 0;
    mrJobs.forEach(job => {
      const baseTot = calculateJobTotal(job);
      const atPct = getAtPercentageForCore(activeAtMaster, job.coreType);
      total += Math.round(baseTot * (1 + atPct / 100));
    });
    return total;
  };

  // Open Send Estimate Modal
  const handleOpenSendModal = (mr: string) => {
    setSendTargetMr(mr);
    const mrJobs = mrGroups[mr] || [];
    const div = mrJobs[0]?.division || currentSelectedDivision;
    setSendRefNo(`UGVCL/EE-T-1/TRANS-REP/${mr}`);
    setSendDate(new Date().toISOString().split('T')[0]);
    setSendRemarks('');
    setShowSendModal(true);
  };

  // Confirm Sending Estimate
  const handleConfirmSendEstimate = async () => {
    if (!sendTargetMr || !sendRefNo.trim() || !sendDate || !auth.currentUser) {
      alert('Please enter both Reference No and Send Date');
      return;
    }
    setSubmittingSend(true);
    try {
      const targetJobs = mrGroups[sendTargetMr] || [];
      const batch = writeBatch(db);

      targetJobs.forEach(job => {
        const baseTot = calculateJobTotal(job);
        const atPct = getAtPercentageForCore(activeAtMaster, job.coreType);
        const grandTot = Math.round(baseTot * (1 + atPct / 100));

        const jobRef = doc(db, 'jobs', job.id);
        batch.update(jobRef, {
          estimateSentDate: sendDate,
          estimateRefNo: sendRefNo.trim(),
          estimateAmount: grandTot,
          estimateStatus: 'Sent',
          estimateApprovalStatus: job.approvalNo ? 'Approved' : (job.estimateApprovalStatus || 'Pending'),
          estimateRemarks: sendRemarks || '',
          updatedAt: new Date().toISOString()
        });
      });

      await batch.commit();

      // Update local state
      setJobs(prev => prev.map(j => {
        if (j.mrNo === sendTargetMr) {
          const baseTot = calculateJobTotal(j);
          const atPct = getAtPercentageForCore(activeAtMaster, j.coreType);
          const grandTot = Math.round(baseTot * (1 + atPct / 100));
          return {
            ...j,
            estimateSentDate: sendDate,
            estimateRefNo: sendRefNo.trim(),
            estimateAmount: grandTot,
            estimateStatus: 'Sent',
            estimateApprovalStatus: j.approvalNo ? 'Approved' : (j.estimateApprovalStatus || 'Pending'),
            estimateRemarks: sendRemarks || ''
          };
        }
        return j;
      }));

      setShowSendModal(false);
      setSavedSuccessMsg(`Estimate for MR ${sendTargetMr} successfully marked as Sent with Ref: ${sendRefNo}!`);
      setTimeout(() => setSavedSuccessMsg(''), 5000);
    } catch (err: any) {
      console.error('Error sending estimate:', err);
      alert('Failed to send estimate: ' + (err.message || err.toString()));
    } finally {
      setSubmittingSend(false);
    }
  };

  // Open Approval Received Modal
  const handleOpenApprModal = (mr: string) => {
    setApprTargetMr(mr);
    const mrJobs = mrGroups[mr] || [];
    const sample = mrJobs[0] || {};
    const totalEstAmt = calculateMrEstimateTotal(mr);
    setApprNo(sample.approvalNo || `UGVCL/SE-TR/APPR/${new Date().getFullYear()}/${mr}`);
    setApprDate(sample.approvalDate || new Date().toISOString().split('T')[0]);
    setApprAmount(sample.approvedAmount || totalEstAmt);
    setApprRemarks(sample.approvalRemarks || '');
    setShowApprModal(true);
  };

  // Confirm Approval Received
  const handleConfirmApproval = async () => {
    if (!apprTargetMr || !apprNo.trim() || !apprDate || !auth.currentUser) {
      alert('Please enter Approval Number and Approval Date');
      return;
    }
    setSubmittingAppr(true);
    try {
      const targetJobs = mrGroups[apprTargetMr] || [];
      const batch = writeBatch(db);

      targetJobs.forEach(job => {
        const jobRef = doc(db, 'jobs', job.id);
        batch.update(jobRef, {
          approvalNo: apprNo.trim(),
          approvalDate: apprDate,
          approvedAmount: Number(apprAmount) || 0,
          estimateApprovalStatus: 'Approved',
          approvalRemarks: apprRemarks || '',
          updatedAt: new Date().toISOString()
        });
      });

      await batch.commit();

      // Update local state
      setJobs(prev => prev.map(j => {
        if (j.mrNo === apprTargetMr) {
          return {
            ...j,
            approvalNo: apprNo.trim(),
            approvalDate: apprDate,
            approvedAmount: Number(apprAmount) || 0,
            estimateApprovalStatus: 'Approved',
            approvalRemarks: apprRemarks || ''
          };
        }
        return j;
      }));

      setShowApprModal(false);
      setSavedSuccessMsg(`Approval for MR ${apprTargetMr} marked successfully (Appr No: ${apprNo})!`);
      setTimeout(() => setSavedSuccessMsg(''), 5000);
    } catch (err: any) {
      console.error('Error saving approval:', err);
      alert('Failed to save approval: ' + (err.message || err.toString()));
    } finally {
      setSubmittingAppr(false);
    }
  };

  // Sent Estimates List (Awaiting Approval)
  const sentEstimatesList = useMemo(() => {
    const list: Array<{
      mrNo: string;
      mrDate: string;
      division: string;
      jobCount: number;
      estimateRefNo: string;
      estimateSentDate: string;
      estimateAmount: number;
      isApproved: boolean;
      approvalNo: string;
      approvalDate: string;
      approvedAmount: number;
      approvalRemarks?: string;
    }> = [];

    Object.keys(mrGroups).forEach(mr => {
      const groupJobs = mrGroups[mr] || [];
      // Sent if estimateSentDate or estimateStatus === 'Sent' or estimateRefNo
      const isSent = groupJobs.some(j => j.estimateSentDate || j.estimateStatus === 'Sent' || j.estimateRefNo);
      const isApproved = groupJobs.some(j => !!j.approvalNo || j.estimateApprovalStatus === 'Approved');
      
      if (isSent && !isApproved) {
        const sample = groupJobs[0] || {};
        const estAmount = calculateMrEstimateTotal(mr);
        list.push({
          mrNo: mr,
          mrDate: sample.dateOfIssue || sample.mrDate || '-',
          division: sample.division || 'SABARMATI',
          jobCount: groupJobs.length,
          estimateRefNo: sample.estimateRefNo || `UGVCL/EST/${mr}`,
          estimateSentDate: sample.estimateSentDate || '-',
          estimateAmount: estAmount,
          isApproved: false,
          approvalNo: '',
          approvalDate: '',
          approvedAmount: 0,
          approvalRemarks: sample.approvalRemarks || ''
        });
      }
    });

    return list.sort((a, b) => {
      if (a.estimateSentDate && b.estimateSentDate) {
        return b.estimateSentDate.localeCompare(a.estimateSentDate);
      }
      return b.mrNo.localeCompare(a.mrNo, undefined, { numeric: true });
    });
  }, [mrGroups, activeAtMaster, activeAgency]);

  // Received Approvals List
  const approvedEstimatesList = useMemo(() => {
    const list: Array<{
      mrNo: string;
      mrDate: string;
      division: string;
      jobCount: number;
      estimateRefNo: string;
      estimateSentDate: string;
      estimateAmount: number;
      approvalNo: string;
      approvalDate: string;
      approvedAmount: number;
      approvalRemarks?: string;
    }> = [];

    Object.keys(mrGroups).forEach(mr => {
      const groupJobs = mrGroups[mr] || [];
      const isApproved = groupJobs.some(j => !!j.approvalNo || j.estimateApprovalStatus === 'Approved');
      if (isApproved) {
        const sample = groupJobs[0] || {};
        const estAmount = calculateMrEstimateTotal(mr);
        list.push({
          mrNo: mr,
          mrDate: sample.dateOfIssue || sample.mrDate || '-',
          division: sample.division || 'SABARMATI',
          jobCount: groupJobs.length,
          estimateRefNo: sample.estimateRefNo || `UGVCL/EST/${mr}`,
          estimateSentDate: sample.estimateSentDate || '-',
          estimateAmount: estAmount,
          approvalNo: sample.approvalNo || `UGVCL/APPR/${mr}`,
          approvalDate: sample.approvalDate || sample.estimateSentDate || '-',
          approvedAmount: Number(sample.approvedAmount) || estAmount,
          approvalRemarks: sample.approvalRemarks || ''
        });
      }
    });

    return list.sort((a, b) => {
      if (a.approvalDate && b.approvalDate) {
        return b.approvalDate.localeCompare(a.approvalDate);
      }
      return b.mrNo.localeCompare(a.mrNo, undefined, { numeric: true });
    });
  }, [mrGroups, activeAtMaster, activeAgency]);

  // Filtered Sent Estimates List
  const filteredSentEstimates = useMemo(() => {
    return sentEstimatesList.filter(item => {
      const matchesSearch = !sentSearchQuery || 
        item.mrNo.toLowerCase().includes(sentSearchQuery.toLowerCase()) ||
        item.estimateRefNo.toLowerCase().includes(sentSearchQuery.toLowerCase());
      
      const matchesDivision = sentFilterDivision === 'All' || item.division === sentFilterDivision;

      return matchesSearch && matchesDivision;
    });
  }, [sentEstimatesList, sentSearchQuery, sentFilterDivision]);

  // Filtered Approved Estimates List
  const filteredApprovedEstimates = useMemo(() => {
    return approvedEstimatesList.filter(item => {
      const matchesSearch = !apprSearchQuery || 
        item.mrNo.toLowerCase().includes(apprSearchQuery.toLowerCase()) ||
        item.estimateRefNo.toLowerCase().includes(apprSearchQuery.toLowerCase()) ||
        item.approvalNo.toLowerCase().includes(apprSearchQuery.toLowerCase());
      
      const matchesDivision = apprFilterDivision === 'All' || item.division === apprFilterDivision;

      return matchesSearch && matchesDivision;
    });
  }, [approvedEstimatesList, apprSearchQuery, apprFilterDivision]);

  // Summary Stats
  const sentStats = useMemo(() => {
    const pendingCount = sentEstimatesList.length;
    const pendingValue = sentEstimatesList.reduce((sum, item) => sum + item.estimateAmount, 0);
    const approvedCount = approvedEstimatesList.length;
    const approvedValue = approvedEstimatesList.reduce((sum, item) => sum + (item.approvedAmount || item.estimateAmount), 0);
    const totalCount = pendingCount + approvedCount;
    const totalValue = pendingValue + approvedValue;

    return {
      totalCount,
      totalValue,
      approvedCount,
      approvedValue,
      pendingCount,
      pendingValue
    };
  }, [sentEstimatesList, approvedEstimatesList]);
  
  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="max-w-6xl mx-auto print:max-w-none print:w-full print:m-0 print:p-0">
      
      {/* Top Tab Navigation (Hidden during print) */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-200 mb-5 pb-3 gap-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => { setActiveTab('generator'); }}
            className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
              activeTab === 'generator'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Estimate Generator</span>
          </button>

          <button
            onClick={() => { setActiveTab('sent'); setSelectedMrNo(null); }}
            className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
              activeTab === 'sent'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Send className="w-4 h-4" />
            <span>Sent Estimates</span>
            {sentStats.pendingCount > 0 && (
              <span className={`ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-black ${
                activeTab === 'sent' ? 'bg-amber-900 text-amber-100' : 'bg-amber-100 text-amber-800'
              }`}>
                {sentStats.pendingCount} Awaiting Appr.
              </span>
            )}
          </button>

          <button
            onClick={() => { setActiveTab('approvals'); setSelectedMrNo(null); }}
            className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
              activeTab === 'approvals'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Received Approvals</span>
            {sentStats.approvedCount > 0 && (
              <span className={`ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-black ${
                activeTab === 'approvals' ? 'bg-emerald-900 text-emerald-100' : 'bg-emerald-100 text-emerald-800'
              }`}>
                {sentStats.approvedCount} Approved
              </span>
            )}
          </button>
        </div>

        {activeTab === 'generator' && selectedMrNo && (
          <button
            onClick={() => setSelectedMrNo(null)}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>All MR Estimates</span>
          </button>
        )}
      </div>

      {/* Global Success Notification */}
      {savedSuccessMsg && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 p-3 rounded-lg flex items-center justify-between text-xs font-semibold print:hidden shadow-sm mb-4">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{savedSuccessMsg}</span>
          </div>
          <button onClick={() => setSavedSuccessMsg('')} className="text-emerald-600 hover:text-emerald-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* TAB 1: ESTIMATE GENERATOR */}
      {activeTab === 'generator' && (
        <>
          {!selectedMrNo ? (
            <div className="bg-white rounded shadow-sm border border-slate-200 overflow-hidden print:hidden">
              <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row justify-between items-center gap-4">
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-widest">Select MR to Generate Estimate</h2>
                <div className="flex flex-wrap gap-3 items-center w-full md:w-auto">
                  <div className="relative flex-1 md:w-56">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search MR No..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 pr-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 w-full bg-white"
                    />
                  </div>
                  <div className="w-full sm:w-auto">
                    <select
                      value={selectedDivision}
                      onChange={(e) => setSelectedDivision(e.target.value)}
                      className="py-2 px-3 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 w-full bg-white text-slate-700 font-medium"
                    >
                      <option value="All">All Divisions</option>
                      {divisions.map(div => (
                        <option key={div} value={div}>{div} Division</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">MR No</th>
                      <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Division</th>
                      <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Total Jobs</th>
                      <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Est. Amount</th>
                      <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Status</th>
                      <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px] text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMrNos.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                          No matching MR numbers found.
                        </td>
                      </tr>
                    ) : (
                      filteredMrNos.map(mr => {
                        const groupJobs = mrGroups[mr] || [];
                        const divName = groupJobs[0]?.division || '-';
                        const scrapCount = groupJobs.filter(j => j.status === 'Scrap' || j.condition === 'Scrap').length;
                        const repairableCount = groupJobs.length - scrapCount;
                        const estTotal = calculateMrEstimateTotal(mr);
                        const isSent = groupJobs.some(j => j.estimateSentDate || j.estimateStatus === 'Sent' || j.estimateRefNo);
                        const isApproved = groupJobs.some(j => !!j.approvalNo || j.estimateApprovalStatus === 'Approved');
                        
                        return (
                          <tr key={mr} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-mono font-bold text-slate-800">{mr}</td>
                            <td className="px-4 py-3 font-medium text-slate-600">{divName}</td>
                            <td className="px-4 py-3 text-slate-600">
                              <span className="font-semibold">{groupJobs.length} Jobs</span>
                              <span className="text-xs text-slate-400 block">({repairableCount} Rep, {scrapCount} Scrap)</span>
                            </td>
                            <td className="px-4 py-3 font-mono font-bold text-slate-900">
                              ₹{estTotal.toLocaleString('en-IN')}
                            </td>
                            <td className="px-4 py-3">
                              {isApproved ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                  <CheckCircle2 className="w-3 h-3 mr-1" /> Approved
                                </span>
                              ) : isSent ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                  <Send className="w-3 h-3 mr-1" /> Sent (Pending Appr.)
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                  Draft / Ready
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right space-x-2">
                              <button
                                onClick={() => handleOpenSendModal(mr)}
                                className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 rounded transition-colors inline-flex items-center"
                                title="Mark this estimate as Sent to Department"
                              >
                                <Send className="w-3 h-3 mr-1" />
                                {isSent ? 'Update Sent Ref' : 'Send Estimate'}
                              </button>
                              <button 
                                onClick={() => setSelectedMrNo(mr)}
                                className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 rounded transition-colors"
                              >
                                Generate / View
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="space-y-6 print:space-y-0">
              <div className="bg-slate-900 border border-slate-800 p-4 rounded flex flex-wrap gap-3 justify-between items-center text-white print:hidden shadow-sm">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Selected MR</p>
                  <p className="text-lg font-mono font-bold">{selectedMrNo}</p>
                  <p className="text-xs text-slate-300 mt-1">{selectedJobsData.length} Transformer(s) in this MR</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleOpenSendModal(selectedMrNo)}
                    className="flex items-center text-xs font-bold uppercase tracking-wider bg-purple-600 hover:bg-purple-700 text-white px-3.5 py-2 rounded transition-colors shadow-sm"
                    title="Send Estimate with Ref No and Date"
                  >
                    <Send className="w-3.5 h-3.5 mr-1.5" /> Send Estimate
                  </button>
                  <button 
                    onClick={() => setShowEditModal(true)}
                    className="flex items-center text-xs font-bold uppercase tracking-wider bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-2 rounded transition-colors shadow-sm"
                  >
                    <Edit3 className="w-3.5 h-3.5 mr-1.5" /> Edit Letter
                  </button>
                  <button 
                    onClick={() => {
                      const container = document.getElementById('printable-estimate-container');
                      if (container) downloadHtmlAsWord(container, `Estimate_Report_${selectedMrNo}.doc`, `Estimate Report & Forwarding Letter - ${selectedMrNo}`);
                    }}
                    className="flex items-center text-xs font-bold uppercase tracking-wider bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded transition-colors shadow-sm"
                  >
                    <FileText className="w-3.5 h-3.5 mr-1.5" /> Download Word (.doc)
                  </button>
                  <button 
                    onClick={handlePrint}
                    className="flex items-center text-xs font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2 rounded transition-colors shadow-sm"
                  >
                    <Printer className="w-3.5 h-3.5 mr-1.5" /> Print / PDF
                  </button>
                  <button 
                    onClick={handleExportExcel}
                    className="flex items-center text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded transition-colors shadow-sm"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" /> Export Excel
                  </button>
                  <button 
                    onClick={() => setSelectedMrNo(null)}
                    className="text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-white border border-slate-700 px-3.5 py-2 rounded transition-colors"
                  >
                    Change MR
                  </button>
                </div>
              </div>

          {savedSuccessMsg && (
            <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 p-3 rounded-lg flex items-center justify-between text-xs font-semibold print:hidden shadow-sm">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{savedSuccessMsg}</span>
              </div>
              <button onClick={() => setSavedSuccessMsg('')} className="text-emerald-600 hover:text-emerald-800">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div id="printable-estimate-container" className="space-y-6 print:space-y-0">
            {/* PAGE 1: ESTIMATE REPORT */}
            <div className="bg-white p-8 rounded shadow-sm border border-slate-200 print:shadow-none print:border-none print:p-0">
              {/* Header */}
              <LetterheadHeader agency={activeAgency} documentTitle="ESTIMATE REPORT" />

              <div className="flex justify-between items-center text-[10px] font-bold uppercase text-black mb-2 border-b-2 border-black pb-2">
                <div>
                  <p>DIVISION : {selectedJobsData[0]?.division || 'SABARMATI'}</p>
                  <p className="mt-1">ORDER NO : {activeAgency?.prefixes?.[selectedJobsData[0]?.division || 'SABARMATI'] ? 'UGVCL/EE-T-1/TRANS-REP/...' : '...'}</p>
                </div>
                <div className="text-center text-sm underline decoration-2 underline-offset-4">
                  ESTIMATE REPORT
                </div>
                <div className="text-right">
                  <p>NO : {Math.floor(Math.random() * 100) + 1}</p>
                  <p className="mt-1">DATE : {letterDateText || dateString}</p>
                </div>
              </div>

            <table className="w-full text-black text-[9px] border-collapse border-2 border-black">
              <tbody>
                <tr className="border-b-2 border-black font-bold">
                  <td className="p-1 border-r-2 border-black">TRANS TYPE</td>
                  {selectedJobsData.map(job => (
                    <td key={job.id} className="p-1 border-r border-black text-center">{job.coreType || 'CRGO'}</td>
                  ))}
                </tr>
                <tr className="border-b border-black font-bold">
                  <td className="p-1 border-r-2 border-black">JOB NO</td>
                  {selectedJobsData.map(job => (
                    <td key={job.id} className="p-1 border-r border-black text-center">{job.jobNo}</td>
                  ))}
                </tr>
                <tr className="border-b border-black font-bold">
                  <td className="p-1 border-r-2 border-black">MAKE</td>
                  {selectedJobsData.map(job => (
                    <td key={job.id} className="p-1 border-r border-black text-center">{job.make}</td>
                  ))}
                </tr>
                <tr className="border-b border-black font-bold">
                  <td className="p-1 border-r-2 border-black">KVA / KV</td>
                  {selectedJobsData.map(job => (
                    <td key={job.id} className="p-1 border-r border-black text-center">{job.capacityKva} / 11</td>
                  ))}
                </tr>
                <tr className="border-b border-black font-bold">
                  <td className="p-1 border-r-2 border-black">TSR NO.</td>
                  {selectedJobsData.map(job => (
                    <td key={job.id} className="p-1 border-r border-black text-center">{job.serialNo}</td>
                  ))}
                </tr>
                <tr className="border-b border-black font-bold">
                  <td className="p-1 border-r-2 border-black">MR NO. & DATE</td>
                  {selectedJobsData.map(job => (
                    <td key={job.id} className="p-1 border-r border-black text-center">{job.mrNo}</td>
                  ))}
                </tr>
                <tr className="border-b-2 border-black font-bold">
                  <td className="p-1 border-r-2 border-black">Oil Cap / Less Oil / Filter Oil</td>
                  {selectedJobsData.map(job => (
                    <td key={job.id} className="p-1 border-r border-black text-center">- / - / -</td>
                  ))}
                </tr>

                {/* Sub headers */}
                <tr className="border-b-2 border-black font-bold bg-slate-100 print:bg-transparent">
                  <td className="p-1 border-r-2 border-black flex justify-between">
                    <span>As Per AT Sr</span>
                    <span className="text-center flex-1">ITEM</span>
                  </td>
                  {selectedJobsData.map(job => (
                    <td key={job.id} className="p-0 border-r border-black">
                      <table className="w-full text-center">
                        <tbody>
                          <tr>
                            <td className="w-1/3 py-1 border-r border-black">QTY</td>
                            <td className="w-1/3 py-1 border-r border-black">RATE</td>
                            <td className="w-1/3 py-1">AMT.</td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  ))}
                </tr>

                {/* Items */}
                {(selectedJobsData.length > 0 
                  ? getEstimateMasterForCore(activeAgency, selectedJobsData[0].coreType)
                  : (activeAgency?.estimateMaster?.length > 0 ? activeAgency.estimateMaster : defaultEstimateData)
                ).map((item, idx) => (
                  <tr key={idx} className="border-b border-slate-400">
                    <td className="p-1 border-r-2 border-black flex gap-2">
                      <span className="w-8">{item.itemCode}</span>
                      <span>{item.itemName}</span>
                    </td>
                    {selectedJobsData.map(job => {
                      const kva = String(job.capacityKva);
                      const jobMasterData = getEstimateMasterForCore(activeAgency, job.coreType);
                      const itemForJob = jobMasterData.find(m => m.itemCode === item.itemCode || m.itemName === item.itemName) || item;
                      const rawRate = itemForJob.rates[kva as keyof typeof itemForJob.rates] || 0;
                      const rate = typeof rawRate === "string" ? parseFloat(rawRate) : Number(rawRate);
                      
                      let qty = 0;
                      let qtyDisplay = '0';
                      
                      const isScrapItem = item.itemName.toLowerCase().includes('scrap') || item.itemName.toLowerCase().includes('dismental') || item.itemCode === '1a' || item.itemCode === '19';
                      const isScrapJob = job.status === 'Scrap' || job.condition === 'Scrap';
                      
                      if (isScrapItem === isScrapJob && rate > 0) {
                        if (item.unit === 'Y') {
                           qtyDisplay = 'Y';
                           qty = 1;
                        } else if (item.unit === 'QTY') {
                           qty = 1;
                           if (item.itemCode === '1c') qty = 7;
                           if (item.itemCode === '8' || item.itemCode === '9A' || item.itemCode === '9B') qty = 3;
                           if (item.itemCode === '10' || item.itemCode === '11A' || item.itemCode === '11B') qty = 4;
                           if (item.itemCode === '15') qty = 6;
                           qtyDisplay = qty.toString();
                        } else if (item.unit === 'KG') {
                           qty = kva === '10' || kva === '16' ? 14 : kva === '25' ? 15.54 : 45.36;
                           qtyDisplay = qty.toFixed(2);
                        }
                      }
                      
                      if (item.unit === 'N') {
                          qtyDisplay = 'N';
                          qty = 0;
                      }

                      const amt = qty * rate;

                      return (
                        <td key={job.id} className="p-0 border-r border-black">
                          <table className="w-full text-center">
                            <tbody>
                              <tr>
                                <td className="w-1/3 py-1 border-r border-slate-400">{qtyDisplay}</td>
                                <td className="w-1/3 py-1 border-r border-slate-400">{rate > 0 ? rate.toFixed(2) : '0.00'}</td>
                                <td className="w-1/3 py-1">{amt > 0 ? amt.toFixed(2) : '0.00'}</td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                
                {/* Totals */}
                <tr className="border-t-2 border-black font-bold">
                  <td className="p-2 border-r-2 border-black text-right">Total</td>
                  {selectedJobsData.map(job => (
                    <td key={job.id} className="p-2 border-r border-black text-right">{calculateJobTotal(job).toFixed(2)}</td>
                  ))}
                </tr>
                <tr className="border-t border-black font-bold">
                  <td className="p-2 border-r-2 border-black text-right">
                    {(() => {
                      if (selectedJobsData.length === 0) return 'Rise / Fall Total';
                      const pcts = selectedJobsData.map(j => getAtPercentageForCore(activeAtMaster, j.coreType));
                      const allSame = pcts.every(p => p === pcts[0]);
                      if (allSame) {
                        const p = pcts[0];
                        return p >= 0 ? `${p.toFixed(2)} % Rise Total` : `${Math.abs(p).toFixed(2)} % Fall Total`;
                      }
                      return 'AT % Rise / Fall Total';
                    })()}
                  </td>
                  {selectedJobsData.map(job => {
                    const atPct = getAtPercentageForCore(activeAtMaster, job.coreType);
                    const baseTot = calculateJobTotal(job);
                    const riseAmt = baseTot * (atPct / 100);
                    return (
                      <td key={job.id} className="p-2 border-r border-black text-right">
                        {riseAmt.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
                <tr className="border-t-2 border-black font-bold text-[10px]">
                  <td className="p-2 border-r-2 border-black text-right">Grand Total</td>
                  {selectedJobsData.map(job => {
                    const atPct = getAtPercentageForCore(activeAtMaster, job.coreType);
                    const baseTot = calculateJobTotal(job);
                    const grandTot = baseTot * (1 + atPct / 100);
                    return (
                      <td key={job.id} className="p-2 border-r border-black text-right">{grandTot.toFixed(2)}</td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
            
            <div className="flex justify-between items-end mt-8 text-black text-sm font-bold pb-16">
              <div>
                <p className="underline underline-offset-4">
                  Note - {selectedJobsData.some(j => j.status === 'Scrap' || j.condition === 'Scrap') ? 'Scrap Included' : ''}
                </p>
              </div>
              <div className="text-center">
                <p className="mb-12">For, {activeAgency?.name || ''}</p>
                <p>Auth Sign.</p>
              </div>
            </div>
          </div>

          {/* PAGE BREAK HERE for FORWARDING LETTER */}
          <div className="break-before-page"></div>

          {/* PAGE 2: FORWARDING LETTER */}
          <div className="bg-white p-12 mt-8 rounded shadow-sm border border-slate-200 print:shadow-none print:border-none print:p-0 print:mt-0 text-black">
            <LetterheadHeader agency={activeAgency} />

            <div className="flex justify-between text-sm font-bold mb-8">
              <div className="whitespace-pre-wrap">
                {forwardingTo || `Superintending Engineer (O & M),
Uttar Gujarat Vij Company Ltd.,
Circle Office : SABARMATI`}
              </div>
              <div className="text-right whitespace-pre-wrap">
                <p>REF. NO. : {refNoText}</p>
                <p className="mt-2">DATE : {letterDateText}</p>
              </div>
            </div>

            <div className="text-sm font-bold text-center underline underline-offset-4 mb-8">
              Sub. : {forwardingSub || 'Submiting Inspection Report & Estimate of Transformer'}
            </div>

            <p className="text-sm mb-6">Dear Sir,</p>
            <p className="text-sm mb-8 leading-relaxed ml-8 whitespace-pre-wrap">
              {refBodyText}
            </p>

            <table className="w-full text-center text-sm border-collapse border border-black mb-8">
              <thead>
                <tr className="font-bold border-b border-black">
                  <th className="p-2 border-r border-black">NO.</th>
                  <th className="p-2 border-r border-black">JOB. NO.</th>
                  <th className="p-2 border-r border-black">T.R. MAKE</th>
                  <th className="p-2 border-r border-black">TR. SR. NO.</th>
                  <th className="p-2 border-r border-black">KVA</th>
                  <th className="p-2 border-r border-black">KV</th>
                  <th className="p-2 border-r border-black">TRANS. TYPE</th>
                  <th className="p-2 border-r border-black">OGP/ GP</th>
                  <th className="p-2 border-r border-black">EST. AMT.</th>
                  <th className="p-2">REMARK</th>
                </tr>
              </thead>
              <tbody>
                {selectedJobsData.map((job, idx) => {
                   const jobBaseTotal = calculateJobTotal(job);
                   const atPct = getAtPercentageForCore(activeAtMaster, job.coreType);
                   const finalAmt = (jobBaseTotal * (1 + atPct / 100)).toFixed(2);
                   const isScrapJob = job.status === 'Scrap' || job.condition === 'Scrap';
                   
                  return (
                    <tr key={job.id} className="border-b border-black">
                      <td className="p-2 border-r border-black">{idx + 1}</td>
                      <td className="p-2 border-r border-black">{job.jobNo}</td>
                      <td className="p-2 border-r border-black">{job.make}</td>
                      <td className="p-2 border-r border-black">{job.serialNo}</td>
                      <td className="p-2 border-r border-black">{job.capacityKva}</td>
                      <td className="p-2 border-r border-black">11</td>
                      <td className="p-2 border-r border-black">{job.coreType || 'CRGO'}</td>
                      <td className="p-2 border-r border-black">OGP</td>
                      <td className="p-2 border-r border-black text-right">{finalAmt}</td>
                      <td className="p-2 text-center text-xs font-bold whitespace-nowrap">{isScrapJob ? 'SCRAP INCLUDED' : 'REPAIRABLE'}</td>
                    </tr>
                  )
                })}
                <tr className="font-bold border-black">
                  <td colSpan={8} className="p-2 border-r border-black text-right">TOTAL</td>
                  <td className="p-2 border-r border-black text-right">
                    {selectedJobsData.reduce((acc, job) => {
                      const baseAmt = calculateJobTotal(job);
                      const atPct = getAtPercentageForCore(activeAtMaster, job.coreType);
                      return acc + (baseAmt * (1 + atPct / 100));
                    }, 0).toFixed(2)}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>

            <p className="text-sm mb-12 whitespace-pre-wrap">{closingText}</p>

            <div className="flex justify-between text-sm mb-12">
              <p>Thanking you</p>
              <p>Yours faithfully</p>
            </div>

            <div className="flex justify-between text-sm mb-8">
              <p>Encl. : Estimate & Inspection Reports</p>
              <div className="text-center">
                <p className="mb-12 font-bold">{signedByText}</p>
                <p>Auth Sign.</p>
              </div>
            </div>

            <div className="text-sm font-bold">
              <p className="mb-4">C . C. to :</p>
              <p className="whitespace-pre-wrap">{forwardingCc || 'E. E. (O & M) DIVISION - SABARMATI'}</p>
            </div>
          </div>
        </div>
      </div>
      )}
      </>
      )}

      {/* TAB 2: SENT ESTIMATES (AWAITING APPROVAL) */}
      {activeTab === 'sent' && (
        <div className="space-y-5 print:hidden">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-xs flex items-center justify-between bg-gradient-to-br from-white to-amber-50/40">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Sent Estimates Awaiting Approval</p>
                <p className="text-2xl font-mono font-black text-amber-900 mt-1">{sentStats.pendingCount}</p>
                <p className="text-xs text-amber-700 mt-0.5">₹{sentStats.pendingValue.toLocaleString('en-IN')} Total Value</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                <Clock className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Cumulative Sent Estimates</p>
                <p className="text-2xl font-mono font-black text-slate-900 mt-1">{sentStats.totalCount}</p>
                <p className="text-xs text-slate-500 mt-0.5">₹{sentStats.totalValue.toLocaleString('en-IN')} Estimated</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Send className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Already Approved Estimates</p>
                <p className="text-2xl font-mono font-black text-emerald-800 mt-1">{sentStats.approvedCount}</p>
                <p className="text-xs text-emerald-600 mt-0.5">
                  <button 
                    onClick={() => setActiveTab('approvals')}
                    className="hover:underline font-bold text-emerald-700 inline-flex items-center gap-1"
                  >
                    <span>View Received Approvals</span> &rarr;
                  </button>
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
            </div>
          </div>

          {/* Search, Filters & Export */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row justify-between items-center gap-3">
            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto flex-1">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search MR No or Ref No..."
                  value={sentSearchQuery}
                  onChange={(e) => setSentSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 w-full bg-white outline-none"
                />
              </div>

              <select
                value={sentFilterDivision}
                onChange={(e) => setSentFilterDivision(e.target.value)}
                className="py-2 px-3 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-white font-medium text-slate-700 outline-none"
              >
                <option value="All">All Divisions</option>
                {divisions.map(d => (
                  <option key={d} value={d}>{d} Division</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const wsData = filteredSentEstimates.map(item => ({
                    'MR Number': item.mrNo,
                    'MR Date': item.mrDate,
                    'Division': item.division,
                    'Total Transformers': item.jobCount,
                    'Estimate Ref No': item.estimateRefNo,
                    'Estimate Sent Date': item.estimateSentDate,
                    'Estimate Amount (₹)': item.estimateAmount,
                    'Status': 'Awaiting DISCOM Approval',
                    'Remarks': item.approvalRemarks || '-'
                  }));
                  const ws = XLSX.utils.json_to_sheet(wsData);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, 'Sent Estimates');
                  XLSX.writeFile(wb, `Sent_Estimates_Awaiting_Approval_${new Date().toISOString().split('T')[0]}.xlsx`);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Export Excel</span>
              </button>
            </div>
          </div>

          {/* Sent Estimates Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-amber-600" />
                <h3 className="font-bold text-slate-800 text-xs sm:text-sm uppercase tracking-wider">
                  Sent Estimates Awaiting DISCOM Approval ({filteredSentEstimates.length})
                </h3>
              </div>
              <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-300">
                Awaiting Approval
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/70 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-4 py-3">MR Details</th>
                    <th className="px-4 py-3">Dispatch Details</th>
                    <th className="px-4 py-3 text-right">Estimated Amount</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSentEstimates.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                        <Send className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                        <p className="font-bold text-slate-600">No sent estimates currently awaiting approval</p>
                        <p className="text-xs text-slate-400 mt-0.5">Use the "Send Estimate" option in the Estimate Generator tab to dispatch an estimate to DISCOM.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredSentEstimates.map(item => (
                      <tr key={item.mrNo} className="hover:bg-slate-50/80 transition-colors">
                        {/* MR Details */}
                        <td className="px-4 py-3.5">
                          <span className="font-mono font-black text-slate-900 text-sm block">{item.mrNo}</span>
                          <span className="text-slate-600 font-medium">{item.division} Division • {item.jobCount} T/F</span>
                          {item.mrDate !== '-' && (
                            <span className="text-[10px] text-slate-400 block font-mono mt-0.5">MR Date: {item.mrDate}</span>
                          )}
                        </td>

                        {/* Dispatch Details */}
                        <td className="px-4 py-3.5">
                          <span className="font-mono font-bold text-slate-800 block text-xs">{item.estimateRefNo}</span>
                          <span className="text-slate-500 flex items-center mt-0.5 text-[11px]">
                            <Calendar className="w-3 h-3 mr-1 text-slate-400" /> Dispatched: {item.estimateSentDate}
                          </span>
                        </td>

                        {/* Amount */}
                        <td className="px-4 py-3.5 text-right font-mono font-black text-slate-900 text-sm">
                          ₹{item.estimateAmount.toLocaleString('en-IN')}
                        </td>

                        {/* Status Badge */}
                        <td className="px-4 py-3.5 text-center">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            <Clock className="w-3 h-3 mr-1 text-amber-600" /> Pending Approval
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            onClick={() => handleOpenApprModal(item.mrNo)}
                            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors shadow-xs inline-flex items-center gap-1"
                            title="Record DISCOM Approval No, Date & Amount"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Mark Approval Received</span>
                          </button>

                          <button
                            onClick={() => handleOpenSendModal(item.mrNo)}
                            className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg transition-colors inline-flex items-center gap-1"
                            title="Edit dispatch reference number or date"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Edit Dispatch</span>
                          </button>

                          <button
                            onClick={() => {
                              setSelectedMrNo(item.mrNo);
                              setActiveTab('generator');
                            }}
                            className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors inline-flex items-center gap-1"
                            title="View Estimate & Forwarding Letter"
                          >
                            <Eye className="w-3 h-3" />
                            <span>View / Print</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: RECEIVED APPROVALS */}
      {activeTab === 'approvals' && (
        <div className="space-y-5 print:hidden">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-xs flex items-center justify-between bg-gradient-to-br from-white to-emerald-50/40">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Total Received Approvals</p>
                <p className="text-2xl font-mono font-black text-emerald-900 mt-1">{sentStats.approvedCount}</p>
                <p className="text-xs text-emerald-700 mt-0.5">₹{sentStats.approvedValue.toLocaleString('en-IN')} Approved Value</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Approval Rate</p>
                <p className="text-2xl font-mono font-black text-slate-900 mt-1">
                  {sentStats.totalCount > 0 
                    ? `${Math.round((sentStats.approvedCount / sentStats.totalCount) * 100)}%` 
                    : '100%'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">{sentStats.approvedCount} of {sentStats.totalCount} sent estimates</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                <CheckSquare className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Pending Approvals</p>
                <p className="text-2xl font-mono font-black text-amber-800 mt-1">{sentStats.pendingCount}</p>
                <p className="text-xs text-amber-600 mt-0.5">
                  <button 
                    onClick={() => setActiveTab('sent')}
                    className="hover:underline font-bold text-amber-700 inline-flex items-center gap-1"
                  >
                    <span>View Sent Estimates</span> &rarr;
                  </button>
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <Clock className="w-6 h-6" />
              </div>
            </div>
          </div>

          {/* Search, Filters & Export */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row justify-between items-center gap-3">
            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto flex-1">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search MR No, Approval No, or Ref No..."
                  value={apprSearchQuery}
                  onChange={(e) => setApprSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 w-full bg-white outline-none"
                />
              </div>

              <select
                value={apprFilterDivision}
                onChange={(e) => setApprFilterDivision(e.target.value)}
                className="py-2 px-3 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white font-medium text-slate-700 outline-none"
              >
                <option value="All">All Divisions</option>
                {divisions.map(d => (
                  <option key={d} value={d}>{d} Division</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const wsData = filteredApprovedEstimates.map(item => ({
                    'MR Number': item.mrNo,
                    'MR Date': item.mrDate,
                    'Division': item.division,
                    'Total Transformers': item.jobCount,
                    'Estimate Ref No': item.estimateRefNo,
                    'Estimate Sent Date': item.estimateSentDate,
                    'Original Estimate Amount (₹)': item.estimateAmount,
                    'Approval Order No': item.approvalNo,
                    'Approval Date': item.approvalDate,
                    'Approved Amount (₹)': item.approvedAmount,
                    'Approval Status': 'Approved by DISCOM',
                    'Remarks / Scope': item.approvalRemarks || '-'
                  }));
                  const ws = XLSX.utils.json_to_sheet(wsData);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, 'Received Approvals');
                  XLSX.writeFile(wb, `Received_Estimate_Approvals_${new Date().toISOString().split('T')[0]}.xlsx`);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Export Excel</span>
              </button>
            </div>
          </div>

          {/* Received Approvals Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <h3 className="font-bold text-slate-800 text-xs sm:text-sm uppercase tracking-wider">
                  Received Estimate Approvals Register ({filteredApprovedEstimates.length})
                </h3>
              </div>
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-300">
                Officially Approved
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/70 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-4 py-3">Approval Details</th>
                    <th className="px-4 py-3">MR & Division</th>
                    <th className="px-4 py-3 text-right">Approved Amount</th>
                    <th className="px-4 py-3">Remarks / Scope</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredApprovedEstimates.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                        <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                        <p className="font-bold text-slate-600">No approved estimates recorded yet</p>
                        <p className="text-xs text-slate-400 mt-0.5">When DISCOM issues approval for an estimate, click "Mark Approval Received" on the Sent Estimates tab.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredApprovedEstimates.map(item => (
                      <tr key={item.mrNo} className="hover:bg-slate-50/80 transition-colors">
                        {/* Approval Details */}
                        <td className="px-4 py-3.5">
                          <span className="font-mono font-bold text-emerald-900 text-xs block">{item.approvalNo}</span>
                          <span className="text-slate-500 flex items-center mt-0.5 text-[11px]">
                            <Calendar className="w-3 h-3 mr-1 text-slate-400" /> Approval Date: {item.approvalDate}
                          </span>
                          <span className="text-[10px] text-slate-400 block font-mono">Ref: {item.estimateRefNo}</span>
                        </td>

                        {/* MR Details */}
                        <td className="px-4 py-3.5">
                          <span className="font-mono font-black text-slate-900 text-sm block">{item.mrNo}</span>
                          <span className="text-slate-600 font-medium">{item.division} Division • {item.jobCount} T/F</span>
                        </td>

                        {/* Approved Amount */}
                        <td className="px-4 py-3.5 text-right">
                          <span className="font-mono font-black text-emerald-800 text-sm block">
                            ₹{item.approvedAmount.toLocaleString('en-IN')}
                          </span>
                          {item.approvedAmount !== item.estimateAmount && (
                            <span className="text-[10px] text-slate-400 block">
                              Est: ₹{item.estimateAmount.toLocaleString('en-IN')}
                            </span>
                          )}
                        </td>

                        {/* Remarks */}
                        <td className="px-4 py-3.5 text-slate-600 max-w-[200px]">
                          {item.approvalRemarks ? (
                            <span className="italic text-xs text-slate-700 block">"{item.approvalRemarks}"</span>
                          ) : (
                            <span className="text-slate-400 text-[11px]">-</span>
                          )}
                        </td>

                        {/* Status Badge */}
                        <td className="px-4 py-3.5 text-center">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" /> Approved
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            onClick={() => handleOpenApprModal(item.mrNo)}
                            className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg transition-colors inline-flex items-center gap-1"
                            title="Edit Approval Details"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Edit Approval</span>
                          </button>

                          <button
                            onClick={() => {
                              setSelectedMrNo(item.mrNo);
                              setActiveTab('generator');
                            }}
                            className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors inline-flex items-center gap-1"
                            title="View Full Estimate & Documents"
                          >
                            <Eye className="w-3 h-3" />
                            <span>View Estimate</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: SEND ESTIMATE (Prompt for Ref No and Date) */}
      {showSendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-3 bg-purple-100 text-purple-700 rounded-xl">
                  <Send className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Send Estimate to DISCOM</h3>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">MR Number: <strong>{sendTargetMr}</strong></p>
                </div>
              </div>
              <button onClick={() => setShowSendModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs text-purple-900 flex justify-between items-center">
              <div>
                <span className="text-purple-700 block font-medium">Estimated Value:</span>
                <span className="text-base font-mono font-black text-purple-950">
                  ₹{calculateMrEstimateTotal(sendTargetMr).toLocaleString('en-IN')}
                </span>
              </div>
              <div className="text-right">
                <span className="text-purple-700 block font-medium">Transformers:</span>
                <span className="font-bold text-purple-950">{(mrGroups[sendTargetMr] || []).length} Units</span>
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Dispatch Reference Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={sendRefNo}
                  onChange={(e) => setSendRefNo(e.target.value)}
                  placeholder="e.g. UGVCL/EE-T-1/TRANS-REP/123"
                  className="w-full px-3 py-2 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Estimate Sent Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={sendDate}
                  onChange={(e) => setSendDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Remarks / Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={sendRemarks}
                  onChange={(e) => setSendRemarks(e.target.value)}
                  placeholder="e.g. Submitted by hand to Circle Office"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2.5 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowSendModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingSend || !sendRefNo.trim()}
                onClick={handleConfirmSendEstimate}
                className="px-5 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors flex items-center space-x-1.5 shadow-sm disabled:opacity-50"
              >
                {submittingSend ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Confirm & Mark as Sent</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: MARK APPROVAL RECEIVED */}
      {showApprModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-3 bg-emerald-100 text-emerald-700 rounded-xl">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Record Estimate Approval</h3>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">MR Number: <strong>{apprTargetMr}</strong></p>
                </div>
              </div>
              <button onClick={() => setShowApprModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-900 flex justify-between items-center">
              <div>
                <span className="text-emerald-700 block font-medium">Estimated Amount:</span>
                <span className="text-base font-mono font-black text-emerald-950">
                  ₹{calculateMrEstimateTotal(apprTargetMr).toLocaleString('en-IN')}
                </span>
              </div>
              <div className="text-right">
                <span className="text-emerald-700 block font-medium">Status:</span>
                <span className="font-bold text-emerald-800">DISCOM Official Approval</span>
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Approval Letter / Order No. <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={apprNo}
                  onChange={(e) => setApprNo(e.target.value)}
                  placeholder="e.g. UGVCL/SE-TR/APPR/2026/123"
                  className="w-full px-3 py-2 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Approval Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={apprDate}
                    onChange={(e) => setApprDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Approved Amount (₹)
                  </label>
                  <input
                    type="number"
                    value={apprAmount}
                    onChange={(e) => setApprAmount(e.target.value)}
                    placeholder="Approved Amt"
                    className="w-full px-3 py-2 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Approval Remarks (Optional)
                </label>
                <textarea
                  rows={2}
                  value={apprRemarks}
                  onChange={(e) => setApprRemarks(e.target.value)}
                  placeholder="e.g. Approved with 100% repair scope"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2.5 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowApprModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingAppr || !apprNo.trim()}
                onClick={handleConfirmApproval}
                className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors flex items-center space-x-1.5 shadow-sm disabled:opacity-50"
              >
                {submittingAppr ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Confirm Approval Received</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT / CUSTOMIZE FORWARDING LETTER MODAL */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-2xl w-full border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200">
              <div className="flex items-center space-x-2 text-slate-800">
                <Edit3 className="w-5 h-5 text-amber-600" />
                <h3 className="font-bold text-base">Customize Forwarding Letter Details</h3>
              </div>
              <button onClick={() => setShowEditModal(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">REF. NO.</label>
                  <input type="text" value={refNoText} onChange={e => setRefNoText(e.target.value)} className="w-full px-3 py-2 text-sm border rounded bg-slate-50 focus:bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">DATE</label>
                  <input type="text" value={letterDateText} onChange={e => setLetterDateText(e.target.value)} className="w-full px-3 py-2 text-sm border rounded bg-slate-50 focus:bg-white" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Forwarding To (Recipient Address)</label>
                <textarea rows={3} value={forwardingTo} onChange={e => setForwardingTo(e.target.value)} className="w-full px-3 py-2 text-sm border rounded bg-slate-50 focus:bg-white font-mono text-xs" />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Subject (Sub.)</label>
                <input type="text" value={forwardingSub} onChange={e => setForwardingSub(e.target.value)} className="w-full px-3 py-2 text-sm border rounded bg-slate-50 focus:bg-white" />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Opening Reference Body Text</label>
                <textarea rows={2} value={refBodyText} onChange={e => setRefBodyText(e.target.value)} className="w-full px-3 py-2 text-sm border rounded bg-slate-50 focus:bg-white" />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Closing Request Message</label>
                <input type="text" value={closingText} onChange={e => setClosingText(e.target.value)} className="w-full px-3 py-2 text-sm border rounded bg-slate-50 focus:bg-white" />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Authorized Signatory Title</label>
                <input type="text" value={signedByText} onChange={e => setSignedByText(e.target.value)} className="w-full px-3 py-2 text-sm border rounded bg-slate-50 focus:bg-white" />
              </div>

              <div className="bg-slate-50 p-3 rounded-lg border border-slate-300 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    {isCcLocked ? (
                      <span className="inline-flex items-center gap-1 text-slate-800">
                        <Lock className="w-3.5 h-3.5 text-amber-600" /> C . C. to :
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-blue-700">
                        <Unlock className="w-3.5 h-3.5 text-blue-600" /> C . C. to : (Unlocked)
                      </span>
                    )}
                  </label>
                  <div className="flex items-center gap-2">
                    {isCcLocked ? (
                      <button
                        type="button"
                        onClick={() => setShowCcUnlockModal(true)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold uppercase text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded transition-colors shadow-xs"
                      >
                        <Unlock className="w-3 h-3 text-amber-600" /> Unlock
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setForwardingCc(getEstimateCcText(activeAgency, currentSelectedDivision))}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-slate-600 hover:text-slate-900 bg-slate-200 hover:bg-slate-300 rounded transition-colors"
                          title="Reset to default format"
                        >
                          <RotateCcw className="w-3 h-3" /> Reset
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsCcLocked(true)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold uppercase text-slate-700 bg-slate-200 hover:bg-slate-300 rounded transition-colors"
                        >
                          <Lock className="w-3 h-3" /> Lock
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <textarea
                    rows={2}
                    readOnly={isCcLocked}
                    value={forwardingCc}
                    onChange={e => setForwardingCc(e.target.value)}
                    className={`w-full px-3 py-2 text-sm border rounded font-mono text-xs transition-all ${
                      isCcLocked
                        ? 'bg-slate-200/70 text-slate-700 border-slate-300 font-bold select-none cursor-not-allowed'
                        : 'bg-white text-slate-900 border-blue-500 font-bold ring-2 ring-blue-100'
                    }`}
                  />
                  {isCcLocked && (
                    <span className="absolute right-2 top-2 text-[10px] uppercase font-bold text-amber-800 bg-amber-100/90 px-1.5 py-0.5 rounded border border-amber-200 flex items-center">
                      <Lock className="w-2.5 h-2.5 mr-1" /> Locked Standard
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-500">
                  Standard format: <strong className="font-mono text-slate-700">E. E. (O & M) DIVISION - {currentSelectedDivision}</strong>
                </p>
              </div>

              <div className="bg-amber-50 border border-amber-200 p-3 rounded flex items-center space-x-2 text-xs text-amber-800">
                <input
                  type="checkbox"
                  id="saveAgencyDefaultEst"
                  checked={saveAsDefault}
                  onChange={e => setSaveAsDefault(e.target.checked)}
                  className="rounded text-amber-600 focus:ring-amber-500 w-4 h-4"
                />
                <label htmlFor="saveAgencyDefaultEst" className="cursor-pointer font-medium">
                  Save Recipient, Subject & C.C. as default configuration for {activeAgency?.name || 'active agency'}
                </label>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-200 flex justify-end space-x-3">
              <button onClick={() => setShowEditModal(false)} className="px-4 py-2 text-xs font-bold uppercase text-slate-600 hover:text-slate-800 border rounded">
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (saveAsDefault && activeAgency) {
                    await updateAgency(activeAgency.id, {
                      forwardingToText: forwardingTo,
                      forwardingSubject: forwardingSub,
                      forwardingCcText: forwardingCc
                    });
                  }
                  setShowEditModal(false);
                }}
                className="px-5 py-2 text-xs font-bold uppercase bg-emerald-600 hover:bg-emerald-700 text-white rounded transition-colors flex items-center"
              >
                <Check className="w-4 h-4 mr-1.5" /> Confirm & Apply To Document
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alert / Warning Modal for Unlocking C.C. in Estimate Generator */}
      {showCcUnlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start space-x-3.5">
              <div className="p-3 bg-amber-100 text-amber-700 rounded-xl flex-shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-slate-900">
                  Unlock C.C. Copy Field?
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Standard DISCOM Routing Protection
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 text-xs text-amber-900 space-y-2">
              <p className="font-semibold text-amber-900">
                Standard C.C. recipient is locked by default:
              </p>
              <div className="p-2 bg-white rounded border border-amber-300 font-mono font-bold text-slate-800 text-center select-all">
                E. E. (O & M) DIVISION - {currentSelectedDivision}
              </div>
              <p className="text-[11px] text-amber-800 leading-normal">
                <strong>Notice:</strong> Changing the C.C. recipient will modify the printed forwarding letter for this estimate batch.
              </p>
            </div>

            <p className="text-xs text-slate-600">
              Do you want to unlock and edit the C.C. recipient?
            </p>

            <div className="flex items-center justify-end space-x-2.5 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowCcUnlockModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Keep Locked
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCcLocked(false);
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
    </div>
  );
}
