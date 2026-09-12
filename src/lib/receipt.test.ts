// Tests for lib/receipt.ts (AUDIT G71). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReceipt, receiptHtml, canIssueReceipt } from './receipt';
import { classifySubscription, type SubscriptionRecord } from './subscriptionStatus';
import { SELLER } from './seller';

const NOW = Date.UTC(2026, 8, 12);
const YEAR = 365 * 24 * 60 * 60 * 1000;

const gateway: SubscriptionRecord = {
  status: 'active',
  planAmount: 5900,
  currency: 'INR',
  startDate: NOW - YEAR,
  expiryDate: NOW + YEAR,
  lastPaymentDate: NOW - 2 * 24 * 60 * 60 * 1000,
  razorpayPaymentId: 'pay_TESTID123',
  invoicePending: true,
  ownerEmail: 'owner@example.com',
} as SubscriptionRecord;

const manual: SubscriptionRecord = {
  status: 'active',
  planAmount: 5900,
  currency: 'INR',
  startDate: NOW,
  expiryDate: NOW + YEAR,
  lastPaymentDate: NOW,
  manualPayment: true,
  paymentReference: 'cheque 004417, Bank of Baroda',
  recordedBy: 'vendor@example.com',
  invoicePending: true,
} as SubscriptionRecord;

const html = (sub: SubscriptionRecord, agencyName = 'ZENITH TRANSFORMERS') =>
  receiptHtml(buildReceipt({ agencyName, sub }));

// ---------------------------------------------------------------- which rows have a payment to receipt

test('a gateway payment, a cheque, and a lapsed or cancelled year that was paid all get a receipt', () => {
  const cases: Array<[string, SubscriptionRecord]> = [
    ['gateway', gateway],
    ['manual', manual],
    ['expired but paid', { ...gateway, expiryDate: NOW - 1 }],
    ['cancelled but paid', { ...gateway, cancelledAt: NOW - 1 }],
  ];
  for (const [name, sub] of cases) {
    assert.equal(canIssueReceipt(classifySubscription(sub, NOW), sub), true, name);
  }
});

test('a subscription with no payment behind it gets none', () => {
  const cases: Array<[string, SubscriptionRecord | null]> = [
    ['granted', { status: 'granted', expiryDate: NOW + YEAR, planAmount: 5900, lastPaymentDate: NOW } as SubscriptionRecord],
    ['admin', { status: 'admin', expiryDate: null } as SubscriptionRecord],
    ['trial', { status: 'trial', expiryDate: NOW + YEAR } as SubscriptionRecord],
    ['trial ended', { status: 'trial', expiryDate: NOW - 1 } as SubscriptionRecord],
    ['no document at all', null],
  ];
  for (const [name, sub] of cases) {
    assert.equal(canIssueReceipt(classifySubscription(sub, NOW), sub), false, name);
  }
});

test('a paid status with no amount or no date cannot be receipted', () => {
  assert.equal(canIssueReceipt(classifySubscription({ ...gateway, planAmount: 0 }, NOW), { ...gateway, planAmount: 0 }), false);
  const noDate = { ...gateway, lastPaymentDate: undefined } as SubscriptionRecord;
  assert.equal(canIssueReceipt(classifySubscription(noDate, NOW), noDate), false);
});

// ---------------------------------------------------------------- ⚠ the proximity test

test('the receipt carries no GSTIN, no tax split, no invoice number and no SAC code', () => {
  for (const sub of [gateway, manual, { ...gateway, invoicePending: false }]) {
    const out = html(sub);
    assert.ok(!out.includes(SELLER.gstin), 'GSTIN must never appear');
    assert.doesNotMatch(out, /GST at \d+(\.\d+)?\s*%/, 'no tax rate line');
    assert.doesNotMatch(out, /\b(taxable|CGST|SGST|IGST|SAC)\b/i, 'no tax breakdown or SAC code');
    assert.doesNotMatch(out, /invoice\s*(no\.?|number|#)/i, 'no invoice number');
    assert.ok(!out.includes('Tax Invoice'), 'never titled as a tax invoice');
    assert.match(out, /not a tax invoice/, 'it must say what it is not');
  }
});

// ---------------------------------------------------------------- the GST invoice line

test('while the invoice is pending the receipt promises one, with no timing', () => {
  const out = html(gateway);
  assert.match(out, /will be sent separately/);
  assert.doesNotMatch(out, /\b(shortly|soon|immediately|within|working days|next \d+|\d+ days)\b/i);
});

test('once the invoice exists the receipt stops promising it', () => {
  const out = html({ ...gateway, invoicePending: false });
  assert.match(out, /A GST invoice has been issued for this payment\./);
  assert.doesNotMatch(out, /will be sent separately/);
});

// ---------------------------------------------------------------- what each kind of payment shows

test('a gateway receipt names the payment id', () => {
  const out = html(gateway);
  assert.match(out, /Payment ID/);
  assert.match(out, /pay_TESTID123/);
  assert.doesNotMatch(out, /Recorded by/);
});

test('a manual receipt names the reference and who recorded it, and has no payment-id row', () => {
  const out = html(manual);
  assert.match(out, /Received by/);
  assert.match(out, /cheque 004417/);
  assert.match(out, /Recorded by/);
  assert.match(out, /did not go through the payment gateway/);
  assert.doesNotMatch(out, /Payment ID/, 'an empty or borrowed payment id is how a manual payment comes to look verified');
});

// ---------------------------------------------------------------- the period, and what is not claimed

test('the subscription line says what it runs to and claims no period for the payment', () => {
  const out = html(gateway);
  assert.match(out, /Runs to 12-09-2027/);
  // startDate is a year before this payment on a renewal; printing it would assert a period nobody paid for.
  assert.doesNotMatch(out, /12-09-2025/);
  assert.doesNotMatch(out, /\bperiod\b/i);
});

// ---------------------------------------------------------------- the rest

test('the seller is the proprietor, with the trade name as a trading style', () => {
  const out = html(gateway);
  assert.match(out, /MEGHA HASMUKHBHAI PANCHAL/);
  assert.match(out, /trading as MSD CORPORATION/);
  assert.doesNotMatch(out, /\[registered address\]|\[phone\]/, 'a placeholder must never be printed');
});

test('the amount is shown in rupees to the paisa, and a foreign currency by its code', () => {
  assert.match(html(gateway), /₹5,900\.00/);
  assert.match(html({ ...gateway, currency: 'USD', planAmount: 70 }), /USD 70\.00/);
});

test('an agency name is escaped, never injected', () => {
  const out = html(gateway, 'A & B <script>alert(1)</script>');
  assert.ok(!out.includes('<script>alert(1)</script>'));
  assert.match(out, /A &amp; B &lt;script&gt;/);
});

test('the window title names the agency and the date, so "Save as PDF" suggests a filename', () => {
  assert.equal(buildReceipt({ agencyName: 'MEGHA', sub: gateway }).documentName, 'Receipt - MEGHA - 10-09-2026');
});
