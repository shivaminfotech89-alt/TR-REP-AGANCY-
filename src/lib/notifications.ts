/**
 * EVERY STANDING FACT ABOUT THIS AGENCY, IN ONE LIST (AUDIT G93).
 *
 * The app had 66 persistent banners across 24 screens, and they could not be cleared. An
 * operator who cannot clear a message learns to look past it, which is the outcome the
 * "keep it visible" reasoning was trying to avoid - so the standing ones move here, behind a
 * bell, and dismissal lasts until the fact itself changes (see lib/notificationDismissal.ts).
 *
 * ⚠ FEWER SURFACES, NOT MORE. The app did not hold 66 facts; it held far fewer, painted
 * repeatedly, because each screen grew its own. "This tender has no rates" was rendered in
 * FIVE places and "work belongs to no tender" in THREE. Each item below calls the SAME
 * predicate the screens call - `atRatesReadiness`, `isUnassigned`, `orderReferenceFor`,
 * `unmatchedOilRows`, `isIntakeOpen`, `otherActiveAts` - never a copy of it. If a rule
 * changes, the banner and the bell change together or not at all.
 *
 * ⚠ NO FIRESTORE READS. Everything here is computed from what AgencyContext has already
 * loaded for the active agency. Reads are billed by bytes on this project, and a bell that
 * costs a query every time the header renders would be a standing charge for a UI ornament.
 *
 * ⚠ WHICH IS WHY A FAILED LOAD IS NOT "NOTHING IS WRONG" (AUDIT G70). If the work lists
 * failed to load, `agencyJobs` and `agencyOil` are EMPTY - and every count derived from them
 * would read zero, which renders as a calm, quiet bell over data nobody could read. When
 * `workUnavailable` is set, the work-derived items are not computed at all and the panel says
 * the counts are unavailable. The tender-derived items still stand: they come from
 * `atMasters`, which is a different load that may well have succeeded.
 *
 * ⚠ WHAT DOES NOT BELONG HERE. Two kinds of notice stayed on their screens, and neither is a
 * matter of taste. A notice that REPLACES A CONTROL - New Job's closed-intake panel, the two
 * Save buttons - is not a banner but the fallback render; moving it deletes the explanation
 * for a missing button. And a notice about the DOCUMENT BEING RENDERED - "this sheet will
 * print short", "rate not found, total withheld" - cannot be computed agency-wide at all,
 * because it depends on the sheet in front of you. A warning that arrives after the paper
 * does is not a warning.
 */
import { oilRowsMissingMrNumber, litresOf } from './mrRename';
// ⚠ FROM THE PURE MODULE, NOT FROM estimateMasterHealth (AUDIT G93). That file re-exports the
// same function, but importing it from there drags `./estimateCalc` ->
// `../components/SingleJobEstimateReport` -> `pdfjs-dist` in, which calls `new DOMMatrix()` at
// module scope and kills every test in this file before one of them runs. Same definition,
// reached by the door that carries no cargo.
import { atRatesReadiness } from './ratesReadiness';
import { orderReferenceFor } from './orderReference';
import { missingForEstimate, missingForTaxInvoice } from './jobDisplay';
import { agenciesUsingMark, markFor } from './agencyMark';
import { isUnassigned, isIntakeOpen, otherActiveAts } from './tenderState';
import { signatureOf } from './notificationDismissal';

export type NotificationTone = 'blocking' | 'warning' | 'info';

export interface NotificationItem {
  /** Stable across renders and across sessions - it is also the dismissal's storage key. */
  id: string;
  /** The fact, in the operator's words. */
  title: string;
  /** One sentence on what it means. Never a restatement of the title. */
  detail: string;
  /** How many things the fact is about; 0 when it is not a count. */
  count: number;
  /** The route to the fix, for a link. */
  to: string;
  /** What the link says it will do. */
  linkLabel: string;
  tone: NotificationTone;
  /**
   * The fact this item is about, as one string. Dismissal stores it; the item returns the
   * moment it differs. See lib/notificationDismissal.ts for why it is sorted.
   */
  signature: string;
}

export interface NotificationInput {
  activeAgency: any | null;
  agencies: any[];
  agencyJobs: any[];
  agencyOil: any[];
  atMasters: any[];
  activeAtMaster: any | null;
  viewingAllTenders: boolean;
  /** `agencyDataLoad.status === 'failed'` - jobs, inspections and oil could not be read. */
  workUnavailable: boolean;
  /** Session notices AgencyContext already computes; passed rather than recomputed. */
  atSupersededNotice?: { movedTo?: string; wasOn?: string } | null;
  agencyPointerNotice?: string | null;
  globalConfigError?: string | null;
}

export interface NotificationSet {
  items: NotificationItem[];
  /**
   * True when the work lists could not be read, so the work-derived counts are ABSENT rather
   * than zero. The panel must say so instead of showing a quiet bell.
   */
  workUnavailable: boolean;
}

const AT_SETTINGS = '/agency-settings?section=at';
const ESTIMATE_MASTER = '/agency-settings?section=estimate-master';

/** The AT label an operator reads on paper, not its document id. */
function atLabel(at: any): string {
  return String(at?.atNumber || at?.name || at?.id || '?');
}

export function buildNotifications(input: NotificationInput): NotificationSet {
  const {
    activeAgency, agencies, agencyJobs, agencyOil, atMasters, activeAtMaster,
    viewingAllTenders, workUnavailable,
  } = input;

  const items: NotificationItem[] = [];
  if (!activeAgency) return { items, workUnavailable: false };

  const agencyAts = atMasters.filter(t => t.agencyId === activeAgency.id);

  // ---------------------------------------------------------------- the agency itself

  // Estimates and tax invoices are REFUSED while these are blank, so this is not cosmetic.
  const missing = Array.from(new Set([
    ...missingForEstimate(activeAgency),
    ...missingForTaxInvoice(activeAgency),
  ]));
  if (missing.length > 0) {
    items.push({
      id: 'agency-details-missing',
      title: `${activeAgency.name} cannot issue estimates or tax invoices`,
      detail: `Not recorded yet: ${missing.join(', ')}.`,
      count: missing.length,
      to: '/agency-settings',
      linkLabel: 'Complete the agency details',
      tone: 'blocking',
      signature: signatureOf(missing),
    });
  }

  // Two agencies wearing the same mark are indistinguishable in the switcher - the one
  // control whose whole job is telling them apart.
  const clash = agenciesUsingMark(markFor(activeAgency), agencies, activeAgency.id);
  if (clash.length > 0) {
    items.push({
      id: 'duplicate-agency-mark',
      title: 'Another agency looks identical in the switcher',
      detail: `${activeAgency.name} shares its mark with ${clash.join(', ')}.`,
      count: clash.length,
      to: '/agency-settings',
      linkLabel: 'Give it its own mark',
      tone: 'info',
      signature: signatureOf(clash),
    });
  }

  // ---------------------------------------------------------------- tenders

  if (agencyAts.length === 0) {
    items.push({
      id: 'no-tender',
      title: 'This agency has no tender',
      detail: 'Divisions, prefixes, allotments and rates are all recorded against a tender period, and no work can be booked without one.',
      count: 0,
      to: AT_SETTINGS,
      linkLabel: 'Set up an AT period',
      tone: 'blocking',
      signature: signatureOf([activeAgency.id]),
    });
  } else {
    const noRates = agencyAts.filter(at => atRatesReadiness(at).blocked);
    if (noRates.length > 0) {
      items.push({
        id: 'ats-without-rates',
        title: `${noRates.length} tender${noRates.length === 1 ? ' has' : 's have'} no rates`,
        detail: `Estimates and bills under ${noRates.length === 1 ? 'it' : 'them'} are refused until a schedule is entered or copied: AT ${noRates.map(atLabel).join(', AT ')}.`,
        count: noRates.length,
        to: ESTIMATE_MASTER,
        linkLabel: 'Open Estimate Master',
        tone: 'blocking',
        signature: signatureOf(noRates.map(at => at.id)),
      });
    }

    // ⚠ NARROWED TO SEND, NOT TO PRINT (AUDIT O73). A missing order number blocks the SEND
    // only; the sheet still prints with a blank order line. The wording has to match, or the
    // bell will claim a refusal the app does not actually make.
    const noOrder = agencyAts.filter(at => orderReferenceFor({ at, source: 'own' } as any, atLabel(at)).refusal);
    if (noOrder.length > 0) {
      items.push({
        id: 'ats-without-order',
        title: `${noOrder.length} tender${noOrder.length === 1 ? '' : 's'} with no A/T order number`,
        detail: `An estimate under ${noOrder.length === 1 ? 'it' : 'them'} prints "Order No.:" blank and cannot be sent: AT ${noOrder.map(atLabel).join(', AT ')}.`,
        count: noOrder.length,
        to: AT_SETTINGS,
        linkLabel: 'Enter the order number and date',
        tone: 'warning',
        signature: signatureOf(noOrder.map(at => at.id)),
      });
    }

    // Nothing breaks - `isIntakeOpen` takes the latest - but a fault the app can see and
    // never mentions is one nobody fixes.
    const bothActive = agencyAts.filter(at => otherActiveAts(at, agencyAts).length > 0);
    if (bothActive.length > 1) {
      items.push({
        id: 'ats-both-active',
        title: `${bothActive.length} tenders are marked Active`,
        detail: `Only one should be. New work goes to the one that started most recently; the others are: AT ${bothActive.map(atLabel).join(', AT ')}.`,
        count: bothActive.length,
        to: AT_SETTINGS,
        linkLabel: 'Review the tender periods',
        tone: 'warning',
        signature: signatureOf(bothActive.map(at => at.id)),
      });
    }

    /**
     * ⚠ "ALL TENDERS" IS NOT A FAULT, SO IT IS NOT REPORTED. `isIntakeOpen` refuses in that
     * scope deliberately - it is a viewing state the operator chose, and there is no single
     * AT to book into. Reporting it would put a permanent notification on the bell for a
     * setting working exactly as intended, which is how a bell earns the same "look past it"
     * reflex the banners did.
     */
    if (!viewingAllTenders && activeAtMaster) {
      const gate = isIntakeOpen(activeAtMaster, agencyAts, viewingAllTenders);
      if (!gate.open) {
        items.push({
          id: 'intake-closed',
          title: `AT ${atLabel(activeAtMaster)} is closed to new work`,
          detail: `${gate.reason} Everything already booked under it stays fully usable - inspections, testing, challans, estimates and bills.`,
          count: 0,
          to: AT_SETTINGS,
          linkLabel: 'Review the tender periods',
          tone: 'info',
          signature: signatureOf([activeAtMaster.id, gate.reason]),
        });
      }
    }
  }

  // ---------------------------------------------------------------- the work itself

  // ⚠ SKIPPED ENTIRELY WHEN THE READ FAILED. See the header: zero here would be a lie.
  if (!workUnavailable) {
    /**
     * ⚠ THIS ITEM USED TO REPORT CORRECT DATA AS A FAULT, AND SAID SOMETHING FALSE WHILE DOING
     * IT (AUDIT O78). It counted receipts whose MR carried no transformers - which is an MR
     * raised for oil issue alone, i.e. normal business - and its detail claimed the litres
     * "sit in no tender's balance". They do not: the receipt carries an `atId`, so
     * `computeOilBalance` counts it, and the Oil Account's own banner says so correctly.
     *
     * What is left is the case where the balance genuinely loses litres: a receipt naming no
     * MR at all, which `computeOilBalance` skips outright.
     */
    const noMrNumber = oilRowsMissingMrNumber(agencyOil, activeAgency.id);
    if (noMrNumber.length > 0) {
      const litres = litresOf(noMrNumber);
      items.push({
        id: 'oil-without-mr',
        title: `${noMrNumber.length} oil receipt${noMrNumber.length === 1 ? '' : 's'} record no MR number`,
        detail: `${litres.toLocaleString('en-IN')} litres are left out of the oil balance entirely - they do not reach the Dashboard, the printed statement or the balance carried into the next tender, though the transactions list still shows them.`,
        count: noMrNumber.length,
        to: '/oil-inward',
        linkLabel: 'Open the oil ledger',
        tone: 'warning',
        signature: signatureOf(noMrNumber.map(tx => String(tx?.id ?? ''))),
      });
    }

    /**
     * ⚠ ONE ITEM FOR BOTH, BECAUSE IT IS ONE FACT. Jobs and oil rows with no `atId` were
     * three separate banners on three screens (MR Register, Oil Ledger, Dashboard) saying the
     * same thing about the same predicate. The count here is deliberately agency-wide and
     * NOT scope-filtered: unassigned work is invisible in every tender scope, which is the
     * whole reason it needs saying. A Firestore equality cannot find it either (F87) - it is
     * found in memory, as it is here.
     */
    const unassignedJobs = agencyJobs.filter(isUnassigned);
    const unassignedOil = agencyOil.filter(isUnassigned);
    if (unassignedJobs.length > 0 || unassignedOil.length > 0) {
      const parts: string[] = [];
      if (unassignedJobs.length > 0) parts.push(`${unassignedJobs.length} job${unassignedJobs.length === 1 ? '' : 's'}`);
      if (unassignedOil.length > 0) parts.push(`${unassignedOil.length} oil entr${unassignedOil.length === 1 ? 'y' : 'ies'}`);
      items.push({
        id: 'unassigned-work',
        title: `${parts.join(' and ')} belong to no tender`,
        detail: 'They carry no AT, so they appear under no tender and are counted in no balance. They are not lost - they are unattributed.',
        count: unassignedJobs.length + unassignedOil.length,
        to: '/mr-ledger',
        linkLabel: 'See them in the MR Register',
        tone: 'warning',
        signature: signatureOf([
          ...unassignedJobs.map(j => String(j?.id ?? '')),
          ...unassignedOil.map(t => String(t?.id ?? '')),
        ]),
      });
    }
  }

  // ---------------------------------------------------------------- session notices

  const superseded = input.atSupersededNotice;
  if (superseded && superseded.movedTo) {
    items.push({
      id: 'at-superseded',
      title: `AT ${superseded.movedTo} is now the current tender`,
      detail: `You were last working in ${superseded.wasOn}. New MRs, jobs and oil entries go to ${superseded.movedTo}; everything under ${superseded.wasOn} is still there - switch to it in the sidebar to see it.`,
      count: 0,
      to: AT_SETTINGS,
      linkLabel: 'Review the tender periods',
      tone: 'info',
      signature: signatureOf([String(superseded.wasOn ?? ''), String(superseded.movedTo ?? '')]),
    });
  }

  if (input.agencyPointerNotice) {
    items.push({
      id: 'agency-pointer',
      title: 'The agency that opened is not the one last used',
      detail: input.agencyPointerNotice,
      count: 0,
      to: '/agency-settings',
      linkLabel: 'Choose the agency',
      tone: 'info',
      signature: signatureOf([input.agencyPointerNotice]),
    });
  }

  if (input.globalConfigError) {
    items.push({
      id: 'global-config-offline',
      title: 'Global estimate defaults are offline',
      detail: `${input.globalConfigError} The app is pricing from its built-in fallback, so figures may not match the published defaults.`,
      count: 0,
      to: ESTIMATE_MASTER,
      linkLabel: 'Check the rates in use',
      tone: 'warning',
      signature: signatureOf([input.globalConfigError]),
    });
  }

  return { items, workUnavailable };
}

/** Blocking first, then warnings, then information - within a tone, as built. */
const TONE_ORDER: Record<NotificationTone, number> = { blocking: 0, warning: 1, info: 2 };

export function sortNotifications(items: NotificationItem[]): NotificationItem[] {
  return items.slice().sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}
