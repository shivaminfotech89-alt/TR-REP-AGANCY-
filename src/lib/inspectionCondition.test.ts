// Tests for lib/inspectionCondition - the three condition values and which declarations stick (AUDIT G114).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONDITION_OH, CONDITION_SCRAP, CONDITION_REPAIRABLE, CONDITION_OPTIONS,
  conditionChange, conditionIsNonConsuming, jobUpdatesForCondition,
  COIL_ITEM_CODES, coilReplacementRecorded, conditionSaveCheck,
} from './inspectionCondition';
import { CREATABLE_REPAIR_TYPES } from './repairType';

const change = (from: string, to: string, replacements: any[] = []) =>
  conditionChange({ jobId: 'j9', jobNo: 'SU-9', from, to, replacements });

// ── The three values ────────────────────────────────────────────────────────────────────────────────────────

test('the dropdown offers exactly three, and the stored value for OH is the bare "OH"', () => {
  assert.deepEqual(CONDITION_OPTIONS.map(o => o.value), ['Repairable', 'OH', 'Scrap']);
  // ⚠ The stored string has to match what `drawsOnAllotment` and `hasNoGuarantee` test for. A longer label
  // stored here would need a translation layer, and a translation layer is where the two would drift.
  assert.equal(CONDITION_OH, 'OH');
  assert.match(CONDITION_OPTIONS[1].label, /Overhauling/, 'the label has to spell it out for the engineer');
});

test('OH and Scrap are the non-consuming conditions; Repairable is not', () => {
  assert.equal(conditionIsNonConsuming(CONDITION_OH), true);
  assert.equal(conditionIsNonConsuming(CONDITION_SCRAP), true);
  assert.equal(conditionIsNonConsuming(CONDITION_REPAIRABLE), false);
  assert.equal(conditionIsNonConsuming(''), false);
  assert.equal(conditionIsNonConsuming(undefined), false);
});

// ── The transition table, every cell ────────────────────────────────────────────────────────────────────────

test('first determination: unset -> any of the three', () => {
  for (const to of ['Repairable', 'OH', 'Scrap']) {
    assert.equal(change('', to).ok, true, to);
  }
});

test('Repairable -> Scrap and Repairable -> OH are both allowed', () => {
  assert.equal(change('Repairable', 'Scrap').ok, true, 'discovered late');
  assert.equal(change('Repairable', 'OH').ok, true, 'opened and found serviceable');
});

test('⚠ OH -> Scrap is allowed, and the reason it is safe is the quota', () => {
  // Both are non-consuming, so moving between them cannot change what the allotment reads.
  const v = change('OH', 'Scrap');
  assert.equal(v.ok, true);
});

test('⚠ Scrap is terminal - it goes to neither Repairable nor OH', () => {
  for (const to of ['Repairable', 'OH']) {
    const v = change('Scrap', to);
    assert.equal(v.ok, false, to);
    assert.match((v as any).reason, /cannot be reversed/);
    assert.match((v as any).reason, /cannot be undiscovered/);
    assert.match((v as any).reason, /SU-9/, 'the refusal names the transformer');
  }
});

test('⚠ nothing may be cleared, from any state', () => {
  for (const from of ['', 'Repairable', 'OH', 'Scrap']) {
    const v = change(from, '');
    assert.equal(v.ok, false, from);
    assert.match((v as any).reason, /cannot be cleared/);
  }
});

test('no change reports ok but changed:false, so a save writes nothing', () => {
  const v = change('OH', 'OH');
  assert.equal(v.ok, true);
  assert.equal((v as any).changed, false);
});

// ── The one conditional ─────────────────────────────────────────────────────────────────────────────────────

test('OH -> Repairable is allowed while nothing has been issued against it', () => {
  const v = change('OH', 'Repairable', [
    { jobNo: 'SU-11', issuedAgainstJobId: 'SOMETHING-ELSE' },
    { jobNo: 'SU-12' },
  ]);
  assert.equal(v.ok, true, 'a mis-click before any replacement needs no protecting against');
});

test('⚠⚠ OH -> Repairable is refused once a replacement exists, and the refusal names it and the route', () => {
  const v = change('OH', 'Repairable', [{ jobNo: 'SU-11', issuedAgainstJobId: 'j9' }]);
  assert.equal(v.ok, false);
  const reason = (v as any).reason;
  assert.match(reason, /SU-9 cannot return to Repairable/);
  assert.match(reason, /SU-11 was issued against it/, 'it must name the replacement');
  assert.match(reason, /over its quota/, 'and say why - the quota is the whole reason');
  assert.match(reason, /Cancel SU-11 first/, 'and name the route out, like the MR-add refusal');
});

test('two replacements against one unit are both named, and the verb agrees', () => {
  const v = change('OH', 'Repairable', [
    { jobNo: 'SU-11', issuedAgainstJobId: 'j9' },
    { jobNo: 'SU-12', issuedAgainstJobId: 'j9' },
  ]);
  assert.match((v as any).reason, /SU-11, SU-12 were issued against it/);
});

test('a replacement against a DIFFERENT job does not block this one', () => {
  const v = change('OH', 'Repairable', [{ jobNo: 'SU-11', issuedAgainstJobId: 'j8' }]);
  assert.equal(v.ok, true);
});

test('⚠ Scrap is refused BEFORE the replacement question is asked', () => {
  // Scrap -> Repairable with a replacement outstanding must give Scrap's reason, not the quota one: no amount
  // of cancelling a replacement un-condemns a unit, so offering that route would be a dead end.
  const v = change('Scrap', 'Repairable', [{ jobNo: 'SU-11', issuedAgainstJobId: 'j9' }]);
  assert.equal(v.ok, false);
  assert.match((v as any).reason, /cannot be undiscovered/);
  assert.doesNotMatch((v as any).reason, /Cancel SU-11/);
});

// ── What gets written on the job ────────────────────────────────────────────────────────────────────────────

test('declaring OH on an OGP job moves repairType to OH and nothing else', () => {
  const out = jobUpdatesForCondition({ condition: 'OH', currentRepairType: 'OGP' });
  assert.deepEqual(out, { condition: 'OH', repairType: 'OH' });
  assert.deepEqual(Object.keys(out).sort(), ['condition', 'repairType'],
    'no coreType, no jobNo, no mrNo - "DONT CHANGE JOB NO WHICH ACTUALLY CREATED"');
});

test('⚠ a GP job keeps repairType GP - the guarantee-rework fact is older than the declaration', () => {
  const out = jobUpdatesForCondition({ condition: 'OH', currentRepairType: 'GP' });
  assert.deepEqual(out, { condition: 'OH' });
});

test('leaving OH returns repairType to OGP, which is the only place it came from', () => {
  assert.deepEqual(
    jobUpdatesForCondition({ condition: 'Repairable', currentRepairType: 'OH' }),
    { condition: 'Repairable', repairType: 'OGP' });
  assert.deepEqual(
    jobUpdatesForCondition({ condition: 'Scrap', currentRepairType: 'OH' }),
    { condition: 'Scrap', repairType: 'OGP' });
});

test('an ordinary declaration leaves repairType out of the update entirely', () => {
  for (const to of ['Repairable', 'Scrap']) {
    assert.deepEqual(jobUpdatesForCondition({ condition: to, currentRepairType: 'OGP' }), { condition: to }, to);
  }
});

test('re-declaring OH on an already-OH job does not rewrite repairType', () => {
  assert.deepEqual(jobUpdatesForCondition({ condition: 'OH', currentRepairType: 'OH' }), { condition: 'OH' });
});

// ── The screen must not offer OH where a job is CREATED ─────────────────────────────────────────────────────

const newJob = readFileSync(new URL('../components/NewJob.tsx', import.meta.url), 'utf8');
const ledger = readFileSync(new URL('../components/MrLedger.tsx', import.meta.url), 'utf8');
const internal = readFileSync(new URL('../components/InternalInspection.tsx', import.meta.url), 'utf8');

test('⚠⚠ the creatable list is the two - asserted on the VALUE, not on the file text', () => {
  // A job is never BOOKED as overhauled: nobody knows until the unit is open on the bench.
  //
  // ⚠ THIS TEST FIRST BANNED `<option value="OH"` ANYWHERE IN BOTH SCREENS AND FAILED HONESTLY. Both
  // screens DO offer an OH option - on the CORE TYPE select, which is the separately-issued overhauling-MR
  // path (Schedule-A sr 21, six agencies using it) and is deliberately untouched by G114. A source scrape
  // cannot tell two selects apart; the exported list can only hold what it holds.
  assert.deepEqual(CREATABLE_REPAIR_TYPES.map(r => r.value), ['OGP', 'GP']);
  assert.ok(!CREATABLE_REPAIR_TYPES.some(r => String(r.value) === 'OH'),
    'OH must never be creatable - it is declared at internal inspection');
  assert.ok(ledger.includes('CREATABLE_REPAIR_TYPES.map'),
    'the MR edit dialog must render from that list, so a third option cannot be added here by analogy');
  assert.ok(!/handleRepairTypeSelect\(['"]OH['"]\)/.test(newJob),
    'and New Job must not route OH through its repair-category toggle');
});

test('⚠ the internal inspection is the one screen that declares it, through the shared rule', () => {
  assert.ok(internal.includes('CONDITION_OPTIONS.map'), 'the column must render the shared option list');
  assert.ok(internal.includes('jobUpdatesForCondition('), 'the job write must go through the shared rule');
  // ⚠ `conditionSaveCheck`, NOT `conditionChange`. The screen must ask the whole question in one call; the
  // transition alone would skip the coil mutual-exclusion rule. Asserted again, from the other side, below.
  assert.ok(internal.includes('conditionSaveCheck('), 'the transition must be checked before the save');
  // The old two-branch write had no room for a third value, which is why it had to go. Tested on the
  // ASSIGNMENT, not on the expression: the note above the new code quotes the old expression to explain why it
  // was replaced, and a scrape for the expression alone reads its own documentation as a regression - the
  // `classTokens` lesson, which cost a print-check refusal for the same reason.
  assert.ok(!/jobUpdates\.condition\s*=\s*declaredScrap/.test(internal),
    'the two-value write is back; a third condition cannot survive it');
});

// ── ⚠⚠ OH AND RECORDED COIL REPLACEMENT ARE MUTUALLY EXCLUSIVE (AUDIT G114, amended) ────────────────────────

// ZB-1's real sheet: 15.21 kg of HV coil, which priced Rs 3,787.29 on a declared-OH job before this rule.
const zb1Coil = { damR: '1', damY: '0', damB: '0', wtOfCoil: '15.21', totWt: '15.21' };
const noCoil = { damR: '0', damY: '0', damB: '0', wtOfCoil: '', totWt: '',
  lvCoilR: 'OK', lvCoilY: 'OK', lvCoilB: 'OK', wtOfCoilLv: '', totWtLv: '', totWtLvReIns: '' };

test('an all-OK sheet records no coil work at all', () => {
  const f = coilReplacementRecorded(noCoil);
  assert.equal(f.recorded, false);
  assert.deepEqual(f.parts, []);
  assert.equal(coilReplacementRecorded(null).recorded, false);
  assert.equal(coilReplacementRecorded({}).recorded, false);
});

test('⚠ every coil item is seen: HV 12A/12C, LV 13A/13C, and 14 re-insulation', () => {
  assert.match(coilReplacementRecorded({ totWt: '15.21' }).parts[0], /15\.21 kg of HV coil replacement \(12A\/12C\)/);
  assert.match(coilReplacementRecorded({ totWtLv: '8.5' }).parts[0], /8\.50 kg of LV coil replacement \(13A\/13C\)/);
  assert.match(coilReplacementRecorded({ totWtLvReIns: '4' }).parts[0], /4\.00 kg of LV coil re-insulation \(14\)/);
});

test('the HV weight mirrors the estimate: totWt, else wtOfCoil x damaged count', () => {
  assert.match(coilReplacementRecorded({ totWt: '30' }).parts[0], /30\.00 kg/);
  assert.match(coilReplacementRecorded({ wtOfCoil: '10', damR: '2' }).parts[0], /20\.00 kg/);
  // A per-coil weight with nothing damaged is not a replacement - the estimate charges nothing either.
  assert.equal(coilReplacementRecorded({ wtOfCoil: '10', damR: '0' }).recorded, false);
});

test('⚠ a damage COUNT with no weight still counts, deliberately wider than the charge', () => {
  // The estimate prices nothing and raises a missing-input error. For this rule the coils are already recorded
  // as changed, and refusing only once the weight is typed would let the contradiction be SAVED and then block
  // it on the estimate - the wrong screen and the wrong person.
  const f = coilReplacementRecorded({ damR: '1', damY: '1' });
  assert.equal(f.recorded, true);
  assert.match(f.parts[0], /2 HV coil\(s\) marked damaged/);
  assert.equal(coilReplacementRecorded({ lvCoilR: 'DAM' }).recorded, true);
  assert.equal(coilReplacementRecorded({ lvCoilY: 'RI' }).recorded, true);
});

test('LV states are read case-insensitively and OK is not a finding', () => {
  assert.equal(coilReplacementRecorded({ lvCoilR: 'dam' }).recorded, true);
  assert.equal(coilReplacementRecorded({ lvCoilR: 'ri' }).recorded, true);
  assert.equal(coilReplacementRecorded({ lvCoilR: 'OK', lvCoilY: 'OK', lvCoilB: 'OK' }).recorded, false);
  // 'DMG' is the value the estimate's old guard tested for and the form never emits. It must not be a finding
  // here either, or the rule would fire on a state nothing can produce.
  assert.equal(coilReplacementRecorded({ lvCoilR: 'DMG' }).recorded, false);
});

test('⚠ the item list is coils only - internal parts are an open question, not a guess', () => {
  assert.deepEqual([...COIL_ITEM_CODES], ['12A', '12B', '12C', '13A', '13B', '13C', '14']);
});

// ── DIRECTION 1: declaring OH onto a sheet that records coil work ───────────────────────────────────────────

test('⚠⚠ declaring OH is refused while coil replacement is recorded, and the figure is named', () => {
  const v = conditionSaveCheck({ jobId: 'j1', jobNo: 'ZB-1', from: 'Repairable', to: 'OH', coil: zb1Coil });
  assert.equal(v.ok, false);
  const reason = (v as any).reason;
  assert.match(reason, /ZB-1 records 15\.21 kg of HV coil replacement/);
  assert.match(reason, /is a repair, not an overhaul/);
  assert.match(reason, /Clear the coil weight if the coils were not replaced/, 'route one');
  assert.match(reason, /leave the condition as Repairable because they were/, 'route two');
});

test('declaring OH on a clean sheet is allowed', () => {
  const v = conditionSaveCheck({ jobId: 'j1', jobNo: 'ZB-1', from: 'Repairable', to: 'OH', coil: noCoil });
  assert.equal(v.ok, true);
});

test('Repairable and Scrap are unaffected by recorded coil work', () => {
  for (const to of ['Repairable', 'Scrap']) {
    assert.equal(conditionSaveCheck({ jobId: 'j1', jobNo: 'ZB-1', from: '', to, coil: zb1Coil }).ok, true, to);
  }
});

// ── ⚠⚠ DIRECTION 2: THE BACK DOOR - declare OH first, enter the weight second ────────────────────────────────

test('⚠⚠ recording coil work onto an ALREADY-OH job is refused, with the condition named as the fix', () => {
  // THE DOOR A ONE-WAY CHECK NEVER SEES. The weight validation in InternalInspection is gated on
  // `condition === 'Repairable'`, so declaring OH first stops the weight being ASKED for - it does not stop one
  // being entered. A test covering only direction 1 passes against this bug.
  const v = conditionSaveCheck({ jobId: 'j1', jobNo: 'ZB-1', from: 'OH', to: 'OH', coil: zb1Coil });
  assert.equal(v.ok, false);
  const reason = (v as any).reason;
  assert.match(reason, /ZB-1 is declared OH, and OH means no coils were changed/);
  assert.match(reason, /15\.21 kg of HV coil replacement/, 'it still names the figure');
  assert.match(reason, /Change the condition to Repairable first/, 'the condition is the thing to change first');
  assert.match(reason, /clear the coil entry if they were not/);
});

test('⚠ the two directions give DIFFERENT wording for the same state', () => {
  const declaring = conditionSaveCheck({ jobId: 'j1', jobNo: 'ZB-1', from: 'Repairable', to: 'OH', coil: zb1Coil });
  const recording = conditionSaveCheck({ jobId: 'j1', jobNo: 'ZB-1', from: 'OH', to: 'OH', coil: zb1Coil });
  assert.equal(declaring.ok, false);
  assert.equal(recording.ok, false);
  assert.notEqual((declaring as any).reason, (recording as any).reason);
  // The direction is derived from the STORED condition, never passed in by the screen.
  assert.match((declaring as any).reason, /^ZB-1 records /);
  assert.match((recording as any).reason, /^ZB-1 is declared OH/);
});

test('an already-OH job with a clean sheet saves normally', () => {
  const v = conditionSaveCheck({ jobId: 'j1', jobNo: 'ZB-1', from: 'OH', to: 'OH', coil: noCoil });
  assert.equal(v.ok, true);
  assert.equal((v as any).changed, false);
});

test('⚠ leaving OH for Repairable with coil work recorded is ALLOWED - that is the fix, not the fault', () => {
  // An engineer who declared OH and then found coil damage must be able to correct the condition. Refusing here
  // would leave the record stuck in the contradictory state the rule exists to prevent.
  const v = conditionSaveCheck({ jobId: 'j1', jobNo: 'ZB-1', from: 'OH', to: 'Repairable', coil: zb1Coil });
  assert.equal(v.ok, true);
});

test('⚠ leaving OH for Scrap with coil work recorded is allowed too', () => {
  assert.equal(conditionSaveCheck({ jobId: 'j1', jobNo: 'ZB-1', from: 'OH', to: 'Scrap', coil: zb1Coil }).ok, true);
});

// ── Ordering against the other refusals ─────────────────────────────────────────────────────────────────────

test('⚠ the transition is checked BEFORE the coil rule', () => {
  // Scrap -> OH is impossible whatever the sheet says, so it must give Scrap's terminality reason rather than
  // sending the engineer to clear a coil weight that would not help.
  const v = conditionSaveCheck({ jobId: 'j1', jobNo: 'ZB-1', from: 'Scrap', to: 'OH', coil: zb1Coil });
  assert.equal(v.ok, false);
  assert.match((v as any).reason, /cannot be undiscovered/);
  assert.doesNotMatch((v as any).reason, /Clear the coil weight/);
});

test('⚠ the replacement refusal also comes before the coil rule', () => {
  const v = conditionSaveCheck({
    jobId: 'j9', jobNo: 'SU-9', from: 'OH', to: 'Repairable',
    coil: zb1Coil, replacements: [{ jobNo: 'SU-11', issuedAgainstJobId: 'j9' }],
  });
  assert.equal(v.ok, false);
  assert.match((v as any).reason, /Cancel SU-11 first/);
});

test('conditionSaveCheck with no coil data answers the transition only', () => {
  // A caller that holds no inspection row - a script, a census - must still get the transition answer rather
  // than an accidental pass on a rule it could not evaluate.
  assert.equal(conditionSaveCheck({ jobId: 'j1', jobNo: 'ZB-1', from: 'Repairable', to: 'OH' }).ok, true);
  assert.equal(conditionSaveCheck({ jobId: 'j1', jobNo: 'ZB-1', from: 'Scrap', to: 'OH' }).ok, false);
});

// ── The screen must use the one entry point, and must not have a second coil predicate ──────────────────────

test('⚠⚠ the save goes through conditionSaveCheck, not conditionChange alone', () => {
  assert.ok(internal.includes('conditionSaveCheck('),
    'the screen must ask the whole question - transition AND mutual exclusion - in one call');
  assert.ok(!/\bconditionChange\(/.test(internal),
    'calling conditionChange directly skips the coil rule, which is how the back door reopens');
});

test('⚠ the inline notice uses the shared predicate, so the cell cannot disagree with the save', () => {
  assert.ok(internal.includes('coilReplacementRecorded('),
    'the row notice must come from the same function the refusal does');
});

test('⚠ an OH declaration satisfies the empty-form guard, as Scrap does', () => {
  // A declared OH has no coil weight and no damage note BY DEFINITION, so the "nobody looked at this" guard
  // would otherwise refuse the new path on every job it is correct for.
  assert.ok(/const isDetermination = jobData\.condition === CONDITION_SCRAP \|\| jobData\.condition === CONDITION_OH;/
    .test(internal), 'the empty-form guard must accept an OH declaration as a determination');
});

test('⚠ the fields this rule reads are the fields the estimate prices from', () => {
  // The mirror is unavoidable - the estimate builder needs a DOM (pdfjs-dist) and cannot be imported here - so
  // the field NAMES are pinned against the estimate's own source. A rename on either side fails this.
  const estimate = readFileSync(new URL('../components/SingleJobEstimateReport.tsx', import.meta.url), 'utf8');
  for (const f of ['damR', 'damY', 'damB', 'wtOfCoil', 'totWt',
    'lvCoilR', 'lvCoilY', 'lvCoilB', 'wtOfCoilLv', 'totWtLv', 'totWtLvReIns']) {
    assert.ok(estimate.includes(f), `${f} is no longer read by the estimate - the mirror has drifted`);
  }
});

// ── ⚠⚠ 
