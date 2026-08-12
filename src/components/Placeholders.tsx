import { Link } from 'react-router-dom';
import { ArrowLeft, FileText, Droplet } from 'lucide-react';

export function BillGenerate() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center space-x-4">
        <Link to="/" className="p-2 bg-white rounded-full shadow-sm border border-slate-200 hover:bg-slate-50">
          <ArrowLeft className="w-4 h-4 text-slate-600" />
        </Link>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Generate Bill</h1>
      </div>
      <div className="bg-white p-12 rounded shadow-sm border border-slate-200 text-center">
        <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h2 className="text-lg font-bold text-slate-900 mb-2">Tax Invoice Module</h2>
        <p className="text-sm text-slate-500 max-w-md mx-auto">Select approved estimates to generate Tax Invoices with Labour, Material Cost, and CGST/SGST calculations.</p>
      </div>
    </div>
  );
}

