// Tests for lib/subscriptionExtension.ts (AUDIT G100). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewExtension, formatExpiry, DAY_MS } from './subscriptionExtension';

// ZENITH TRANSFORMERS, as the document held it: the 18-month grant ended 10 Mar 2028 07:22:02.854.
const GRANT_END = Date.UTC(2028, 2, 10, 7, 22, 2, 854);
const TODAY = Date.UTC(2026, 8, 16, 15, 43, 9, 768);

test('⚠ an expiry still ahead is EXTENDED from, not replaced', () => {
  const p = previewExtension(GRANT_END, 365, TODAY)!;
  assert.equal(p.extendsFromExisting, true);
  assert.equal(formatExpiry(p.newExpiry), '10 Mar 2029');
});

test('⚠ the ZENITH record: three 365-day additions on the grant reach 10 Mar 2031', () => {
  // The document showed 10 Mar 2031 - exactly 1095 days past the grant. Each extension starts where
  // the last ended, which is why no single form looked wrong and the total was never shown.
  let exp = GRANT_END;
  for (let i = 0; i < 3; i++) exp = previewExtension(exp, 365, TODAY)!.newExpiry;
  assert.equal(formatExpiry(exp), '10 Mar 2031');
  assert.equal((exp - GRANT_END) / DAY_MS, 1095);
});

test('an expiry already past starts the new period from now', () => {
  const past = TODAY - 10 * DAY_MS;
  const p = previewExtension(past, 30, TODAY)!;
  assert.equal(p.extendsFromExisting, false);
  assert.equal(p.newExpiry, TODAY + 30 * DAY_MS);
});

test('no subscription at all starts from now and reports no current expiry', () => {
  const p = previewExtension(null, 365, TODAY)!;
  assert.equal(p.currentExpiry, null);
  assert.equal(p.extendsFromExisting, false);
});

test('an invalid day count produces no preview rather than a wrong date', () => {
  assert.equal(previewExtension(GRANT_END, 0, TODAY), null);
  assert.equal(previewExtension(GRANT_END, NaN, TODAY), null);
  assert.equal(previewExtension(GRANT_END, -5, TODAY), null);
});

test('days are rounded exactly as the server rounds them', () => {
  assert.equal(previewExtension(GRANT_END, 1.4, TODAY)!.newExpiry, GRANT_END + DAY_MS);
});

test('a date is written with a month name, never as an ambiguous number', () => {
  assert.equal(formatExpiry(GRANT_END), '10 Mar 2028');
  assert.equal(formatExpiry(null), 'none');
});
