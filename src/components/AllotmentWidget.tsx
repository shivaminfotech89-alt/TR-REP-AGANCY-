import React, { useEffect, useState } from 'react';
import { useAgency, AtMaster } from '../lib/AgencyContext';

import { db } from '../lib/firebase';
import { auth } from '../lib/firebase';
import { collection as fsCollection, query as fsQuery, where as fsWhere, getDocs as fsGetDocs } from 'firebase/firestore';

export function AllotmentWidget({ atMaster }: { atMaster: AtMaster }) {
  const { activeAgency, activeAtMaster } = useAgency();
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({});
  
  useEffect(() => {
    async function fetchCounts() {
      if (!auth.currentUser || !activeAgency) return;
      
      const q = fsQuery(
        fsCollection(db, 'jobs'),
        fsWhere('ownerId', '==', auth.currentUser.uid),
        fsWhere('atId', '==', atMaster.id)
      );
      
      try {
        const snap = await fsGetDocs(q);
        const newCounts: Record<string, Record<string, number>> = {};
        
        snap.forEach(doc => {
          const data = doc.data();
          if (data.ownerId !== auth.currentUser.uid) return;
          const div = data.division;
          const cType = data.coreType || 'CRGO';
          
          // Skip OH as it's not allotted
          if (cType === 'OH' || data.repairType === 'OH') return;
          
          if (!newCounts[div]) newCounts[div] = {};
          if (!newCounts[div][cType]) newCounts[div][cType] = 0;
          newCounts[div][cType]++;
        });
        
        setCounts(newCounts);
      } catch (err) {
        console.error("Failed to fetch allotment usage", err);
      }
    }
    fetchCounts();
  }, [activeAgency, atMaster]);

  if (!activeAgency) return null;
  const divisions = Object.keys((activeAtMaster && activeAtMaster.prefixes && Object.keys(activeAtMaster.prefixes).length > 0) ? activeAtMaster.prefixes : (activeAgency?.prefixes || {}));
  if (divisions.length === 0) return null;

  return (
    <div className="mt-8 pt-6 border-t border-slate-200">
      <h3 className="text-sm font-bold text-slate-800 mb-4 uppercase tracking-wider">Job Allotment Usage ({atMaster.atNumber})</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {divisions.map(div => {
          const allot = atMaster?.allotments?.[div] || activeAtMaster?.allotments?.[div] || activeAgency.allotments?.[div] || {};
          const cTypes = ['CRGO', 'Amorphous', 'Wound Core'];
          const hasAny = cTypes.some(c => allot[c] > 0);
          
          return (
            <div key={div} className="border border-slate-200 rounded p-4 bg-slate-50">
              <h4 className="font-bold text-slate-700 text-sm mb-3 border-b border-slate-200 pb-2">{div}</h4>
              <div className="space-y-4">
                {hasAny ? cTypes.map(coreType => {
                  const total = allot[coreType] || 0;
                  if (total === 0) return null;
                  
                  const used = counts[div]?.[coreType] || 0;
                  const pending = Math.max(0, total - used);
                  const percent = Math.min(100, Math.round((used / total) * 100)) || 0;
                  
                  let barColor = "bg-emerald-500";
                  if (percent > 80) barColor = "bg-amber-500";
                  if (percent > 95) barColor = "bg-red-500";
                  
                  return (
                    <div key={coreType} className="space-y-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-600 font-semibold">{coreType}</span>
                        <span className="text-slate-500"><span className="font-bold text-slate-800">{used}</span> used / <span className="font-bold text-slate-800">{pending}</span> pending</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-1.5">
                        <div className={`${barColor} h-1.5 rounded-full`} style={{ width: `${percent}%` }}></div>
                      </div>
                      <div className="text-[9px] text-slate-400 text-right">Total: {total}</div>
                    </div>
                  );
                }) : (
                  <div className="text-xs text-slate-400 italic">No allotments set for this division.</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-slate-400 mt-2 italic">* Manage allotments via Settings &gt; AT / Tender Periods</p>
    </div>
  );
}
