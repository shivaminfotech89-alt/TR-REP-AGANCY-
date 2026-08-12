const fs = require('fs');
let code = fs.readFileSync('src/components/NewJob.tsx', 'utf8');

code = code.replace(
  /const allowed = Number\(activeAgency\.allotments\?\.\[commonData\.division\]\?\.\[cType\]\) \|\| 0;/g,
  'const allowed = Number(activeAtMaster.allotments?.[commonData.division]?.[cType]) || 0;'
);

// We should also probably block if allowed is 0, since that means NO allotment is given. 
// "CANT ANY PIOPOUP MASSAGE WHEN I RECEIVE MORE JOB JOB FROM ALLOTMEN NO" implies they want it to block if it exceeds allotment. If allotment is 0, it should block!
code = code.replace(
  /\} else if \(allowed === 0 && countToAdd > 0\) \{[\s\S]*?\}/,
  `} else if (allowed === 0 && countToAdd > 0) {
            setErrorMsg(\`Cannot receive job. No \${cType} allotment has been configured for \${commonData.division}. Please set the allotment in AT Settings first.\`);
            setLoading(false);
            return;
          }`
);

fs.writeFileSync('src/components/NewJob.tsx', code);
