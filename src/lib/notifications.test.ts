// Tests for lib/notifications.ts (AUDIT G93). Run with `npm test`.
//
// These exercise the REAL predicates - isUnassigned, isIntakeOpen, otherActiveAts,
// atRatesReadiness, orderReferenceFor, unmatchedOilRows - which is why lib/tenderState.ts
// exists. Stubbing them would have tested the composition and left the rules unguarded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNotifications, sortNotifications, type NotificationInput } from './notifications';

const AGENCY = {
  id: 'ag1',
  name: 'MEGHA',
  // Everything missingForEstimate and missingForTaxInvoice ask for, so the agency itself is
  // quiet unless a test removes something.
  discomName: 'UGVCL', circleOfficeName: 'Mehsana', circleAuthority: 'The Superintending Engineer',
  discomGstin: '24AAACU1234A1Z5', discomAddress: 'Mehsana', divisionAuthority: 'The Executive Engineer',
  gstin: '24AAAAA0000A1Z5', pan: 'AAAAA0000A', address: 'Kadi',
};

const AT = (over: Record<string, unknown> = {}) => ({
  id: 'at1', agencyId: 'ag1', atNumber: '2026-28', status: 'Active', startDate: 20260401,
  ratesSource: 'own', orderNo: 'UGVCL/EE/1102', orderDate: '2026-04-16', ...over,
});

const base = (over: Partial<NotificationInput> = {}): NotificationInput => ({
  activeAgency: AGENCY,
  agencies: [AGENCY],
  agencyJobs: [],
  agencyOil: [],
  atMasters: [AT()],
  activeAtMaster: AT(),
  viewingAllTenders: false,
  workUnavailable: false,
  ...over,
});

const idsOf = (input: NotificationInput) => buildNotifications(input).items.map(i => i.id);
const find = (input: NotificationInput, id: string) =>
  buildNotifications(input).items.find(i => i.id === id);

// ---------------------------------------------------------------- the quiet case

test('a complete agency on a healthy tender raises nothing', () => {
  assert.deepEqual(idsOf(base()), []);
});

test('no agency means no notifications at all, not a crash', () => {
  assert.deepEqual(idsOf(base({ activeAgency: null })), []);
});

// ---------------------------------------------------------------- ⚠ the failed-load case

test('⚠ A FAILED WORK READ DOES NOT REPORT ZERO UNMATCHED OIL', () => {
  // The lists come back EMPTY on failure, so a naive count would say "all clear" over data
  // nobody could read. G70: a failure is never rendered as "nothing is wrong".
  const failed = base({ agencyJobs: [], agencyOil: [], workUnavailable: true });
  const out = buildNotifications(failed);
  assert.equal(out.workUnavailable, true);
  assert.equal(out.items.some(i => i.id === 'unmatched-oil'), false);
  assert.equal(out.items.some(i => i.id === 'unassigned-work'), false);
});

test('⚠ BUT TENDER FAULTS STILL REPORT WHEN THE WORK READ FAILED - they come from another load', () => {
  const failed = base({ atMasters: [AT({ ratesSource: '' })], activeAtMaster: AT({ ratesSource: '' }), workUnavailable: true });
  assert.equal(idsOf(failed).includes('ats-without-rates'), true);
});

// ---------------------------------------------------------------- the agency

test('an agency missing invoice fields cannot issue, and the item says which', () => {
  const item = find(base({ activeAgency: { ...AGENCY, gstin: '', pan: '' }, agencies: [] }), 'agency-details-missing');
  assert.ok(item);
  assert.equal(item!.tone, 'blocking');
  assert.match(item!.detail, /gstin/i);
});

test('two agencies wearing the same mark is reported once, naming the other', () => {
  // ⚠ THE MARK IS TWO DERIVED HALVES, AND A COLLISION NEEDS BOTH (agencyMark.ts:142-145):
  // the monogram follows the NAME, the colour follows the ID. A twin with a different name
  // and a different id collides on neither, which is why the first version of this test
  // expected an item the app would never raise. Chosen marks are used here so the fixture
  // states the collision outright instead of relying on two hashes agreeing.
  // ⚠ AND THE COLOUR MUST BE ONE MARK_COLOURS ACTUALLY LISTS (agencyMark.ts:52). A chosen
  // colour outside that set is rejected and BOTH agencies fall back to derivedColour(id),
  // which differs per agency - so an invented colour name silently un-collides the fixture.
  const mark = { monogram: 'ME', colour: 'emerald' };
  const item = find(base({
    activeAgency: { ...AGENCY, mark },
    agencies: [{ ...AGENCY, mark }, { ...AGENCY, id: 'ag2', name: 'MEHSANA ELECTRICALS', mark }],
  }), 'duplicate-agency-mark');
  assert.ok(item);
  assert.match(item!.detail, /MEHSANA ELECTRICALS/);
});

test('agencies with different names and ids do NOT collide - the common case', () => {
  // Across the twelve live agencies this fires zero times (agencyMark.ts:158-162). The item
  // exists for the thirteenth that shares two initials, not as standing furniture.
  const other = { ...AGENCY, id: 'ag2', name: 'UPENDRA' };
  assert.equal(idsOf(base({ agencies: [AGENCY, other] })).includes('duplicate-agency-mark'), false);
});

// ---------------------------------------------------------------- tenders

test('an agency with no tender is blocking, and links to the AT tab', () => {
  const item = find(base({ atMasters: [], activeAtMaster: null }), 'no-tender');
  assert.ok(item);
  assert.equal(item!.tone, 'blocking');
  assert.equal(item!.to, '/agency-settings?section=at');
});

test('a tender with no rates blocks, and one with rates does not', () => {
  assert.equal(idsOf(base({ atMasters: [AT({ ratesSource: '' })] })).includes('ats-without-rates'), true);
  assert.equal(idsOf(base()).includes('ats-without-rates'), false);
});

test('⚠ ANOTHER AGENCY\'S TENDERS ARE NOT COUNTED', () => {
  const foreign = AT({ id: 'at9', agencyId: 'OTHER', ratesSource: '' });
  assert.equal(idsOf(base({ atMasters: [AT(), foreign] })).includes('ats-without-rates'), false);
});

test('a missing order number or date is reported, and the wording says SEND not print', () => {
  const noNo = find(base({ atMasters: [AT({ orderNo: '' })] }), 'ats-without-order');
  assert.ok(noNo, 'a missing order number must report');
  // ⚠ O73: the refusal was narrowed to the send. Claiming it blocks printing would be false.
  assert.match(noNo!.detail, /cannot be sent/);
  assert.doesNotMatch(noNo!.detail, /cannot be printed/);
  assert.ok(find(base({ atMasters: [AT({ orderDate: '' })] }), 'ats-without-order'), 'a missing date too');
});

test('two tenders marked Active is reported; one is not', () => {
  const two = [AT(), AT({ id: 'at2', atNumber: '2024-26', startDate: 20240401 })];
  const item = find(base({ atMasters: two }), 'ats-both-active');
  assert.ok(item);
  assert.equal(item!.count, 2);
  assert.equal(idsOf(base()).includes('ats-both-active'), false);
});

test('a superseded tender reports as closed to new work', () => {
  const old = AT({ id: 'at2', atNumber: '2024-26', startDate: 20240401 });
  const item = find(base({ atMasters: [AT(), old], activeAtMaster: old }), 'intake-closed');
  assert.ok(item);
  assert.match(item!.title, /2024-26/);
});

test('⚠ "ALL TENDERS" IS A CHOICE, NOT A FAULT, AND IS NEVER REPORTED', () => {
  // isIntakeOpen refuses in this scope deliberately. Reporting it would pin a permanent
  // notification to the bell for a setting working exactly as intended.
  const all = base({ viewingAllTenders: true, activeAtMaster: null });
  assert.equal(idsOf(all).includes('intake-closed'), false);
});

// ---------------------------------------------------------------- the work

test('⚠ AN MR RAISED FOR OIL ALONE IS NEVER REPORTED AS A FAULT (AUDIT O78)', () => {
  // The division raises an MR for oil issue with no transformers on it. This is the live MR 8989 / MR 5585
  // shape that the deleted rule flagged on 100% of real oil.
  const input = base({
    agencyOil: [{ id: 'tx1', agencyId: 'ag1', mrNo: '8989', netLiters: 420, atId: 'at1' }],
    agencyJobs: [{ id: 'j1', agencyId: 'ag1', mrNo: '5545', atId: 'at1' }],
  });
  assert.deepEqual(idsOf(input), []);
});

test('a receipt recording NO MR number is reported, with the litres', () => {
  const input = base({
    agencyOil: [{ id: 'tx1', agencyId: 'ag1', mrNo: '   ', netLiters: 420, atId: 'at1' }],
  });
  const item = find(input, 'oil-without-mr');
  assert.ok(item);
  assert.equal(item!.count, 1);
  assert.match(item!.detail, /420/);
});

test('⚠ AND THE DETAIL DOES NOT CLAIM THE LITRES SIT IN NO TENDER\'S BALANCE', () => {
  // The old wording said exactly that, and it was false: the receipt carries an atId, so
  // computeOilBalance counts it. What IS true is that a blank mrNo drops out of the balance.
  const item = find(base({
    agencyOil: [{ id: 'tx1', agencyId: 'ag1', mrNo: ' ', netLiters: 10, atId: 'at1' }],
  }), 'oil-without-mr')!;
  assert.doesNotMatch(item.detail, /no tender's balance/);
  assert.doesNotMatch(item.title, /no transformers/);
});

test('⚠ JOBS AND OIL WITH NO TENDER ARE ONE ITEM, NOT THREE BANNERS', () => {
  const input = base({
    agencyJobs: [{ id: 'j1', agencyId: 'ag1', mrNo: '1' }, { id: 'j2', agencyId: 'ag1', mrNo: '2', atId: 'at1' }],
    agencyOil: [{ id: 'tx1', agencyId: 'ag1', mrNo: '1', netLiters: 10 }],
  });
  const item = find(input, 'unassigned-work');
  assert.ok(item);
  assert.equal(item!.count, 2, 'one job and one oil row');
  assert.match(item!.title, /1 job and 1 oil entry/);
});

test('⚠ UNASSIGNED WORK IS COUNTED AGENCY-WIDE, NOT WITHIN THE TENDER SCOPE', () => {
  // It is invisible in every scope - that is the reason it needs saying at all (F87).
  const jobs = [{ id: 'j1', agencyId: 'ag1', mrNo: '1' }];
  assert.equal(find(base({ agencyJobs: jobs }), 'unassigned-work')!.count, 1);
  assert.equal(find(base({ agencyJobs: jobs, viewingAllTenders: true }), 'unassigned-work')!.count, 1);
});

// ---------------------------------------------------------------- session notices

test('a superseded-tender notice and a pointer notice both surface', () => {
  const input = base({
    atSupersededNotice: { movedTo: '2026-28', wasOn: '2024-26' },
    agencyPointerNotice: 'The agency last used is no longer available.',
    globalConfigError: 'offline',
  });
  const ids = idsOf(input);
  assert.equal(ids.includes('at-superseded'), true);
  assert.equal(ids.includes('agency-pointer'), true);
  assert.equal(ids.includes('global-config-offline'), true);
});

// ---------------------------------------------------------------- signatures and order

test('⚠ THE SIGNATURE TRACKS THE FACT, SO A NEW OFFENDER UNDOES A DISMISSAL', () => {
  const one = find(base({ atMasters: [AT({ ratesSource: '' })] }), 'ats-without-rates')!;
  const two = find(base({
    atMasters: [AT({ ratesSource: '' }), AT({ id: 'at2', ratesSource: '' })],
  }), 'ats-without-rates')!;
  assert.notEqual(one.signature, two.signature);
});

test('the signature does NOT change when only the count of unrelated items changes', () => {
  const a = find(base({ atMasters: [AT({ ratesSource: '' })], agencyJobs: [{ id: 'j1', agencyId: 'ag1' }] }), 'ats-without-rates')!;
  const b = find(base({ atMasters: [AT({ ratesSource: '' })] }), 'ats-without-rates')!;
  assert.equal(a.signature, b.signature);
});

test('blocking items sort ahead of warnings, which sort ahead of information', () => {
  const input = base({
    activeAgency: { ...AGENCY, gstin: '', pan: '' },
    atMasters: [AT({ ratesSource: '', orderNo: '' })],
    atSupersededNotice: { movedTo: '2026-28', wasOn: '2024-26' },
  });
  const tones = sortNotifications(buildNotifications(input).items).map(i => i.tone);
  assert.deepEqual(tones, tones.slice().sort((x, y) =>
    ({ blocking: 0, warning: 1, info: 2 } as any)[x] - ({ blocking: 0, warning: 1, info: 2 } as any)[y]));
  assert.equal(tones[0], 'blocking');
});

test('every item carries an id, a route and a signature - the panel relies on all three', () => {
  const input = base({
    activeAgency: { ...AGENCY, gstin: '' },
    atMasters: [AT({ ratesSource: '', orderNo: '' }), AT({ id: 'at2', startDate: 20240401 })],
    agencyJobs: [{ id: 'j1', agencyId: 'ag1', mrNo: '1' }],
    agencyOil: [{ id: 'tx1', agencyId: 'ag1', mrNo: '9999', netLiters: 5 }],
    agencyPointerNotice: 'x',
  });
  const items = buildNotifications(input).items;
  assert.ok(items.length >= 5, `expected several items, got ${items.length}`);
  const seen = new Set<string>();
  for (const i of items) {
    assert.ok(i.id && i.to && i.signature, `${i.id} is missing a field`);
    assert.equal(seen.has(i.id), false, `duplicate id ${i.id}`);
    seen.add(i.id);
  }
});
