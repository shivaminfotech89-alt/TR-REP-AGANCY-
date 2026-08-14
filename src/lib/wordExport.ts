export function downloadHtmlAsWord(
  elementIdOrHtml: string | HTMLElement, 
  filename: string = 'document.doc', 
  documentTitle: string = 'Document'
) {
  let contentHtml = '';
  if (typeof elementIdOrHtml === 'string') {
    const el = document.getElementById(elementIdOrHtml);
    if (el) {
      contentHtml = el.innerHTML;
    } else {
      contentHtml = elementIdOrHtml;
    }
  } else {
    contentHtml = elementIdOrHtml.innerHTML;
  }

  // Ensure images with base64 or relative URLs work properly inside Word document
  const fullHtml = `
    <!DOCTYPE html>
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset="utf-8">
      <title>${documentTitle}</title>
      <style>
        @page WordSection1 {
          size: 8.27in 11.69in; /* A4 */
          margin: 0.75in 0.75in 0.75in 0.75in;
          mso-header-margin: 0.5in;
          mso-footer-margin: 0.5in;
          mso-paper-source: 0;
        }
        div.WordSection1 { page: WordSection1; }
        body { font-family: 'Calibri', 'Times New Roman', serif; font-size: 11pt; color: #000000; line-height: 1.25; }
        h1 { font-size: 16pt; font-weight: bold; text-align: center; text-transform: uppercase; margin-bottom: 6px; }
        h2 { font-size: 13pt; font-weight: bold; text-align: center; text-transform: uppercase; margin-top: 8px; margin-bottom: 6px; }
        p { margin: 4px 0; }
        table { border-collapse: collapse; width: 100%; margin: 8px 0; }
        table, th, td { border: 1px solid #000000; }
        th { background-color: #f2f2f2; font-weight: bold; padding: 6px; text-align: center; font-size: 10pt; }
        td { padding: 5px; font-size: 10pt; }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .font-bold { font-weight: bold; }
        .uppercase { text-transform: uppercase; }
        .whitespace-pre-wrap { white-space: pre-wrap; }
        img { max-width: 100%; height: auto; }
      </style>
    </head>
    <body>
      <div class="WordSection1">
        ${contentHtml}
      </div>
    </body>
    </html>
  `;

  const blob = new Blob(['\ufeff', fullHtml], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.doc') || filename.endsWith('.docx') ? filename : `${filename}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
