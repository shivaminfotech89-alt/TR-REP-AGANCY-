const fs = require('fs');
let code = fs.readFileSync('src/components/EstimateGenerate.tsx', 'utf8');
code = code.replace('<p className="underline underline-offset-4">Note -</p>', '<p className="underline underline-offset-4">Note - {selectedJobsData.some(j => j.status === \'Scrap\') ? \'Scrap Included\' : \'\'}</p>');
fs.writeFileSync('src/components/EstimateGenerate.tsx', code);
