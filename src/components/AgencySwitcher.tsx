import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgency } from '../lib/AgencyContext';
import { Building2, Check, ChevronsUpDown, Settings2, Plus } from 'lucide-react';

/**
 * Header agency switcher.
 *
 * Drop-in replacement for the static agency name block in AppLayout's header,
 * so switching agency no longer requires opening Agency Settings.
 *
 * Reads only what already exists on the context — no data model changes.
 */
export default function AgencySwitcher({ appLogo }: { appLogo?: string }) {
  const { agencies, activeAgency, setActiveAgencyId, activeAtMaster, atMasters } = useAgency();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const atCountFor = (agencyId: string) =>
    atMasters.filter(at => at.agencyId === agencyId).length;

  const divisionCountFor = (agency: { prefixes?: Record<string, unknown> }) =>
    Object.keys(agency.prefixes || {}).length;

  if (!activeAgency) {
    return (
      <button
        onClick={() => navigate('/agency-settings')}
        className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-amber-600 hover:text-amber-700 truncate min-h-[44px]"
      >
        <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
        <span className="truncate">Select an agency</span>
      </button>
    );
  }

  return (
    <div className="relative min-w-0" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch agency"
        className="flex items-center gap-2 sm:gap-2.5 min-w-0 rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-slate-100 active:bg-slate-200 transition-colors min-h-[44px]"
      >
        {appLogo ? (
          <img
            src={appLogo}
            alt=""
            className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg object-cover border border-slate-200 shadow-xs shrink-0"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg bg-blue-600 text-white grid place-items-center shrink-0">
            <Building2 className="w-4 h-4" />
          </span>
        )}

        <span className="min-w-0 text-left">
          <span className="flex items-center gap-1">
            <span className="text-xs sm:text-sm font-bold text-slate-900 leading-tight truncate">
              {activeAgency.name}
            </span>
            {agencies.length > 1 && (
              <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            )}
          </span>
          <span className="block text-[10px] sm:text-xs text-slate-500 truncate">
            {activeAtMaster ? `AT ${activeAtMaster.atNumber}` : 'No AT selected'}
          </span>
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1.5 w-[min(20rem,calc(100vw-1.5rem))] bg-white rounded-xl shadow-lg border border-slate-200 py-1.5 z-50 max-h-[70vh] overflow-y-auto"
        >
          <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Switch agency
          </p>

          {agencies.map(agency => {
            const isActive = agency.id === activeAgency.id;
            const ats = atCountFor(agency.id);
            const divs = divisionCountFor(agency);
            return (
              <button
                key={agency.id}
                role="option"
                aria-selected={isActive}
                onClick={() => { setActiveAgencyId(agency.id); setOpen(false); }}
                className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${
                  isActive ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
              >
                <span
                  className={`mt-0.5 w-7 h-7 rounded-lg grid place-items-center shrink-0 text-white ${
                    isActive ? 'bg-blue-600' : 'bg-slate-400'
                  }`}
                >
                  <Building2 className="w-3.5 h-3.5" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-slate-900 truncate">
                    {agency.name}
                  </span>
                  <span className="block text-[11px] text-slate-500 truncate">
                    {divs} division{divs === 1 ? '' : 's'} · {ats} AT{ats === 1 ? '' : 's'}
                    {agency.gstin ? ` · ${agency.gstin}` : ''}
                  </span>
                </span>

                {isActive && <Check className="w-4 h-4 text-blue-600 stroke-[3] shrink-0 mt-1" />}
              </button>
            );
          })}

          <div className="border-t border-slate-100 mt-1.5 pt-1.5">
            <button
              onClick={() => { setOpen(false); navigate('/agency-settings'); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" /> Manage agencies
            </button>
            <button
              onClick={() => { setOpen(false); navigate('/agency-settings'); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add agency
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
