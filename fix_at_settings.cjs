const fs = require('fs');
let code = fs.readFileSync('src/components/AtSettings.tsx', 'utf8');

// Add import for AtAllotments
if (!code.includes('import { AtAllotments }')) {
  code = code.replace(
    "import { Plus, Check, Loader2, Calendar } from 'lucide-react';",
    "import { Plus, Check, Loader2, Calendar } from 'lucide-react';\nimport { AtAllotments } from './AtAllotments';"
  );
}

// Render AtAllotments below the AT summary if it's the active one
const targetStr = `              <div
                  className={\`p-4 border rounded flex items-center justify-between cursor-pointer transition-colors \${
                  activeAtMaster?.id === at.id ? 'border-blue-500 bg-blue-50/50' : 'border-slate-200 hover:border-blue-300'
                }\`}
                onClick={() => setActiveAtMasterId(at.id)}
              >`;
              
const replacementStr = `              <div
                  className={\`p-4 border rounded flex items-center justify-between cursor-pointer transition-colors \${
                  activeAtMaster?.id === at.id ? 'border-blue-500 bg-blue-50/50 rounded-b-none' : 'border-slate-200 hover:border-blue-300'
                }\`}
                onClick={() => setActiveAtMasterId(at.id)}
              >`;

if (code.includes(targetStr)) {
    code = code.replace(targetStr, replacementStr);
}

const targetStr2 = `                  {activeAtMaster?.id === at.id && <span className="flex items-center text-xs font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded"><Check className="w-3 h-3 mr-1"/> Active AT</span>}
                </div>
              </div>
              
              </React.Fragment>`;

const replacementStr2 = `                  {activeAtMaster?.id === at.id && <span className="flex items-center text-xs font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded"><Check className="w-3 h-3 mr-1"/> Active AT</span>}
                </div>
              </div>
              {activeAtMaster?.id === at.id && (
                <div className="border border-t-0 border-blue-500 bg-white p-4 rounded-b">
                  <AtAllotments at={at} />
                </div>
              )}
              </React.Fragment>`;

if (code.includes(targetStr2)) {
    code = code.replace(targetStr2, replacementStr2);
    fs.writeFileSync('src/components/AtSettings.tsx', code);
    console.log("Fixed AtSettings.tsx successfully");
} else {
    console.log("Failed to find replacement target in AtSettings.tsx");
}
