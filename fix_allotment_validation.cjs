const fs = require('fs');

let code = fs.readFileSync('src/components/NewJob.tsx', 'utf8');

const targetStr = `
        for (const [cType, countToAdd] of Object.entries(countsToAdd)) {
          const allowed = Number(activeAtMaster.allotments?.[commonData.division]?.[cType]) || 0;
          if (allowed > 0) {
            // Use simpler query to avoid composite index requirement, filter in memory
            const snap = await getDocs(query(
              collection(db, 'jobs'),
              where('ownerId', '==', auth.currentUser.uid),
              where('atId', '==', activeAtMaster.id)
            ));
            
            let used = 0;
            snap.forEach(doc => {
              const data = doc.data();
              if (data.ownerId !== auth.currentUser.uid || data.division !== commonData.division) return;
              const docType = data.coreType || 'CRGO';
              if (docType === 'OH' || data.repairType === 'OH') return;
              if (docType === cType) {
                used++;
              }
            });
            
            if (used + countToAdd > allowed) {
              setErrorMsg(\`Cannot receive job. \${cType} allotment exceeded for \${commonData.division}.\\nAllowed: \${allowed}\\nUsed: \${used}\\nTrying to add: \${countToAdd}\`);
              setLoading(false);
              return;
            }
          } else if (allowed === 0 && countToAdd > 0) {
            setErrorMsg(\`Cannot receive job. No \${cType} allotment has been configured for \${commonData.division}. Please set the allotment in AT Settings first.\`);
            setLoading(false);
            return;
          }
        }
`;

const replacementStr = `
        // Optimize querying by fetching all relevant AT jobs just once
        const snap = await getDocs(query(
            collection(db, 'jobs'),
            where('ownerId', '==', auth.currentUser.uid),
            where('atId', '==', activeAtMaster.id)
        ));
        
        const existingJobsData = snap.docs.map(d => d.data());

        for (const [cType, countToAdd] of Object.entries(countsToAdd)) {
          const allowed = Number(activeAtMaster.allotments?.[commonData.division]?.[cType]) || 0;
          
          if (allowed > 0) {
            let used = 0;
            existingJobsData.forEach(data => {
              if (data.ownerId !== auth.currentUser.uid || data.division !== commonData.division) return;
              
              // Only count if it's NOT an OH repair
              if (data.repairType === 'OH') return;
              
              const docType = data.coreType || 'CRGO';
              if (docType === 'OH') return;
              
              // ONLY check the exact coreType currently being looped
              if (docType === cType) {
                used++;
              }
            });
            
            if (used + countToAdd > allowed) {
              setErrorMsg(\`Cannot receive job. \${cType} allotment exceeded for \${commonData.division}.\\nAllowed: \${allowed}\\nUsed: \${used}\\nTrying to add: \${countToAdd}\`);
              setLoading(false);
              return;
            }
          } else if (allowed === 0 && countToAdd > 0) {
            setErrorMsg(\`Cannot receive job. No \${cType} allotment has been configured for \${commonData.division}. Please set the allotment in AT Settings first.\`);
            setLoading(false);
            return;
          }
        }
`;

code = code.replace(targetStr, replacementStr);
fs.writeFileSync('src/components/NewJob.tsx', code);
