// Tests for lib/allotments.ts (AUDIT G72). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  editLetter, deleteLetter, bookedFor, drawsOnAllotment, lettersTotal, quotaFor,
  type AllotmentLetter, type QuotaMap,
} from './allotments';

const letters = (): AllotmentLetter[] => [
  { id: 'a', date: '2026-04-01', letterNo: '12121', division: 'SABARMATI', coreType: 'CRGO', quantity: 10 },
  { id: 'b', date: '2026-05-01', letterNo: '5454', division: 'SABARMATI', coreType: 'CRGO', quantity: 5 },
  { id: 'c', date: '2026-06-01', letterNo: '1568', division: 'SABARMATI', coreType: 'CRGO', quantity: 10 },
  { id: 'd', date: '2026-06-02', letterNo: 'dffddf', division: 'KALOL', coreType: 'CRGO', quantity: 10 },
];
/** MEGHA's live shape: the map says 30 where the letters total 25. See the header of allotments.ts. */
const map = (): QuotaMap => ({ SABARMATI: { CRGO: 30 }, KALOL: { CRGO: 10 } });
const noneBooked = () => 0;

// ---------------------------------------------------------------- ⚠ delta, never rebuild

test('a correction moves the quota by the difference, and does not rebuild it from the letters', () => {
  const out = editLetter({ history: letters(), allotments: map(), id: 'a', patch: { quantity: 4 }, booked: noneBooked });
  assert.ok(out.ok);
  // 30 - 6 = 24. A rebuild would have produced the letters' total (19) and silently cut 5 nobody asked about.
  assert.equal(quotaFor(out.allotments, 'SABARMATI', 'CRGO'), 24);
  assert.equal(lettersTotal(out.allotmentHistory, 'SABARMATI', 'CRGO'), 19);
  assert.notEqual(quotaFor(out.allotments, 'SABARMATI', 'CRGO'), lettersTotal(out.allotmentHistory, 'SABARMATI', 'CRGO'));
});

test('a deletion also moves by the delta, leaving the rest of the map alone', () => {
  const out = deleteLetter({ history: letters(), allotments: map(), id: 'b', booked: noneBooked });
  assert.ok(out.ok);
  assert.equal(quotaFor(out.allotments, 'SABARMATI', 'CRGO'), 25);
  assert.equal(quotaFor(out.allotments, 'KALOL', 'CRGO'), 10);
  assert.equal(out.allotmentHistory.length, 3);
});

test('the caller’s map and history are never mutated', () => {
  const m = map(), h = letters();
  editLetter({ history: h, allotments: m, id: 'a', patch: { quantity: 1 }, booked: noneBooked });
  deleteLetter({ history: h, allotments: m, id: 'a', booked: noneBooked });
  assert.equal(m.SABARMATI.CRGO, 30);
  assert.equal(h.length, 4);
  assert.equal(h[0].quantity, 10);
});

// ---------------------------------------------------------------- ⚠ the floor: never below what is booked

test('an edit that would drop the quota below what is booked is refused, naming both figures', () => {
  // 30 - (10 - 1) = 21, against 26 booked.
  const booked = (d: string, c: string) => (d === 'SABARMATI' && c === 'CRGO' ? 26 : 0);
  const out = editLetter({ history: letters(), allotments: map(), id: 'a', patch: { quantity: 1 }, booked });
  assert.equal(out.ok, false);
  assert.match((out as any).reason, /would leave the CRGO quota for SABARMATI at 21/);
  assert.match((out as any).reason, /26 jobs are already booked/);
  assert.match((out as any).reason, /Reduce it to 26 or more/);
});

test('landing exactly on what is booked is allowed - the floor refuses only below it', () => {
  const booked = (d: string, c: string) => (d === 'SABARMATI' && c === 'CRGO' ? 21 : 0);
  const exact = editLetter({ history: letters(), allotments: map(), id: 'a', patch: { quantity: 1 }, booked });
  assert.ok(exact.ok, '30 - 9 = 21, equal to what is booked');
  assert.equal(quotaFor(exact.allotments, 'SABARMATI', 'CRGO'), 21);
});

test('a deletion that would drop below what is booked is refused, naming both figures', () => {
  const booked = (d: string, c: string) => (d === 'SABARMATI' && c === 'CRGO' ? 21 : 0);
  const out = deleteLetter({ history: letters(), allotments: map(), id: 'c', booked });
  assert.equal(out.ok, false);
  assert.match((out as any).reason, /would leave the CRGO quota for SABARMATI at 20, but 21 jobs are already booked/);
});

test('a deletion with nothing booked under it succeeds even though the tender has other jobs', () => {
  const booked = (d: string, c: string) => (d === 'SABARMATI' && c === 'CRGO' ? 21 : 0);
  const out = deleteLetter({ history: letters(), allotments: map(), id: 'd', booked });
  assert.ok(out.ok, 'KALOL has no bookings - the AT-delete rule would have refused this, and would be wrong to');
  assert.equal(quotaFor(out.allotments, 'KALOL', 'CRGO'), 0);
});

test('one job booked reads as "1 job is", not "1 jobs are"', () => {
  const out = deleteLetter({ history: letters(), allotments: map(), id: 'd', booked: () => 1 });
  assert.match((out as any).reason, /1 job is already booked/);
});

// ---------------------------------------------------------------- moving a letter to the right division

test('moving a letter takes the quantity off the old division and adds it to the new one', () => {
  const out = editLetter({
    history: letters(), allotments: map(), id: 'd',
    patch: { division: 'DAEESA-1' }, booked: noneBooked,
  });
  assert.ok(out.ok);
  assert.equal(quotaFor(out.allotments, 'KALOL', 'CRGO'), 0);
  assert.equal(quotaFor(out.allotments, 'DAEESA-1', 'CRGO'), 10);
  assert.match(out.summary, /KALOL\/CRGO -> DAEESA-1\/CRGO/);
});

test('the floor is checked on the division that LOSES the quota', () => {
  const booked = (d: string) => (d === 'KALOL' ? 6 : 0);
  const out = editLetter({ history: letters(), allotments: map(), id: 'd', patch: { division: 'DAEESA-1' }, booked });
  assert.equal(out.ok, false);
  assert.match((out as any).reason, /leave the CRGO quota for KALOL at 0, but 6 jobs are already booked/);
});

test('a core type can be corrected the same way', () => {
  const out = editLetter({ history: letters(), allotments: map(), id: 'd', patch: { coreType: 'Wound Core' }, booked: noneBooked });
  assert.ok(out.ok);
  assert.equal(quotaFor(out.allotments, 'KALOL', 'CRGO'), 0);
  assert.equal(quotaFor(out.allotments, 'KALOL', 'Wound Core'), 10);
});

// ---------------------------------------------------------------- the letter's own fields

test('the letter number and date can be corrected without touching any quota', () => {
  const out = editLetter({
    history: letters(), allotments: map(), id: 'b',
    patch: { letterNo: '5454/A', date: '2026-05-02' }, booked: noneBooked,
  });
  assert.ok(out.ok);
  assert.equal(quotaFor(out.allotments, 'SABARMATI', 'CRGO'), 30);
  assert.equal(out.allotmentHistory[1].letterNo, '5454/A');
  assert.match(out.summary, /letter 5454 -> 5454\/A/);
});

test('an empty reference, a missing date, or a quantity below one is refused', () => {
  for (const patch of [{ letterNo: '  ' }, { date: '' }, { quantity: 0 }, { quantity: -3 }, { quantity: 2.5 }]) {
    const out = editLetter({ history: letters(), allotments: map(), id: 'a', patch, booked: noneBooked });
    assert.equal(out.ok, false, JSON.stringify(patch));
  }
});

test('an edit that changes nothing, and one for a letter that is gone, are both refused', () => {
  assert.equal(editLetter({ history: letters(), allotments: map(), id: 'a', patch: { quantity: 10 }, booked: noneBooked }).ok, false);
  assert.equal(editLetter({ history: letters(), allotments: map(), id: 'zz', patch: { quantity: 1 }, booked: noneBooked }).ok, false);
  assert.equal(deleteLetter({ history: letters(), allotments: map(), id: 'zz', booked: noneBooked }).ok, false);
});

test('a quota already lower than its own letter refuses rather than going negative', () => {
  const broken: QuotaMap = { SABARMATI: { CRGO: 3 } };
  const out = deleteLetter({ history: letters(), allotments: broken, id: 'a', booked: noneBooked });
  assert.equal(out.ok, false);
  assert.match((out as any).reason, /quota and the letters disagree/);
});

// ---------------------------------------------------------------- one definition of "draws on the allotment"

test('GP rework and Overhauling draw no quota; an OGP job does', () => {
  assert.equal(drawsOnAllotment({ coreType: 'CRGO', repairType: 'OGP' }), true);
  assert.equal(drawsOnAllotment({ coreType: 'CRGO', repairType: 'GP' }), false, 'the Dashboard counted these - AUDIT G72');
  assert.equal(drawsOnAllotment({ coreType: 'CRGO', repairType: 'OH' }), false);
  assert.equal(drawsOnAllotment({ coreType: 'OH', repairType: 'OGP' }), false);
  assert.equal(drawsOnAllotment({ repairType: 'OGP' }), true, 'a missing core type counts as CRGO');
});

test('bookedFor counts one division, core type and AGENCY, by that same rule', () => {
  const jobs = [
    { division: 'SABARMATI', coreType: 'CRGO', repairType: 'OGP', agencyId: 'megha' },
    { division: 'SABARMATI', coreType: 'CRGO', repairType: 'GP', agencyId: 'megha' },
    { division: 'SABARMATI', coreType: 'Amorphous', repairType: 'OGP', agencyId: 'megha' },
    { division: 'KALOL', coreType: 'CRGO', repairType: 'OGP', agencyId: 'megha' },
    { division: 'SABARMATI', repairType: 'OGP', agencyId: 'megha' },
  ];
  const megha = (division: string, coreType: string) =>
    bookedFor(jobs, { division, coreType, agencyId: 'megha' });
  assert.equal(megha('SABARMATI', 'CRGO'), 2);
  assert.equal(megha('SABARMATI', 'Amorphous'), 1);
  assert.equal(megha('KALOL', 'CRGO'), 1);
});

test('⚠ MSBT-5: another agency job on this tender is not counted (AUDIT G116)', () => {
  // The live case. AARATI's MSBT-5 carries MEGHA's AT, so a count scoped by owner and tender alone made it
  // MEGHA's 21st SABARMATI/CRGO job - against MEGHA's quota of 30, on work MEGHA never did.
  const jobs = [
    { jobNo: 'MSBT-20', division: 'SABARMATI', coreType: 'CRGO', repairType: 'OGP', agencyId: 'megha' },
    { jobNo: 'MSBT-5', division: 'SABARMATI', coreType: 'CRGO', repairType: 'OGP', agencyId: 'aarati' },
  ];
  assert.equal(bookedFor(jobs, { division: 'SABARMATI', coreType: 'CRGO', agencyId: 'megha' }), 1);
  assert.equal(bookedFor(jobs, { division: 'SABARMATI', coreType: 'CRGO', agencyId: 'aarati' }), 1);
});

test('⚠ a scrap job does not count as booked, including one scrap ONLY in its inspection', () => {
  // ASU-2's shape: the job document says nothing, the internal inspection says Scrap (O80).
  const jobs = [
    { id: 'a', jobNo: 'SU-1', division: 'DEESA', coreType: 'CRGO', repairType: 'OGP', agencyId: 'ag' },
    { id: 'b', jobNo: 'SU-2', division: 'DEESA', coreType: 'CRGO', repairType: 'OGP', agencyId: 'ag', condition: 'Scrap' },
    { id: 'c', jobNo: 'SU-3', division: 'DEESA', coreType: 'CRGO', repairType: 'OGP', agencyId: 'ag', status: 'Dispatched' },
  ];
  const inspections = [{ jobId: 'c', type: 'Internal', data: { condition: 'Scrap' } }];
  const scope = { division: 'DEESA', coreType: 'CRGO', agencyId: 'ag' };
  assert.equal(bookedFor(jobs, scope), 2, 'without inspections the inspection-only scrap still counts');
  assert.equal(bookedFor(jobs, { ...scope, inspections }), 1, 'with them, only the repaired unit does');
});

// ── ⚠⚠ THE OH EXCLUSION'S INSPECTION ARM, AT THE COUNTING BOUNDARY (AUDIT G122) ──────────────────────────────

test('⚠⚠ a job overhauled only in its inspection does NOT draw on allotment', () => {
  // The hole this closes. Before the third arm, drawsOnAllotment read `repairType` alone and this job consumed
  // quota it did not earn - the agency silently losing a job it was entitled to.
  const job = { id: 'j9', jobNo: 'SU-9', division: 'DEESA', coreType: 'CRGO', repairType: 'OGP', agencyId: 'ag' };
  const insp = [{ jobId: 'j9', type: 'Internal', data: { condition: 'OH' } }];
  assert.equal(drawsOnAllotment(job), true, 'the job record alone says it is an ordinary repair');
  assert.equal(drawsOnAllotment(job, insp), false, 'the inspection says it was overhauled');
});

test('a job overhauled by its condition alone does not draw either', () => {
  const job = { id: 'j9', division: 'DEESA', coreType: 'CRGO', repairType: 'OGP', condition: 'OH', agencyId: 'ag' };
  assert.equal(drawsOnAllotment(job), false);
});

test('⚠ bookedFor sees it too - the count, not just the predicate', () => {
  const jobs = [
    { id: 'a', jobNo: 'SU-1', division: 'DEESA', coreType: 'CRGO', repairType: 'OGP', agencyId: 'ag' },
    { id: 'b', jobNo: 'SU-2', division: 'DEESA', coreType: 'CRGO', repairType: 'OGP', agencyId: 'ag' },
  ];
  const scope = { division: 'DEESA', coreType: 'CRGO', agencyId: 'ag' };
  assert.equal(bookedFor(jobs, scope), 2);
  assert.equal(bookedFor(jobs, { ...scope, inspections: [{ jobId: 'b', type: 'Internal', data: { condition: 'OH' } }] }), 1);
});

test('⚠ and the separately-issued OH MR is still excluded by its own test, not by the arms', () => {
  // coreType 'OH' is the sr-21 path: no allotment at all. It must keep working with no inspection in hand.
  const job = { id: 'oh1', division: 'DEESA', coreType: 'OH', repairType: 'OGP', agencyId: 'ag' };
  assert.equal(drawsOnAllotment(job), false);
  assert.equal(drawsOnAllotment(job, []), false);
});
