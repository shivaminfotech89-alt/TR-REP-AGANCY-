const fs = require('fs');
let code = fs.readFileSync('src/components/EstimateGenerate.tsx', 'utf8');

// 1. Change State back to MR
const stateStart = `  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);`;
const stateReplace = `  const [selectedMrNo, setSelectedMrNo] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');`;
code = code.replace(stateStart, stateReplace);

// 2. Change Memoized Job Lists
const mrGroupsStart = `  const filteredJobs = useMemo(() => {
    if (!searchQuery) return jobs;
    const lowerQuery = searchQuery.toLowerCase();
    return jobs.filter(j => 
      (j.mrNo && j.mrNo.toLowerCase().includes(lowerQuery)) ||
      (j.jobNo && j.jobNo.toLowerCase().includes(lowerQuery))
    );
  }, [jobs, searchQuery]);

  const selectedJobsData = useMemo(() => {
    return jobs.filter(j => selectedJobIds.includes(j.id)).sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));
  }, [jobs, selectedJobIds]);`;
const mrGroupsReplace = `  const mrGroups = useMemo(() => {
    const groups: Record<string, any[]> = {};
    jobs.forEach(j => {
      if (!groups[j.mrNo]) groups[j.mrNo] = [];
      groups[j.mrNo].push(j);
    });
    return groups;
  }, [jobs]);

  const selectedJobsData = useMemo(() => {
    if (!selectedMrNo) return [];
    return jobs.filter(j => j.mrNo === selectedMrNo).sort((a, b) => a.jobNo.localeCompare(b.jobNo, undefined, { numeric: true }));
  }, [jobs, selectedMrNo]);
  
  const filteredMrNos = Object.keys(mrGroups).filter(mr => {
    if (!searchQuery) return true;
    return mr.toLowerCase().includes(searchQuery.toLowerCase());
  }).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));`;
code = code.replace(mrGroupsStart, mrGroupsReplace);

// 3. UI
const uiStart = `      {!isGenerating ? (
        <div className="bg-white rounded shadow-sm border border-slate-200 overflow-hidden print:hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row justify-between items-center gap-4">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-widest">Select Jobs for Estimate</h2>
            <div className="flex flex-wrap gap-4 items-center">
              <div className="relative flex-1 md:w-64">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search MR or Job No..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 w-full bg-white"
                />
              </div>
              <button 
                disabled={selectedJobIds.length === 0}
                onClick={() => setIsGenerating(true)}
                className="px-6 py-2 text-[10px] font-bold uppercase tracking-widest bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Generate ({selectedJobIds.length})
              </button>
            </div>
          </div>
          
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-4 py-3">
                    <input 
                      type="checkbox" 
                      onChange={(e) => {
                        if (e.target.checked) setSelectedJobIds(filteredJobs.map(j => j.id));
                        else setSelectedJobIds([]);
                      }}
                      checked={filteredJobs.length > 0 && selectedJobIds.length === filteredJobs.length}
                    />
                  </th>
                  <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">MR No</th>
                  <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Job No</th>
                  <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">KVA</th>
                  <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredJobs.map(job => (
                  <tr key={job.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <input 
                        type="checkbox" 
                        checked={selectedJobIds.includes(job.id)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedJobIds([...selectedJobIds, job.id]);
                          else setSelectedJobIds(selectedJobIds.filter(id => id !== job.id));
                        }}
                      />
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-600">{job.mrNo}</td>
                    <td className="px-4 py-3 font-bold text-blue-600">{job.jobNo}</td>
                    <td className="px-4 py-3">{job.capacityKva} KVA</td>
                    <td className="px-4 py-3">
                      <span className={\`px-2 py-1 rounded text-[10px] font-bold uppercase \${job.status === 'Scrap' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}\`}>
                        {job.status === 'Scrap' ? 'Scrap' : 'Repairable'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-6 print:space-y-0">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded flex justify-between items-center text-white print:hidden">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Generate Estimate</p>
              <p className="text-lg font-mono font-bold">{selectedJobsData.length} Selected Jobs</p>
            </div>
            <div className="flex space-x-2">
              <button 
                onClick={handlePrint}
                className="flex items-center text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-300 border border-slate-400/30 px-3 py-1.5 rounded transition-colors"
              >
                <Printer className="w-3 h-3 mr-1" /> Print / PDF
              </button>
              <button 
                onClick={() => setIsGenerating(false)}
                className="text-[10px] font-bold uppercase tracking-widest text-blue-400 hover:text-blue-300 border border-blue-400/30 px-3 py-1.5 rounded transition-colors"
              >
                Back to Selection
              </button>
            </div>
          </div>`;

const uiReplace = `      {!selectedMrNo ? (
        <div className="bg-white rounded shadow-sm border border-slate-200 overflow-hidden print:hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row justify-between items-center gap-4">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-widest">Select MR to Generate Estimate</h2>
            <div className="flex flex-wrap gap-4 items-center">
              <div className="relative flex-1 md:w-64">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search MR No..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 w-full bg-white"
                />
              </div>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">MR No</th>
                  <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Total Jobs</th>
                  <th className="px-4 py-3 font-bold text-slate-500 uppercase tracking-widest text-[10px]">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMrNos.map(mr => (
                  <tr key={mr} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono font-bold">{mr}</td>
                    <td className="px-4 py-3">{mrGroups[mr].length} Jobs (Repairable & Scrap)</td>
                    <td className="px-4 py-3">
                      <button 
                        onClick={() => setSelectedMrNo(mr)}
                        className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                      >
                        Generate Reports
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-6 print:space-y-0">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded flex justify-between items-center text-white print:hidden">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Selected MR</p>
              <p className="text-lg font-mono font-bold">{selectedMrNo}</p>
              <p className="text-xs text-slate-300 mt-1">{selectedJobsData.length} Transformers in this MR</p>
            </div>
            <div className="flex space-x-2">
              <button 
                onClick={handlePrint}
                className="flex items-center text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-300 border border-slate-400/30 px-3 py-1.5 rounded transition-colors"
              >
                <Printer className="w-3 h-3 mr-1" /> Print / PDF
              </button>
              <button 
                onClick={() => setSelectedMrNo(null)}
                className="text-[10px] font-bold uppercase tracking-widest text-blue-400 hover:text-blue-300 border border-blue-400/30 px-3 py-1.5 rounded transition-colors"
              >
                Change MR
              </button>
            </div>
          </div>`;
code = code.replace(uiStart, uiReplace);

const t2Rows = `<td className="p-2 text-center text-xs font-bold whitespace-nowrap">{job.status === 'Scrap' ? 'SCRAP' : 'REPAIRABLE'}</td>`;
const t2RowsReplace = `<td className="p-2 text-center text-xs font-bold whitespace-nowrap">{job.status === 'Scrap' ? 'SCRAP INCLUDED' : 'REPAIRABLE'}</td>`;
code = code.replace(t2Rows, t2RowsReplace);

const noteStart = `<p className="underline underline-offset-4">Note -</p>`;
const noteReplace = `<p className="underline underline-offset-4">Note - {selectedJobsData.some(j => j.status === 'Scrap') ? 'Scrap Included' : ''}</p>`;
code = code.replace(noteStart, noteReplace);


fs.writeFileSync('src/components/EstimateGenerate.tsx', code);
console.log('Update successful');
