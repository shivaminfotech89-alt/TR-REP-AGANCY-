import React, { useState, useEffect, useMemo } from 'react';
import { useAgency } from '../lib/AgencyContext';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Loader2, Printer, Search, FileText, ArrowLeft, CheckCircle2, ShieldCheck, FileSpreadsheet, Droplets } from 'lucide-react';
import { defaultEstimateData } from '../lib/estimateData';

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
            where('agencyId', '==', activeAgency.id),
            where('status', '==', 'Dispatched')
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

  // Group dispatched jobs by MR
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

  // Selected jobs for the active bill
  const selectedJobsData = useMemo(() => {
    if (!selectedMrNo) return [];
    const mrJobs = jobs.filter(j => j.mrNo === selectedMrNo);
    return mrJobs.filter(j => {
      const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
      return billTypeFilter === 'scrap' ? isScrap : !isScrap;
    }).sort((a, b) => (a.jobNo || '').localeCompare(b.jobNo || '', undefined, { numeric: true }));
  }, [jobs, selectedMrNo, billTypeFilter]);

  // Selected MR Division Name
  const currentDivision = useMemo(() => {
    if (selectedJobsData.length > 0) return selectedJobsData[0].division || 'SABARMATI';
    return 'SABARMATI';
  }, [selectedJobsData]);

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

  // Calculate job estimate / bill amount
  const calculateJobTotal = (job: any) => {
    let jobTotal = 0;
    const kva = String(job.capacityKva);
    const isScrapJob = job.status === 'Scrap' || job.condition === 'Scrap';

    masterData.forEach(item => {
      const rawRate = item.rates[kva as keyof typeof item.rates] || 0;
      const rate = typeof rawRate === 'string' ? parseFloat(rawRate) : Number(rawRate);
      let qty = 0;
      const isScrapItem = item.itemName.toLowerCase().includes('scrap');

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
    return jobTotal * 1.04; // 4% rise included
  };

  // Billing Financial Calculations
  const subTotal = useMemo(() => {
    return selectedJobsData.reduce((acc, job) => acc + calculateJobTotal(job), 0);
  }, [selectedJobsData, masterData]);

  const cgst = useMemo(() => subTotal * 0.09, [subTotal]);
  const sgst = useMemo(() => subTotal * 0.09, [subTotal]);
  const grandTotal = useMemo(() => subTotal + cgst + sgst, [subTotal, cgst, sgst]);

  // Oil Data Calculations for Oil Account Document
  const jobOilDetails = useMemo(() => {
    return selectedJobsData.map(job => {
      const insp = inspections.find(i => i.jobId === job.id);
      const kva = Number(job.capacityKva) || 25;
      
      // Standard capacity calculation if missing
      const defaultCap = kva <= 16 ? 140 : kva <= 25 ? 184 : kva <= 63 ? 240 : 323;
      const oilCap = Number(insp?.data?.oilCapLtrs) || defaultCap;
      const lessOil = Number(insp?.data?.lessOilLtrs) || 0;
      const oilRecd = Math.max(0, oilCap - lessOil);
      const oilRequired = oilCap - oilRecd;

      return {
        job,
        oilCap,
        oilRecd,
        oilRequired
      };
    });
  }, [selectedJobsData, inspections]);

  const totalOilCapacity = useMemo(() => jobOilDetails.reduce((a, b) => a + b.oilCap, 0), [jobOilDetails]);
  const totalOilReceived = useMemo(() => jobOilDetails.reduce((a, b) => a + b.oilRecd, 0), [jobOilDetails]);
  const totalOilRequired = useMemo(() => jobOilDetails.reduce((a, b) => a + b.oilRequired, 0), [jobOilDetails]);

  const mrOilTxList = useMemo(() => {
    if (!selectedMrNo) return [];
    return oilTransactions.filter(t => t.mrNo === selectedMrNo);
  }, [oilTransactions, selectedMrNo]);

  const handlePrint = () => {
    window.print();
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
                      const matchingJobs = groupJobs.filter(j => {
                        const isScrap = j.status === 'Scrap' || j.condition === 'Scrap';
                        return billTypeFilter === 'scrap' ? isScrap : !isScrap;
                      });
                      const divName = groupJobs[0]?.division || '-';
                      const challans = Array.from(new Set(matchingJobs.map(j => j.challanNo).filter(Boolean))).join(', ');
                      const dates = Array.from(new Set(matchingJobs.map(j => j.deliveryDate || j.challanDate).filter(Boolean))).join(', ');

                      return (
                        <tr key={mr} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-mono font-bold text-slate-800">{mr}</td>
                          <td className="px-4 py-3 font-medium text-slate-600">{divName}</td>
                          <td className="px-4 py-3 font-semibold text-slate-700">{matchingJobs.length} {billTypeFilter === 'scrap' ? 'Scrap' : 'Repairable'} Jobs</td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            <div><span className="font-bold text-slate-700">Challan:</span> {challans || 'Dispatched'}</div>
                            <div><span className="font-bold text-slate-700">Date:</span> {dates || '-'}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Delivered & Ready
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => handleSelectMr(mr)}
                              className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors shadow-sm"
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
                onClick={() => setSelectedMrNo(null)}
                className="flex items-center text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-white border border-slate-700 px-3 py-2 rounded transition-colors"
              >
                <ArrowLeft className="w-4 h-4 mr-1" /> Change MR
              </button>
            </div>
          </div>

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
              <div className="text-center mb-8 pb-4 border-b-2 border-black">
                <h1 className="text-2xl font-black text-black tracking-wide uppercase">
                  {activeAgency?.name || 'HIGH TECH ELECTRICALS'}
                </h1>
                <p className="text-sm font-medium text-black mt-1">
                  {activeAgency?.address || 'Plot No. 1017/A, Phase-4, GIDC Estate, Naroda, Ahmedabad'}
                </p>
              </div>

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
                  <p className="font-bold">For, {activeAgency?.name || 'HIGH TECH ELECTRICALS'}</p>
                  <p className="text-xs text-slate-500 mt-2">(Auth Sign.)</p>
                </div>
              </div>
            </div>

            {/* ==================== PAGE 2: CERTIFICATE ==================== */}
            <div className={`bg-white p-10 md:p-12 border border-slate-300 shadow-sm rounded print:border-none print:shadow-none print:p-0 print:m-0 print:page-break-after-always ${
              activeDocTab === 'all' || activeDocTab === 'certificate' ? 'block' : 'hidden print:block'
            }`}>
              {/* Agency Header */}
              <div className="text-center mb-8 pb-4 border-b-2 border-black">
                <h1 className="text-2xl font-black text-black tracking-wide uppercase">
                  {activeAgency?.name || 'HIGH TECH ELECTRICALS'}
                </h1>
                <p className="text-sm font-medium text-black mt-1">
                  {activeAgency?.address || 'Plot No. 1017/A, Phase-4, GIDC Estate, Naroda, Ahmedabad'}
                </p>
              </div>

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
                  <p className="font-bold text-sm">For, {activeAgency?.name || 'HIGH TECH ELECTRICALS'}</p>
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
                    <h1 className="text-lg font-black uppercase">{activeAgency?.name || 'HIGH TECH ELECTRICALS'}</h1>
                    <p className="font-bold text-[11px]">Repairing of Distribution Transformers</p>
                    <p className="mt-2">{activeAgency?.address || 'Plot No. 1017/A, Phase-4, GIDC Estate, Naroda, Ahmedabad'}</p>
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
                      <div><span className="font-bold">PAN NO.:</span> {activeAgency?.pan || 'AGHPP3482C'}</div>
                      <div><span className="font-bold">GST No.:</span> {activeAgency?.gstin || '24AGHPP3482C1ZJ'}</div>
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
                          <td className="p-1.5 border-r border-black font-mono">{job.challanNo || 'H.E.-07'}</td>
                          <td className="p-1.5 border-r border-black">{job.deliveryDate || job.challanDate || billDate}</td>
                          <td className="p-1.5 border-r border-black">{job.make || 'VIJAI'}</td>
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
                      <p className="font-bold">For, {activeAgency?.name || 'HIGH TECH ELECTRICALS'}</p>
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
                      <p className="font-bold">For, {activeAgency?.name || 'HIGH TECH ELECTRICALS'}</p>
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
                <div className="text-center border-b-2 border-black pb-3">
                  <h1 className="text-xl font-black uppercase tracking-wide">{activeAgency?.name || 'POWER TRANSMISSION COMPANY'}</h1>
                  <p className="text-[11px] font-medium">{activeAgency?.address || 'Plot No. C1-39/31-B, Phase-3, GIDC Estate, Naroda, Ahmedabad'}</p>
                  <h2 className="text-base font-black uppercase mt-2 tracking-widest underline underline-offset-4">OIL ACCOUNT</h2>
                </div>

                {/* Sub Metadata */}
                <div className="grid grid-cols-2 gap-2 font-semibold text-[11px] border-b border-black pb-2">
                  <div>Order no. <span className="font-mono font-bold">{apprNo}</span></div>
                  <div className="text-right">Bill No. <span className="font-mono font-bold">{billNo}</span></div>
                  <div>Division: <span className="font-bold">{currentDivision}</span></div>
                  <div className="text-right">Dated: <span className="font-mono">{billDate}</span></div>
                </div>

                {/* Table 1: Delivered Transformers Oil Table */}
                <table className="w-full text-center border-collapse border border-black text-[10px]">
                  <thead>
                    <tr className="font-bold border-b border-black bg-slate-100 print:bg-white">
                      <th className="border border-black p-1 w-8">Sr. No</th>
                      <th className="border border-black p-1">Job No.</th>
                      <th className="border border-black p-1">Make</th>
                      <th className="border border-black p-1">Serial No.</th>
                      <th className="border border-black p-1 w-10">KVA</th>
                      <th className="border border-black p-1 w-8">KV</th>
                      <th className="border border-black p-1">Oil Capacity</th>
                      <th className="border border-black p-1">Oil received with transformer</th>
                      <th className="border border-black p-1">Oil Actually Required</th>
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
                        <td className="border border-black p-1 font-mono font-bold">{detail.oilRequired.toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr className="font-bold border-t-2 border-black bg-slate-50 print:bg-white">
                      <td colSpan={6} className="border border-black p-1 text-right">Total:</td>
                      <td className="border border-black p-1 font-mono">{totalOilCapacity.toFixed(2)}</td>
                      <td className="border border-black p-1 font-mono">{totalOilReceived.toFixed(2)}</td>
                      <td className="border border-black p-1 font-mono">{totalOilRequired.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Table 2: Oil Inward Log for MR */}
                <div className="pt-2">
                  <h4 className="font-bold text-[11px] mb-1 uppercase">Inward Oil Received Log for MR: {selectedMrNo}</h4>
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

                {/* Summary Box */}
                <div className="grid grid-cols-2 gap-4 border border-black p-3 font-semibold text-[11px]">
                  <div className="space-y-1">
                    <div className="flex justify-between"><span>Trans Oil Capacity:</span> <span className="font-mono">{totalOilCapacity.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span>Oil Received with Transformer:</span> <span className="font-mono">{totalOilReceived.toFixed(2)}</span></div>
                    <div className="flex justify-between border-t border-slate-300 pt-1"><span>Shortage of Oil:</span> <span className="font-mono font-bold">{totalOilRequired.toFixed(2)}</span></div>
                  </div>
                  <div className="space-y-1 border-l border-black pl-3">
                    <div className="flex justify-between"><span>Requirement of oil:</span> <span className="font-mono">{totalOilRequired.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span>Pending Oil Litre:</span> <span className="font-mono">-{totalOilRequired.toFixed(2)}</span></div>
                    <div className="flex justify-between border-t border-slate-300 pt-1"><span>Status:</span> <span className="font-bold text-slate-800">BALANCED</span></div>
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
