// DRIVING CHROME OVER THE DEVTOOLS PROTOCOL - Node's built-in WebSocket, no packages.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { Refusal } from './env.mjs';
import { measureScript, STYLE_PROBE, STRIP_STYLES } from './measure.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

/** Serves each build's output under its own prefix: /before/..., /after/..., /current/... */
export async function serve(mounts) {
  const server = createServer((req, res) => {
    const [, mount, ...rest] = decodeURIComponent(new URL(req.url, 'http://x').pathname).split('/');
    const base = mounts[mount];
    const file = base ? normalize(join(base, ...rest)) : null;
    if (!file || !file.startsWith(normalize(base)) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) };
}

export async function launch(chromePath, profile) {
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const proc = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  let port = 0;
  for (let i = 0; i < 200 && !port; i++) {
    if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split('\n')[0]) || 0;
    if (!port) await sleep(100);
  }
  if (!port) { proc.kill(); throw new Refusal(`Chrome did not open a DevTools port within 20s (${chromePath}).`); }
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Refusal('could not connect to Chrome over DevTools.')); });
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      events.push(`exception: ${m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text}`.slice(0, 400));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      events.push(`console.error: ${m.params.args.map(a => a.value ?? a.description).join(' ')}`.slice(0, 400));
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  await send('Page.enable');
  await send('Runtime.enable');
  return {
    send, evaluate, events,
    async close() {
      try {
        const b = new WebSocket(version.webSocketDebuggerUrl);
        await new Promise(r => { b.onopen = r; b.onerror = r; });
        b.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
        await sleep(500);
      } catch { /* the process is killed below regardless */ }
      try { proc.kill(); } catch { /* already gone */ }
    },
  };
}

/**
 * LOAD ONE DOCUMENT, LET THE APP'S OWN PRINT PATH RUN, AND MEASURE WHAT PRINTED.
 * The page calls the real triggerUniversalPrint and swaps itself for the print window's document; the PDF is printed
 * with preferCSSPageSize, so the @page rule that function writes decides the paper.
 */
export async function printDocument(chrome, url, kind, outPrefix, orientation) {
  const { send, evaluate, events } = chrome;
  events.length = 0;
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { media: '' });
  await send('Page.navigate', { url });
  let h = null, pictured = false;
  const files = [];
  for (let i = 0; i < 400; i++) {
    await sleep(150);
    try { h = await evaluate('window.__printCheck'); } catch { h = null; }
    if (h?.state === 'screen' && pictured) continue;   // released; the page says 'screen' until it is ready
    if (h?.state === 'screen') {
      pictured = true;
      // The sheets in the app, before printing, as the operator sees them: the top of every sheet carrying a bar.
      const barred = await evaluate(`[...document.querySelectorAll('.a4-print-page')].filter(p => p.querySelector('[data-screen-only]')).map(p => { const r = p.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: Math.min(r.height, 300) }; })`);
      for (const [n, c] of barred.entries()) {
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: c.x, y: c.y, width: c.w, height: c.h, scale: 1 } });
        const f = `${outPrefix}-screen-bar${n + 1}.png`;
        writeFileSync(f, Buffer.from(shot.data, 'base64'));
        files.push(f);
      }
      await evaluate('window.__printCheckGo = true');
      continue;
    }
    if (h && (h.state === 'ready' || h.state === 'error')) break;
  }
  if (!h || h.state !== 'ready') return { error: h?.message || 'the page never reported ready', console: [...events] };
  if (h.warningLines?.length) {
    // The print window's warning, as the operator sees it before the dialog - screen media, top of the window.
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1400, height: 460, scale: 1 } });
    const f = `${outPrefix}-print-window-warning.png`;
    writeFileSync(f, Buffer.from(shot.data, 'base64'));
    files.push(f);
  }
  // ⚠ PRINT MEDIA ALONE IS NOT THE PAPER: the viewport stays 1400px wide, and width media queries answer for 1400px.
  // On paper the viewport is the sheet. Measured at the sheet's own width, as the PDF below is laid out.
  await send('Emulation.setDeviceMetricsOverride', { width: orientation === 'landscape' ? 1123 : 794, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { media: 'print' });
  await sleep(300);
  const pages = await evaluate(measureScript(kind));
  const style = await evaluate(STYLE_PROBE);
  const rects = await evaluate(`[...document.querySelectorAll('.a4-print-page')].map(p => { const r = p.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; })`);
  for (const [i, c] of rects.entries()) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: c.x, y: c.y, width: c.w, height: c.h, scale: 1.5 } });
    const f = `${outPrefix}-sheet${i + 1}.png`;
    writeFileSync(f, Buffer.from(shot.data, 'base64'));
    files.push(f);
  }
  const pdf = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
  const bytes = Buffer.from(pdf.data, 'base64');
  writeFileSync(`${outPrefix}.pdf`, bytes);
  files.push(`${outPrefix}.pdf`);
  const pdfPages = (bytes.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  return { h, pages, style, pdfPages, files, console: [...events] };
}

/** THE STYLE CHECK MUST BE ABLE TO FAIL: strip the stylesheets from the page just printed, and probe again. */
export async function styleControl(chrome) {
  await chrome.evaluate(STRIP_STYLES);
  await sleep(200);
  return chrome.evaluate(STYLE_PROBE);
}
