// GENERATED FILE - DO NOT EDIT.
//
// Compiled from src/lib/agencySeed.ts by scripts/sync-agency-seed.js, which runs on every `firebase deploy`.
// Edit the TypeScript source; anything written here is overwritten by the next deploy.
//
// It exists because a deployed function cannot import from src/, and because a hand-written
// second copy of the agency seed is the arrangement AUDIT F30 records the cost of.


// src/lib/estimateData.ts
var defaultRates = {
  "5": null,
  "10": null,
  "16": null,
  "25": null,
  "50": null,
  "63": null,
  "100": null,
  "200": null,
  "315": null,
  "500": null
};
var defaultAmorphousEstimateData = [
  {
    itemCode: "0",
    itemName: "Rate for inspection & dismantling charges of damaged transformer declared as scrap by E.E. (TR)",
    unit: "QTY",
    fixedRate: 500,
    rates: { "5": 500, "10": 500, "16": 500, "25": 500, "50": 500, "63": 500, "100": 500, "200": 500, "315": 500, "500": 500 }
  },
  {
    itemCode: "1a",
    itemName: "10 KVA Aluminium winding (Total Al. coil weight: 21 to 33 Kg)",
    unit: "QTY",
    fixedRate: 4927,
    rates: { ...defaultRates, "10": 4927 }
  },
  {
    itemCode: "1b",
    itemName: "16 KVA Aluminium winding (Total Al. coil weight: 27 to 39 Kg)",
    unit: "QTY",
    fixedRate: 5202,
    rates: { ...defaultRates, "16": 5202 }
  },
  {
    itemCode: "1c",
    itemName: "25 KVA Aluminium winding (Total Al. coil weight: 26 to 45 Kg)",
    unit: "QTY",
    fixedRate: 8395,
    rates: { ...defaultRates, "25": 8395 }
  },
  {
    itemCode: "1d-1",
    itemName: "63 KVA Aluminium winding (Total Al. coil weight: 50 to 67 Kg)",
    unit: "QTY",
    fixedRate: 13746,
    rates: { ...defaultRates, "63": 13746 }
  },
  {
    itemCode: "1d-2",
    itemName: "63 KVA/ADB/1804, Vijay Make (Total Al. coil weight: 90.21 Kg)",
    unit: "QTY",
    fixedRate: 16746,
    rates: { ...defaultRates, "63": 16746 }
  },
  {
    itemCode: "1e",
    itemName: "100 KVA Aluminium winding (Total Al. coil weight: 67 to 84 Kg)",
    unit: "QTY",
    fixedRate: 17970,
    rates: { ...defaultRates, "100": 17970 }
  },
  {
    itemCode: "1f",
    itemName: "200 KVA Aluminium winding (Each Coil limb weight: 69 Kg)",
    unit: "QTY",
    fixedRate: 10148,
    rates: { ...defaultRates, "200": 10148 }
  },
  {
    itemCode: "2",
    itemName: "Labour charge per transformer",
    unit: "QTY",
    fixedRate: 2345,
    rates: { "5": 2345, "10": 2345, "16": 2345, "25": 2345, "50": 2345, "63": 2345, "100": 2345, "200": 2345, "315": 2345, "500": 2345 }
  },
  {
    itemCode: "3",
    itemName: "Tank replacement of same size & thickness (per KG)",
    unit: "KG",
    fixedRate: 54,
    rates: { "5": 54, "10": 54, "16": 54, "25": 54, "50": 54, "63": 54, "100": 54, "200": 54, "315": 54, "500": 54 }
  },
  {
    itemCode: "4",
    itemName: "Conservator Tank replacement of same size (per KG)",
    unit: "KG",
    fixedRate: 54,
    rates: { "5": 54, "10": 54, "16": 54, "25": 54, "50": 54, "63": 54, "100": 54, "200": 54, "315": 54, "500": 54 }
  },
  {
    itemCode: "5",
    itemName: "Complete Radiator replacement of same size",
    unit: "QTY",
    fixedRate: 1057,
    rates: { ...defaultRates, "25": 1057, "50": 1057, "63": 1256, "100": 1452, "200": 1452 }
  },
  {
    itemCode: "6",
    itemName: "Rate for sealing of uneconomical unit by welding at six places for returning back.",
    unit: "QTY",
    fixedRate: 189,
    rates: { "5": 189, "10": 189, "16": 189, "25": 189, "50": 189, "63": 189, "100": 189, "200": 189, "315": 189, "500": 189 }
  }
];
var defaultWoundCoreEstimateData = JSON.parse(JSON.stringify(defaultAmorphousEstimateData));
var defaultCircleLimitsEstimateData = [
  {
    itemCode: "01",
    itemName: "11 KV - 3 Star & other",
    unit: "Rs.",
    fixedRate: null,
    rates: {
      "5": 5422,
      "10": 8716,
      "16": 8696,
      "25": 10124,
      "50": 0,
      "63": 20423,
      "100": 24609,
      "200": 47170,
      "315": 0,
      "500": 148260
    }
  },
  {
    itemCode: "02",
    itemName: "11 KV - 4 Star",
    unit: "Rs.",
    fixedRate: null,
    rates: {
      "5": 6206,
      "10": 7707,
      "16": 11729,
      "25": 15651,
      "50": 0,
      "63": 23684,
      "100": 31094,
      "200": 65139,
      "315": 0,
      "500": 193768
    }
  },
  {
    itemCode: "03",
    itemName: "11 KV - Level-1",
    unit: "Rs.",
    fixedRate: null,
    rates: {
      "5": 0,
      "10": 8010,
      "16": 8475,
      "25": 9859,
      "50": 0,
      "63": 0,
      "100": 0,
      "200": 0,
      "315": 0,
      "500": 0
    }
  },
  {
    itemCode: "04",
    itemName: "11 KV - Level-2",
    unit: "Rs.",
    fixedRate: null,
    rates: {
      "5": 0,
      "10": 0,
      "16": 10851,
      "25": 13998,
      "50": 0,
      "63": 22137,
      "100": 27700,
      "200": 55986,
      "315": 0,
      "500": 198914
    }
  },
  {
    itemCode: "05",
    itemName: "22 KV (Amount in Rs.)",
    unit: "Rs.",
    fixedRate: null,
    rates: {
      "5": 0,
      "10": 0,
      "16": 16455,
      "25": 18889,
      "50": 0,
      "63": 33661,
      "100": 48700,
      "200": 87710,
      "315": 0,
      "500": 161287
    }
  }
];
var defaultOverhaulingEstimateData = [
  {
    itemCode: "7",
    itemName: "Overhauling of complete transformer:\nDuring overhauling, following works are required to be carried out:-\nOverhauling charges shall be paid for below works which includes the opening & closing/refitting of transformer including minor repairing works and loading & unloading of Transformers, repairing of Tanks & radiators by welding to stop leakage of oil, replacement of burnt /damaged external parts like bushing/ nut-bolts /breather if any with Dismantling of bushing replacement of all the old gaskets by new, opening welding of top cover plate if necessary un-tanking of the winding, removal of the core plate assembly and reassembly of the same including replacement of all types of insulations whenever necessary replacement of diaphragm of explosion vent, testing of the same, Cleaning of transformer tank, removal of sludge, filtration of transformer oil, Strengthening / brazing of joints of winding, Fitting/tightening of internal joints at the HV/LV bushing, Internal painting of transformer, Drying of the active parts of the transformer to ensure proper IR value as mentioned herein, fixing of name plates and as per conditions wherever mentioned in this tender.",
    unit: "QTY",
    fixedRate: 2061,
    rates: { "5": 2061, "10": 1603, "16": 1603, "25": 2061, "50": 2061, "63": 2061, "100": 2500, "200": 3e3, "315": 3e3, "500": 3e3 }
  },
  {
    itemCode: "3",
    itemName: "Tank replacement of same size & thickness (per KG)",
    unit: "KG",
    fixedRate: 54,
    rates: { "5": 54, "10": 54, "16": 54, "25": 54, "50": 54, "63": 54, "100": 54, "200": 54, "315": 54, "500": 54 }
  },
  {
    itemCode: "4",
    itemName: "Conservator Tank replacement of same size (per KG)",
    unit: "KG",
    fixedRate: 54,
    rates: { "5": 54, "10": 54, "16": 54, "25": 54, "50": 54, "63": 54, "100": 54, "200": 54, "315": 54, "500": 54 }
  },
  {
    itemCode: "5",
    itemName: "Complete Radiator replacement of same size",
    unit: "QTY",
    fixedRate: 1057,
    rates: { ...defaultRates, "25": 1057, "63": 1256, "100": 1452 }
  },
  {
    itemCode: "6",
    itemName: "Rate for sealing of uneconomical unit by welding at six places for returning back.",
    unit: "QTY",
    fixedRate: 189,
    rates: { "5": 189, "10": 189, "16": 189, "25": 189, "50": 189, "63": 189, "100": 189, "200": 189, "315": 189, "500": 189 }
  }
];
var defaultEstimateData = [
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
  {
    itemCode: "22",
    itemName: "Rate for inspection & dismantling charges of damaged transformer declared as scrap by E.E. (TR)",
    unit: "QTY",
    fixedRate: 500,
    rates: { "5": 500, "10": 500, "16": 500, "25": 500, "50": 500, "63": 500, "100": 500, "200": 500, "315": 500, "500": 500 }
  },
  { itemCode: "1a", itemName: "Dismentaling", unit: "QTY", rates: { ...defaultRates, "10": 1603, "16": 1603, "25": 2061, "63": 2061 } },
  { itemCode: "1b", itemName: "Repl. of Gaskets", unit: "QTY", rates: { ...defaultRates, "10": 40, "16": 40, "25": 46, "63": 46 } },
  { itemCode: "1c", itemName: "Repl. HV/LV Gaskets", unit: "QTY", rates: { ...defaultRates, "10": 28.75, "16": 28.75, "25": 34, "63": 34 } },
  { itemCode: "1d", itemName: "Repl. of Insulation", unit: "Y", rates: { ...defaultRates, "10": 229, "16": 229, "25": 286, "63": 286 } },
  { itemCode: "1e", itemName: "Repl. of M.S bolt-nuts", unit: "Y", rates: { ...defaultRates, "10": 46, "16": 46, "25": 57, "63": 57 } },
  { itemCode: "1f", itemName: "Drying of active parts", unit: "Y", rates: { ...defaultRates, "10": 183, "16": 183, "25": 229, "63": 229 } },
  { itemCode: "2a", itemName: "Cleaning Dirty Dank", unit: "Y", rates: { ...defaultRates, "10": 28.75, "16": 28.75, "25": 34, "63": 34 } },
  { itemCode: "2b", itemName: "Painting Out-Side", unit: "Y", rates: { ...defaultRates, "10": 115, "16": 115, "25": 149, "63": 149 } },
  { itemCode: "3", itemName: "Painting In-Side", unit: "N", rates: { ...defaultRates } },
  { itemCode: "5", itemName: "Oil Level Glass", unit: "Y", rates: { ...defaultRates, "10": 46, "16": 46, "25": 46, "63": 46 } },
  { itemCode: "6", itemName: "Breather", unit: "N", rates: { ...defaultRates } },
  { itemCode: "8", itemName: "HV Bushing", unit: "QTY", rates: { ...defaultRates, "10": 176, "16": 176, "25": 176, "63": 176 } },
  { itemCode: "9A", itemName: "HV Metal Parts", unit: "QTY", rates: { ...defaultRates, "10": 131, "16": 131, "25": 131, "63": 131 } },
  { itemCode: "9B", itemName: "HV Connector", unit: "QTY", rates: { ...defaultRates, "10": 80, "16": 80, "25": 80, "63": 80 } },
  { itemCode: "10", itemName: "LV Bushing", unit: "QTY", rates: { ...defaultRates, "10": 59.8, "16": 59.8, "25": 59.8, "63": 59.8 } },
  { itemCode: "11A", itemName: "LV Metal Parts", unit: "QTY", rates: { ...defaultRates, "10": 156, "16": 156, "25": 156, "63": 156 } },
  { itemCode: "11B", itemName: "LV Connector", unit: "QTY", rates: { ...defaultRates, "10": 149, "16": 149, "25": 149, "63": 149 } },
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
  { itemCode: "12A(b)", itemName: "HV Wdg. (Not Miss) -AL", unit: "QTY", rates: { ...defaultRates, "10": 163, "16": 163, "25": 163, "63": 163 } },
  { itemCode: "12A(b1)", itemName: "HV Wdg. (Not Miss) -AL S.E.", unit: "QTY", rates: { ...defaultRates, "10": 213, "16": 213, "25": 213, "63": 213 } },
  { itemCode: "12C", itemName: "HV Coil - Labour", unit: "QTY", rates: { ...defaultRates, "10": 34, "16": 34, "25": 34, "63": 34 } },
  { itemCode: "13A(a)", itemName: "LV Wdg. (Not Miss) -CU", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "13b(b)", itemName: "LV Wdg. (Not Miss) -AL", unit: "QTY", rates: { ...defaultRates, "10": 149, "16": 149, "25": 149, "63": 149 } },
  { itemCode: "13C", itemName: "LV Coil - Labour", unit: "QTY", rates: { ...defaultRates, "10": 51.75, "16": 51.75, "25": 51.75, "63": 51.75 } },
  { itemCode: "14(ii)CU", itemName: "LV Wdg. Re-Insu.-CU", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "14(ii)AL", itemName: "LV Wdg. Re-Insu.-AL", unit: "QTY", rates: { ...defaultRates, "10": 115, "16": 115, "25": 115, "63": 115 } },
  { itemCode: "15", itemName: "Washer Ring", unit: "QTY", rates: { ...defaultRates, "10": 54, "16": 54, "25": 54, "63": 54 } },
  { itemCode: "16", itemName: "Name Plate", unit: "N", rates: { ...defaultRates } },
  { itemCode: "18", itemName: "Repl. Of Tank", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "20", itemName: "Testing Of Trans.", unit: "Y", rates: { ...defaultRates, "10": 115, "16": 115, "25": 172, "63": 172 } },
  { itemCode: "21", itemName: "Repl. Of Rediator", unit: "Y", rates: { ...defaultRates, "10": 1052, "16": 1052, "25": 1052, "63": 1248 } },
  { itemCode: "17", itemName: "Con. of Sealed to Bolt", unit: "N", rates: { ...defaultRates } }
];

// src/lib/agencySeed.ts
var AGENCY_SEED = {
  estimateMasterCRGO: defaultEstimateData,
  // ⚠ NO `estimateMaster` MIRROR. A new agency has no legacy to support, and being born with an
  // unread duplicate is how every existing agency acquired one (AUDIT D4).
  estimateMasterAmorphous: defaultAmorphousEstimateData,
  estimateMasterWoundCore: defaultWoundCoreEstimateData,
  estimateMasterOverhauling: defaultOverhaulingEstimateData,
  estimateMasterCircleLimits: defaultCircleLimitsEstimateData
};
function buildNewAgencyDocument(agencyData, ownerId) {
  return {
    ...AGENCY_SEED,
    ...agencyData,
    ownerId
  };
}
function canonicalJson(value) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o = v;
      return Object.keys(o).sort().reduce((acc, k) => {
        acc[k] = walk(o[k]);
        return acc;
      }, {});
    }
    return v;
  };
  return JSON.stringify(walk(value));
}
export {
  AGENCY_SEED,
  buildNewAgencyDocument,
  canonicalJson
};
