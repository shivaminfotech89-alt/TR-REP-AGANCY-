import React, { useState, useRef, useEffect } from 'react';
import { FileUp, Trash2, Eye, Check, AlertCircle, Printer, Sliders, Layers, Sparkles, ZoomIn, Loader2 } from 'lucide-react';
import { processLetterheadFile, convertPdfPageToImage } from '../lib/letterheadUtils';

interface LetterheadCalibratorProps {
  letterheadUrl: string;
  letterheadMode: 'full_a4' | 'header_only' | 'standard';
  headerHeightMm: number;
  footerHeightMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  agencyName: string;
  onLetterheadChange: (url: string) => void;
  onModeChange: (mode: 'full_a4' | 'header_only' | 'standard') => void;
  onHeaderHeightChange: (val: number) => void;
  onFooterHeightChange: (val: number) => void;
  onMarginLeftChange: (val: number) => void;
  onMarginRightChange: (val: number) => void;
}

export function LetterheadCalibrator({
  letterheadUrl,
  letterheadMode,
  headerHeightMm,
  footerHeightMm,
  marginLeftMm,
  marginRightMm,
  agencyName,
  onLetterheadChange,
  onModeChange,
  onHeaderHeightChange,
  onFooterHeightChange,
  onMarginLeftChange,
  onMarginRightChange,
}: LetterheadCalibratorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMsg, setProcessingMsg] = useState('');
  const [showTestPrintModal, setShowTestPrintModal] = useState(false);
  const [uploadSuccessNote, setUploadSuccessNote] = useState<string | null>(null);

  // Automatically convert legacy or pre-existing PDF base64 strings into crisp images on mount/prop change
  useEffect(() => {
    if (letterheadUrl && letterheadUrl.startsWith('data:application/pdf')) {
      setIsProcessing(true);
      setProcessingMsg('Converting saved PDF letterhead to high-definition A4 template...');
      convertPdfPageToImage(letterheadUrl)
        .then((imageUri) => {
          onLetterheadChange(imageUri);
          setUploadSuccessNote('Existing PDF Letterhead was automatically converted to high-definition A4 template!');
        })
        .catch((err) => {
          console.error('Failed to auto-convert PDF letterhead:', err);
        })
        .finally(() => {
          setIsProcessing(false);
          setProcessingMsg('');
        });
    }
  }, [letterheadUrl, onLetterheadChange]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsProcessing(true);
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      setProcessingMsg(isPdf ? 'Reading PDF page & rendering high-definition A4 template...' : 'Optimizing letterhead image...');
      
      const { dataUrl, isPdfConverted } = await processLetterheadFile(file);
      onLetterheadChange(dataUrl);
      onModeChange('full_a4');
      setUploadSuccessNote(
        isPdfConverted 
          ? `PDF "${file.name}" rendered successfully as A4 letterhead template!`
          : `Image "${file.name}" processed & loaded!`
      );
    } catch (err: any) {
      console.error('Error processing letterhead:', err);
      alert(`Could not process letterhead file: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
      setProcessingMsg('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleClearLetterhead = () => {
    if (confirm('Are you sure you want to remove the current letterhead?')) {
      onLetterheadChange('');
      onModeChange('standard');
      setUploadSuccessNote(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleTestPrint = () => {
    window.print();
  };

  // Convert mm to approximate preview percentages on A4 (297mm height, 210mm width)
  const headerPercent = Math.min(Math.max((headerHeightMm / 297) * 100, 5), 40);
  const footerPercent = Math.min(Math.max((footerHeightMm / 297) * 100, 3), 30);
  const sideMarginPercent = Math.min(Math.max((marginLeftMm / 210) * 100, 2), 20);

  return (
    <div className="bg-slate-50 p-4 sm:p-5 rounded-xl border border-slate-200 space-y-5">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-indigo-600" />
            A4 Letterhead Setup & Page Calibration
          </h4>
          <p className="text-[11px] text-slate-500">
            Upload your official pre-printed A4 letterhead (PDF or Image). It will automatically repeat on all printed documents with content fitting between the header & footer.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {letterheadUrl && (
            <button
              type="button"
              onClick={() => setShowTestPrintModal(true)}
              className="text-xs font-bold text-indigo-700 hover:text-indigo-900 flex items-center bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg border border-indigo-200 transition-colors shadow-2xs cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 mr-1" /> Test Print Sample
            </button>
          )}
        </div>
      </div>

      {/* Mode Selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label
          className={`relative p-3.5 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
            letterheadMode === 'full_a4'
              ? 'border-indigo-600 bg-indigo-50/50 shadow-xs'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs font-bold text-slate-900 block">📄 Full A4 Letterhead</span>
              <span className="text-[10px] text-slate-500 block mt-0.5 leading-snug">
                Repeats on every printed page. Content auto-fits between top header and bottom footer.
              </span>
            </div>
            <input
              type="radio"
              name="letterheadMode"
              checked={letterheadMode === 'full_a4'}
              onChange={() => onModeChange('full_a4')}
              className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
            />
          </div>
          <span className="text-[9px] font-bold text-indigo-700 mt-2 uppercase tracking-wide">
            Recommended for official forms
          </span>
        </label>

        <label
          className={`relative p-3.5 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
            letterheadMode === 'header_only'
              ? 'border-indigo-600 bg-indigo-50/50 shadow-xs'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs font-bold text-slate-900 block">🏷️ Top Banner Only</span>
              <span className="text-[10px] text-slate-500 block mt-0.5 leading-snug">
                Only shows company header banner at the top of document page 1.
              </span>
            </div>
            <input
              type="radio"
              name="letterheadMode"
              checked={letterheadMode === 'header_only'}
              onChange={() => onModeChange('header_only')}
              className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
            />
          </div>
          <span className="text-[9px] font-semibold text-slate-500 mt-2 uppercase tracking-wide">
            Header Banner Mode
          </span>
        </label>

        <label
          className={`relative p-3.5 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
            letterheadMode === 'standard'
              ? 'border-indigo-600 bg-indigo-50/50 shadow-xs'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs font-bold text-slate-900 block">🔤 Clean Text Format</span>
              <span className="text-[10px] text-slate-500 block mt-0.5 leading-snug">
                Standard structured company profile text (GST, PAN, Address) with no image.
              </span>
            </div>
            <input
              type="radio"
              name="letterheadMode"
              checked={letterheadMode === 'standard'}
              onChange={() => onModeChange('standard')}
              className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
            />
          </div>
          <span className="text-[9px] font-semibold text-slate-500 mt-2 uppercase tracking-wide">
            Digital Plain Text
          </span>
        </label>
      </div>

      {/* Upload and Calibration Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left column: Upload & Sliders (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* File Upload Box */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
            <input
              type="file"
              accept="image/png, image/jpeg, image/jpg, image/webp, application/pdf, .pdf"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-800">
                  Upload A4 Letterhead (PDF or Image)
                </label>
                <span className="text-[11px] text-slate-500">
                  Accepts scanned PDF documents, JPG, PNG or WebP files
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                  className="px-3.5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 rounded-lg transition-colors flex items-center shadow-xs cursor-pointer"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <FileUp className="w-3.5 h-3.5 mr-1.5" />
                      {letterheadUrl ? 'Change PDF / Image' : 'Upload PDF / Image'}
                    </>
                  )}
                </button>

                {letterheadUrl && !isProcessing && (
                  <button
                    type="button"
                    onClick={handleClearLetterhead}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                    title="Remove Letterhead"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {isProcessing && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2 text-xs text-blue-800">
                <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
                <span>{processingMsg || 'Processing letterhead document...'}</span>
              </div>
            )}

            {uploadSuccessNote && !isProcessing && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between text-xs text-emerald-800 font-medium">
                <span className="flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-600" />
                  {uploadSuccessNote}
                </span>
              </div>
            )}

            {letterheadUrl && !isProcessing ? (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between text-xs text-emerald-800 font-semibold">
                <span className="flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-600" />
                  A4 Letterhead is configured and ready for all documents!
                </span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 bg-emerald-100 rounded text-emerald-900">
                  Active
                </span>
              </div>
            ) : !isProcessing ? (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-xs text-amber-800">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  No letterhead uploaded yet. Plain text agency information will be used for documents until an A4 letterhead copy is uploaded.
                </span>
              </div>
            ) : null}
          </div>

          {/* Margins Calibration Controls */}
          {letterheadMode === 'full_a4' && (
            <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h5 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-indigo-600" />
                  Print Safe-Zone & Margin Calibration
                </h5>
                <span className="text-[10px] text-slate-500 font-mono">
                  Exact spacing in Millimeters (mm)
                </span>
              </div>

              {/* Header Height Slider */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-xs">
                  <label className="font-bold text-blue-900 flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block"></span>
                    Top Header Space (mm)
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={15}
                      max={85}
                      value={headerHeightMm}
                      onChange={(e) => onHeaderHeightChange(Number(e.target.value))}
                      className="w-16 px-2 py-0.5 text-xs text-right font-mono font-bold border border-slate-300 rounded focus:ring-1 focus:ring-indigo-500"
                    />
                    <span className="text-[10px] text-slate-500 font-mono">mm</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={15}
                  max={85}
                  step={1}
                  value={headerHeightMm}
                  onChange={(e) => onHeaderHeightChange(Number(e.target.value))}
                  className="w-full h-1.5 bg-blue-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <p className="text-[10px] text-slate-500">
                  Height reserved at top of every page for company header/logo (typically 35–45mm).
                </p>
              </div>

              {/* Footer Height Slider */}
              <div className="space-y-1.5 pt-2 border-t border-slate-100">
                <div className="flex justify-between items-center text-xs">
                  <label className="font-bold text-emerald-900 flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block"></span>
                    Bottom Footer Space (mm)
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={10}
                      max={60}
                      value={footerHeightMm}
                      onChange={(e) => onFooterHeightChange(Number(e.target.value))}
                      className="w-16 px-2 py-0.5 text-xs text-right font-mono font-bold border border-slate-300 rounded focus:ring-1 focus:ring-indigo-500"
                    />
                    <span className="text-[10px] text-slate-500 font-mono">mm</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={10}
                  max={60}
                  step={1}
                  value={footerHeightMm}
                  onChange={(e) => onFooterHeightChange(Number(e.target.value))}
                  className="w-full h-1.5 bg-emerald-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                />
                <p className="text-[10px] text-slate-500">
                  Height reserved at bottom of every page for footer details (typically 20–30mm).
                </p>
              </div>

              {/* Left/Right Margins */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Left Margin (mm)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={30}
                    value={marginLeftMm}
                    onChange={(e) => onMarginLeftChange(Number(e.target.value))}
                    className="w-full px-2 py-1 text-xs font-mono font-semibold border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Right Margin (mm)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={30}
                    value={marginRightMm}
                    onChange={(e) => onMarginRightChange(Number(e.target.value))}
                    className="w-full px-2 py-1 text-xs font-mono font-semibold border border-slate-300 rounded"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right column: Interactive Visual A4 Sheet Mockup (5 cols) */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div className="w-full max-w-[280px] bg-white rounded-lg border-2 border-slate-400 shadow-md overflow-hidden relative" style={{ aspectRatio: '1 / 1.414' }}>
            {/* Letterhead Background Layer */}
            {letterheadUrl ? (
              <img
                src={letterheadUrl}
                alt="Letterhead Preview"
                className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none opacity-90"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col justify-between p-3 pointer-events-none bg-slate-50/50">
                <div className="h-8 border-b-2 border-slate-300 flex items-center justify-center">
                  <span className="text-[9px] font-bold text-slate-400 uppercase">Pre-Printed Header</span>
                </div>
                <div className="h-6 border-t-2 border-slate-300 flex items-center justify-center">
                  <span className="text-[8px] font-bold text-slate-400 uppercase">Pre-Printed Footer</span>
                </div>
              </div>
            )}

            {/* Visual Guideline Overlays */}
            {letterheadMode === 'full_a4' && (
              <>
                {/* Header Guide Line */}
                <div
                  className="absolute left-0 right-0 border-b-2 border-blue-500 border-dashed bg-blue-500/10 pointer-events-none z-10 flex items-end justify-between px-1.5 pb-0.5"
                  style={{ top: 0, height: `${headerPercent}%` }}
                >
                  <span className="text-[8px] font-black text-blue-700 bg-white/90 px-1 rounded shadow-2xs font-mono">
                    Header: {headerHeightMm}mm
                  </span>
                </div>

                {/* Footer Guide Line */}
                <div
                  className="absolute left-0 right-0 border-t-2 border-emerald-500 border-dashed bg-emerald-500/10 pointer-events-none z-10 flex items-start justify-between px-1.5 pt-0.5"
                  style={{ bottom: 0, height: `${footerPercent}%` }}
                >
                  <span className="text-[8px] font-black text-emerald-700 bg-white/90 px-1 rounded shadow-2xs font-mono">
                    Footer: {footerHeightMm}mm
                  </span>
                </div>

                {/* Left/Right Guideline Box */}
                <div
                  className="absolute inset-y-0 border-x border-indigo-400/50 pointer-events-none"
                  style={{
                    left: `${sideMarginPercent}%`,
                    right: `${sideMarginPercent}%`,
                  }}
                />
              </>
            )}

            {/* Mock Content inside Safe-Zone */}
            <div
              className="absolute inset-0 flex flex-col justify-between z-20 pointer-events-none"
              style={
                letterheadMode === 'full_a4'
                  ? {
                      paddingTop: `${headerPercent + 2}%`,
                      paddingBottom: `${footerPercent + 2}%`,
                      paddingLeft: `${sideMarginPercent + 2}%`,
                      paddingRight: `${sideMarginPercent + 2}%`,
                    }
                  : { padding: '8%' }
              }
            >
              <div className="space-y-1">
                <div className="text-center">
                  <span className="inline-block bg-black text-white text-[7px] font-bold px-2 py-0.5 rounded-full uppercase">
                    ESTIMATE / CHALLAN
                  </span>
                </div>

                <div className="border border-black bg-white/90 p-1 rounded text-[7px] font-mono leading-none space-y-0.5">
                  <div className="flex justify-between font-bold">
                    <span>JOB: 21 IS-01</span>
                    <span>KVA: 100</span>
                  </div>
                  <div className="text-slate-600 truncate">DIV: SABARMATI</div>
                </div>

                {/* Sample Mock Table */}
                <table className="w-full text-[6px] border border-black bg-white/95">
                  <thead>
                    <tr className="bg-slate-200 font-bold border-b border-black">
                      <th className="p-0.5">SR</th>
                      <th className="p-0.5 text-left">ITEM</th>
                      <th className="p-0.5">AMT</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-200">
                      <td className="p-0.5 text-center">1</td>
                      <td className="p-0.5 truncate">HV COIL REPAIR</td>
                      <td className="p-0.5 text-center">4500</td>
                    </tr>
                    <tr className="border-b border-slate-200">
                      <td className="p-0.5 text-center">2</td>
                      <td className="p-0.5 truncate">LV COIL REPAIR</td>
                      <td className="p-0.5 text-center">3200</td>
                    </tr>
                    <tr>
                      <td className="p-0.5 text-center">3</td>
                      <td className="p-0.5 truncate">TRANS OIL (Ltr)</td>
                      <td className="p-0.5 text-center">1800</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-end text-[6px] font-bold bg-white/80 p-0.5 rounded">
                <span>Total: ₹9,500</span>
                <span>Auth Sign.</span>
              </div>
            </div>
          </div>

          <p className="text-[10px] text-slate-500 mt-2 text-center font-medium">
            Live Visual A4 Sheet Alignment Preview
          </p>
        </div>
      </div>

      {/* Test Print Modal */}
      {showTestPrintModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Printer className="w-5 h-5 text-indigo-600" />
                Test Print Preview — A4 Letterhead Verification
              </h3>
              <button
                type="button"
                onClick={() => setShowTestPrintModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold px-2"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Click the button below to test print this calibrated layout. In the browser print dialog, verify that your header, table, and footer margins align seamlessly without overlapping or page cuts.
            </p>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Letterhead Mode:</span>
                <span className="font-bold uppercase text-indigo-700">{letterheadMode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Top Header Space:</span>
                <span className="font-bold font-mono">{headerHeightMm} mm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Bottom Footer Space:</span>
                <span className="font-bold font-mono">{footerHeightMm} mm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Left & Right Margins:</span>
                <span className="font-bold font-mono">{marginLeftMm} mm / {marginRightMm} mm</span>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t">
              <button
                type="button"
                onClick={() => setShowTestPrintModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleTestPrint}
                className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center shadow-xs"
              >
                <Printer className="w-4 h-4 mr-1.5" />
                Print Test Page Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
