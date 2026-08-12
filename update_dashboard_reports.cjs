const fs = require('fs');
let code = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

const linkHtml = `            <Link to="/reports" className="block p-4 border border-rose-200 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors group">
              <h3 className="font-bold text-rose-800 text-sm mb-1 group-hover:underline">Reports & Excel</h3>
              <p className="text-xs text-rose-600">Export Div-wise testing/delivery</p>
            </Link>`;

if (!code.includes('/reports')) {
  // Find where Delivery Challan link is added and insert next to it
  code = code.replace(
    /<\/Link>\n          <\/div>\n        <\/div>\n        \{\/\* Allotment Status Widget \*\/\}/,
    `</Link>\n${linkHtml}\n          </div>\n        </div>\n        {/* Allotment Status Widget */}`
  );
  // change grid cols from 4 to 5 or change it to flex wrap
  code = code.replace(/sm:grid-cols-4/, 'sm:grid-cols-5');
  fs.writeFileSync('src/components/Dashboard.tsx', code);
}
console.log("Updated Dashboard with Reports link");
