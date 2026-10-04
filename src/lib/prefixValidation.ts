export interface DivisionPrefixEntry {
  name: string;
  prefixCRGO: string;
  prefixAmorphous?: string;
  prefixWoundCore?: string;
  prefixLSTC?: string;
  prefixOH?: string;
  [key: string]: any;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  divisionErrors: Record<number, {
    duplicatePrefixes?: { prefix: string; fields: string[] }[];
    nameError?: string;
    crgoError?: string;
  }>;
}

/**
 * Validates division configurations:
 * 1. Checks that division names are non-empty and unique.
 * 2. Checks that within the same division, no duplicate prefixes are used across different core types.
 * 3. Checks that CRGO prefix is provided.
 */
export function validateDivisionPrefixes(divisions: DivisionPrefixEntry[]): ValidationResult {
  const errors: string[] = [];
  const divisionErrors: Record<number, {
    duplicatePrefixes?: { prefix: string; fields: string[] }[];
    nameError?: string;
    crgoError?: string;
  }> = {};

  if (!divisions || divisions.length === 0) {
    return { isValid: false, errors: ['At least one division is required.'], divisionErrors: {} };
  }

  const seenDivisionNames = new Set<string>();

  divisions.forEach((div, index) => {
    const divErrors: {
      duplicatePrefixes?: { prefix: string; fields: string[] }[];
      nameError?: string;
      crgoError?: string;
    } = {};

    const name = (div.name || '').trim().toUpperCase();
    if (!name) {
      divErrors.nameError = 'Division name is required.';
      errors.push(`Division #${index + 1}: Division name is required.`);
    } else if (seenDivisionNames.has(name)) {
      divErrors.nameError = `Duplicate division name '${name}' found.`;
      errors.push(`Duplicate division name '${name}' found.`);
    } else {
      seenDivisionNames.add(name);
    }

    const crgo = (div.prefixCRGO || '').trim().toUpperCase();
    if (!crgo) {
      divErrors.crgoError = 'CRGO prefix is required.';
      errors.push(`Division '${name || `#${index + 1}`}': CRGO prefix is required.`);
    }

    // Check duplicate prefix within the same division across core types
    const prefixMap: Record<string, string[]> = {};
    const prefixFields: { key: string; label: string; val: string }[] = [
      { key: 'prefixCRGO', label: 'CRGO', val: crgo },
      { key: 'prefixAmorphous', label: 'Amorphous', val: (div.prefixAmorphous || '').trim().toUpperCase() },
      { key: 'prefixWoundCore', label: 'Wound Core', val: (div.prefixWoundCore || '').trim().toUpperCase() },
      { key: 'prefixLSTC', label: 'LSTC', val: (div.prefixLSTC || '').trim().toUpperCase() },
      { key: 'prefixOH', label: 'Overhauling (OH)', val: (div.prefixOH || '').trim().toUpperCase() },
    ];

    prefixFields.forEach(({ label, val }) => {
      if (val) {
        if (!prefixMap[val]) prefixMap[val] = [];
        prefixMap[val].push(label);
      }
    });

    const dupes: { prefix: string; fields: string[] }[] = [];
    Object.entries(prefixMap).forEach(([prefix, fields]) => {
      if (fields.length > 1) {
        dupes.push({ prefix, fields });
        errors.push(
          `Division '${name || `#${index + 1}`}': Duplicate prefix '${prefix}' used for ${fields.join(' and ')}. Duplicate or same prefix for the same division is not allowed.`
        );
      }
    });

    if (dupes.length > 0) {
      divErrors.duplicatePrefixes = dupes;
    }

    if (Object.keys(divErrors).length > 0) {
      divisionErrors[index] = divErrors;
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    divisionErrors
  };
}

/**
 * A TENDER'S PREFIX IS ITS OWN - CHECKED AGAINST ITS SIBLINGS *AND* AGAINST THE JOB NUMBERS (AUDIT G108).
 *
 * The business rule, from the operator, 2026-10-04: **every tender has a new prefix.** That makes a new tender's
 * series start at 1 under a name no job has carried, which is what O89 asked for and what the prefill could not
 * deliver while prefixes were reused.
 *
 * ⚠ F42 SAID THE OPPOSITE AND WAS WRONG WHEN IT WAS WRITTEN - not overtaken, wrong. It held that "prefixes belong
 * to the division and the agency, not to the tender period", and that premise is what O89 cited to explain why
 * restarting at 1 reissues a number, and what the case for not building this rested on. The reused prefixes in live
 * data are an entry fault, not the practice. See F42's own entry for the correction.
 *
 * ⚠⚠ CHECKED AGAINST JOB NUMBERS TOO, BECAUSE AN AT CAN BE DELETED AND ITS JOBS CANNOT (AUDIT F78 - "an AT has been
 * deleted, forget it everywhere"). Validating against sibling ATs alone leaves a deleted tender's prefix free to
 * reuse with nothing to warn, and the numbers it issued still sitting in the jobs collection - so the new tender
 * would collide with them and the skip in `nextFreeJobNumber` would fire again, silently. The two checks together
 * cost one pass over the jobs already in memory.
 */

/** A prefix already spoken for, and by what - so a refusal can say which tender, or that jobs carry it. */
export interface PrefixInUse {
  prefix: string;
  /** The AT that configures it, when a sibling does. */
  atLabel?: string;
  /** How many live job numbers carry it. */
  jobCount: number;
}

const normalise = (p: unknown) => String(p ?? '').trim().toUpperCase();

/** Every prefix a division entry names, across its core types. */
function prefixesOf(div: DivisionPrefixEntry): string[] {
  return [div.prefixCRGO, div.prefixAmorphous, div.prefixWoundCore, div.prefixLSTC, div.prefixOH]
    .map(normalise)
    .filter(Boolean);
}

/** Every prefix configured on an AT's `prefixes` map, whatever shape the entries take. */
export function configuredPrefixes(at: { prefixes?: any } | null | undefined): string[] {
  const out: string[] = [];
  for (const entry of Object.values(at?.prefixes || {})) {
    if (typeof entry === 'string') { const v = normalise(entry); if (v) out.push(v); continue; }
    for (const v of Object.values(entry || {})) { const n = normalise(v); if (n) out.push(n); }
  }
  return [...new Set(out)];
}

/** The literal prefix of a job number - everything before the last dash. */
export function prefixOfJobNo(jobNo: unknown): string {
  const s = String(jobNo ?? '').trim();
  const d = s.lastIndexOf('-');
  return d > 0 ? normalise(s.slice(0, d)) : '';
}

/**
 * Prefixes this AT may not take: those its siblings configure, and those live job numbers already carry.
 *
 * Cancelled jobs are excluded, matching every other reading of "spoken for" - their numbers are freed for reuse.
 */
export function prefixesUnavailableTo(
  atId: string,
  siblingAts: readonly { id: string; atNumber?: string; name?: string; prefixes?: any }[],
  jobs: readonly any[],
  /**
   * ⚠ THE AGENCY'S OWN MAP, BECAUSE AN AT WITH NO PREFIXES FALLS BACK TO IT - AND MOST DO (AUDIT G108).
   *
   * `adoptPublishedAt` copies rates and nothing else, so a new AT is born with no `prefixes` at all and
   * `getJobNoPrefix` resolves it from `activeAgency.prefixes`. Three of the five live sharing groups involve such an
   * AT: SAMOR's AT-2026-28 and UPENDRA's 1819 configure nothing and still resolve to the shared prefix. Checking
   * only what a sibling CONFIGURES would pass a prefix that two tenders nonetheless resolve to - the effective set
   * is what matters, not the stored one.
   */
  agencyPrefixes?: { prefixes?: any } | null,
): Map<string, PrefixInUse> {
  const out = new Map<string, PrefixInUse>();
  const bump = (prefix: string, patch: Partial<PrefixInUse>) => {
    const cur = out.get(prefix) || { prefix, jobCount: 0 };
    out.set(prefix, { ...cur, ...patch, jobCount: cur.jobCount + (patch.jobCount || 0) });
  };

  const fallback = configuredPrefixes(agencyPrefixes);
  for (const sib of siblingAts) {
    if (String(sib.id) === String(atId)) continue;
    const label = sib.atNumber || sib.name || sib.id;
    const own = configuredPrefixes(sib);
    // A sibling that configures nothing still RESOLVES to the agency's map, so that is its effective set.
    const effective = own.length > 0 ? own : fallback;
    for (const p of effective) bump(p, { atLabel: own.length > 0 ? label : `${label} (via the agency's prefixes)` });
  }

  for (const job of jobs) {
    if (job?.status === 'Cancelled' || job?.isCancelled || job?.mrStatus === 'Cancelled') continue;
    // A job of THIS tender carrying THIS prefix is not a conflict - it is this tender's own series.
    if (String(job?.atId ?? '') === String(atId)) continue;
    const p = prefixOfJobNo(job?.jobNo);
    if (p) bump(p, { jobCount: 1 });
  }
  return out;
}

/**
 * ⚠ DOES ANY LIVE JOB OF THIS TENDER CARRY THIS PREFIX - THE RIGHT TEST, AND NOT THE OBVIOUS ONE (AUDIT G108).
 *
 * `counterMoved` sits beside this in AtDivisions and looks applicable. **It is wrong here, and live data proves it:
 * SAMOR's DAEESA-1 has FOUR booked jobs under `STD` against a counter of ZERO**, so `counterMoved` would wave a
 * prefix change straight through.
 *
 * Why a change must be refused once work is booked: the counter is keyed on `division_coreType`, never on the
 * prefix. Rename `MSBT` to `MSB2` on a tender holding `MSBT-1`...`MSBT-23` and the counter still reads 23 while
 * nothing is taken under `MSB2`, so the next number offered is `MSB2-24` - one tender's series split across two
 * prefixes, which is the very thing one-prefix-per-tender exists to prevent.
 */
export function prefixHasBookedWork(atId: string, prefix: string, jobs: readonly any[]): boolean {
  const want = normalise(prefix);
  if (!want) return false;
  return jobs.some(job => {
    if (job?.status === 'Cancelled' || job?.isCancelled || job?.mrStatus === 'Cancelled') return false;
    if (String(job?.atId ?? '') !== String(atId)) return false;
    return prefixOfJobNo(job?.jobNo) === want;
  });
}

/**
 * The agency-wide half of prefix validation: this AT's divisions against its siblings and the job numbers.
 *
 * Returns errors in the same shape `validateDivisionPrefixes` does, so a caller runs both and concatenates. They
 * are separate because the within-AT checks need no data beyond the form, and this one cannot run without the
 * agency's ATs and jobs - a caller that has only the form still gets the checks it can make.
 */
export function validatePrefixesAcrossAgency(
  divisions: DivisionPrefixEntry[],
  context: {
    atId: string;
    siblingAts: readonly { id: string; atNumber?: string; name?: string; prefixes?: any }[];
    jobs: readonly any[];
    /** The prefixes this AT already has saved, so an unchanged one is never refused for being its own. */
    ownPrefixes?: readonly string[];
    /** The agency record, whose `prefixes` any AT configuring none of its own resolves to. */
    agency?: { prefixes?: any } | null;
  },
): ValidationResult {
  const errors: string[] = [];
  const divisionErrors: ValidationResult['divisionErrors'] = {};
  const unavailable = prefixesUnavailableTo(context.atId, context.siblingAts, context.jobs, context.agency);
  const own = new Set((context.ownPrefixes || []).map(normalise));

  (divisions || []).forEach((div, index) => {
    const name = String(div.name || '').trim().toUpperCase() || `#${index + 1}`;
    for (const p of prefixesOf(div)) {
      const clash = unavailable.get(p);
      if (!clash) continue;
      // Already saved on this AT and merely re-submitted: the conflict is pre-existing data, not this edit.
      if (own.has(p)) continue;
      const by = clash.atLabel
        ? `AT ${clash.atLabel}${clash.jobCount ? ` and ${clash.jobCount} job number(s)` : ''}`
        : `${clash.jobCount} job number(s) already issued`;
      const msg = `Division ${name}: prefix "${p}" is already used by ${by}. `
        + `Every tender has its own prefix, so its job numbers start at 1 under a name nothing else carries. `
        + `Choose a prefix this agency has not used.`;
      errors.push(msg);
      divisionErrors[index] = {
        ...(divisionErrors[index] || {}),
        duplicatePrefixes: [...(divisionErrors[index]?.duplicatePrefixes || []), { prefix: p, fields: ['across tenders'] }],
      };
    }
  });

  return { isValid: errors.length === 0, errors, divisionErrors };
}
