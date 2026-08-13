const fs = require('fs');
let code = fs.readFileSync('src/components/NewJob.tsx', 'utf8');

code = code.replace(
  /setErrorMsg\(\`Cannot receive job\. No \$\{cType\} allotment has been configured for \$\{commonData\.division\}\.\\nDebug: \$\{JSON\.stringify\(activeAtMaster\.allotments\)\}\\nPlease set the allotment in AT Settings first\.\`\);/,
  `setErrorMsg(\`Cannot receive job. No \${cType} allotment has been configured for \${commonData.division}. Please set the allotment in AT Settings first.\`);`
);

fs.writeFileSync('src/components/NewJob.tsx', code);
