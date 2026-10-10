import React, { useEffect, useState } from 'react';
import { useAgency, AtMaster } from '../lib/AgencyContext';

import { db } from '../lib/firebase';
import { auth } from '../lib/firebase';
import { collection as fsCollection, query as fsQuery, where as fsWhere, getDocs as fsGetDocs } from 'firebase/firestore';
import { drawsOnAllotment } from '../lib/allotments';
import { allotmentOverrun } from '../lib/replacementJob';
import { shortAtNumber } from '../lib/utils';
import { inheritsAgencyQuota } from '../lib/allotmentInheritance';

export function AllotmentWidget({ atMaster }: { atMaster: AtMaster }) {
  const { activeAgency, activeAtMaster, agencyInspections } = useAgency();
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({});
  /**
   * ⚠ THE SAME ROWS THE COUNT CAME FROM, KEPT (AUDIT G115). The bar needs one number; the line underneath
   * it has to say WHY the number is lower than the job count - "2 OH, 1 scrap released" - and that cannot be
   * recovered from a total. Re-querying for it would be a second read that could disagree with the first.
   */
  const [rows, setRows] = useState<any[]>([]);
  
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
          // ⚠ THE AGENCY, NOT JUST THE OWNER AND THE TENDER (AUDIT G116). The query cannot express it - it is
          // scoped by `ownerId` + `atId` - so it is filtered here. AARATI's MSBT-5 carries MEGHA's AT and was
          // counted as MEGHA's 21st SABARMATI/CRGO job.
          if (String(data.agencyId ?? '') !== String(activeAgency.id ?? '')) return;
          const div = data.division;
          const cType = data.coreType || 'CRGO';

          // ⚠ THE SAME RULE AS INTAKE, FROM ONE PLACE (AUDIT G72). This counted GP rework as quota used while New
          // Job did not, so the Dashboard overstated usage for any agency with guarantee work - MEGHA's
          // SABARMATI/CRGO row read 25 here and 21 at intake. One quantity may not have two counts.
          //
          // ⚠ `agencyInspections` IS WHAT MAKES SCRAP VISIBLE HERE (AUDIT G115). ASU-2 is scrap only in its
          // internal inspection; without the second argument this bar would show it as quota used while the
          // intake gate - which gets the same list - would not.
          if (!drawsOnAllotment(data, agencyInspections)) return;
          
          if (!newCounts[div]) newCounts[div] = {};
          if (!newCounts[div][cType]) newCounts[div][cType] = 0;
          newCounts[div][cType]++;
        });
        
        setCounts(newCounts);
        setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(
          (d: any) => String(d.agencyId ?? '') === String(activeAgency.id ?? '')));
      } catch (err) {
        console.error("Failed to fetch allotment usage", err);
      }
    }
    fetchCounts();
  }, [activeAgency, atMaster, agencyInspections]);

  if (!activeAgency) return null;
  const divisions = Object.keys((activeAtMaster && activeAtMaster.prefixes && Object.keys(activeAtMaster.prefixes).length > 0) ? activeAtMaster.prefixes : (activeAgency?.prefixes || {}));
  if (divisions.length === 0) return null;

  return (
    <div className="mt-8 pt-6 border-t border-slate-200">
      <h3 className="text-sm font-bold text-slate-800 mb-4 uppercase tracking-wider">Job Allotment Usage ({shortAtNumber(atMaster.atNumber)})</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {divisions.map(div => {
          /**
           * ⚠ THE MIDDLE TERM USED TO BE `activeAtMaster?.allotments?.[div]`, AND IT WAS WRONG
           * ON ITS OWN TERMS (AUDIT G72 amendment).
           *
           * This widget renders usage for the AT it is GIVEN - `atMaster` - and counts jobs with
           * `where('atId','==', atMaster.id)`. Falling through to `activeAtMaster` meant that when
           * the given tender had no quota for a division, the bar showed the GLOBALLY SELECTED
           * tender's quota against THIS tender's job counts. Two different tenders in one
           * progress bar, labelled with the first one's number.
           *
           * Nothing warned, and the arithmetic stayed plausible - which is why it survived: a
           * quota from one tender and a usage count from another still divide.
           *
           * ⚠ AND THE AGENCY FALLBACK IS NOW GATED, NOT UNCONDITIONAL (AUDIT G94). Only a
           * tender on `LEGACY_QUOTA_ATS` still inherits the agency's map; every tender created
           * after the rule changed starts at `{}` and gains quota only from its own allotment
           * letters. The list can only shrink - a test fails if it grows - so this fallback is
           * on its way out rather than settled.
           *
           * (An earlier revision of this comment said the fallback was "deliberately left for
           * now". That stopped being true the moment the line below was gated, and a comment
           * describing the opposite of its own code is the defect this audit keeps finding -
           * invisible to tsc, the tests, the build and the hooks guard alike.)
           */
          const allot = atMaster?.allotments?.[div] || (inheritsAgencyQuota(atMaster?.id) ? activeAgency.allotments?.[div] : undefined) || {};
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
                      {/*
                        ⚠ THE OVERRUN EXPLAINED WHERE IT IS READ (AUDIT G115). A division's 10-unit allotment
                        can legitimately carry job numbers up to SU-13 - ten repaired, two OH, one scrap. The
                        bar shows ten used and nothing wrong; the question it provokes is why the agency's
                        highest job number is 13, and this line answers it on the same row.

                        ⚠ IT NAMES THE UNREPLACED BALANCE TOO, because that is the actionable half: an
                        agency with two freed slots and one replacement is still entitled to one more job.
                      */}
                      {(() => {
                        const o = allotmentOverrun(rows, {
                          division: div,
                          coreType,
                          agencyId: String(activeAgency.id ?? ''),
                          inspections: agencyInspections,
                        });
                        const freed = o.freedOh + o.freedScrap;
                        if (freed === 0) return null;
                        const parts: string[] = [];
                        if (o.freedOh > 0) parts.push(`${o.freedOh} OH`);
                        if (o.freedScrap > 0) parts.push(`${o.freedScrap} scrap`);
                        const open = freed - o.replacements;
                        return (
                          <div className="text-[9px] text-amber-700 leading-snug text-right">
                            {o.total} job{o.total === 1 ? '' : 's'} booked, {parts.join(' + ')} drew nothing
                            {open > 0
                              ? ` · ${open} replacement${open === 1 ? '' : 's'} still available`
                              : o.replacements > 0 ? ` · ${o.replacements} replaced` : ''}
                          </div>
                        );
                      })()}
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
