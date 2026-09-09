// PROVE THE SEED EXTRACTION IS A NO-OP. Three implementations, one hash.
//
// WHAT IS BEING ASKED (AUDIT G32)
// --------------------------------
// `addAgency` used to assemble a new agency inline. That assembly moved to
// src/lib/agencySeed.ts so a Cloud Function can share it, and the function runs a COMPILED
// copy, produced at predeploy by scripts/sync-agency-seed.js.
//
// So there are three things that must agree, and each could differ from the others:
//
//   A. LEGACY   the expression that stood in addAgency before the extraction, transcribed
//               here verbatim, reading the same shipped constants.
//   B. SHARED   buildNewAgencyDocument() in src/lib/agencySeed.ts - what the browser now runs.
//   C. COMPILED functions/agency-seed.generated.mjs - what the SERVER will run.
//
// A === B says the refactor changed nothing. B === C says the compilation is faithful. Both
// are needed: a refactor that is correct but compiles to something different is not safe, and
// a faithful compilation of a broken refactor is not either.
//
// ⚠ WHAT THIS DELIBERATELY DOES NOT TEST: whether the seed matches THE TWELVE EXISTING
// AGENCIES. It does not, and it should not. F30 records that they were seeded at different
// times from different sources - some inherited public_config's 17 filled CRGO cells including
// the two that were wrong, some inherited another agency's data outright. Their stored masters
// are historical artefacts, not a specification. A "no-op" test against them would fail for
// reasons that have nothing to do with this change, and the natural response to a test that
// fails for the wrong reason is to weaken it.
//
// The question is whether TODAY'S code produces what YESTERDAY'S code produced, for the same
// input. That is what is asserted here, and it is asserted on a hash of canonicalised JSON so
// a field moving cannot be mistaken for a field changing.
//
// READ-ONLY. Touches no database. Run it before trusting the extraction:
//
//     node scripts/admin/verify-seed-equality.js

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const GENERATED = 'functions/agency-seed.generated.mjs';

/** Load a TypeScript module by compiling it to a data: URL. No temp files, no side effects. */
async function loadTs(entry) {
  const out = await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node',
    target: 'node20', write: false,
  });
  const b64 = Buffer.from(out.outputFiles[0].text, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${b64}`);
}

const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');

console.log('\nSEED EQUALITY — three implementations, one document\n');

// ---- the input. Deliberately awkward, so the spread order is actually exercised ----------
//
// ⚠ IT OVERRIDES ONE SEEDED SECTION ON PURPOSE. If the caller's data were all fresh fields,
// every spread order would give the same answer and the test would pass on a bug. The seed
// must go FIRST so a caller can override it; `ownerId` must go LAST so a caller cannot forge
// it. Both are asserted below.
const AGENCY_DATA = {
  name: 'TEST AGENCY',
  discomName: 'Uttar Gujarat Vij Company Ltd.',
  agencyState: '',
  agencyStateCode: '',
  estimateMasterOverhauling: [{ itemCode: 'X1', itemName: 'caller override', rate: 1 }],
  ownerId: 'SPOOFED-BY-CALLER',
};
const OWNER = 'REAL-OWNER-UID';

const seed = await loadTs('src/lib/agencySeed.ts');
const { canonicalJson } = seed;

// ---- A. LEGACY ---------------------------------------------------------------------------
// Transcribed verbatim from AgencyContext.tsx as it stood at commit b57389d, immediately
// before the extraction. The trailing spaces in the original are not reproduced; whitespace
// inside a JS expression is not part of its value.
const data = await loadTs('src/lib/estimateData.ts');
const legacy = (() => {
  const defaultCRGO = data.defaultEstimateData;
  const defaultAmorphous = data.defaultAmorphousEstimateData;
  const defaultWoundCore = data.defaultWoundCoreEstimateData;
  const defaultOverhauling = data.defaultOverhaulingEstimateData;
  const defaultCircleLimits = data.defaultCircleLimitsEstimateData;
  return {
    estimateMasterCRGO: defaultCRGO,
    estimateMasterAmorphous: defaultAmorphous,
    estimateMasterWoundCore: defaultWoundCore,
    estimateMasterOverhauling: defaultOverhauling,
    estimateMasterCircleLimits: defaultCircleLimits,
    ...AGENCY_DATA,
    ownerId: OWNER,
  };
})();

// ---- B. SHARED ---------------------------------------------------------------------------
const shared = seed.buildNewAgencyDocument(AGENCY_DATA, OWNER);

// ---- C. COMPILED -------------------------------------------------------------------------
if (!existsSync(GENERATED)) {
  console.log(`  ${GENERATED} does not exist yet.`);
  console.log('  Run:  node scripts/sync-agency-seed.js\n');
  process.exit(1);
}
const compiled = await import(pathToFileURL(resolve(GENERATED)).href);
const fromServer = compiled.buildNewAgencyDocument(AGENCY_DATA, OWNER);

// ---- compare -----------------------------------------------------------------------------
const rows = [
  ['A  legacy expression (pre-extraction)', legacy],
  ['B  buildNewAgencyDocument (browser)  ', shared],
  ['C  compiled artefact (server)        ', fromServer],
];

let bad = 0;
const first = sha(canonicalJson(rows[0][1]));
for (const [label, doc] of rows) {
  const h = sha(canonicalJson(doc));
  const same = h === first;
  if (!same) bad++;
  console.log(`  ${same ? 'match  ' : 'DIFFERS'}  ${label}  ${h.slice(0, 16)}`);
}

// ---- the two properties the spread order exists for ---------------------------------------
console.log('\n  spread-order properties:');
const overrodeSeed =
  JSON.stringify(shared.estimateMasterOverhauling) === JSON.stringify(AGENCY_DATA.estimateMasterOverhauling);
const ownerWins = shared.ownerId === OWNER;
console.log(`    ${overrodeSeed ? 'ok  ' : 'FAIL'}  caller data overrides the seed`);
console.log(`    ${ownerWins ? 'ok  ' : 'FAIL'}  ownerId cannot be forged by the caller`);

// ---- what is actually in there ------------------------------------------------------------
console.log('\n  sections seeded:');
for (const [k, v] of Object.entries(seed.AGENCY_SEED)) {
  console.log(`    ${k.padEnd(30)} ${Array.isArray(v) ? v.length : '?'} items`);
}
console.log(`    ${'(total)'.padEnd(30)} ${Object.values(seed.AGENCY_SEED).reduce((n, v) => n + v.length, 0)} items`);
console.log(`\n  no 'estimateMaster' mirror: ${!('estimateMaster' in shared) ? 'confirmed' : 'FAIL — one was added'}`);
console.log(`  no 'createdAt' in the built document: ${!('createdAt' in shared) ? 'confirmed' : 'FAIL — a clock leaked in'}`);

// ---- THE NEGATIVE CONTROL, RUN EVERY TIME RATHER THAN REMEMBERED (AUDIT G33) -------------
//
// ⚠ A HARNESS THAT REPORTS NO DIFFERENCE MUST CONTAIN A CASE THAT MUST DIFFER. This one is
// built in, because the first time it was run by hand it SILENTLY DID NOTHING: the perturbation
// was applied with a regex that did not match the generated file's format, the exception was
// caught by the shell rather than the script, and the comparator then reported PASS against a
// file nobody had modified. A control that cannot apply its own perturbation reports the same
// PASS as a control that applied it and found no difference.
//
// So the perturbation is ASSERTED TO HAVE LANDED before its result is believed. Confirming the
// modified value is actually present is the whole difference between proving the comparator can
// see and proving nothing at all.
function selfTest() {
  const clone = JSON.parse(JSON.stringify(shared));
  const section = clone.estimateMasterCRGO;
  if (!Array.isArray(section) || !section.length) {
    console.log('\n  SELF-TEST COULD NOT RUN: no CRGO section to perturb.');
    return false;
  }

  // Perturb one field of one item - the smallest change the comparator must still catch.
  const SENTINEL = '__PERTURBED__';
  const before = section[0].itemName;
  section[0].itemName = SENTINEL;

  // ⚠ ASSERT THE PERTURBATION LANDED. Not "did the hash change" - that is the thing being
  // tested and cannot also be the evidence that the test ran.
  const landed = clone.estimateMasterCRGO[0].itemName === SENTINEL && before !== SENTINEL;
  if (!landed) {
    console.log('\n  SELF-TEST FAILED TO PERTURB. The control did not run, so nothing above is proved.');
    return false;
  }

  const changed = sha(canonicalJson(clone)) !== first;
  console.log(`\n  negative control: perturbation landed, comparator ${changed ? 'SAW it' : 'MISSED IT'}`);
  return changed;
}

const controlPassed = selfTest();

const ok = bad === 0 && overrodeSeed && ownerWins
  && !('estimateMaster' in shared) && !('createdAt' in shared)
  && controlPassed;
console.log(`\n${ok ? 'PASS — the extraction is a no-op, and the comparator can see.' : 'FAIL — see above.'}\n`);
process.exit(ok ? 0 : 1);
