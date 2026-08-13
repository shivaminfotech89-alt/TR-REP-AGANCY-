import React, { useState, useRef, useEffect } from 'react';
import { useAgency } from '../lib/AgencyContext';
import { Loader2, Plus, Trash2, FileUp, ChevronDown, ChevronUp } from 'lucide-react';

export default function EditAgencyForm({ agency }: { agency: any }) {
  const { updateAgency } = useAgency();
  const [agencyName, setAgencyName] = useState(agency.name);
  const [gpValidationMonths, setGpValidationMonths] = useState(agency.gpValidationMonths ?? 18);
  
  const [isDivisionsExpanded, setIsDivisionsExpanded] = useState(false);
  const [isForwardingExpanded, setIsForwardingExpanded] = useState(false);
  
  const [forwardingToText, setForwardingToText] = useState(agency.forwardingToText || 'Superintending Engineer (O & M),\nUttar Gujarat Vij Company Ltd.,\nCircle Office : SABARMATI');
  const [forwardingSubject, setForwardingSubject] = useState(agency.forwardingSubject || 'Submiting Inspection Report & Estimate of Transformer');
  const [forwardingCcText, setForwardingCcText] = useState(agency.forwardingCcText || 'E. E. (O & M) DIVISION - SABARMATI');
  
  const [address, setAddress] = useState(agency.address || '');
  const [gstin, setGstin] = useState(agency.gstin || '');
  const [pan, setPan] = useState(agency.pan || '');
  const [bankName, setBankName] = useState(agency.bankName || '');
  const [accountNumber, setAccountNumber] = useState(agency.accountNumber || '');
  const [ifscCode, setIfscCode] = useState(agency.ifscCode || '');
  const [email, setEmail] = useState(agency.email || '');
  const [phone, setPhone] = useState(agency.phone || '');

  const [divisions, setDivisions] = useState<any[]>([]);
  const [letterheadBase64, setLetterheadBase64] = useState(agency.letterheadUrl || '');
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setAgencyName(agency.name);
    setLetterheadBase64(agency.letterheadUrl || '');
    
    // Parse divisions from prefixes
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
      divs.push({ name: 'SABARMATI', prefixCRGO: '21 IS', prefixAmorphous: '', prefixWoundCore: '', prefixLSTC: '', prefixOH: '' });
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
    setDivisions([...divisions, { name: '', prefixCRGO: '', prefixAmorphous: '', prefixWoundCore: '', prefixLSTC: '', prefixOH: '', allotmentCRGO: '', allotmentAmorphous: '', allotmentWoundCore: '' }]);
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
          prefixes[d.name.trim()] = {
            'CRGO': d.prefixCRGO.trim(),
            'Amorphous': d.prefixAmorphous.trim() || d.prefixCRGO.trim(),
            'Wound Core': d.prefixWoundCore.trim() || d.prefixCRGO.trim(),
            'LSTC': d.prefixLSTC.trim() || d.prefixCRGO.trim(),
            'OH': d.prefixOH.trim() || d.prefixCRGO.trim(),
          };
          allotments[d.name.trim()] = {
            'CRGO': Number(d.allotmentCRGO) || 0,
            'Amorphous': Number(d.allotmentAmorphous) || 0,
            'Wound Core': Number(d.allotmentWoundCore) || 0,
          };
          if (lastJobNumbers[d.name.trim()] === undefined) {
            lastJobNumbers[d.name.trim()] = 0;
          }
          if (lastJobNumbers[d.name.trim() + '_OH'] === undefined) {
            lastJobNumbers[d.name.trim() + '_OH'] = 0;
          }
        }
      });

      await updateAgency(agency.id, {
        name: agencyName,
        letterheadUrl: letterheadBase64,
        gpValidationMonths,
        forwardingToText,
        forwardingSubject,
        forwardingCcText,
        address,
        gstin,
        pan,
        bankName,
        accountNumber,
        ifscCode,
        email,
        phone
      });
      alert('Agency updated successfully!');
    } catch (err) {
      console.error(err);
      alert('Failed to update agency');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleUpdateAgency} className="space-y-6 pt-2">
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Agency Name</label>
        <input required type="text" value={agencyName} onChange={e => setAgencyName(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" />
      </div>

      <div className="border-t border-slate-200 pt-6 mt-6">
        <h3 className="text-sm font-bold uppercase tracking-widest text-slate-800 mb-4">Company Profile (Billing Details)</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Company Address</label>
            <textarea value={address} onChange={e => setAddress(e.target.value)} rows={3} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="Full address" />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">GSTIN</label>
            <input type="text" value={gstin} onChange={e => setGstin(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="GST Number" />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">PAN Number</label>
            <input type="text" value={pan} onChange={e => setPan(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="PAN Number" />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Bank Name</label>
            <input type="text" value={bankName} onChange={e => setBankName(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="Bank Name" />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Account Number</label>
            <input type="text" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="Account Number" />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">IFSC Code</label>
            <input type="text" value={ifscCode} onChange={e => setIfscCode(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="IFSC Code" />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="Email Address" />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Phone Number</label>
            <input type="text" value={phone} onChange={e => setPhone(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" placeholder="Phone Number" />
          </div>
        </div>
      </div>
      
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">GP Validation Period (Months)</label>
        <input required type="number" value={gpValidationMonths} onChange={e => setGpValidationMonths(Number(e.target.value))} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-slate-50" />
      </div>
      
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Letterhead (PDF)</label>
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
            className="px-4 py-2 text-xs font-bold uppercase tracking-widest bg-slate-100 text-slate-700 rounded border border-slate-300 hover:bg-slate-200 transition-colors flex items-center"
          >
            <FileUp className="w-4 h-4 mr-2" /> {letterheadBase64 ? 'Change PDF' : 'Upload PDF'}
          </button>
          {fileName && <span className="text-sm text-slate-600 truncate">{fileName}</span>}
          {!fileName && letterheadBase64 && <span className="text-sm text-slate-600 truncate">Existing PDF loaded</span>}
        </div>
      </div>
      
      <div className="pt-4 border-t border-slate-200">
        <button 
          type="button"
          onClick={() => setIsForwardingExpanded(!isForwardingExpanded)}
          className="flex items-center text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-700 mb-2"
        >
          {isForwardingExpanded ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
          Forwarding Letter Configuration
        </button>
        
        {isForwardingExpanded && (
          <div className="space-y-4 bg-slate-50 p-4 border border-slate-200 rounded">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">To Address</label>
            <textarea rows={3} value={forwardingToText} onChange={e => setForwardingToText(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="e.g. Superintending Engineer..." />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Subject</label>
            <input type="text" value={forwardingSubject} onChange={e => setForwardingSubject(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">C.C. To</label>
            <textarea rows={2} value={forwardingCcText} onChange={e => setForwardingCcText(e.target.value)} className="w-full px-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 bg-white" placeholder="e.g. E. E. (O & M) DIVISION..." />
          </div>
        </div>
        )}
      </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end space-x-2">
        <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-xs font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center">
          {isSubmitting && <Loader2 className="w-3 h-3 mr-2 animate-spin" />} Update Active Agency
        </button>
      </div>
    </form>
  );
}
