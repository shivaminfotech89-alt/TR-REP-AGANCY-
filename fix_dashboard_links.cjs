const fs = require('fs');
let code = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

const linkHtml = `            <Link to="/challan/new" className="block p-4 border border-purple-200 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors group">
              <h3 className="font-bold text-purple-800 text-sm mb-1 group-hover:underline">Delivery Challan</h3>
              <p className="text-xs text-purple-600">Dispatch tested transformers</p>
            </Link>
            <Link to="/reports" className="block p-4 border border-rose-200 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors group">
              <h3 className="font-bold text-rose-800 text-sm mb-1 group-hover:underline">Reports & Excel</h3>
              <p className="text-xs text-rose-600">Export Div-wise testing/delivery</p>
            </Link>`;

code = code.replace(
  /<p className="text-xs text-amber-600">Create repair cost estimates<\/p>\s*<\/Link>\s*<\/div>/,
  `<p className="text-xs text-amber-600">Create repair cost estimates</p>
            </Link>
${linkHtml}
          </div>`
);

fs.writeFileSync('src/components/Dashboard.tsx', code);
