const fs = require('fs');
let code = fs.readFileSync('src/components/AppLayout.tsx', 'utf8');

if (!code.includes('import Reports')) {
  code = code.replace(
    /import DispatchChallan from '\.\/DispatchChallan';/,
    `import DispatchChallan from './DispatchChallan';\nimport Reports from './Reports';`
  );
  code = code.replace(
    /<Route path="\/challan\/new" element=\{<DispatchChallan \/>\} \/>/,
    `<Route path="/challan/new" element={<DispatchChallan />} />\n            <Route path="/reports" element={<Reports />} />`
  );
  fs.writeFileSync('src/components/AppLayout.tsx', code);
}
console.log("Updated AppLayout routing for Reports");
