import type { MasterSection } from './estimateMasterHealth';

/**
 * AGENCY SETTINGS' FOUR TABS, AND THE `?section=` VOCABULARY THAT SELECTS THEM (AUDIT G56).
 *
 * ⚠ THE URL IS THE ONLY RECORD OF WHICH TAB IS SHOWING. It used to be `useState`, with an
 * effect reading `?section=` to scroll to a part of one long page. A tab chosen from state
 * cannot follow a link: react-router re-derives search params only when the query string
 * changes, so a link to the URL already in the address bar would re-run nothing and leave the
 * operator on whichever tab they had clicked to. Derived on every render, it cannot drift.
 *
 * Every deep link in the app already speaks this vocabulary - setup-gap dialogs, the sidebar,
 * the Dashboard, the seed panel - so the tabs adopt it rather than inventing a second one:
 *
 *   (none), unknown          -> Agency setup
 *   at, divisions, allotments -> AT / Tender periods (AtSettings also reads atId, division,
 *                                coreType from the same URL, to open the named AT)
 *   estimate-master           -> Estimate Master     (EstimateMaster reads at, open)
 *   subscription              -> Manage subscription
 */
export type SettingsTab = 'agency' | 'at' | 'estimate-master' | 'subscription';

export function settingsTabFor(section: string | null | undefined): SettingsTab {
  switch (section) {
    case 'at':
    case 'divisions':
    case 'allotments':
      return 'at';
    case 'estimate-master':
      return 'estimate-master';
    case 'subscription':
      return 'subscription';
    default:
      return 'agency';
  }
}

/** Estimate Master's accordion keys - the four priced sections plus the circle limits. */
export type EstimateMasterSectionKey = MasterSection | 'CIRCLE_LIMITS';

/**
 * WHERE A REFUSAL ABOUT RATES SENDS THE OPERATOR: the Estimate Master tab, ON THE AT THAT
 * REFUSED, with the section it names already open.
 *
 * ⚠ THE AT IS NOT OPTIONAL IN SPIRIT. Estimates and bills price from the JOB's tender
 * (`atForJob`), not from the active one, so a refusal about an older tender that linked to
 * plain `?section=estimate-master` opened the screen on whichever AT is active - the right tab
 * and the wrong tender, with the fault still to find.
 */
export function estimateMasterLink(
  at?: { id?: string | null } | null,
  open?: EstimateMasterSectionKey,
): string {
  const q = new URLSearchParams({ section: 'estimate-master' });
  if (at?.id) q.set('at', at.id);
  if (open) q.set('open', open);
  return `/agency-settings?${q.toString()}`;
}

/**
 * WHERE A REFUSAL ABOUT A TENDER'S OWN DETAILS SENDS THE OPERATOR: the AT tab, with that AT open
 * (AtSettings reads `atId` and opens the named AT). The AT, for the same reason as above - the job's
 * tender is not necessarily the active one.
 */
export function atSettingsLink(at?: { id?: string | null } | null): string {
  const q = new URLSearchParams({ section: 'at' });
  if (at?.id) q.set('atId', at.id);
  return `/agency-settings?${q.toString()}`;
}
