const fs = require('fs');
let code = fs.readFileSync('src/components/AppLayout.tsx', 'utf8');

if (!code.includes('import DispatchChallan')) {
  code = code.replace(
    /import EstimateGenerate from '\.\/EstimateGenerate';/,
    `import EstimateGenerate from './EstimateGenerate';\nimport DispatchChallan from './DispatchChallan';`
  );
  code = code.replace(
    /<Route path="\/estimates\/new" element=\{<EstimateGenerate \/>\} \/>/,
    `<Route path="/estimates/new" element={<EstimateGenerate />} />\n            <Route path="/challan/new" element={<DispatchChallan />} />`
  );
  fs.writeFileSync('src/components/AppLayout.tsx', code);
}
console.log("Updated AppLayout routing");
