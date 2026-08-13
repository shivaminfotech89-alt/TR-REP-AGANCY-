const fs = require('fs');
let code = fs.readFileSync('src/components/DispatchChallan.tsx', 'utf8');

code = code.replace(
  /disabled=\{loading \|\| selectedJobIds\.size === 0\}/g,
  `disabled={loading || selectedJobIds.size === 0 || !challanNo.trim() || !vehicleNo.trim()}`
);

code = code.replace(
  /\{loading \? 'Dispatching\.\.\.' : 'Confirm Dispatch & Close Jobs'\}/g,
  `{loading ? 'Dispatching...' : (!challanNo.trim() || !vehicleNo.trim() ? 'Enter Challan & Vehicle No to Dispatch' : 'Confirm Dispatch & Close Jobs')}`
);

fs.writeFileSync('src/components/DispatchChallan.tsx', code);
