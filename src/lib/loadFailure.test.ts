// Tests for lib/loadFailure.ts (AUDIT G70). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agencyGate, describeLoadFailure } from './loadFailure';

test('a failed load is never "no agency"', () => {
  assert.equal(agencyGate({ status: 'failed', error: 'x' }, false), 'failed');
});

test('a load still running says nothing about emptiness', () => {
  assert.equal(agencyGate({ status: 'loading', error: null }, false), 'loading');
});

test('only a load that succeeded and found nothing is "no agency"', () => {
  assert.equal(agencyGate({ status: 'loaded', error: null }, false), 'no-agency');
});

test('an agency in hand is ready, whatever the load says', () => {
  for (const status of ['loading', 'loaded', 'failed'] as const) {
    assert.equal(agencyGate({ status, error: null }, true), 'ready', status);
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
