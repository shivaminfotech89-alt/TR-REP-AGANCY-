// BUILDING THE DOCUMENTS: generated entries, the app's own Vite + React + Tailwind, and a class-coverage check
// against each document's whole source before anything built here is allowed to be printed.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build as viteBuild } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { REPO, Refusal, slash } from './env.mjs';
import { classTokens, missingClasses } from './sources.mjs';

/**
 * One Vite build per source tree (the working tree, or the worktree being compared against).
 *
 * `folder` is Vite's root and holds ONLY this run's generated entries and data. Output goes to a sibling directory,
 * outside it, so no build can be scanned by another.
 *
 * ⚠ THE STYLESHEET NAMES THE TREE'S OWN src AS TAILWIND'S SOURCE. With the harness folder as Vite's root, Tailwind
 * generated classes only from what it found in that folder - not from the components the build imported - and a
 * sheet came out missing 28 of its 130 classes. With `@source` naming the tree's src it carries all 130 from a clean
 * folder (AUDIT, "a harness that reports a defect the app does not have"). A worktree is named as its own source, so
 * an older commit is styled by its own classes.
 */
export async function buildTree({ root, label, work, docs, selections, extra }) {
  const folder = join(work, label);
  const outDir = join(work, `${label}-dist`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'harness.css'), `@import "${slash(root)}/src/index.css";\n@source "${slash(root)}/src";\n`);
  const built = {};
  const unavailable = {};
  for (const doc of docs) {
    try {
      const { entry, coverageText } = doc.generate(root);
      writeFileSync(join(folder, `${doc.id}.json`), JSON.stringify({ ...selections[doc.id].data, ...extra }));
      writeFileSync(join(folder, `${doc.id}.entry.tsx`), entry);
      writeFileSync(join(folder, `${doc.id}.html`), `<!doctype html>\n<html><head><meta charset="utf-8"><title>${doc.id}</title></head><body><div id="root"></div><script type="module" src="./${doc.id}.entry.tsx"></script></body></html>\n`);
      built[doc.id] = coverageText;
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      unavailable[doc.id] = e.message;
    }
  }
  if (!Object.keys(built).length) return { outDir, unavailable, coverage: {} };

  await viteBuild({
    configFile: false,
    root: folder,
    base: './',
    logLevel: 'warn',
    plugins: [react(), tailwind()],
    // The entries sit outside the repository, so their own bare imports would not find its node_modules. One absolute
    // path per package also keeps a single React across the entries and the components they import.
    resolve: { alias: [{ find: /^(react|react-dom|react-router-dom|lucide-react)(\/.*)?$/, replacement: `${slash(REPO)}/node_modules/$1$2` }] },
    build: {
      outDir, emptyOutDir: true, chunkSizeWarningLimit: 1e9,
      rollupOptions: { input: Object.fromEntries(Object.keys(built).map(id => [id, join(folder, `${id}.html`)])) },
    },
  });

  const css = readdirSync(join(outDir, 'assets')).filter(f => f.endsWith('.css')).map(f => readFileSync(join(outDir, 'assets', f), 'utf8')).join('\n');
  // The coverage check must be able to report a missing class, or its "0 missing" means nothing.
  if (!missingClasses(['print-check-control-no-such-class'], css).length) throw new Refusal('the class-coverage check cannot report a missing class, so it would pass any build.');
  const coverage = {};
  for (const [id, text] of Object.entries(built)) {
    const tokens = classTokens(text);
    if (!tokens.size) throw new Refusal(`${label} ${id}: no class names found in the document's source - coverage would compare nothing.`);
    const missing = missingClasses(tokens, css);
    if (missing.length) {
      throw new Refusal(`${label} ${id}: the build is missing ${missing.length} of the ${tokens.size} classes the document's source uses:\n      ${missing.join(' ')}\n    A sheet printed from this build would not be the app's sheet. G62's false finding came from exactly this.`);
    }
    coverage[id] = tokens.size;
  }
  return { outDir, unavailable, coverage };
}
