/**
 * Universal print trigger:
 * Opens a dedicated standalone print tab formatted with exact A4 pages (portrait or landscape)
 * and invokes the browser's native print dialog inside it. If the popup is blocked, alerts the
 * user to allow pop-ups and try again.
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
    alert('Your browser blocked the print window. Please allow pop-ups for this site, then try again.');
  }
}

