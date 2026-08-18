import React from 'react';
import { LetterheadHeader, PrintableA4Page } from './LetterheadHeader';
import { formatDDMMYYYY } from '../lib/utils';
import { getAtPercentageForCore, getEstimateMasterForCore } from '../lib/AgencyContext';
import { defaultEstimateData, EstimateItem } from '../lib/estimateData';

export interface SingleEstimateLineItem {
  sr: number;
  itemCode?: string;
  desc: string;
  unit: string;
  qty: string;
  numQty: number;
  rate: number;
  amt: number;
}

export interface SingleJobEstimateData {
  job: any;
  externalData?: any;
  internalData?: any;
  physicalItems: SingleEstimateLineItem[];
  internalItems: SingleEstimateLineItem[];
  labourItems: SingleEstimateLineItem[];
  baseTotal: number;
  atPercentage: number;
  percentageAmount: number;
  amountWithPercentage: number;
  lessAmount: number;
  finalAmount: number;
}

export function buildSingleJobEstimateData(
  job: any,
  agency: any,
  atMaster: any,
  externalData?: any,
  internalData?: any
): SingleJobEstimateData {
  const kva = String(job.capacityKva || '25').trim();
  const coreType = (job.coreType || 'CRGO').trim().toUpperCase();
  const masterList = getEstimateMasterForCore(agency, coreType);
  const atPercentage = getAtPercentageForCore(atMaster, coreType);

  const isScrap = job.status === 'Scrap' || job.condition === 'Scrap' || internalData?.condition === 'Scrap';
  const winding = (internalData?.windingType || 'Aluminium').trim();
  const windingSuffix = winding.toUpperCase().startsWith('CU') ? 'Copper' : 'Aluminium SE';

  // Helper to find item rate in master
  const getItemRate = (code: string, fallbackRate: number): number => {
    const found = masterList.find(m => m.itemCode?.toLowerCase() === code.toLowerCase());
    if (found) {
      if (found.rates && found.rates[kva as keyof typeof found.rates] !== undefined && found.rates[kva as keyof typeof found.rates] !== null) {
        const val = Number(found.rates[kva as keyof typeof found.rates]);
        if (!isNaN(val) && val > 0) return val;
      }
      if (found.fixedRate && Number(found.fixedRate) > 0) return Number(found.fixedRate);
    }
    // Check in default estimate data
    const def = defaultEstimateData.find(m => m.itemCode?.toLowerCase() === code.toLowerCase());
    if (def && def.rates && def.rates[kva as keyof typeof def.rates]) {
      return Number(def.rates[kva as keyof typeof def.rates]) || fallbackRate;
    }
    return fallbackRate;
  };

  // 1. PHYSICAL ESTIMATION ITEMS
  const physicalItems: SingleEstimateLineItem[] = [];
  let srCounter = 1;

  // 1. Name Plating
  const npRate = getItemRate('16', 143);
  const npQtyStr = (externalData?.namePlate === 'N' || externalData?.namePlate === '0' || externalData?.namePlate === '-') ? 'N' : 'Y';
  const npAmt = npQtyStr === 'Y' ? npRate : 0;
  physicalItems.push({ sr: srCounter++, itemCode: '16', desc: 'Name Plating', unit: 'NO', qty: npQtyStr, numQty: npQtyStr === 'Y' ? 1 : 0, rate: npRate, amt: npAmt });

  // 2. Spray painting
  const spRate = getItemRate('2b', 149);
  const spQtyStr = (externalData?.outsidePaint === 'N' || externalData?.outsidePaint === '0') ? 'N' : 'Y';
  const spAmt = spQtyStr === 'Y' ? spRate : 0;
  physicalItems.push({ sr: srCounter++, itemCode: '2b', desc: 'Spray painting', unit: 'NO', qty: spQtyStr, numQty: spQtyStr === 'Y' ? 1 : 0, rate: spRate, amt: spAmt });

  // 3. Conservator Tank Replacement
  const ctRate = getItemRate('4', 54);
  const ctQty = Number(externalData?.damCtTank) || 0;
  physicalItems.push({ sr: srCounter++, itemCode: '4', desc: 'Conservator Tank Replacement', unit: 'KG', qty: ctQty > 0 ? ctQty.toString() : '0', numQty: ctQty, rate: ctRate, amt: ctQty * ctRate });

  // 4. Radiator Replacement
  const radRate = getItemRate('21', 1248);
  const radQty = Number(externalData?.damRadNo) || 0;
  physicalItems.push({ sr: srCounter++, itemCode: '21', desc: 'Radiator Replacement', unit: 'NO', qty: radQty > 0 ? radQty.toString() : '0', numQty: radQty, rate: radRate, amt: radQty * radRate });

  // 5. Rod Gasket
  const rodRate = getItemRate('1c', 34);
  const rodQty = externalData?.hvLvRod !== undefined && externalData?.hvLvRod !== '' ? Number(externalData.hvLvRod) : 7;
  physicalItems.push({ sr: srCounter++, itemCode: '1c', desc: 'Rod Gasket', unit: 'ROD', qty: rodQty.toString(), numQty: rodQty, rate: rodRate, amt: rodQty * rodRate });

  // 6. M/S Bolt Nuts
  const bnRate = getItemRate('1e', 57);
  const bnQtyStr = (externalData?.nuteBolt === 'N' || externalData?.nuteBolt === '0') ? 'N' : 'Y';
  const bnAmt = bnQtyStr === 'Y' ? bnRate : 0;
  physicalItems.push({ sr: srCounter++, itemCode: '1e', desc: 'M/S Bolt Nuts', unit: 'JOB', qty: bnQtyStr, numQty: bnQtyStr === 'Y' ? 1 : 0, rate: bnRate, amt: bnAmt });

  // 7. Top Cover Gasket
  const gaskRate = getItemRate('1b', 46);
  const gaskQty = externalData?.gasket !== undefined && externalData?.gasket !== '' ? Number(externalData.gasket) : (Number(kva) >= 63 ? 3 : 1);
  physicalItems.push({ sr: srCounter++, itemCode: '1b', desc: 'Top Cover Gasket', unit: 'NO', qty: gaskQty.toString(), numQty: gaskQty, rate: gaskRate, amt: gaskQty * gaskRate });

  // 8. Oil Guage Glass
  const oggRate = getItemRate('5', 46);
  const oggQtyStr = (externalData?.oilLevGls === 'N' || externalData?.oilLevGls === '0') ? 'N' : 'Y';
  const oggAmt = oggQtyStr === 'Y' ? oggRate : 0;
  physicalItems.push({ sr: srCounter++, itemCode: '5', desc: 'Oil Guage Glass', unit: 'NO', qty: oggQtyStr, numQty: oggQtyStr === 'Y' ? 1 : 0, rate: oggRate, amt: oggAmt });

  // 9. Breather
  const brRate = getItemRate('6', 309);
  const brQtyStr = (externalData?.breather === 'N' || externalData?.breather === '0') ? 'N' : 'Y';
  const brAmt = brQtyStr === 'Y' ? brRate : 0;
  physicalItems.push({ sr: srCounter++, itemCode: '6', desc: 'Breather', unit: 'NO', qty: brQtyStr, numQty: brQtyStr === 'Y' ? 1 : 0, rate: brRate, amt: brAmt });

  // 10. HV Bushing
  const hvbRate = getItemRate('8', 176);
  const hvbQty = externalData?.hvSideHvb !== undefined && externalData?.hvSideHvb !== '' ? Number(externalData.hvSideHvb) : (isScrap ? 0 : 3);
  physicalItems.push({ sr: srCounter++, itemCode: '8', desc: 'HV Bushing', unit: 'NO', qty: hvbQty.toString(), numQty: hvbQty, rate: hvbRate, amt: hvbQty * hvbRate });

  // 11. HV Metal Parts
  const hvmRate = getItemRate('9A', 131);
  const hvmQty = externalData?.hvSideHvm !== undefined && externalData?.hvSideHvm !== '' ? Number(externalData.hvSideHvm) : (isScrap ? 0 : 2);
  physicalItems.push({ sr: srCounter++, itemCode: '9A', desc: 'HV Metal Parts', unit: 'NO', qty: hvmQty.toString(), numQty: hvmQty, rate: hvmRate, amt: hvmQty * hvmRate });

  // 12. HV Connectors
  const hvcRate = getItemRate('9B', 80);
  const hvcQty = externalData?.hvSideHvCc !== undefined && externalData?.hvSideHvCc !== '' ? Number(externalData.hvSideHvCc) : 0;
  physicalItems.push({ sr: srCounter++, itemCode: '9B', desc: 'HV Connectors', unit: 'NO', qty: hvcQty.toString(), numQty: hvcQty, rate: hvcRate, amt: hvcQty * hvcRate });

  // 13. LV Bushing
  const lvbRate = getItemRate('10', 59.80);
  const lvbQty = externalData?.lvSideLvb !== undefined && externalData?.lvSideLvb !== '' ? Number(externalData.lvSideLvb) : (isScrap ? 0 : 1);
  physicalItems.push({ sr: srCounter++, itemCode: '10', desc: 'LV Bushing', unit: 'NO', qty: lvbQty.toString(), numQty: lvbQty, rate: lvbRate, amt: lvbQty * lvbRate });

  // 14. LV Metal Parts
  const lvmRate = getItemRate('11A', 156);
  const lvmQty = externalData?.lvSideLvm !== undefined && externalData?.lvSideLvm !== '' ? Number(externalData.lvSideLvm) : (isScrap ? 0 : 4);
  physicalItems.push({ sr: srCounter++, itemCode: '11A', desc: 'LV Metal Parts', unit: 'NO', qty: lvmQty.toString(), numQty: lvmQty, rate: lvmRate, amt: lvmQty * lvmRate });

  // 15. LV Connectors
  const lvcRate = getItemRate('11B', 149);
  const lvcQty = externalData?.lvSideLvCc !== undefined && externalData?.lvSideLvCc !== '' ? Number(externalData.lvSideLvCc) : 0;
  physicalItems.push({ sr: srCounter++, itemCode: '11B', desc: 'LV Connectors', unit: 'NO', qty: lvcQty.toString(), numQty: lvcQty, rate: lvcRate, amt: lvcQty * lvcRate });

  // 16. Sealed to Bolted
  const stbRate = getItemRate('17', 1511);
  const stbIsBolted = (externalData?.sealType === 'B' || externalData?.sealType === 'Bolted' || externalData?.sealType === 'Y');
  const stbQtyStr = stbIsBolted ? 'Y' : 'N';
  const stbAmt = stbIsBolted ? stbRate : 0;
  physicalItems.push({ sr: srCounter++, itemCode: '17', desc: 'Sealed to Bolted', unit: 'NO', qty: stbQtyStr, numQty: stbIsBolted ? 1 : 0, rate: stbRate, amt: stbAmt });


  // 2. INTERNAL ESTIMATION ITEMS
  const internalItems: SingleEstimateLineItem[] = [];

  // 17. Inside Painting
  const ipRate = getItemRate('3', 156);
  const ipQtyStr = (internalData?.inPnt === 'N' || internalData?.inPnt === '0') ? 'N' : 'Y';
  const ipAmt = ipQtyStr === 'Y' ? ipRate : 0;
  internalItems.push({ sr: srCounter++, itemCode: '3', desc: 'Inside Painting', unit: 'NO', qty: ipQtyStr, numQty: ipQtyStr === 'Y' ? 1 : 0, rate: ipRate, amt: ipAmt });

  // 18. Insulating Material
  const insRate = getItemRate('1d', 286);
  const insQtyStr = (internalData?.insula === 'N' || internalData?.insula === '0' || isScrap) ? 'N' : 'Y';
  const insAmt = insQtyStr === 'Y' ? insRate : 0;
  internalItems.push({ sr: srCounter++, itemCode: '1d', desc: 'Insulating Material', unit: 'JOB', qty: insQtyStr, numQty: insQtyStr === 'Y' ? 1 : 0, rate: insRate, amt: insAmt });

  // 19. Washer Ring
  const wrRate = getItemRate('15', 54);
  const wrQty = internalData?.wasring !== undefined && internalData?.wasring !== '' ? Number(internalData.wasring) : (isScrap ? 0 : 6);
  internalItems.push({ sr: srCounter++, itemCode: '15', desc: 'Washer Ring', unit: 'NO', qty: wrQty.toString(), numQty: wrQty, rate: wrRate, amt: wrQty * wrRate });

  // 20. HV Coil(Aluminium SE)-N
  const hvCoilRate = getItemRate('12A', 213);
  let hvCoilWeight = 0;
  if (internalData?.totWt && Number(internalData.totWt) > 0) {
    hvCoilWeight = Number(internalData.totWt);
  } else if (internalData?.wtOfCoil && internalData?.totCoil) {
    hvCoilWeight = Number(internalData.wtOfCoil) * Number(internalData.totCoil);
  } else if (!isScrap) {
    hvCoilWeight = Number(kva) === 63 ? 47.00 : (Number(kva) === 25 ? 15.54 : (Number(kva) === 100 ? 55.00 : 14.00));
  }
  const hvCoilAmt = isScrap ? 0 : hvCoilWeight * hvCoilRate;
  internalItems.push({ 
    sr: srCounter++, 
    itemCode: '12A', 
    desc: `HV Coil(${windingSuffix})-N`, 
    unit: 'KG', 
    qty: hvCoilWeight.toFixed(2), 
    numQty: hvCoilWeight, 
    rate: hvCoilRate, 
    amt: hvCoilAmt 
  });

  // 21. LV Coil(Aluminium)-N
  const lvCoilRate = getItemRate('13A', 149);
  let lvCoilWeight = 0;
  if (internalData?.totWtLv && Number(internalData.totWtLv) > 0) {
    lvCoilWeight = Number(internalData.totWtLv);
  }
  const lvCoilAmt = isScrap ? 0 : lvCoilWeight * lvCoilRate;
  internalItems.push({ 
    sr: srCounter++, 
    itemCode: '13A', 
    desc: `LV Coil(${winding.toUpperCase().startsWith('CU') ? 'Copper' : 'Aluminium'})-N`, 
    unit: 'KG', 
    qty: lvCoilWeight.toFixed(2), 
    numQty: lvCoilWeight, 
    rate: lvCoilRate, 
    amt: lvCoilAmt 
  });

  // 22. Re-insulation LV Coil(Aluminium)
  const reInsRate = getItemRate('14', 115);
  let reInsWeight = 0;
  // If LV coils are OK or RI (not replaced as new), calculate re-insulation weight
  if (!isScrap && (internalData?.lvCoilR !== 'DMG' || internalData?.lvCoilY !== 'DMG' || internalData?.lvCoilB !== 'DMG')) {
    if (lvCoilWeight === 0) {
      reInsWeight = Number(kva) === 63 ? 24.30 : (Number(kva) === 25 ? 15.54 : (Number(kva) === 100 ? 35.00 : 12.00));
    }
  }
  const reInsAmt = isScrap ? 0 : reInsWeight * reInsRate;
  internalItems.push({ 
    sr: srCounter++, 
    itemCode: '14', 
    desc: `Re-insulation LV Coil(${winding.toUpperCase().startsWith('CU') ? 'Copper' : 'Aluminium'})`, 
    unit: 'KG', 
    qty: reInsWeight.toFixed(2), 
    numQty: reInsWeight, 
    rate: reInsRate, 
    amt: reInsAmt 
  });


  // 3. LABOUR CHARGE ITEMS
  const labourItems: SingleEstimateLineItem[] = [];

  // 23. Labour Charge (Basic Dismantling / DC) - 100% Mandatory
  const dcRate = getItemRate('1a', 2061);
  labourItems.push({ sr: srCounter++, itemCode: '1a', desc: 'Labour Charge', unit: 'JOB', qty: '1', numQty: 1, rate: dcRate, amt: dcRate });

  // 24. Cleaning dirty tank
  const cdtRate = getItemRate('2a', 34);
  const cdtQtyStr = (externalData?.clnDrtyTank === 'N' || externalData?.clnDrtyTank === '0') ? 'N' : 'Y';
  const cdtAmt = cdtQtyStr === 'Y' ? cdtRate : 0;
  labourItems.push({ sr: srCounter++, itemCode: '2a', desc: 'Cleaning dirty tank', unit: 'NO', qty: cdtQtyStr, numQty: cdtQtyStr === 'Y' ? 1 : 0, rate: cdtRate, amt: cdtAmt });

  // 25. Drying of active parts
  const dryRate = getItemRate('1f', 229);
  const dryQtyStr = (internalData?.dc === 'N' || internalData?.dc === '0' || externalData?.dryActPart === 'N' || isScrap) ? 'N' : 'Y';
  const dryAmt = dryQtyStr === 'Y' ? dryRate : 0;
  labourItems.push({ sr: srCounter++, itemCode: '1f', desc: 'Drying of active parts', unit: 'JOB', qty: dryQtyStr, numQty: dryQtyStr === 'Y' ? 1 : 0, rate: dryRate, amt: dryAmt });

  // 26. Scrap
  const scrapRate = getItemRate('19', 0);
  const scrapQtyStr = isScrap ? 'Y' : 'N';
  const scrapAmt = isScrap ? scrapRate : 0;
  labourItems.push({ sr: srCounter++, itemCode: '19', desc: 'Scrap', unit: '0', qty: scrapQtyStr, numQty: isScrap ? 1 : 0, rate: scrapRate, amt: scrapAmt });

  // 27. Testing Charge
  const testRate = getItemRate('20', 172);
  const testQtyStr = (internalData?.tstTrn === 'N' || internalData?.tstTrn === '0' || isScrap) ? 'N' : 'Y';
  const testAmt = testQtyStr === 'Y' ? testRate : 0;
  labourItems.push({ sr: srCounter++, itemCode: '20', desc: 'Testing Charge', unit: 'NO', qty: testQtyStr, numQty: testQtyStr === 'Y' ? 1 : 0, rate: testRate, amt: testAmt });

  // 28. Labour HV Coil(Aluminium)
  const lbrHvRate = getItemRate('12C', 34);
  const lbrHvWeight = isScrap ? 0 : hvCoilWeight;
  const lbrHvAmt = lbrHvWeight * lbrHvRate;
  labourItems.push({ 
    sr: srCounter++, 
    itemCode: '12C', 
    desc: `Labour HV Coil(${winding.toUpperCase().startsWith('CU') ? 'Copper' : 'Aluminium'})`, 
    unit: 'KG', 
    qty: lbrHvWeight.toFixed(2), 
    numQty: lbrHvWeight, 
    rate: lbrHvRate, 
    amt: lbrHvAmt 
  });

  // 29. Labour LV Coil(Aluminium)
  const lbrLvRate = getItemRate('13C', 51.75);
  const lbrLvWeight = isScrap ? 0 : lvCoilWeight;
  const lbrLvAmt = lbrLvWeight * lbrLvRate;
  labourItems.push({ 
    sr: srCounter++, 
    itemCode: '13C', 
    desc: `Labour LV Coil(${winding.toUpperCase().startsWith('CU') ? 'Copper' : 'Aluminium'})`, 
    unit: 'KG', 
    qty: lbrLvWeight.toFixed(2), 
    numQty: lbrLvWeight, 
    rate: lbrLvRate, 
    amt: lbrLvAmt 
  });

  // Calculate Totals
  const physicalTot = physicalItems.reduce((acc, i) => acc + i.amt, 0);
  const internalTot = internalItems.reduce((acc, i) => acc + i.amt, 0);
  const labourTot = labourItems.reduce((acc, i) => acc + i.amt, 0);

  const baseTotal = physicalTot + internalTot + labourTot;
  const percentageAmount = Number((baseTotal * (atPercentage / 100)).toFixed(2));
  const amountWithPercentage = Number((baseTotal + percentageAmount).toFixed(2));
  const lessAmount = 0.00;
  const finalAmount = Number((amountWithPercentage - lessAmount).toFixed(2));

  return {
    job,
    externalData,
    internalData,
    physicalItems,
    internalItems,
    labourItems,
    baseTotal,
    atPercentage,
    percentageAmount,
    amountWithPercentage,
    lessAmount,
    finalAmount
  };
}

export interface SingleJobEstimateReportProps {
  key?: React.Key;
  job: any;
  agency: any;
  atMaster: any;
  externalData?: any;
  internalData?: any;
  estimateDate?: string;
  letterDateText?: string;
  className?: string;
}

export default function SingleJobEstimateReport({
  job,
  agency,
  atMaster,
  externalData,
  internalData,
  estimateDate,
  letterDateText,
  className = ''
}: SingleJobEstimateReportProps) {
  const estimate = buildSingleJobEstimateData(job, agency, atMaster, externalData, internalData);
  const dateFormatted = letterDateText || formatDDMMYYYY(estimateDate || job.estimateSentDate || job.updatedAt || new Date());
  const mrDateFormatted = formatDDMMYYYY(job.dateOfIssue || job.mrDate || job.createdAt);
  const orderNo = agency?.atDetails?.orderNo || agency?.contractAgreementNo || atMaster?.orderNo || 'UGVCL/EE-T-1/TRANS-REP/2020-21/01/1102';
  const orderDate = agency?.atDetails?.orderDate || '16/04/2021';

  const windingTypeStr = estimate.internalData?.windingType === 'CU' ? 'Copper' : 'Aluminium SE';
  const voltageRating = job.starRating || job.ratingLevel || '3 Star';
  const oilCap = externalData?.oilCapLtrs || job.oilCapacity || '145.00';
  const oilShort = externalData?.lessOilLtrs || job.oilShortage || '0.00';

  const formatCurrency = (val: number) => {
    return val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <PrintableA4Page agency={agency} orientation="portrait" className={`text-black ${className}`}>
      <div className="flex flex-col justify-between h-full text-black">
        <div>
          {/* Header Title */}
          <div className="text-center mb-2 pb-1 border-b-2 border-black">
            <h2 className="text-base font-black uppercase tracking-wider">ESTIMATION REPORT</h2>
          </div>

          {/* 2-Column Metadata Box */}
          <div className="grid grid-cols-2 text-[10px] border border-black p-2 mb-2 leading-relaxed bg-white">
            <div className="space-y-0.5 border-r border-black pr-2">
              <div className="flex">
                <span className="font-bold w-24">Job No.:</span>
                <span className="font-mono font-bold">{job.jobNo} {job.repairType === 'GP' ? '(GP)' : ''}</span>
              </div>
              <div className="flex">
                <span className="font-bold w-24">Manufacturer:</span>
                <span className="font-bold uppercase truncate">{job.make || '-'}</span>
              </div>
              <div className="flex">
                <span className="font-bold w-24">Serial No.:</span>
                <span className="font-mono">{job.serialNo || '-'}</span>
              </div>
              <div className="flex">
                <span className="font-bold w-24">KVA/KV:</span>
                <span className="font-bold">{job.capacityKva}/11</span>
              </div>
              <div className="flex">
                <span className="font-bold w-24">Oil Capacity:</span>
                <span className="font-mono">{Number(oilCap).toFixed(2)}</span>
              </div>
              <div className="flex">
                <span className="font-bold w-24">Oil Shortage:</span>
                <span className="font-mono">{Number(oilShort).toFixed(2)}</span>
              </div>
              <div className="flex text-[9px] pt-0.5">
                <span className="font-bold w-24">Order No.:</span>
                <span className="font-mono truncate">{orderNo}, Dt.: {orderDate}</span>
              </div>
            </div>

            <div className="space-y-0.5 pl-2">
              <div className="flex">
                <span className="font-bold w-24">Date:</span>
                <span className="font-mono">{dateFormatted}</span>
              </div>
              <div className="flex">
                <span className="font-bold w-24">Division:</span>
                <span className="font-bold uppercase">{job.division || 'SABARMATI'}</span>
              </div>
              <div className="flex">
                <span className="font-bold w-24">Mr. No.:</span>
                <span className="font-mono font-bold">{job.mrNo}</span>
              </div>
              <div className="flex">
                <span className="font-bold w-24">Mr. Date:</span>
                <span className="font-mono">{mrDateFormatted}</span>
              </div>
              <div className="flex">
                <span className="font-bold w-24">Service Type:</span>
                <span className="font-bold">{job.repairType || 'OGP'}</span>
              </div>
              <div className="flex">
                <span className="font-bold w-24">Winding Type:</span>
                <span className="font-bold">{windingTypeStr}</span>
              </div>
              <div className="flex">
                <span className="font-bold w-24">Voltage Class:</span>
                <span className="font-bold">{voltageRating}</span>
              </div>
            </div>
          </div>

          {/* Line Items Table */}
          <table className="w-full border-collapse border border-black text-[8.5px]">
            <thead>
              <tr className="bg-slate-100 print:bg-transparent font-bold border-b border-black text-center">
                <th className="border border-black p-1 w-8">Sr. No.</th>
                <th className="border border-black p-1 text-left min-w-[200px]">Item Description</th>
                <th className="border border-black p-1 w-12">Unit</th>
                <th className="border border-black p-1 w-14">Quantity</th>
                <th className="border border-black p-1 text-right w-16">Unit Rate</th>
                <th className="border border-black p-1 text-right w-20">Amount</th>
              </tr>
            </thead>
            <tbody>
              {/* SECTION 1: PHYSICAL ESTIMATION */}
              <tr className="bg-slate-200 print:bg-slate-100 font-bold border-b border-black">
                <td colSpan={6} className="p-0.5 text-center uppercase tracking-wider text-[9px]">
                  Physical Estimation
                </td>
              </tr>
              {estimate.physicalItems.map((item) => (
                <tr key={`phys-${item.sr}`} className="border-b border-slate-300 print:border-black h-4.5">
                  <td className="border-r border-black p-0.5 text-center font-mono">{item.sr}</td>
                  <td className="border-r border-black p-0.5 pl-1">{item.desc}</td>
                  <td className="border-r border-black p-0.5 text-center font-semibold">{item.unit}</td>
                  <td className="border-r border-black p-0.5 text-center font-mono">{item.qty}</td>
                  <td className="border-r border-black p-0.5 text-right font-mono">{formatCurrency(item.rate)}</td>
                  <td className="border-r border-black p-0.5 text-right font-mono font-medium">{formatCurrency(item.amt)}</td>
                </tr>
              ))}

              {/* SECTION 2: INTERNAL ESTIMATION */}
              <tr className="bg-slate-200 print:bg-slate-100 font-bold border-t border-b border-black">
                <td colSpan={6} className="p-0.5 text-center uppercase tracking-wider text-[9px]">
                  Internal Estimation
                </td>
              </tr>
              {estimate.internalItems.map((item) => (
                <tr key={`int-${item.sr}`} className="border-b border-slate-300 print:border-black h-4.5">
                  <td className="border-r border-black p-0.5 text-center font-mono">{item.sr}</td>
                  <td className="border-r border-black p-0.5 pl-1">{item.desc}</td>
                  <td className="border-r border-black p-0.5 text-center font-semibold">{item.unit}</td>
                  <td className="border-r border-black p-0.5 text-center font-mono">{item.qty}</td>
                  <td className="border-r border-black p-0.5 text-right font-mono">{formatCurrency(item.rate)}</td>
                  <td className="border-r border-black p-0.5 text-right font-mono font-medium">{formatCurrency(item.amt)}</td>
                </tr>
              ))}

              {/* SECTION 3: LABOUR CHARGE */}
              <tr className="bg-slate-200 print:bg-slate-100 font-bold border-t border-b border-black">
                <td colSpan={6} className="p-0.5 text-center uppercase tracking-wider text-[9px]">
                  Labour Charge
                </td>
              </tr>
              {estimate.labourItems.map((item) => (
                <tr key={`lab-${item.sr}`} className="border-b border-slate-300 print:border-black h-4.5">
                  <td className="border-r border-black p-0.5 text-center font-mono">{item.sr}</td>
                  <td className="border-r border-black p-0.5 pl-1">{item.desc}</td>
                  <td className="border-r border-black p-0.5 text-center font-semibold">{item.unit}</td>
                  <td className="border-r border-black p-0.5 text-center font-mono">{item.qty}</td>
                  <td className="border-r border-black p-0.5 text-right font-mono">{formatCurrency(item.rate)}</td>
                  <td className="border-r border-black p-0.5 text-right font-mono font-medium">{formatCurrency(item.amt)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Bottom Calculation Box */}
          <div className="flex justify-end mt-1 text-[9.5px]">
            <table className="border-collapse border border-black w-64 text-right">
              <tbody>
                <tr className="border-b border-black">
                  <td className="p-1 font-bold border-r border-black">Total Amount:</td>
                  <td className="p-1 font-mono font-bold w-24">{formatCurrency(estimate.baseTotal)}</td>
                </tr>
                <tr className="border-b border-black">
                  <td className="p-1 font-bold border-r border-black">
                    Percentage ({estimate.atPercentage > 0 ? `+${estimate.atPercentage.toFixed(1)}%` : `${estimate.atPercentage.toFixed(1)}%`}):
                  </td>
                  <td className="p-1 font-mono font-medium">{formatCurrency(estimate.percentageAmount)}</td>
                </tr>
                <tr className="border-b border-black">
                  <td className="p-1 font-bold border-r border-black">
                    Amount {estimate.atPercentage >= 0 ? `+ (${estimate.atPercentage.toFixed(1)}%)` : `(${estimate.atPercentage.toFixed(1)}%)`}:
                  </td>
                  <td className="p-1 font-mono font-bold">{formatCurrency(estimate.amountWithPercentage)}</td>
                </tr>
                <tr className="border-b border-black">
                  <td className="p-1 font-bold border-r border-black">Less:</td>
                  <td className="p-1 font-mono">{formatCurrency(estimate.lessAmount)}</td>
                </tr>
                <tr className="bg-slate-100 print:bg-transparent font-black text-[10.5px]">
                  <td className="p-1.5 border-r border-black">Final Amount:</td>
                  <td className="p-1.5 font-mono">{formatCurrency(estimate.finalAmount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Dual Signatures Block */}
        <div className="mt-4 pt-3 border-t border-black flex justify-between items-end px-8 text-[10px] font-bold uppercase">
          <div className="text-left">
            <div className="h-10"></div>
            <p className="font-bold">For, {agency?.discomName || 'DISCOM'}</p>
          </div>
          <div className="text-right">
            <div className="h-10"></div>
            <p className="font-bold">For, {agency?.name || 'CONTRACTOR'}</p>
          </div>
        </div>
      </div>
    </PrintableA4Page>
  );
}
