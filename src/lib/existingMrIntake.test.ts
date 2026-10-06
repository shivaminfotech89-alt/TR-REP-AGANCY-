// Tests for existingMrIntake in lib/tenderState.ts - adding a unit to an MR that exists (AUDIT G107).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { existingMrIntake, isIntakeOpen } from './tenderState';

const at = (over: Record<string, unknown> = {}) =>
  ({ id: 'at1', agencyId: 'ag1', atNumber: 'AT 26-27', status: 'Active', startDate: 100, ...over }) as any;

// ── ⚠ Superseded is allowed; Closed is not ───────────────────────────────────────────────────────────────────

test('⚠ a superseded but ACTIVE tender still takes units - the division is still reading its paperwork', () => {
  // This is the whole point of the change. MEGHA's AT 26-27 is Active and not current, and ten MRs sit on it.
  const gate = existingMrIntake(at({ status: 'Active' }));
  assert.equal(gate.open, true);
});

test('a Closed tender refuses, and names the MR tender rather than the session one', () => {
  const gate = existingMrIntake(at({ status: 'Closed', atNumber: 'AT 2026_27' }));
  assert.equal(gate.open, false);
  assert.match(gate.reason, /AT 2026_27/, 'the refusal names the tender the MR belongs to');
  assert.match(gate.reason, /this MR belongs to/);
});

test('status is read case-insensitively, as everywhere else', () => {
  for (const s of ['Closed', 'closed', 'CLOSED']) {
    assert.equal(existingMrIntake(at({ status: s })).open, false, s);
  }
});

test('an unlabelled tender falls back to its name, then its id', () => {
  assert.match(existingMrIntake(at({ status: 'Closed', atNumber: '', name: 'Spring' })).reason, /Spring/);
  assert.match(existingMrIntake(at({ status: 'Closed', atNumber: '', name: '' })).reason, /at1/);
});

test('no tender at all refuses rather than allowing', () => {
  assert.equal(existingMrIntake(null).open, false);
  assert.equal(existingMrIntake(undefined).open, false);
});

// ── ⚠ It must NOT behave like isIntakeOpen, which is the defect ──────────────────────────────────────────────

test('⚠ it does not consult the session, a current tender, or a scope', () => {
  // isIntakeOpen needs the agency's whole AT list to decide what supersedes what. This takes one tender and
  // nothing else - there is no parameter through which the session could reach it.
  assert.equal(existingMrIntake.length, 1, 'one argument: the MR own tender');
});

test('⚠ the two rules genuinely differ on the case that caused this', () => {
  // One Active tender superseded by a newer Active one. New work belongs to the newer; an existing MR does not.
  const older = at({ id: 'old', atNumber: 'AT 26-27', startDate: 100 });
  const newer = at({ id: 'new', atNumber: 'AT 1819', startDate: 200 });
  const forNewWork = isIntakeOpen(older, [older, newer]);
  assert.equal(forNewWork.open, false, 'new work still belongs to the current tender');
  assert.match(forNewWork.reason, /superseded/);
  assert.equal(existingMrIntake(older).open, true, 'but a unit may still be added to an MR already on it');
});

// ── The screen must ask the MR question, not the session one ─────────────────────────────────────────────────

const ledger = readFileSync(new URL('../components/MrLedger.tsx', import.meta.url), 'utf8');

test('⚠ MrLedger no longer gates adding on the session tender', () => {
  assert.ok(!ledger.includes('isIntakeOpen('), 'the session gate is back in the add-unit path');
  // ⚠ THE CALL MOVED, AND THAT IS THE IMPROVEMENT (AUDIT G112). This asserted `existingMrIntake(` appeared in the
  // COMPONENT, which pinned the rule to a place no test could reach - the reason G111's composition was never run.
  // The gate now lives in lib/mrAddDecision, which calls it, and the component delegates.
  assert.ok(ledger.includes('mrAddDecision({'), 'the component must delegate to the shared decision');
  const decision = readFileSync(new URL('./mrAddDecision.ts', import.meta.url), 'utf8');
  assert.ok(decision.includes('existingMrIntake('), 'the MR gate is not used by the decision');
});

test('⚠ the control and the handler ask the SAME gate', () => {
  // G3's fault in a new form: the refusal shown and the refusal applied were computed from different things.
  assert.ok(ledger.split('mrAddGate()').length - 1 >= 3,
    'the handler and the control must both call mrAddGate');
});

test('the fifth case has a message, and it blames the record rather than the operator', () => {
  // Also moved to lib/mrAddDecision with the rest of the decision, where mrAddDecision.test.ts asserts it fires on
  // AARATI MR 12's shape rather than merely existing in the source.
  const decision = readFileSync(new URL('./mrAddDecision.ts', import.meta.url), 'utf8');
  const i = decision.indexOf('stamped with a tender that does not belong to');
  assert.ok(i > 0, 'the mis-stamped case has no message');
  const msg = decision.slice(i, i + 700);
  assert.match(msg, /fault in the record rather than anything done on this screen/);
  assert.match(msg, /find-misattached-at-console/, 'it must point at what actually fixes it');
  assert.match(msg, /can still be edited/, 'it must say what is still possible');
});
