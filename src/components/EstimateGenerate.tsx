
import { useAgency } from '../lib/AgencyContext';
import React, { useState, useEffect, useMemo } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Loader2, Printer, Search } from 'lucide-react';
import { defaultEstimateData, EstimateItem } from '../lib/estimateData';
import { ExternalData } from './ExternalInspection';

export default function EstimateGenerate() {
  const { activeAgency } = useAgency();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedMrNo, setSelectedMrNo] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
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
      if (!groups[j.mrNo]) groups[j.mrNo] = [];
      groups[j.mrNo].push(j);
    });
    return groups;
  }, [jobs]);

  const mrJobs = useMemo(() => {
    if (!selectedMrNo) return [];
    return jobs.filter(j => j.mrNo === selectedMrNo).sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));
  }, [jobs, selectedMrNo]);
  
  const filteredMrNos = Object.keys(mrGroups).filter(mr => {
    if (!searchQuery) return true;
    return mr.toLowerCase().includes(searchQuery.toLowerCase());
  }).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const handlePrint = () => {
    window.print();
  };

  const today = new Date();
  const dateString = today.toLocaleDateString('en-GB'); // dd/mm/yyyy
  const masterData = activeAgency?.estimateMaster?.length > 0 ? activeAgency.estimateMaster : defaultEstimateData;
  
  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
  }

  return (
    <div className="max-w-6xl mx-auto print:max-w-none print:w-full print:m-0 print:p-0">
      
      {!selectedMrNo ? (
        <div className="bg-white rounded shadow-sm border border-slate-200 overflow-hidden print:hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row justify-between items-center gap-4">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-widest">Select MR to Generate Estimate</h2>
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search MR No..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 w-full bg-white"
              />
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">MR No</th>
                  <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Total Jobs</th>
                  <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMrNos.map(mr => (
                  <tr key={mr} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono font-bold">{mr}</td>
                    <td className="px-4 py-3">{mrGroups[mr].length} Jobs</td>
                    <td className="px-4 py-3">
                      <button 
                        onClick={() => setSelectedMrNo(mr)}
                        className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                      >
                        Generate Reports
                      </button>
                    </td>
                  </tr>
                ))}
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
              <p className="text-xs text-slate-300 mt-1">{mrJobs.length} Transformers in this MR</p>
            </div>
            <div className="flex space-x-2">
              <button 
                onClick={handlePrint}
                className="flex items-center text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-300 border border-slate-400/30 px-3 py-1.5 rounded transition-colors"
              >
                <Printer className="w-3 h-3 mr-1" /> Print / PDF
              </button>
              <button 
                onClick={() => setSelectedMrNo(null)}
                className="text-[10px] font-bold uppercase tracking-widest text-blue-400 hover:text-blue-300 border border-blue-400/30 px-3 py-1.5 rounded transition-colors"
              >
                Change MR
              </button>
            </div>
          </div>

          {/* PAGE 1: ESTIMATE REPORT */}
          <div className="bg-white p-8 rounded shadow-sm border border-slate-200 print:shadow-none print:border-none print:p-0">
            {/* Header */}
            <div className="text-center mb-6 text-black border-b-2 border-black pb-4">
              {activeAgency?.letterheadUrl ? (
                <img src={activeAgency.letterheadUrl} alt="Letterhead" className="max-h-32 mx-auto mb-4 object-contain" />
              ) : (
                <h1 className="text-4xl font-black mb-2 text-green-800 tracking-tighter uppercase font-serif" style={{WebkitTextStroke: '1px black'}}>{activeAgency?.name || 'Ideal Engineering Co.'}</h1>
              )}
            </div>

            <div className="flex justify-between items-center text-[10px] font-bold uppercase text-black mb-2 border-b-2 border-black pb-2">
              <div>
                <p>DIVISION : {mrJobs[0]?.division || 'SABARMATI'}</p>
                <p className="mt-1">ORDER NO : {activeAgency?.prefixes?.[mrJobs[0]?.division || 'SABARMATI'] ? 'UGVCL/EE-T-1/TRANS-REP/...' : '...'}</p>
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
                  {mrJobs.map(job => (
                    <td key={job.id} className="p-1 border-r border-black text-center">{job.coreType || 'CRGO'}</td>
                  ))}
                </tr>
                <tr className="border-b border-black font-bold">
                  <td className="p-1 border-r-2 border-black">JOB NO</td>
                  {mrJobs.map(job => (
                    <td key={job.id} className="p-1 border-r border-black text-center">{job.jobNo}</td>
                  ))}
                </tr>
                <tr className="border-b border-black font-bold">
                  <td className="p-1 border-r-2 border-black">MAKE</td>
                  {mrJobs.map(job => (
                    <td key={job.id} className="p-1 border-r border-black text-center">{job.make}</td>
                  ))}
                </tr>
                <tr className="border-b border-black font-bold">
                  <td className="p-1 border-r-2 border-black">KVA / KV</td>
                  {mrJobs.map(job => (
                    <td key={job.id} className="p-1 border-r border-black text-center">{job.capacityKva} / 11</td>
                  ))}
                </tr>
                <tr className="border-b border-black font-bold">
                  <td className="p-1 border-r-2 border-black">TSR NO.</td>
                  {mrJobs.map(job => (
                    <td key={job.id} className="p-1 border-r border-black text-center">{job.serialNo}</td>
                  ))}
                </tr>
                <tr className="border-b border-black font-bold">
                  <td className="p-1 border-r-2 border-black">MR NO. & DATE</td>
                  {mrJobs.map(job => (
                    <td key={job.id} className="p-1 border-r border-black text-center">{job.mrNo}</td>
                  ))}
                </tr>
                <tr className="border-b-2 border-black font-bold">
                  <td className="p-1 border-r-2 border-black">Oil Cap / Less Oil / Filter Oil</td>
                  {mrJobs.map(job => (
                    <td key={job.id} className="p-1 border-r border-black text-center">- / - / -</td>
                  ))}
                </tr>

                {/* Sub headers */}
                <tr className="border-b-2 border-black font-bold bg-slate-100 print:bg-transparent">
                  <td className="p-1 border-r-2 border-black flex justify-between">
                    <span>As Per AT Sr</span>
                    <span className="text-center flex-1">ITEM</span>
                  </td>
                  {mrJobs.map(job => (
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
                {masterData.map((item, idx) => (
                  <tr key={idx} className="border-b border-slate-400">
                    <td className="p-1 border-r-2 border-black flex gap-2">
                      <span className="w-8">{item.itemCode}</span>
                      <span>{item.itemName}</span>
                    </td>
                    {mrJobs.map(job => {
                      const kva = String(job.capacityKva);
                      const rawRate = item.rates[kva as keyof typeof item.rates] || 0;
                      const rate = typeof rawRate === "string" ? parseFloat(rawRate) : Number(rawRate);
                      
                      let qty = 0;
                      let qtyDisplay = '0';
                      
                      if (rate > 0) {
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
                      
                      if (item.itemCode === '16' || item.itemCode === '17' || item.itemCode === '18' || item.itemCode === '6' || item.itemCode === '3') {
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
                  {mrJobs.map(job => {
                     const kva = String(job.capacityKva);
                     let jobTotal = 0;
                     masterData.forEach(item => {
                        const rawRate = item.rates[kva as keyof typeof item.rates] || 0;
                      const rate = typeof rawRate === "string" ? parseFloat(rawRate) : Number(rawRate);
                        let qty = 0;
                        if (rate > 0) {
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
                        if (item.itemCode === '16' || item.itemCode === '17' || item.itemCode === '18' || item.itemCode === '6' || item.itemCode === '3') {
                            qty = 0;
                        }
                        jobTotal += (qty * rate);
                     });
                     
                    return <td key={job.id} className="p-2 border-r border-black text-right">{jobTotal.toFixed(2)}</td>
                  })}
                </tr>
                <tr className="border-t border-black font-bold">
                  <td className="p-2 border-r-2 border-black text-right">4.00 % Rise Total</td>
                  {mrJobs.map(job => {
                     const kva = String(job.capacityKva);
                     let jobTotal = 0;
                     masterData.forEach(item => {
                        const rawRate = item.rates[kva as keyof typeof item.rates] || 0;
                      const rate = typeof rawRate === "string" ? parseFloat(rawRate) : Number(rawRate);
                        let qty = 0;
                        if (rate > 0) {
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
                        if (item.itemCode === '16' || item.itemCode === '17' || item.itemCode === '18' || item.itemCode === '6' || item.itemCode === '3') {
                            qty = 0;
                        }
                        jobTotal += (qty * rate);
                     });
                    return <td key={job.id} className="p-2 border-r border-black text-right">{(jobTotal * 0.04).toFixed(2)}</td>
                  })}
                </tr>
                <tr className="border-t-2 border-black font-bold text-[10px]">
                  <td className="p-2 border-r-2 border-black text-right">Grand Total</td>
                  {mrJobs.map(job => {
                     const kva = String(job.capacityKva);
                     let jobTotal = 0;
                     masterData.forEach(item => {
                        const rawRate = item.rates[kva as keyof typeof item.rates] || 0;
                      const rate = typeof rawRate === "string" ? parseFloat(rawRate) : Number(rawRate);
                        let qty = 0;
                        if (rate > 0) {
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
                        if (item.itemCode === '16' || item.itemCode === '17' || item.itemCode === '18' || item.itemCode === '6' || item.itemCode === '3') {
                            qty = 0;
                        }
                        jobTotal += (qty * rate);
                     });
                    return <td key={job.id} className="p-2 border-r border-black text-right">{(jobTotal * 1.04).toFixed(2)}</td>
                  })}
                </tr>
              </tbody>
            </table>
            
            <div className="flex justify-between items-end mt-8 text-black text-sm font-bold pb-16">
              <div>
                <p className="underline underline-offset-4">Note -</p>
              </div>
              <div className="text-center">
                <p className="mb-12">For, {activeAgency?.name || 'Ideal Engineering Co.'}</p>
                <p>Auth Sign.</p>
              </div>
            </div>
          </div>

          {/* PAGE BREAK HERE for FORWARDING LETTER */}
          <div className="break-before-page"></div>

          {/* PAGE 2: FORWARDING LETTER */}
          <div className="bg-white p-12 mt-8 rounded shadow-sm border border-slate-200 print:shadow-none print:border-none print:p-0 print:mt-0 text-black">
            <div className="text-center mb-10 border-b-2 border-black pb-4">
              {activeAgency?.letterheadUrl ? (
                <img src={activeAgency.letterheadUrl} alt="Letterhead" className="max-h-32 mx-auto mb-4 object-contain" />
              ) : (
                <h1 className="text-4xl font-black mb-2 text-green-800 tracking-tighter uppercase font-serif" style={{WebkitTextStroke: '1px black'}}>{activeAgency?.name || 'Ideal Engineering Co.'}</h1>
              )}
            </div>

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
              With reference to the abvoe subject , we are submitting you inspection reports and estimates of following transformers received from {mrJobs[0]?.division || 'SABARMATI'}
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
                  <th className="p-2">EST. AMT.</th>
                </tr>
              </thead>
              <tbody>
                {mrJobs.map((job, idx) => {
                   const kva = String(job.capacityKva);
                   let jobTotal = 0;
                   masterData.forEach(item => {
                      const rawRate = item.rates[kva as keyof typeof item.rates] || 0;
                      const rate = typeof rawRate === "string" ? parseFloat(rawRate) : Number(rawRate);
                      let qty = 0;
                      if (rate > 0) {
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
                      if (item.itemCode === '16' || item.itemCode === '17' || item.itemCode === '18' || item.itemCode === '6' || item.itemCode === '3') {
                          qty = 0;
                      }
                      jobTotal += (qty * rate);
                   });
                   const finalAmt = (jobTotal * 1.04).toFixed(2);
                   
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
                      <td className="p-2 text-right">{finalAmt}</td>
                    </tr>
                  )
                })}
                <tr className="font-bold border-black">
                  <td colSpan={8} className="p-2 border-r border-black text-right">TOTAL</td>
                  <td className="p-2 text-right">
                    {mrJobs.reduce((acc, job) => {
                       const kva = String(job.capacityKva);
                       let jobTotal = 0;
                       masterData.forEach(item => {
                          const rawRate = item.rates[kva as keyof typeof item.rates] || 0;
                      const rate = typeof rawRate === "string" ? parseFloat(rawRate) : Number(rawRate);
                          let qty = 0;
                          if (rate > 0) {
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
                          if (item.itemCode === '16' || item.itemCode === '17' || item.itemCode === '18' || item.itemCode === '6' || item.itemCode === '3') {
                              qty = 0;
                          }
                          jobTotal += (qty * rate);
                       });
                       return acc + (jobTotal * 1.04);
                    }, 0).toFixed(2)}
                  </td>
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
                <p className="mb-12">For, {activeAgency?.name || 'Ideal Engineering Co.'}</p>
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
