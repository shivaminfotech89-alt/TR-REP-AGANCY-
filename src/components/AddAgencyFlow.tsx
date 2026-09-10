import React, { useState } from 'react';
import { auth } from '../lib/firebase';
import { useAgency } from '../lib/AgencyContext';
import { formatPrice } from '../lib/pricing';
import {
  MAX_AGENCIES, priceFor, localNameProblems, purchaseAgencies, createAgenciesAsAdmin,
  startFreeTrial,
} from '../lib/agencyPurchase';
import {
  CheckoutDismissed, PaymentTakenButUnverified, GatewayDeclined,
} from '../lib/subscriptionClient';
import { Loader2, Plus, Trash2, AlertTriangle, ShieldCheck, CreditCard } from 'lucide-react';

/**
 * ADD AGENCY — how many, what they are called, one payment (AUDIT G38).
 *
 * ⚠ NAMES ONLY. Everything else an agency needs - DISCOM, GSTIN, letterhead, divisions,
 * prefixes - is filled in afterwards, per agency, in the form that already exists for editing
 * one. Asking for all of it up front made sense when creation was free and singular; asking for
 * it five times before a customer is allowed to pay does not, and the details are exactly what
 * someone wants to get right slowly rather than in a purchase flow.
 *
 * ⚠ THE PRICE SHOWN HERE IS A LABEL. The server multiplies its own constant by the number of
 * names it has validated, and that is what Razorpay is told. If the two ever disagreed the
 * customer is charged the server's figure - which is why the client is never allowed to send an
 * amount or a count.
 *
 * ⚠ THE VENDOR DOES NOT SEE A PAYMENT STEP, and does not tell the server so. `createAgency`
 * reads the verified auth token and refuses anyone else; this component simply shows a
 * different button. If the exemption ever moved, the screen would be wrong and the server would
 * still be right, which is the correct direction for that mistake.
 */

const SUPER_ADMIN_EMAIL = 'shivaminfotech89@gmail.com';

export default function AddAgencyFlow({ onDone }: { onDone: () => void }) {
  // ⚠ NO `as any`, AND NO OPTIONAL GUARD. This read
  //   `const { agencies, setActiveAgencyId, refreshAgencies } = useAgency() as any`
  // and then called `if (typeof refreshAgencies === 'function') refreshAgencies()` against a
  // context that has never had such a function. `as any` removed the compiler's ability to say
  // so, and the guard turned the missing dependency into a silent no-op (AUDIT G39). Naming
  // the real function here means a rename breaks the build instead of the screen.
  const { agencies, registerCreatedAgencies } = useAgency();

  const [mode, setMode] = useState<'ask' | 'names'>('ask');
  const [isTrial, setIsTrial] = useState(false);
  const [names, setNames] = useState<string[]>(['']);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<
    { kind: 'ok' | 'warn' | 'bad'; text: string; stage?: string; detail?: string } | null
  >(null);

  const isAdmin =
    String(auth.currentUser?.email || '').toLowerCase().trim() === SUPER_ADMIN_EMAIL;

  const existing = agencies.map((a: any) => String(a.name || ''));
  const problems = localNameProblems(names, existing);
  const filled = names.map(n => n.trim()).filter(Boolean);

  const setName = (i: number, v: string) =>
    setNames(prev => prev.map((n, k) => (k === i ? v : n)));

  const addRow = () => setNames(prev => (prev.length >= MAX_AGENCIES ? prev : [...prev, '']));
  const removeRow = (i: number) =>
    setNames(prev => (prev.length <= 1 ? prev : prev.filter((_, k) => k !== i)));

  const start = (multiple: boolean, trial = false) => {
    setNames(multiple ? ['', ''] : ['']);
    setIsTrial(trial);
    setMode('names');
    setNote(null);
  };

  const finish = (
    created: string[],
    docs: Array<{ id: string; document: Record<string, unknown> }>,
    invoicePending: boolean,
    paid: boolean,
  ) => {
    // ⚠ INTO CONTEXT STATE FIRST. `agencies` comes from a one-shot getDocs with no listener,
    // so without this the new agencies do not exist as far as any screen is concerned until a
    // reload (AUDIT G39).
    registerCreatedAgencies(docs);

    setNote({
      kind: 'ok',
      text: `${created.length} ${created.length === 1 ? 'agency' : 'agencies'} created: `
        + `${created.join(', ')}. Switch to one from the Agency selector above to add its `
        + `DISCOM, GSTIN and divisions.`
        + (paid && invoicePending ? ' The GST invoice follows separately.' : ''),
    });

    // ⚠ THE ACTIVE AGENCY IS NOT MOVED, DELIBERATELY.
    //
    // It used to jump to the first agency created. Creating an agency is a SETUP act; being
    // moved out of the one you are working in, as a side effect of it, is the same shape as a
    // read causing a mutation - which is what was removed from the AT list for the same reason.
    // The operator was mid-task in some agency; they did not ask to leave it.
    //
    // The note says where the new ones are, and the selector is two lines up. Switching is one
    // deliberate act rather than an undo of something that happened to them.
    setNames(['']);
    setMode('ask');
  };

  const submit = async () => {
    if (busy || problems.length) return;
    setBusy(true);
    setNote(null);
    try {
      if (isTrial) {
        const r = await startFreeTrial(filled[0]);
        finish(r.createdNames, r.createdAgencies, false, false);
      } else if (isAdmin) {
        const r = await createAgenciesAsAdmin(filled);
        finish(r.createdNames, r.createdAgencies, false, false);
      } else {
        const r = await purchaseAgencies(filled);
        if (r.alreadyProcessed) {
          setNote({ kind: 'ok', text: 'That payment had already been recorded. Nothing was charged twice.' });
        } else {
          finish(r.createdNames, r.createdAgencies, r.invoicePending, true);
        }
      }
    } catch (e: any) {
      if (e instanceof CheckoutDismissed) setNote(null);
      else if (e instanceof PaymentTakenButUnverified) {
        // ⚠ MUST NOT SAY "FAILED". Money moved, and for a batch it may be a large amount.
        setNote({ kind: 'bad', stage: 'The payment succeeded and this app could not confirm it',
          text: e.message, detail: `payment ${e.paymentId} · order ${e.orderId}` });
      } else if (e instanceof GatewayDeclined) {
        setNote({ kind: 'warn',
          stage: e.refusedBeforeAuth
            ? 'The payment gateway refused this before asking your bank'
            : 'The payment gateway declined this',
          text: e.message + ' Nothing was charged and nothing was created.', detail: e.detail });
      } else {
        setNote({ kind: 'warn', stage: 'Nothing was created',
          text: String(e?.message || 'Unknown error.') });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white p-3 rounded-lg border border-l-2 border-l-blue-500 border-blue-200 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Add agency</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Name them here. DISCOM, GSTIN, letterhead and divisions are filled in afterwards,
            one agency at a time.
          </p>
        </div>
        <button type="button" onClick={onDone} className="text-[11px] font-bold text-slate-500 hover:text-slate-800">
          Close
        </button>
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

      {mode === 'ask' && (
        <>
        {/* ⚠ A PRICE WITH NO ROUTE TO WHAT IT BUYS (AUDIT G48). These two cards were the first
            and only place a prospect saw Rs 5,900, and nothing beside them said what the app
            produces. The walkthrough is one link away and was reachable from nowhere inside the
            signed-in app. */}
        <p className="text-[11px] text-slate-600 mb-1">
          New here?{' '}
          <a href="/pricing" className="text-blue-700 underline font-semibold">
            See what you get
          </a>{' '}
          &mdash; the estimate sheets, tax invoices and inspection reports this prints.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* ⚠ THE TRIAL IS OFFERED FIRST AND ONLY TO A NON-ADMIN. A vendor creating agencies
              for themselves does not want a 72-hour clock on one, and the server would refuse
              anyway once they own an agency. */}
          {!isAdmin && (
            <button type="button" onClick={() => start(false, true)}
              className="text-left border-2 border-indigo-400 bg-indigo-50 rounded-lg p-3 hover:border-indigo-600 sm:col-span-2">
              <span className="block text-sm font-bold text-indigo-900">Try it free for 72 hours</span>
              <span className="block text-[11px] text-indigo-800 mt-0.5">
                One agency, everything working, no card. After 72 hours your work stays readable
                and printable &mdash; recording new work needs a subscription. One trial per account.
              </span>
            </button>
          )}
          <button type="button" onClick={() => start(false)}
            className="text-left border border-slate-300 rounded-lg p-3 hover:border-blue-500 hover:bg-blue-50">
            <span className="block text-sm font-bold text-slate-900">One agency</span>
            <span className="block text-[11px] text-slate-500 mt-0.5">{formatPrice()} for the year</span>
          </button>
          <button type="button" onClick={() => start(true)}
            className="text-left border border-slate-300 rounded-lg p-3 hover:border-blue-500 hover:bg-blue-50">
            <span className="block text-sm font-bold text-slate-900">Several agencies</span>
            <span className="block text-[11px] text-slate-500 mt-0.5">
              {formatPrice()} each, in one payment &mdash; up to {MAX_AGENCIES}
            </span>
          </button>
        </div>
        </>
      )}

      {mode === 'names' && (
        <div className="space-y-3">
          <div className="space-y-2">
            {names.map((n, i) => (
              <div key={i} className="flex gap-2 items-center">
                <span className="text-[11px] font-mono tabular-nums text-slate-400 w-5 shrink-0">{i + 1}</span>
                <input
                  type="text"
                  value={n}
                  autoFocus={i === 0}
                  onChange={e => setName(i, e.target.value)}
                  placeholder="Agency name"
                  className="flex-1 min-w-0 px-3 py-2 text-sm border border-slate-300 rounded bg-slate-50 focus:bg-white focus:ring-1 focus:ring-blue-500"
                />
                {names.length > 1 && (
                  <button type="button" onClick={() => removeRow(i)} title="Remove"
                    className="p-2 text-slate-400 hover:text-red-600 shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {names.length < MAX_AGENCIES && (
            <button type="button" onClick={addRow}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-700 hover:text-blue-900">
              <Plus className="w-3 h-3" /> Add another
            </button>
          )}

          {/* ⚠ PROBLEMS ARE SHOWN BEFORE CHECKOUT OPENS, not after. Refusing a duplicate name
              once money has moved is not an acceptable outcome, so the obvious cases are caught
              here - and the server re-checks inside the transaction regardless, because another
              tab could create a clashing agency between the two moments. */}
          {problems.length > 0 && filled.length > 0 && (
            <ul className="text-[11px] text-amber-900 bg-amber-50 border border-amber-300 rounded px-2.5 py-2 space-y-0.5">
              {problems.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap border-t border-slate-100 pt-3">
            <div className="text-sm">
              {isTrial ? (
                <span className="font-bold text-indigo-800">
                  Free for 72 hours &mdash; no card, no charge
                </span>
              ) : isAdmin ? (
                <span className="font-bold text-violet-800">
                  {filled.length} to create &mdash; no payment (vendor account)
                </span>
              ) : (
                <>
                  <span className="font-black text-slate-900">{formatPrice(priceFor(filled.length))}</span>
                  <span className="text-[11px] text-slate-500">
                    {' '}for {filled.length} {filled.length === 1 ? 'agency' : 'agencies'}, inclusive of GST
                  </span>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setMode('ask'); setNames(['']); setIsTrial(false); }}
                className="text-xs font-bold text-slate-600 px-3 py-2">Back</button>
              <button
                type="button"
                onClick={submit}
                disabled={busy || problems.length > 0 || filled.length === 0}
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-300 text-white font-bold text-xs px-4 py-2.5 rounded-lg"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                {busy ? 'Working…'
                  : isTrial ? 'Start the free trial'
                  : isAdmin ? 'Create'
                  : `Pay ${formatPrice(priceFor(filled.length))}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
