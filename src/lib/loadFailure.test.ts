// Tests for lib/loadFailure.ts (AUDIT G70). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agencyGate, describeLoadFailure, type AgenciesLoad } from './loadFailure';

/** ⚠ `loadedAt` IS NOT PART OF THE GATE (AUDIT G110). It records when a read last succeeded, for the staleness
 *  line; `agencyGate` has never consulted it and must not start. This helper keeps these cases about the gate. */
const load = (status: AgenciesLoad['status'], error: string | null = null): AgenciesLoad =>
  ({ status, error, loadedAt: null });

test('a failed load is never "no agency"', () => {
  assert.equal(agencyGate(load('failed', 'x'), false), 'failed');
});

test('a load still running says nothing about emptiness', () => {
  assert.equal(agencyGate(load('loading'), false), 'loading');
});

test('only a load that succeeded and found nothing is "no agency"', () => {
  assert.equal(agencyGate(load('loaded'), false), 'no-agency');
});

test('an agency in hand is ready, whatever the load says', () => {
  for (const status of ['loading', 'loaded', 'failed'] as const) {
    assert.equal(agencyGate(load(status), true), 'ready', status);
  }
});

test('the quota refusal of 2026-09-12 is named as a usage limit, not as missing data', () => {
  const text = describeLoadFailure({ code: 'resource-exhausted', message: 'Quota limit exceeded.' });
  assert.match(text, /daily usage limit/);
  assert.doesNotMatch(text, /no agenc|not found|deleted/i);
});

test('connection, permission and unknown failures each say what happened', () => {
  assert.match(describeLoadFailure({ code: 'unavailable' }), /could not be reached/);
  assert.match(describeLoadFailure({ code: 'permission-denied' }), /refused/);
  assert.equal(describeLoadFailure({ code: 'internal', message: 'boom' }), 'The database returned an error (internal): boom.');
  assert.equal(describeLoadFailure(new Error('offline')), 'The database returned an error: offline.');
});
