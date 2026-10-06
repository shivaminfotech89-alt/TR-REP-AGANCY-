// Tests for lib/mrEditDraft.ts - the edit dialog's copy of a stored job (AUDIT G111). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DRAFT_JOB_FIELDS, mrEditJob } from './mrEditDraft';

const stored = (over: Record<string, unknown> = {}) => ({
  id: 'job1', jobNo: 'SU-11', capacityKva: 63, make: 'FGFG', serialNo: '23132', coreType: 'CRGO',
  status: 'Received', division: 'DEESA', repairType: 'OGP', prevAtNo: '', prevJobNo: '',
  prevDeliveryDate: '', gpReason: '', atId: 'O141gDio6XTRyuMyZeQl', ...over,
});

const ledgerRaw = readFileSync(new URL('../components/MrLedger.tsx', import.meta.url), 'utf8');

/**
 * ⚠ COMMENTS STRIPPED BEFORE SCANNING, OR THE SCAN READS ITS OWN LESSON AS A VIOLATION. The notes left by this
 * change QUOTE the old code - the cast it removed - and a source check that cannot tell a quotation from a call
 * reports the explanation as the defect. That happened on the first run of these tests.
 */
const stripComments = (src: string): string => {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  out = out
    .split('\n')
    .map(line => {
      const at = line.indexOf('//');
      return at >= 0 ? line.slice(0, at) : line;
    })
    .join('\n');
  return out;
};

const ledger = stripComments(ledgerRaw);

/**
 * ⚠ ONLY THE CODE THAT *READS* DRAFTS - THE GATE. This component handles BOTH shapes: `mrGroups` holds stored
 * Firestore documents and `editingMr.jobs` holds drafts, and a read of `estimateSentDate`, `challanNo` or `isGp`
 * off a stored job is perfectly correct. Scanning the whole file meant keeping a list of stored-only field names,
 * which is the fragile half of a source check - and a first slice that reached into `handleAddTransformerToMr`
 * caught that function's agency-wide scan of STORED jobs and reported `isGp` as undeclared.
 *
 * ⚠ THE DIVISION OF LABOUR IS DELIBERATE. **tsc** guards draft CONSTRUCTION - making `atId` required is what made
 * it refuse the newly-added row that omitted it, which is a second instance this change found. **This scan** guards
 * draft READS, where a missing field is an `undefined` rather than a compile error. Neither covers the other.
 */
const draftRegion = (() => {
  const from = ledger.indexOf('const atForEditingMr');
  const to = ledger.indexOf('const handleAddTransformerToMr');
  return from >= 0 && to > from ? ledger.slice(from, to) : '';
})();

const fieldReads = (src: string): string[] => {
  const found = new Set<string>();
  for (const m of src.matchAll(/\b(?:j|job)\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) found.add(m[1]);
  return [...found];
};

// ── ⚠ THE GENERAL FORM: every field a consumer reads must be a field the draft carries ───────────────────────

/**
 * ⚠ THIS IS THE TEST THE DEFECT ASKED FOR, AND IT IS NOT ABOUT `atId`.
 *
 * The cause was a hand-written field list in `handleOpenFullMrEdit` that omitted one name. Asserting that `atId`
 * survives would catch that one instance and nothing else - the same mapping can drop the next field someone adds,
 * and a field missing from a draft reads as absent DATA rather than as a mistake.
 *
 * So this derives what the draft code actually reads, from source, and requires it to be a subset of the declared
 * contract. Add a read without declaring the field and this fails; declare one without producing it and the next
 * test fails.
 */
test('⚠ every job field the draft code reads is in DRAFT_JOB_FIELDS', () => {
  assert.ok(draftRegion.length > 200, 'the draft region could not be located - its markers moved');
  const notFields = new Set(['map', 'filter', 'some', 'every', 'forEach', 'reduce', 'sort', 'slice', 'join',
    'push', 'find', 'trim', 'toUpperCase', 'length']);
  const declared = new Set<string>(DRAFT_JOB_FIELDS);
  const undeclared = fieldReads(draftRegion).filter(f => !declared.has(f) && !notFields.has(f));
  assert.deepEqual(undeclared, [],
    `the draft code reads these, but the contract does not declare them: ${undeclared.join(', ')}. `
    + 'Add them to DRAFT_JOB_FIELDS and mrEditJob - an undeclared read is an undefined at runtime.');
});

test('⚠ mrEditJob carries every field the contract declares', () => {
  const draft: Record<string, unknown> = { ...mrEditJob(stored()) };
  const missing = DRAFT_JOB_FIELDS.filter(f => !(f in draft));
  assert.deepEqual(missing, [], `the draft omits declared field(s): ${missing.join(', ')}`);
});

test('a declared field is never left undefined, which would pass the subset test and still break', () => {
  const draft: Record<string, unknown> = { ...mrEditJob({}) };
  for (const f of DRAFT_JOB_FIELDS) {
    if (f === 'id') continue;   // undefined on a new row, by design
    assert.notEqual(draft[f], undefined, `${f} is declared but mrEditJob leaves it undefined`);
  }
});

test('the comment stripper really does remove a quoted cast', () => {
  // A check that cannot fail is worth nothing; this one is shown able to see the difference.
  const sample = 'const a = 1; // reads (j as any).atId\nconst b = (j as any).atId;';
  const out = stripComments(sample);
  assert.ok(!out.includes('reads (j as any).atId'), 'the line comment survived');
  assert.ok(out.includes('const b = (j as any).atId;'), 'the real call was stripped too');
});

// ── The instance: atId survives, which is what fired on every MR ─────────────────────────────────────────────

test('⚠ atId survives the mapping - ADMIN MR 45645 is the case that did not', () => {
  assert.equal(mrEditJob(stored()).atId, 'O141gDio6XTRyuMyZeQl');
});

test('a job with no AT yields an empty string, not undefined', () => {
  // The gate's two arms both test a trimmed string; undefined would work by luck rather than by contract.
  assert.equal(mrEditJob(stored({ atId: undefined })).atId, '');
  assert.equal(mrEditJob(stored({ atId: null })).atId, '');
  assert.equal(mrEditJob({}).atId, '');
});

test('a padded atId is trimmed, so it reads as a value rather than a blank', () => {
  assert.equal(mrEditJob(stored({ atId: '  abc  ' })).atId, 'abc');
});

// ── What the gate then concludes, which is the behaviour that was wrong ──────────────────────────────────────

/** `atForEditingMr`'s two arms, over drafts - the shape, without the component. */
const resolve = (jobs: { atId: string }[]) => {
  const ids = [...new Set(jobs.map(j => j.atId.trim()).filter(Boolean))];
  const without = jobs.filter(j => !j.atId.trim()).length;
  if (ids.length === 1 && without === 0) return { atId: ids[0] };
  if (ids.length === 0) return { error: 'message 1 - no AT on any job' };
  if (ids.length === 1) return { error: 'message 2 - partly unstamped' };
  return { error: 'message 3 - different ATs' };
};

test('⚠ one job with a valid AT resolves - it previously hit message 1', () => {
  assert.deepEqual(resolve([mrEditJob(stored())]), { atId: 'O141gDio6XTRyuMyZeQl' });
});

test('and the mapping that omitted atId is what produced message 1 on every MR', () => {
  const asItWas = { ...mrEditJob(stored()), atId: '' };
  assert.deepEqual(resolve([asItWas]), { error: 'message 1 - no AT on any job' });
});

test('⚠ a newly added row carries the MR AT, or a SECOND add would read partly unstamped', () => {
  const existing = mrEditJob(stored());
  const added = { ...mrEditJob({}), isNew: true, atId: existing.atId };
  assert.deepEqual(resolve([existing, added]), { atId: 'O141gDio6XTRyuMyZeQl' });
  assert.deepEqual(resolve([existing, { ...added, atId: '' }]), { error: 'message 2 - partly unstamped' });
});

test('the real multi-AT and no-AT cases still resolve to their own messages', () => {
  const twoAts = resolve([mrEditJob(stored({ atId: 'a' })), mrEditJob(stored({ atId: 'b' }))]) as { error: string };
  assert.match(twoAts.error, /message 3/);
  const none = resolve([mrEditJob(stored({ atId: '' }))]) as { error: string };
  assert.match(none.error, /message 1/);
});

// ── ⚠ No cast may read a job field again ─────────────────────────────────────────────────────────────────────

test('⚠ the draft code reads no job field through an `as any` cast', () => {
  // The cast is what hid this: it compiled, read undefined every time, and WITHOUT it tsc would have refused the
  // line. A cast on a field that should exist is a suppressed question, not a workaround - removing one elsewhere
  // in this file immediately surfaced `isGp`, missing from the Job type while present on 162 of 176 live jobs.
  const casts = [...draftRegion.matchAll(/\((?:j|job) as any\)\.([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(m => m[1]);
  assert.deepEqual(casts, [],
    `these are read through a cast, which stops tsc answering whether they exist: ${casts.join(', ')}`);
});

test('the dialog builds its drafts with the shared mapping, not a literal field list', () => {
  assert.ok(ledger.includes('group.jobs.map(mrEditJob)'),
    'handleOpenFullMrEdit must use mrEditJob - a literal field list here is what omitted atId');
});
