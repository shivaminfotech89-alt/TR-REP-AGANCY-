import React from 'react';
import { LegalLayout, Section, SellerBlock } from './LegalLayout';
import { SELLER, isPlaceholder } from '../../lib/seller';
import { SUBSCRIPTION_INCLUSIVE_INR, gstBreakdown, formatPrice } from '../../lib/pricing';
import { Walkthrough, SHOTS } from './Walkthrough';

/**
 * THE PUBLIC POLICY PAGES (AUDIT G41).
 *
 * ⚠ DRAFTS. A professional must check the wording, and the Refunds page most of all - it is a
 * commitment that will be held to, and it is the one a payment processor reads hardest.
 *
 * ⚠ THE PRICE COMES FROM lib/pricing.ts, NOT FROM PROSE HERE. A price typed into a policy page
 * is a tenth literal of a figure that was already wrong in nine places (G27), and the one place
 * it must never drift is the page a customer is shown before they pay.
 */

const UPDATED = '10 September 2026';

/* ------------------------------------------------------------------------------------- */
/* PRICING                                                                                */
/* ------------------------------------------------------------------------------------- */

export function PricingPage() {
  const { taxable, tax, ratePercent } = gstBreakdown();

  /**
   * WHICH SCREENSHOTS EXIST.
   *
   * ⚠ PROBED RATHER THAN ASSUMED, AND THE CONTENT TYPE IS THE TEST - NOT THE STATUS CODE.
   *
   * The SPA rewrite (G36) sends every unmatched path to index.html, so a MISSING screenshot does
   * not 404: it returns 200 with `text/html`. `r.ok` alone would therefore report every absent
   * file as present, and each slot would render an <img> pointing at an HTML document - a broken
   * image icon on a sales page, which looks like a broken product.
   *
   * That is the rewrite behaving exactly as designed and breaking a naive existence check, which
   * is worth knowing anywhere else in this codebase that asks "is this file there".
   *
   * A slot with no file shows a named placeholder saying which file it wants, so a half-supplied
   * page says so rather than looking finished.
   */
  const [availableShots, setAvailableShots] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    let live = true;
    Promise.all(SHOTS.map(s =>
      fetch(`/walkthrough/${s.file}`, { method: 'HEAD' })
        .then(r => (r.ok && (r.headers.get('content-type') || '').startsWith('image') ? s.file : null))
        .catch(() => null),
    )).then(found => {
      if (live) setAvailableShots(new Set(found.filter(Boolean) as string[]));
    });
    return () => { live = false; };
  }, []);
  return (
    <LegalLayout title="Pricing" updated={UPDATED}>
      <p>
        {SELLER.product} is a subscription service for transformer repair agencies. One
        subscription covers one agency for one year.
      </p>

      {/* ⚠ THE DOCUMENTS COME BEFORE THE PRICE, DELIBERATELY (AUDIT G48). A prospect reaching
          this page has been asked for Rs 5,900 and has seen nothing the software makes. Leading
          with the figure asks them to judge a number against nothing; leading with the printed
          bill lets them recognise their own division's paperwork first and read the price after.
          The price is two screens down and has not moved anywhere else. */}
      <Walkthrough available={availableShots} />

      <div className="border border-slate-300 rounded-lg p-4 bg-slate-50">
        <p className="text-2xl font-black text-slate-900">{formatPrice()}</p>
        <p className="text-xs text-slate-600 mt-0.5">per agency, per year, inclusive of GST</p>
        <div className="mt-3 pt-3 border-t border-slate-200 text-xs space-y-0.5">
          <div className="flex justify-between"><span>Taxable value</span><span className="font-mono">{formatPrice(taxable)}</span></div>
          <div className="flex justify-between"><span>GST at {ratePercent}%</span><span className="font-mono">{formatPrice(tax)}</span></div>
          <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-200">
            <span>Total payable</span><span className="font-mono">{formatPrice()}</span>
          </div>
        </div>
      </div>

      <Section n={1} heading="What one subscription covers">
        <p>
          One agency workspace for twelve months: job intake, external and internal inspection
          records, tender-rate estimates, billing, oil accounting and printed documents. There is
          no per-user charge and no limit on the number of jobs.
        </p>
      </Section>

      <Section n={2} heading="Several agencies">
        <p>
          Agencies are bought by name. Buying more than one at a time is a single payment of{' '}
          {formatPrice()} multiplied by the number of agencies &mdash; three agencies is{' '}
          {formatPrice(SUBSCRIPTION_INCLUSIVE_INR * 3)}. Up to ten may be bought in one payment.
        </p>
      </Section>

      <Section n={3} heading="Renewal">
        <p>
          Subscriptions do not renew automatically. A subscription runs to its expiry date and
          then lapses. Renewing before that date adds twelve months to the existing expiry rather
          than restarting from the day of payment, so no paid-up days are lost by renewing early.
        </p>
      </Section>

      <Section n={4} heading="Taxes">
        <p>
          The price shown is inclusive of GST at {ratePercent}%. A tax invoice is issued for every
          payment. Both parties being in {SELLER.state}, GST is charged as CGST and SGST; for a
          customer registered outside {SELLER.state} it is charged as IGST at the same total rate.
        </p>
      </Section>
    </LegalLayout>
  );
}

/* ------------------------------------------------------------------------------------- */
/* TERMS — moved from the modal, with the subscription added and two false claims removed */
/* ------------------------------------------------------------------------------------- */

export function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" updated={UPDATED}>
      <p>
        These terms govern your use of {SELLER.product}, operated by {SELLER.legalName}, a sole
        proprietor trading as {SELLER.tradeName}. By accessing the software you agree to them.
      </p>

      <Section n={1} heading="Who may use the service">
        <p>
          Access is granted to registered electrical repair agencies, transformer overhaul
          workshops, certified electrical testing laboratories and authorised utility (DISCOM)
          personnel. You are responsible for keeping your login credentials secure and for
          everything done through your account.
        </p>
      </Section>

      <Section n={2} heading="Subscription, renewal and lapse">
        {/* ⚠ THIS SECTION DID NOT EXIST. The Terms described a free product: no price, no
            payment, no renewal, no consequence of non-payment. Section 6 was the only place a
            subscription could have been mentioned and it discussed availability instead. */}
        <p>
          The service is sold as an annual subscription per agency. The current price is on the{' '}
          <a href="/pricing" className="text-blue-700 underline">Pricing</a> page. Payment is due
          in advance and the subscription runs for twelve months from the date of payment, or
          from the existing expiry date where one is renewed before it lapses.
        </p>
        {/* ⚠ THIS CLAUSE CLAIMED SOMETHING NOTHING ENFORCES (AUDIT G48). It read "When a
            subscription lapses, access to that agency's workspace may be suspended." No screen
            in this application reads a subscription - not NewJob, EstimateGenerate,
            BillingSystem, MrLedger, DispatchChallan, AppLayout or Dashboard - so an expired
            subscription changes nothing and the app works identically.

            That is the stale-truth shape from G32-G36, in a document a payment processor
            reviewed, and written by the same hand that recorded the pattern.

            ⚠ IT IS REWORDED RATHER THAN ENFORCED, DELIBERATELY. A clause describing unbuilt
            behaviour is the worst of both: it does not warn a customer accurately, because "may
            be suspended" describes something that cannot happen, and it does not bind the vendor
            usefully, because a right reserved and never exercised is not a right anybody relied
            on. Saying what the product does today is honest now and can be updated under the
            thirty-day notice clause above if suspension is ever built.

            ⚠ AND IT DOES NOT RESERVE A RIGHT TO SUSPEND "IN FUTURE", which was the tempting
            middle. That would be the same defect with a tense change - another sentence about
            behaviour that does not exist. */}
        <p>
          Subscriptions do not renew automatically. When a subscription lapses it is simply no
          longer current, and you will be asked to renew it. Your work stays where it is: nothing
          is deleted, and everything remains readable, printable and exportable &mdash; see
          clause 5.
        </p>
        <p>
          We may change the price with at least thirty days&rsquo; notice by email. A change does
          not affect a subscription already paid for.
        </p>
      </Section>

      <Section n={3} heading="Technical data and electrical standards">
        <p>
          The software performs calculations for excitation current, no-load and full-load loss,
          percentage impedance, oil BDV and tender repair rates. All entered test values must be
          true, calibrated measurements taken in compliance with IS 1180 (Part 1): 2014, IS 2026
          and the relevant DISCOM specifications. We accept no liability for incorrect,
          miscalibrated or fraudulent entries, nor for figures derived from them.
        </p>
      </Section>

      <Section n={4} heading="Rates, estimates and tax computation">
        <p>
          Estimates are computed from the tender rate schedules entered or selected by you. You
          remain responsible for verifying every figure, including GST computation, before
          submitting an invoice to a utility. The software assists a calculation; it does not
          certify one.
        </p>
      </Section>

      <Section n={5} heading="Your data">
        <p>
          Every job card, inspection record, challan and invoice you enter remains yours. It is
          stored in Google Cloud Firestore with per-agency access controls. You can export your
          records to XLSX and PDF at any time from the relevant screens, including after a
          subscription has lapsed.
        </p>
      </Section>

      <Section n={6} heading="Availability and support">
        {/* ⚠ "24*7 support monitoring" WAS HERE AND WAS NOT TRUE. There is one person answering
            a ticket form, and the support panel is unbuilt by decision. A service-level claim a
            product does not meet is a defect anywhere; in a document a payment processor reads
            before approving a merchant, it is a claim that invites the review to fail. What
            replaced it describes the mechanism rather than promising a clock. */}
        <p>
          The service is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis.
          It runs on Google Cloud infrastructure, but we do not guarantee uninterrupted
          availability and do not offer a service-level guarantee.
        </p>
        <p>
          Support is provided by email and through the in-app support form, by the proprietor
          directly, during Indian business hours on working days. It is not a 24-hour service.
        </p>
      </Section>

      <Section n={7} heading="Termination">
        <p>
          You may stop using the service at any time; see the{' '}
          <a href="/refunds" className="text-blue-700 underline">Refunds and Cancellation</a>{' '}
          policy for what happens to a subscription you have paid for. We may suspend an account
          that is used unlawfully, or in a way that endangers other customers&rsquo; data.
        </p>
      </Section>

      <Section n={8} heading="Governing law">
        <p>
          These terms are governed by the laws of India. Courts at {SELLER.state} have exclusive
          jurisdiction.
        </p>
      </Section>
    </LegalLayout>
  );
}

/* ------------------------------------------------------------------------------------- */
/* PRIVACY — moved from the modal                                                          */
/* ------------------------------------------------------------------------------------- */

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" updated={UPDATED}>
      <p>
        This policy explains what {SELLER.product} collects, why, and what is done with it. The
        data controller is {SELLER.legalName}, trading as {SELLER.tradeName}.
      </p>

      <Section n={1} heading="What we collect">
        <p>
          <strong>Account data:</strong> the email address and display name from your Google
          sign-in, used to identify you and to record who made a change.
        </p>
        <p>
          <strong>Operational data you enter:</strong> material receipts, transformer serial
          numbers, capacities and makes, inspection notes, test readings, oil records, rate
          schedules, agency details including GSTIN, and the documents generated from them.
        </p>
        <p>
          <strong>Payment data:</strong> payments are processed by Razorpay. We receive and store
          a payment identifier, an order identifier, the amount and the date. We do not receive
          or store card numbers, UPI credentials or bank details at any point.
        </p>
      </Section>

      <Section n={2} heading="How it is used">
        <p>
          Solely to provide the service: tracking repair workflow, producing printed reports and
          challans, computing oil accounts and estimates, issuing tax invoices, and answering
          support requests. We do not sell, rent or share your business records, and we do not use
          them for advertising.
        </p>
      </Section>

      <Section n={3} heading="Where it is stored">
        <p>
          Google Cloud Firestore. Traffic between your browser and the service is encrypted with
          HTTPS. Access is restricted by security rules so that an agency&rsquo;s records are
          reachable only by its owner and by anyone that owner has explicitly granted access to.
        </p>
      </Section>

      <Section n={4} heading="Who else can see it">
        <p>
          Google (hosting and authentication) and Razorpay (payments) process data on our behalf.
          Nobody else. The proprietor can see account-level records in order to answer support
          requests and to administer subscriptions.
        </p>
      </Section>

      <Section n={5} heading="Retention, export and deletion">
        <p>
          Records are kept while your account exists, including after a subscription lapses, so
          that a later renewal does not lose your history. You can export everything to XLSX and
          PDF at any time. To have your data deleted, write to {SELLER.email}; we will delete it
          within thirty days except where tax law requires an invoice record to be kept.
        </p>
      </Section>

      <Section n={6} heading="Contact">
        <p>
          Questions about this policy go to {SELLER.email}, or see the{' '}
          <a href="/contact" className="text-blue-700 underline">Contact</a> page.
        </p>
      </Section>
    </LegalLayout>
  );
}

/* ------------------------------------------------------------------------------------- */
/* REFUNDS                                                                                 */
/* ------------------------------------------------------------------------------------- */

export function RefundsPage() {
  return (
    <LegalLayout title="Refunds and Cancellation Policy" updated={UPDATED}>
      {/* ⚠ THE PAGE A PROFESSIONAL MUST READ FIRST. Everything here is a commitment that will be
          held to, and the windows and the timeline below are drafted rather than decided. */}
      <p className="text-xs font-bold text-amber-900 bg-amber-50 border border-amber-300 rounded px-3 py-2">
        Draft. The refund window and the processing timeline below are proposals and must be
        confirmed before this page is published.
      </p>

      <Section n={1} heading="Cancelling a subscription">
        <p>
          You may cancel at any time by writing to {SELLER.email} from the email address the
          account is registered to, or through the support form in the application. Cancellation
          stops any future renewal. Because subscriptions do not renew automatically, a
          subscription you simply do not renew will lapse on its expiry date with nothing further
          to do.
        </p>
      </Section>

      <Section n={2} heading="Refunds">
        <p>
          A subscription may be refunded in full if it is cancelled within{' '}
          <strong>[7] days</strong> of payment and the agency it was bought for has not been used
          to create jobs, estimates or bills.
        </p>
        <p>
          After that period, or where the agency has been used, a subscription is not refundable.
          The service is delivered in full at the moment of payment and the remaining term stays
          available for the whole period paid for.
        </p>
        <p>
          Where several agencies were bought in one payment, a refund may be claimed for any of
          them that meet the conditions above; the rest of the payment is unaffected.
        </p>
      </Section>

      <Section n={3} heading="How a refund is paid">
        <p>
          Approved refunds are returned to the original payment method through Razorpay within{' '}
          <strong>[7&ndash;10] working days</strong> of approval. The time the amount takes to
          appear on a statement afterwards is set by your bank or card issuer.
        </p>
      </Section>

      <Section n={4} heading="Duplicate and failed payments">
        <p>
          A payment taken twice for the same subscription is refunded in full on request, without
          reference to the period above. If money has left your account and the subscription has
          not been activated, write to {SELLER.email} quoting the payment reference shown on
          screen &mdash; the payment will be either applied or refunded.
        </p>
      </Section>

      <Section n={5} heading="Cancellation by us">
        <p>
          If we cancel a subscription that is not in breach of the Terms, the unused portion is
          refunded on a pro-rata basis.
        </p>
      </Section>
    </LegalLayout>
  );
}

/* ------------------------------------------------------------------------------------- */
/* DELIVERY                                                                                */
/* ------------------------------------------------------------------------------------- */

export function ShippingPage() {
  return (
    <LegalLayout title="Delivery Policy" updated={UPDATED}>
      {/* ⚠ ONE PARAGRAPH, AND ITS ABSENCE IS WHAT GETS REJECTED. Reviewers look for this page
          even where shipping is obviously inapplicable, so the useful thing is to say plainly
          that there is nothing to ship rather than to omit the page as self-evident. */}
      <Section n={1} heading="This is a digital service">
        <p>
          {SELLER.product} is software delivered over the internet. Nothing is shipped, and there
          is no physical product, packaging or courier involved at any stage.
        </p>
      </Section>

      <Section n={2} heading="When access begins">
        <p>
          Immediately. Once a payment is confirmed by Razorpay, the agencies paid for are created
          and available in your account within seconds, in the same session. No waiting period,
          no manual activation step, and no dispatch.
        </p>
      </Section>

      <Section n={3} heading="If access does not appear">
        <p>
          If a payment succeeds and the agencies do not appear, the application shows the payment
          reference on screen. Send that reference to {SELLER.email} and the payment will be
          applied or refunded. Nothing is lost by a failure at this step.
        </p>
      </Section>

      <Section n={4} heading="Service area">
        <p>
          The service is sold to businesses in India and is delivered wherever there is internet
          access.
        </p>
      </Section>
    </LegalLayout>
  );
}

/* ------------------------------------------------------------------------------------- */
/* CONTACT                                                                                 */
/* ------------------------------------------------------------------------------------- */

export function ContactPage() {
  const incomplete = isPlaceholder(SELLER.address) || isPlaceholder(SELLER.phone);
  return (
    <LegalLayout title="Contact Us" updated={UPDATED}>
      {incomplete && (
        // ⚠ SAYS SO ON THE PAGE. A contact page missing its address is the single most reliable
        // way to fail a merchant review, and a page that looks finished while missing one is
        // worse than one that admits it.
        <p className="text-xs font-bold text-red-900 bg-red-50 border border-red-300 rounded px-3 py-2">
          This page is incomplete: the registered address and phone number below are placeholders
          and must be filled in before it is published.
        </p>
      )}

      <p>
        {SELLER.product} is operated by {SELLER.legalName}, a sole proprietor trading as{' '}
        {SELLER.tradeName}.
      </p>

      <SellerBlock />

      <Section n={1} heading="Support">
        <p>
          Email {SELLER.email}, or use the support form inside the application, which reaches the
          same place and records your ticket against your account. Support is answered by the
          proprietor during Indian business hours on working days.
        </p>
      </Section>

      <Section n={2} heading="Billing and refunds">
        <p>
          Questions about a payment, an invoice or a refund go to the same address. Quote the
          payment reference if you have one &mdash; it is the fastest way to find a transaction.
          See the <a href="/refunds" className="text-blue-700 underline">Refunds and
          Cancellation</a> policy.
        </p>
      </Section>

      <Section n={3} heading="Grievances">
        <p>
          If a support request has not been resolved, write to {SELLER.email} with
          &ldquo;Grievance&rdquo; in the subject line, addressed to {SELLER.legalName}, and it
          will be dealt with directly by the proprietor.
        </p>
      </Section>
    </LegalLayout>
  );
}
