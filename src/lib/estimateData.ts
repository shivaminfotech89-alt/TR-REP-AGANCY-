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

// Official UGVCL Rate Schedule for OVERHAULING OF TRANSFORMER (11 KV / 22 KV)
export const defaultOverhaulingEstimateData: EstimateItem[] = [
  {
    itemCode: "7",
    itemName: "Overhauling of complete transformer:\nDuring overhauling, following works are required to be carried out:-\nOverhauling charges shall be paid for below works which includes the opening & closing/refitting of transformer including minor repairing works and loading & unloading of Transformers, repairing of Tanks & radiators by welding to stop leakage of oil, replacement of burnt /damaged external parts like bushing/ nut-bolts /breather if any with Dismantling of bushing replacement of all the old gaskets by new, opening welding of top cover plate if necessary un-tanking of the winding, removal of the core plate assembly and reassembly of the same including replacement of all types of insulations whenever necessary replacement of diaphragm of explosion vent, testing of the same, Cleaning of transformer tank, removal of sludge, filtration of transformer oil, Strengthening / brazing of joints of winding, Fitting/tightening of internal joints at the HV/LV bushing, Internal painting of transformer, Drying of the active parts of the transformer to ensure proper IR value as mentioned herein, fixing of name plates and as per conditions wherever mentioned in this tender.",
    unit: "QTY",
    fixedRate: 2061.00,
    rates: { "5": 2061.00, "10": 1603.00, "16": 1603.00, "25": 2061.00, "50": 2061.00, "63": 2061.00, "100": 2500.00, "200": 3000.00, "315": 3000.00, "500": 3000.00 }
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

export const defaultEstimateData: EstimateItem[] = [
  { itemCode: "1a", itemName: "Dismentaling", unit: "QTY", rates: { ...defaultRates, "10": 1603.00, "16": 1603.00, "25": 2061.00, "63": 2061.00 } },
  { itemCode: "1b", itemName: "Repl. of Gaskets", unit: "QTY", rates: { ...defaultRates, "10": 40.00, "16": 40.00, "25": 46.00, "63": 46.00 } },
  { itemCode: "1c", itemName: "Repl. HV/LV Gaskets", unit: "QTY", rates: { ...defaultRates, "10": 28.75, "16": 28.75, "25": 34.00, "63": 34.00 } },
  { itemCode: "1d", itemName: "Repl. of Insulation", unit: "Y", rates: { ...defaultRates, "10": 229.00, "16": 229.00, "25": 286.00, "63": 286.00 } },
  { itemCode: "1e", itemName: "Repl. of M.S bolt-nuts", unit: "Y", rates: { ...defaultRates, "10": 46.00, "16": 46.00, "25": 57.00, "63": 57.00 } },
  { itemCode: "1f", itemName: "Drying of active parts", unit: "Y", rates: { ...defaultRates, "10": 183.00, "16": 183.00, "25": 229.00, "63": 229.00 } },
  { itemCode: "2a", itemName: "Cleaning Dirty Dank", unit: "Y", rates: { ...defaultRates, "10": 28.75, "16": 28.75, "25": 34.00, "63": 34.00 } },
  { itemCode: "2b", itemName: "Painting Out-Side", unit: "Y", rates: { ...defaultRates, "10": 115.00, "16": 115.00, "25": 149.00, "63": 149.00 } },
  { itemCode: "3", itemName: "Painting In-Side", unit: "N", rates: { ...defaultRates } },
  { itemCode: "5", itemName: "Oil Level Glass", unit: "Y", rates: { ...defaultRates, "10": 46.00, "16": 46.00, "25": 46.00, "63": 46.00 } },
  { itemCode: "6", itemName: "Breather", unit: "N", rates: { ...defaultRates } },
  { itemCode: "8", itemName: "HV Bushing", unit: "QTY", rates: { ...defaultRates, "10": 176.00, "16": 176.00, "25": 176.00, "63": 176.00 } },
  { itemCode: "9A", itemName: "HV Metal Parts", unit: "QTY", rates: { ...defaultRates, "10": 131.00, "16": 131.00, "25": 131.00, "63": 131.00 } },
  { itemCode: "9B", itemName: "HV Connector", unit: "QTY", rates: { ...defaultRates, "10": 80.00, "16": 80.00, "25": 80.00, "63": 80.00 } },
  { itemCode: "10", itemName: "LV Bushing", unit: "QTY", rates: { ...defaultRates, "10": 59.80, "16": 59.80, "25": 59.80, "63": 59.80 } },
  { itemCode: "11A", itemName: "LV Metal Parts", unit: "QTY", rates: { ...defaultRates, "10": 156.00, "16": 156.00, "25": 156.00, "63": 156.00 } },
  { itemCode: "11B", itemName: "LV Connector", unit: "QTY", rates: { ...defaultRates, "10": 149.00, "16": 149.00, "25": 149.00, "63": 149.00 } },
  { itemCode: "12A(a)", itemName: "HV Wdg. (Not Miss) -CU", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "12A(b)", itemName: "HV Wdg. (Not Miss) -AL", unit: "QTY", rates: { ...defaultRates, "10": 163.00, "16": 163.00, "25": 163.00, "63": 163.00 } },
  { itemCode: "12C", itemName: "HV Coil - Labour", unit: "QTY", rates: { ...defaultRates, "10": 34.00, "16": 34.00, "25": 34.00, "63": 34.00 } },
  { itemCode: "13A(a)", itemName: "LV Wdg. (Not Miss) -CU", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "13b(b)", itemName: "LV Wdg. (Not Miss) -AL", unit: "QTY", rates: { ...defaultRates, "10": 149.00, "16": 149.00, "25": 149.00, "63": 149.00 } },
  { itemCode: "13C", itemName: "LV Coil - Labour", unit: "QTY", rates: { ...defaultRates, "10": 51.75, "16": 51.75, "25": 51.75, "63": 51.75 } },
  { itemCode: "14(ii)CU", itemName: "LV Wdg. Re-Insu.-CU", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "14(ii)AL", itemName: "LV Wdg. Re-Insu.-AL", unit: "QTY", rates: { ...defaultRates, "10": 115.00, "16": 115.00, "25": 115.00, "63": 115.00 } },
  { itemCode: "15", itemName: "Washer Ring", unit: "QTY", rates: { ...defaultRates, "10": 54.00, "16": 54.00, "25": 54.00, "63": 54.00 } },
  { itemCode: "16", itemName: "Name Plate", unit: "N", rates: { ...defaultRates } },
  { itemCode: "18", itemName: "Repl. Of Tank", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "20", itemName: "Testing Of Trans.", unit: "Y", rates: { ...defaultRates, "10": 115.00, "16": 115.00, "25": 172.00, "63": 172.00 } },
  { itemCode: "21", itemName: "Repl. Of Rediator", unit: "Y", rates: { ...defaultRates, "10": 1052.00, "16": 1052.00, "25": 1052.00, "63": 1248.00 } },
  { itemCode: "17", itemName: "Con. of Sealed to Bolt", unit: "N", rates: { ...defaultRates } }
];
