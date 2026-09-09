/**
 * THE SUBSCRIPTION PRICE, IN VERSION CONTROL.
 *
 * ⚠ NOT IN A BROWSER-EDITABLE FIELD, AND THAT IS THE POINT. The Admin Panel used to carry
 * `annualFeePerAgency` as a number input writing to `system_config/razorpay`. A price that can
 * be edited from a browser is a price that can disagree with a GST invoice already issued -
 * and a tax invoice, once issued, is corrected by a credit note, never by editing it. The
 * figure that goes on a legal document belongs where it can be reviewed and blamed: here.
 *
 * ⚠ IT REPLACED A FIGURE THAT WAS WRONG IN NINE PLACES. The app advertised Rs 3,999/yr on the
 * admin tab label, two panel headings, a save confirmation, the announcement banner and - worst
 * - twice on the SUPPORT FORM, where a customer reads it and would quote it back. Nine literals
 * of the same fact is how they drift; one constant is why they cannot.
 *
 * THE ARITHMETIC. Rs 5,900 is the INCLUSIVE figure - what the agency actually pays. GST is
 * carved out of it, not added to it:
 *
 *     taxable value  = 5900 / 1.18  = 5000.00
 *     tax            = 5900 - 5000  =  900.00
 *
 * ⚠ DERIVED, NOT WRITTEN DOWN TWICE. Storing 5000 and 900 alongside 5900 would be three
 * literals that can disagree; the invoice must foot exactly or it is not a valid tax invoice.
 * The rate is the input and the split is computed.
 *
 * ⚠ WHETHER THE TAX IS CGST+SGST OR IGST IS NOT DECIDED HERE. It depends on the BUYER's state
 * against the seller's, and both are only known when an invoice is raised. MSD CORPORATION is
 * registered in Gujarat (GSTIN 24DHHPP9291K1ZM, state code 24), so a Gujarat agency is an
 * intra-state supply splitting 9% + 9%, and an agency anywhere else is inter-state at 18% IGST.
 * The app constrains agencies to Gujarat today, which makes the split look constant - it is
 * not, and hardcoding it would be a filing error the first time that constraint changes.
 */

/** What an agency pays for one year, inclusive of GST. The only price literal in the app. */
export const SUBSCRIPTION_INCLUSIVE_INR = 5900;

/** The GST rate this service is charged at, as a percentage. */
export const GST_RATE_PERCENT = 18;

/** One subscription year, in days. Used for expiry arithmetic, not for display. */
export const SUBSCRIPTION_DAYS = 365;

/** MSD CORPORATION's own state code, from its GSTIN. Decides intra- against inter-state. */
export const SELLER_STATE_CODE = '24';

/**
 * Carve the tax out of an inclusive amount.
 *
 * Rounded to paise at each step and the taxable value derived by SUBTRACTION, so that
 * `taxable + tax === inclusive` exactly. Computing both independently from the rate is how an
 * invoice comes to be out by one paisa, which on a tax document is a defect rather than a
 * rounding artefact.
 */
export function gstBreakdown(inclusive: number = SUBSCRIPTION_INCLUSIVE_INR) {
  const paise = Math.round(inclusive * 100);
  const taxablePaise = Math.round(paise / (1 + GST_RATE_PERCENT / 100));
  const taxPaise = paise - taxablePaise;
  return {
    inclusive: paise / 100,
    taxable: taxablePaise / 100,
    tax: taxPaise / 100,
    ratePercent: GST_RATE_PERCENT,
  };
}

/** `Rs 5,900` in the Indian digit grouping, for a screen. */
export function formatPrice(amount: number = SUBSCRIPTION_INCLUSIVE_INR): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}
