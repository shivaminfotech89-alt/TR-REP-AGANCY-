// Tests for lib/estimateMasterSeed.ts (AUDIT G57). Run with `npm test`.
//
// ⚠ A COPY OF THE PRE-G57 LOADER LIVES HERE ON PURPOSE (`oldLoader`). The seeding moved out of
// EstimateMaster.tsx in G57, and "the screen loads the same content as before" is only a claim until
// it is compared against what the screen used to do. Do not update it to match seedSection - if the
// two ever need to differ, that is a pricing-visible change and gets its own entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  seedSection, rateHolderFor, planReseed, sectionIsEdited, cloneRows, SEED_SECTIONS,
  mergeDefaultRates, normalizeAmorphousOrWoundCoreData, normalizeOverhaulingData, normalizeCircleLimitsData,
  type RateHolder,
} from './estimateMasterSeed';
import {
  defaultEstimateData, defaultAmorphousEstimateData, defaultWoundCoreEstimateData,
  defaultOverhaulingEstimateData, defaultCircleLimitsEstimateData, type EstimateItem,
} from './estimateData';
import { sameContent } from './compareSections';

// ------------------------------------------------------------------ helpers and fixtures
const withRate = (rows: EstimateItem[], index: number, kva: string, value: number | null) => {
  const c = cloneRows(rows);
  (c[index].rates as any)[kva] = value;
  return c;
};
const reverseKeys = (v: any): any => Array.isArray(v) ? v.map(reverseKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map(k => [k, reverseKeys(v[k])])) : v;
const rate = (rows: EstimateItem[], index: number, kva = '25') => (rows[index].rates as any)[kva];

const agency: any = {
  id: 'ag',
  estimateMasterCRGO: withRate(defaultEstimateData, 0, '25', 222),
  estimateMasterAmorphous: withRate(defaultAmorphousEstimateData, 1, '25', 333),
  estimateMasterWoundCore: withRate(defaultWoundCoreEstimateData, 1, '25', 444),
  estimateMasterOverhauling: cloneRows(defaultOverhaulingEstimateData),
  estimateMasterCircleLimits: cloneRows(defaultCircleLimitsEstimateData),
};
const atCrgoOnly: any = { id: 'at1', estimateMasterCRGO: withRate(defaultEstimateData, 0, '25', 111) };
const atFull: any = {
  id: 'at2',
  estimateMasterCRGO: withRate(defaultEstimateData, 0, '25', 11),
  estimateMasterAmorphous: withRate(defaultAmorphousEstimateData, 1, '25', 33),
  estimateMasterWoundCore: withRate(defaultWoundCoreEstimateData, 1, '25', 44),
  estimateMasterOverhauling: withRate(defaultOverhaulingEstimateData, 0, '25', 55),
  estimateMasterCircleLimits: withRate(defaultCircleLimitsEstimateData, 0, '25', 66),
};
const globalDefault: RateHolder = {
  estimateMasterCRGO: withRate(defaultEstimateData, 0, '25', 900),
  estimateMasterAmorphous: withRate(defaultAmorphousEstimateData, 1, '25', 901),
};
const legacyWc = cloneRows(defaultEstimateData).map((r, i) => (i === 0 ? { ...r, itemName: 'Dismental and fitting' } : r));

/** The loader as it was before G57, in logic - the reference the move must match. */
function oldLoader(rateHolder: RateHolder, g: RateHolder | null) {
  const out: Record<string, EstimateItem[]> = {};
  if (rateHolder.estimateMasterCRGO && rateHolder.estimateMasterCRGO.length > 0) out.CRGO = mergeDefaultRates(JSON.parse(JSON.stringify(rateHolder.estimateMasterCRGO)));
  else if (g?.estimateMasterCRGO && g.estimateMasterCRGO.length > 0) out.CRGO = mergeDefaultRates(JSON.parse(JSON.stringify(g.estimateMasterCRGO)));
  else if (rateHolder.estimateMaster && rateHolder.estimateMaster.length > 0) out.CRGO = mergeDefaultRates(JSON.parse(JSON.stringify(rateHolder.estimateMaster)));
  else out.CRGO = JSON.parse(JSON.stringify(defaultEstimateData));
  let currentAmorphous: EstimateItem[];
  if (rateHolder.estimateMasterAmorphous && rateHolder.estimateMasterAmorphous.length > 0) currentAmorphous = normalizeAmorphousOrWoundCoreData(rateHolder.estimateMasterAmorphous, defaultAmorphousEstimateData);
  else if (g?.estimateMasterAmorphous && g.estimateMasterAmorphous.length > 0) currentAmorphous = normalizeAmorphousOrWoundCoreData(g.estimateMasterAmorphous, defaultAmorphousEstimateData);
  else currentAmorphous = JSON.parse(JSON.stringify(defaultAmorphousEstimateData));
  out.AMORPHOUS = currentAmorphous;
  const isLegacyWc = (arr?: EstimateItem[]) => !arr || arr.length === 0 || arr.some(it => {
    const name = (it.itemName || '').toLowerCase();
    return name.includes('dismental') || name.includes('washer ring') || name.includes('hv metal') || name.includes('lv metal');
  });
  if (rateHolder.estimateMasterWoundCore && rateHolder.estimateMasterWoundCore.length > 0 && !isLegacyWc(rateHolder.estimateMasterWoundCore)) out.WOUND_CORE = normalizeAmorphousOrWoundCoreData(rateHolder.estimateMasterWoundCore, currentAmorphous);
  else if (g?.estimateMasterWoundCore && g.estimateMasterWoundCore.length > 0 && !isLegacyWc(g.estimateMasterWoundCore)) out.WOUND_CORE = normalizeAmorphousOrWoundCoreData(g.estimateMasterWoundCore, currentAmorphous);
  else out.WOUND_CORE = JSON.parse(JSON.stringify(currentAmorphous));
  if (rateHolder.estimateMasterOverhauling && rateHolder.estimateMasterOverhauling.length > 0) out.OVERHAULING = normalizeOverhaulingData(rateHolder.estimateMasterOverhauling, defaultOverhaulingEstimateData);
  else if (g?.estimateMasterOverhauling && g.estimateMasterOverhauling.length > 0) out.OVERHAULING = normalizeOverhaulingData(g.estimateMasterOverhauling, defaultOverhaulingEstimateData);
  else out.OVERHAULING = JSON.parse(JSON.stringify(defaultOverhaulingEstimateData));
  if (rateHolder.estimateMasterCircleLimits && rateHolder.estimateMasterCircleLimits.length > 0) out.CIRCLE_LIMITS = normalizeCircleLimitsData(rateHolder.estimateMasterCircleLimits, defaultCircleLimitsEstimateData);
  else if (g?.estimateMasterCircleLimits && g.estimateMasterCircleLimits.length > 0) out.CIRCLE_LIMITS = normalizeCircleLimitsData(g.estimateMasterCircleLimits, defaultCircleLimitsEstimateData);
  else out.CIRCLE_LIMITS = JSON.parse(JSON.stringify(defaultCircleLimitsEstimateData));
  return out;
}

const seedAll = (holder: RateHolder, g: RateHolder | null = null) =>
  Object.fromEntries(SEED_SECTIONS.map(s => [s, seedSection(s, holder, g)])) as Record<string, EstimateItem[]>;
const sections = (plan: Array<{ section: string }>) => plan.map(p => p.section);

// ------------------------------------------------------------------ 1. tender first
test('the tender\'s rows come first', () => {
  assert.equal(rate(seedSection('CRGO', rateHolderFor(atCrgoOnly, agency)), 0), 111);
});
test('a section the tender lacks comes from the agency', () => {
  assert.equal(rate(seedSection('AMORPHOUS', rateHolderFor(atCrgoOnly, agency)), 1), 333);
});
test('no tender: the agency\'s rows', () => {
  assert.equal(rate(seedSection('CRGO', rateHolderFor(null, agency)), 0), 222);
});
test('CANCEL restores the tender\'s rows, not the agency\'s (the original defect)', () => {
  const holder = rateHolderFor(atFull, agency);
  const snapshot = seedAll(holder);
  const screen = withRate(snapshot.CRGO, 0, '25', 5);              // an edit
  const cancelled = seedSection('CRGO', holder);                     // what Cancel does
  assert.equal(rate(cancelled, 0), 11);
  assert.notEqual(rate(cancelled, 0), 222);
  assert.equal(sectionIsEdited(screen, snapshot.CRGO), true);
  assert.equal(sectionIsEdited(cancelled, snapshot.CRGO), false);
});

// ------------------------------------------------------------------ 2. same content as the old loader
const fixtures: Array<[string, RateHolder, RateHolder | null]> = [
  ['tender with all five', rateHolderFor(atFull, agency), null],
  ['tender with CRGO only', rateHolderFor(atCrgoOnly, agency), null],
  ['no tender', rateHolderFor(null, agency), null],
  ['empty holder, shared default', rateHolderFor(null, {}), globalDefault],
  ['empty holder, no default', rateHolderFor(null, {}), null],
  ['legacy Wound Core falls back to Amorphous', rateHolderFor({ estimateMasterWoundCore: legacyWc }, agency), null],
  ['legacy CRGO field only', rateHolderFor(null, { estimateMaster: withRate(defaultEstimateData, 0, '25', 7) }), null],
];
for (const [name, holder, g] of fixtures) {
  test(`seeds the same content as the pre-G57 loader: ${name}`, () => {
    const old = oldLoader(holder, g);
    for (const s of SEED_SECTIONS) assert.ok(sameContent(seedSection(s, holder, g), old[s]), `${s} differs`);
  });
}

// ------------------------------------------------------------------ 3. never shares an object
test('every seeded row and rates object is a copy, in every section and fixture', () => {
  for (const [, holder, g] of fixtures) {
    const sources = [...Object.values(holder), ...Object.values(g ?? {})].filter(Array.isArray).flat() as EstimateItem[];
    const rowSet = new Set<object>(sources), ratesSet = new Set<object>(sources.map(r => r.rates as object));
    for (const s of SEED_SECTIONS) {
      for (const row of seedSection(s, holder, g)) {
        assert.ok(!rowSet.has(row), `${s}: a row object is shared with the holder`);
        assert.ok(!ratesSet.has(row.rates as object), `${s}: a rates object is shared with the holder`);
      }
    }
  }
});
test('an in-place edit to seeded rows cannot reach the holder', () => {
  const holder = rateHolderFor(atFull, agency);
  const screen = seedSection('CRGO', holder);
  (screen[0].rates as any)['25'] = 999;
  assert.equal(rate(holder.estimateMasterCRGO!, 0), 11);
});
test('SAVE THEN KEYSTROKE: context keeps the saved figure, not the unsaved one (the shared-object path)', () => {
  const holder = rateHolderFor(atFull, agency);
  const snapshots = seedAll(holder);
  const screen = withRate(snapshots.CRGO, 0, '25', 150);          // edited
  const savedToContext = cloneRows(screen);                         // what saveRatesToActiveAt hands over
  (screen[0].rates as any)['25'] = 777;                             // unsaved keystroke after the save
  assert.equal(rate(savedToContext, 0), 150);
});

// ------------------------------------------------------------------ 4. reload only what moved
test('saving one section reloads only that section - unsaved edits elsewhere survive', () => {
  const snapshots = seedAll(rateHolderFor(atFull, agency));
  const afterSave = rateHolderFor({ ...atFull, estimateMasterCRGO: withRate(atFull.estimateMasterCRGO, 0, '25', 12) }, agency);
  assert.deepEqual(sections(planReseed(afterSave, null, snapshots, false)), ['CRGO']);
});
test('the re-seeded section carries the saved figure', () => {
  const snapshots = seedAll(rateHolderFor(atFull, agency));
  const afterSave = rateHolderFor({ ...atFull, estimateMasterCRGO: withRate(atFull.estimateMasterCRGO, 0, '25', 12) }, agency);
  const plan = planReseed(afterSave, null, snapshots, false);
  assert.equal(rate(plan[0].rows, 0), 12);
});
test('the same rows in a different key order reload nothing', () => {
  const snapshots = seedAll(rateHolderFor(atFull, agency));
  const reordered = rateHolderFor(reverseKeys(atFull), reverseKeys(agency));
  assert.deepEqual(sections(planReseed(reordered, null, snapshots, false)), []);
});
test('a save on another tab - the objects replaced, the rates not - reloads nothing', () => {
  const snapshots = seedAll(rateHolderFor(atFull, agency));
  const replaced = rateHolderFor({ ...atFull, atPercentage: 7 }, { ...agency, bankName: 'X' });
  assert.deepEqual(sections(planReseed(replaced, null, snapshots, false)), []);
});
test('changing tender or agency reloads all five', () => {
  const snapshots = seedAll(rateHolderFor(atFull, agency));
  assert.deepEqual(sections(planReseed(rateHolderFor(atFull, agency), null, snapshots, true)), [...SEED_SECTIONS]);
});
test('a section never loaded is loaded', () => {
  assert.deepEqual(sections(planReseed(rateHolderFor(atFull, agency), null, {}, false)), [...SEED_SECTIONS]);
});
test('Wound Core reloads with Amorphous when it has no rows of its own', () => {
  const noWc = { ...atFull, estimateMasterWoundCore: [] };
  const ag = { ...agency, estimateMasterWoundCore: [] };
  const snapshots = seedAll(rateHolderFor(noWc, ag));
  const moved = rateHolderFor({ ...noWc, estimateMasterAmorphous: withRate(atFull.estimateMasterAmorphous, 1, '25', 34) }, ag);
  assert.deepEqual(sections(planReseed(moved, null, snapshots, false)), ['AMORPHOUS', 'WOUND_CORE']);
});

// ------------------------------------------------------------------ 5. "edited" is a comparison
test('freshly loaded is not edited', () => {
  const snap = seedSection('CRGO', rateHolderFor(atFull, agency));
  assert.equal(sectionIsEdited(cloneRows(snap), snap), false);
});
test('a changed cell is edited; typed back, it is not', () => {
  const snap = seedSection('CRGO', rateHolderFor(atFull, agency));
  const screen = cloneRows(snap);
  (screen[0].rates as any)['25'] = 5;
  assert.equal(sectionIsEdited(screen, snap), true);
  (screen[0].rates as any)['25'] = 11;
  assert.equal(sectionIsEdited(screen, snap), false);
});
test('key order alone is not an edit', () => {
  const snap = seedSection('CRGO', rateHolderFor(atFull, agency));
  assert.equal(sectionIsEdited(reverseKeys(snap), snap), false);
});
test('an added row is an edit; nothing loaded yet is not', () => {
  const snap = seedSection('OVERHAULING', rateHolderFor(atFull, agency));
  assert.equal(sectionIsEdited([...cloneRows(snap), { itemCode: '', itemName: '', unit: 'QTY', rates: {} as any }], snap), true);
  assert.equal(sectionIsEdited(snap, undefined), false);
});
