// WHAT IS MEASURED ON THE PRINTED PAGE - page scripts, evaluated in Chrome under print media.

/** How each kind of document's line rows are read off the page. */
const ROWS = {
  estimate: `page => {
    const t = [...page.querySelectorAll('table')].find(t => [...t.querySelectorAll('th')].some(th => th.textContent.trim() === 'Sr. No.'));
    const rows = t ? [...t.querySelectorAll('tbody tr')].filter(r => r.children.length === 6) : [];
    return { rows: rows.map(r => ({ cells: [...r.children].map(c => c.textContent.trim()), h: Math.round(r.getBoundingClientRect().height * 10) / 10 })), cols: null };
  }`,
  'multi-job': `page => {
    const t = [...page.querySelectorAll('table')].find(t => [...t.querySelectorAll('th')].some(th => th.textContent.trim() === 'Sr.'));
    if (!t) return { rows: [], cols: 0 };
    const rows = [...t.querySelectorAll('tbody tr')].filter(r => /^\\d+$/.test((r.children[0]?.textContent || '').trim()));
    return { rows: rows.map(r => ({ cells: [...r.children].map(c => c.textContent.trim()), h: Math.round(r.getBoundingClientRect().height * 10) / 10 })),
      cols: Math.max(0, t.querySelectorAll('thead tr:first-child th').length - 3) };
  }`,
  inspection: `page => {
    const t = [...page.querySelectorAll('table')].find(t => [...t.querySelectorAll('th')].some(th => th.textContent.trim() === 'Job No'));
    const rows = t ? [...t.querySelectorAll('tbody tr')] : [];
    return { rows: rows.map(r => ({ cells: [...r.children].map(c => c.textContent.trim()), h: Math.round(r.getBoundingClientRect().height * 10) / 10 })), cols: null };
  }`,
};

/**
 * Per sheet: its rows, and everything CUT OFF - measured against the nearest clipping container, not the page edge.
 * ⚠ PrintableA4Page's body is overflow-hidden. Content past it vanishes while still sitting inside the page box, so a
 * page-edge measurement reported a signature block "on the page" that was not visible (AUDIT G61).
 */
export const measureScript = kind => `(() => {
  const rowsOf = ${ROWS[kind]};
  return [...document.querySelectorAll('.a4-print-page')].map((page, p) => {
    const pr = page.getBoundingClientRect();
    const clip = e => { for (let a = e.parentElement; a && a !== page; a = a.parentElement) { const o = getComputedStyle(a); if (o.overflowX !== 'visible' || o.overflowY !== 'visible') return a.getBoundingClientRect(); } return pr; };
    const cut = [...page.querySelectorAll('*')].filter(e => { const er = e.getBoundingClientRect(); if (!er.width && !er.height) return false; const c = clip(e); return er.bottom - c.bottom > 0.5 || er.right - c.right > 0.5; });
    const { rows, cols } = rowsOf(page);
    // How far past its clipping container the furthest element reaches, in millimetres of paper - measured here, in
    // print media, independently of the app's own on-screen measurement, so the two can be compared.
    const depthPx = Math.max(0, ...cut.map(e => { const er = e.getBoundingClientRect(), c = clip(e); return Math.max(er.bottom - c.bottom, er.right - c.right); }));
    const mm = depthPx * (page.classList.contains('landscape') ? 297 : 210) / pr.width;
    return { page: p + 1, rows, cols, cut: cut.length, cutMm: mm >= 1 ? Math.ceil(mm - 1e-9) : 0, cutSample: [...new Set(cut.map(e => (e.textContent || '').trim().slice(0, 40)))].slice(0, 5) };
  });
})()`;

/**
 * THE SHEET AS STYLED - CHECKED ON EVERY ELEMENT, NOT A SAMPLE.
 *
 * Every element in the printable sheets carrying one of these utilities must compute the property that utility sets.
 * G62's harness checked that five class names existed in the CSS file - five of 130, all of them supplied by
 * unrelated files - and passed a sheet that had lost its layout. A spot check on a subset can only report on the
 * subset (AUDIT). An element is skipped only where another class of the same family - a responsive or print variant -
 * legitimately overrides the one being checked, and where the element is not rendered at all.
 */
export const STYLE_PROBE = `(() => {
  const DISPLAY = ['block', 'flex', 'grid', 'hidden', 'inline', 'inline-block', 'inline-flex', 'table', 'contents'];
  const ALIGN = ['text-left', 'text-center', 'text-right', 'text-justify'];
  const variantOf = (classes, family) => classes.some(c => { const i = c.lastIndexOf(':'); return i > 0 && family(c.slice(i + 1)); });
  const probes = [
    ['flex', s => s.display === 'flex', b => DISPLAY.includes(b)],
    ['grid', s => s.display === 'grid', b => DISPLAY.includes(b)],
    ['grid-cols-2', s => s.gridTemplateColumns.split(' ').filter(Boolean).length === 2, b => b.startsWith('grid-cols-')],
    ['border-collapse', s => s.borderCollapse === 'collapse', b => b.startsWith('border-collapse') || b === 'border-separate'],
    ['text-center', s => s.textAlign === 'center', b => ALIGN.includes(b)],
    ['text-right', s => s.textAlign === 'right', b => ALIGN.includes(b)],
    ['font-bold', s => Number(s.fontWeight) >= 700, b => /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(b)],
  ];
  let checked = 0; const failures = [];
  for (const page of document.querySelectorAll('.a4-print-page')) {
    for (const e of page.querySelectorAll('[class]')) {
      const classes = String(e.getAttribute('class')).split(/\\s+/).filter(Boolean);
      const s = getComputedStyle(e);
      if (s.display === 'none') continue;
      for (const [cls, holds, family] of probes) {
        if (!classes.includes(cls) || variantOf(classes, family)) continue;
        checked++;
        if (!holds(s)) failures.push(cls + ' on <' + e.tagName.toLowerCase() + '> "' + (e.textContent || '').trim().slice(0, 30) + '"');
      }
    }
  }
  return { checked, failures: failures.slice(0, 12), failureCount: failures.length };
})()`;

/** Strips every stylesheet from the page on screen. The style probe run after this must fail, or it proves nothing. */
export const STRIP_STYLES = `document.querySelectorAll('link[rel="stylesheet"], style').forEach(e => e.remove())`;
