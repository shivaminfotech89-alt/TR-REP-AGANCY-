// HASH EVERY PRINTED SUBTREE, so "nothing reached paper" is a claim about the DOCUMENTS
// rather than about which files were edited.
//
// Finds every <PrintableA4Page ...> ... </PrintableA4Page> across src/, hashes each one, and
// greps it for the agency-mark component. Run it at two commits and compare.
//
//   node scripts/admin/print-subtree-hashes.js [--json]

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const ROOT = join(process.cwd(), 'src');
const MARK_TOKENS = ['AgencyMarkTile', 'agencyMark', 'markFor(', 'MARK_PATH', 'MARK_TILE'];

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(f)) out.push(p);
  }
  return out;
}

/** Every <PrintableA4Page> ... </PrintableA4Page> span in a file, by tag depth. */
function subtrees(src) {
  const out = [];
  const open = /<PrintableA4Page\b/g;
  let m;
  while ((m = open.exec(src))) {
    let i = m.index, depth = 0, j = i;
    // self-closing?
    const tagEnd = src.indexOf('>', i);
    if (src.slice(i, tagEnd + 1).trimEnd().endsWith('/>')) {
      out.push(src.slice(i, tagEnd + 1));
      continue;
    }
    depth = 1;
    j = tagEnd + 1;
    while (j < src.length && depth > 0) {
      const nOpen = src.indexOf('<PrintableA4Page', j);
      const nClose = src.indexOf('</PrintableA4Page>', j);
      if (nClose === -1) break;
      if (nOpen !== -1 && nOpen < nClose) { depth++; j = nOpen + 16; }
      else { depth--; j = nClose + 18; }
    }
    out.push(src.slice(i, j));
  }
  return out;
}

const rows = [];
for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('<PrintableA4Page')) continue;
  const trees = subtrees(src);
  trees.forEach((t, k) => {
    const title = (t.match(/documentTitle\s*=\s*["'{]([^"'}]*)/) || [])[1] ?? '(none)';
    const hits = MARK_TOKENS.reduce((n, tok) => n + t.split(tok).length - 1, 0);
    rows.push({
      file: file.replace(process.cwd() + '\\', '').replace(/\\/g, '/'),
      index: k,
      title: title.trim() || '(empty)',
      bytes: Buffer.byteLength(t, 'utf8'),
      sha: createHash('sha256').update(t, 'utf8').digest('hex'),
      markHits: hits,
    });
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.log(`  ${rows.length} printed subtree(s)\n`);
  console.log('  ' + 'file'.padEnd(44) + '# ' + 'documentTitle'.padEnd(22) + 'bytes'.padStart(7) + '  markHits  sha256(12)');
  for (const r of rows) {
    console.log('  ' + r.file.padEnd(44) + r.index + ' ' + r.title.slice(0, 21).padEnd(22)
      + String(r.bytes).padStart(7) + '  ' + String(r.markHits).padStart(8) + '  ' + r.sha.slice(0, 12));
  }
  const withMark = rows.filter(r => r.markHits > 0);
  console.log(`\n  subtrees referencing the agency mark: ${withMark.length}`);
  if (withMark.length) for (const r of withMark) console.log(`    ${r.file} #${r.index}  ${r.markHits} hit(s)`);
}
