// src/lib/compareSections.ts
//
// THE ONE WAY TO COMPARE RATE DATA. Do not use JSON.stringify directly on anything read
// back from Firestore.
//
// ⚠ JSON.stringify TREATS KEY ORDER AS A DIFFERENCE, AND FIRESTORE DOES NOT PRESERVE IT.
// Two documents written through different code paths hold the same rates under different
// key orders, so a naive comparison reports everything as changed. This has now produced a
// confidently wrong answer three times in this codebase:
//
//   1. The public_config drift census reported 31 of 32 CRGO rows differing. The real
//      figure was two. (AUDIT: "Pattern: a green check was cited as evidence...")
//   2. `master-equivalence.js` used the same comparison and happened to be right, because
//      the migration copied arrays verbatim and preserved order - correct by luck.
//   3. A template comparison reported all five sections differing between two templates
//      seeded from the same constant. Cell by cell the difference was zero; the row objects
//      came back as ["unit","itemName","rates","fixedRate","itemCode"] against
//      ["itemCode","fixedRate","rates","itemName","unit"].
//
// The third was written AFTER the entry documenting the trap, by someone who had read it.
// Reading a warning does not prevent the mistake it warns about, so the stable comparison
// has to be the DEFAULT rather than the remedy - which is what this module is for.

/** Deep-sorts object keys so a comparison sees values, never insertion order. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>).sort().map(k => [k, stable((value as any)[k])]),
    );
  }
  return value;
}

/** A key-order-independent fingerprint. Equal fingerprints mean equal content. */
export function stableKey(value: unknown): string {
  return JSON.stringify(stable(value));
}

/** Do two values hold the same content, whatever order their keys arrived in? */
export function sameContent(a: unknown, b: unknown): boolean {
  return stableKey(a) === stableKey(b);
}

/**
 * Do any of the named sections differ between two rate holders?
 *
 * Used to decide whether a republished template is a REPRICING or a metadata correction.
 * A missing section and an empty one are the same thing here - neither carries a rate.
 */
export function sectionsDiffer(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
  fields: readonly string[],
): boolean {
  return fields.some(f => {
    const av = Array.isArray(a?.[f]) && (a?.[f] as unknown[]).length ? a?.[f] : null;
    const bv = Array.isArray(b?.[f]) && (b?.[f] as unknown[]).length ? b?.[f] : null;
    return !sameContent(av, bv);
  });
}
