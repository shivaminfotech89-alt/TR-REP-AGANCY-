import React, { useState, useEffect, useMemo } from 'react';
import { useAgency, getAtPercentageForCore, getEstimateMasterForCore } from '../lib/AgencyContext';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Loader2, Printer, Search, FileText, ArrowLeft, CheckCircle2, ShieldCheck, FileSpreadsheet, Droplets, AlertTriangle, AlertCircle, X, Calendar, Download, Save } from 'lucide-react';
import * as XLSX from 'xlsx';
import { defaultEstimateData } from '../lib/estimateData';
import { LetterheadHeader } from './LetterheadHeader';

// Helper to convert number to Indian Rupees in words
export function numberToIndianWords(num: number): string {
  if (isNaN(num) || num === 0) return 'Zero Rupees Only';

  const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const parts = num.toFixed(2).split('.');
  const rupees = parseInt(parts[0], 10);
  const paisa = parseInt(parts[1], 10);

  function inWords(n: number): string {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + a[n % 10] : ' ');
    if (n < 1000) return a[Math.floor(n / 100)] + 'Hundred ' + (n % 100 !== 0 ? 'and ' + inWords(n % 100) : '');
    if (n < 100000) return inWords(Math.floor(n / 1000)) + 'Thousand ' + (n % 1000 !== 0 ? inWords(n % 1000) : '');
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + 'Lakh ' + (n % 100000 !== 0 ? inWords(n % 100000) : '');
    return inWords(Math.floor(n / 10000000)) + 'Crore ' + (n % 10000000 !== 0 ? inWords(n % 10000000) : '');
  }

  let str = 'Rupees ' + inWords(rupees);
  if (paisa > 0) {
    str += 'and ' + inWords(paisa) + 'Paisa ';
  }
  return str.trim() + ' Only';
}

export default function BillingSystem() {
  const { activeAgency, activeAtMaster } = useAgency();
  const [jobs, setJobs] = useState<any[]>([]);
  const [inspections, setInspections] = useState<any[]>([]);
  const [oilTransactions, setOilTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedMrNo, setSelectedMrNo] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDivision, setSelectedDivision] = useState<string>('All');
  const [billTypeFilter, setBillTypeFilter] = useState<'repairable' | 'scrap'>('repairable');

  // Active Document Tab for preview
  const [activeDocTab, setActiveDocTab] = useState<'all' | 'forwarding' | 'certificate' | 'invoice' | 'oil'>('all');

  // Editable Bill Meta Info
  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [apprNo, setApprNo] = useState('');
  const [apprDate, setApprDate] = useState('');
  const [divisionGstin, setDivisionGstin] = useState('');

  // Modal State for Pending Delivery Alert
  const [pendingAlertModal, setPendingAlertModal] = useState<{
    isOpen: boolean;
    mrNo: string;
    totalCount: number;
    deliveredCount: number;
    pendingCount: number;
  } | null>(null);

  const masterData = activeAgency?.estimateMaster?.length > 0 ? activeAgency.estimateMaster : defaultEstimateData;

  useEffect(() => {
    async function fetchData() {
      if (!auth.currentUser || !activeAgency) { setLoading(false); return; }
      setLoading(true);
      try {
        const [jobsSnap, inspSnap, oilSnap] = await Promise.all([
          getDocs(query(
            collection(db, 'jobs'),
            where('ownerId', '==', auth.currentUser.uid),
            where('agencyId', '==', activeAgency.id)
          )),
          getDocs(query(
            collection(db, 'inspections'),
            where('ownerId', '==', auth.currentUser.uid),
            where('type', '==', 'External')
          )),
          getDocs(query(
            collection(db, 'oilTransactions'),
            where('ownerId', '==', auth.currentUser.uid),
            where('agencyId', '==', activeAgency.id)
          ))
        ]);

        const fetchedJobs = jobsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const fetchedInsps = inspSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const fetchedOil = oilSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        setJobs(fetchedJobs);
        setInspections(fetchedInsps);
        setOilTransactions(fetchedOil);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'jobs');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [activeAgency]);

  // Dynamic divisions list
  const divisions = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach(j => {
      if (j.division) set.add(j.division);
    });
    return Array.from(set).sort();
  }, [jobs]);

  // Group all jobs by MR
  const mrGroups = useMemo(() => {
    const groups: Record<string, any[]> = {};
    jobs.forEach(j => {
      if (!j.mrNo) return;
      if (!groups[j.mrNo]) groups[j.mrNo] = [];
      groups[j.mrNo].push(j);
    });
    return groups;
  }, [jobs]);

  // Filter MRs matching search & division
  const filteredMrNos = useMemo(() => {
    return Object.keys(mrGroups).filter(mr => {
      const groupJobs = mrGroups[mr] || [];
      const matchesSearch = !searchQuery || mr.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesDivision = selectedDivision === 'All' || groupJobs.some(j => j.division === selectedDivision);

      const hasMatchingType = groupJobs.some(j => {
        const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
        return billTypeFilter === 'scrap' ? isScrap : !isScrap;
      });

      return matchesSearch && matchesDivision && hasMatchingType;
    }).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [mrGroups, searchQuery, selectedDivision, billTypeFilter]);

  // Selected DELIVERED jobs for the active bill
  const selectedJobsData = useMemo(() => {
    if (!selectedMrNo) return [];
    const mrJobs = jobs.filter(j => j.mrNo === selectedMrNo);
    return mrJobs.filter(j => {
      if (j.status !== 'Dispatched') return false; // Must be delivered/dispatched
      const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
      return billTypeFilter === 'scrap' ? isScrap : !isScrap;
    }).sort((a, b) => (a.jobNo || '').localeCompare(b.jobNo || '', undefined, { numeric: true }));
  }, [jobs, selectedMrNo, billTypeFilter]);

  // Selected MR pending jobs count
  const selectedMrPendingCount = useMemo(() => {
    if (!selectedMrNo) return 0;
    const mrJobs = jobs.filter(j => j.mrNo === selectedMrNo);
    const targetJobs = mrJobs.filter(j => {
      const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
      return billTypeFilter === 'scrap' ? isScrap : !isScrap;
    });
    return targetJobs.filter(j => j.status !== 'Dispatched').length;
  }, [jobs, selectedMrNo, billTypeFilter]);

  // Selected MR Division Name
  const currentDivision = useMemo(() => {
    if (selectedJobsData.length > 0) return selectedJobsData[0].division || 'SABARMATI';
    const mrJobs = jobs.filter(j => j.mrNo === selectedMrNo);
    if (mrJobs.length > 0) return mrJobs[0].division || 'SABARMATI';
    return 'SABARMATI';
  }, [selectedJobsData, jobs, selectedMrNo]);

  // Selected MR Date
  const selectedMrDate = useMemo(() => {
    if (!selectedMrNo) return billDate;
    const mrJobs = jobs.filter(j => j.mrNo === selectedMrNo);
    const sample = mrJobs[0];
    if (sample?.dateOfIssue) return sample.dateOfIssue;
    if (sample?.mrDate) return sample.mrDate;
    if (sample?.createdAt) {
      const d = new Date(sample.createdAt);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
    const tx = oilTransactions.find(t => t.mrNo === selectedMrNo && t.mrDate);
    if (tx?.mrDate) return tx.mrDate;
    return billDate;
  }, [selectedMrNo, jobs, oilTransactions, billDate]);

  // Set default bill metadata when an MR is picked
  const handleSelectMr = (mr: string) => {
    setSelectedMrNo(mr);
    const mrJobs = jobs.filter(j => j.mrNo === mr);
    const orderNum = activeAtMaster?.atNumber || mrJobs[0]?.atNumber || 'UGVCL/EE-T-1/Trans.Rep/2020-21/01/1052';
    
    setBillNo(`HE/T-${String(Math.floor(Math.random() * 90 + 10))}/26-27`);
    setBillDate(new Date().toISOString().split('T')[0]);
    setApprNo(orderNum);
    setApprDate('02.03.2026');
    setDivisionGstin('24AAACU6551F1ZI');
  };

  const handleGenerateClick = (mr: string) => {
    const allMrJobs = jobs.filter(j => j.mrNo === mr);
    const targetJobs = allMrJobs.filter(j => {
      const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
      return billTypeFilter === 'scrap' ? isScrap : !isScrap;
    });
    const delJobs = targetJobs.filter(j => j.status === 'Dispatched');
    const pendJobs = targetJobs.filter(j => j.status !== 'Dispatched');

    if (delJobs.length === 0) {
      alert(`No delivered transformers found for MR ${mr}. Please create delivery challans and dispatch jobs first.`);
      return;
    }

    if (pendJobs.length > 0) {
      setPendingAlertModal({
        isOpen: true,
        mrNo: mr,
        totalCount: targetJobs.length,
        deliveredCount: delJobs.length,
        pendingCount: pendJobs.length,
      });
    } else {
      handleSelectMr(mr);
    }
  };

  // Calculate job estimate / bill amount
  const calculateJobTotal = (job: any) => {
    let jobTotal = 0;
    const kva = String(job.capacityKva);
    const isScrapJob = job.status === 'Scrap' || job.condition === 'Scrap';
    const jobMasterData = getEstimateMasterForCore(activeAgency, job.coreType);

    jobMasterData.forEach(item => {
      const rawRate = item.rates[kva as keyof typeof item.rates] || 0;
      const rate = typeof rawRate === 'string' ? parseFloat(rawRate) : Number(rawRate);
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
      if (item.unit === 'N') qty = 0;
      jobTotal += (qty * rate);
    });

    const atPct = getAtPercentageForCore(activeAtMaster, job.coreType);
    return jobTotal * (1 + atPct / 100);
  };

  // Billing Financial Calculations
  const subTotal = useMemo(() => {
    return selectedJobsData.reduce((acc, job) => acc + calculateJobTotal(job), 0);
  }, [selectedJobsData, masterData]);

  const cgst = useMemo(() => subTotal * 0.09, [subTotal]);
  const sgst = useMemo(() => subTotal * 0.09, [subTotal]);
  const grandTotal = useMemo(() => subTotal + cgst + sgst, [subTotal, cgst, sgst]);

  // Oil Data Calculations for Oil Account Document (Page 4)
  const jobOilDetails = useMemo(() => {
    return selectedJobsData.map(job => {
      const insp = inspections.find(i => i.jobId === job.id);
      const kva = Number(job.capacityKva) || 25;
      
      // Standard capacity calculation if missing
      const defaultCap = kva <= 16 ? 140 : kva <= 25 ? 184 : kva <= 63 ? 240 : 323;
      const oilCap = Number(insp?.data?.oilCapLtrs) || defaultCap;
      const lessOil = Number(insp?.data?.lessOilLtrs) || 0;
      const oilRecd = Math.max(0, oilCap - lessOil);
      const baseShortage = oilCap - oilRecd;
      const filterLoss = oilRecd * 0.05; // 5% filtration loss on received oil

      const netShortage = (insp && insp.data && typeof insp.data.netShortage === 'number')
        ? insp.data.netShortage
        : (baseShortage + filterLoss);

      return {
        job,
        oilCap,
        oilRecd,
        baseShortage,
        filterLoss,
        netShortage
      };
    });
  }, [selectedJobsData, inspections]);

  const totalOilCapacity = useMemo(() => jobOilDetails.reduce((a, b) => a + b.oilCap, 0), [jobOilDetails]);
  const totalOilReceived = useMemo(() => jobOilDetails.reduce((a, b) => a + b.oilRecd, 0), [jobOilDetails]);
  const totalBaseShortage = useMemo(() => jobOilDetails.reduce((a, b) => a + b.baseShortage, 0), [jobOilDetails]);
  const totalFilterLoss = useMemo(() => jobOilDetails.reduce((a, b) => a + b.filterLoss, 0), [jobOilDetails]);
  const totalNetShortage = useMemo(() => jobOilDetails.reduce((a, b) => a + b.netShortage, 0), [jobOilDetails]);

  // Helpers for date parsing and division filtering
  const parseDateToTimestamp = (dateVal: any): number => {
    if (!dateVal) return 0;
    if (typeof dateVal === 'number') return dateVal;
    if (dateVal.seconds) return dateVal.seconds * 1000;
    if (typeof dateVal === 'string') {
      const s = dateVal.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const [y, m, d] = s.split('T')[0].split('-').map(Number);
        return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
      }
      if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(s)) {
        const parts = s.split(/[-/]/);
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        return new Date(year, month, day, 23, 59, 59, 999).getTime();
      }
      const parsed = new Date(s).getTime();
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  };

  const formatDateStr = (dateVal: any): string => {
    if (!dateVal) return '';
    if (typeof dateVal === 'string') return dateVal;
    if (typeof dateVal === 'number') {
      const d = new Date(dateVal);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
    if (dateVal?.seconds) {
      const d = new Date(dateVal.seconds * 1000);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
    return '';
  };

  const mrOilTxList = useMemo(() => {
    if (!selectedMrNo) return [];
    const cleanSelectedMr = selectedMrNo.trim().toLowerCase();
    return oilTransactions.filter(t => {
      // If transaction specifies division, ensure it matches currentDivision or allow if matching explicit MR No
      if (t.division && currentDivision && t.division !== currentDivision) {
        if (!t.mrNo || t.mrNo.trim().toLowerCase() !== cleanSelectedMr) return false;
      }

      // Match explicit MR No
      if (t.mrNo && t.mrNo.trim().toLowerCase() === cleanSelectedMr) return true;

      // Or if no MR specified, match by MR date or date matching selected MR Date
      if (!t.mrNo || t.mrNo.trim() === '') {
        const tDateStr = t.mrDate || formatDateStr(t.date);
        if (tDateStr && selectedMrDate && tDateStr === selectedMrDate) return true;
      }
      return false;
    });
  }, [oilTransactions, selectedMrNo, currentDivision, selectedMrDate]);

  const mrInwardOilTotal = useMemo(() => {
    return mrOilTxList.reduce((acc, tx) => acc + (Number(tx.netLiters) || 0), 0);
  }, [mrOilTxList]);

  // Previous MR & Oil Shortage Balance
  const previousMrLedger = useMemo(() => {
    if (!selectedMrNo || !selectedMrDate) {
      return {
        prevMrNo: '',
        prevMrDate: '',
        prevBillNo: '',
        prevBillDate: '',
        prevNetShortage: 0
      };
    }

    const currentMrTime = parseDateToTimestamp(selectedMrDate);

    // Map all distinct MRs in system for currentDivision except current
    const mrMap: Record<string, { mrNo: string; mrDate: string }> = {};

    jobs.forEach(j => {
      if (!j.mrNo || j.mrNo === selectedMrNo) return;
      if (j.division && currentDivision && j.division !== currentDivision) return; // Specific division only
      if (!mrMap[j.mrNo]) {
        const d = j.dateOfIssue || j.mrDate || (j.createdAt ? formatDateStr(j.createdAt) : '');
        mrMap[j.mrNo] = { mrNo: j.mrNo, mrDate: d };
      }
    });

    oilTransactions.forEach(t => {
      if (!t.mrNo || t.mrNo === selectedMrNo) return;
      if (t.division && currentDivision && t.division !== currentDivision) return; // Specific division only
      if (!mrMap[t.mrNo]) {
        mrMap[t.mrNo] = { mrNo: t.mrNo, mrDate: t.mrDate || '' };
      } else if (!mrMap[t.mrNo].mrDate && t.mrDate) {
        mrMap[t.mrNo].mrDate = t.mrDate;
      }
    });

    const prevMrs = Object.values(mrMap).filter(m => {
      if (!m.mrDate) return false;
      const t = parseDateToTimestamp(m.mrDate);
      return t < currentMrTime || (t === currentMrTime && m.mrNo < selectedMrNo);
    }).sort((a, b) => {
      const tA = parseDateToTimestamp(a.mrDate);
      const tB = parseDateToTimestamp(b.mrDate);
      if (tA !== tB) return tB - tA;
      return b.mrNo.localeCompare(a.mrNo, undefined, { numeric: true });
    });

    const mostRecentPrevMr = prevMrs[0] || null;

    if (!mostRecentPrevMr) {
      return {
        prevMrNo: '',
        prevMrDate: '',
        prevBillNo: '',
        prevBillDate: '',
        prevNetShortage: 0
      };
    }

    const prevMrSet = new Set(prevMrs.map(m => m.mrNo));

    // Calculate cumulative net required oil for previous dispatched jobs in currentDivision
    const prevDispatchedJobs = jobs.filter(j => {
      if (!j.mrNo || !prevMrSet.has(j.mrNo)) return false;
      if (j.division && currentDivision && j.division !== currentDivision) return false;
      if (j.status !== 'Dispatched') return false;
      return true;
    });

    const prevTotalNetRequired = prevDispatchedJobs.reduce((sum, j) => {
      const insp = inspections.find(i => i.jobId === j.id);
      const kva = Number(j.capacityKva) || 25;
      const defaultCap = kva <= 16 ? 140 : kva <= 25 ? 184 : kva <= 63 ? 240 : 323;
      const oilCap = Number(insp?.data?.oilCapLtrs) || defaultCap;
      const lessOil = Number(insp?.data?.lessOilLtrs) || 0;
      const oilRecd = Math.max(0, oilCap - lessOil);
      const baseShortage = oilCap - oilRecd;
      const filterLoss = oilRecd * 0.05;
      const netShortage = (insp && insp.data && typeof insp.data.netShortage === 'number')
        ? insp.data.netShortage
        : (baseShortage + filterLoss);
      return sum + netShortage;
    }, 0);

    // Calculate cumulative inward oil received on previous MRs
    const prevInwardTx = oilTransactions.filter(t => {
      if (!t.mrNo || !prevMrSet.has(t.mrNo)) return false;
      if (t.division && currentDivision && t.division !== currentDivision) return false;
      return true;
    });

    const prevTotalInward = prevInwardTx.reduce((sum, t) => sum + (Number(t.netLiters) || 0), 0);

    const prevNetShortage = prevTotalNetRequired - prevTotalInward;

    return {
      prevMrNo: mostRecentPrevMr.mrNo,
      prevMrDate: mostRecentPrevMr.mrDate,
      prevBillNo: `HE/T-${mostRecentPrevMr.mrNo}/26-27`,
      prevBillDate: mostRecentPrevMr.mrDate,
      prevNetShortage
    };
  }, [selectedMrNo, selectedMrDate, currentDivision, jobs, inspections, oilTransactions]);

  const netOilDue = useMemo(() => {
    return totalNetShortage + previousMrLedger.prevNetShortage - mrInwardOilTotal;
  }, [totalNetShortage, previousMrLedger.prevNetShortage, mrInwardOilTotal]);

  const handlePrint = () => {
    window.print();
  };

  const handleExportExcel = () => {
    if (!selectedMrNo || selectedJobsData.length === 0) return;

    const wsData: any[][] = [];
    wsData.push([`TAX INVOICE / REPAIR BILL - MR NO: ${selectedMrNo}`]);
    wsData.push([`Bill No: ${billNo}`, `Bill Date: ${billDate}`, `Division: ${currentDivision}`]);
    wsData.push([`Appr No: ${apprNo}`, `Appr Date: ${apprDate}`, `Division GSTIN: ${divisionGstin}`]);
    wsData.push([]);

    // Table Header
    wsData.push(['SR.', 'JOB NO', 'KVA', 'MAKE', 'SERIAL NO', 'CORE TYPE', 'BASE COST', 'AT % RISE/FALL', 'TOTAL AMOUNT']);

    let subTotal = 0;
    selectedJobsData.forEach((job, idx) => {
      const baseAmt = calculateJobTotal(job);
      const atPct = getAtPercentageForCore(activeAtMaster, job.coreType);
      const grandAmt = baseAmt * (1 + atPct / 100);
      subTotal += grandAmt;

      wsData.push([
        idx + 1,
        job.jobNo,
        `${job.capacityKva} KVA`,
        job.make,
        job.serialNo,
        job.coreType || 'CRGO',
        Number(baseAmt.toFixed(2)),
        `${atPct >= 0 ? '+' : ''}${atPct.toFixed(2)}%`,
        Number(grandAmt.toFixed(2))
      ]);
    });

    const cgstRate = activeAgency?.cgstPercent !== undefined ? activeAgency.cgstPercent : 9;
    const sgstRate = activeAgency?.sgstPercent !== undefined ? activeAgency.sgstPercent : 9;
    const cgstAmount = subTotal * (cgstRate / 100);
    const sgstAmount = subTotal * (sgstRate / 100);
    const grandTotal = subTotal + cgstAmount + sgstAmount;

    wsData.push([]);
    wsData.push(['', '', '', '', '', '', 'SUB TOTAL', '', Number(subTotal.toFixed(2))]);
    wsData.push(['', '', '', '', '', '', `CGST (${cgstRate.toFixed(1)}%)`, '', Number(cgstAmount.toFixed(2))]);
    wsData.push(['', '', '', '', '', '', `SGST (${sgstRate.toFixed(1)}%)`, '', Number(sgstAmount.toFixed(2))]);
    wsData.push(['', '', '', '', '', '', 'GRAND TOTAL', '', Number(grandTotal.toFixed(2))]);
    
    if (netOilDue > 0) {
      const oilRatePerLtr = 110;
      const netOilCostDeduction = netOilDue * oilRatePerLtr;
      const netPayableAfterOil = grandTotal - netOilCostDeduction;
      wsData.push(['', '', '', '', '', '', 'LESS: OIL SHORTAGE DEDUCTION', '', Number(netOilCostDeduction.toFixed(2))]);
      wsData.push(['', '', '', '', '', '', 'NET PAYABLE AMOUNT', '', Number(netPayableAfterOil.toFixed(2))]);
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tax Invoice");
    XLSX.writeFile(wb, `Tax_Invoice_MR_${selectedMrNo}_Bill_${billNo}.xlsx`);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto print:max-w-none print:w-full print:m-0 print:p-0">
      
      {!selectedMrNo ? (
        <div className="space-y-6 print:hidden">
          {/* Header Banner */}
          <div className="bg-white p-6 rounded shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Billing System</h1>
              <p className="text-sm text-slate-500">Generate Bills & Tax Invoices for Delivered Transformers (MR-Wise)</p>
            </div>
            
            <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => setBillTypeFilter('repairable')}
                className={`px-4 py-1.5 rounded-md text-xs font-bold uppercase transition-colors ${
                  billTypeFilter === 'repairable' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Repairable Delivered
              </button>
              <button
                onClick={() => setBillTypeFilter('scrap')}
                className={`px-4 py-1.5 rounded-md text-xs font-bold uppercase transition-colors ${
                  billTypeFilter === 'scrap' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Scrap Committee Bills
              </button>
            </div>
          </div>

          {/* Explanation Banner for Pending Delivery */}
          <div className="p-4 bg-blue-50/90 border border-blue-200 rounded-lg text-blue-950 text-xs flex items-start gap-3 shadow-sm">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold text-sm text-blue-900">💡 Why do jobs show as "Pending" in Billing System?</p>
              <p className="text-blue-800 leading-relaxed">
                Tax Invoices & Bills are <strong>ONLY</strong> generated for transformers that have been <strong>delivered/dispatched</strong> back to the division via a <strong>Delivery Challan</strong> (Status: <span className="font-bold text-emerald-800 bg-emerald-100 px-1 rounded">Dispatched</span>).
                If a job has finished Inspection & Testing, its current status is <span className="font-bold text-blue-800 bg-blue-100 px-1 rounded">Tested - Ready for Dispatch</span>.
                You must go to the <strong>Delivery Challans</strong> tab to dispatch the job first before generating its bill.
              </p>
            </div>
          </div>

          {/* Search & Filter Toolbar */}
          <div className="bg-white rounded shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row justify-between items-center gap-4">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-widest flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" />
                Select Delivered MR to Generate Bill
              </h2>
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

            {/* Delivered MR Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">MR No</th>
                    <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Division</th>
                    <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Delivered Jobs</th>
                    <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Challan Info</th>
                    <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Status</th>
                    <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMrNos.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                        No delivered jobs found for this filter. Please dispatch jobs from <strong>Delivery Challans</strong> first.
                      </td>
                    </tr>
                  ) : (
                    filteredMrNos.map(mr => {
                      const groupJobs = mrGroups[mr] || [];
                      const scrapJobs = groupJobs.filter(j => j.status === 'Scrap' || j.condition === 'Scrap');
                      const repairableJobs = groupJobs.filter(j => j.status !== 'Scrap' && j.condition !== 'Scrap');

                      const matchingJobs = groupJobs.filter(j => {
                        const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
                        return billTypeFilter === 'scrap' ? isScrap : !isScrap;
                      });
                      const deliveredJobs = matchingJobs.filter(j => j.status === 'Dispatched');
                      const pendingJobs = matchingJobs.filter(j => j.status !== 'Dispatched');

                      const deliveredScrap = scrapJobs.filter(j => j.status === 'Dispatched');
                      const allGroupDelivered = groupJobs.every(j => j.status === 'Dispatched');

                      const divName = groupJobs[0]?.division || '-';
                      const challans = Array.from(new Set(deliveredJobs.map(j => j.challanNo).filter(Boolean))).join(', ');
                      const dates = Array.from(new Set(deliveredJobs.map(j => j.deliveryDate || j.challanDate).filter(Boolean))).join(', ');

                      return (
                        <tr key={mr} className="hover:bg-slate-50 border-b border-slate-100">
                          <td className="px-4 py-3 font-mono font-bold text-slate-800 align-top">{mr}</td>
                          <td className="px-4 py-3 font-medium text-slate-600 align-top">{divName}</td>
                          <td className="px-4 py-3 font-semibold text-slate-700 align-top">
                            <div>
                              {deliveredJobs.length} of {matchingJobs.length} {billTypeFilter === 'scrap' ? 'Scrap' : 'Repairable'} Delivered
                            </div>
                            {scrapJobs.length > 0 && billTypeFilter === 'repairable' && (
                              <div className="text-xs text-rose-700 font-semibold mt-0.5">
                                ({deliveredScrap.length} of {scrapJobs.length} Scrap Returned - No Repair Bill)
                              </div>
                            )}
                            {/* Detailed stage breakdown list for each job */}
                            <div className="mt-2 space-y-1">
                              {groupJobs.map(j => {
                                let badgeText = 'Received';
                                let badgeClass = 'bg-slate-100 text-slate-700 border-slate-200';
                                if (j.status === 'Dispatched') {
                                  badgeText = 'Dispatched (Delivered)';
                                  badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
                                } else if (j.status === 'Tested - Ready for Dispatch') {
                                  badgeText = 'Tested (Awaiting Delivery Challan)';
                                  badgeClass = 'bg-blue-100 text-blue-800 border-blue-300';
                                } else if (j.status === 'Scrap' || j.condition === 'Scrap') {
                                  badgeText = 'Scrap (Awaiting Delivery Return)';
                                  badgeClass = 'bg-rose-100 text-rose-800 border-rose-300';
                                } else if (j.status === 'Internal Done') {
                                  badgeText = 'Internal Done (Pending Testing)';
                                  badgeClass = 'bg-amber-100 text-amber-800 border-amber-300';
                                } else if (j.status === 'External Done') {
                                  badgeText = 'External Done (Pending Internal)';
                                  badgeClass = 'bg-amber-100 text-amber-800 border-amber-300';
                                } else {
                                  badgeText = 'Received (Pending External)';
                                  badgeClass = 'bg-slate-100 text-slate-800 border-slate-300';
                                }

                                return (
                                  <div key={j.id} className="flex items-center gap-1.5 text-[11px]">
                                    <span className="font-mono font-bold text-slate-800">{j.jobNo}:</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${badgeClass}`}>
                                      {badgeText}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            <div><span className="font-bold text-slate-700">Challan:</span> {challans || (deliveredJobs.length > 0 ? 'Dispatched' : 'None')}</div>
                            <div><span className="font-bold text-slate-700">Date:</span> {dates || '-'}</div>
                          </td>
                          <td className="px-4 py-3">
                            {allGroupDelivered ? (
                              <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                                {scrapJobs.length > 0 ? `All Delivered with ${scrapJobs.length} Scrap` : 'All Delivered & Ready'}
                              </span>
                            ) : pendingJobs.length > 0 ? (
                              <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300">
                                <AlertTriangle className="w-3.5 h-3.5 mr-1 text-amber-600" />
                                {deliveredJobs.length > 0 ? `${pendingJobs.length} Job(s) Pending` : 'All Pending Delivery'}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                {scrapJobs.length > 0 ? `All Repairable Delivered (${deliveredScrap.length}/${scrapJobs.length} Scrap)` : 'All Delivered & Ready'}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => handleGenerateClick(mr)}
                              className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white rounded transition-colors shadow-sm ${
                                pendingJobs.length > 0 ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
                              }`}
                            >
                              Generate Bill
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

          {/* Pending Delivery Alert Modal */}
          {pendingAlertModal && pendingAlertModal.isOpen && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="bg-amber-500 p-4 text-white flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-6 h-6" />
                    <h3 className="font-bold text-base md:text-lg">Delivery Pending Alert: MR {pendingAlertModal.mrNo}</h3>
                  </div>
                  <button onClick={() => setPendingAlertModal(null)} className="text-amber-100 hover:text-white p-1 rounded">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-6 space-y-4">
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-900 text-sm">
                    <p className="font-bold text-amber-950 text-base mb-1">
                      ⚠️ {pendingAlertModal.pendingCount} Transformer(s) Pending Delivery for MR {pendingAlertModal.mrNo}
                    </p>
                    <p className="text-amber-800 leading-relaxed text-xs md:text-sm">
                      Out of total <strong>{pendingAlertModal.totalCount}</strong> repairable transformer(s) under MR <strong>{pendingAlertModal.mrNo}</strong>, only <strong>{pendingAlertModal.deliveredCount}</strong> transformer(s) have been delivered/dispatched, while <strong>{pendingAlertModal.pendingCount}</strong> transformer(s) are still pending delivery.
                    </p>
                  </div>

                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-600 space-y-1">
                    <p className="font-bold text-slate-700">Official MR-Wise Billing Rule:</p>
                    <p>
                      Agencies prepare bills <strong>ONE TIME MR-wise</strong> after all repairable transformers in the MR are delivered. Generating a bill now will only include the {pendingAlertModal.deliveredCount} delivered transformer(s).
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row justify-end gap-2 pt-2 border-t border-slate-100">
                    <button
                      onClick={() => setPendingAlertModal(null)}
                      className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors border border-slate-300"
                    >
                      Wait for Remaining Deliveries
                    </button>
                    <button
                      onClick={() => {
                        const targetMr = pendingAlertModal.mrNo;
                        setPendingAlertModal(null);
                        handleSelectMr(targetMr);
                      }}
                      className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors shadow"
                    >
                      Proceed with Partial Bill ({pendingAlertModal.deliveredCount} Jobs)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      ) : (
        /* Bill Documents Editor & Multi-Page View */
        <div className="space-y-6 print:space-y-0">
          
          {/* Top Control Bar */}
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-white print:hidden">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">MR BILL GENERATOR</p>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-500/20 text-blue-300 rounded uppercase border border-blue-500/30">
                  {billTypeFilter === 'scrap' ? 'Scrap Committee Bill' : 'Repairable Bill'}
                </span>
              </div>
              <p className="text-xl font-mono font-bold text-white mt-1">MR No: {selectedMrNo}</p>
              <p className="text-xs text-slate-300 mt-0.5">
                Division: <span className="font-semibold text-white">{currentDivision}</span> • {selectedJobsData.length} Delivered Transformers
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center text-xs font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition-colors shadow"
              >
                <Printer className="w-4 h-4 mr-1.5" /> Print Bill Package (4 Pages)
              </button>
              <button
                onClick={handleExportExcel}
                className="flex items-center text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded transition-colors shadow"
              >
                <FileSpreadsheet className="w-4 h-4 mr-1.5" /> Export Excel
              </button>
              <button
                onClick={() => setSelectedMrNo(null)}
                className="flex items-center text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-white border border-slate-700 px-3 py-2 rounded transition-colors"
              >
                <ArrowLeft className="w-4 h-4 mr-1" /> Change MR
              </button>
            </div>
          </div>

          {/* Pending Delivery Warning Banner inside Editor */}
          {selectedMrPendingCount > 0 && (
            <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-lg text-amber-900 flex items-start gap-3 print:hidden shadow-sm">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold text-amber-950">
                  ⚠️ Partial Bill Notice: {selectedMrPendingCount} Transformer(s) Pending Delivery
                </p>
                <p className="mt-0.5 text-amber-800 text-xs">
                  MR <strong>{selectedMrNo}</strong> has <strong>{selectedMrPendingCount}</strong> transformer(s) still pending delivery. This bill is generated for the <strong>{selectedJobsData.length}</strong> delivered transformer(s).
                </p>
              </div>
            </div>
          )}

          {/* Scrap Jobs Notice Banner inside Editor */}
          {billTypeFilter === 'repairable' && jobs.filter(j => j.mrNo === selectedMrNo && (j.status === 'Scrap' || j.condition === 'Scrap')).length > 0 && (
            <div className="bg-purple-50 border-l-4 border-purple-500 p-4 rounded-lg text-purple-950 flex items-start gap-3 print:hidden shadow-sm">
              <AlertCircle className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold">
                  ℹ️ Scrap Transformers Returned ({jobs.filter(j => j.mrNo === selectedMrNo && (j.status === 'Scrap' || j.condition === 'Scrap')).length} Scrap Job)
                </p>
                <p className="mt-0.5 text-purple-800 text-xs">
                  MR <strong>{selectedMrNo}</strong> includes <strong>{jobs.filter(j => j.mrNo === selectedMrNo && (j.status === 'Scrap' || j.condition === 'Scrap')).length}</strong> scrap transformer(s) [{jobs.filter(j => j.mrNo === selectedMrNo && (j.status === 'Scrap' || j.condition === 'Scrap')).map(j => j.jobNo).join(', ')}] delivered back to division. No repair bill is prepared for scrap jobs.
                </p>
              </div>
            </div>
          )}

          {/* Editable Metadata Form */}
          <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-4 print:hidden">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 border-b border-slate-100 pb-2">
              Bill Meta Credentials
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 text-xs">
              <div>
                <label className="block font-bold text-slate-600 mb-1">Bill No</label>
                <input
                  type="text"
                  value={billNo}
                  onChange={(e) => setBillNo(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono font-bold text-slate-800"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1">Bill Date</label>
                <input
                  type="text"
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono text-slate-800"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1">Appr / Order No</label>
                <input
                  type="text"
                  value={apprNo}
                  onChange={(e) => setApprNo(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono text-slate-800"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1">Appr Date</label>
                <input
                  type="text"
                  value={apprDate}
                  onChange={(e) => setApprDate(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono text-slate-800"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1">Division GSTIN</label>
                <input
                  type="text"
                  value={divisionGstin}
                  onChange={(e) => setDivisionGstin(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono text-slate-800"
                />
              </div>
            </div>
          </div>

          {/* Document Preview Tabs */}
          <div className="flex bg-slate-200 p-1 rounded-lg border border-slate-300 print:hidden overflow-x-auto">
            <button
              onClick={() => setActiveDocTab('all')}
              className={`flex-1 min-w-[120px] py-2 text-xs font-bold uppercase rounded-md transition-all ${
                activeDocTab === 'all' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All 4 Pages (Stacked)
            </button>
            <button
              onClick={() => setActiveDocTab('forwarding')}
              className={`flex-1 min-w-[120px] py-2 text-xs font-bold uppercase rounded-md transition-all ${
                activeDocTab === 'forwarding' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              1. Forwarding Letter
            </button>
            <button
              onClick={() => setActiveDocTab('certificate')}
              className={`flex-1 min-w-[120px] py-2 text-xs font-bold uppercase rounded-md transition-all ${
                activeDocTab === 'certificate' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              2. Certificate
            </button>
            <button
              onClick={() => setActiveDocTab('invoice')}
              className={`flex-1 min-w-[120px] py-2 text-xs font-bold uppercase rounded-md transition-all ${
                activeDocTab === 'invoice' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              3. Tax Invoice
            </button>
            <button
              onClick={() => setActiveDocTab('oil')}
              className={`flex-1 min-w-[120px] py-2 text-xs font-bold uppercase rounded-md transition-all ${
                activeDocTab === 'oil' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              4. Oil Account
            </button>
          </div>

          {/* PRINTABLE DOCUMENTS CONTAINER */}
          <div className="space-y-8 print:space-y-0">

            {/* ==================== PAGE 1: FORWARDING LETTER ==================== */}
            <div className={`bg-white p-10 md:p-12 border border-slate-300 shadow-sm rounded print:border-none print:shadow-none print:p-0 print:m-0 print:page-break-after-always ${
              activeDocTab === 'all' || activeDocTab === 'forwarding' ? 'block' : 'hidden print:block'
            }`}>
              {/* Agency Header */}
              <LetterheadHeader agency={activeAgency} />

              {/* Recipient */}
              <div className="mb-6 text-sm text-black space-y-1">
                <p className="font-bold">EXECUTIVE ENGINEER (O&M)</p>
                <p>UGVCL, Division Office,</p>
                <p>{currentDivision},</p>
                <p>Ahmedabad.</p>
                <p className="font-bold mt-1">GST No. {divisionGstin}</p>
              </div>

              {/* Subject */}
              <div className="text-center my-6">
                <p className="text-base font-bold text-black border-b border-black inline-block pb-0.5">
                  Sub : Submission of Bill for Payment
                </p>
              </div>

              {/* Salutation & Body */}
              <div className="text-sm text-black space-y-4 leading-relaxed mb-8">
                <p>Dear Sir,</p>
                <p className="pl-6">
                  Please find enclosed herewith our <strong className="font-bold">Bill No {billNo}</strong> Dated <strong className="font-bold">{billDate}</strong> sum of <strong className="font-bold">Rs. {grandTotal.toFixed(2)}/-</strong>
                </p>
                <p className="pl-6">
                  Along with our Delivery Challan, Oil Account and relevant Test Certificate.
                  You are requested to pass the above bill at your earliest and arrange to release the payment at the earliest.
                </p>
                <p className="pl-6">Thanking you and assuring you of our best services.</p>
              </div>

              {/* Enclosures & Signatures */}
              <div className="flex justify-between items-end text-sm text-black pt-8">
                <div className="space-y-1">
                  <p className="font-bold">End:-</p>
                  <ol className="list-decimal list-inside space-y-0.5 text-xs">
                    <li>Bill Copy-2 with Advance Stamp receipt and Guarantee Card.</li>
                    <li>Bill Oil Account- 2.</li>
                    <li>Delivery Challan- 1.</li>
                    <li>Test Certificate- 1.</li>
                    <li>MR Copy-1</li>
                    <li>Approval Copy- 1.</li>
                  </ol>
                </div>

                <div className="text-center">
                  <p className="font-bold mb-12">Yours Faithfully,</p>
                  <p className="font-bold">For, {activeAgency?.name || ''}</p>
                  <p className="text-xs text-slate-500 mt-2">(Auth Sign.)</p>
                </div>
              </div>
            </div>

            {/* ==================== PAGE 2: CERTIFICATE ==================== */}
            <div className={`bg-white p-10 md:p-12 border border-slate-300 shadow-sm rounded print:border-none print:shadow-none print:p-0 print:m-0 print:page-break-after-always ${
              activeDocTab === 'all' || activeDocTab === 'certificate' ? 'block' : 'hidden print:block'
            }`}>
              {/* Agency Header */}
              <LetterheadHeader agency={activeAgency} />

              {/* Certificate Container Box */}
              <div className="border-2 border-black p-8 my-12 min-h-[300px] flex flex-col justify-between">
                <div className="text-center mb-8">
                  <h2 className="text-xl font-black uppercase border-b-2 border-black inline-block tracking-wider pb-1">
                    CERTIFICATE
                  </h2>
                </div>

                <p className="text-sm text-black leading-loose text-justify font-medium">
                  We hereby Certify that the materials and spares mentioned in the Estimate of Transformers mentioned in our <strong className="font-bold">BILL NO. {billNo}</strong> Dated <strong className="font-bold">{billDate}</strong> are Replaced and Fitted, the above Transformers are guaranteed by Twelve/Eighteen months from the date to delivery.
                </p>

                <div className="text-right mt-16 pt-8">
                  <p className="font-bold text-sm">For, {activeAgency?.name || ''}</p>
                  <p className="text-xs text-slate-500 mt-8">(Auth Sign.)</p>
                </div>
              </div>
            </div>

            {/* ==================== PAGE 3: TAX INVOICE ==================== */}
            <div className={`bg-white p-6 md:p-8 border border-slate-300 shadow-sm rounded print:border-none print:shadow-none print:p-0 print:m-0 print:page-break-after-always ${
              activeDocTab === 'all' || activeDocTab === 'invoice' ? 'block' : 'hidden print:block'
            }`}>
              <div className="border-2 border-black text-black text-xs">
                
                {/* Header Row */}
                <div className="grid grid-cols-2 border-b-2 border-black">
                  <div className="p-3 border-r-2 border-black">
                    {activeAgency?.letterheadUrl ? (
                      <img src={activeAgency.letterheadUrl} alt="Letterhead" className="max-h-20 object-contain mb-2" />
                    ) : (
                      <h1 className="text-lg font-black uppercase">{activeAgency?.name || 'AGENCY NAME'}</h1>
                    )}
                    <p className="font-bold text-[11px]">Repairing of Distribution Transformers</p>
                    <p className="mt-2">{activeAgency?.address || ''}</p>
                  </div>
                  <div className="p-3 relative">
                    <div className="text-right font-bold text-[10px] uppercase tracking-widest border-b border-black pb-1 mb-2">
                      TAX INVOICE (Original / Duplicate / Triplicate)
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                      <div><span className="font-bold">Appr No.:</span> {apprNo}</div>
                      <div><span className="font-bold">Appr Date:</span> {apprDate}</div>
                      <div><span className="font-bold">Bill No:</span> <strong className="font-bold">{billNo}</strong></div>
                      <div><span className="font-bold">Date:</span> {billDate}</div>
                      <div><span className="font-bold">PAN NO.:</span> {activeAgency?.pan || ''}</div>
                      <div><span className="font-bold">GST No.:</span> {activeAgency?.gstin || ''}</div>
                    </div>
                  </div>
                </div>

                {/* Customer Details */}
                <div className="p-3 border-b-2 border-black">
                  <p className="font-bold">EXECUTIVE ENGINEER (O&M)</p>
                  <p>UGVCL, Division Office, {currentDivision}, Ahmedabad.</p>
                  <p><span className="font-bold">GST No.:</span> {divisionGstin}</p>
                  <div className="flex justify-between items-center mt-1 pt-1 border-t border-slate-300 font-medium">
                    <span><strong className="font-bold">Order No:</strong> {apprNo}</span>
                    <span><strong className="font-bold">Description:</strong> Maintenance and repair Service code : 998719</span>
                  </div>
                </div>

                {/* Sub-header instruction */}
                <div className="p-2 border-b border-black font-semibold text-center bg-slate-50 print:bg-white text-[11px]">
                  The following Transformer duly repaired with all the standard parts and tested o. k. with oil upto the level mark.
                </div>

                {/* Transformers Itemized Table */}
                <table className="w-full text-center border-collapse text-[10px]">
                  <thead>
                    <tr className="font-bold border-b-2 border-black bg-slate-100 print:bg-white">
                      <th className="p-1.5 border-r border-black w-8">Sr. No</th>
                      <th className="p-1.5 border-r border-black">Job No.</th>
                      <th className="p-1.5 border-r border-black">Challan No.</th>
                      <th className="p-1.5 border-r border-black">Challan Date</th>
                      <th className="p-1.5 border-r border-black">Make</th>
                      <th className="p-1.5 border-r border-black w-10">KVA</th>
                      <th className="p-1.5 border-r border-black w-8">KV</th>
                      <th className="p-1.5 border-r border-black">Serial No.</th>
                      <th className="p-1.5 border-r border-black text-right">Estimated Amount</th>
                      <th className="p-1.5 text-right">Amount (Rs)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedJobsData.map((job, idx) => {
                      const jobTotal = calculateJobTotal(job);
                      return (
                        <tr key={job.id} className="border-b border-black">
                          <td className="p-1.5 border-r border-black">{idx + 1}</td>
                          <td className="p-1.5 border-r border-black font-bold font-mono">{job.jobNo}</td>
                          <td className="p-1.5 border-r border-black font-mono">{job.challanNo || ''}</td>
                          <td className="p-1.5 border-r border-black">{job.deliveryDate || job.challanDate || billDate}</td>
                          <td className="p-1.5 border-r border-black">{job.make || ''}</td>
                          <td className="p-1.5 border-r border-black font-bold">{job.capacityKva}</td>
                          <td className="p-1.5 border-r border-black">11</td>
                          <td className="p-1.5 border-r border-black font-mono">{job.serialNo || '-'}</td>
                          <td className="p-1.5 border-r border-black text-right font-mono">{jobTotal.toFixed(2)}</td>
                          <td className="p-1.5 text-right font-mono font-bold">{jobTotal.toFixed(2)}</td>
                        </tr>
                      );
                    })}

                    {/* Financial Calculations */}
                    <tr className="font-bold border-t-2 border-black">
                      <td colSpan={9} className="p-1.5 border-r border-black text-right">Total:</td>
                      <td className="p-1.5 text-right font-mono">{subTotal.toFixed(2)}</td>
                    </tr>
                    <tr className="font-bold border-t border-black">
                      <td colSpan={9} className="p-1.5 border-r border-black text-right">CGST (9.00%):</td>
                      <td className="p-1.5 text-right font-mono">{cgst.toFixed(2)}</td>
                    </tr>
                    <tr className="font-bold border-t border-black">
                      <td colSpan={9} className="p-1.5 border-r border-black text-right">SGST (9.00%):</td>
                      <td className="p-1.5 text-right font-mono">{sgst.toFixed(2)}</td>
                    </tr>
                    <tr className="font-black border-t-2 border-black bg-slate-100 print:bg-white text-[11px]">
                      <td colSpan={9} className="p-1.5 border-r border-black text-right">Net Total:</td>
                      <td className="p-1.5 text-right font-mono">{grandTotal.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Bottom Footer Section */}
                <div className="grid grid-cols-2 border-t-2 border-black">
                  
                  {/* Left Side: Receipt & Settlement */}
                  <div className="p-3 border-r-2 border-black flex flex-col justify-between space-y-3">
                    <div>
                      <p><strong className="font-bold">Received Payment of Rs.</strong> <span className="font-mono font-bold">{grandTotal.toFixed(2)}</span></p>
                      <p className="mt-1 font-semibold italic text-[11px]">{numberToIndianWords(grandTotal)}</p>
                      <p className="mt-2 text-[10px]">In full settlement of our Bill no <strong className="font-bold">{billNo}</strong> Dated <strong className="font-bold">{billDate}</strong></p>
                    </div>

                    <div className="pt-8 text-center">
                      <p className="font-bold">For, {activeAgency?.name || ''}</p>
                      <div className="h-8"></div>
                      <p className="text-[10px] text-slate-500">(Auth Sign / Stamp)</p>
                    </div>
                  </div>

                  {/* Right Side: Guarantee Card */}
                  <div className="p-3 flex flex-col justify-between">
                    <div>
                      <h4 className="font-black text-center uppercase tracking-wider mb-2 border-b border-black pb-0.5">
                        Guarantee Card
                      </h4>
                      <p className="text-[10px] leading-tight text-justify">
                        We guarantee the satisfactory performance of the above repaired transformers for 18 months for 11 KV and 12 months for 22 KV for the date of delivery for the repaired and replaced parts only. We certify the material and spares mentioned in the estimate/bill have actually been fitted/used in the above transformer.
                      </p>
                    </div>

                    <div className="pt-6 text-center">
                      <p className="font-bold">For, {activeAgency?.name || ''}</p>
                      <div className="h-8"></div>
                      <p className="text-[10px] text-slate-500">(Auth Sign.)</p>
                    </div>
                  </div>

                </div>

              </div>
            </div>

            {/* ==================== PAGE 4: OIL ACCOUNT ==================== */}
            <div className={`bg-white p-6 md:p-8 border border-slate-300 shadow-sm rounded print:border-none print:shadow-none print:p-0 print:m-0 ${
              activeDocTab === 'all' || activeDocTab === 'oil' ? 'block' : 'hidden print:block'
            }`}>
              <div className="border-2 border-black p-4 text-black text-xs space-y-4">
                
                {/* Agency Header */}
                <LetterheadHeader agency={activeAgency} documentTitle="OIL ACCOUNT SHEET" />

                {/* Sub Metadata */}
                <div className="grid grid-cols-3 gap-2 font-semibold text-[11px] border-b border-black pb-2">
                  <div>Order no. <span className="font-mono font-bold">{apprNo}</span></div>
                  <div className="text-center">MR NO: <span className="font-mono font-bold">{selectedMrNo}</span> | MR Date: <span className="font-mono font-bold">{selectedMrDate}</span></div>
                  <div className="text-right">Bill No. <span className="font-mono font-bold">{billNo}</span> (Dated: {billDate})</div>
                </div>

                {/* Table 1: Delivered Transformers Oil Table */}
                <table className="w-full text-center border-collapse border border-black text-[9px]">
                  <thead>
                    <tr className="font-bold border-b border-black bg-slate-100 print:bg-white">
                      <th className="border border-black p-1 w-6">Sr.</th>
                      <th className="border border-black p-1">Job No.</th>
                      <th className="border border-black p-1">Make</th>
                      <th className="border border-black p-1">Serial No.</th>
                      <th className="border border-black p-1 w-8">KVA</th>
                      <th className="border border-black p-1 w-6">KV</th>
                      <th className="border border-black p-1">Oil Capacity</th>
                      <th className="border border-black p-1">Oil Received</th>
                      <th className="border border-black p-1">Base Shortage</th>
                      <th className="border border-black p-1">Filter Loss (5%)</th>
                      <th className="border border-black p-1 font-bold">Net Oil Required</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobOilDetails.map((detail, idx) => (
                      <tr key={detail.job.id} className="border-b border-black">
                        <td className="border border-black p-1">{idx + 1}</td>
                        <td className="border border-black p-1 font-bold font-mono">{detail.job.jobNo}</td>
                        <td className="border border-black p-1">{detail.job.make || 'VIJAI'}</td>
                        <td className="border border-black p-1 font-mono">{detail.job.serialNo || '-'}</td>
                        <td className="border border-black p-1 font-bold">{detail.job.capacityKva}</td>
                        <td className="border border-black p-1">11</td>
                        <td className="border border-black p-1 font-mono">{detail.oilCap.toFixed(2)}</td>
                        <td className="border border-black p-1 font-mono">{detail.oilRecd.toFixed(2)}</td>
                        <td className="border border-black p-1 font-mono">{detail.baseShortage.toFixed(2)}</td>
                        <td className="border border-black p-1 font-mono">{detail.filterLoss.toFixed(2)}</td>
                        <td className="border border-black p-1 font-mono font-bold">{detail.netShortage.toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr className="font-bold border-t-2 border-black bg-slate-50 print:bg-white">
                      <td colSpan={6} className="border border-black p-1 text-right">Total:</td>
                      <td className="border border-black p-1 font-mono">{totalOilCapacity.toFixed(2)}</td>
                      <td className="border border-black p-1 font-mono">{totalOilReceived.toFixed(2)}</td>
                      <td className="border border-black p-1 font-mono">{totalBaseShortage.toFixed(2)}</td>
                      <td className="border border-black p-1 font-mono">{totalFilterLoss.toFixed(2)}</td>
                      <td className="border border-black p-1 font-mono font-bold">{totalNetShortage.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Table 2: Oil Inward Log for MR */}
                <div className="pt-2">
                  <h4 className="font-bold text-[11px] mb-1 uppercase">
                    Inward Oil Received Log for MR: {selectedMrNo}
                  </h4>
                  <table className="w-full text-center border-collapse border border-black text-[10px]">
                    <thead>
                      <tr className="font-bold border-b border-black bg-slate-100 print:bg-white">
                        <th className="border border-black p-1">MR NO</th>
                        <th className="border border-black p-1">Date</th>
                        <th className="border border-black p-1">Fresh/Used</th>
                        <th className="border border-black p-1">Oil Received</th>
                        <th className="border border-black p-1">Barrel Received</th>
                        <th className="border border-black p-1">Oil after deducting FL (5.000)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mrOilTxList.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="border border-black p-2 text-slate-500">
                            No inward oil transaction logged for MR {selectedMrNo} in Oil Ledger.
                          </td>
                        </tr>
                      ) : (
                        mrOilTxList.map((tx, idx) => (
                          <tr key={tx.id || idx} className="border-b border-black">
                            <td className="border border-black p-1 font-mono">{tx.mrNo}</td>
                            <td className="border border-black p-1">{tx.date ? new Date(tx.date).toLocaleDateString() : billDate}</td>
                            <td className="border border-black p-1">{tx.oilType || 'Fresh'}</td>
                            <td className="border border-black p-1 font-mono">{Number(tx.grossLiters || 0).toFixed(2)}</td>
                            <td className="border border-black p-1 font-mono">{tx.barrels || 0}</td>
                            <td className="border border-black p-1 font-mono">{Number(tx.netLiters || 0).toFixed(2)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Summary Box with Filtration Loss & Previous Shortage Balance */}
                <div className="grid grid-cols-2 gap-3 border border-black p-3 font-semibold text-[11px]">
                  {/* Left Box: Current MR Oil Requirement */}
                  <div className="space-y-1">
                    <h4 className="font-bold border-b border-black pb-1 mb-1 uppercase text-[10px]">
                      Current MR {selectedMrNo} Requirement
                    </h4>
                    <div className="flex justify-between"><span>Trans Oil Capacity:</span> <span className="font-mono">{totalOilCapacity.toFixed(2)} Ltr</span></div>
                    <div className="flex justify-between"><span>Oil Received with Transformer:</span> <span className="font-mono">{totalOilReceived.toFixed(2)} Ltr</span></div>
                    <div className="flex justify-between text-slate-700"><span>Base Oil Shortage:</span> <span className="font-mono">{totalBaseShortage.toFixed(2)} Ltr</span></div>
                    <div className="flex justify-between text-slate-700"><span>Filtration Loss (5% on Received):</span> <span className="font-mono">+{totalFilterLoss.toFixed(2)} Ltr</span></div>
                    <div className="flex justify-between border-t border-black pt-1 font-bold text-amber-950">
                      <span>Net Requirement of Oil (Current MR):</span>
                      <span className="font-mono">{totalNetShortage.toFixed(2)} Ltr</span>
                    </div>
                    <div className="flex justify-between pt-1 text-blue-900">
                      <span>Inward Oil Received for MR {selectedMrNo}:</span>
                      <span className="font-mono font-bold">{mrInwardOilTotal.toFixed(2)} Ltr</span>
                    </div>
                  </div>

                  {/* Right Box: Ledger & Previous Shortage Balance */}
                  <div className="space-y-1 border-l border-black pl-3">
                    <h4 className="font-bold border-b border-black pb-1 mb-1 uppercase text-[10px]">
                      Oil Account & Previous Balance
                    </h4>

                    <div className="text-[10px] bg-slate-50 p-1.5 rounded border border-slate-300 space-y-0.5 mb-1">
                      <div className="flex justify-between">
                        <span>Previous Billed MR:</span>
                        <span className="font-mono font-bold">{previousMrLedger.prevMrNo ? `MR ${previousMrLedger.prevMrNo}` : 'N/A (First MR)'}</span>
                      </div>
                      {previousMrLedger.prevMrNo && (
                        <div className="flex justify-between text-[9px] text-slate-600">
                          <span>Previous Bill No. & Date:</span>
                          <span className="font-mono">{previousMrLedger.prevBillNo} ({previousMrLedger.prevBillDate})</span>
                        </div>
                      )}
                    </div>

                    <div className="flex justify-between">
                      <span>Net Oil Req. (Current MR):</span>
                      <span className="font-mono font-bold">+{totalNetShortage.toFixed(2)} Ltr</span>
                    </div>

                    <div className="flex justify-between">
                      <span>Balance Previous Oil Shortage:</span>
                      <span className={`font-mono font-bold ${previousMrLedger.prevNetShortage >= 0 ? 'text-amber-900' : 'text-emerald-900'}`}>
                        {previousMrLedger.prevNetShortage >= 0 ? '+' : ''}{previousMrLedger.prevNetShortage.toFixed(2)} Ltr
                      </span>
                    </div>
                    <div className="text-[9px] text-slate-600 text-right -mt-1 italic">
                      ({previousMrLedger.prevNetShortage >= 0 ? 'Pending to be received' : 'Credited / Surplus in hand'})
                    </div>

                    <div className="flex justify-between text-blue-900 font-bold border-t border-slate-200 pt-1">
                      <span>Less Inward Oil Received (MR {selectedMrNo}):</span>
                      <span className="font-mono">-{mrInwardOilTotal.toFixed(2)} Ltr</span>
                    </div>

                    <div className="flex justify-between border-t-2 border-black pt-1 font-bold text-sm">
                      <span>Net Oil Due:</span>
                      <span className="font-mono">{netOilDue >= 0 ? '+' : ''}{netOilDue.toFixed(2)} Ltr</span>
                    </div>

                    <div className="bg-slate-100 p-1.5 border border-black rounded mt-1 flex justify-between items-center text-xs">
                      <span className="font-bold uppercase">Final Oil Status:</span>
                      <span className={`font-black font-mono px-2 py-0.5 rounded text-white ${netOilDue > 0 ? 'bg-amber-800' : netOilDue < 0 ? 'bg-emerald-800' : 'bg-slate-800'}`}>
                        {netOilDue < 0 ? `${Math.abs(netOilDue).toFixed(2)} Ltr Credited` : netOilDue > 0 ? `${netOilDue.toFixed(2)} Ltr Due` : '0.00 Ltr (Balanced)'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer Signature */}
                <div className="text-right pt-8">
                  <p className="font-bold">For, {activeAgency?.name || 'POWER TRANSMISSION COMPANY'}</p>
                  <div className="h-8"></div>
                  <p className="text-[10px] text-slate-500">(Auth Sign.)</p>
                </div>

              </div>
            </div>

          </div>

        </div>
      )}

    </div>
  );
}
