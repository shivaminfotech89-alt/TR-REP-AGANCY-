const fs = require('fs');
let code = fs.readFileSync('src/components/DispatchChallan.tsx', 'utf8');
code = code.replace(
  /catch \(err\) \{\n\s*handleFirestoreError\(err, OperationType\.UPDATE, 'jobs'\);\n\s*\}/,
  `catch (err: any) {
      console.error("DISPATCH ERROR", err);
      alert("Error: " + (err.message || err.toString()));
      handleFirestoreError(err, OperationType.UPDATE, 'jobs');
    }`
);
fs.writeFileSync('src/components/DispatchChallan.tsx', code);
