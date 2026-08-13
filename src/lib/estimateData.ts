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
  rates: EstimateRates;
}

const defaultRates: EstimateRates = { 
  "5": null, "10": null, "16": null, "25": null, "50": null, "63": null, "100": null, "200": null, "315": null, "500": null 
};

export const defaultAmorphousEstimateData: EstimateItem[] = [
  { itemCode: "1a", itemName: "Repairing of 25 KVA Transformer (AL)", unit: "QTY", rates: { ...defaultRates, "25": 0.00 } },
  { itemCode: "1b", itemName: "Repairing of 63 KVA Transformer (AL)", unit: "QTY", rates: { ...defaultRates, "63": 0.00 } },
  { itemCode: "1c", itemName: "Repairing of 100 KVA Transformer (AL)", unit: "QTY", rates: { ...defaultRates, "100": 0.00 } },
  { itemCode: "1d", itemName: "Repairing of 100 KVA Transformer (CU)", unit: "QTY", rates: { ...defaultRates, "100": 0.00 } },
  { itemCode: "1e", itemName: "Repairing of 200 KVA Transformer (AL)", unit: "QTY", rates: { ...defaultRates, "200": 0.00 } },
  { itemCode: "2", itemName: "Labour charge per transformer", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "3", itemName: "Tank Replacement of same size & Thickness (per KG)", unit: "KG", rates: { ...defaultRates } },
  { itemCode: "4", itemName: "Conservator Tank Replacement of Same Size (Per KG)", unit: "KG", rates: { ...defaultRates } },
  { itemCode: "5", itemName: "Complete Radiator Replacement of Same Size (Per No)", unit: "QTY", rates: { ...defaultRates } },
  { itemCode: "6", itemName: "Labour charge per transformer", unit: "QTY", rates: { ...defaultRates } },
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
