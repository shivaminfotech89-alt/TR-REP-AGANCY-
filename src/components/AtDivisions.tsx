import React, { useState, useEffect } from 'react';
import { useAgency, AtMaster } from '../lib/AgencyContext';
import { Plus, Trash2, Save, Loader2, Check, AlertTriangle, Layers } from 'lucide-react';
import { validateDivisionPrefixes } from '../lib/prefixValidation';
import { getCounterKey } from '../lib/AgencyContext';
import {
  guaranteeMonthsFor, seedFromStartingNumber, startingNumberFromSeed,
  GUARANTEED_CORE_TYPES, DEFAULT_GUARANTEE_MONTHS,
} from '../lib/guaranteePeriod';

export function AtDivisions({ at }: { at: AtMaster }) {
  const { updateAtMaster, activeAgency, updateAgency } = useAgency();
  const [isSaving, setIsSaving] = useState(false);
  const [divisions, setDivisions] = useState<any[]>([]);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    const divs: any[] = [];
    const sourcePrefixes = at.prefixes && Object.keys(at.prefixes).length > 0 
        ? at.prefixes 
        : (activeAgency?.prefixes || {});

    Object.entries(sourcePrefixes).forEach(([name, prefixData]: [string, any]) => {
      if (typeof prefixData === 'string') {
        divs.push({
          name,
          prefixCRGO: prefixData,
          prefixAmorphous: '',
          prefixWoundCore: '',
          prefixLSTC: '',
          prefixOH: '' });
      } else {
        divs.push({
          name,
          prefixCRGO: prefixData['CRGO'] || '',
          prefixAmorphous: prefixData['Amorphous'] || '',
          prefixWoundCore: prefixData['Wound Core'] || '',
          prefixLSTC: prefixData['LSTC'] || '',
          prefixOH: prefixData['OH'] || '' });
      }
    });
    
    // NO SEEDED DIVISION. This used to push a hardcoded SABARMATI / 21 IS when neither
    // the AT nor the agency had any, which rendered as a division that looks entered -
    // the operator cannot tell a placeholder from a configured value, and saving it
    // writes a real division and a real job-number prefix for a tender that never had
    // one. Same family as the seeded DISCOM identity (AUDIT O7). Start empty and say so.
    setDivisions(divs);
  }, [at, activeAgency]);

  const handleAddDivision = () => {
    setDivisions([...divisions, { name: '', prefixCRGO: '', prefixAmorphous: '', prefixWoundCore: '', prefixLSTC: '', prefixOH: '' }]);
  };

  const handleRemoveDivision = (index: number) => {
    if (divisions.length === 1) return;
    const newDivs = [...divisions];
    newDivs.splice(index, 1);
    setDivisions(newDivs);
  };

  const handleDivisionChange = (index: number, field: string, value: string) => {
    const newDivs = [...divisions];
    (newDivs[index] as any)[field] = value.toUpperCase();
    setDivisions(newDivs);
  };

  // Real-time validation result
  /**
   * THE GUARANTEE PERIOD, PER CORE TYPE, ON THE AT (AUDIT G42).
   *
   * ⚠ A TENDER TERM, WHICH IS WHY IT IS HERE AND NOT ON THE AGENCY. A/T 1819 clause 38.2 sets
   * it; another A/T may set another. On the agency it would survive a rollover and apply the
   * previous tender's terms to this tender's work.
   *
   * ⚠ LSTC / PAT IS ABSENT DELIBERATELY. Clause 38.2 gives SDT/PAT six months and this app has
   * no such core type - LSTC exists only as a job-number prefix, and no live job carries it. A
   * six-month default keyed to something nothing can select would be a setting that does
   * nothing. See lib/guaranteePeriod.ts for what adding it would take.
   */
  const [guaranteeMonths, setGuaranteeMonths] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    GUARANTEED_CORE_TYPES.forEach(ct => {
      out[ct] = String(at.guaranteeMonths?.[ct] ?? DEFAULT_GUARANTEE_MONTHS);
    });
    return out;
  });

  /**
   * WHERE NUMBERING STARTS, per division and core type - A SEED, NOT A SETTING.
   *
   * ⚠ IT IS INERT ONCE THE COUNTER HAS MOVED, and the field says so rather than accepting an
   * edit that does nothing. The save recomputes `lastJobNumbers` from the real job numbers it
   * writes, monotonically, so after the first job this value cannot change anything. A control
   * that quietly stops working is read as broken.
   */
  const [startingNumbers, setStartingNumbers] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    Object.entries(at.startingJobNumbers || {}).forEach(([k, v]) => {
      out[k] = String(startingNumberFromSeed(Number(v) || 0));
    });
    return out;
  });

  /** True once a real job number has advanced this counter - the seed is then inert. */
  const counterMoved = (key: string) => Number(at.lastJobNumbers?.[key] || 0) > 0;

  const validation = validateDivisionPrefixes(divisions);

  const handleSave = async () => {
    if (!validation.isValid) {
      alert(`Validation Error:\n\n${validation.errors.join('\n')}`);
      return;
    }

    setIsSaving(true);
    try {
      const prefixes: Record<string, Record<string, string>> = {};
      
      divisions.forEach(d => {
        const divName = d.name.trim();
        if (divName) {
          prefixes[divName] = {
            'CRGO': d.prefixCRGO.trim(),
            'Amorphous': (d.prefixAmorphous || '').trim(),
            'Wound Core': (d.prefixWoundCore || '').trim(),
            'LSTC': (d.prefixLSTC || '').trim(),
            'OH': (d.prefixOH || '').trim() };
        }
      });

      // ⚠ THE -1 LIVES IN ONE PLACE. `lastJobNumbers` holds the LAST USED number and the
      // suggestion is `last + 1`, so starting at 47 seeds 46. Storing 47 would make the first
      // job 48. `seedFromStartingNumber` is that conversion and it is not repeated here.
      const startingJobNumbers: Record<string, number> = {};
      const seededCounters: Record<string, number> = { ...(at.lastJobNumbers || {}) };
      Object.entries(startingNumbers).forEach(([key, raw]) => {
        const n = Number(String(raw).trim());
        if (!Number.isFinite(n) || n < 1) return;
        if (counterMoved(key)) return;          // inert - never rewind live numbering
        startingJobNumbers[key] = seedFromStartingNumber(n);
        seededCounters[key] = seedFromStartingNumber(n);
      });

      const monthsOut: Record<string, number> = {};
      Object.entries(guaranteeMonths).forEach(([ct, raw]) => {
        const n = Number(String(raw).trim());
        if (Number.isFinite(n) && n > 0) monthsOut[ct] = Math.round(n);
      });

      await updateAtMaster(at.id, {
        prefixes,
        guaranteeMonths: monthsOut,
        startingJobNumbers,
        lastJobNumbers: seededCounters,
      });
      if (activeAgency) {
        await updateAgency(activeAgency.id, { prefixes });
      }
      setSaveSuccessMsg(`Divisions & prefixes successfully saved for AT: ${at.atNumber}!`);
      setTimeout(() => setSaveSuccessMsg(null), 5000);
    } catch (e) {
      alert("Failed to save divisions.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-indigo-600" />
            Divisions & Core Prefixes for AT: {at.atNumber}
          </h4>
          <p className="text-[11px] text-slate-500">
            Define division names and unique prefixes for CRGO, Amorphous, Wound Core, LSTC & O/H jobs
          </p>
        </div>

        {/* ===================== GUARANTEE PERIOD, PER CORE TYPE =====================
            ⚠ A TENDER TERM, ON THE TENDER (AUDIT G42). It used to be one figure on the AGENCY,
            which meant it survived a rollover and applied the previous tender's terms to this
            tender's work. It also had two rivals: a free-text box on the bill and a hardcoded
            eighteen on the Dashboard, two of which printed on the same document. */}
        <div className="mb-4 border border-slate-200 rounded-lg p-3 bg-slate-50">
          <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
            <h5 className="text-xs font-black text-slate-900">Guarantee period</h5>
            <span className="text-[10px] text-slate-500">
              A/T clause 38.2. Printed on the guarantee certificate and checked when a GP job is booked.
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {GUARANTEED_CORE_TYPES.map(ct => (
              <div key={ct}>
                <label className="block text-[9px] uppercase font-bold text-slate-600 mb-0.5">{ct}</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    value={guaranteeMonths[ct] ?? ''}
                    onChange={e => setGuaranteeMonths(prev => ({ ...prev, [ct]: e.target.value }))}
                    className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white font-mono tabular-nums"
                  />
                  <span className="text-[10px] text-slate-500 shrink-0">months</span>
                </div>
              </div>
            ))}
          </div>
          {/* ⚠ SAID HERE RATHER THAN LEFT AS AN ABSENCE. LSTC/PAT would be six months under
              clause 38.2, and the app has no such core type to attach it to. */}
          <p className="text-[10px] text-slate-500 mt-2">
            LSTC / PAT would be 6 months under clause 38.2. It is not offered because this app has
            no LSTC core type &mdash; it exists only as a job-number prefix, and no job carries it.
            Adding it means making LSTC a real core type first.
          </p>
        </div>

        {/* ===================== STARTING JOB NUMBER =====================
            ⚠ A SEED, NOT A SETTING. `lastJobNumbers` holds the LAST USED number and the
            suggestion is `last + 1`, so starting at 47 stores 46 - the conversion lives in
            seedFromStartingNumber and nowhere else. Once a real job has advanced the counter
            this cannot change anything, so the field DISABLES ITSELF and says why: a control
            that quietly stops working is read as broken. */}
        <div className="mb-4 border border-slate-200 rounded-lg p-3 bg-slate-50">
          <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
            <h5 className="text-xs font-black text-slate-900">Starting job number</h5>
            <span className="text-[10px] text-slate-500">
              For an agency joining this tender part-way. Leave at 1 to start from the beginning.
            </span>
          </div>
          <div className="space-y-2">
            {divisions.filter(d => d.name.trim()).map((d, di) => (
              <div key={di} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                <div className="text-[11px] font-bold text-slate-700 truncate sm:col-span-1">
                  {d.name.trim()}
                </div>
                {GUARANTEED_CORE_TYPES.filter(ct => ct !== 'OH').map(ct => {
                  // ⚠ getCounterKey, NOT A SECOND COPY OF IT. A hand-rolled
                  // `${div}_${ct.toUpperCase()}` happened to produce the same strings today, and
                  // that is exactly the parallel-implementation shape AgencyContext warns about
                  // three lines above getCounterKey itself: a second copy that drifts seeds a
                  // counter nothing reads, silently, and job numbering restarts from 1.
                  const key = getCounterKey(d.name.trim(), ct);
                  const moved = counterMoved(key) || (ct === 'CRGO' && counterMoved(d.name.trim()));
                  const last = Number(at.lastJobNumbers?.[key] || (ct === 'CRGO' ? at.lastJobNumbers?.[d.name.trim()] : 0) || 0);
                  return (
                    <div key={ct}>
                      <label className="block text-[9px] uppercase font-bold text-slate-500 mb-0.5">{ct}</label>
                      <input
                        type="number"
                        min={1}
                        disabled={moved}
                        value={startingNumbers[key] ?? '1'}
                        onChange={e => setStartingNumbers(prev => ({ ...prev, [key]: e.target.value }))}
                        className={`w-full px-2 py-1.5 text-xs border rounded font-mono tabular-nums ${
                          moved
                            ? 'bg-slate-200 border-slate-300 text-slate-500 cursor-not-allowed'
                            : 'bg-white border-slate-300'
                        }`}
                        title={moved
                          ? `Numbering has started for this division and core type - the last issued number is ${last}. A starting number only seeds an unused counter; changing it now would do nothing, so it is disabled rather than accepting an edit that has no effect.`
                          : 'The first job number to issue. Stored as one less, because the counter records the last number used.'}
                      />
                      {moved && (
                        <span className="block text-[9px] text-slate-500 mt-0.5">
                          in use &mdash; last {last}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {divisions.filter(d => d.name.trim()).length === 0 && (
              <p className="text-[11px] text-slate-500">Add a division below first.</p>
            )}
          </div>
        </div>
        
        <button 
          type="button" 
          onClick={handleAddDivision} 
          className="text-xs font-bold text-indigo-700 hover:text-indigo-900 flex items-center bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg border border-indigo-200 transition-colors self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5 mr-1" /> Add Division
        </button>
      </div>

      {/* Empty state. Shown INSTEAD of the validation banner when there is simply nothing
          configured yet - "At least one division is required" reads as a fault when it is
          really the starting position. */}
      {divisions.length === 0 ? (
        <div className="p-4 bg-white border border-dashed border-slate-300 rounded-lg text-center space-y-1">
          <p className="text-xs font-bold text-slate-700">No divisions configured for this AT yet.</p>
          <p className="text-[11px] text-slate-500">
            Add each division named in the tender, with the job number prefix issued for it.
            Until then, job numbers use the <span className="font-mono tabular-nums font-bold">JOB</span> prefix.
          </p>
        </div>
      ) : null}

      {/* Validation alert banner */}
      {divisions.length > 0 && !validation.isValid && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2.5 text-xs text-red-800">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div>
            <strong className="font-bold block mb-0.5">Prefix & Division Validation Alert:</strong>
            <ul className="list-disc list-inside space-y-0.5 text-[11px] text-red-700">
              {validation.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {saveSuccessMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-800 font-bold">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          {saveSuccessMsg}
        </div>
      )}

      <div className="space-y-3">
        {divisions.map((div, index) => {
          const divErr = validation.divisionErrors[index];
          const dupes = divErr?.duplicatePrefixes;

          return (
            <div key={index} className={`p-2.5 rounded-lg space-y-2.5 border transition-colors ${
              divErr ? 'bg-red-50/40 border-red-300' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[10px] uppercase font-bold text-slate-500">Division Name *</label>
                    {divErr?.nameError && (
                      <span className="text-[10px] text-red-600 font-bold">{divErr.nameError}</span>
                    )}
                  </div>
                  <input 
                    required 
                    type="text" 
                    value={div.name} 
                    onChange={e => handleDivisionChange(index, 'name', e.target.value)} 
                    className={`w-full px-3 py-1.5 text-xs font-bold border rounded-lg uppercase bg-white ${
                      divErr?.nameError ? 'border-red-400 focus:ring-red-400' : 'border-slate-300 focus:ring-indigo-500'
                    }`} 
                    placeholder="e.g. SABARMATI" 
                  />
                </div>
                {divisions.length > 1 && (
                  <button 
                    type="button" 
                    onClick={() => handleRemoveDivision(index)} 
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors self-end"
                    title="Remove Division"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {dupes && dupes.length > 0 && (
                <div className="p-2 bg-amber-50 border border-amber-300 rounded-lg text-[11px] text-amber-900 flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>
                    Duplicate prefix not allowed in same division: <strong className="font-bold font-mono tabular-nums">{dupes.map(d => `"${d.prefix}" (${d.fields.join(' & ')})`).join(', ')}</strong>
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 pt-2 border-t border-slate-200">
                <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                  <label className="block text-[9px] uppercase font-black text-blue-700 mb-0.5">CRGO Prefix *</label>
                  <input 
                    required 
                    type="text" 
                    value={div.prefixCRGO} 
                    onChange={e => handleDivisionChange(index, 'prefixCRGO', e.target.value)} 
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded font-semibold focus:ring-1 focus:ring-indigo-500 bg-slate-50/50" 
                    placeholder="e.g. 21 IS" 
                  />
                </div>

                <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                  <label className="block text-[9px] uppercase font-bold text-amber-700 mb-0.5">Amorphous Prefix</label>
                  <input 
                    type="text" 
                    value={div.prefixAmorphous} 
                    onChange={e => handleDivisionChange(index, 'prefixAmorphous', e.target.value)} 
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 bg-slate-50/50" 
                    placeholder="e.g. AM21 IS" 
                  />
                </div>

                <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                  <label className="block text-[9px] uppercase font-bold text-emerald-700 mb-0.5">Wound Core Prefix</label>
                  <input 
                    type="text" 
                    value={div.prefixWoundCore} 
                    onChange={e => handleDivisionChange(index, 'prefixWoundCore', e.target.value)} 
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 bg-slate-50/50" 
                    placeholder="e.g. WC21 IS" 
                  />
                </div>

                <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                  <label className="block text-[9px] uppercase font-bold text-purple-700 mb-0.5">LSTC Prefix</label>
                  <input 
                    type="text" 
                    value={div.prefixLSTC} 
                    onChange={e => handleDivisionChange(index, 'prefixLSTC', e.target.value)} 
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 bg-slate-50/50" 
                    placeholder="e.g. LS21 IS" 
                  />
                </div>

                <div className="bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                  <label className="block text-[9px] uppercase font-bold text-slate-600 mb-0.5">O/H Prefix</label>
                  <input 
                    type="text" 
                    value={div.prefixOH} 
                    onChange={e => handleDivisionChange(index, 'prefixOH', e.target.value)} 
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 bg-slate-50/50" 
                    placeholder="e.g. OH21 IS" 
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end pt-2">
        <button 
          type="button" 
          onClick={handleSave} 
          disabled={isSaving} 
          className="flex items-center px-4 py-2 text-xs font-bold uppercase bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Save className="w-3.5 h-3.5 mr-1.5" />} 
          Save Divisions & Prefixes
        </button>
      </div>

      {/* THE MIRROR, BESIDE ITS SOURCE.
          The agency document keeps its own copy of `prefixes`. It is a FALLBACK, read only
          when this AT has none of its own (getNextJobNoInfo), and it is written by the Save
          above - not by anything on the agency screen.

          It used to be displayed three levels away, as tab 4 of the agency form, where it
          read as a second editor that happened not to work. Shown here, next to the grid
          that writes it, "mirror" needs no explaining: the edit route is the button above. */}
      {activeAgency && (
        <div className="mt-4 pt-3 border-t border-slate-200">
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Agency fallback copy
            </span>
            <span className="text-[10px] text-slate-400">read-only - written by the Save above</span>
          </div>
          {(() => {
            const agencyPrefixes = activeAgency.prefixes || {};
            const names = Object.keys(agencyPrefixes);
            const atNames = Object.keys(at.prefixes || {});
            const sameSet = names.length === atNames.length && names.every(n => atNames.includes(n));
            if (names.length === 0) {
              return (
                <p className="text-[11px] text-slate-500">
                  Nothing stored on {activeAgency.name}. This AT's divisions are the only copy -
                  which is the normal state once an AT carries its own.
                </p>
              );
            }
            return (
              <div className={`p-2 rounded border text-[11px] ${
                sameSet ? 'bg-slate-50 border-slate-200 text-slate-600'
                        : 'bg-amber-50 border-amber-300 text-amber-900'
              }`}>
                <div className="font-mono tabular-nums">{names.join(', ')}</div>
                <p className="mt-1 leading-relaxed">
                  {sameSet
                    ? `Same ${names.length} division(s) as this AT. Job numbering reads the AT; this copy is used only if the AT has none.`
                    : `DIFFERS from this AT's divisions (${atNames.join(', ') || 'none'}). Saving above overwrites this copy with the AT's.`}
                </p>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
