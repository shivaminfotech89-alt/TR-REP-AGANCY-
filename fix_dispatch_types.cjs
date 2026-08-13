const fs = require('fs');
let code = fs.readFileSync('src/components/DispatchChallan.tsx', 'utf8');

code = code.replace(
  /const fetchedJobs = snapshot\.docs\.map\(d => \(\{ id: d\.id, \.\.\.d\.data\(\) \}\)\);/,
  `const fetchedJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any));`
);

fs.writeFileSync('src/components/DispatchChallan.tsx', code);
