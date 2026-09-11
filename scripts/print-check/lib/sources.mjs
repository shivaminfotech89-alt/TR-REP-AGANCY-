// READING A DOCUMENT'S SOURCE: cutting inline printed documents out of their screens, and listing the classes a
// document uses so the build can be checked against all of them.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Refusal } from './env.mjs';

export const readSource = (root, file) => {
  const path = join(root, file);
  if (!existsSync(path)) throw new Refusal(`${file} does not exist at this commit.`);
  return readFileSync(path, 'utf8').replace(/^﻿/, '').split(String.fromCharCode(13)).join('');
};

/**
 * CUT AN INLINE PRINTED DOCUMENT OUT OF ITS SCREEN, BETWEEN TWO MARKERS THAT MUST EACH APPEAR EXACTLY ONCE.
 *
 * Ten of the app's thirteen printed documents are written inline inside screen components, so the only way to render
 * one on its own - short of extracting it - is to take its code as text. This is a stopgap by decision (AUDIT G65):
 * each document is extracted into a component the next time its code is touched, and then renders directly.
 *
 * ⚠ A MARKER THAT MOVED FAILS LOUDLY. Missing, duplicated, out of order, or bracketing text that no longer contains
 * what the document must contain - each refuses, naming the file and the marker. Re-pointing a marker to make the
 * run pass is how a cut silently becomes half a document.
 */
export function cut(root, file, what, start, end, mustContain = []) {
  const src = readSource(root, file);
  for (const [name, marker] of [['start', start], ['end', end]]) {
    const n = src.split(marker).length - 1;
    if (n !== 1) {
      throw new Refusal(`${what} is cut out of ${file} between two markers, and the ${name} marker appears ${n} time(s) instead of once:\n`
        + `      ${JSON.stringify(marker)}\n`
        + `    The code has moved or changed. Do not re-point the marker just to make this pass - the cut must still be the whole document.\n`
        + `    The lasting fix is to extract ${what} into its own component, due the next time that code is touched (AUDIT G65).`);
    }
  }
  const a = src.indexOf(start), b = src.indexOf(end);
  if (b <= a) throw new Refusal(`${what}: in ${file} the end marker now comes before the start marker.`);
  const block = src.slice(a, b);
  for (const m of mustContain) {
    if (!block.includes(m)) throw new Refusal(`${what}: the text between the markers in ${file} no longer contains ${JSON.stringify(m)} - the markers bracket something else now.`);
  }
  return block;
}

/** PrintableA4Page, which every document here is printed on. */
export function letterheadRegion(root) {
  return cut(root, 'src/components/LetterheadHeader.tsx', 'PrintableA4Page', 'export function PrintableA4Page', 'export function LetterheadPageWrapper');
}

/** Every static class name in className="..." and in the static parts of className={`...`}. */
export function classTokens(text) {
  const tokens = new Set();
  for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    (m[1] ?? m[2].replace(/\$\{[^}]*\}/g, ' ')).split(/\s+/).filter(Boolean).forEach(t => tokens.add(t));
  }
  return tokens;
}

/** The class names a stylesheet does not define, escaped the way Tailwind writes selectors. */
export function missingClasses(tokens, css) {
  const esc = t => t.replace(/([:\[\]\.\/%#()!,&>+~=])/g, '\\$1');
  return [...tokens].filter(t => !css.includes(`.${esc(t)}`));
}
