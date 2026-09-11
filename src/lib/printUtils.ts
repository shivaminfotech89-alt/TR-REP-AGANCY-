import { cutoffOf, printMediumMatches, summariseSheets, SCREEN_ONLY_ATTR, SHEET_NAME_ATTR, type Box, type Cutoff, type NamedCutoff } from './printOverflow';

/** Marks PrintableA4Page's clipping body, so a measurement finds it without knowing the component's classes. */
export const PRINT_BODY_ATTR = 'data-print-body';

const NOTHING_CUT: Cutoff = { bottomMm: 0, rightMm: 0 };
const boxOf = (r: DOMRect): Box => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });

/**
 * How much of one sheet is cut off AS IT IS LAID OUT in the document it is in. On the app's screen that is the screen
 * layout, which is not the paper - see measureAsPrinted, which is what every warning uses.
 */
export function measureSheet(page: Element): NamedCutoff {
  const name = page.getAttribute(SHEET_NAME_ATTR);
  const body = page.querySelector(`[${PRINT_BODY_ATTR}]`);
  const pageRect = page.getBoundingClientRect();
  if (!body || !pageRect.width) return { ...NOTHING_CUT, name };
  const paperWidthMm = page.classList.contains('landscape') ? 297 : 210;
  const inner = Array.from(body.querySelectorAll('*')).map(e => boxOf(e.getBoundingClientRect()));
  return { ...cutoffOf(boxOf(body.getBoundingClientRect()), inner, paperWidthMm / pageRect.width), name };
}

/** Every sheet under `root`, in print order, each with the name it prints under. */
export function measureSheets(root: Document | Element): NamedCutoff[] {
  return Array.from(root.querySelectorAll('.a4-print-page')).map(measureSheet);
}

const stylesOf = (doc: Document) => Array.from(doc.querySelectorAll('link[rel="stylesheet"], style')).map(el => el.outerHTML).join('\n');
const isLandscapeRoot = (root: Element) => root.matches('.a4-print-page.landscape') || !!root.querySelector('.a4-print-page.landscape');

/** Until a window's document, its images and its stylesheets are in - or 5 seconds, whichever comes first. */
async function whenLoaded(win: Window): Promise<void> {
  const started = Date.now();
  for (;;) {
    const d = win.document;
    const images = Array.from(d.images || []);
    const links = Array.from(d.querySelectorAll('link[rel="stylesheet"]')) as HTMLLinkElement[];
    if (d.readyState === 'complete' && images.every(i => i.complete) && links.every(l => l.sheet)) break;
    if (Date.now() - started > 5000) break;
    await new Promise(r => setTimeout(r, 50));
  }
  try { await (win.document as any).fonts?.ready; } catch { /* no font loading API - measure as it stands */ }
}

/**
 * Rewrites every media condition in `doc` to what it is WHEN PRINTED: print rules on, screen rules off, and width and
 * every other feature evaluated in `paper` - a window exactly as wide as the sheet. Nested rules (Tailwind's layers)
 * included. A stylesheet that cannot be read (another origin's fonts) is left as it is.
 */
function applyPrintMedia(doc: Document, paper: Window): void {
  const printed = (media: MediaList) => media.length === 0 || Array.from(media).some(m => printMediumMatches(m, q => paper.matchMedia(q).matches));
  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      const media = (rule as CSSMediaRule).media;
      if (media && 'cssRules' in rule) media.mediaText = printed(media) ? 'all' : 'not all';
      if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules);
      const imported = (rule as CSSImportRule).styleSheet;
      if (imported) { try { walk(imported.cssRules); } catch { /* unreadable */ } }
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    if (sheet.media.length) sheet.media.mediaText = printed(sheet.media) ? 'all' : 'not all';
    walk(rules);
  }
}

/**
 * HOW MUCH EACH SHEET LOSES ON PAPER - measured on a print layout, not on the screen (AUDIT G66).
 *
 * ⚠ THE SCREEN IS NOT THE PAPER. Printed, the root font is 10pt instead of 16px, so every rem-sized size and space
 * shrinks by a sixth, and the documents' print: variants change sizes, spacing and what is shown at all. Measured on
 * screen, the multi-job sheet read 22mm lost where paper lost 4mm, and an inspection sheet that prints whole read 5mm -
 * a warning that cries over a whole sheet teaches the operator to press "Print anyway" without reading.
 *
 * So `html` - the whole document as it will print - is laid out in a hidden frame as wide as the paper, its styles
 * rewritten to what they are when printed, and measured there. The frame is removed afterwards; nothing on screen or in
 * the print window is restyled.
 */
export async function measureAsPrinted(html: string, landscape: boolean, host: Document = document): Promise<NamedCutoff[]> {
  const frame = host.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.setAttribute('style', `position:fixed;left:-100000px;top:0;width:${landscape ? 297 : 210}mm;height:${landscape ? 210 : 297}mm;border:0;visibility:hidden;pointer-events:none;`);
  host.body.appendChild(frame);
  try {
    const win = frame.contentWindow;
    if (!win) return [];
    win.document.open();
    win.document.write(html);
    win.document.close();
    await whenLoaded(win);
    applyPrintMedia(win.document, win);
    return measureSheets(win.document);
  } finally {
    frame.remove();
  }
}

/** The page's own stylesheets around some sheets' markup - what the direct print paths and the on-screen bar measure. */
const documentAround = (doc: Document, markup: string) =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">${stylesOf(doc)}</head><body>${markup}</body></html>`;

type CutoffListener = (cutoff: Cutoff) => void;
const watchedSheets = new Map<Element, CutoffListener>();
let measureTimer = 0;
let measuring = false;
let measureAgain = false;

/**
 * THE ON-SCREEN BAR'S NUMBERS: every sheet on screen, measured as printed, together, 400ms after the last change.
 * One hidden frame per orientation rather than one per sheet - an MR of forty jobs is several sheets.
 * Returns the unsubscribe.
 */
export function watchSheetCutoff(page: Element, listener: CutoffListener): () => void {
  watchedSheets.set(page, listener);
  scheduleSheetMeasurement();
  return () => { watchedSheets.delete(page); };
}

export function scheduleSheetMeasurement(): void {
  window.clearTimeout(measureTimer);
  measureTimer = window.setTimeout(() => { void measureWatchedSheets(); }, 400);
}

async function measureWatchedSheets(): Promise<void> {
  if (measuring) { measureAgain = true; return; }
  measuring = true;
  try {
    const pages = Array.from(watchedSheets.keys()).filter(p => p.isConnected);
    for (const landscape of [false, true]) {
      const group = pages.filter(p => p.classList.contains('landscape') === landscape);
      if (!group.length) continue;
      const doc = group[0].ownerDocument;
      const cutoffs = await measureAsPrinted(documentAround(doc, group.map(p => p.outerHTML).join('\n')), landscape, doc);
      group.forEach((p, i) => watchedSheets.get(p)?.(cutoffs[i] ?? NOTHING_CUT));
    }
  } catch (err) {
    console.warn('Could not measure the sheets as printed:', err);
  } finally {
    measuring = false;
    if (measureAgain) { measureAgain = false; scheduleSheetMeasurement(); }
  }
}

export const CUTOFF_WARNING_ID = 'print-cutoff-warning';

/**
 * THE WARNING BEFORE THE PRINT DIALOG, AT THE TOP OF THE PRINT WINDOW.
 *
 * The dialog does not open by itself when anything will be cut off. The operator reads which sheets lose how many
 * millimetres and chooses. "Print anyway" prints - A WARNING, NOT A REFUSAL: a short document can be seen to be short,
 * a refused one cannot be seen at all. Hidden from print.
 */
export function showCutoffWarning(doc: Document, lines: string[], print: () => void): void {
  doc.getElementById(CUTOFF_WARNING_ID)?.remove();
  const style = doc.createElement('style');
  style.textContent = `@media print { #${CUTOFF_WARNING_ID} { display: none !important; } }`;
  doc.head.appendChild(style);

  const el = (tag: string, css: string, text?: string) => {
    const e = doc.createElement(tag);
    e.setAttribute('style', css);
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const box = el('div', 'position:sticky;top:0;z-index:2147483647;background:#b91c1c;color:#fff;font:600 14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;padding:14px 20px;border-bottom:5px solid #7f1d1d;');
  box.id = CUTOFF_WARNING_ID;
  box.setAttribute(SCREEN_ONLY_ATTR, '');
  box.appendChild(el('div', 'font-size:18px;font-weight:800;margin-bottom:6px;', 'This document will not print whole'));
  const list = el('ul', 'margin:0 0 8px 20px;padding:0;');
  lines.forEach(line => list.appendChild(el('li', '', line)));
  box.appendChild(list);
  box.appendChild(el('div', 'font-weight:500;margin-bottom:10px;', 'Measured as the sheets print. The cut-off part will not appear on paper. Printing short is your choice.'));
  const button = el('button', 'background:#fff;color:#7f1d1d;font:800 14px system-ui,sans-serif;border:0;border-radius:6px;padding:8px 18px;cursor:pointer;', 'Print anyway');
  (button as HTMLButtonElement).type = 'button';
  button.addEventListener('click', print);
  box.appendChild(button);
  doc.body.insertBefore(box, doc.body.firstChild);
}

/**
 * FOR THE PATHS THAT CALL window.print() DIRECTLY: the same numbers, in a confirm, before the dialog opens.
 * OK prints; Cancel does not - the operator's choice, not a refusal. A measurement that fails prints: warn, never block.
 */
export async function confirmWholeBeforePrint(root: Element | null): Promise<boolean> {
  if (!root) return true;
  let lines: string[] = [];
  try {
    lines = summariseSheets(await measureAsPrinted(documentAround(root.ownerDocument, root.outerHTML), isLandscapeRoot(root), root.ownerDocument));
  } catch (err) {
    console.warn('Could not measure the sheets before printing:', err);
  }
  if (!lines.length) return true;
  return window.confirm(`This document will not print whole:\n\n${lines.join('\n')}\n\nThe cut-off part will not appear on paper. Print anyway?`);
}

/**
 * Universal print trigger:
 * Opens a dedicated standalone print tab formatted with exact A4 pages (portrait or landscape), measures every sheet
 * as it will print, and then either opens the browser's print dialog or - when anything will be cut off - shows how
 * many millimetres each sheet loses and waits for "Print anyway". If the popup is blocked, alerts the user to allow
 * pop-ups and try again.
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
      const headElements = stylesOf(document);

      // ⚠ NO PRINT-ON-LOAD SCRIPT (AUDIT G66). The dialog used to open 350ms after load, whatever the sheets held.
      // It now opens from here, and only once the sheets have been measured and found whole.
      const html = `
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
          </body>
        </html>
      `;
      printWin.document.open();
      printWin.document.write(html);
      printWin.document.close();

      const print = () => { printWin.focus(); printWin.print(); };
      let lines: string[] = [];
      try {
        // The print window's own markup, laid out as printed. Measuring the print window itself would measure screen.
        lines = summariseSheets(await measureAsPrinted(html, isLandscape));
      } catch (err) {
        console.warn('Could not measure the sheets before printing:', err);
      }
      await whenLoaded(printWin);
      if (lines.length) showCutoffWarning(printWin.document, lines, print);
      else setTimeout(print, 350);
    }
  } catch (err) {
    console.warn('Popup window blocked or restricted:', err);
  }

  if (!printWindowOpened) {
    alert('Your browser blocked the print window. Please allow pop-ups for this site, then try again.');
  }
}
