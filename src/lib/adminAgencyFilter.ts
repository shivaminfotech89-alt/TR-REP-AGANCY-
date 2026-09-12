/**
 * FINDING ONE AGENCY AMONG SEVENTEEN, AND SEEING WHAT IT HOLDS BEFORE TOUCHING IT (AUDIT G73).
 *
 * The Admin Panel listed every agency unfiltered - 17 across 10 owners - and said nothing about what any of them
 * contained. Deciding whether one could be removed meant reading the database by hand.
 *
 * ⚠ THE CONTENTS COLUMN IS THE DELETE GUARD'S OWN QUESTION, ASKED BEFORE THE BUTTON IS PRESSED. `deleteIfEmpty`
 * refuses an agency that still has ATs or jobs; showing those two counts in the row makes the refusal predictable
 * instead of a surprise. The two must therefore agree: if the guard's blockers change, this changes with them.
 */

import { classifySubscription, type SubscriptionRecord, type SubscriptionKey } from './subscriptionStatus';

export interface AgencyLike {
  id: string;
  name?: string;
  email?: string;
  gstin?: string;
  ownerId?: string;
}

export interface Contents {
  ats: number;
  jobs: number;
}

export type StatusFilter = 'ALL' | SubscriptionKey;

/** What sits under one agency, counted from lists the panel has already read. */
export function countContents(
  agencyId: string,
  atMasters: Array<{ agencyId?: string }>,
  jobs: Array<{ agencyId?: string }>,
): Contents {
  return {
    ats: atMasters.filter(a => a.agencyId === agencyId).length,
    jobs: jobs.filter(j => j.agencyId === agencyId).length,
  };
}

/**
 * Nothing the delete guard would refuse on.
 *
 * ⚠ "HOLDS NOTHING" IS NOT "MAY BE DELETED", and the panel must not imply it is. The server also refuses on
 * inspections, oil transactions and a payment - which this cannot see. It narrows the list to look at; the guard
 * decides.
 */
export function holdsNothing(c: Contents): boolean {
  return c.ats === 0 && c.jobs === 0;
}

/** Name, contact email, GSTIN, owner email, or the document id - the id because the panel prints it and support
 *  conversations quote it. Case-insensitive; an empty term matches everything. */
export function matchesSearch(agency: AgencyLike, ownerEmail: string | undefined, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return [agency.name, agency.email, agency.gstin, agency.id, ownerEmail]
    .some(v => String(v || '').toLowerCase().includes(q));
}

/**
 * How many agencies sit in each subscription state.
 *
 * ⚠ RETURNS null WHEN THE SUBSCRIPTIONS COULD NOT BE READ, rather than counting every agency as NOT BILLED. A failed
 * read is not an account with no subscriptions (AUDIT G28, G34, G70) - and on this screen that reading would show
 * the vendor seventeen unbilled customers.
 */
export function statusCounts(
  agencies: AgencyLike[],
  subsByAgency: Record<string, SubscriptionRecord> | null,
  now: number,
): Record<SubscriptionKey, number> | null {
  if (subsByAgency === null) return null;
  const counts = { none: 0, admin: 0, trial: 0, trial_ended: 0, expired: 0, granted: 0, active: 0 } as Record<SubscriptionKey, number>;
  for (const a of agencies) counts[classifySubscription(subsByAgency[a.id] ?? null, now).key]++;
  return counts;
}

export function filterAgencies(args: {
  agencies: AgencyLike[];
  subsByAgency: Record<string, SubscriptionRecord> | null;
  contentsOf: (agencyId: string) => Contents;
  ownerEmailOf?: (agency: AgencyLike) => string | undefined;
  term: string;
  status: StatusFilter;
  onlyEmpty: boolean;
  now: number;
}): AgencyLike[] {
  const { agencies, subsByAgency, contentsOf, ownerEmailOf, term, status, onlyEmpty, now } = args;
  return agencies.filter(a => {
    if (!matchesSearch(a, ownerEmailOf?.(a), term)) return false;
    if (onlyEmpty && !holdsNothing(contentsOf(a.id))) return false;
    if (status === 'ALL') return true;
    // ⚠ A STATUS FILTER CANNOT ANSWER WHILE THE SUBSCRIPTIONS ARE UNREAD. Filtering on a classification derived from
    // no data would hide rows on the strength of a failed read, so every row stays and the screen says NOT READ.
    if (subsByAgency === null) return true;
    return classifySubscription(subsByAgency[a.id] ?? null, now).key === status;
  });
}
