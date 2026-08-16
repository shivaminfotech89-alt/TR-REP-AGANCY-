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
