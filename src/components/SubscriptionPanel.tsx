import React, { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAgency } from '../lib/AgencyContext';
import { CARD, CARD_PAD, LABEL } from '../lib/ui';
import { formatPrice, gstBreakdown } from '../lib/pricing';
import {
  createOrder, payWithRazorpay, CheckoutDismissed, PaymentTakenButUnverified, GatewayDeclined,
} from '../lib/subscriptionClient';
import { formatDDMMYYYY } from '../lib/utils';
import {
  classifySubscription, daysRemaining, type SubscriptionRecord,
} from '../lib/subscriptionStatus';
import { ShieldCheck, Loader2, AlertTriangle, CreditCard, Clock, PlusSquare } from 'lucide-react';

/**
 * THE ACTIVE AGENCY'S SUBSCRIPTION, AND THE ONE BUTTON THAT RENEWS IT (AUDIT G31).
 *
 * ⚠ IT READS `subscriptions/{agencyId}` AND WRITES NOTHING. It cannot: that collection carries
 * `allow write: if false` for every client, which is the whole point of it (G29). What is on
 * screen here is what the server recorded, never what this component believes happened.
 *
 * ⚠ AND IT SHOWS ABSENCE AS ABSENCE. The screen this replaces read
 * `subscriptionStatus || 'active'` against a database where no agency had ever paid, and
 * rendered twelve customers as ACTIVE PAID expiring on a date that changed daily (G28). Every
 * state below comes from a document that exists. When there is none, it says there is none.
 */

/**
 * ⚠ THE VOCABULARY LIVES IN lib/subscriptionStatus.ts, NOT HERE. This screen used to classify
 * a subscription itself, and the Admin Panel's table asserted NOT BILLED without reading the
 * collection at all - two screens answering the same question, one of them without looking.
 * Which state a payment is in is a single fact; only the sentence around it differs.
 */
type Sub = SubscriptionRecord;

/** The owner's phrasing. The vendor's table renders the same classification differently. */
function lineFor(sub: Sub | null, cls: ReturnType<typeof classifySubscription>, now: number) {
  const days = daysRemaining(sub, now);
  switch (cls.key) {
    case 'none':
      return 'No subscription has been recorded for this agency.';
    case 'admin':
      return sub?.grantReason || 'Created by the vendor. No payment, and no expiry.';
    case 'expired':
      return `Expired on ${formatDDMMYYYY(Number(sub?.expiryDate || 0))}.`;
    case 'granted':
      return `${sub?.grantReason || 'Granted, not purchased.'} Runs to `
        + `${formatDDMMYYYY(Number(sub?.expiryDate || 0))} — ${days} days.`;
    default:
      return `Paid to ${formatDDMMYYYY(Number(sub?.expiryDate || 0))} — ${days} days remaining.`;
  }
}

export default function SubscriptionPanel() {
  const { activeAgency } = useAgency();
  const [sub, setSub] = useState<Sub | null>(null);
  const [loaded, setLoaded] = useState(false);
  /**
   * ⚠ AGENCY SLOTS ARE KEYED BY USER, NOT BY AGENCY, AND THAT IS WHY THIS PANEL MUST RENDER
   * WITH NO AGENCY SELECTED.
   *
   * A brand-new customer has no agency. Under the gate they cannot create one until they hold
   * a slot, and a slot is bought here. If this component returned null when `activeAgency` was
   * absent - as it did - the first thing a paying customer would meet is a paywall with no way
   * to pay. That is worse than no paywall: it is a locked door with no handle, and it would
   * have shipped invisibly because every existing account already has an agency.
   */
  const [slots, setSlots] = useState<number | null>(null);
  const [slotsLoaded, setSlotsLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  /**
   * ⚠ `stage` NAMES WHERE IT FAILED, because the three failures are indistinguishable to the
   * person looking at them and lead to completely different places:
   *
   *   'gateway'  Razorpay refused. No money moved. The app was never involved.
   *   'server'   The payment succeeded and this app could not confirm it. MONEY MOVED.
   *   'app'      It never got as far as a payment - the order could not even be created.
   *
   * `detail` is the machine-readable half, shown in mono beneath. It is the string to quote,
   * and printing it is the difference between a report that can be acted on and "it failed".
   */
  const [note, setNote] = useState<
    { kind: 'ok' | 'warn' | 'bad'; text: string; stage?: string; detail?: string } | null
  >(null);

  const agencyId = activeAgency?.id || '';

  useEffect(() => {
    if (!agencyId) { setSub(null); setLoaded(true); return; }
    setLoaded(false);
    // Live, because the document is written by a function rather than by this screen - after a
    // payment the update arrives on its own rather than needing a reload.
    const stop = onSnapshot(
      doc(db, 'subscriptions', agencyId),
      snap => { setSub(snap.exists() ? (snap.data() as Sub) : null); setLoaded(true); },
      err => {
        console.warn('subscription read failed', err);
        setSub(null);
        setLoaded(true);
        setNote({ kind: 'warn', text: 'Could not read the subscription record. The status below may be incomplete.' });
      },
    );
    return () => stop();
  }, [agencyId]);

  const uid = auth.currentUser?.uid || '';
  useEffect(() => {
    if (!uid) { setSlots(null); setSlotsLoaded(true); return; }
    setSlotsLoaded(false);
    const stop = onSnapshot(
      doc(db, 'entitlements', uid),
      snap => {
        // ⚠ NO DOCUMENT MEANS ZERO, AND THAT IS A FACT RATHER THAN A FALLBACK. Nobody is
        // seeded with an entitlement: all seven existing owners start at zero deliberately,
        // because backfilling would mean deciding whether their existing agencies retroactively
        // consumed slots, and that question has no right answer. Absence here is the answer.
        setSlots(snap.exists() ? Number((snap.data() as any)?.agencySlots || 0) : 0);
        setSlotsLoaded(true);
      },
      err => { console.warn('entitlement read failed', err); setSlots(null); setSlotsLoaded(true); },
    );
    return () => stop();
  }, [uid]);

  const now = Date.now();
  const cls = classifySubscription(sub, now);
  const state = { word: cls.word, tone: cls.tone, line: lineFor(sub, cls, now) };
  const { taxable, tax, ratePercent } = gstBreakdown();

  const renew = async () => {
    if (!agencyId || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const order = await createOrder('renewal', agencyId);
      const paid = await payWithRazorpay(order, {
        name: activeAgency?.name || '',
        email: auth.currentUser?.email || '',
        contact: (activeAgency as any)?.phone || '',
      });
      setNote({
        kind: 'ok',
        text: paid.alreadyProcessed
          // Not an error. The same payment reaching the server twice is ordinary, and the
          // second arrival is refused rather than counted (G30).
          ? 'That payment had already been recorded. Nothing was charged twice.'
          : `Payment recorded. Subscription runs to ${formatDDMMYYYY(paid.expiryDate || 0)}.`
            + (paid.invoicePending ? ' The GST invoice follows separately.' : ''),
      });
    } catch (e: any) {
      if (e instanceof CheckoutDismissed) {
        setNote(null);                       // Closing the window is not an event worth reporting.
      } else if (e instanceof PaymentTakenButUnverified) {
        // ⚠ THE ONE MESSAGE THAT MUST NOT SAY "FAILED". Money moved; the customer will see it
        // on their statement whatever this screen claims.
        setNote({
          kind: 'bad',
          stage: 'The payment succeeded and this app could not confirm it',
          text: e.message,
          detail: `payment ${e.paymentId} · order ${e.orderId}`,
        });
      } else if (e instanceof GatewayDeclined) {
        setNote({
          kind: 'warn',
          // ⚠ SAYS WHOSE REFUSAL IT WAS. Without this the customer cannot tell a declined card
          // from a broken application, and will retry the same card indefinitely on a failure
          // that is nothing to do with the card.
          stage: e.refusedBeforeAuth
            ? 'The payment gateway refused this before asking your bank'
            : 'The payment gateway declined this',
          text: e.message + ' Nothing was charged.',
          detail: e.detail,
        });
      } else {
        setNote({
          kind: 'warn',
          stage: 'The payment could not be started',
          text: String(e?.message || 'Unknown error.') + ' Nothing was charged.',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const buySlot = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const order = await createOrder('new_agency');
      const paid = await payWithRazorpay(order, {
        name: auth.currentUser?.displayName || '',
        email: auth.currentUser?.email || '',
        contact: '',
      });
      setNote({
        kind: 'ok',
        text: paid.alreadyProcessed
          ? 'That payment had already been recorded. Nothing was charged twice.'
          : 'Slot added. You can create one agency.'
            + (paid.invoicePending ? ' The GST invoice follows separately.' : ''),
      });
    } catch (e: any) {
      if (e instanceof CheckoutDismissed) setNote(null);
      else if (e instanceof PaymentTakenButUnverified) {
        setNote({ kind: 'bad', stage: 'The payment succeeded and this app could not confirm it',
          text: e.message, detail: `payment ${e.paymentId} · order ${e.orderId}` });
      } else if (e instanceof GatewayDeclined) {
        setNote({ kind: 'warn',
          stage: e.refusedBeforeAuth
            ? 'The payment gateway refused this before asking your bank'
            : 'The payment gateway declined this',
          text: e.message + ' Nothing was charged.', detail: e.detail });
      } else {
        setNote({ kind: 'warn', stage: 'The payment could not be started',
          text: String(e?.message || 'Unknown error.') + ' Nothing was charged.' });
      }
    } finally { setBusy(false); }
  };

  /** The slots card. Rendered whether or not an agency is selected - see the note on `slots`. */
  const slotsCard = (
    <div className={`${CARD} ${CARD_PAD} space-y-2.5`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <span className={LABEL}>Agency slots</span>
          <h3 className="text-sm font-bold text-slate-900">
            {slotsLoaded
              ? (slots === null ? 'Not known' : `${slots} available`)
              : 'Checking…'}
          </h3>
        </div>
        <PlusSquare className="w-4 h-4 text-slate-400 mt-1" />
      </div>
      <p className="text-xs text-slate-600">
        {slots && slots > 0
          ? `You can create ${slots} more ${slots === 1 ? 'agency' : 'agencies'}. Creating one uses a slot.`
          : 'One slot lets you create one agency. Agencies you already have are unaffected.'}
      </p>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
        <span className="text-base font-black text-slate-900">{formatPrice()}</span>
        <span className="text-[11px] text-slate-500">
          {' '}per slot, inclusive &mdash; includes the first year's subscription
        </span>
      </div>
      <button
        type="button"
        onClick={buySlot}
        disabled={busy}
        className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-bold text-xs px-4 py-2.5 rounded-lg"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusSquare className="w-4 h-4" />}
        {busy ? 'Opening checkout…' : 'Buy a slot'}
      </button>
    </div>
  );

  // ⚠ NO EARLY `return null`. It used to read `if (!activeAgency) return null`, which hid the
  // only way to buy the first agency from the only people who need it.
  if (!activeAgency) {
    return (
      <div className="space-y-3">
        {note && <NoteBox note={note} />}
        {slotsCard}
      </div>
    );
  }

  return (
    <div className="space-y-3">
    <div className={`${CARD} ${CARD_PAD} space-y-3`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <span className={LABEL}>Subscription</span>
          <h3 className="text-sm font-bold text-slate-900">{activeAgency.name}</h3>
        </div>
        {loaded ? (
          <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${state.tone}`}>
            {state.word}
          </span>
        ) : (
          <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
        )}
      </div>

      {loaded && <p className="text-xs text-slate-600">{state.line}</p>}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-base font-black text-slate-900">{formatPrice()}</span>
          <span className="text-[11px] text-slate-500">
            per year, inclusive &mdash; {formatPrice(taxable)} + {formatPrice(tax)} GST at {ratePercent}%
          </span>
        </div>
      </div>

      {note && <NoteBox note={note} />}

      <button
        type="button"
        onClick={renew}
        disabled={busy}
        className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-300 text-white font-bold text-xs px-4 py-2.5 rounded-lg"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
        {busy ? 'Opening checkout…' : sub ? 'Renew for a year' : 'Subscribe'}
      </button>

      {/* ⚠ SAID PLAINLY BECAUSE IT IS THE NORMAL CASE HERE, not an edge one: nine founding
          agencies hold eighteen-month grants, so almost every renewal on this screen for the
          next year and a half will be an early one. A customer who fears losing paid-up days
          will simply wait, and then renew late. */}
      <p className="text-[10px] text-slate-500 flex items-start gap-1.5">
        <Clock className="w-3 h-3 mt-0.5 shrink-0" />
        Renewing early adds a year to the date above rather than restarting from today. No days are lost.
      </p>
    </div>
    {slotsCard}
    </div>
  );
}

type Note = { kind: 'ok' | 'warn' | 'bad'; text: string; stage?: string; detail?: string };

/** One rendering, two callers. A second copy is how the two messages come to disagree. */
function NoteBox({ note }: { note: Note }) {
  return (
    <div className={`text-[11px] font-medium rounded px-2.5 py-2 border flex gap-2 ${
      note.kind === 'ok' ? 'bg-green-50 border-green-300 text-green-900'
      : note.kind === 'bad' ? 'bg-red-50 border-red-300 text-red-900'
      : 'bg-amber-50 border-amber-300 text-amber-900'}`}>
      {note.kind === 'ok' ? <ShieldCheck className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
      <span>
        {note.stage && <strong className="block">{note.stage}.</strong>}
        {note.text}
        {note.detail && (
          <span className="block mt-1 font-mono text-[10px] opacity-80 break-all">{note.detail}</span>
        )}
      </span>
    </div>
  );
}
