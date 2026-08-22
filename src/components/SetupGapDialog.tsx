import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, X } from 'lucide-react';

/**
 * ONE dialog for every "you are blocked because agency setup is missing" case.
 *
 * A blocking alert that only names the problem leaves the operator to work out where it
 * is fixed - and agency setup is spread across Agency Settings, AT Settings, the
 * Estimate Master and the AT Allotments tab. Six alerts each growing their own redirect
 * would drift (the "rule applied once" pattern in AUDIT.md), so the route, the wording
 * shape and the unsaved-work warning live here.
 *
 * It does NOT decide what blocks. Callers keep their own guard and hand this the
 * description; this only presents it and offers the way out.
 */
export interface SetupGap {
  /** Dialog heading - the problem in a few words. */
  title: string;
  /** One sentence: what is wrong, naming the specific division / core type / AT. */
  problem: string;
  /** Where things currently stand, e.g. "12 of 12 used" - optional but preferred. */
  position?: string;
  /** Extra lines of context, rendered as a list. */
  detail?: string[];
  /** Primary button label, e.g. "Add Allotment". */
  actionLabel: string;
  /** Route the primary button navigates to, including any query the target reads. */
  actionTo: string;
  /**
   * Set when the current screen holds unsaved work. Navigating away would lose it, so
   * the dialog asks a second time before leaving rather than going straight there.
   */
  unsavedWarning?: string;
  /**
   * Called immediately before navigating - the caller's chance to stash a draft so
   * returning does not mean re-entering everything.
   */
  onBeforeNavigate?: () => void;
}

export default function SetupGapDialog({
  gap,
  onCancel,
}: {
  gap: SetupGap | null;
  onCancel: () => void;
}) {
  const navigate = useNavigate();
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  if (!gap) return null;

  const go = () => {
    gap.onBeforeNavigate?.();
    navigate(gap.actionTo);
  };

  const onPrimary = () => {
    // Never auto-navigate away from unsaved work without asking.
    if (gap.unsavedWarning && !confirmingLeave) {
      setConfirmingLeave(true);
      return;
    }
    go();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden">
        <div className="p-4 bg-amber-600 text-white flex items-start justify-between gap-3">
          <h3 className="font-bold text-sm sm:text-base flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>{gap.title}</span>
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="text-amber-100 hover:text-white p-1 rounded shrink-0"
            title="Cancel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">{gap.problem}</p>

          {gap.position && (
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs font-bold text-slate-800">
              {gap.position}
            </div>
          )}

          {gap.detail && gap.detail.length > 0 && (
            <ul className="text-xs leading-relaxed list-disc list-inside space-y-0.5 text-slate-600">
              {gap.detail.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          )}

          {confirmingLeave && gap.unsavedWarning && (
            <div className="px-3 py-2 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900">
              <strong className="block mb-0.5">Before you go:</strong>
              {gap.unsavedWarning}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-white text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onPrimary}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow flex items-center justify-center gap-1.5"
          >
            <span>{confirmingLeave ? 'Leave & ' : ''}{gap.actionLabel}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
