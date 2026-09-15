/**
 * HAS A TENDER BEEN GIVEN RATES? — LIFTED OUT SO IT CAN BE TESTED AND READ ANYWHERE (AUDIT G93).
 *
 * This moved here UNCHANGED from estimateMasterHealth.ts. It reads ONE field of ONE argument
 * and depends on nothing - but the file it lived in imports `./estimateCalc`, which at its
 * fourth line imports `../components/SingleJobEstimateReport`, which reaches LetterheadHeader
 * and so `pdfjs-dist`. That library calls `new DOMMatrix()` at module scope, so importing this
 * one-field predicate in node died before a single test ran.
 *
 * ⚠ A LIB FILE IMPORTING A REPORT COMPONENT IS THE ACTUAL FAULT, and it is NOT fixed here -
 * see the audit entry. This lift only stops the most-read rule in the app from being hostage
 * to it. `atRatesReadiness` gates estimates and bills on five surfaces and now the bell.
 *
 * ⚠ estimateMasterHealth RE-EXPORTS THIS, so AgencySettings, BillingSystem and EstimateGenerate
 * keep importing it from where they always did. One definition, several doors.
 */

/**
 * HAS THIS AT BEEN GIVEN RATES AT ALL?
 *
 * A separate question from whether the rates are well formed, and it has to stay separate:
 * an AT with no `ratesSource` prices from the agency's sections and produces perfectly
 * valid-looking numbers, so nothing about the FIGURES can reveal that nobody has confirmed
 * them against this tender. Only the absence of the stamp can.
 *
 * Returns a reason string when the AT is not ready, null when it is.
 */
export function atRatesReadiness(at: any): { blocked: boolean; reason: string | null } {
  if (!at) {
    return { blocked: true, reason: 'No AT is selected. Rates belong to a tender, so there is nothing to price against.' };
  }
  const src = String(at.ratesSource || '').trim();
  if (!src) {
    return {
      blocked: true,
      reason: `AT "${at.atNumber || at.name || at.id}" has no rates of its own. A new tender starts with no schedule - enter its rates, or copy them from a published AT, before issuing anything priced from it.`,
    };
  }
  return { blocked: false, reason: null };
}
