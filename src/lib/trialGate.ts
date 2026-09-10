import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { classifySubscription, hoursRemaining, type SubscriptionRecord } from './subscriptionStatus';
import { anchorClock, serverNow, clockIsAnchored } from './serverClock';

/**
 * MAY THIS AGENCY RECORD NEW WORK? (AUDIT G49)
 *
 * ⚠⚠ THIS IS A SOFT GATE. IT IS NOT A SECURITY BOUNDARY, AND NOTHING SHOULD EVER BE BUILT ON
 * THE ASSUMPTION THAT IT IS.
 *
 * It runs in the browser. Anyone who opens a console can call Firestore directly and write
 * whatever the security rules permit - and the rules permit an owner to write their own jobs,
 * with no reference to a subscription.
 *
 * That is deliberate, and the reasoning is worth keeping because the alternative looks
 * attractive until it is costed:
 *
 *   A rule enforcing this needs `get(/subscriptions/$(agencyId))` - ONE DOCUMENT-ACCESS CALL PER
 *   DOCUMENT WRITTEN. Firestore allows TWENTY per transaction or batched write. NewJob writes an
 *   entire MR's transformers in one transaction, and the largest live MR is EIGHTEEN. So a
 *   rules-level trial gate would work today and refuse a twenty-transformer intake - the exact
 *   ceiling removed in G46, reintroduced on purpose.
 *
 *   And the person it would defend against does not exist. A prospect deciding whether to spend
 *   Rs 5,900 does not bypass a paywall through the Firestore console; someone who would was never
 *   going to buy. The gate buys real security against nobody and costs a hard cap on real work.
 *
 * So: soft, said plainly, and if a boundary is ever needed it belongs in a Cloud Function that
 * owns the write - not in a rule that pays a lookup per row.
 */

export type TrialState = {
  /** False only for a trial that has ended. See classifySubscription for why nothing else. */
  canWrite: boolean;
  /** 'trial' while live, 'trial_ended' after, null when this is not a trial at all. */
  phase: 'trial' | 'trial_ended' | null;
  /**
   * Whole hours left. Null when there is no expiry, never negative.
   *
   * ⚠ FOR DECIDING, NOT FOR DISPLAY. The banner uses it to choose between the calm form and the
   * urgent one at 24 hours; no customer-facing string counts hours. See TRIAL_LENGTH_LABEL.
   */
  hoursLeft: number | null;
  /** The exact moment it ends, for showing a timestamp rather than "3 days". */
  expiryDate: number | null;
  /** True once the clock has been anchored to the server - see serverClock.ts. */
  clockAnchored: boolean;
  /** Still reading. Nothing should be refused while this is true. */
  loading: boolean;
};

const IDLE: TrialState = {
  canWrite: true, phase: null, hoursLeft: null, expiryDate: null,
  clockAnchored: false, loading: true,
};

/**
 * ⚠ IT DEFAULTS TO canWrite: true AND STAYS THERE WHILE LOADING OR ON A FAILED READ.
 *
 * A gate that refuses while it does not yet know is a gate that locks out paying customers on a
 * slow connection. The cost of the two errors is not symmetric: a trial that leaks a few extra
 * writes costs nothing, and a paid customer refused at Save loses work. Absence of an answer is
 * not an answer - the same rule G28 records for display, applied to a decision.
 */
export function useTrialGate(agencyId: string | undefined | null): TrialState {
  const [state, setState] = useState<TrialState>(IDLE);

  useEffect(() => { void anchorClock(); }, []);

  useEffect(() => {
    if (!agencyId) { setState({ ...IDLE, loading: false }); return; }
    setState(IDLE);
    const stop = onSnapshot(
      doc(db, 'subscriptions', agencyId),
      snap => {
        const sub = snap.exists() ? (snap.data() as SubscriptionRecord) : null;
        const now = serverNow();
        const cls = classifySubscription(sub, now);
        setState({
          canWrite: cls.canWrite,
          phase: cls.key === 'trial' ? 'trial' : cls.key === 'trial_ended' ? 'trial_ended' : null,
          hoursLeft: hoursRemaining(sub, now),
          expiryDate: sub?.expiryDate ?? null,
          clockAnchored: clockIsAnchored(),
          loading: false,
        });
      },
      err => {
        // ⚠ A FAILED READ MUST NOT REFUSE. See the note above: not knowing is not a no.
        console.warn('trial gate read failed - allowing writes', err);
        setState({ ...IDLE, loading: false });
      },
    );
    return () => stop();
  }, [agencyId]);

  return state;
}

/**
 * HOW LONG THE TRIAL IS, IN THE WORDS A CUSTOMER READS (AUDIT G50).
 *
 * ⚠ THE MECHANISM IS 72 HOURS AND THE WORDING IS "3 DAYS", DELIBERATELY.
 *
 * Hours are the right mechanism: calendar days would give an 11pm signup 73 hours and a 9am
 * signup 96, which is a different product depending on when someone happened to sign up. That
 * reasoning is why the expiry is a timestamp and not a date.
 *
 * But it is the vendor's reasoning, not the customer's. "3 days free" is what a person compares
 * against every other trial they have seen; "72 hours" makes them do arithmetic to reach the
 * same number and sounds like a countdown on a parking meter. The precision that matters to them
 * is not the duration - it is the MOMENT IT ENDS, which is shown exactly.
 *
 * So: one phrase for the length, one for the deadline, and no hour counting anywhere a customer
 * looks.
 */
export const TRIAL_LENGTH_LABEL = '3 days';

/**
 * "tomorrow at 4:15 pm", "today at 4:15 pm", "on Fri, 12 Sep at 4:15 pm".
 *
 * ⚠ "TOMORROW" IS A CALENDAR COMPARISON, NOT AN HOUR COUNT. Something ending in 20 hours may be
 * today or tomorrow depending on the time of day, and a customer reads the calendar the same way
 * they read a wall - saying "tomorrow" when they would say "today" is the kind of small wrongness
 * that makes a person distrust the rest of the message.
 */
export function describeEnd(expiryDate: number | null | undefined, nowMs: number): string {
  if (!expiryDate) return '';
  const end = new Date(expiryDate);
  const time = end.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(end) - startOfDay(new Date(nowMs))) / 86400000);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days === -1) return `yesterday at ${time}`;
  const date = end.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return `on ${date} at ${time}`;
}

/**
 * The refusal a blocked screen shows.
 *
 * ⚠ IT NAMES THE MOMENT IT ENDED, not "3 days ago". The expiry is a timestamp the server
 * computed; showing it lets a customer check it against their own record of when they started,
 * which "your trial expired" does not.
 */
export function trialRefusal(expiryDate: number | null, nowMs?: number): string {
  const when = expiryDate ? describeEnd(expiryDate, nowMs ?? serverNow()) : 'earlier';
  return `Your free trial ended ${when}. Everything you entered is still here and can be `
    + 'opened, printed and exported — new jobs, estimates and bills need a subscription.';
}
