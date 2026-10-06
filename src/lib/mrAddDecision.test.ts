// Tests for lib/mrAddDecision.ts - may a unit be added to this MR? (AUDIT G112). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { latestMrInDivision, mrAddDecision, resolveMrAt, type MrSummary } from './mrAddDecision';
import { mrEditJob } from './mrEditDraft';

/**
 * ⚠ THE WHOLE POINT: A STORED JOB, THROUGH THE REAL MAPPING, INTO THE REAL GATE.
 *
 * G111 shipped a feature that had never worked once, because every check tested a piece. `existingMrIntake` had
 * unit tests and passed. `atForEditingMr`'s arms were correct. The mapping between them dropped `atId`, so the
 * composition answered "no AT on any job" for every MR in the app - and nothing ran the composition.
 *
 * So these fixtures are STORED job shapes, they go through `mrEditJob` exactly as the dialog does, and the result
 * goes into `mrAddDecision` exactly as the gate does. Nothing is hand-built in the draft shape; that is what hid it.
 */
const storedJob = (over: Record<string, unknown> = {}) => ({
  id: 'j1', jobNo: 'SU-11', capacityKva: 63, make: 'FGFG', serialNo: '23132', coreType: 'CRGO',
  status: 'Received', division: 'DEESA', repairType: 'OGP', atId: 'at-admin-active', ...over,
});

const ADMIN_ATS = [
  { id: 'at-admin-active', agencyId: 'ag-admin', atNumber: '2026-28/AT/1819', status: 'Active' },
  { id: 'at-admin-closed', agencyId: 'ag-admin', atNumber: '2026_27', status: 'Closed' },
  { id: 'at-megha', agencyId: 'ag-megha', atNumber: 'AT 26-27', status: 'Active' },
];

/**
 * The dialog's own path: stored jobs -> drafts -> the gate.
 *
 * By default the MR under test IS the latest in its division, so these cases isolate the tender arms. The
 * latest-MR rule has its own section below, where the summaries are set deliberately.
 */
const decide = (stored: Record<string, unknown>[], mrNo = '45645', mrs?: MrSummary[]) =>
  mrAddDecision({
    mrNo,
    jobs: stored.map(mrEditJob),
    agencyAts: ADMIN_ATS,
    agencyId: 'ag-admin',
    agencyName: 'ADMIN',
    division: 'DEESA',
    agencyMrs: mrs ?? [{ mrNo, division: 'DEESA', createdAt: 100, allCancelled: false }],
  });

// ── ⚠ THE CASE THAT WAS BROKEN IN PRODUCTION ─────────────────────────────────────────────────────────────────

test('⚠ ADMIN MR 45645: one stored job on an Active same-agency AT - the control OPENS', () => {
  // The reported case. Before G111 this answered "none of its 1 transformer(s) carries one".
  const d = decide([storedJob()]);
  assert.equal(d.open, true, d.open ? '' : `refused with: ${d.reason}`);
  assert.equal(d.open && d.atId, 'at-admin-active', 'and it names the tender the save will stamp');
});

test('⚠ it stays open through the mapping, which is the link that broke', () => {
  // Spelled out: the draft must carry atId, or the gate cannot see it however correct the gate is.
  const draft = mrEditJob(storedJob());
  assert.equal(draft.atId, 'at-admin-active');
  assert.equal(mrAddDecision({ mrNo: '1', jobs: [draft], agencyAts: ADMIN_ATS, agencyId: 'ag-admin',
    division: 'DEESA', agencyMrs: [{ mrNo: '1', division: 'DEESA', createdAt: 1, allCancelled: false }] }).open, true);
});

test('ten stored jobs all on one Active AT also open - MR 1154s shape', () => {
  const jobs = Array.from({ length: 10 }, (_, i) => storedJob({ id: `j${i}`, jobNo: `ZBP-${i + 1}` }));
  assert.equal(decide(jobs, '1154').open, true);
});

// ── The four refusals, each by the data that causes it ───────────────────────────────────────────────────────

test('no AT on any job refuses, and counts them', () => {
  const d = decide([storedJob({ atId: '' }), storedJob({ id: 'j2', atId: undefined })]);
  assert.equal(d.open, false);
  assert.match(d.open ? '' : d.reason, /none of its 2 transformer\(s\) carries one/);
});

test('partly unstamped refuses, and says how many', () => {
  const d = decide([storedJob(), storedJob({ id: 'j2', atId: '' }), storedJob({ id: 'j3', atId: '' })]);
  assert.equal(d.open, false);
  assert.match(d.open ? '' : d.reason, /partly unstamped - 2 of its 3/);
});

test('two different ATs refuses, and names the count', () => {
  const d = decide([storedJob(), storedJob({ id: 'j2', atId: 'at-admin-closed' })]);
  assert.equal(d.open, false);
  assert.match(d.open ? '' : d.reason, /sit under 2 DIFFERENT ATs/);
});

test('⚠ a Closed tender refuses and names ITS OWN tender, not the session one', () => {
  const d = decide([storedJob({ atId: 'at-admin-closed' })]);
  assert.equal(d.open, false);
  assert.match(d.open ? '' : d.reason, /2026_27/);
  assert.match(d.open ? '' : d.reason, /marked Closed/);
});

test("⚠ AARATI MR 12's shape: an AT belonging to another agency refuses as mis-stamped", () => {
  const d = decide([storedJob({ jobNo: 'MSBT-5', atId: 'at-megha' })], '12');
  assert.equal(d.open, false);
  const reason = d.open ? '' : d.reason;
  assert.match(reason, /does not belong to ADMIN/);
  assert.match(reason, /fault in the record rather than anything done on this screen/);
  assert.match(reason, /find-misattached-at-console/);
});

test('an atId naming no tender at all refuses the same way', () => {
  const d = decide([storedJob({ atId: 'at-deleted' })]);
  assert.equal(d.open, false);
  assert.match(d.open ? '' : d.reason, /does not belong to ADMIN/);
});

// ── ⚠ Superseded is allowed, which is the G107 rule ──────────────────────────────────────────────────────────

test('⚠ an Active but superseded tender still takes units', () => {
  // MEGHA's ten MRs sit on an Active AT that a newer Active one supersedes. New work belongs to the newer tender;
  // a transformer already on this MR does not.
  const ats = [
    { id: 'old', agencyId: 'ag-admin', atNumber: 'AT 26-27', status: 'Active' },
    { id: 'new', agencyId: 'ag-admin', atNumber: 'AT 1819', status: 'Active' },
  ];
  const d = mrAddDecision({ mrNo: '85558', jobs: [mrEditJob(storedJob({ atId: 'old' }))], agencyAts: ats,
    agencyId: 'ag-admin', division: 'DEESA',
    agencyMrs: [{ mrNo: '85558', division: 'DEESA', createdAt: 1, allCancelled: false }] });
  assert.equal(d.open, true, 'a superseded tender is still Active and still takes work');
});

// ── Every refusal says what is still possible ───────────────────────────────────────────────────────────────

test('⚠ no refusal leaves an operator with nothing to do', () => {
  const refusals = [
    decide([storedJob({ atId: '' })]),
    decide([storedJob(), storedJob({ id: 'j2', atId: '' })]),
    decide([storedJob(), storedJob({ id: 'j2', atId: 'at-admin-closed' })]),
    decide([storedJob({ atId: 'at-admin-closed' })]),
    decide([storedJob({ atId: 'at-megha' })]),
  ];
  for (const d of refusals) {
    assert.equal(d.open, false);
    assert.match(d.open ? '' : d.reason, /can still be edited/,
      'a refusal that does not say what still works reads as "this MR is broken"');
  }
});

// ── The arms on their own ────────────────────────────────────────────────────────────────────────────────────

test('resolveMrAt returns the id when the jobs agree, and nothing else does', () => {
  assert.deepEqual(resolveMrAt({ mrNo: '1', jobs: [{ atId: 'x' }, { atId: 'x' }] }), { atId: 'x' });
  assert.ok('error' in resolveMrAt({ mrNo: '1', jobs: [] }), 'an MR with no jobs has no AT to find');
  assert.deepEqual(resolveMrAt({ mrNo: '1', jobs: [{ atId: '  x  ' }] }), { atId: 'x' }, 'padding is not a value');
});

test('the gate and the numbering agree on which tender, because they share the resolver', () => {
  const jobs = [mrEditJob(storedJob())];
  const gate = mrAddDecision({ mrNo: '45645', jobs, agencyAts: ADMIN_ATS, agencyId: 'ag-admin',
    division: 'DEESA', agencyMrs: [{ mrNo: '45645', division: 'DEESA', createdAt: 1, allCancelled: false }] });
  const resolved = resolveMrAt({ mrNo: '45645', jobs });
  assert.equal(gate.open && gate.atId, 'atId' in resolved ? resolved.atId : null);
});

// ── And the screen must use it rather than keeping its own copy ──────────────────────────────────────────────

test('MrLedger delegates both the gate and the resolver', () => {
  const src = readFileSync(new URL('../components/MrLedger.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('mrAddDecision({'), 'the gate must call the shared decision');
  assert.ok(src.includes('resolveMrAt({'), 'the resolver must be shared, or the arms exist twice');
  assert.ok(!src.includes("ids.length === 1 && without === 0"),
    'the resolution arms are still implemented in the component as well');
});

// ── ⚠ ONLY THE LATEST MR OF THE DIVISION TAKES A NEW UNIT (AUDIT G113) ───────────────────────────────────────

const mr = (mrNo: string, createdAt: number, division = 'DEESA', allCancelled = false): MrSummary =>
  ({ mrNo, division, createdAt, allCancelled });

test('⚠ the latest MR in the division opens', () => {
  const mrs = [mr('1961', 100), mr('5545', 200), mr('45645', 300)];
  assert.equal(decide([storedJob()], '45645', mrs).open, true);
});

test('⚠ an older MR refuses, names the newer one, and gives the route', () => {
  // The live case: ADMIN MR 1961 holds SU-6..SU-10 and MR 45645 was received after it.
  const mrs = [mr('1961', 100), mr('45645', 300)];
  const d = decide([storedJob()], '1961', mrs);
  assert.equal(d.open, false);
  const reason = d.open ? '' : d.reason;
  assert.match(reason, /not the latest MR in DEESA/);
  assert.match(reason, /MR 45645 was received after it/);
  assert.match(reason, /cancel MR 45645/);
  assert.match(reason, /reactivate MR 45645/);
  assert.match(reason, /Three steps/, 'the route is three steps, not four - Reactivate is a button');
  assert.match(reason, /asked to renumber before reactivating/, 'the stall at step three must read as known');
  assert.match(reason, /app does not track that you have done it/, 'the recreate step is the operator to see through');
  assert.match(reason, /can still be edited/);
});

test('⚠⚠ PER DIVISION, NOT PER AGENCY - ZENITHs case, which agency-wide would have frozen', () => {
  // A BOPAL MR entered most recently must not block SABARMATI, because the two series never interleave.
  const mrs = [
    mr('2036', 100, 'SABARMATI'),
    mr('1156', 999, 'BOPAL'),      // the agency-wide latest
  ];
  const d = mrAddDecision({
    mrNo: '2036', jobs: [mrEditJob(storedJob())], agencyAts: ADMIN_ATS, agencyId: 'ag-admin',
    division: 'SABARMATI', agencyMrs: mrs,
  });
  assert.equal(d.open, true, 'the latest SABARMATI MR opens even though a BOPAL MR is newer');
});

test('⚠ a fully cancelled MR is not the latest, or the route out of this rule blocks itself', () => {
  // GUJARAT ENERGY's live shape: its newest MR 1217 is entirely cancelled, so 1742 must be reachable.
  const mrs = [mr('1742', 100), mr('1217', 300, 'DEESA', true)];
  assert.equal(decide([storedJob()], '1742', mrs).open, true);
  // And this is exactly what makes the route work: cancel the newer MR, and the older one becomes latest.
  assert.equal(latestMrInDivision(mrs, 'DEESA')?.mrNo, '1742');
});

test('⚠ THE TENDER IS ASKED FIRST - a Closed tender on the latest MR gets the Closed message', () => {
  // SAMOR MR 2938's shape: latest in its division AND on a Closed tender. Three steps ending in a second
  // refusal is G107's trap, so the unfixable reason comes first.
  const mrs = [mr('2938', 300)];
  const d = decide([storedJob({ atId: 'at-admin-closed' })], '2938', mrs);
  assert.equal(d.open, false);
  const reason = d.open ? '' : d.reason;
  assert.match(reason, /marked Closed/);
  assert.ok(!/not the latest MR/.test(reason), 'it must not send the operator down a route that cannot help');
});

test('an older MR on a Closed tender also gets the Closed message, not the route', () => {
  const mrs = [mr('1961', 100), mr('45645', 300)];
  const d = decide([storedJob({ atId: 'at-admin-closed' })], '1961', mrs);
  assert.match(d.open ? '' : d.reason, /marked Closed/);
  assert.ok(!/cancel MR/.test(d.open ? '' : d.reason));
});

test('an MR whose division has no other MR opens - nothing is newer', () => {
  assert.equal(decide([storedJob()], '45645', [mr('45645', 100)]).open, true);
});

// ── latestMrInDivision on its own ────────────────────────────────────────────────────────────────────────────

test('latest is by createdAt, not by MR number - numbers are division references', () => {
  // 00008 sorts before 1961 as a string and after it as a number; neither is the answer.
  const mrs = [mr('1961', 300), mr('00008', 100), mr('451`', 200)];
  assert.equal(latestMrInDivision(mrs, 'DEESA')?.mrNo, '1961');
});

test('division matching ignores case and padding', () => {
  const mrs = [mr('a', 100, ' deesa '), mr('b', 200, 'DEESA')];
  assert.equal(latestMrInDivision(mrs, 'Deesa')?.mrNo, 'b');
});

test('no MR in that division is null, and the caller then allows', () => {
  assert.equal(latestMrInDivision([mr('a', 100, 'BOPAL')], 'DEESA'), null);
});

test('every candidate cancelled is null', () => {
  assert.equal(latestMrInDivision([mr('a', 100, 'DEESA', true)], 'DEESA'), null);
});

test('an MR with no createdAt loses to one that has it', () => {
  const mrs = [mr('old', 0), mr('new', 50)];
  assert.equal(latestMrInDivision(mrs, 'DEESA')?.mrNo, 'new');
});
