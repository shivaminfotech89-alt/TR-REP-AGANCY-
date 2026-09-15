import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, Info, CircleAlert, Check, X } from 'lucide-react';
import { useAgency } from '../lib/AgencyContext';
import { buildNotifications, sortNotifications, type NotificationItem } from '../lib/notifications';
import { isDismissed, dismiss, undismiss } from '../lib/notificationDismissal';

/**
 * THE STANDING FACTS, BEHIND ONE BELL (AUDIT G93).
 *
 * The app had 66 persistent banners and not one of them could be cleared. The reasoning for
 * that was visibility; the effect was the opposite, because an operator who cannot clear a
 * message learns to look past it. These are the same facts, computed by the same predicates,
 * in a place they can be acknowledged.
 *
 * ⚠ DISMISSAL LASTS UNTIL THE FACT CHANGES, NOT FOREVER. Each item carries a signature of the
 * data behind it; dismissing stores that signature and the item returns the moment it differs.
 * Clearing the no-MR-number notice hides it until ANOTHER receipt is recorded without one. Per
 * browser, in localStorage - deliberately not per account, because agencies are DELEGATED
 * (G37) and a shared store would let one person's dismissal clear the notice for everyone
 * working that agency. See lib/notificationDismissal.ts.
 *
 * ⚠ THE POPOVER IS AgencySwitcher'S, ON PURPOSE. Same outside-click and Escape handling, same
 * `w-[min(20rem,...)]` clamp that keeps it on screen at the header's 12px mobile gutter, same
 * close-then-navigate. A second popover implementation is a second set of these bugs.
 *
 * ⚠ z-40, BETWEEN THE HEADER AND THE MODALS. The header is z-30 and the logout confirm is
 * z-50; a panel at z-50 would draw over a modal that is asking a question.
 */
export default function NotificationBell() {
  const {
    activeAgency, agencies, agencyJobs, agencyOil, atMasters, activeAtMaster,
    viewingAllTenders, agencyDataLoad, atSupersededNotice, agencyPointerNotice, globalConfigError,
  } = useAgency();
  const [open, setOpen] = useState(false);
  /** Bumped on dismiss so the list recomputes - localStorage is not reactive. */
  const [dismissTick, setDismissTick] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

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

  const built = useMemo(
    () => buildNotifications({
      activeAgency, agencies, agencyJobs, agencyOil, atMasters, activeAtMaster, viewingAllTenders,
      workUnavailable: agencyDataLoad.status === 'failed',
      atSupersededNotice, agencyPointerNotice, globalConfigError,
    }),
    [activeAgency, agencies, agencyJobs, agencyOil, atMasters, activeAtMaster, viewingAllTenders,
     agencyDataLoad.status, atSupersededNotice, agencyPointerNotice, globalConfigError],
  );

  const all = useMemo(() => sortNotifications(built.items), [built.items]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dismissTick is the invalidation
  const showing = useMemo(() => all.filter(i => !isDismissed(i.id, i.signature)), [all, dismissTick]);
  const hidden = all.length - showing.length;

  const onDismiss = (item: NotificationItem) => {
    dismiss(item.id, item.signature);
    setDismissTick(t => t + 1);
  };
  const restoreAll = () => {
    all.forEach(i => undismiss(i.id));
    setDismissTick(t => t + 1);
  };
  const goTo = (to: string) => { setOpen(false); navigate(to); };

  const blocking = showing.filter(i => i.tone === 'blocking').length;
  const count = showing.length;
  /** ⚠ A FAILED READ IS NOT A QUIET BELL (AUDIT G70). Zero here would be a lie, so it is a dot. */
  const unread = count > 0 || built.workUnavailable;

  const toneStyles = (tone: NotificationItem['tone']) => (
    tone === 'blocking' ? { row: 'border-rose-200 bg-rose-50', icon: 'text-rose-600', Icon: CircleAlert }
    : tone === 'warning' ? { row: 'border-amber-200 bg-amber-50', icon: 'text-amber-600', Icon: AlertTriangle }
    : { row: 'border-slate-200 bg-slate-50', icon: 'text-slate-500', Icon: Info }
  );

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? `Notifications: ${count} needing attention` : 'Notifications: nothing to report'}
        title={unread ? `${count} thing${count === 1 ? '' : 's'} need attention` : 'Nothing needs attention'}
        className="relative p-2 min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200"
      >
        <Bell className="w-4 h-4" />
        {unread && (
          <span
            className={`absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-black text-white flex items-center justify-center shadow-2xs ${
              blocking > 0 ? 'bg-rose-600' : built.workUnavailable && count === 0 ? 'bg-slate-500' : 'bg-amber-500'
            }`}
          >
            {count > 0 ? count : '!'}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full mt-1.5 w-[min(24rem,calc(100vw-1.5rem))] bg-white rounded-xl shadow-lg border border-slate-200 py-1.5 z-40 max-h-[70vh] overflow-y-auto"
        >
          <div className="px-3 py-1.5 flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Needs attention
            </p>
            {hidden > 0 && (
              <button
                type="button"
                onClick={restoreAll}
                className="text-[10px] font-bold text-slate-500 hover:text-slate-800 underline"
                title="Show the items dismissed on this browser"
              >
                {hidden} dismissed &mdash; show
              </button>
            )}
          </div>

          {/* ⚠ SAID BEFORE THE LIST, NOT INSTEAD OF IT. The tender faults below are real even
              when the work lists failed; it is the counts drawn from jobs and oil that are
              missing, and silence would read as "all clear" (AUDIT G70). */}
          {built.workUnavailable && (
            <div className="mx-2 mb-1.5 rounded-lg border border-slate-300 bg-slate-100 p-2.5 text-xs text-slate-700">
              <strong className="font-bold block">This agency&rsquo;s work could not be loaded.</strong>
              Anything counted from jobs or oil is unavailable &mdash; not zero. Nothing has been
              deleted.
            </div>
          )}

          {showing.length === 0 && !built.workUnavailable && (
            <div className="px-3 py-6 text-center">
              <Check className="w-6 h-6 text-emerald-500 mx-auto mb-1.5" />
              <p className="text-xs font-semibold text-slate-600">Nothing needs attention</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {hidden > 0 ? `${hidden} dismissed on this browser.` : 'This agency and its tenders are set up.'}
              </p>
            </div>
          )}

          {showing.map(item => {
            const t = toneStyles(item.tone);
            return (
              <div key={item.id} className={`mx-2 mb-1.5 rounded-lg border p-2.5 ${t.row}`}>
                <div className="flex items-start gap-2">
                  <t.Icon className={`w-4 h-4 shrink-0 mt-0.5 ${t.icon}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-900">{item.title}</p>
                    <p className="text-[11px] text-slate-600 mt-0.5">{item.detail}</p>
                    <button
                      type="button"
                      onClick={() => goTo(item.to)}
                      className="mt-1.5 text-[11px] font-bold text-blue-700 hover:text-blue-900 underline"
                    >
                      {item.linkLabel}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDismiss(item)}
                    className="shrink-0 p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-white/60"
                    aria-label={`Dismiss: ${item.title}`}
                    title="Dismiss until this changes"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}

          {/* The promise the X makes, stated where it is made. */}
          {showing.length > 0 && (
            <p className="px-3 pt-1 pb-1.5 text-[10px] text-slate-400 leading-snug">
              Dismissing hides an item on this browser until the fact behind it changes &mdash; another
              tender without rates, one more job belonging to no tender.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
