import type { AtMaster } from './AgencyContext';

/**
 * HOW LONG A REPAIR IS GUARANTEED FOR (AUDIT G42, G43).
 *
 * ⚠ ONE RESOLVER, BECAUSE THERE USED TO BE THREE ANSWERS AND THEY DISAGREED. The certificate
 * printed free text an operator typed; the Guarantee Card printed the agency's setting; the
 * Dashboard counted a hardcoded eighteen. Two of those appeared on the same bill.
 *
 * ⚠ THE TENDER DECIDES, NOT THE AGENCY. A/T 1819 clause 38.2 sets the period and a different
 * A/T may set another, so it lives on the AT. An agency-level figure would survive a rollover
 * and quietly apply the previous tender's terms to this tender's work.
 */

/** A/T 1819 clause 38.2, verbatim in effect. */
export const DEFAULT_GUARANTEE_MONTHS = 18;

/** A/T 1819 clause 38.2 names SDT / PAT separately at six. */
export const LSTC_GUARANTEE_MONTHS = 6;

/**
 * ⚠ OVERHAULING IS NOT LISTED, AND THAT IS THE POINT — IT HAS NO GUARANTEE AT ALL.
 *
 * Verified against both tender documents rather than assumed:
 *
 *   - `1819AT.md`: the word "overhaul" does not appear anywhere in the document. Clause 38.2's
 *     table lists four types — 11 KV CRGO, amorphous, 22 KV CRGO, SDT/PAT — and overhauling is
 *     not among them.
 *   - `schedule-a-ugvcl-2026.md`: Sr. No. 21 is "Overhauling of transformer including outside
 *     cleaning and painting", a rate row with KVA-band prices and nothing else. A search of the
 *     whole schedule for "guarantee", "warrant" or "month" returns NOTHING for any item.
 *
 * So the tender is silent twice, and 38.2's own framing supports the silence: it guarantees
 * "the whole unit irrespective of parts repaired or replaced" — a warranty on a REPAIR.
 * Overhauling replaces nothing; it is a service.
 *
 * ⚠ SO `guaranteeMonthsFor` RETURNS null FOR OH, NOT 0. Zero months reads as a guarantee that
 * has expired; null is the absence of one. On a signed certificate that difference is the whole
 * meaning, and a caller that cannot handle null must be made to, not defaulted past.
 */
export const CORE_TYPES_WITH_GUARANTEE = ['CRGO', 'Amorphous', 'Wound Core', 'LSTC / PAT'] as const;

/** Every core type the app can express, including the one that carries no guarantee. */
export const ALL_CORE_TYPES = [...CORE_TYPES_WITH_GUARANTEE, 'Overhauling'] as const;

/** What clause 38.2 gives each, before an AT overrides it. */
export const GUARANTEE_DEFAULTS: Record<string, number> = {
  'CRGO': DEFAULT_GUARANTEE_MONTHS,
  'Amorphous': DEFAULT_GUARANTEE_MONTHS,
  'Wound Core': DEFAULT_GUARANTEE_MONTHS,
  'LSTC / PAT': LSTC_GUARANTEE_MONTHS,
};

/** True when this core type carries no guarantee term at all. See the note above. */
export function hasNoGuarantee(coreType: string | null | undefined): boolean {
  const t = String(coreType || '').trim().toUpperCase();
  return t === 'OH' || t.includes('OVERHAUL');
}

/**
 * The guarantee period for a job of this core type under this tender, or NULL when the core
 * type carries none.
 *
 * ⚠ A JOB THAT ALREADY STORES ONE WINS, ALWAYS. `gpGuaranteeMonths` is stamped at save, so a
 * unit dispatched under a closed tender keeps that tender's terms rather than acquiring the
 * current one's.
 */
export function guaranteeMonthsFor(
  at: Pick<AtMaster, 'guaranteeMonths'> | null | undefined,
  coreType: string | null | undefined,
  storedOnJob?: number | null,
): number | null {
  if (hasNoGuarantee(coreType)) return null;
  if (typeof storedOnJob === 'number' && storedOnJob > 0) return storedOnJob;
  const key = normaliseCoreLabel(coreType);
  const v = at?.guaranteeMonths?.[key];
  if (typeof v === 'number' && v > 0) return v;
  return GUARANTEE_DEFAULTS[key] ?? DEFAULT_GUARANTEE_MONTHS;
}

/**
 * WHICH OF THREE THINGS IS TRUE OF A TENDER'S GUARANTEE PERIOD (AUDIT G78).
 *
 * ⚠ BLANK READS AS UNSET AND UNSET READS AS BROKEN, AND NEITHER IS THE TRUTH. When an AT stores nothing, a real
 * period still applies - clause 38.2's - and what is missing is confirmation that this tender agrees with it.
 * Those are three states, and the panel used to render two of them identically.
 *
 * ⚠ `recorded` IS DELIBERATELY WEAKER THAN "confirmed". Until 2026-09-12 `AtDivisions.handleSave` wrote every
 * guarantee input on every save, and the inputs were pre-seeded from these defaults - so saving that panel to
 * rename a division wrote 18/18/18/6 onto the AT. A stored figure equal to the clause therefore cannot be told
 * apart from a figure nobody looked at, and the word must not claim otherwise. Four live ATs are in that state;
 * they are left untouched, because a write to disambiguate them would be inventing the answer. They resolve when
 * someone edits that AT.
 */
export type GuaranteeStateKind = 'default' | 'recorded' | 'differs';

export interface GuaranteeState {
  kind: GuaranteeStateKind;
  /** The months in force - always what `guaranteeMonthsFor` would apply, so a label cannot disagree with pricing. */
  months: number;
  /** What clause 38.2 gives this core type. */
  clauseMonths: number;
}

export function guaranteeState(
  at: Pick<AtMaster, 'guaranteeMonths'> | null | undefined,
  coreLabel: string,
): GuaranteeState {
  const clauseMonths = GUARANTEE_DEFAULTS[coreLabel] ?? DEFAULT_GUARANTEE_MONTHS;
  const stored = at?.guaranteeMonths?.[coreLabel];
  if (typeof stored !== 'number' || !(stored > 0)) {
    return { kind: 'default', months: clauseMonths, clauseMonths };
  }
  return {
    kind: stored === clauseMonths ? 'recorded' : 'differs',
    months: stored,
    clauseMonths,
  };
}

/** The sentence the panel prints. A fact with a source, never a warning - nothing here is wrong. */
export function describeGuaranteeState(s: GuaranteeState): string {
  if (s.kind === 'default') {
    return `${s.months} months - clause 38.2 default, not confirmed against this A/T`;
  }
  if (s.kind === 'recorded') {
    return `${s.months} months - recorded on this tender (may predate this change)`;
  }
  return `${s.months} months - set on this tender (clause default is ${s.clauseMonths})`;
}

/** Map any stored spelling onto the label these tables are keyed by. */
export function normaliseCoreLabel(coreType: string | null | undefined): string {
  const t = String(coreType || 'CRGO').trim().toUpperCase();
  if (t === 'OH' || t.includes('OVERHAUL')) return 'Overhauling';
  if (t.includes('AMORPHOUS')) return 'Amorphous';
  if (t.includes('WOUND') || t === 'WC') return 'Wound Core';
  if (t.includes('LSTC') || t.includes('SDT') || t.includes('PAT') || t.includes('PLMT')) return 'LSTC / PAT';
  return 'CRGO';
}

/**
 * A COUNTER VALUE FROM A STARTING NUMBER. The one place the -1 lives.
 *
 * ⚠ `lastJobNumbers` HOLDS THE LAST USED NUMBER, NOT THE NEXT ONE. `predictNextJobNo` returns
 * `last + 1`, and an absent counter reads 0 so the first job is 1. An agency joining a tender
 * part-way and starting at 47 therefore seeds 46. Storing 47 directly would make its first job
 * 48, which is the off-by-one this function exists to have exactly once.
 */
export function seedFromStartingNumber(startingNumber: number): number {
  return Math.max(0, Math.floor(startingNumber) - 1);
}

/** The inverse, for showing a stored seed back as the number a person typed. */
export function startingNumberFromSeed(seed: number): number {
  return Math.max(1, Math.floor(seed) + 1);
}
