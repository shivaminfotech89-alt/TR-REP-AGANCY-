// Tests for lib/adminAgencyFilter.ts (AUDIT G73). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countContents, holdsNothing, matchesSearch, statusCounts, filterAgencies,
  type AgencyLike,
} from './adminAgencyFilter';
import type { SubscriptionRecord } from './subscriptionStatus';

const NOW = Date.UTC(2026, 8, 12);
const YEAR = 365 * 24 * 60 * 60 * 1000;

const agencies: AgencyLike[] = [
  { id: 'a1', name: 'MEGHA', email: 'megha@example.com', gstin: '24AAAAA0000A1Z5', ownerId: 'o1' },
  { id: 'a2', name: 'Narayan Transformer', ownerId: 'o2' },
  { id: 'a3', name: 'ZENITH TRANSFORMERS', ownerId: 'o3' },
];
const ats = [{ agencyId: 'a1' }, { agencyId: 'a1' }, { agencyId: 'a3' }];
const jobs = [{ agencyId: 'a1' }, { agencyId: 'a1' }, { agencyId: 'a1' }];
const contentsOf = (id: string) => countContents(id, ats, jobs);

const subs: Record<string, SubscriptionRecord> = {
  a1: { status: 'active', planAmount: 5900, expiryDate: NOW + YEAR, lastPaymentDate: NOW, razorpayPaymentId: 'pay_x' } as SubscriptionRecord,
  a2: { status: 'admin', expiryDate: null } as SubscriptionRecord,
  a3: { status: 'granted', expiryDate: NOW + YEAR } as SubscriptionRecord,
};

// ---------------------------------------------------------------- contents

test('contents counts the ATs and jobs under one agency', () => {
  assert.deepEqual(countContents('a1', ats, jobs), { ats: 2, jobs: 3 });
  assert.deepEqual(countContents('a3', ats, jobs), { ats: 1, jobs: 0 });
  assert.deepEqual(countContents('a2', ats, jobs), { ats: 0, jobs: 0 });
});

test('"holds nothing" means no AT and no job - an AT alone still counts as holding something', () => {
  assert.equal(holdsNothing({ ats: 0, jobs: 0 }), true);
  assert.equal(holdsNothing({ ats: 1, jobs: 0 }), false, 'any AT blocks, empty or not');
  assert.equal(holdsNothing({ ats: 0, jobs: 1 }), false);
});

// ---------------------------------------------------------------- search

test('search matches name, contact email, GSTIN, owner email and the document id', () => {
  assert.equal(matchesSearch(agencies[0], undefined, 'megh'), true);
  assert.equal(matchesSearch(agencies[0], undefined, 'MEGHA@EXAMPLE'), true);
  assert.equal(matchesSearch(agencies[0], undefined, '24aaaaa'), true);
  assert.equal(matchesSearch(agencies[0], undefined, 'a1'), true);
  assert.equal(matchesSearch(agencies[1], 'shivaminfotech89@gmail.com', 'shivam'), true);
  assert.equal(matchesSearch(agencies[1], undefined, 'zenith'), false);
});

test('an empty or blank search matches everything', () => {
  assert.equal(matchesSearch(agencies[2], undefined, ''), true);
  assert.equal(matchesSearch(agencies[2], undefined, '   '), true);
});

// ---------------------------------------------------------------- status counts

test('status counts group the list by classification', () => {
  const counts = statusCounts(agencies, subs, NOW);
  assert.ok(counts);
  assert.equal(counts.active, 1);
  assert.equal(counts.admin, 1);
  assert.equal(counts.granted, 1);
  assert.equal(counts.none, 0);
});

test('⚠ counts are null when the subscriptions could not be read, never seventeen NOT BILLED', () => {
  assert.equal(statusCounts(agencies, null, NOW), null);
});

// ---------------------------------------------------------------- the filter

const filter = (over: Partial<Parameters<typeof filterAgencies>[0]> = {}) => filterAgencies({
  agencies, subsByAgency: subs, contentsOf, term: '', status: 'ALL', onlyEmpty: false, now: NOW, ...over,
}).map(a => a.id);

test('no filter returns everything', () => {
  assert.deepEqual(filter(), ['a1', 'a2', 'a3']);
});

test('"holds nothing" narrows to the agencies with no AT and no job', () => {
  assert.deepEqual(filter({ onlyEmpty: true }), ['a2']);
});

test('a status filter narrows to that classification', () => {
  assert.deepEqual(filter({ status: 'granted' }), ['a3']);
  assert.deepEqual(filter({ status: 'active' }), ['a1']);
  assert.deepEqual(filter({ status: 'none' }), []);
});

test('search and the other filters combine', () => {
  assert.deepEqual(filter({ term: 'transformer' }), ['a2', 'a3']);
  assert.deepEqual(filter({ term: 'transformer', onlyEmpty: true }), ['a2']);
  assert.deepEqual(filter({ term: 'transformer', status: 'granted' }), ['a3']);
});

test('⚠ a status filter hides nothing while the subscriptions are unread', () => {
  assert.deepEqual(
    filterAgencies({ agencies, subsByAgency: null, contentsOf, term: '', status: 'granted', onlyEmpty: false, now: NOW }).map(a => a.id),
    ['a1', 'a2', 'a3'],
  );
});

test('the owner email is searchable when the panel can supply one', () => {
  const ownerEmailOf = (a: AgencyLike) => (a.ownerId === 'o2' ? 'shivaminfotech89@gmail.com' : undefined);
  assert.deepEqual(filter({ term: 'shivaminfotech', ownerEmailOf }), ['a2']);
});
