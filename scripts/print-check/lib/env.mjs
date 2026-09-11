// WHERE print-check RUNS: the repository, the Node it needs, the Chrome it drives, and where it may write.
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const REPO = realpathSync.native(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'));

/** Forward slashes, for paths written into generated import statements. */
export const slash = p => String(p).replace(/\\/g, '/');

/**
 * A REFUSAL IS THE TOOL SAYING ITS OWN EVIDENCE WOULD NOT BE EVIDENCE - a build missing classes, a marker that moved,
 * a check that cannot fail. It exits 2, which is neither "clean" (0) nor "the document has a defect" (1). The
 * difference matters: G62's print harness reported a defect the app did not have, and a withdrawn finding is harder
 * to notice than a missing one (AUDIT, "a harness that reports a defect the app does not have").
 */
export class Refusal extends Error {}

/** A MESSAGE THAT FIRES, NOT A FIELD NOTHING READS. The Chrome driver talks DevTools over Node's built-in WebSocket. */
export function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22 || typeof WebSocket !== 'function') {
    throw new Refusal(`print-check needs Node 22 or later - it drives Chrome over Node's built-in WebSocket. This is Node ${process.versions.node}.`);
  }
}

export function findChrome() {
  if (process.env.CHROME_PATH) {
    if (existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    throw new Refusal(`CHROME_PATH is set to ${process.env.CHROME_PATH}, which does not exist.`);
  }
  const pf = process.env.ProgramFiles || 'C:/Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
  const candidates = process.platform === 'win32'
    ? [join(pf, 'Google/Chrome/Application/chrome.exe'), join(pf86, 'Google/Chrome/Application/chrome.exe'),
       join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'), join(pf86, 'Microsoft/Edge/Application/msedge.exe')]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const hit = candidates.find(p => existsSync(p));
  if (!hit) throw new Refusal(`No Chrome or Chromium found. Set CHROME_PATH. Looked in:\n    ${candidates.join('\n    ')}`);
  return hit;
}

/**
 * WHERE OUTPUT GOES - AND NEVER INSIDE THE REPOSITORY.
 *
 * ⚠ THIS IS THE G62 TRAP, STATED WHERE IT WOULD BE SPRUNG. Built bundles carry every class name they use as plain
 * text, and Tailwind generates classes from text it finds. The first print harness produced a CORRECT sheet only
 * because an earlier BROKEN build was sitting in its folder, supplying the estimate's class names - a dependency
 * nobody could see. Output written inside this repository could do the same to the APP's own build, and hide a
 * class the app is genuinely missing behind text from a harness run.
 *
 * It also holds real agency data - letterheads, names, GSTINs - which must not be committed.
 */
export function outputDir(requested) {
  const insideRepo = p => { const rel = relative(REPO, p); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); };
  const wanted = resolve(requested || join(tmpdir(), 'print-check', new Date().toISOString().replace(/[:.]/g, '-')));
  if (insideRepo(wanted)) {
    throw new Refusal(`Refusing to write to ${wanted}: it is inside the repository. Build output there can feed the app's own Tailwind scan (the G62 trap), and prints carry real agency data. Use a directory outside ${REPO}.`);
  }
  mkdirSync(wanted, { recursive: true });
  const real = realpathSync.native(wanted);
  if (insideRepo(real)) throw new Refusal(`Refusing to write to ${wanted}: it resolves to ${real}, inside the repository.`);
  return real;
}
