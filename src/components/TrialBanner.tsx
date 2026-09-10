import React from 'react';
import { useAgency } from '../lib/AgencyContext';
import { useTrialGate } from '../lib/trialGate';
import { formatPrice } from '../lib/pricing';
import { Clock, AlertTriangle } from 'lucide-react';

/**
 * THE TRIAL COUNTDOWN, AND THE WARNING THAT MATTERS MOST (AUDIT G49).
 *
 * ⚠ THE DAY-2 WARNING IS THE POINT OF THIS COMPONENT, not the expiry notice. A 72-hour trial is
 * short enough that a prospect can lose a day to a meeting and meet the end mid-task. A message
 * shown AFTER expiry tells someone what they have already lost; one shown with a day to go lets
 * them finish. If only one of the two could be built, it is this one.
 *
 * ⚠ AND IT SHOWS THE MOMENT, NOT A COUNT OF DAYS. "3 days" from an 11pm signup is a different
 * trial from one at 9am, so the subscription stores a timestamp and this shows hours plus the
 * actual end time. A customer can check that against their own memory of when they started;
 * "expires soon" gives them nothing to check.
 *
 * It renders nothing at all unless this agency is on a trial - a banner on every screen for every
 * customer would be noise, and noise is how a real warning gets skipped.
 */
export function TrialBanner() {
  const { activeAgency } = useAgency();
  const gate = useTrialGate(activeAgency?.id);

  if (gate.loading || !gate.phase) return null;

  const ended = gate.phase === 'trial_ended';
  const hours = gate.hoursLeft ?? 0;
  // ⚠ 24 HOURS, NOT "DAY 2". A trial started at 11pm on Monday ends at 11pm on Thursday, and the
  // useful moment to warn is 24 hours before THAT - not at some hour of a calendar day.
  const urgent = !ended && hours <= 24;

  if (!ended && !urgent) {
    return (
      <div className="flex items-center gap-2 text-[11px] px-3 py-1.5 bg-indigo-50 border-b border-indigo-200 text-indigo-900">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span>
          Free trial &mdash; <strong>{hours} hours left</strong>, until{' '}
          {gate.expiryDate && new Date(gate.expiryDate).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.
        </span>
        <a href="/pricing" className="underline font-semibold ml-auto shrink-0">What it costs</a>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 text-[11px] px-3 py-2 border-b ${
      ended ? 'bg-amber-100 border-amber-400 text-amber-950' : 'bg-amber-50 border-amber-300 text-amber-900'}`}>
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span className="flex-1">
        {ended ? (
          <>
            <strong>Your free trial has ended.</strong> Everything you entered is still here and
            can be opened, printed and exported. New jobs, estimates and bills need a subscription.
          </>
        ) : (
          <>
            <strong>Free trial ends in {hours} {hours === 1 ? 'hour' : 'hours'}</strong>
            {gate.expiryDate && <> &mdash; at {new Date(gate.expiryDate).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</>}.
            {' '}Your work stays either way; recording new work will need a subscription.
          </>
        )}
      </span>
      <a
        href="/agency-settings"
        className="shrink-0 bg-slate-900 hover:bg-slate-800 text-white font-bold px-3 py-1.5 rounded"
      >
        Subscribe &mdash; {formatPrice()}
      </a>
    </div>
  );
}
