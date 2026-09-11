export interface EstimateRates {
  "5": number | null;
  "10": number | null;
  "16": number | null;
  "25": number | null;
  "50": number | null;
  "63": number | null;
  "100": number | null;
  "200": number | null;
  "315": number | null;
  "500": number | null;
}

export interface EstimateItem {
  itemCode: string;
  itemName: string;
  unit: string;
  fixedRate?: number | null;
  rates: EstimateRates;
}

export const defaultRates: EstimateRates = { 
  "5": null, "10": null, "16": null, "25": null, "50": null, "63": null, "100": null, "200": null, "315": null, "500": null 
};

// Official UGVCL Rate Schedule for AMORPHOUS // CRGO Wound CORE TRANSFORMER
export const defaultAmorphousEstimateData: EstimateItem[] = [
  { 
    itemCode: "0", 
    itemName: "Rate for inspection & dismantling charges of damaged transformer declared as scrap by E.E. (TR)", 
    unit: "QTY", 
    fixedRate: 500.00, 
    rates: { "5": 500.00, "10": 500.00, "16": 500.00, "25": 500.00, "50": 500.00, "63": 500.00, "100": 500.00, "200": 500.00, "315": 500.00, "500": 500.00 } 
  },
  { 
    itemCode: "1a", 
    itemName: "10 KVA Aluminium winding (Total Al. coil weight: 21 to 33 Kg)", 
    unit: "QTY", 
    fixedRate: 4927.00, 
    rates: { ...defaultRates, "10": 4927.00 } 
  },
  { 
    itemCode: "1b", 
    itemName: "16 KVA Aluminium winding (Total Al. coil weight: 27 to 39 Kg)", 
    unit: "QTY", 
    fixedRate: 5202.00, 
    rates: { ...defaultRates, "16": 5202.00 } 
  },
  { 
    itemCode: "1c", 
    itemName: "25 KVA Aluminium winding (Total Al. coil weight: 26 to 45 Kg)", 
    unit: "QTY", 
    fixedRate: 8395.00, 
    rates: { ...defaultRates, "25": 8395.00 } 
  },
  { 
    itemCode: "1d-1", 
    itemName: "63 KVA Aluminium winding (Total Al. coil weight: 50 to 67 Kg)", 
    unit: "QTY", 
    fixedRate: 13746.00, 
    rates: { ...defaultRates, "63": 13746.00 } 
  },
  { 
    itemCode: "1d-2", 
    itemName: "63 KVA/ADB/1804, Vijay Make (Total Al. coil weight: 90.21 Kg)", 
    unit: "QTY", 
    fixedRate: 16746.00, 
    rates: { ...defaultRates, "63": 16746.00 } 
  },
  { 
    itemCode: "1e", 
    itemName: "100 KVA Aluminium winding (Total Al. coil weight: 67 to 84 Kg)", 
    unit: "QTY", 
    fixedRate: 17970.00, 
    rates: { ...defaultRates, "100": 17970.00 } 
  },
  { 
    itemCode: "1f", 
    itemName: "200 KVA Aluminium winding (Each Coil limb weight: 69 Kg)", 
    unit: "QTY", 
    fixedRate: 10148.00, 
    rates: { ...defaultRates, "200": 10148.00 } 
  },
  { 
    itemCode: "2", 
    itemName: "Labour charge per transformer", 
    unit: "QTY", 
    fixedRate: 2345.00, 
    rates: { "5": 2345.00, "10": 2345.00, "16": 2345.00, "25": 2345.00, "50": 2345.00, "63": 2345.00, "100": 2345.00, "200": 2345.00, "315": 2345.00, "500": 2345.00 } 
  },
  { 
    itemCode: "3", 
    itemName: "Tank replacement of same size & thickness (per KG)", 
    unit: "KG", 
    fixedRate: 54.00, 
    rates: { "5": 54.00, "10": 54.00, "16": 54.00, "25": 54.00, "50": 54.00, "63": 54.00, "100": 54.00, "200": 54.00, "315": 54.00, "500": 54.00 } 
  },
  { 
    itemCode: "4", 
    itemName: "Conservator Tank replacement of same size (per KG)", 
    unit: "KG", 
    fixedRate: 54.00, 
    rates: { "5": 54.00, "10": 54.00, "16": 54.00, "25": 54.00, "50": 54.00, "63": 54.00, "100": 54.00, "200": 54.00, "315": 54.00, "500": 54.00 } 
  },
  { 
    itemCode: "5", 
    itemName: "Complete Radiator replacement of same size", 
    unit: "QTY", 
    fixedRate: 1057.00, 
    rates: { ...defaultRates, "25": 1057.00, "50": 1057.00, "63": 1256.00, "100": 1452.00, "200": 1452.00 } 
  },
  { 
    itemCode: "6", 
    itemName: "Rate for sealing of uneconomical unit by welding at six places for returning back.", 
    unit: "QTY", 
    fixedRate: 189.00, 
    rates: { "5": 189.00, "10": 189.00, "16": 189.00, "25": 189.00, "50": 189.00, "63": 189.00, "100": 189.00, "200": 189.00, "315": 189.00, "500": 189.00 } 
  }
];

export const defaultWoundCoreEstimateData: EstimateItem[] = JSON.parse(JSON.stringify(defaultAmorphousEstimateData));

// Official UGVCL Rate Schedule for ESTIMATE APPROVING AUTHORITY (CIRCLE LIMITS / 25% OF NEW TRANSFORMER)
// Clause 4.0: CRGO (STACK/DRY/PAT/SDT) Transformers - Repairing cost 25% of NEW transformers
export const defaultCircleLimitsEstimateData: EstimateItem[] = [
  {
    itemCode: "01",
    itemName: "11 KV - 3 Star & other",
    unit: "Rs.",
    fixedRate: null,
    rates: {
      "5": 5422.00,
      "10": 8716.00,
      "16": 8696.00,
      "25": 10124.00,
      "50": 0.00,
      "63": 20423.00,
      "100": 24609.00,
      "200": 47170.00,
      "315": 0.00,
      "500": 148260.00
    }
  },
  {
    itemCode: "02",
    itemName: "11 KV - 4 Star",
    unit: "Rs.",
    fixedRate: null,
    rates: {
      "5": 6206.00,
      "10": 7707.00,
      "16": 11729.00,
      "25": 15651.00,
      "50": 0.00,
      "63": 23684.00,
      "100": 31094.00,
      "200": 65139.00,
      "315": 0.00,
      "500": 193768.00
    }
  },
  {
    itemCode: "03",
    itemName: "11 KV - Level-1",
    unit: "Rs.",
    fixedRate: null,
    rates: {
      "5": 0.00,
      "10": 8010.00,
      "16": 8475.00,
      "25": 9859.00,
      "50": 0.00,
      "63": 0.00,
      "100": 0.00,
      "200": 0.00,
      "315": 0.00,
      "500": 0.00
    }
  },
  {
    itemCode: "04",
    itemName: "11 KV - Level-2",
    unit: "Rs.",
    fixedRate: null,
    rates: {
      "5": 0.00,
      "10": 0.00,
      "16": 10851.00,
      "25": 13998.00,
      "50": 0.00,
      "63": 22137.00,
      "100": 27700.00,
      "200": 55986.00,
      "315": 0.00,
      "500": 198914.00
    }
  },
  {
    itemCode: "05",
    itemName: "22 KV (Amount in Rs.)",
    unit: "Rs.",
    fixedRate: null,
    rates: {
      "5": 0.00,
      "10": 0.00,
      "16": 16455.00,
      "25": 18889.00,
      "50": 0.00,
      "63": 33661.00,
      "100": 48700.00,
      "200": 87710.00,
      "315": 0.00,
      "500": 161287.00
    }
  }
];

export const RATING_LEVEL_OPTIONS = [
  { value: '3 Star & other', label: '11 KV - 3 Star & other' },
  { value: '4 Star', label: '11 KV - 4 Star' },
  { value: 'Level-1', label: '11 KV - Level-1' },
  { value: 'Level-2', label: '11 KV - Level-2' },
  { value: '22 KV', label: '22 KV (Voltage Class)' }
];

/**
 * Returns `saved` with any standard item whose itemCode it lacks appended from
 * `defaults`. Purely ADDITIVE: every saved item keeps its position, name, unit and
 * rates untouched, and nothing saved is ever removed or overwritten.
 *
 * A saved master persisted before an item existed shadows the defaults permanently -
 * getEstimateMasterForCore returns the saved array whenever it is non-empty - so that
 * item can never resolve, at any rate, no matter what the defaults say. That is how
 * the scrap charge (Amorphous/Wound Core code "0") stayed unresolvable: there was no
 * row for it in the saved array and therefore none on the Estimate Master screen.
 *
 * Deliberately narrower than EstimateMaster.tsx's normalize* helpers, which also
 * rewrite names/units/rates and can replace a whole saved array when a legacy-shape
 * heuristic fires. That behaviour is acceptable on an editing screen the user is
 * looking at; in a pricing path it would silently swap entered rates for defaults -
 * the exact class of silent fallback this codebase has been removing.
 */
export function withMissingDefaults(
  saved: EstimateItem[] | undefined | null,
  defaults: EstimateItem[]
): EstimateItem[] {
  if (!saved || saved.length === 0) return defaults;
  const present = new Set(
    saved.map(i => (i.itemCode || '').trim().toLowerCase()).filter(Boolean)
  );
  const missing = defaults.filter(d => {
    const code = (d.itemCode || '').trim().toLowerCase();
    return code && !present.has(code);
  });
  if (missing.length === 0) return saved;
  return [...saved, ...missing.map(d => JSON.parse(JSON.stringify(d)) as EstimateItem)];
}

/**
 * THE SAME ROWS AS withMissingDefaults, EACH PLACED BESIDE ITS SIBLINGS (AUDIT G64).
 *
 * A missing default row goes directly after the nearest EARLIER default row the list holds; failing that,
 * directly before the nearest LATER one; failing both, at the end. So 12A(b1) lands under 12A(b) in a stored
 * master that predates it, rather than after the last row where nobody scanning the coil rows would see it.
 *
 * Rows the defaults do not know keep their places. Nothing missing returns `saved` itself. Inserted rows are
 * copies. Used for CRGO, where the grid, the Excel export and the multi-job sheet all list rows in this order;
 * the other sections keep withMissingDefaults.
 */
export function withMissingDefaultsInPlace(
  saved: EstimateItem[] | undefined | null,
  defaults: EstimateItem[]
): EstimateItem[] {
  if (!saved || saved.length === 0) return defaults;
  const code = (i: EstimateItem) => (i.itemCode || '').trim().toLowerCase();
  const present = new Set(saved.map(code).filter(Boolean));
  if (defaults.every(d => !code(d) || present.has(code(d)))) return saved;
  const out = [...saved];
  const indexOf = (c: string) => out.findIndex(r => code(r) === c);
  defaults.forEach((d, di) => {
    const c = code(d);
    if (!c || present.has(c)) return;
    let at = -1;
    for (let k = di - 1; k >= 0 && at === -1; k--) { const i = indexOf(code(defaults[k])); if (i !== -1) at = i + 1; }
    for (let k = di + 1; k < defaults.length && at === -1; k++) { const i = indexOf(code(defaults[k])); if (i !== -1) at = i; }
    if (at === -1) at = out.length;
    out.splice(at, 0, JSON.parse(JSON.stringify(d)) as EstimateItem);
    present.add(c);
  });
  return out;
}

export function getCircleLimitForJob(
  capacityKva: string | number,
  ratingOrLevel: string | undefined,
  circleLimitsData?: EstimateItem[]
): { limit: number; ratingLabel: string; ratingCode: string; hasLimit: boolean } {
  const kvaStr = String(capacityKva || '25').trim();
  const limits = (circleLimitsData && circleLimitsData.length > 0) ? circleLimitsData : defaultCircleLimitsEstimateData;
  
  const ratingNorm = (ratingOrLevel || '').trim().toLowerCase();
  
  let targetItem: EstimateItem | undefined;
  
  if (ratingNorm.includes('4 star') || ratingNorm.includes('4-star') || ratingNorm.includes('4star')) {
    targetItem = limits.find(it => it.itemCode === '02' || it.itemCode === '2' || it.itemName.toLowerCase().includes('4 star'));
  } else if (ratingNorm.includes('level-1') || ratingNorm.includes('level 1') || ratingNorm.includes('level1')) {
    targetItem = limits.find(it => it.itemCode === '03' || it.itemCode === '3' || it.itemName.toLowerCase().includes('level-1') || it.itemName.toLowerCase().includes('level 1'));
  } else if (ratingNorm.includes('level-2') || ratingNorm.includes('level 2') || ratingNorm.includes('level2')) {
    targetItem = limits.find(it => it.itemCode === '04' || it.itemCode === '4' || it.itemName.toLowerCase().includes('level-2') || it.itemName.toLowerCase().includes('level 2'));
  } else if (ratingNorm.includes('22 kv') || ratingNorm.includes('22kv') || ratingNorm === '22') {
    targetItem = limits.find(it => it.itemCode === '05' || it.itemCode === '5' || it.itemName.toLowerCase().includes('22 kv') || it.itemName.toLowerCase().includes('22kv'));
  } else {
    // Default to "3 Star & other"
    targetItem = limits.find(it => it.itemCode === '01' || it.itemCode === '1' || it.itemName.toLowerCase().includes('3 star') || it.itemName.toLowerCase().includes('other')) || limits[0];
  }

  if (!targetItem) {
    targetItem = limits[0];
  }

  const rawRate = targetItem?.rates ? targetItem.rates[kvaStr as keyof typeof targetItem.rates] : 0;
  const limit = typeof rawRate === 'number' ? rawRate : Number(rawRate) || 0;
  
  return {
    limit,
    ratingLabel: targetItem?.itemName || '11 KV - 3 Star & other',
    ratingCode: targetItem?.itemCode || '01',
    hasLimit: limit > 0
  };
}

// OVERHAULING MASTER - per-item OVERRIDES of the tender, not a schedule of its own (AUDIT F31, O66).
// Rows 3-6 are the 2020 Schedule-B extras (items 3 to 6); they have never been checked against a 2026 tender (O30).
export const defaultOverhaulingEstimateData: EstimateItem[] = [
  {
    itemCode: "7",
    itemName: "Overhauling of complete transformer:\nDuring overhauling, following works are required to be carried out:-\nOverhauling charges shall be paid for below works which includes the opening & closing/refitting of transformer including minor repairing works and loading & unloading of Transformers, repairing of Tanks & radiators by welding to stop leakage of oil, replacement of burnt /damaged external parts like bushing/ nut-bolts /breather if any with Dismantling of bushing replacement of all the old gaskets by new, opening welding of top cover plate if necessary un-tanking of the winding, removal of the core plate assembly and reassembly of the same including replacement of all types of insulations whenever necessary replacement of diaphragm of explosion vent, testing of the same, Cleaning of transformer tank, removal of sludge, filtration of transformer oil, Strengthening / brazing of joints of winding, Fitting/tightening of internal joints at the HV/LV bushing, Internal painting of transformer, Drying of the active parts of the transformer to ensure proper IR value as mentioned herein, fixing of name plates and as per conditions wherever mentioned in this tender.",
    unit: "QTY",
    // ⚠ NO RATE, BY DECISION (AUDIT O66). Overhauling is billed "as per Sr. No. 21 of Schedule-A" in both tenders, and a
    // null cell falls through to the JOB'S OWN tender's Sr 21 (resolveRate), so it cannot go stale when a tender reprices.
    //
    // From 2026-08-18 this row shipped 2061/1603/1603/2061/2061/2061/2500/3000/3000/3000. 1603 and 2061 are the 2020 Sr 1a
    // labour charge; 2500 and 3000 appear in no tender. Differing from the 2020 Sr 21 baseline, the copy test honoured them
    // as overrides, and seeding copied them into every agency, AT, template and shared default - so every overhauling job
    // priced up to Rs 1,128 under its tender. scripts/admin/clear-overhauling-row-7.js clears the stored copies.
    //
    // The ROW stays: a default row a stored section lacks is re-added from here (getEstimateMasterForCore).
    fixedRate: null,
    rates: { ...defaultRates }
  },
  { 
    itemCode: "3", 
    itemName: "Tank replacement of same size & thickness (per KG)", 
    unit: "KG", 
    fixedRate: 54.00, 
    rates: { "5": 54.00, "10": 54.00, "16": 54.00, "25": 54.00, "50": 54.00, "63": 54.00, "100": 54.00, "200": 54.00, "315": 54.00, "500": 54.00 } 
  },
  { 
    itemCode: "4", 
    itemName: "Conservator Tank replacement of same size (per KG)", 
    unit: "KG", 
    fixedRate: 54.00, 
    rates: { "5": 54.00, "10": 54.00, "16": 54.00, "25": 54.00, "50": 54.00, "63": 54.00, "100": 54.00, "200": 54.00, "315": 54.00, "500": 54.00 } 
  },
  { 
    itemCode: "5", 
    itemName: "Complete Radiator replacement of same size", 
    unit: "QTY", 
    fixedRate: 1057.00, 
    rates: { ...defaultRates, "25": 1057.00, "63": 1256.00, "100": 1452.00 } 
  },
  { 
    itemCode: "6", 
    itemName: "Rate for sealing of uneconomical unit by welding at six places for returning back.", 
    unit: "QTY", 
    fixedRate: 189.00, 
    rates: { "5": 189.00, "10": 189.00, "16": 189.00, "25": 189.00, "50": 189.00, "63": 189.00, "100": 189.00, "200": 189.00, "315": 189.00, "500": 189.00 } 
  }
];

// ⚠ NO SHIPPED FIGURE ON ANY ROW PRICED FROM SCHEDULE-A (AUDIT O70). Every figure these rows carried was a UGVCL-2020
// copy: the copy test ignored it, the Estimate Master grid showed it as though it were the AT's own tender's rate - 163
// where a 2026 tender says 165 - and seeding, and the grid's own Save, wrote it into every agency and AT. An empty cell
// shows the AT's tender figure as its placeholder and prices from that tender. Only the scrap row keeps its figure: it
// is priced from the master and has no tender row to fall through to. variantRowDefaults.test.ts keeps it so.
export const defaultEstimateData: EstimateItem[] = [
  // SCRAP CHARGE - required, and absent until now.
  //
  // `SCRAP_ITEM_CODE_BY_CORE_CLASS` maps CRGO to '22'. The Amorphous card has always
  // carried its equivalent ('0') and Wound Core inherits it by copy, but the CRGO card
  // never had one - so a freshly seeded agency could not price a CRGO scrap job at all.
  // `resolveScrapCharge` returned `rate: null` and BillingSystem raised "Scrap charge not
  // configured", which fails honestly but demands the operator hand-add a row that every
  // agency needs and no agency was ever given.
  //
  // Same figures as the Amorphous '0' row: flat Rs 500 regardless of capacity. Both
  // `fixedRate` and every per-capacity cell are populated, because resolveScrapCharge
  // reads `rates[kva]` first and only falls back to `fixedRate`.
  //
  // Shipped DATA, not code - it changes no logic and no existing agency, which stores its
  // own master. It changes what the next agency is born with.
  { itemCode: "22", itemName: "Rate for inspection & dismantling charges of damaged transformer declared as scrap by E.E. (TR)", unit: "QTY", fixedRate: 500.00,
    rates: { "5": 500.00, "10": 500.00, "16": 500.00, "25": 500.00, "50": 500.00, "63": 500.00, "100": 500.00, "200": 500.00, "315": 500.00, "500": 500.00 } },
  { itemCode: "1a", itemName: "Dismentaling", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "1b", itemName: "Repl. of Gaskets", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "1c", itemName: "Repl. HV/LV Gaskets", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "1d", itemName: "Repl. of Insulation", unit: "Y", rates: { ...defaultRates } },
  { itemCode: "1e", itemName: "Repl. of M.S bolt-nuts", unit: "Y", rates: { ...defaultRates } },
  { itemCode: "1f", itemName: "Drying of active parts", unit: "Y", rates: { ...defaultRates } },
  { itemCode: "2a", itemName: "Cleaning Dirty Dank", unit: "Y", rates: { ...defaultRates } },
  { itemCode: "2b", itemName: "Painting Out-Side", unit: "Y", rates: { ...defaultRates } },
  { itemCode: "3", itemName: "Painting In-Side", unit: "N", rates: { ...defaultRates } },
  { itemCode: "5", itemName: "Oil Level Glass", unit: "Y", rates: { ...defaultRates } },
  { itemCode: "6", itemName: "Breather", unit: "N", rates: { ...defaultRates } },
  // ⚠ NO RATE ON 8, 12C OR 13C, BY DECISION (AUDIT O66). Each is ONE master row priced against TWO tender rows chosen by
  // the job - 8 by kV class (8-A / 8-B), 12C and 13C by winding material (-a copper / -b aluminium). One cell can hold one
  // tender row's figure: a correct copy for one variant, which the copy test then honoured as an override of the other -
  // 176 on a 22 kV bushing, 34 and 51.75 on copper winding labour. A null falls through to the job's own variant row of its
  // own tender. variantRowDefaults.test.ts keeps every such row empty.
  { itemCode: "8", itemName: "HV Bushing", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "9A", itemName: "HV Metal Parts", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "9B", itemName: "HV Connector", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "10", itemName: "LV Bushing", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "11A", itemName: "LV Metal Parts", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "11B", itemName: "LV Connector", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "12A(a)", itemName: "HV Wdg. (Not Miss) -CU", unit: "QTY", rates: { ...defaultRates } },
  // THE HV S.E. ROWS (AUDIT G64) - each directly under its without-S.E. sibling, so the two read as a pair.
  //
  // ⚠ AN OVERRIDE EQUAL TO THE 2020 FIGURE IS SILENTLY DISCARDED, AND THESE ARE THE ROWS THAT INVITE OVERRIDES.
  // resolveRate reads a cell equal to UGVCL-2020's own figure for the row - 213 aluminium, 407 copper - as a COPY
  // and prices the job's tender's Schedule-A instead. On a UGVCL-2026 AT an agency that types 213 into 12A(b1),
  // meaning "our rate is 213", is priced 215. Every master row has this flaw; these two are the rows added so an
  // agency can override the S.E. rate. Not fixed here: the copy test needs an explicit override marker.
  //
  // ⚠ NO LV S.E. ROWS - 13A(a1) / 13A(b1) - BY DECISION. The inspection records S.E. for the HV winding only
  // (G61), so nothing would read them and a rate typed there would be silently ignored. An absent row is better
  // than one that discards an override. Do not complete the set until LV S.E. can be recorded.
  { itemCode: "12A(a1)", itemName: "HV Wdg. (Not Miss) -CU S.E.", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "12A(b)", itemName: "HV Wdg. (Not Miss) -AL", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "12A(b1)", itemName: "HV Wdg. (Not Miss) -AL S.E.", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "12C", itemName: "HV Coil - Labour", unit: "QTY", rates: { ...defaultRates } },   // no rate - see row 8 (O66)
  { itemCode: "13A(a)", itemName: "LV Wdg. (Not Miss) -CU", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "13b(b)", itemName: "LV Wdg. (Not Miss) -AL", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "13C", itemName: "LV Coil - Labour", unit: "QTY", rates: { ...defaultRates } },   // no rate - see row 8 (O66)
  { itemCode: "14(ii)CU", itemName: "LV Wdg. Re-Insu.-CU", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "14(ii)AL", itemName: "LV Wdg. Re-Insu.-AL", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "15", itemName: "Washer Ring", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "16", itemName: "Name Plate", unit: "N", rates: { ...defaultRates } },
  { itemCode: "18", itemName: "Repl. Of Tank", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "20", itemName: "Testing Of Trans.", unit: "Y", rates: { ...defaultRates } },
  { itemCode: "21", itemName: "Repl. Of Rediator", unit: "Y", rates: { ...defaultRates } },
  { itemCode: "17", itemName: "Con. of Sealed to Bolt", unit: "N", rates: { ...defaultRates } }
];
