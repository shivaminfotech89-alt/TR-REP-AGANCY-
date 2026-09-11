#!/usr/bin/env node
// PRINT-CHECK - prints the app's documents through the app's own print path in headless Chrome, on live data, and
// measures what came out.
//
//   npm run print-check -- [documents...] [--compare <ref>] [--out <dir>]
//
//   documents   all (default) | estimate | estimate-itemised | estimate-fixed-rate | multi-job | inspection
//   --compare   also print each document from <ref>, in a temporary git worktree, and report what changed on paper
//   --out       where PDFs, sheet pictures and results.json go. Default: a new directory under the OS temp directory.
//               Refused inside the repository.
//
// LIVE DATA, KEY-GATED, READ-ONLY. It reads Firestore through scripts/admin/_db.js and needs the service-account key.
// Run by hand; it is not a gate (AUDIT G60) - it needs Chrome, the key and a minute or two.
//
// EXIT CODES
//   0  every document printed and was checked, and nothing was cut off
//   1  a FINDING in a document: content cut off by its page
//   2  a REFUSAL: the tool's own evidence would not be evidence - a build missing classes, a moved marker, a check that
//      could not fail, a document with nothing real to print. Nothing from that run should be believed.
//   Differences found by --compare are reported, not failed: whether a difference is wanted is the reader's call.
//
// BUILT IN, NOT REMEMBERED. Each of these cost a diagnosis before it became a property of the tool:
//   - SOMETHING PRINTED is asserted before anything about fit: sheets exist, the PDF has as many pages as the screen,
//     and the rows on paper are the rows the app's own builder says the document has. A comparison in this project
//     once reported "0 moved" having priced nothing (G61).
//   - CLASS COVERAGE FROM THE WHOLE SOURCE. Every static class the document's code uses must be in the built CSS, and the
//     check is first shown able to report a miss. Not a sample: G62's check looked at five of 130 and passed a broken
//     sheet, which then produced a finding the app did not have.
//   - THE RENDERED STYLE, on every element carrying a testable utility, with a positive control that strips the
//     stylesheets from a printed page and requires the check to fail.
//   - TAILWIND IS TOLD WHERE THE SOURCE IS (@source), so a build does not depend on what its folder happens to contain.
//     G63's correct print once rested on G62's broken output lying in the same folder.
//   - CUT-OFF IS MEASURED AGAINST THE CLIPPING CONTAINER, not the page edge - PrintableA4Page's body hides overflow.
//   - OUTPUT NEVER LANDS INSIDE THE REPOSITORY, where built bundles could feed the app's own Tailwind scan and prints would
//     carry real agency data into git.
//   - INLINE DOCUMENTS ARE CUT BETWEEN MARKERS THAT FAIL LOUDLY when they move, until each is extracted (AUDIT G65).
//   - THE WORKTREE IS CLEANED UP IN ONE ORDER. Its node_modules is a link to the repository's real packages. The link is
//     removed first - non-recursively, and only after proving it is a link - the repository's packages are confirmed
//     intact, and only then is the worktree removed. That removal is proved on a throwaway link every run before it is
//     trusted with the repository. In the wrong order, a removal follows the link into the real node_modules.
//
// WHAT IT DOES NOT CHECK - read this before trusting a clean run:
//   - IT IS CHROME'S PRINT LAYOUT, NOT A PRINTER. Printer margins, scaling, driver font substitution and paper handling
//     are not seen. A sheet that fits here can still be cropped by a printer set to fit-to-page or a non-zero margin.
//   - One browser engine. Firefox and Safari lay out print differently, and an operator may print from either.
//   - The print dialog as an operator leaves it: scale, margins, headers and footers, background graphics.
//   - This machine's fonts. A machine without them substitutes, and every text width changes.
//   - Four documents. The other printed documents - bills, the challan, the forwarding letter, the external inspection
//     and testing reports - are not covered. Two of the four are rendered from cut source, not from a component.
//   - Only the records it picks: the most complete live example of each document. A defect that needs long values, many
//     rows or a particular letterhead may not be present in them.
//   - Whether the figures are right. It reads what printed; pricing is the builder's tests' and regressions' job.
//   - The screen. On-screen notices and anything print:hidden are outside what it measures.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, Refusal, checkNode, findChrome, outputDir } from './lib/env.mjs';
import { proveLinkRemoval, createTree, removeTree } from './lib/worktree.mjs';
import { loadLive } from './lib/data.mjs';
import { buildTree } from './lib/build.mjs';
import { serve, launch, printDocument, styleControl } from './lib/chrome.mjs';
import { DOCUMENTS, ALIASES } from './lib/documents.mjs';

function parseArgs(argv) {
  const names = [];
  let compare = null, out = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--compare') compare = argv[++i];
    else if (a === '--out') out = argv[++i];
    else if (a.startsWith('--')) throw new Refusal(`unknown option ${a}.`);
    else names.push(a);
  }
  if (argv.includes('--compare') && !compare) throw new Refusal('--compare needs a commit, e.g. --compare HEAD~1.');
  if (argv.includes('--out') && !out) throw new Refusal('--out needs a directory.');
  return { names: names.length ? names : ['all'], compare, out };
}

/** Rows on paper against what the app's builder says the document holds - before any judgement about fit. */
function somethingPrinted(doc, r) {
  const p = [];
  const e = r.h.expected || {};
  if (!r.pages.length) p.push('no sheet printed');
  if (r.pages.length !== r.pdfPages) p.push(`${r.pages.length} sheet(s) on screen but ${r.pdfPages} page(s) in the PDF`);
  if (doc.kind === 'multi-job') {
    if (!e.rowsPerSheet) p.push("the sheet's data has no item rows");
    const bad = r.pages.filter(s => s.rows.length !== e.rowsPerSheet);
    if (bad.length) p.push(`every sheet should print ${e.rowsPerSheet} item rows; ${bad.map(s => `sheet ${s.page} printed ${s.rows.length}`).join(', ')}`);
    const cols = r.pages.reduce((n, s) => n + (s.cols || 0), 0);
    if (cols !== e.columns) p.push(`${cols} transformer column(s) printed, ${e.columns} expected`);
  } else {
    const rows = r.pages.reduce((n, s) => n + s.rows.length, 0);
    if (!e.rows) p.push("the app's builder reports no rows for this document");
    if (rows !== e.rows) p.push(`${rows} row(s) printed, ${e.rows} expected`);
  }
  if (!r.style.checked) p.push('the style check examined no element');
  if (r.style.failureCount) p.push(`${r.style.failureCount} element(s) not styled as their classes say, e.g. ${r.style.failures.slice(0, 4).join('; ')}`);
  if (String(r.h.letterhead).startsWith('NOT')) p.push(`the letterhead image was ${r.h.letterhead}`);
  return p;
}

/** What changed on paper between the two prints of one document. */
function diff(b, a) {
  const out = [];
  if (b.pages.length !== a.pages.length) out.push(`sheets ${b.pages.length} -> ${a.pages.length}`);
  const rb = b.pages.flatMap(p => p.rows), ra = a.pages.flatMap(p => p.rows);
  if (rb.length !== ra.length) out.push(`rows ${rb.length} -> ${ra.length}`);
  for (let i = 0; i < Math.min(rb.length, ra.length); i++) {
    const cb = rb[i].cells.join(' | '), ca = ra[i].cells.join(' | ');
    if (cb !== ca) out.push(`row ${i + 1}: ${cb}\n          -> ${ca}`);
    else if (Math.abs(rb[i].h - ra[i].h) > 0.5) out.push(`row ${i + 1} height ${rb[i].h} -> ${ra[i].h}px (${ca.slice(0, 50)})`);
  }
  b.pages.forEach((p, i) => { if (a.pages[i] && p.cut !== a.pages[i].cut) out.push(`sheet ${i + 1} elements cut off ${p.cut} -> ${a.pages[i].cut}`); });
  return out;
}

async function main() {
  process.chdir(REPO);
  checkNode();
  const { names, compare, out: outArg } = parseArgs(process.argv.slice(2));
  const ids = [...new Set(names.flatMap(n => {
    if (!ALIASES[n]) throw new Refusal(`unknown document "${n}". Known: ${Object.keys(ALIASES).join(', ')}.`);
    return ALIASES[n];
  }))];
  const docs = DOCUMENTS.filter(d => ids.includes(d.id));
  const chromePath = findChrome();
  const out = outputDir(outArg);
  const work = join(out, 'work');
  const prints = join(out, 'prints');
  mkdirSync(work, { recursive: true });
  mkdirSync(prints, { recursive: true });
  console.log(`print-check - live data, read-only\n  Chrome  ${chromePath}\n  output  ${out}${compare ? `\n  compare ${compare} (before) against the working tree (after)` : ''}\n`);

  const refusals = [], findings = [], differences = {}, results = {}, selections = {}, builds = {};
  let tree = null, chrome = null, server = null;
  try {
    if (compare) {
      proveLinkRemoval(work);
      console.log('worktree cleanup: proved on a throwaway link - the link goes, its target stays');
      tree = createTree(compare, work);
      console.log(`worktree: ${tree.sha.slice(0, 10)} at ${tree.path}\n`);
    }
    const live = await loadLive(work);
    console.log('selected from live data:');
    for (const d of docs) {
      try { selections[d.id] = d.select(live); console.log(`  ${d.id.padEnd(20)} ${selections[d.id].label}`); }
      catch (e) { if (!(e instanceof Refusal)) throw e; refusals.push(`${d.id}: ${e.message}`); }
    }
    const selected = docs.filter(d => selections[d.id]);
    const now = new Date();
    const letterDate = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
    const trees = tree ? [['before', tree.path], ['after', REPO]] : [['current', REPO]];

    console.log('');
    for (const [label, root] of trees) {
      builds[label] = await buildTree({ root, label, work, docs: selected, selections, extra: { letterDate } });
      for (const [id, msg] of Object.entries(builds[label].unavailable)) {
        if (label === 'before') console.log(`  before ${id}: not buildable at ${compare} - compared only from the working tree.\n    ${msg.split('\n')[0]}`);
        else refusals.push(`${label} ${id}: ${msg}`);
      }
      console.log(`built ${label}: ${Object.entries(builds[label].coverage).map(([id, n]) => `${id} ${n}/${n} classes`).join(', ') || 'nothing'}`);
    }

    server = await serve(Object.fromEntries(Object.entries(builds).map(([l, b]) => [l, b.outDir])));
    chrome = await launch(chromePath, join(work, 'chrome-profile'));
    for (const [label] of trees) {
      let controlled = false;
      results[label] = {};
      for (const d of selected) {
        if (!builds[label].coverage[d.id]) continue;
        const r = await printDocument(chrome, `${server.origin}/${label}/${d.id}.html`, d.kind, join(prints, `${label}-${d.id}`));
        results[label][d.id] = r;
        if (r.error) {
          refusals.push(`${label} ${d.id}: the page did not print - ${r.error.split('\n')[0]}${r.console.length ? `\n      ${r.console.slice(0, 4).join('\n      ')}` : ''}`);
          continue;
        }
        somethingPrinted(d, r).forEach(p => refusals.push(`${label} ${d.id}: ${p}`));
        if (!controlled) {
          const control = await styleControl(chrome);
          if (!control.failureCount) refusals.push(`${label}: the style check still passes with every stylesheet removed - it cannot see styling, so nothing it passed is evidence.`);
          else console.log(`style check control (${label}): with the stylesheets removed it fails ${control.failureCount} element(s) - it can see styling`);
          controlled = true;
        }
        for (const p of r.pages) if (p.cut) findings.push(`${label} ${d.id} sheet ${p.page}: ${p.cut} element(s) cut off - ${JSON.stringify(p.cutSample)}`);
      }
    }
    if (tree) {
      for (const d of selected) {
        const b = results.before?.[d.id], a = results.after?.[d.id];
        if (b && a && !b.error && !a.error) differences[d.id] = diff(b, a);
      }
    }
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    refusals.push(e.message);
  } finally {
    if (chrome) await chrome.close();
    if (server) await server.close();
    if (tree) {
      try { removeTree(tree); console.log('worktree removed: link first, repository packages confirmed intact'); }
      catch (e) { refusals.push(e.message); }
    }
  }

  console.log('\nPRINTED');
  for (const [label, byDoc] of Object.entries(results)) {
    for (const [id, r] of Object.entries(byDoc)) {
      if (r.error) { console.log(`  ${label.padEnd(8)} ${id.padEnd(20)} did not print`); continue; }
      const rows = r.pages.reduce((n, s) => n + s.rows.length, 0);
      const cut = r.pages.reduce((n, s) => n + s.cut, 0);
      console.log(`  ${label.padEnd(8)} ${id.padEnd(20)} ${r.pages.length} sheet(s) = ${r.pdfPages} PDF page(s), ${rows} rows, style ${r.style.checked} checked / ${r.style.failureCount} wrong, ${cut} cut off, letterhead ${r.h.letterhead}`);
    }
  }
  if (compare) {
    console.log(`\nWHAT CHANGED ON PAPER (${compare} -> working tree)`);
    for (const [id, lines] of Object.entries(differences)) {
      console.log(`  ${id}: ${lines.length ? '' : 'nothing'}`);
      lines.slice(0, 30).forEach(l => console.log(`    ${l}`));
      if (lines.length > 30) console.log(`    ... and ${lines.length - 30} more`);
    }
  }
  if (findings.length) { console.log('\nFINDINGS - in the documents'); findings.forEach(f => console.log(`  ${f}`)); }
  if (refusals.length) { console.log('\nREFUSED - the tool\'s own evidence is not evidence'); refusals.forEach(f => console.log(`  ${f}`)); }

  const strip = r => (r.error ? r : { ...r, pages: r.pages.map(p => ({ ...p, rows: p.rows.length })) });
  writeFileSync(join(out, 'results.json'), JSON.stringify({
    compare, selections: Object.fromEntries(Object.entries(selections).map(([k, v]) => [k, v.label])),
    coverage: Object.fromEntries(Object.entries(builds).map(([l, b]) => [l, b.coverage])),
    results: Object.fromEntries(Object.entries(results).map(([l, byDoc]) => [l, Object.fromEntries(Object.entries(byDoc).map(([id, r]) => [id, strip(r)]))])),
    differences, findings, refusals,
  }, null, 2));
  console.log(`\nprints and results.json: ${out}`);
  const code = refusals.length ? 2 : findings.length ? 1 : 0;
  console.log(code === 0 ? 'CLEAN' : code === 1 ? 'FINDINGS' : 'REFUSED');
  process.exit(code);
}

main().catch(e => {
  console.error(e instanceof Refusal ? `\nREFUSED - ${e.message}` : e?.stack || e);
  process.exit(2);
});
