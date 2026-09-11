// RUN THE TEST SUITE - AND REFUSE TO CALL ZERO TESTS A PASS (AUDIT G60).
//
//     npm test                          every *.test.ts under src/
//     node scripts/run-tests.js <dir>   every *.test.ts under <dir>
//
// Node's built-in test runner, with tsx (already a devDependency) loading TypeScript. No test
// framework, no test dependencies - see G60 for why, and for when that should change.
//
// ⚠ `node --test "src/**/*.test.ts"` EXITS 0 WHEN THE PATTERN MATCHES NOTHING. It prints
// "tests 0" and reports success. Rename a test file, move the folder or mistype the pattern, and
// the suite passes having run nothing - the failure this project keeps recording, a check that
// reports clean because it cannot see its subject (G33, G59). So this finds the files itself and
// reads the run's own count: no files, or no tests run, is a failure.
//
// ⚠ NOT A GATE. Nothing runs this automatically - not the build, not a deploy, not a hook. That is
// a decision, recorded in G60 with what would change it, not an omission.
//
// scripts/admin/ is deliberately NOT part of this. Most of it reads or writes the production
// database with a service key, and a test run must never be able to reach it.

import { readdirSync, statSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = process.argv[2] || 'src';
const walk = dir => readdirSync(dir).flatMap(name => {
  if (name === 'node_modules') return [];
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : name.endsWith('.test.ts') ? [p] : [];
});
const files = walk(root).sort();
if (files.length === 0) {
  console.error(`\nNo *.test.ts files under ${root}/ - that is a failure, not a pass.\n`);
  process.exit(1);
}

// Two reporters: the readable one to the terminal, TAP to a file so the count can be read back.
const tmp = mkdtempSync(join(tmpdir(), 'run-tests-'));
const tap = join(tmp, 'results.tap');
const run = spawnSync(process.execPath, [
  '--import', 'tsx', '--test',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=tap', `--test-reporter-destination=${tap}`,
  ...files,
], { stdio: 'inherit' });

let report = '';
try { report = readFileSync(tap, 'utf8'); } catch { /* no report */ }
rmSync(tmp, { recursive: true, force: true });

if (run.status !== 0) process.exit(run.status ?? 1);

// ⚠ A FILE WITH NO TESTS IS REPORTED AS ONE PASSING TEST, NAMED BY ITS OWN PATH. Found by trying
// it: a .test.ts holding only `export {}` gives "tests 1, pass 1", so the count alone cannot be
// trusted. A top-level result named after a test file means that file ran nothing.
const unescapeTap = s => s.replace(/\\#/g, '#').replace(/\\\\/g, '\\');
const topLevelNames = [...report.matchAll(/^(?:not )?ok \d+ - (.+)$/gm)].map(m => resolve(unescapeTap(m[1].trim())));
const ranNothing = files.filter(f => topLevelNames.includes(resolve(f)));
if (ranNothing.length) {
  console.error(`\nThese test file(s) ran no tests - that is a failure, not a pass:\n${ranNothing.map(f => '  ' + f).join('\n')}\n`);
  process.exit(1);
}

const ran = Number((report.match(/^# tests (\d+)/m) || [])[1] || 0);
if (ran === 0) {
  console.error(`\n${files.length} test file(s) found, but no tests ran - that is a failure, not a pass.\n`);
  process.exit(1);
}
console.log(`\n${ran} test(s) in ${files.length} file(s).`);
