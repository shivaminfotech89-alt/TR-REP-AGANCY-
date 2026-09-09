import {
  defaultEstimateData, defaultAmorphousEstimateData, defaultWoundCoreEstimateData,
  defaultOverhaulingEstimateData, defaultCircleLimitsEstimateData,
} from './estimateData';

/**
 * WHAT A NEW AGENCY IS BORN WITH — ONE IMPLEMENTATION, TWO RUNTIMES (AUDIT G32).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Agency creation is moving behind a Cloud Function, because a payment gate that a rule can
 * only READ is not a gate: rules cannot decrement, so one paid slot would create unlimited
 * agencies (G29). The function therefore has to seed a new agency exactly as the browser does
 * today - and a deployed function ships only what is under `functions/`, so it cannot import
 * from `src/`.
 *
 * ⚠ THE OBVIOUS ANSWER - COPY THE SEED INTO functions/ - IS THE ONE THIS CODEBASE HAS ALREADY
 * PAID FOR TWICE. F75 and F77 record what a second source of truth costs, and the seeding
 * routine is the single worst candidate for it: F30 records that the ORIGINAL bug here seeded
 * new agencies from whatever happened to be selected, propagating one agency's data into every
 * agency created afterwards, permanently, with no trace of where it came from. Two copies of
 * the seed would mean the browser and the server could disagree about what an agency IS, and
 * the disagreement would be invisible until someone compared two agencies created a week apart.
 *
 * So there is ONE authored implementation - this file - and `scripts/sync-agency-seed.js`
 * compiles it into `functions/agency-seed.generated.mjs` at predeploy, the same mechanism and
 * the same reasoning as `sync-functions-config.js`. The function imports the compiled copy.
 * Nothing is retyped, so nothing can drift; the generated file is a build artefact, not a
 * source, and editing it is a mistake the header there says out loud.
 *
 * ⚠ AND THE EXTRACTION IS PROVED, NOT ASSUMED. `scripts/admin/verify-seed-equality.js` builds
 * a new-agency document three ways - the legacy inline expression transcribed verbatim from
 * `addAgency` before this change, this function, and the compiled artefact the server will
 * actually run - and refuses unless all three hash identically. A refactor of the code that
 * decides what every future agency contains is not something to eyeball.
 */

/** The five sections, in the order `addAgency` wrote them. */
export const AGENCY_SEED = {
  estimateMasterCRGO: defaultEstimateData,
  // ⚠ NO `estimateMaster` MIRROR. A new agency has no legacy to support, and being born with an
  // unread duplicate is how every existing agency acquired one (AUDIT D4).
  estimateMasterAmorphous: defaultAmorphousEstimateData,
  estimateMasterWoundCore: defaultWoundCoreEstimateData,
  estimateMasterOverhauling: defaultOverhaulingEstimateData,
  estimateMasterCircleLimits: defaultCircleLimitsEstimateData,
};

/**
 * Assemble the document a new agency is created with.
 *
 * ⚠ THE SPREAD ORDER IS LOAD-BEARING AND IS PRESERVED EXACTLY. The seed goes first so that
 * anything the caller supplies OVERRIDES it, and `ownerId` goes last so that nothing the caller
 * supplies can override THAT. Reversing either would be a silent change: seed-after-caller would
 * discard rates an importer had supplied, and ownerId-before-caller would let a payload claim
 * another account's agency. Both would typecheck and both would look tidier.
 *
 * ⚠ `createdAt` IS DELIBERATELY NOT SET HERE. It is `serverTimestamp()` at the call site, a
 * sentinel rather than a value (AUDIT A5): storing it in React state would put a FieldValue
 * where a date is expected, and generating it here would mean a browser clock corroborating
 * itself. The caller adds it to what it WRITES and not to what it keeps.
 */
export function buildNewAgencyDocument<T>(
  agencyData: T,
  ownerId: string,
  // The return type PRESERVES T rather than widening to Record<string, unknown>. The widened
  // version typechecked here and broke at the call site, where the result is put into
  // setAgencies(Agency[]) - tsc caught it, which is worth noting in a project whose
  // strictNullChecks is off and whose green typecheck has repeatedly been worth less than it
  // looked. A helper that erases its caller's type moves the error somewhere else.
): T & typeof AGENCY_SEED & { ownerId: string } {
  return {
    ...AGENCY_SEED,
    ...agencyData,
    ownerId,
  };
}

/**
 * A stable digest of the seed, for the equality harness and for a deploy to assert against.
 *
 * ⚠ KEYS ARE SORTED BEFORE HASHING, at every level. `JSON.stringify` preserves insertion order,
 * so two objects that are equal in every respect a reader cares about hash differently if a
 * field moved - which would make this refuse a change that is genuinely a no-op, and a check
 * that cries wolf gets switched off. Sorting compares VALUE, which is the question being asked.
 */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = walk(o[k]);
        return acc;
      }, {});
    }
    return v;
  };
  return JSON.stringify(walk(value));
}
