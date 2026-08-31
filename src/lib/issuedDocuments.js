/**
 * HAS THIS JOB PRODUCED A DOCUMENT THAT LEFT THE AGENCY? (AUDIT G3)
 *
 * ⚠ PLAIN .js ON PURPOSE, SO THE APP AND THE ADMIN SCRIPTS SHARE ONE DEFINITION.
 * `tsconfig` sets `allowJs`, and the package is `"type": "module"`, so this single file is
 * imported by `src/components/MrLedger.tsx` through Vite AND by
 * `scripts/admin/delete-unassigned.js` under plain Node. A second copy of this test is how
 * a script that refuses to destroy evidence sits beside a UI that destroys it - which is
 * exactly the state this file was extracted from (AUDIT F87's side-by-side rule, applied to
 * a rule rather than to a number).
 *
 * WHY IT IS DELIBERATELY BROAD. A false positive costs a person one manual decision. A false
 * negative destroys the only record of what was billed, to whom, and by which agency -
 * `issuedByAgencyId` lives on the job document (O14), so deleting the job deletes the
 * provenance of the invoice. Every field that could indicate a document left the agency is
 * here, including the amount fields: a job carrying a bill amount but no bill number is
 * exactly the half-written state worth stopping on.
 *
 * ⚠ 'Unpaid' AND 'Pending' ARE TREATED AS ABSENT. They are the default values the forms
 * write, not evidence that anything was issued; counting them would block every job in the
 * agency and make the guard useless, which is the failure mode that gets a guard removed.
 */

/** [field, human label] - the label is what the operator is shown when a delete is refused. */
export const ISSUED_FIELDS = [
  ['estimateNo', 'estimate no'],
  ['estimateSentDate', 'estimate sent'],
  ['estimateAmount', 'estimate amount'],
  ['billNo', 'bill no'],
  ['billSentDate', 'bill sent'],
  ['billAmount', 'bill amount'],
  ['billStatus', 'bill status'],
  ['paymentStatus', 'payment status'],
  ['paidAmount', 'paid amount'],
  ['paymentDate', 'payment date'],
  ['challanNo', 'challan no'],
  ['challanDate', 'challan date'],
  ['dispatchDate', 'dispatched'],
  ['issuedByAgencyId', 'issued-by stamp'],
];

/** A value that indicates something real, rather than a form default or a blank. */
function isPresent(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim();
  if (s === '' || s === '-') return false;
  const low = s.toLowerCase();
  return low !== 'unpaid' && low !== 'pending';
}

/** Every issued-document marker this job carries, as "label: value" strings. Empty if none. */
export function issuedMarks(job) {
  return ISSUED_FIELDS
    .filter(([field]) => isPresent(job?.[field]))
    .map(([field, label]) => `${label}: ${job[field]}`);
}

/** True when the job carries any document that left the agency. */
export function hasIssuedDocument(job) {
  return issuedMarks(job).length > 0;
}
