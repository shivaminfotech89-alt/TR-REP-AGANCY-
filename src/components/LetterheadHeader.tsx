import React, { useState, useEffect, useRef } from 'react';
import { getAgencyStateCode } from '../lib/utils';
import { Agency } from '../lib/AgencyContext';
import { convertPdfPageToImage } from '../lib/letterheadUtils';
import { PRINT_BODY_ATTR, scheduleSheetMeasurement, watchSheetCutoff } from '../lib/printUtils';
import { describeCutoff, hasCutoff, type Cutoff } from '../lib/printOverflow';

interface LetterheadHeaderProps {
  agency: Agency | null;
  documentTitle?: string;
  subtitle?: string;
  className?: string;
  hideBackdropOnPrint?: boolean;
}

export function LetterheadHeader({
  agency,
  documentTitle,
  subtitle,
  className = '',
}: LetterheadHeaderProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(agency?.letterheadUrl || null);

  useEffect(() => {
    if (agency?.letterheadUrl) {
      if (agency.letterheadUrl.startsWith('data:application/pdf')) {
        convertPdfPageToImage(agency.letterheadUrl)
          .then((img) => setResolvedUrl(img))
          .catch((err) => {
            console.error('Failed to convert PDF in LetterheadHeader:', err);
            setResolvedUrl(agency.letterheadUrl);
          });
      } else {
        setResolvedUrl(agency.letterheadUrl);
      }
    } else {
      setResolvedUrl(null);
    }
  }, [agency?.letterheadUrl]);

  const isFullA4 = !!resolvedUrl && (agency?.letterheadMode === 'full_a4' || !agency?.letterheadMode);
  const isHeaderOnly = !!resolvedUrl && agency?.letterheadMode === 'header_only';
  const headerHeightMm = agency?.letterheadHeaderHeightMm ?? 38;
  const footerHeightMm = agency?.letterheadFooterHeightMm ?? 24;

  // Case 1: Full A4 Letterhead Mode
  if (isFullA4 && resolvedUrl) {
    return (
      <div className={`relative ${className}`}>
        {/* On-screen visual letterhead indicator (clean pill banner) */}
        <div className="print:hidden mb-3 p-2 bg-blue-50/90 border border-blue-200 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs shadow-2xs">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 font-bold text-blue-900 text-[10px] sm:text-[11px] uppercase tracking-wider bg-blue-100/90 px-2 py-0.5 rounded border border-blue-200">
              <span className="w-2 h-2 rounded-full bg-blue-600"></span>
              A4 Letterhead Template
            </span>
            <span className="text-[11px] text-blue-800 font-semibold truncate max-w-[200px] sm:max-w-xs">
              {agency?.name || 'Pre-Printed Stationary'}
            </span>
          </div>
          <div className="text-[10px] sm:text-[11px] font-mono text-blue-800 bg-white px-2 py-0.5 rounded border border-blue-200">
            Top Space: <span className="font-bold text-blue-950">{headerHeightMm}mm</span> | Bottom: <span className="font-bold text-blue-950">{footerHeightMm}mm</span>
          </div>
        </div>

        {/* Document Title Badge & Subtitle */}
        {documentTitle && (
          <div className="text-center my-2 mb-3">
            <div className="inline-block bg-black text-white px-5 py-0.5 rounded-full text-xs font-bold tracking-widest uppercase">
              {documentTitle}
            </div>
            {subtitle && (
              <p className="text-xs font-semibold text-slate-700 mt-1">
                {subtitle}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // Case 2: Top Header Only Image Mode
  if (isHeaderOnly && resolvedUrl) {
    return (
      <div className={`text-center mb-4 border-b-2 border-black pb-2 ${className}`}>
        <img
          src={resolvedUrl}
          alt="Agency Letterhead"
          className="max-h-24 w-full object-contain mx-auto mb-1.5"
        />
        {documentTitle && (
          <div className="mt-1 inline-block bg-black text-white px-5 py-0.5 rounded-full text-xs font-bold tracking-widest uppercase">
            {documentTitle}
          </div>
        )}
        {subtitle && <p className="text-xs font-semibold text-slate-700 mt-1">{subtitle}</p>}
      </div>
    );
  }

  // Case 3: Standard Formatted Text Header (Fallback)
  return (
    <div className={`text-center mb-4 border-b-2 border-black pb-2 ${className}`}>
      <h1 className="text-xl md:text-2xl font-black text-black tracking-wide uppercase font-serif">
        {agency?.name || 'AGENCY NAME'}
      </h1>
      {agency?.address && <p className="text-[11px] font-medium text-black mt-0.5 max-w-2xl mx-auto">{agency.address}</p>}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-0.5 text-[10px] font-bold text-black mt-1">
        {agency?.gstin && <span>GSTIN: {agency.gstin}</span>}
        {agency?.pan && <span>PAN: {agency.pan}</span>}
        {agency?.agencyState && <span>State: {agency.agencyState}{getAgencyStateCode(agency) ? ` (${getAgencyStateCode(agency)})` : ''}</span>}
        {agency?.phone && <span>Phone: {agency.phone}</span>}
        {agency?.email && <span>Email: {agency.email}</span>}
      </div>
      {documentTitle && (
        <div className="mt-2 inline-block bg-black text-white px-5 py-0.5 rounded-full text-xs font-bold tracking-widest uppercase">
          {documentTitle}
        </div>
      )}
      {subtitle && <p className="text-xs font-semibold text-slate-700 mt-1">{subtitle}</p>}
    </div>
  );
}

export interface PrintableA4PageProps {
  key?: React.Key;
  agency: Agency | null;
  children: React.ReactNode;
  /**
   * WHAT THE OPERATOR CALLS THIS SHEET - "Tax invoice", "Internal inspection report" (AUDIT G67). Required, so no
   * document can be added without one. The cut-off warning names a short sheet by it ("Tax invoice: 12 mm at the
   * bottom will be cut off"), and anything that must pick one document out of a package - a refusal, a record - has
   * only this to go on. Not printed: `documentTitle` is what paper says, and several sheets have none.
   */
  sheetName: string;
  documentTitle?: string;
  subtitle?: string;
  className?: string;
  id?: string;
  orientation?: 'portrait' | 'landscape';
  headerSpaceMm?: number;
  footerSpaceMm?: number;
  marginLeftMm?: number;
  marginRightMm?: number;
  showAgencyHeaderIfNoLetterhead?: boolean;
  style?: React.CSSProperties;
}

/**
 * PrintableA4Page: Guarantees strict 1-page A4 boundaries (210mm x 297mm portrait or 297mm x 210mm landscape)
 * with dedicated top and bottom safety zones matching pre-printed letterhead stationary.
 *
 * ⚠ THE BODY HIDES OVERFLOW, SO EVERY SHEET MEASURES WHAT IT WILL LOSE AND SAYS SO (AUDIT O64, G66). Content past
 * the body - between the letterhead's reservations - is cut off on the preview and on paper. Measured after every
 * change to what the sheet holds - as laid out for print, which is not the screen's layout - written to
 * `data-cutoff-bottom-mm` / `data-cutoff-right-mm` (`data-cutoff-state` says whether it has been measured yet), and shown
 * as a red bar across the sheet with the number. The bar is on screen only: hidden from print, dropped from Word.
 */
export function PrintableA4Page({
  agency,
  children,
  sheetName,
  documentTitle,
  subtitle,
  className = '',
  id,
  orientation = 'portrait',
  headerSpaceMm,
  footerSpaceMm,
  marginLeftMm,
  marginRightMm,
  showAgencyHeaderIfNoLetterhead = true,
}: PrintableA4PageProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(agency?.letterheadUrl || null);

  useEffect(() => {
    if (agency?.letterheadUrl) {
      if (agency.letterheadUrl.startsWith('data:application/pdf')) {
        convertPdfPageToImage(agency.letterheadUrl)
          .then((img) => setResolvedUrl(img))
          .catch((err) => {
            console.error('Failed to convert PDF in PrintableA4Page:', err);
            setResolvedUrl(agency.letterheadUrl);
          });
      } else {
        setResolvedUrl(agency.letterheadUrl);
      }
    } else {
      setResolvedUrl(null);
    }
  }, [agency?.letterheadUrl]);

  const pageRef = useRef<HTMLDivElement | null>(null);
  const [cutoff, setCutoff] = useState<Cutoff>({ bottomMm: 0, rightMm: 0 });
  const [measured, setMeasured] = useState(false);

  // Measured AS PRINTED, not as shown (lib/printUtils measureAsPrinted): every sheet on screen together, 400ms after
  // the last change to any of them - its size, its DOM, fonts arriving, an image loading inside it. State only changes
  // when the number does, and the bar sits outside the observed body, so it cannot re-render the sheet into a loop.
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const stop = watchSheetCutoff(page, next => {
      setCutoff(prev => (prev.bottomMm === next.bottomMm && prev.rightMm === next.rightMm ? prev : next));
      setMeasured(true);
    });
    const again = () => scheduleSheetMeasurement();
    const body = page.querySelector(`[${PRINT_BODY_ATTR}]`);
    const resize = body && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(again) : null;
    if (body) resize?.observe(body);
    const mutation = body && typeof MutationObserver !== 'undefined' ? new MutationObserver(again) : null;
    if (body) mutation?.observe(body, { childList: true, subtree: true, characterData: true, attributes: true });
    body?.addEventListener('load', again, true);
    (document as any).fonts?.ready?.then(again).catch(() => {});
    window.addEventListener('load', again);
    return () => {
      stop();
      resize?.disconnect();
      mutation?.disconnect();
      body?.removeEventListener('load', again, true);
      window.removeEventListener('load', again);
    };
  }, [resolvedUrl, orientation]);

  const isLandscape = orientation === 'landscape';
  const widthMm = isLandscape ? '297mm' : '210mm';
  const heightMm = isLandscape ? '210mm' : '297mm';

  const isFullA4 = !!resolvedUrl && (agency?.letterheadMode === 'full_a4' || !agency?.letterheadMode);
  const effectiveHeaderHeightMm = headerSpaceMm ?? agency?.letterheadHeaderHeightMm ?? (isLandscape ? 28 : 38);
  const effectiveFooterHeightMm = footerSpaceMm ?? agency?.letterheadFooterHeightMm ?? (isLandscape ? 16 : 24);
  const effectiveLeftMarginMm = marginLeftMm ?? agency?.letterheadMarginLeftMm ?? (isLandscape ? 10 : 14);
  const effectiveRightMarginMm = marginRightMm ?? agency?.letterheadMarginRightMm ?? (isLandscape ? 10 : 14);

  return (
    <div
      id={id}
      ref={pageRef}
      data-sheet-name={sheetName}
      data-cutoff-bottom-mm={cutoff.bottomMm}
      data-cutoff-right-mm={cutoff.rightMm}
      data-cutoff-state={measured ? 'measured' : 'pending'}
      className={`a4-print-page relative bg-white ${isLandscape ? 'landscape' : ''} ${className}`}
      style={{
        width: widthMm,
        height: heightMm,
        maxHeight: heightMm,
        minHeight: heightMm,
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Pre-Printed Letterhead Full A4 Background Image (Rendered both in preview & print) */}
      {isFullA4 && resolvedUrl && (
        <img
          src={resolvedUrl}
          alt="A4 Letterhead Background"
          className="absolute inset-0 pointer-events-none select-none z-0 object-fill"
          style={{ width: widthMm, height: heightMm, objectFit: 'fill' }}
        />
      )}

      {/* THE CUT-OFF, SAID ON THE SHEET (AUDIT G66). Absolutely positioned, so it cannot change the layout it reports on;
          outside the measured body, so it is never measured; hidden from print; dropped from the Word export. */}
      {hasCutoff(cutoff) && (
        <div data-screen-only="" role="alert" className="print:hidden absolute inset-x-0 top-0 z-30 pointer-events-none">
          <div className="m-2 rounded-md border-2 border-red-800 bg-red-600 px-3 py-2 text-center text-white shadow-lg">
            <p className="text-sm font-black uppercase tracking-wide">This sheet will print short</p>
            <p className="text-[13px] font-bold">{describeCutoff(cutoff)}</p>
          </div>
        </div>
      )}

      {/* Structured Content Area - Strictly padded between header and footer */}
      <div
        className="relative z-10 w-full h-full box-border flex flex-col justify-between text-black"
        style={{
          paddingTop: isFullA4 ? `${effectiveHeaderHeightMm}mm` : (isLandscape ? '6mm' : '8mm'),
          paddingBottom: isFullA4 ? `${effectiveFooterHeightMm}mm` : (isLandscape ? '6mm' : '8mm'),
          paddingLeft: `${effectiveLeftMarginMm}mm`,
          paddingRight: `${effectiveRightMarginMm}mm`,
          height: heightMm,
          maxHeight: heightMm,
          boxSizing: 'border-box',
        }}
      >
        {/* Top Header if No Full A4 Letterhead */}
        {!isFullA4 && showAgencyHeaderIfNoLetterhead && (
          <div className="shrink-0 mb-1.5">
            <LetterheadHeader agency={agency} documentTitle={documentTitle} subtitle={subtitle} />
          </div>
        )}

        {/* Optional Title Badge if on letterhead */}
        {isFullA4 && documentTitle && (
          <div className="text-center shrink-0 mb-2">
            <div className="inline-block bg-black text-white px-4 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase">
              {documentTitle}
            </div>
            {subtitle && <p className="text-[9px] font-semibold text-slate-700 mt-0.5">{subtitle}</p>}
          </div>
        )}

        {/* Main Body - the clipping box. Marked so the cut-off measurement finds it (lib/printUtils). */}
        <div data-print-body="" className="flex-1 w-full overflow-hidden flex flex-col justify-between">
          {children}
        </div>
      </div>
    </div>
  );
}

export function LetterheadPageWrapper({
  agency,
  children,
  sheetName,
  className = '',
  documentTitle,
  subtitle,
}: {
  agency: Agency | null;
  children: React.ReactNode;
  sheetName: string;
  className?: string;
  documentTitle?: string;
  subtitle?: string;
  showTitleBadge?: boolean;
}) {
  return (
    <PrintableA4Page agency={agency} sheetName={sheetName} documentTitle={documentTitle} subtitle={subtitle} className={className}>
      {children}
    </PrintableA4Page>
  );
}

