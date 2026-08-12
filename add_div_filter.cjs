const fs = require('fs');
let code = fs.readFileSync('src/components/DispatchChallan.tsx', 'utf8');

code = code.replace(
  /const \[searchQuery, setSearchQuery\] = useState\(''\);/,
  `const [searchQuery, setSearchQuery] = useState('');\n  const [selectedDivision, setSelectedDivision] = useState('All');`
);

const oldFilteredJobs = `  const filteredJobs = useMemo(() => {
    if (!searchQuery) return jobs;
    const lowerQ = searchQuery.toLowerCase();
    return jobs.filter(j => 
        (j.jobNo || '').toLowerCase().includes(lowerQ) ||
        (j.mrNo || '').toLowerCase().includes(lowerQ) ||
        (j.division || '').toLowerCase().includes(lowerQ) ||
        (j.make || '').toLowerCase().includes(lowerQ)
    );
  }, [jobs, searchQuery]);`;

const newFilteredJobs = `  const availableDivisions = useMemo(() => {
    const divs = new Set(jobs.map(j => j.division).filter(Boolean));
    return ['All', ...Array.from(divs)].sort();
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    let result = jobs;
    if (selectedDivision !== 'All') {
        result = result.filter(j => j.division === selectedDivision);
    }
    if (searchQuery) {
        const lowerQ = searchQuery.toLowerCase();
        result = result.filter(j => 
            (j.jobNo || '').toLowerCase().includes(lowerQ) ||
            (j.mrNo || '').toLowerCase().includes(lowerQ) ||
            (j.division || '').toLowerCase().includes(lowerQ) ||
            (j.make || '').toLowerCase().includes(lowerQ)
        );
    }
    return result;
  }, [jobs, searchQuery, selectedDivision]);`;

code = code.replace(oldFilteredJobs, newFilteredJobs);

const oldHeader = `        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row justify-between items-center gap-4">
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
                <Truck className="w-5 h-5 text-purple-600" />
                Select Ready Jobs
            </h2>
            <div className="relative w-full sm:w-96">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input 
                    type="text" 
                    placeholder="Search Job No, MR No, Division..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-full text-sm outline-none focus:border-purple-500"
                />
            </div>
        </div>`;

const newHeader = `        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row justify-between items-center gap-4">
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
                <Truck className="w-5 h-5 text-purple-600" />
                Select Ready Jobs
            </h2>
            <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-3">
                <select 
                    value={selectedDivision} 
                    onChange={(e) => setSelectedDivision(e.target.value)}
                    className="px-3 py-2 border border-slate-200 rounded text-sm outline-none focus:border-purple-500 bg-white min-w-[150px] font-bold text-slate-700"
                >
                    {availableDivisions.map(div => (
                        <option key={div} value={div}>{div === 'All' ? 'All Divisions' : div}</option>
                    ))}
                </select>
                <div className="relative w-full sm:w-64">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input 
                        type="text" 
                        placeholder="Search Job No, MR No..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded text-sm outline-none focus:border-purple-500"
                    />
                </div>
            </div>
        </div>`;

code = code.replace(oldHeader, newHeader);
fs.writeFileSync('src/components/DispatchChallan.tsx', code);
console.log('Updated DispatchChallan with Division Filter');
