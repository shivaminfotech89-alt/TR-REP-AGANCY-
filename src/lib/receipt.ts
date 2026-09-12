/**
 * A RECEIPT FOR MONEY RECEIVED - AND DELIBERATELY NOT A TAX INVOICE (AUDIT G71).
 *
 * ⚠ WHAT MUST NEVER APPEAR ON IT, AND WHY THAT IS A REAL RISK HERE: the GSTIN, an invoice number, a SAC code, or a
 * tax breakdown. `SELLER.gstin` sits in the same object this file reads its seller name from, and `gstBreakdown()` is
 * already imported into the screen that will call this - both are one line away from the code being written. So the
 * absence is asserted in `receipt.test.ts` rather than left to care.
 *
 * A GST invoice cannot be issued yet: its numbering must be gap-free within a financial year and the SAC code is not
 * settled, so a number allocated now would put a permanent hole in the sequence (AUDIT G30). Every paid subscription
 * therefore carries `invoicePending: true`, and this document says so - WITHOUT A TIMELINE, because none can be
 * promised until that decision is made. When the flag is false the same line says the invoice HAS been issued, so a
 * receipt cannot go on promising what has already been delivered.
 *
 * ⚠ WHY IT SAYS "RUNS TO" AND NOT A PERIOD. The period a single payment bought is NOT in the database: `startDate` is
 * the original start, preserved across renewals, and the previous expiry is overwritten by the new one. Printing
 * `startDate → expiryDate` would span several years on any renewal. If a per-payment period is ever wanted, the shape
 * is `periodStart` / `periodEnd` written by the payment functions at the moment of payment - which would not be
 * retrospective, and so was declined for now (AUDIT G71).
 */

import { SELLER, isPlaceholder } from './seller';
import { formatDDMMYYYY } from './utils';
import type { SubscriptionRecord, SubscriptionClass } from './subscriptionStatus';

export interface ReceiptInput {
  agencyName: string;
  sub: SubscriptionRecord;
}

/**
 * WHETHER THIS ROW HAS A PAYMENT TO RECEIPT.
 *
 * `wasPaid` covers a gateway payment AND a cheque, and it stays true after the year lapses - a receipt for money
 * already received must not vanish when the subscription expires or is cancelled. The amount and date are required
 * too: a receipt that cannot state what was received and when is not a receipt.
 *
 * ⚠ A FAILED READ IS NOT AN ANSWER. The caller must not ask this while the subscription read failed - absence of a
 * record is not absence of a payment (AUDIT G34, G70).
 */
export function canIssueReceipt(cls: SubscriptionClass, sub: SubscriptionRecord | null | undefined): boolean {
  if (!sub || !cls.wasPaid) return false;
  return Number(sub.lastPaymentDate || 0) > 0 && Number(sub.planAmount || 0) > 0;
}

export interface ReceiptLine { label: string; value: string }

export interface Receipt {
  /** Browser tab and the suggested filename when the operator chooses "Save as PDF". */
  documentName: string;
  sellerLegalName: string;
  sellerTradeName: string;
  sellerConstitution: string;
  /** Email and site. An address or phone still holding a placeholder is omitted, never printed. */
  contactLines: string[];
  agencyName: string;
  rows: ReceiptLine[];
  /** True when the money came by cheque, transfer or cash rather than the gateway. */
  manual: boolean;
  manualNote: string | null;
  notTaxInvoice: string;
  invoiceLine: string;
}

function formatAmount(amount: number, currency: string | undefined): string {
  const n = Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const code = String(currency || 'INR').toUpperCase();
  return code === 'INR' ? `₹${n}` : `${code} ${n}`;
}

export function buildReceipt({ agencyName, sub }: ReceiptInput): Receipt {
  const manual = !!sub.manualPayment;
  const rows: ReceiptLine[] = [
    { label: 'Received from', value: agencyName },
  ];
  if (sub.ownerEmail) rows.push({ label: 'Account', value: String(sub.ownerEmail) });
  rows.push({ label: 'Amount received', value: formatAmount(Number(sub.planAmount || 0), sub.currency) });
  rows.push({ label: 'Date received', value: formatDDMMYYYY(Number(sub.lastPaymentDate || 0)) });

  if (manual) {
    // ⚠ NO PAYMENT-ID ROW AT ALL - not an empty one, and never the reference placed in it. The ABSENCE of a gateway
    // id is what marks a manual payment as unverified, and filling that field is exactly how one comes to look
    // verified (functions/adminSubscription.js).
    if (sub.paymentReference) rows.push({ label: 'Received by', value: String(sub.paymentReference) });
    if (sub.recordedBy) rows.push({ label: 'Recorded by', value: String(sub.recordedBy) });
  } else {
    if (sub.razorpayPaymentId) rows.push({ label: 'Payment ID', value: String(sub.razorpayPaymentId) });
    if (sub.razorpayOrderId) rows.push({ label: 'Order ID', value: String(sub.razorpayOrderId) });
  }

  if (Number(sub.expiryDate || 0) > 0) {
    rows.push({ label: 'Subscription', value: `Runs to ${formatDDMMYYYY(Number(sub.expiryDate))}` });
  }

  const contactLines = [SELLER.email, SELLER.site].filter(Boolean) as string[];
  for (const v of [SELLER.address, SELLER.phone]) {
    if (v && !isPlaceholder(v)) contactLines.push(v);
  }

  return {
    documentName: `Receipt - ${agencyName} - ${formatDDMMYYYY(Number(sub.lastPaymentDate || 0))}`,
    sellerLegalName: SELLER.legalName,
    sellerTradeName: SELLER.tradeName,
    sellerConstitution: SELLER.constitution,
    contactLines,
    agencyName,
    rows,
    manual,
    manualNote: manual
      ? 'Recorded by the vendor against the reference above. This payment did not go through the payment gateway.'
      : null,
    notTaxInvoice: 'This is a receipt for money received. It is not a tax invoice.',
    invoiceLine: sub.invoicePending === false
      ? 'A GST invoice has been issued for this payment.'
      : 'A GST invoice for this payment has not been issued yet. It will be sent separately.',
  };
}

const escapeHtml = (s: string): string =>
  String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));

/**
 * THE WHOLE DOCUMENT, SELF-CONTAINED.
 *
 * ⚠ NOT `PrintableA4Page`. That composes a sheet on THE CUSTOMER AGENCY'S LETTERHEAD, with header and footer
 * reservations and cut-off measurement, for A4-fitted work that can lose its signature block. This receipt is issued
 * BY the vendor TO the customer: printing it on the customer's own letterhead would be wrong, and eight lines cannot
 * overflow a body. It carries its own styles and borrows none of the app's.
 */
export function receiptHtml(r: Receipt): string {
  const rows = r.rows.map(row => `
          <tr>
            <th>${escapeHtml(row.label)}</th>
            <td>${escapeHtml(row.value)}</td>
          </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(r.documentName)}</title>
    <style>
      @page { size: A4 portrait; margin: 18mm; }
      html, body { margin: 0; padding: 0; background: #fff; color: #111;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
      .sheet { max-width: 150mm; margin: 0 auto; padding: 12mm 0; }
      .issuer { font-size: 15px; font-weight: 700; }
      .trade { font-size: 12px; color: #444; margin-top: 2px; }
      .contact { font-size: 11px; color: #555; margin-top: 6px; }
      h1 { font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: #333;
        margin: 14mm 0 4mm; padding-bottom: 3mm; border-bottom: 1px solid #bbb; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { text-align: left; font-weight: 600; color: #555; width: 42%; padding: 3mm 0; vertical-align: top; }
      td { padding: 3mm 0; font-weight: 600; color: #111; vertical-align: top; word-break: break-word; }
      tr + tr th, tr + tr td { border-top: 1px solid #eee; }
      .note { font-size: 11px; color: #555; margin-top: 4mm; line-height: 1.5; }
      .statement { margin-top: 10mm; padding-top: 4mm; border-top: 1px solid #bbb; font-size: 12px; line-height: 1.6; }
      .statement strong { display: block; color: #111; }
      @media print { .noprint { display: none !important; } }
    </style>
  </head>
  <body>
    <div class="sheet">
      <div class="issuer">${escapeHtml(r.sellerLegalName)}</div>
      <div class="trade">trading as ${escapeHtml(r.sellerTradeName)} &middot; ${escapeHtml(r.sellerConstitution)}</div>
      <div class="contact">${r.contactLines.map(escapeHtml).join(' &middot; ')}</div>

      <h1>Payment receipt</h1>
      <table><tbody>${rows}
      </tbody></table>
      ${r.manualNote ? `<p class="note">${escapeHtml(r.manualNote)}</p>` : ''}

      <div class="statement">
        <strong>${escapeHtml(r.notTaxInvoice)}</strong>
        ${escapeHtml(r.invoiceLine)}
      </div>
    </div>
  </body>
</html>`;
}

/**
 * Open the receipt in its own window and offer the print dialog, where "Save as PDF" writes the file. The same route
 * every other document in this app takes to paper; the window's title is the suggested filename.
 */
export function printReceipt(input: ReceiptInput): void {
  const html = receiptHtml(buildReceipt(input));
  let win: Window | null = null;
  try {
    win = window.open('', '_blank', 'width=760,height=900,menubar=no,toolbar=no,location=no,status=no');
  } catch (err) {
    console.warn('Popup window blocked or restricted:', err);
  }
  if (!win) {
    alert('Your browser blocked the receipt window. Please allow pop-ups for this site, then try again.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  // Nothing to measure - see receiptHtml. The dialog opens once the window has painted.
  setTimeout(() => { win?.focus(); win?.print(); }, 250);
}
