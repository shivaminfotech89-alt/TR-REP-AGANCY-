// src/lib/estimateMasterSeed.ts
//
// WHAT THE ESTIMATE MASTER SCREEN SHOWS FOR A SECTION, AND WHEN IT RELOADS ONE (AUDIT G57).
//
// Three questions the screen used to answer in three places, each slightly differently:
//
//   - what to load         the loader read the TENDER first; Cancel read the AGENCY, so after
//                          Cancel the screen held rows from the wrong document
//   - when to reload       any change reloaded ALL FIVE sections, so saving one discarded
//                          unsaved edits in the other four
//   - what "edited" means  a flag set by an act and cleared only by a reload, so Cancel and a
//                          no-change save left sections claiming edits that did not exist
//
// One answer each, here, as pure functions - so they can be tested without the screen.
//
// ⚠ EVERY ROW THAT LEAVES THIS MODULE IS A COPY. The screen edits rows in place
// (`data[index].rates[kva] = ...` after a shallow array copy). A row shared with the context's
// AT document turns an unsaved keystroke into the tender's in-memory rates - which estimates
// and bills in the same session price from. See G57.

import {
  defaultEstimateData,
  defaultAmorphousEstimateData,
  defaultOverhaulingEstimateData,
  defaultCircleLimitsEstimateData,
  defaultRates,
  withMissingDefaultsInPlace,
  type EstimateItem,
} from './estimateData';
import { sameContent } from './compareSections';

export type SeedSection = 'CRGO' | 'AMORPHOUS' | 'WOUND_CORE' | 'OVERHAULING' | 'CIRCLE_LIMITS';
export const SEED_SECTIONS: readonly SeedSection[] = ['CRGO', 'AMORPHOUS', 'WOUND_CORE', 'OVERHAULING', 'CIRCLE_LIMITS'];

/** The rows a section can be loaded from, already resolved tender-first. */
export interface RateHolder {
  estimateMasterCRGO?: EstimateItem[];
  estimateMasterAmorphous?: EstimateItem[];
  estimateMasterWoundCore?: EstimateItem[];
  estimateMasterOverhauling?: EstimateItem[];
  estimateMasterCircleLimits?: EstimateItem[];
  /** The pre-sections CRGO field. Agency only - nothing has written it since D4. */
  estimateMaster?: EstimateItem[];
}

const has = (rows: EstimateItem[] | undefined | null): rows is EstimateItem[] =>
  Array.isArray(rows) && rows.length > 0;

/** A deep copy. Rate rows are plain data, so JSON is exact for them. */
export function cloneRows(rows: EstimateItem[] | null | undefined): EstimateItem[] {
  return JSON.parse(JSON.stringify(rows ?? []));
}

/**
 * WHERE A SECTION'S RATES COME FROM - THE TENDER FIRST, THE AGENCY ONLY WHERE THE TENDER HAS NONE.
 *
 * Mirrors getEstimateMasterForCore's top two rungs (AUDIT F73), per section rather than per
 * document: an AT that holds CRGO but not Overhauling shows its own CRGO and the agency's
 * Overhauling, which is what pricing will do.
 *
 * ⚠ THIS IS THE ONLY WAY IN, FOR LOADING AND FOR CANCEL ALIKE. Cancel reading
 * `activeAgency.estimateMaster*` directly was the original defect: it re-seeded a cancelled
 * section from the agency's rows, and Save All, Apply and Publish then carried those rows
 * into the tender and beyond. Not `at ?? agency` either - that shows blank sections for an AT
 * holding some sections but not all.
 */
export function rateHolderFor(at: unknown, agency: unknown): RateHolder {
  const pick = (k: Exclude<keyof RateHolder, 'estimateMaster'>): EstimateItem[] | undefined => {
    const fromAt = (at as any)?.[k];
    if (has(fromAt)) return fromAt;
    return (agency as any)?.[k];
  };
  return {
    estimateMasterCRGO: pick('estimateMasterCRGO'),
    estimateMasterAmorphous: pick('estimateMasterAmorphous'),
    estimateMasterWoundCore: pick('estimateMasterWoundCore'),
    estimateMasterOverhauling: pick('estimateMasterOverhauling'),
    estimateMasterCircleLimits: pick('estimateMasterCircleLimits'),
    estimateMaster: (agency as any)?.estimateMaster,
  };
}

// ---------------------------------------------------------------------------------------------
// The normalisers, moved here unchanged from EstimateMaster.tsx.
// ---------------------------------------------------------------------------------------------

export function mergeDefaultRates(items: EstimateItem[]): EstimateItem[] {
  return items.map((item: any) => ({
    ...item,
    rates: {
      ...defaultRates,
      ...item.rates
    }
  }));
}

export function normalizeCircleLimitsData(items: EstimateItem[] | undefined, defaultData: EstimateItem[]): EstimateItem[] {
  if (!items || items.length === 0) {
    return JSON.parse(JSON.stringify(defaultData));
  }

  const itemMap = new Map<string, EstimateItem>();
  items.forEach(it => {
    const code = (it.itemCode || '').trim().toLowerCase();
    if (code) itemMap.set(code, it);
  });

  const result: EstimateItem[] = [];
  const processedCodes = new Set<string>();

  defaultData.forEach(defItem => {
    const code = (defItem.itemCode || '').trim().toLowerCase();
    processedCodes.add(code);
    const existing = itemMap.get(code);

    if (existing) {
      result.push({
        itemCode: existing.itemCode || defItem.itemCode,
        itemName: existing.itemName && existing.itemName.trim() !== '' ? existing.itemName : defItem.itemName,
        unit: existing.unit || 'Rs.',
        fixedRate: null,
        rates: { ...defaultRates, ...defItem.rates, ...(existing.rates || {}) }
      });
    } else {
      result.push(JSON.parse(JSON.stringify(defItem)));
    }
  });

  items.forEach(it => {
    const code = (it.itemCode || '').trim().toLowerCase();
    if (code && !processedCodes.has(code)) {
      result.push({
        ...it,
        unit: it.unit || 'Rs.',
        rates: it.rates ? { ...defaultRates, ...it.rates } : { ...defaultRates }
      });
    }
  });

  return result;
}

export function normalizeAmorphousOrWoundCoreData(items: EstimateItem[] | undefined, defaultData: EstimateItem[]): EstimateItem[] {
  if (!items || items.length === 0) {
    return JSON.parse(JSON.stringify(defaultData));
  }

  // Check if it's the old CRGO array mistakenly stored as Wound Core / Amorphous
  const isLegacyCrgo = items.some(it => {
    const name = (it.itemName || '').toLowerCase();
    return name.includes('dismental') || name.includes('washer ring') || name.includes('hv metal') || name.includes('lv metal');
  });

  // Check if it's the old 10-item placeholder with 0 rates
  const isOldPlaceholder = items.length <= 10 && items.every(it => (!it.fixedRate || it.fixedRate === 0) && (!it.rates || Object.values(it.rates).every(v => v === null || v === 0)));

  if (isLegacyCrgo || isOldPlaceholder) {
    return JSON.parse(JSON.stringify(defaultData));
  }

  const itemMap = new Map<string, EstimateItem>();
  items.forEach(it => {
    const code = (it.itemCode || '').trim().toLowerCase();
    if (code) itemMap.set(code, it);
  });

  const result: EstimateItem[] = [];
  const processedCodes = new Set<string>();

  defaultData.forEach(defItem => {
    const code = (defItem.itemCode || '').trim().toLowerCase();
    processedCodes.add(code);
    const existing = itemMap.get(code);

    if (existing) {
      let fRate = existing.fixedRate;
      if (fRate === undefined || fRate === null || fRate === 0) {
        if (defItem.fixedRate) {
          fRate = defItem.fixedRate;
        } else if (existing.rates) {
          const ratesObj = existing.rates as any;
          const nonNull = Object.entries(ratesObj).find(([k, v]) => v !== null && !isNaN(Number(v)) && Number(v) > 0);
          if (nonNull) fRate = Number(nonNull[1]);
        }
      }

      // Merge rates
      const mergedRates = { ...defaultRates, ...defItem.rates, ...(existing.rates || {}) };

      let resolvedUnit = existing.unit;
      if (!resolvedUnit || resolvedUnit.toLowerCase().includes('each') || resolvedUnit.toLowerCase().includes('coil weight')) {
        resolvedUnit = 'QTY';
      }

      result.push({
        itemCode: existing.itemCode || defItem.itemCode,
        itemName: existing.itemName && existing.itemName.trim() !== '' ? existing.itemName : defItem.itemName, // Do not change user's saved description
        unit: resolvedUnit, // Unit set to QTY
        fixedRate: fRate !== undefined && fRate !== null && !isNaN(Number(fRate)) && Number(fRate) > 0 ? Number(fRate) : (defItem.fixedRate || 0),
        rates: mergedRates
      });
    } else {
      result.push(JSON.parse(JSON.stringify(defItem)));
    }
  });

  items.forEach(it => {
    const code = (it.itemCode || '').trim().toLowerCase();
    if (code && !processedCodes.has(code)) {
      let resolvedUnit = it.unit;
      if (!resolvedUnit || resolvedUnit.toLowerCase().includes('each')) {
        resolvedUnit = 'QTY';
      }
      result.push({
        ...it,
        unit: resolvedUnit,
        fixedRate: it.fixedRate !== undefined && it.fixedRate !== null ? Number(it.fixedRate) : 0,
        rates: it.rates ? { ...defaultRates, ...it.rates } : { ...defaultRates }
      });
    }
  });

  return result;
}

export function normalizeOverhaulingData(items: EstimateItem[] | undefined, defaultData: EstimateItem[]): EstimateItem[] {
  if (!items || items.length === 0) {
    return JSON.parse(JSON.stringify(defaultData));
  }

  const itemMap = new Map<string, EstimateItem>();
  items.forEach(it => {
    const code = (it.itemCode || '').trim().toLowerCase();
    if (code) itemMap.set(code, it);
  });

  const result: EstimateItem[] = [];
  const processedCodes = new Set<string>();

  defaultData.forEach(defItem => {
    const code = (defItem.itemCode || '').trim().toLowerCase();
    processedCodes.add(code);
    const existing = itemMap.get(code);

    if (existing) {
      let fRate = existing.fixedRate;
      if (fRate === undefined || fRate === null || fRate === 0) {
        if (defItem.fixedRate) {
          fRate = defItem.fixedRate;
        } else if (existing.rates) {
          const ratesObj = existing.rates as any;
          const nonNull = Object.entries(ratesObj).find(([k, v]) => v !== null && !isNaN(Number(v)) && Number(v) > 0);
          if (nonNull) fRate = Number(nonNull[1]);
        }
      }

      let resolvedUnit = existing.unit;
      if (!resolvedUnit || resolvedUnit.toLowerCase().includes('each') || resolvedUnit.toLowerCase().includes('transformer')) {
        resolvedUnit = 'QTY';
      }

      result.push({
        ...defItem,
        ...existing,
        unit: resolvedUnit,
        fixedRate: fRate !== undefined && fRate !== null ? Number(fRate) : (defItem.fixedRate || 0),
        rates: existing.rates ? { ...defItem.rates, ...existing.rates } : { ...defItem.rates }
      });
    } else {
      result.push(JSON.parse(JSON.stringify(defItem)));
    }
  });

  items.forEach(it => {
    const code = (it.itemCode || '').trim().toLowerCase();
    if (code && !processedCodes.has(code)) {
      let resolvedUnit = it.unit;
      if (!resolvedUnit || resolvedUnit.toLowerCase().includes('each') || resolvedUnit.toLowerCase().includes('transformer')) {
        resolvedUnit = 'QTY';
      }
      result.push({
        ...it,
        unit: resolvedUnit,
        fixedRate: it.fixedRate !== undefined && it.fixedRate !== null ? Number(it.fixedRate) : 0,
        rates: it.rates ? { ...defaultRates, ...it.rates } : { ...defaultRates }
      });
    }
  });

  return result;
}

// ---------------------------------------------------------------------------------------------
// Seeding, reloading, and "edited".
// ---------------------------------------------------------------------------------------------

/** The old CRGO card stored as Wound Core. Empty counts as legacy, as it did in the loader. */
function isLegacyWoundCore(rows: EstimateItem[] | undefined): boolean {
  return !has(rows) || rows.some(it => {
    const name = (it.itemName || '').toLowerCase();
    return name.includes('dismental') || name.includes('washer ring') || name.includes('hv metal') || name.includes('lv metal');
  });
}

function seedAmorphous(holder: RateHolder, g: RateHolder | undefined): EstimateItem[] {
  const own = holder.estimateMasterAmorphous;
  if (has(own)) return normalizeAmorphousOrWoundCoreData(own, defaultAmorphousEstimateData);
  const shared = g?.estimateMasterAmorphous;
  if (has(shared)) return normalizeAmorphousOrWoundCoreData(shared, defaultAmorphousEstimateData);
  return cloneRows(defaultAmorphousEstimateData);
}

/**
 * WHAT A SECTION SHOWS WHEN IT IS LOADED OR CANCELLED.
 *
 * The rung order is the loader's, unchanged: the holder (tender, then agency - rateHolderFor),
 * then the shared default, then the shipped constants. CRGO alone also reads the legacy
 * agency field before the constants. Wound Core defaults to the Amorphous rows, because its
 * shipped default is a copy of them.
 *
 * ⚠ ALWAYS RETURNS A FRESH COPY, whatever path produced it.
 */
export function seedSection(section: SeedSection, holder: RateHolder, globalDefault?: RateHolder | null): EstimateItem[] {
  const g = globalDefault ?? undefined;
  let rows: EstimateItem[];
  switch (section) {
    case 'CRGO': {
      const own = holder.estimateMasterCRGO, shared = g?.estimateMasterCRGO, legacy = holder.estimateMaster;
      // ⚠ MISSING DEFAULT ROWS ARE SHOWN, BESIDE THEIR SIBLINGS (AUDIT G64). Pricing has always added any default
      // row a stored master lacks (getEstimateMasterForCore); the grid did not, so such a row was priced but
      // invisible - unreachable by the agency that would want to override it. This is how 12A(a1) / 12A(b1) reach
      // the existing masters: shown here and written by the next Save, with no bulk write. The panel under the
      // section already names rows "not in storage".
      const fill = (rs: EstimateItem[]) => mergeDefaultRates(withMissingDefaultsInPlace(cloneRows(rs), defaultEstimateData));
      rows = has(own) ? fill(own)
        : has(shared) ? fill(shared)
        : has(legacy) ? fill(legacy)
        : cloneRows(defaultEstimateData);
      break;
    }
    case 'AMORPHOUS':
      rows = seedAmorphous(holder, g);
      break;
    case 'WOUND_CORE': {
      const amorphous = seedAmorphous(holder, g);
      const own = holder.estimateMasterWoundCore, shared = g?.estimateMasterWoundCore;
      rows = !isLegacyWoundCore(own) ? normalizeAmorphousOrWoundCoreData(own, amorphous)
        : !isLegacyWoundCore(shared) ? normalizeAmorphousOrWoundCoreData(shared, amorphous)
        : cloneRows(amorphous);
      break;
    }
    case 'OVERHAULING': {
      const own = holder.estimateMasterOverhauling, shared = g?.estimateMasterOverhauling;
      rows = has(own) ? normalizeOverhaulingData(own, defaultOverhaulingEstimateData)
        : has(shared) ? normalizeOverhaulingData(shared, defaultOverhaulingEstimateData)
        : cloneRows(defaultOverhaulingEstimateData);
      break;
    }
    case 'CIRCLE_LIMITS': {
      const own = holder.estimateMasterCircleLimits, shared = g?.estimateMasterCircleLimits;
      rows = has(own) ? normalizeCircleLimitsData(own, defaultCircleLimitsEstimateData)
        : has(shared) ? normalizeCircleLimitsData(shared, defaultCircleLimitsEstimateData)
        : cloneRows(defaultCircleLimitsEstimateData);
      break;
    }
  }
  return cloneRows(rows);
}

/**
 * WHICH SECTIONS TO RELOAD - ONLY THOSE WHOSE STORED ROWS ACTUALLY CHANGED.
 *
 * `snapshots` holds each section as it was last loaded. A section is re-seeded when the tender
 * or agency changed, when it has never been loaded, or when seeding it NOW produces different
 * content from its snapshot - which is exactly "its stored rows moved". Any other section keeps
 * its screen state, unsaved edits included.
 *
 * ⚠ COMPARED WITH sameContent, NEVER JSON.stringify. Rows saved from the screen reach context in
 * the screen's key order while fetched rows arrive in Firestore's, so a naive comparison reloads
 * on a save that changed nothing - and a reload discards whatever else is unsaved.
 */
export function planReseed(
  holder: RateHolder,
  globalDefault: RateHolder | null | undefined,
  snapshots: Partial<Record<SeedSection, EstimateItem[]>>,
  contextChanged: boolean,
): Array<{ section: SeedSection; rows: EstimateItem[] }> {
  return SEED_SECTIONS.flatMap(section => {
    const rows = seedSection(section, holder, globalDefault);
    const prev = snapshots[section];
    return contextChanged || !prev || !sameContent(rows, prev) ? [{ section, rows }] : [];
  });
}

/**
 * IS A SECTION EDITED? The screen differs from what was loaded - compared, never remembered.
 *
 * Cancel restores the loaded rows, so it reads unedited. A cell changed and typed back reads
 * unedited. A save re-seeds the section from what was stored, so it reads unedited. None of
 * that depends on anyone remembering to clear anything, which is the failure it replaces (O56).
 * No snapshot yet means nothing loaded yet, which is not an edit.
 */
export function sectionIsEdited(screen: EstimateItem[] | null | undefined, snapshot: EstimateItem[] | null | undefined): boolean {
  return Boolean(snapshot) && !sameContent(screen ?? [], snapshot);
}
