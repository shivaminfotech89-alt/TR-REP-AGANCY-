import { Link } from 'react-router-dom';
import { ArrowLeft, Construction } from 'lucide-react';

/** Placeholder for modules not yet fully built (Amorphous, Barrel, Stock, etc.) */
export default function ModulePlaceholder({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-5 flex items-center gap-3">
        <Link to="/" className="p-2 bg-white rounded-full border shadow-sm">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-xl font-bold">{title}</h1>
      </div>
      <div className="bg-white border rounded-lg p-10 text-center">
        <Construction className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-600 mb-2">{hint || 'This module is on the dashboard and will be connected next.'}</p>
        <p className="text-xs text-slate-400">Core OGP flow (External → Internal → Estimate → Bill / Oil / Challan) is ready.</p>
        <Link to="/" className="inline-block mt-4 text-xs font-bold uppercase text-blue-600">
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
