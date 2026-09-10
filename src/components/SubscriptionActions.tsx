import React, { useState } from 'react';
import { formatPrice, SUBSCRIPTION_INCLUSIVE_INR } from '../lib/pricing';
import { classifySubscription, type SubscriptionRecord } from '../lib/subscriptionStatus';
import {
  cancelSubscription, grantDays, markPaid, AdminSubError, type AdminSubOp,
} from '../lib/adminSubscription';
import { Loader2, AlertTriangle, ShieldCheck } from 'lucide-react';

/**
 * CANCEL, GRANT DAYS, MARK PAID — the vendor's three actions on one subscription (AUDIT G40).
 *
 * ⚠ EVERY ONE OF THEM REQUIRES A REASON OR A REFERENCE, AND THE SERVER REFUSES WITHOUT ONE.
 * The form asks for it because asking is kinder than refusing; the refusal is what guarantees
 * it. These write facts about money into a record a GST invoice can point at, and a year later
 * "why is this cancelled" has to be answerable from the document rather than from memory.
 *
 * ⚠ NOTHING HERE DECIDES WHETHER IT MAY HAPPEN. The buttons are drawn for the vendor because
 * that is who the screen is for; whether the action lands is decided by the verified auth token
 * inside the function. If this component were reachable by someone else it would simply meet a
 * refusal, which is the correct direction for that mistake.
 */

type Props = {
  agencyId: string;
  agencyName: string;
  sub: SubscriptionRecord | null;
  onDone: (message: string) => void;
};

export function SubscriptionActions({ agencyId, agencyName, sub, onDone }: Props) {
  const [open, setOpen] = useState<AdminSubOp | null>(null);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [days, setDays] = useState('30');
  const [amount, setAmount] = useState(String(SUBSCRIPTION_INCLUSIVE_INR));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cls = classifySubscription(sub, Date.now());
  const alreadyCancelled = cls.cancelled;

  const close = () => {
    setOpen(null); setReason(''); setReference(''); setDays('30');
    setAmount(String(SUBSCRIPTION_INCLUSIVE_INR)); setError(null);
  };

  const run = async () => {
    if (busy || !open) return;
    setBusy(true); setError(null);
    try {
      if (open === 'cancel') {
        await cancelSubscription(agencyId, reason);
        onDone(`${agencyName}: subscription cancelled.`);
      } else if (open === 'grant_days') {
        const n = Number(days);
        await grantDays(agencyId, n, reason);
        onDone(`${agencyName}: ${n} days granted.`);
      } else {
        const amt = Number(amount);
        await markPaid(agencyId, reference, amt, Number(days) || 365);
        onDone(`${agencyName}: ${formatPrice(amt)} recorded as paid (manual).`);
      }
      close();
    } catch (e: any) {
      setError(e instanceof AdminSubError ? e.message : String(e?.message || 'Failed.'));
    } finally {
      setBusy(false);
    }
  };

  const btn = 'text-[10px] font-bold uppercase tracking-wide px-2.5 py-1.5 rounded-lg border';

  if (!open) {
    return (
      <div className="flex items-center justify-end gap-1.5 flex-wrap">
        <button type="button" onClick={() => setOpen('mark_paid')}
          className={`${btn} bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100`}>
          Mark paid
        </button>
        <button type="button" onClick={() => setOpen('grant_days')}
          className={`${btn} bg-blue-50 text-blue-800 border-blue-300 hover:bg-blue-100`}>
          Grant days
        </button>
        {/* ⚠ NOT OFFERED WHEN THERE IS NOTHING TO CANCEL, or when it is already cancelled. A
            button that always fails teaches its reader to distrust the row it sits in. */}
        {sub && !alreadyCancelled && (
          <button type="button" onClick={() => setOpen('cancel')}
            className={`${btn} bg-red-50 text-red-800 border-red-300 hover:bg-red-100`}>
            Cancel
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="text-left bg-slate-50 border border-slate-300 rounded-lg p-2.5 space-y-2">
      <p className="text-[11px] font-bold text-slate-900">
        {open === 'cancel' ? 'Cancel subscription' : open === 'grant_days' ? 'Grant days' : 'Record a payment'}
        <span className="font-normal text-slate-500"> — {agencyName}</span>
      </p>

      {open === 'cancel' && (
        <p className="text-[10px] text-slate-600">
          The expiry moves to now. The provenance is kept, so a cancelled grant still reads as a
          grant, and the row will say CANCELLED rather than EXPIRED.
        </p>
      )}

      {open !== 'cancel' && (
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="block text-[9px] font-bold uppercase text-slate-500">Days</span>
            <input type="number" min={1} value={days} onChange={e => setDays(e.target.value)}
              className="w-full px-2 py-1 text-xs border border-slate-300 rounded" />
          </label>
          {open === 'mark_paid' && (
            <label className="flex-1">
              <span className="block text-[9px] font-bold uppercase text-slate-500">Amount received</span>
              <input type="number" min={1} value={amount} onChange={e => setAmount(e.target.value)}
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded" />
            </label>
          )}
        </div>
      )}

      <label className="block">
        <span className="block text-[9px] font-bold uppercase text-slate-500">
          {open === 'mark_paid' ? 'Payment reference (required)' : 'Reason (required)'}
        </span>
        <input
          type="text"
          autoFocus
          value={open === 'mark_paid' ? reference : reason}
          onChange={e => (open === 'mark_paid' ? setReference(e.target.value) : setReason(e.target.value))}
          placeholder={open === 'mark_paid'
            ? 'Cheque 004312, UTR, or "cash, receipt 14"'
            : open === 'cancel' ? 'Why this is being ended' : 'Why these days are being given'}
          className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
        />
      </label>

      {open === 'mark_paid' && (
        <p className="text-[10px] text-amber-900 bg-amber-50 border border-amber-300 rounded px-2 py-1">
          This counts toward revenue and carries <strong>no gateway record</strong>. It will show
          as ACTIVE (MANUAL) so it can be told apart at reconciliation.
        </p>
      )}

      {error && (
        <p className="text-[10px] font-bold text-red-900 bg-red-50 border border-red-300 rounded px-2 py-1 flex gap-1.5">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={close} className="text-[11px] font-bold text-slate-600 px-2 py-1">
          Back
        </button>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className={`inline-flex items-center gap-1.5 text-white font-bold text-[11px] px-3 py-1.5 rounded-lg disabled:bg-slate-300 ${
            open === 'cancel' ? 'bg-red-600 hover:bg-red-500' : 'bg-slate-900 hover:bg-slate-800'}`}
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
          {open === 'cancel' ? 'Cancel it' : open === 'grant_days' ? 'Grant' : 'Record'}
        </button>
      </div>
    </div>
  );
}
