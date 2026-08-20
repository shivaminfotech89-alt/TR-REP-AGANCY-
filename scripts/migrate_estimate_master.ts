/**
 * Migration Script: Migrate Estimate Master from system_config to public_config
 * 
 * Usage:
 *   Dry-run (default):
 *     npx tsx scripts/migrate_estimate_master.ts --dry-run
 * 
 *   Execute Migration:
 *     npx tsx scripts/migrate_estimate_master.ts --execute
 * 
 * Features:
 *   - Dry-run mode first: inspects and prints what will be copied, counts of items, and existing state.
 *   - Verifies if public_config/estimate_master already exists; aborts if it exists to prevent accidental overwrite.
 *   - Preserves all document data, arrays, and properties exactly.
 *   - Does NOT delete the system_config/estimate_master source document.
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export interface MigrationSummary {
  dryRun: boolean;
  systemConfigExists: boolean;
  publicConfigExists: boolean;
  systemConfigPath: string;
  publicConfigPath: string;
  arraysCount: Record<string, number>;
  itemCodeList: Array<{ itemCode: string; itemName: string; unit: string }>;
  scrapItems: Array<{ arrayName: string; itemCode: string; itemName: string; fixedRate?: number | null }>;
  nullCapacitiesByItem: Record<string, string[]>;
  canProceed: boolean;
  message: string;
}

export async function runEstimateMasterMigration(options: { dryRun?: boolean; forceOverwrite?: boolean } = {}): Promise<MigrationSummary> {
  const isDryRun = options.dryRun !== false; // default true
  const systemConfigRef = doc(db, 'system_config', 'estimate_master');
  const publicConfigRef = doc(db, 'public_config', 'estimate_master');

  console.log('===============================================================');
  console.log(`ESTIMATE MASTER MIGRATION [${isDryRun ? 'DRY-RUN MODE' : 'EXECUTE MODE'}]`);
  console.log('===============================================================');
  console.log(`Source Document: system_config/estimate_master`);
  console.log(`Target Document: public_config/estimate_master`);

  let systemConfigData: any = null;
  let systemConfigExists = false;
  let publicConfigExists = false;

  // 1. Check Source Document
  try {
    const sysSnap = await getDoc(systemConfigRef);
    systemConfigExists = sysSnap.exists();
    if (systemConfigExists) {
      systemConfigData = sysSnap.data();
      console.log('✓ Found source document at system_config/estimate_master');
    } else {
      console.warn('✗ Source document system_config/estimate_master DOES NOT EXIST');
    }
  } catch (err: any) {
    console.error('Error reading system_config/estimate_master:', err?.message || err);
    throw new Error(`Failed to read source document: ${err?.message || err}`);
  }

  // 2. Check Target Document
  try {
    const pubSnap = await getDoc(publicConfigRef);
    publicConfigExists = pubSnap.exists();
    if (publicConfigExists) {
      console.warn('! Target document public_config/estimate_master ALREADY EXISTS!');
    } else {
      console.log('✓ Target document public_config/estimate_master does not exist yet (clean target).');
    }
  } catch (err: any) {
    console.error('Error checking public_config/estimate_master:', err?.message || err);
  }

  // Analyze content
  const arraysCount: Record<string, number> = {};
  const itemCodeList: Array<{ itemCode: string; itemName: string; unit: string }> = [];
  const scrapItems: Array<{ arrayName: string; itemCode: string; itemName: string; fixedRate?: number | null }> = [];
  const nullCapacitiesByItem: Record<string, string[]> = {};

  if (systemConfigData) {
    const arrayKeys = [
      'estimateMaster',
      'estimateMasterCRGO',
      'estimateMasterAmorphous',
      'estimateMasterWoundCore',
      'estimateMasterOverhauling',
      'estimateMasterCircleLimits'
    ];

    for (const key of arrayKeys) {
      if (Array.isArray(systemConfigData[key])) {
        arraysCount[key] = systemConfigData[key].length;
      }
    }

    const primaryItems = systemConfigData.estimateMaster || systemConfigData.estimateMasterCRGO || [];
    if (Array.isArray(primaryItems)) {
      primaryItems.forEach((item: any) => {
        itemCodeList.push({
          itemCode: item.itemCode || '',
          itemName: item.itemName || '',
          unit: item.unit || ''
        });

        // Check null capacities
        const capacityKeys = ['5', '10', '16', '25', '50', '63', '100', '200', '315', '500'];
        const nulls: string[] = [];
        if (item.rates && typeof item.rates === 'object') {
          for (const k of capacityKeys) {
            if (item.rates[k] === null || item.rates[k] === undefined) {
              nulls.push(k);
            }
          }
        } else {
          nulls.push(...capacityKeys);
        }
        nullCapacitiesByItem[item.itemCode || 'unknown'] = nulls;
      });
    }

    // Check scrap items in all arrays
    for (const key of arrayKeys) {
      const items = systemConfigData[key];
      if (Array.isArray(items)) {
        items.forEach((it: any) => {
          const nameLower = (it.itemName || '').toLowerCase();
          const code = String(it.itemCode || '').trim();
          if (nameLower.includes('scrap') || nameLower.includes('uneconomical') || code === '0') {
            scrapItems.push({
              arrayName: key,
              itemCode: it.itemCode,
              itemName: it.itemName,
              fixedRate: it.fixedRate
            });
          }
        });
      }
    }
  }

  // Safety checks
  let canProceed = false;
  let message = '';

  if (!systemConfigExists || !systemConfigData) {
    message = 'Cannot proceed: Source document system_config/estimate_master was not found or is empty.';
  } else if (publicConfigExists && !options.forceOverwrite) {
    message = 'Stop: Target document public_config/estimate_master ALREADY EXISTS. Migration aborted to prevent accidental overwrite.';
  } else {
    canProceed = true;
    message = isDryRun 
      ? `Dry run successful. Ready to copy ${Object.keys(arraysCount).length} arrays to public_config/estimate_master.`
      : `Migration executing: copying system_config/estimate_master to public_config/estimate_master...`;
  }

  console.log('\n--- Content Analysis ---');
  console.log('Arrays found in system_config/estimate_master:');
  console.table(arraysCount);
  console.log(`\nItems in primary estimateMaster array: ${itemCodeList.length}`);
  console.log(`Scrap-related items found: ${scrapItems.length}`);
  console.log(`Status: ${message}`);

  // 3. Execution (only if not dry-run and canProceed)
  if (!isDryRun && canProceed) {
    console.log('\nWriting exact document copy to public_config/estimate_master...');
    const payloadToCopy = {
      ...systemConfigData,
      migratedFrom: 'system_config/estimate_master',
      migratedAt: Date.now()
    };
    await setDoc(publicConfigRef, payloadToCopy);
    console.log('✓ Successfully wrote public_config/estimate_master!');
    console.log('✓ Source system_config/estimate_master PRESERVED (not deleted).');
  }

  return {
    dryRun: isDryRun,
    systemConfigExists,
    publicConfigExists,
    systemConfigPath: 'system_config/estimate_master',
    publicConfigPath: 'public_config/estimate_master',
    arraysCount,
    itemCodeList,
    scrapItems,
    nullCapacitiesByItem,
    canProceed,
    message
  };
}

// Standalone execution handler
if (process.argv[1] && process.argv[1].endsWith('migrate_estimate_master.ts')) {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute') || args.includes('--live');
  const isForce = args.includes('--force');

  runEstimateMasterMigration({ dryRun: !isExecute, forceOverwrite: isForce })
    .then((result) => {
      console.log('\nMigration Summary Result:');
      console.log(JSON.stringify({
        dryRun: result.dryRun,
        canProceed: result.canProceed,
        systemConfigExists: result.systemConfigExists,
        publicConfigExists: result.publicConfigExists,
        arraysCount: result.arraysCount,
        message: result.message
      }, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
