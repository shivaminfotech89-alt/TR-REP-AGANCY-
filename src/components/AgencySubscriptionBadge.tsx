import React, { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { classifySubscription, daysRemaining, type SubscriptionRecord } from '../lib/subscriptionStatus';

/**
 * THE SUBSCRIPTION STATE, INLINE BESIDE THE AGENCY NAME (AUDIT G38).
 *
 * ⚠ ONE WORD, WHERE THE NAME ALREADY IS. This replaces a standalone box at the top of Agency
 * Settings that answered a question the Manage Subscription tab now answers properly. The box
 * showed ONE agency's state on a page whose entire subject is the agency you have selected -
 * so it restated the context bar's scope in a card twice its size, and an owner with four
 * agencies still had to switch between them to learn what they owed.
 *
 * What is genuinely useful at the top of the page is not the box but the fact: is the thing I
 * am about to work in paid for? That is a badge, not a panel.
 *
 * ⚠ IT SHOWS NOTHING WHILE IT DOES NOT KNOW. No document, no badge - and a failed read renders
 * nothing rather than "NOT BILLED". The whole of G28 was a screen supplying a plausible value
 * where a missing one belonged, and a status chip is exactly the shape that invites it.
 */
export function AgencySubscriptionBadge({ agencyId }: { agencyId?: string }) {
  const [sub, setSub] = useState<SubscriptionRecord | null>(null);
  const [known, setKnown] = useState(false);

  useEffect(() => {
    if (!agencyId) { setSub(null); setKnown(false); return; }
    setKnown(false);
    const stop = onSnapshot(
      doc(db, 'subscriptions', agencyId),
      snap => { setSub(snap.exists() ? (snap.data() as SubscriptionRecord) : null); setKnown(true); },
      err => { console.warn('subscription badge read failed', err); setSub(null); setKnown(false); },
    );
    return () => stop();
  }, [agencyId]);

  if (!agencyId || !known) return null;

  const now = Date.now();
  const cls = classifySubscription(sub, now);
  const left = daysRemaining(sub, now);

  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold border ${cls.tone}`}>
        {cls.word}
      </span>
      {/* ⚠ THE COUNTDOWN ONLY WHEN IT IS CLOSE ENOUGH TO MATTER. A badge reading "310 days
          left" beside every agency name is noise that trains the eye to skip the badge - and
          then the one saying 9 days is skipped too. */}
      {cls.hasExpiry && left !== null && left <= 45 && (
        <span className={`text-[10px] font-bold ${left < 0 ? 'text-red-300' : 'text-amber-300'}`}>
          {left < 0 ? `${Math.abs(left)}d ago` : `${left}d left`}
        </span>
      )}
    </span>
  );
}
