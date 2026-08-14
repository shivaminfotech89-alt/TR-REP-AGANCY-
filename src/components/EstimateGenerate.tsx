
import { useAgency, getAtPercentageForCore, getEstimateMasterForCore } from '../lib/AgencyContext';
import React, { useState, useEffect, useMemo } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Loader2, Printer, Search, FileSpreadsheet, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { defaultEstimateData, EstimateItem } from '../lib/estimateData';
import { ExternalData } from './ExternalInspection';
import { LetterheadHeader } from './LetterheadHeader';

export default function EstimateGenerate() {
  const { activeAgency, activeAtMaster } = useAgency();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedMrNo, setSelectedMrNo] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDivision, setSelectedDivision] = useState<string>('All');

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
  
  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="max-w-6xl mx-auto print:max-w-none print:w-full print:m-0 print:p-0">
      
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
                  <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Remark</th>
                  <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMrNos.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      No matching MR numbers found.
                    </td>
                  </tr>
                ) : (
                  filteredMrNos.map(mr => {
                    const groupJobs = mrGroups[mr] || [];
                    const divName = groupJobs[0]?.division || '-';
                    const scrapCount = groupJobs.filter(j => j.status === 'Scrap' || j.condition === 'Scrap').length;
                    const repairableCount = groupJobs.length - scrapCount;
                    
                    let remarkText = '';
                    if (repairableCount > 0 && scrapCount > 0) {
                      remarkText = `${repairableCount} Repairable, ${scrapCount} Scrap`;
                    } else if (scrapCount > 0) {
                      remarkText = `${scrapCount} Scrap`;
                    } else {
                      remarkText = `${repairableCount} Repairable`;
                    }

                    return (
                      <tr key={mr} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono font-bold text-slate-800">{mr}</td>
                        <td className="px-4 py-3 font-medium text-slate-600">{divName}</td>
                        <td className="px-4 py-3 text-slate-600">{groupJobs.length} Jobs</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold ${
                            scrapCount > 0 && repairableCount > 0 
                              ? 'bg-amber-50 text-amber-800 border border-amber-200'
                              : scrapCount > 0 
                                ? 'bg-red-50 text-red-700 border border-red-200' 
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}>
                            {remarkText}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button 
                            onClick={() => setSelectedMrNo(mr)}
                            className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition-colors"
                          >
                            Generate Reports
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
          <div className="bg-slate-900 border border-slate-800 p-4 rounded flex justify-between items-center text-white print:hidden">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Selected MR</p>
              <p className="text-lg font-mono font-bold">{selectedMrNo}</p>
              <p className="text-xs text-slate-300 mt-1">{selectedJobsData.length} Transformers in this MR</p>
            </div>
            <div className="flex space-x-2">
              <button 
                onClick={handlePrint}
                className="flex items-center text-xs font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded transition-colors shadow-sm"
              >
                <Printer className="w-3.5 h-3.5 mr-1.5" /> Print / PDF
              </button>
              <button 
                onClick={handleExportExcel}
                className="flex items-center text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 rounded transition-colors shadow-sm"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" /> Export Excel
              </button>
              <button 
                onClick={() => setSelectedMrNo(null)}
                className="text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-white border border-slate-700 px-3.5 py-1.5 rounded transition-colors"
              >
                Change MR
              </button>
            </div>
          </div>

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
                <p className="mt-1">DATE : {dateString}</p>
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
                {activeAgency?.forwardingToText || `Superintending Engineer (O & M),
Uttar Gujarat Vij Company Ltd.,
Circle Office : SABARMATI`}
              </div>
              <div className="text-right whitespace-pre-wrap">
                <p>REF. NO. : {Math.floor(Math.random() * 100) + 1}</p>
                <p className="mt-2">DATE : {dateString}</p>
              </div>
            </div>

            <div className="text-sm font-bold text-center underline underline-offset-4 mb-8">
              Sub. : {activeAgency?.forwardingSubject || 'Submiting Inspection Report & Estimate of Transformer'}
            </div>

            <p className="text-sm mb-6">Dear Sir,</p>
            <p className="text-sm mb-8 leading-relaxed ml-8">
              With reference to the abvoe subject , we are submitting you inspection reports and estimates of following transformers received from {selectedJobsData[0]?.division || 'SABARMATI'}
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

            <p className="text-sm mb-12">We Request you to send the approval of above transformers earliest as possible.</p>

            <div className="flex justify-between text-sm mb-12">
              <p>Thanking you</p>
              <p>Yours faithfully</p>
            </div>

            <div className="flex justify-between text-sm mb-8">
              <p>Encl. : Estimate & Inspection Reports</p>
              <div className="text-center">
                <p className="mb-12">For, {activeAgency?.name || ''}</p>
                <p>Auth Sign.</p>
              </div>
            </div>

            <div className="text-sm font-bold">
              <p className="mb-4">C . C. to :</p>
              <p className="whitespace-pre-wrap">{activeAgency?.forwardingCcText || 'E. E. (O & M) DIVISION - SABARMATI'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
