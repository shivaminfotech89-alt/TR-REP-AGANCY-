// THE PWA'S INSTALL ICONS, RASTERISED FROM THE ONE MARK (AUDIT G80)
//
//   node scripts/make-app-icons.mjs
//
// Writes public/icon-192.png, public/icon-512.png and public/icon-512-maskable.png from public/favicon.svg.
// Run it when the mark changes; the PNGs are committed, so a build needs nothing.
//
// ⚠ WHY A BROWSER AND NOT AN IMAGE LIBRARY. This repo has no rasteriser - no sharp, canvas, resvg or jimp - and
// adding a native image dependency to produce three static files that change once a year is the wrong trade. It
// already drives a real Chrome over the DevTools protocol for print-check, using nothing but Node built-ins, so
// that mechanism is reused: render the SVG at an exact pixel size, screenshot it, write the bytes.
//
// ⚠ IT WRITES INTO THE REPOSITORY, DELIBERATELY, AND THAT IS NOT THE THING print-check REFUSES. `env.mjs`
// `outputDir()` refuses repo-internal output because HARNESS output is build artefacts and real agency data - the
// G62 trap, and letterheads that must never be committed. These are the opposite: product assets that belong in
// `public/` and must be committed, containing nothing but the mark. The rule is not bypassed; it does not apply.
//
// ⚠ THE MASKABLE VARIANT IS NOT THE SAME PICTURE SCALED. A maskable icon is cropped by the launcher to a safe zone
// of the centre 80%, and this mark fills its frame corner to corner - the tile's rounded corners and the bushing
// stems (y=9 and y=55 of 64) sit outside that zone and would be clipped. So the maskable one draws the mark at 80%
// on a FULL-BLEED navy field with no corner rounding: the launcher supplies the shape, and a rounded tile inside a
// circular mask reads as a mistake rather than a logo.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { launch } from './print-check/lib/chrome.mjs';
import { findChrome, checkNode, Refusal } from './print-check/lib/env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const PUBLIC = join(REPO, 'public');

/** The navy the tile is drawn in - the maskable field must match it exactly or the seam shows. */
const NAVY = '#1E3A8A';

/** Mark at 100% of the frame: what a browser shows in a tab or an installed title bar. */
const plain = (svg, px) => `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:transparent}
  #f{width:${px}px;height:${px}px;display:block}
  #f svg{width:100%;height:100%;display:block}
</style>
<div id="f">${svg}</div>`;

/**
 * Mark at 80% on a full-bleed field: what a launcher crops.
 * The scale is the safe-zone ratio, not a taste decision - see the header.
 */
const maskable = (svg, px) => `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0}
  #f{width:${px}px;height:${px}px;display:flex;align-items:center;justify-content:center;background:${NAVY}}
  #f svg{width:80%;height:80%;display:block}
  /* The tile's own rounding is removed: the launcher supplies the silhouette. */
  #f svg > rect:first-of-type{rx:0;ry:0}
</style>
<div id="f">${svg}</div>`;

checkNode();
const chromePath = findChrome();
const svg = readFileSync(join(PUBLIC, 'favicon.svg'), 'utf8');
const profile = mkdtempSync(join(tmpdir(), 'make-app-icons-'));

console.log(`mark   public/favicon.svg  (${svg.length} bytes)`);
console.log(`chrome ${chromePath}\n`);

const chrome = await launch(chromePath, profile);
try {
  const shoot = async (html, px, file, transparent) => {
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: px, height: px, deviceScaleFactor: 1, mobile: false });
    if (transparent) await chrome.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    else await chrome.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 30, g: 58, b: 138, a: 1 } });
    await chrome.send('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` });
    // The document is a single inline SVG with no network fetches; one frame is enough, and the screenshot below
    // would capture a blank page if it were not - which is why the size is asserted after writing.
    await new Promise(r => setTimeout(r, 300));
    const shot = await chrome.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: px, height: px, scale: 1 },
    });
    const bytes = Buffer.from(shot.data, 'base64');
    if (bytes.length < 200) throw new Refusal(`${file} came back as ${bytes.length} bytes - the page did not render.`);
    writeFileSync(join(PUBLIC, file), bytes);
    // ⚠ THE DIMENSIONS ARE READ BACK OUT OF THE FILE, not assumed from the clip. A PNG's width and height are big
    // endian at bytes 16-23 of the IHDR; a device-scale slip would otherwise ship a 384px file named 192.
    const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
    if (w !== px || h !== px) throw new Refusal(`${file} is ${w}x${h}, expected ${px}x${px}.`);
    console.log(`  ${file.padEnd(24)} ${String(bytes.length).padStart(7)} bytes   ${w}x${h}`);
  };

  await shoot(plain(svg, 192), 192, 'icon-192.png', true);
  await shoot(plain(svg, 512), 512, 'icon-512.png', true);
  await shoot(maskable(svg, 512), 512, 'icon-512-maskable.png', false);
} finally {
  await chrome.close();
  rmSync(profile, { recursive: true, force: true });
}

console.log('\nDone. Three PNGs written to public/ - commit them.');
