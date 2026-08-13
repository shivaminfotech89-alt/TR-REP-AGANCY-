const fs = require('fs');

let code = fs.readFileSync('src/components/NewJob.tsx', 'utf8');

const targetStr = `
        for (const [cType, countToAdd] of Object.entries(countsToAdd)) {
          let allowed = Number(activeAtMaster.allotments?.[commonData.division]?.[cType]);
          
          if (!allowed || allowed === 0) {
             const agencyPrefixes = activeAgency.prefixes?.[commonData.division] || {};
             if (cType === 'CRGO') allowed = Number(agencyPrefixes.allotmentCRGO) || 0;
             else if (cType === 'Amorphous') allowed = Number(agencyPrefixes.allotmentAmorphous) || 0;
             else if (cType === 'Wound Core') allowed = Number(agencyPrefixes.allotmentWoundCore) || 0;
             else allowed = 0;
          }
`;

const replacementStr = `
        for (const [cType, countToAdd] of Object.entries(countsToAdd)) {
          let allowed = Number(activeAtMaster.allotments?.[commonData.division]?.[cType]);
          
          if (!allowed || allowed === 0) {
             allowed = Number(activeAgency.allotments?.[commonData.division]?.[cType]) || 0;
          }
`;

code = code.replace(targetStr, replacementStr);
fs.writeFileSync('src/components/NewJob.tsx', code);
