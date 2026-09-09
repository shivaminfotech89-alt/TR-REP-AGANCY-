// HASH EVERY PRINTED SUBTREE, so "nothing reached paper" is a claim about the DOCUMENTS
// rather than about which files were edited.
//
// Finds every <PrintableA4Page ...> ... </PrintableA4Page> across src/, hashes each one, and
// greps it for the agency-mark component. Run it at two commits and compare.
//
//   node scripts/admin/print-subtree-hashes.js [--json]      list, at the working tree
//   node scripts/admin/print-subtree-hashes.js --compare <ref>   compare against a commit
//
// ⚠ USE `--compare`. IT TOUCHES NOTHING. It reads the old revision with `git show ref:path`,
// which never writes to the working tree, and it compares by DOCUMENT IDENTITY - file plus
// subtree index - so a document that did not exist before is reported as NEW rather than as
// changed. Both of this tool's historical failure modes are things `--compare` cannot do.
//
// ⚠⚠ THE MANUAL CHECKOUT WORKFLOW IS DESTRUCTIVE BY CONSTRUCTION, AND ITS OUTPUT HID THAT.
//
// It reports hashes, so it READS as a read-only comparison. The comparison it is part of is
// not: getting a "before" means `git checkout <earlier> -- src/`, and getting back means
// `git checkout HEAD -- src/` - which restores to HEAD, NOT to what was in the working tree.
// Uncommitted work in src/ is destroyed, silently, and `git status` comes back clean
// afterwards so nothing announces the loss.
//
// THAT IS NOT HYPOTHETICAL. It ate a finished mark-picker rewrite during this session; the
// commit that should have carried it reported "nothing to commit, working tree clean". It
// was rebuilt from a scratchpad script. The guard below exists because the failure happened,
// not because anyone anticipated it.
//
// ⚠ IT REFUSES ON A DIRTY TREE RATHER THAN STASHING. Stash-and-restore has its own failure
// modes - a conflicted restore, an interrupted run, a stash left behind that nobody notices -
// and a refusal has none. The discipline belongs in the tool, the same way the admin scripts
// ship with MODE = 'dry-run' rather than relying on anyone remembering.
//
// ⚠⚠ AND A SECOND WAY THE MECHANISM DISAGREED WITH THE PURPOSE, SAME TOOL. The checkout
// workflow ALSO could not handle an ADDED document. `git checkout <old> -- src/` restores
// files the old commit had; it cannot REMOVE one it did not have. So a change that adds a
// printed document left the new file in place during the "before" pass, which counted it in
// the old set and reported a spurious CHANGED against a document that had not existed. A
// confident wrong answer - the same class as the destructive restore above, and it happened:
// the multi-job estimate's first verification reported "13 before, 13 after, 1 CHANGED".
//
// `--compare` is the fix rather than a remembered workaround. It never checks anything out,
// so there is nothing to restore and nothing left behind, and it classifies by identity so an
// addition is NEW by construction.
//
// `--no-guard` remains only for a caller driving checkouts itself. Prefer `--compare`.

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

/**
 * ⚠ THE GUARD DOES NOT APPLY TO `--compare`, AND THAT IS THE POINT OF `--compare`. It reads
 * the old revision with `git show` and the new one from the working tree; it checks nothing
 * out, so there is nothing to destroy. Blanket-guarding it blocked the mode that is SAFE on a
 * dirty tree - and a dirty tree is exactly when you want to ask "what did I just change on
 * the printed documents", before committing rather than after.
 */
if (!process.argv.includes('--no-guard') && !process.argv.includes('--compare')) {
  let dirty = '';
  try {
    dirty = execSync('git status --porcelain -- src/', { encoding: 'utf8' }).trim();
  } catch {
    // Not a git checkout, or git unavailable. Nothing to protect and nothing to check.
  }
  if (dirty) {
    console.error('');
    console.error('  REFUSING TO RUN — src/ has uncommitted changes.');
    console.error('');
    console.error('  This harness checks out an earlier src/ and would destroy uncommitted work.');
    console.error('  Commit or stash first.');
    console.error('');
    for (const line of dirty.split('\n').slice(0, 12)) console.error('    ' + line);
    if (dirty.split('\n').length > 12) console.error(`    ... and ${dirty.split('\n').length - 12} more`);
    console.error('');
    console.error('  (--no-guard skips this, for a caller already managing the checkouts.)');
    console.error('');
    process.exit(1);
  }
}

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

/** Hash every subtree in one file's source. Shared by the working tree and by `git show`. */
function rowsFor(relPath, rawSrc, out) {
  /**
   * ⚠ LINE ENDINGS NORMALISED BEFORE HASHING, ON BOTH SIDES. The working tree is CRLF on
   * Windows while `git show` returns what git stored, which is LF. Hashing them as-is made
   * EVERY subtree differ - comparing HEAD against HEAD reported 13 changed on a clean tree.
   * A third confident wrong answer from this same tool, and the reason the fix is here
   * rather than in the caller: any future reader of the old revision has the same problem.
   *
   * These hashes are for COMPARISON, not identity with any external artifact, so folding
   * CRLF to LF is the right normalisation. It does change the printed values from earlier
   * runs - a subtree quoted as 1e742ace elsewhere will hash differently now.
   */
  const src = String(rawSrc).split(String.fromCharCode(13)).join('');
  if (!src.includes('<PrintableA4Page')) return out;
  subtrees(src).forEach((t, k) => {
    const title = (t.match(/documentTitle\s*=\s*["'{]([^"'}]*)/) || [])[1] ?? '(none)';
    const hits = MARK_TOKENS.reduce((n, tok) => n + t.split(tok).length - 1, 0);
    out.push({
      file: relPath,
      index: k,
      title: title.trim() || '(empty)',
      bytes: Buffer.byteLength(t, 'utf8'),
      sha: createHash('sha256').update(t, 'utf8').digest('hex'),
      markHits: hits,
    });
  });
  return out;
}

const rel = f => f.replace(process.cwd() + '\\', '').replace(/\\/g, '/');

/** The working tree's rows. */
const rows = walk(ROOT).reduce((acc, f) => rowsFor(rel(f), readFileSync(f, 'utf8'), acc), []);

/**
 * The rows at a commit, read with `git show` - NO CHECKOUT, so the working tree is untouched
 * and a file the commit did not have simply is not listed. That second property is what makes
 * an addition report as NEW instead of as a change against a document that did not exist.
 */
function rowsAt(ref) {
  const listed = execSync(`git ls-tree -r --name-only ${ref} -- src/`, { encoding: 'utf8' })
    .split('\n').map(x => x.trim()).filter(x => /\.(tsx?|jsx?)$/.test(x));
  return listed.reduce((acc, path) => {
    let src = '';
    try { src = execSync(`git show ${ref}:${path}`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
    catch { return acc; }
    return rowsFor(path, src, acc);
  }, []);
}

const cmpIdx = process.argv.indexOf('--compare');
if (cmpIdx !== -1) {
  const ref = process.argv[cmpIdx + 1];
  if (!ref) { console.error('  --compare needs a commit-ish, e.g. --compare HEAD~1'); process.exit(1); }
  const before = rowsAt(ref);
  const key = r => `${r.file}#${r.index}`;
  const B = new Map(before.map(r => [key(r), r]));
  const A = new Map(rows.map(r => [key(r), r]));

  const identical = [], changed = [], added = [], removed = [];
  for (const r of rows) {
    const o = B.get(key(r));
    if (!o) added.push(r);
    else if (o.sha === r.sha) identical.push(r);
    else changed.push([o, r]);
  }
  for (const o of before) if (!A.has(key(o))) removed.push(o);

  console.log(`\n  ${ref}: ${before.length} printed subtree(s)   working tree: ${rows.length}\n`);
  for (const [o, r] of changed) {
    console.log(`  CHANGED  ${key(r).padEnd(46)} ${o.sha.slice(0, 12)} -> ${r.sha.slice(0, 12)}  (${o.bytes} -> ${r.bytes} bytes)`);
  }
  for (const r of added)   console.log(`  NEW      ${key(r).padEnd(46)} ${r.title}`);
  for (const o of removed) console.log(`  REMOVED  ${key(o).padEnd(46)} ${o.title}`);
  console.log(`\n  byte-identical ${identical.length}   changed ${changed.length}   new ${added.length}   removed ${removed.length}`);
  console.log(`  agency-mark references inside printed subtrees: ${ref} ${before.reduce((n, r) => n + r.markHits, 0)}  ->  now ${rows.reduce((n, r) => n + r.markHits, 0)}\n`);
  process.exit(changed.length === 0 ? 0 : 1);
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
