import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function inspect() {
  const docRef = doc(db, 'system_config', 'estimate_master');
  const snap = await getDoc(docRef);
  if (!snap.exists()) {
    console.log('Doc not found');
    return;
  }
  const data = snap.data();
  console.log('Keys in system_config/estimate_master:', Object.keys(data));

  const crgo = data.estimateMasterCRGO || data.estimateMaster || [];
  console.log(`\n=== CRGO / PRIMARY ESTIMATE MASTER (${crgo.length} items) ===`);
  const capacityList = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'];
  
  const report = crgo.map((item: any, idx: number) => {
    const rates = item.rates || {};
    const nullCapacities = capacityList.filter(c => rates[c] === null || rates[c] === undefined);
    const validCapacities = capacityList.filter(c => rates[c] !== null && rates[c] !== undefined);
    return {
      index: idx + 1,
      itemCode: item.itemCode,
      itemName: item.itemName,
      unit: item.unit,
      fixedRate: item.fixedRate,
      nullCapacities: nullCapacities.join(', ') || 'None (all set)',
      validCapacitiesCount: validCapacities.length
    };
  });

  console.log(JSON.stringify(report, null, 2));

  console.log('\n=== AMORPHOUS ESTIMATE MASTER ===');
  const amorphous = data.estimateMasterAmorphous || [];
  console.log(JSON.stringify(amorphous, null, 2));

  console.log('\n=== SCRAP / UNECONOMICAL ITEMS ===');
  const scrapItems: any[] = [];
  ['estimateMaster', 'estimateMasterCRGO', 'estimateMasterAmorphous', 'estimateMasterWoundCore', 'estimateMasterOverhauling', 'estimateMasterCircleLimits'].forEach(k => {
    if (Array.isArray(data[k])) {
      data[k].forEach((it: any) => {
        const name = (it.itemName || '').toLowerCase();
        if (name.includes('scrap') || name.includes('uneconomical') || String(it.itemCode).trim() === '0') {
          scrapItems.push({ array: k, itemCode: it.itemCode, itemName: it.itemName, unit: it.unit, fixedRate: it.fixedRate, rates: it.rates });
        }
      });
    }
  });
  console.log(JSON.stringify(scrapItems, null, 2));
}

inspect().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
