import React from 'react';
import { Agency } from '../lib/AgencyContext';

interface LetterheadHeaderProps {
  agency: Agency | null;
  documentTitle?: string;
  subtitle?: string;
  className?: string;
}

export function LetterheadHeader({ agency, documentTitle, subtitle, className = '' }: LetterheadHeaderProps) {
  if (agency?.letterheadUrl && agency.letterheadUrl.trim() !== '') {
    return (
      <div className={`text-center mb-6 border-b-2 border-black pb-4 ${className}`}>
        {agency.letterheadUrl.startsWith('data:application/pdf') ? (
          <object data={agency.letterheadUrl} type="application/pdf" className="w-full h-36 mx-auto mb-2 object-contain">
            <div className="p-2 border border-slate-300 rounded text-center">
              <h1 className="text-2xl font-black text-black tracking-wide uppercase">{agency.name}</h1>
            </div>
          </object>
        ) : (
          <img src={agency.letterheadUrl} alt="Agency Letterhead" className="max-h-36 w-full object-contain mx-auto mb-2" />
        )}
        {documentTitle && (
          <div className="mt-2 inline-block bg-black text-white px-6 py-1 rounded-full text-xs font-bold tracking-widest uppercase print:bg-black print:text-white">
            {documentTitle}
          </div>
        )}
        {subtitle && <p className="text-xs font-semibold text-slate-700 mt-1">{subtitle}</p>}
      </div>
    );
  }

  return (
    <div className={`text-center mb-6 border-b-2 border-black pb-4 ${className}`}>
      <h1 className="text-2xl md:text-3xl font-black text-black tracking-wide uppercase font-serif">
        {agency?.name || 'AGENCY NAME'}
      </h1>
      {agency?.address && <p className="text-xs font-medium text-black mt-1 max-w-2xl mx-auto">{agency.address}</p>}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] font-bold text-black mt-2">
        {agency?.gstin && <span>GSTIN: {agency.gstin}</span>}
        {agency?.pan && <span>PAN: {agency.pan}</span>}
        {agency?.agencyState && <span>State: {agency.agencyState}{agency.agencyStateCode ? ` (${agency.agencyStateCode})` : ''}</span>}
        {agency?.phone && <span>Phone: {agency.phone}</span>}
        {agency?.email && <span>Email: {agency.email}</span>}
        {agency?.msmeNo && <span>MSME: {agency.msmeNo}</span>}
      </div>
      {documentTitle && (
        <div className="mt-3 inline-block bg-black text-white px-6 py-1 rounded-full text-xs font-bold tracking-widest uppercase print:bg-black print:text-white">
          {documentTitle}
        </div>
      )}
      {subtitle && <p className="text-xs font-semibold text-slate-700 mt-1">{subtitle}</p>}
    </div>
  );
}
