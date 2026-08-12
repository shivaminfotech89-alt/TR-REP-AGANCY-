const fs = require('fs');
let code = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

const linkHtml = `            <Link to="/challan/new" className="block p-4 border border-purple-200 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors group">
              <h3 className="font-bold text-purple-800 text-sm mb-1 group-hover:underline">Delivery Challan</h3>
              <p className="text-xs text-purple-600">Dispatch tested transformers</p>
            </Link>`;

if (!code.includes('/challan/new')) {
  code = code.replace(
    /<\/div>\n        <\/div>\n        \{\/\* Allotment Status Widget \*\/\}/,
    `  ${linkHtml}\n          </div>\n        </div>\n        {/* Allotment Status Widget */}`
  );
  code = code.replace(/sm:grid-cols-3/, 'sm:grid-cols-4');
  fs.writeFileSync('src/components/Dashboard.tsx', code);
}
