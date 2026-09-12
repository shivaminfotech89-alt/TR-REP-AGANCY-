import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAgency } from '../lib/AgencyContext';
import { CARD, CARD_PAD, LABEL } from '../lib/ui';
import { formatPrice, gstBreakdown } from '../lib/pricing';
import {
  classifySubscription, daysRemaining, type SubscriptionRecord,
} from '../lib/subscriptionStatus';
import {
  createOrder, payWithRazorpay, CheckoutDismissed, PaymentTakenButUnverified, GatewayDeclined,
} from '../lib/subscriptionClient';
import { formatDDMMYYYY } from '../lib/utils';
import { ShieldCheck, Loader2, AlertTriangle, CreditCard, Clock, Download } from 'lucide-react';
import { canIssueReceipt, printReceipt } from '../lib/receipt';

/**
 * MANAGE SUBSCRIPTION — every agency this account owns, in one list (AUDIT G38).
 *
 * ⚠ A LIST, NOT A SWITCHER, AND THAT IS THE WHOLE POINT OF THE TAB. Three of the seven live
 * owners hold more than one agency - four, two and two - so several is the ordinary case rather
 * than an edge one. This is the only screen where "what do I owe and when" is answerable across
 * everything an account holds; showing one agency at a time would destroy the one thing it is
 * for and send the operator back to the switcher to find out whether anything is due.
 *
 * ⚠ SORTED BY EXPIRY, SOONEST FIRST - not alphabetically. The screen's subject is a deadline,
 * so the row that needs attention is the row at the top. An alphabetical list buries an expiry
 * that is eleven days away behind four that are not.
 *
 * ⚠ IT READS AND WRITES NOTHING. `subscriptions/{agencyId}` carries `allow write: if false` for
 * every client (G29), so what is on screen is what the server recorded. Absence renders as
 * absence - see G28 for the screen this replaces, which showed twelve unpaid agencies as ACTIVE
 * PAID on an expiry date that changed daily.
 */

type Row = {
  id: string;
  name: string;
  sub: SubscriptionRecord | null;
};

export default function ManageSubscription() {
  const { agencies } = useAgency();
  const [subs, setSubs] = useState<Record<string, SubscriptionRecord> | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<
    { kind: 'ok' | 'warn' | 'bad'; text: string; stage?: string; detail?: string } | null
  >(null);

  const uid = auth.currentUser?.uid || '';

  useEffect(() => {
    if (!uid) { setSubs(null); return; }
    // Live: these documents are written by a function, so a payment lands here on its own.
    const stop = onSnapshot(
      query(collection(db, 'subscriptions'), where('ownerId', '==', uid)),
      snap => {
        const map: Record<string, SubscriptionRecord> = {};
        snap.forEach(d => { map[d.id] = d.data() as SubscriptionRecord; });
        setSubs(map);
      },
      err => {
        // ⚠ null MEANS "NOT READ", WHICH IS NOT "NOT SUBSCRIBED" (G34). A failed read must
        // never render as an absence of subscriptions.
        console.warn('subscriptions read failed', err);
        setSubs(null);
      },
    );
    return () => stop();
  }, [uid]);

  const now = Date.now();

  const rows: Row[] = agencies
    .map(a => ({ id: a.id, name: a.name || '(unnamed)', sub: subs ? (subs[a.id] ?? null) : null }))
    .sort((x, y) => {
      // Rows with no expiry (admin-created, or nothing recorded) sort last: they carry no
      // deadline, so they are never the thing that needs attention first.
      const ex = Number(x.sub?.expiryDate || 0) || Number.MAX_SAFE_INTEGER;
      const ey = Number(y.sub?.expiryDate || 0) || Number.MAX_SAFE_INTEGER;
      return ex - ey;
    });

  /**
   * THE SUMMARY LINE. What someone opens this tab to find out.
   *
   * ⚠ IT COUNTS WHAT EXPIRES, NOT WHAT EXISTS. "4 agencies, 1 expiring in 23 days" answers the
   * question in one line; four dates in a column make the reader do the arithmetic that brought
   * them here. Only rows with a real expiry are eligible - an admin-created agency has none.
   */
  const dated = rows.filter(r => classifySubscription(r.sub, now).hasExpiry);
  const soonest = dated.length
    ? dated.reduce((a, b) => (Number(a.sub?.expiryDate) <= Number(b.sub?.expiryDate) ? a : b))
    : null;
  const soonestDays = soonest ? daysRemaining(soonest.sub, now) : null;

  const renew = async (row: Row) => {
    if (busyId) return;
    setBusyId(row.id);
    setNote(null);
    try {
      const order = await createOrder('renewal', row.id);
      const paid = await payWithRazorpay(order, {
        name: row.name,
        email: auth.currentUser?.email || '',
        contact: '',
      });
      setNote({
        kind: 'ok',
        text: paid.alreadyProcessed
          ? 'That payment had already been recorded. Nothing was charged twice.'
          : `${row.name} runs to ${formatDDMMYYYY(paid.expiryDate || 0)}.`
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
    } finally {
      setBusyId(null);
    }
  };

  const { taxable, tax, ratePercent } = gstBreakdown();

  return (
    <div className="space-y-4">
      <div className={`${CARD} ${CARD_PAD} space-y-2`}>
        <span className={LABEL}>Manage subscription</span>
        <p className="text-sm font-bold text-slate-900">
          {rows.length} {rows.length === 1 ? 'agency' : 'agencies'}
          {subs === null
            ? <span className="font-normal text-amber-700"> &middot; subscriptions not read</span>
            : soonest && soonestDays !== null
              ? <span className="font-normal text-slate-600">
                  {' '}&middot; next expiry {soonestDays < 0 ? 'was' : 'in'}{' '}
                  {Math.abs(soonestDays)} days ({soonest.name})
                </span>
              : <span className="font-normal text-slate-600"> &middot; nothing with an expiry date</span>}
        </p>
        <p className="text-[11px] text-slate-500">
          {formatPrice()} per agency per year, inclusive &mdash; {formatPrice(taxable)} +{' '}
          {formatPrice(tax)} GST at {ratePercent}%.
        </p>
      </div>

      {note && (
        <div className={`text-[11px] font-medium rounded px-2.5 py-2 border flex gap-2 ${
          note.kind === 'ok' ? 'bg-green-50 border-green-300 text-green-900'
          : note.kind === 'bad' ? 'bg-red-50 border-red-300 text-red-900'
          : 'bg-amber-50 border-amber-300 text-amber-900'}`}>
          {note.kind === 'ok' ? <ShieldCheck className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>
            {note.stage && <strong className="block">{note.stage}.</strong>}
            {note.text}
            {note.detail && <span className="block mt-1 font-mono text-[10px] opacity-80 break-all">{note.detail}</span>}
          </span>
        </div>
      )}

      <div className={`${CARD} overflow-x-auto`}>
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase tracking-wider font-bold text-[10px]">
              <th className="p-3">Agency</th>
              <th className="p-3">Status</th>
              <th className="p-3">Expires</th>
              {/* A RECEIPT, NOT AN INVOICE - the column says so, because the two are different documents and only
                  one of them exists today (AUDIT G71, G30). */}
              <th className="p-3">Receipt</th>
              <th className="p-3 text-right">Renew</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => {
              const cls = classifySubscription(r.sub, now);
              const left = daysRemaining(r.sub, now);
              const unread = subs === null;
              return (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="p-3 font-bold text-slate-900">{r.name}</td>
                  <td className="p-3">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${
                      unread ? 'bg-amber-100 text-amber-800 border-amber-300' : cls.tone}`}>
                      {unread ? 'NOT READ' : cls.word}
                    </span>
                    {!unread && cls.key === 'granted' && (
                      <span className="block text-[10px] text-slate-400 mt-0.5">no invoice behind it</span>
                    )}
                  </td>
                  <td className="p-3">
                    {/* An em dash where there is no expiry — an admin-created agency has none,
                        and printing a date would invent a deadline no payment supports. */}
                    {unread || !cls.hasExpiry ? (
                      <span className="text-slate-400">&mdash;</span>
                    ) : (
                      <span className={cls.key === 'expired' ? 'text-red-700 font-medium' : 'text-slate-700'}>
                        {formatDDMMYYYY(Number(r.sub?.expiryDate || 0))}
                        {left !== null && (
                          <span className="block text-[10px] text-slate-400">
                            {left < 0 ? `${Math.abs(left)} days ago` : `${left} days left`}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    {/* ⚠ NEVER OFFERED OVER A FAILED READ (AUDIT G71). `unread` means the subscriptions could not be
                        read, and a row with no receipt button then says "no payment" about a payment that may exist. */}
                    {!unread && canIssueReceipt(cls, r.sub) ? (
                      <button
                        type="button"
                        onClick={() => printReceipt({ agencyName: r.name, sub: r.sub! })}
                        className="inline-flex items-center gap-1.5 border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold text-[11px] px-2.5 py-1.5 rounded-lg"
                        title="A receipt for the money received. Not a tax invoice."
                      >
                        <Download className="w-3 h-3" /> Receipt
                      </button>
                    ) : (
                      <span
                        className="text-slate-400"
                        title={unread ? 'Subscriptions could not be read' : 'No payment to receipt'}
                      >
                        &mdash;
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      onClick={() => renew(r)}
                      disabled={!!busyId}
                      className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-300 text-white font-bold text-[11px] px-3 py-1.5 rounded-lg"
                    >
                      {busyId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CreditCard className="w-3 h-3" />}
                      {/* ⚠ "RENEW" ON AN AGENCY THAT WAS NEVER BILLED ARGUES AGAINST ITS OWN
                          USE (AUDIT G40). The path works - createSubscriptionOrder needs only
                          an owned agency, and verifySubscriptionPayment CREATES the document
                          when none exists - but a row reading NOT BILLED beside a button
                          reading "Renew a year" tells its reader there is nothing to renew, and
                          they do not press it. The capability was reachable and unreachable at
                          the same time, through wording alone. */}
                      {busyId === r.id ? 'Opening…' : cls.key === 'none' ? 'Subscribe' : 'Renew a year'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="p-4 text-slate-500">No agencies on this account yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ⚠ STATED, BECAUSE IT IS THE NORMAL CASE HERE FOR THE NEXT YEAR AND A HALF. Nine
          founding agencies hold eighteen-month grants, so almost every renewal on this screen
          will be an early one. A customer who fears losing paid-up days will wait, and then
          renew late - which is the outcome this screen exists to prevent. */}
      <p className="text-[10px] text-slate-500 flex items-start gap-1.5">
        <Clock className="w-3 h-3 mt-0.5 shrink-0" />
        Renewing early adds a year to the date shown rather than restarting from today. No days are lost.
      </p>
    </div>
  );
}
