import html2pdf from 'html2pdf.js';

export interface PrintOptions {
  filename?: string;
  documentTitle?: string;
  letterheadMode?: 'full_a4' | 'header_only' | 'none';
  orientation?: 'portrait' | 'landscape';
}

/**
 * Downloads the specified DOM element as a crisp, print-ready A4 PDF.
 * Each child page with .a4-print-page is rendered as a clean, standalone A4 page.
 */
export async function downloadElementAsPdf(
  elementId: string,
  filename: string = 'document.pdf',
  orientation: 'portrait' | 'landscape' = 'portrait'
): Promise<boolean> {
  const element = document.getElementById(elementId);
  if (!element) {
    console.error(`Element with id "${elementId}" not found for PDF export.`);
    return false;
  }

  const isLandscape = orientation === 'landscape';

  const opt = {
    margin: [0, 0, 0, 0],
    filename: filename.endsWith('.pdf') ? filename : `${filename}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      logging: false,
      letterRendering: true,
      scrollY: 0,
      windowWidth: isLandscape ? 1400 : 1024,
    },
    jsPDF: {
      unit: 'mm',
      format: 'a4',
      orientation: orientation,
      compress: true
    },
    pagebreak: { 
      mode: ['css', 'legacy'],
      after: ['.a4-print-page', '.print-page-break-after', '.break-after-page'],
      avoid: ['.a4-print-page', '.print-avoid-break', 'tr']
    }
  };

  try {
    // @ts-ignore
    await html2pdf().set(opt).from(element).save();
    return true;
  } catch (err) {
    console.error('Failed to generate PDF via html2pdf:', err);
    return false;
  }
}

/**
 * Universal Print & PDF trigger:
 * 1. Attempts to open a dedicated standalone print tab formatted with exact A4 pages (portrait or landscape).
 * 2. If blocked or running inside a sandboxed iframe, falls back to direct A4 PDF download.
 */
export async function triggerUniversalPrint(
  elementId: string,
  documentTitle: string = 'Document',
  filename: string = 'document.pdf',
  orientation: 'portrait' | 'landscape' = 'portrait'
) {
  const sourceEl = document.getElementById(elementId);
  if (!sourceEl) {
    console.warn(`Element #${elementId} not found, invoking window.print directly`);
    window.print();
    return;
  }

  const isLandscape = orientation === 'landscape';
  const pageWidth = isLandscape ? '297mm' : '210mm';
  const pageHeight = isLandscape ? '210mm' : '297mm';

  // Attempt to open a clean standalone printable window
  let printWindowOpened = false;
  try {
    const printWin = window.open('', '_blank', `width=${isLandscape ? 1200 : 950},height=850,menubar=no,toolbar=no,location=no,status=no`);
    if (printWin) {
      printWindowOpened = true;
      const headElements = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
        .map(el => el.outerHTML)
        .join('\n');

      printWin.document.open();
      printWin.document.write(`
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <title>${documentTitle}</title>
            ${headElements}
            <style>
              @page {
                size: A4 ${orientation};
                margin: 0;
              }
              html, body {
                margin: 0 !important;
                padding: 0 !important;
                background: #ffffff !important;
                color: #000000 !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              }
              .a4-print-page {
                width: ${pageWidth} !important;
                min-height: ${pageHeight} !important;
                height: ${pageHeight} !important;
                max-height: ${pageHeight} !important;
                position: relative !important;
                box-sizing: border-box !important;
                overflow: hidden !important;
                page-break-before: always !important;
                page-break-after: always !important;
                break-before: page !important;
                break-after: page !important;
                page-break-inside: avoid !important;
                break-inside: avoid !important;
                margin: 0 auto !important;
                background: #ffffff !important;
              }
              .a4-print-page:first-of-type {
                page-break-before: auto !important;
                break-before: auto !important;
              }
              .print\\:hidden {
                display: none !important;
              }
              .print\\:block {
                display: block !important;
              }
            </style>
          </head>
          <body>
            <div style="width: ${pageWidth}; margin: 0 auto;">
              ${sourceEl.outerHTML}
            </div>
            <script>
              window.onload = function() {
                setTimeout(function() {
                  window.focus();
                  window.print();
                }, 350);
              };
            </script>
          </body>
        </html>
      `);
      printWin.document.close();
    }
  } catch (err) {
    console.warn('Popup window blocked or restricted:', err);
  }

  if (!printWindowOpened) {
    try {
      window.focus();
      window.print();
    } catch (e) {
      console.warn('Direct window.print() failed:', e);
      await downloadElementAsPdf(elementId, filename, orientation);
    }
  }
}

