// COMPILE src/lib/agencySeed.ts INTO functions/agency-seed.generated.mjs.
//
// Run automatically by `firebase deploy` via the predeploy hook in firebase.json, beside
// sync-functions-config.js.
//
// WHY THIS EXISTS (AUDIT G32, and F75/F77 for the pattern)
// --------------------------------------------------------
// A deployed function ships only what is inside functions/, so it cannot import from src/ - and
// createAgency has to seed a new agency EXACTLY as the browser does. The alternative to this
// script is a second copy of the seeding code inside functions/, which is the arrangement F30
// records the cost of: seeding that drifted propagated one agency's data into every agency
// created afterwards, permanently, with no trace of where it came from. Two implementations
// would mean the browser and the server could disagree about what an agency IS, and the
// disagreement would be invisible until someone compared two agencies created a week apart.
//
// So the TypeScript is COMPILED rather than retyped. Nothing is transcribed, so nothing can
// drift. esbuild is already a dependency (Vite's), so this adds nothing to install.
//
// ⚠ THE OUTPUT IS A BUILD ARTEFACT AND MUST NOT BE EDITED. Its own header says so, and it is
// regenerated on every deploy, so an edit would survive exactly until the next one - the worst
// kind of change, because it works when tested and vanishes later.

import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SRC = 'src/lib/agencySeed.ts';
const DST = 'functions/agency-seed.generated.mjs';

const BANNER = `// GENERATED FILE - DO NOT EDIT.
//
// Compiled from ${SRC} by scripts/sync-agency-seed.js, which runs on every \`firebase deploy\`.
// Edit the TypeScript source; anything written here is overwritten by the next deploy.
//
// It exists because a deployed function cannot import from src/, and because a hand-written
// second copy of the agency seed is the arrangement AUDIT F30 records the cost of.
`;

const result = await build({
  entryPoints: [SRC],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  // Readable output: this is what the server actually runs, and a minified blob cannot be
  // reviewed in a diff or reasoned about when something goes wrong at 2am.
  minify: false,
  banner: { js: BANNER },
  write: false,
});

const next = result.outputFiles[0].text;
const before = existsSync(DST) ? readFileSync(DST, 'utf8') : null;

if (before === next) {
  console.log(`[sync-agency-seed] ${DST} already matches ${SRC}.`);
} else {
  writeFileSync(DST, next);
  console.log(`[sync-agency-seed] ${DST} REGENERATED from ${SRC}.`);
}
