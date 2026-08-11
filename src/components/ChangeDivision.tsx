import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAgency } from '../lib/AgencyContext';
import { useState, useEffect } from 'react';

/** Change Division — switch active division like legacy desktop */
export default function ChangeDivision() {
  const { activeAgency } = useAgency();
  const navigate = useNavigate();
  const [division, setDivision] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('activeDivision');
    const first = activeAgency ? Object.keys(activeAgency.prefixes || {})[0] : '';
    setDivision(stored || first || '');
  }, [activeAgency]);

  const apply = () => {
    localStorage.setItem('activeDivision', division);
    alert(`Active division set to ${division}`);
    navigate('/');
  };

  const divisions = activeAgency ? Object.keys(activeAgency.prefixes) : [];

  return (
    <div className="max-w-md mx-auto">
      <div className="mb-5 flex items-center gap-3">
        <Link to="/" className="p-2 bg-white rounded-full border shadow-sm">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-xl font-bold">Change Division</h1>
      </div>
      <div className="bg-white border rounded-lg p-6 space-y-4">
        <p className="text-sm text-slate-600">Select the division office to work with (same as desktop workspace switch).</p>
        {divisions.length === 0 ? (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
            No divisions configured. Add them in Agency Settings first.
          </p>
        ) : (
          <div className="space-y-2">
            {divisions.map((d) => (
              <label
                key={d}
                className={`flex items-center gap-3 p-3 border rounded cursor-pointer ${
                  division === d ? 'border-blue-500 bg-blue-50' : 'border-slate-200'
                }`}
              >
                <input type="radio" name="div" checked={division === d} onChange={() => setDivision(d)} />
                <span className="font-bold text-slate-800">{d}</span>
                <span className="text-xs text-slate-500 ml-auto font-mono">{activeAgency?.prefixes[d]}</span>
              </label>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={apply}
          disabled={!division}
          className="w-full py-2.5 bg-blue-600 text-white text-xs font-bold uppercase rounded disabled:opacity-50"
        >
          Apply Division
        </button>
      </div>
    </div>
  );
}
