import { getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { app } from './firebase';
import { createOrder, payWithRazorpay } from './subscriptionClient';
import { SUBSCRIPTION_INCLUSIVE_INR } from './pricing';

/**
 * BUYING AGENCIES — names first, one payment, created by the server (AUDIT G38).
 *
 * ⚠ THERE IS NO SLOT. The names go on the order before the customer pays, and
 * `verifySubscriptionPayment` creates every one of them inside the transaction that records the
 * payment. That removes the interval a credit used to live in - the stretch between paying and
 * receiving, where a balance could be held, leaked, double-counted or stranded.
 *
 * ⚠ ALL OR NONE. The idempotency key is written in the same transaction, so a failure part-way
 * rolls back the payment record too: nothing is created, the payment is not marked processed,
 * and a retry re-runs it cleanly. There is no state where money is recorded against agencies
 * that do not exist.
 *
 * ⚠ THE CLIENT NEVER SENDS AN AMOUNT OR A COUNT IT COULD INFLATE. It sends names; the server
 * validates them, multiplies by its own constant, and tells Razorpay. The figure shown here is
 * a label - if it ever disagreed with the server's, the customer is charged the server's.
 */

const REGION = 'us-central1';

let fns: Functions | null = null;
const functionsClient = () => (fns ??= getFunctions(app, REGION));

/** Mirrors MAX_AGENCIES_PER_ORDER in functions/agencyNames.js. */
export const MAX_AGENCIES = 10;

/** What N agencies cost, for display only. The server computes what is charged. */
export function priceFor(count: number): number {
  return SUBSCRIPTION_INCLUSIVE_INR * Math.max(0, count);
}

export type PurchaseResult = {
  createdNames: string[];
  createdAgencyIds: string[];
  alreadyProcessed: boolean;
  invoicePending: boolean;
};

/**
 * LOCAL NAME CHECKS, MIRRORING THE SERVER'S.
 *
 * ⚠ THE SERVER'S CHECK IS THE GUARANTEE; THIS ONE IS THE COURTESY. Refusing a duplicate name
 * after money has moved is not acceptable, so the obvious problems are caught before checkout
 * opens. The server re-checks inside the transaction anyway, because another tab could create a
 * clashing agency between the two moments.
 */
export function localNameProblems(names: string[], existing: string[]): string[] {
  const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const problems: string[] = [];
  const filled = names.map(n => n.trim());

  if (filled.length === 0) problems.push('Add at least one agency name.');
  if (filled.length > MAX_AGENCIES) {
    problems.push(`One payment can cover at most ${MAX_AGENCIES} agencies.`);
  }
  filled.forEach((n, i) => { if (!n) problems.push(`Agency ${i + 1} has no name.`); });

  const seen = new Set<string>();
  for (const n of filled) {
    if (!n) continue;
    if (seen.has(key(n))) problems.push(`"${n}" is listed twice.`);
    seen.add(key(n));
  }
  const taken = new Set(existing.map(key));
  for (const n of filled) {
    if (n && taken.has(key(n))) problems.push(`You already have an agency called "${n}".`);
  }
  return problems;
}

/** Buy and create. Resolves only once the server has verified and written them. */
export async function purchaseAgencies(names: string[]): Promise<PurchaseResult> {
  const clean = names.map(n => n.trim()).filter(Boolean);
  const order = await createOrder('new_agencies' as any, undefined, clean);
  const paid = await payWithRazorpay(order, {
    name: clean[0] || '',
    email: '',
    contact: '',
  });
  return {
    createdNames: paid.createdNames || clean,
    createdAgencyIds: paid.createdAgencyIds || [],
    alreadyProcessed: paid.alreadyProcessed,
    invoicePending: paid.invoicePending,
  };
}

/**
 * THE VENDOR'S PATH: create without paying.
 *
 * ⚠ NO FLAG IS SENT SAYING "I AM THE ADMIN". The function reads the verified auth token and
 * refuses anyone else. A boolean the browser sets and the server trusts is not an exemption, it
 * is a request to be exempted - and it is the shape every admin-mode vulnerability takes.
 */
export async function createAgenciesAsAdmin(names: string[]): Promise<PurchaseResult> {
  const clean = names.map(n => n.trim()).filter(Boolean);
  const call = httpsCallable(functionsClient(), 'createAgency');
  const res: any = await call({ agencyNames: clean });
  const d = res?.data || {};
  return {
    createdNames: d.createdNames || clean,
    createdAgencyIds: d.createdAgencyIds || [],
    alreadyProcessed: false,
    invoicePending: false,
  };
}
