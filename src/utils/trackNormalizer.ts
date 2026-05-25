/**
 * Normalizes track titles for deduplication.
 *
 * Two separate concerns:
 *  - canonicalName()  : strips ALL annotations (including feat.) so two versions
 *                       of the same song match each other in the library index.
 *  - isVariant()      : returns true ONLY for remix / live / extended etc. tracks
 *                       that we want to skip when building the artist track list.
 *                       Featured-artist tracks are NOT variants — they are originals.
 */

// ─── Patterns stripped for canonical matching (library dedup) ────────────────

const CANONICAL_PATTERNS: RegExp[] = [
  // " - Remix", " - Extended Mix", " - Radio Edit", " - Clean", " - Explicit" etc.
  /\s*[-–]\s*(remix|extended|edit|radio\s*edit|club\s*mix|original\s*mix|live|acoustic|demo|remaster(?:ed)?|deluxe|instrumental|version|vip|mix|reprise|interlude|intro|outro|bonus|clean|explicit)\b.*/i,
  // (Remix), (Extended Mix), (feat. X), (ft. X), (with X), (Clean), (Explicit) in parens
  /\s*\((remix|extended|edit|radio\s*edit|club\s*mix|original\s*mix|live|acoustic|demo|remaster(?:ed)?|deluxe|instrumental|version|vip|mix|reprise|interlude|clean|explicit|feat\.?[^)]*|ft\.?[^)]*|with\s[^)]*)\s*\)/gi,
  // (Deluxe Edition), (Super Deluxe), (Special Edition), (Expanded Edition), (Anniversary Edition) etc.
  // The bare "(Deluxe)" is caught above; this catches the "X Edition / X Version" compounds.
  /\s*\(\s*(?:super\s+)?(?:deluxe|expanded|special|anniversary|international|legacy|standard)\s+(?:edition|version)\s*\)/gi,
  // [Remastered], [Live], [Deluxe Edition] in square brackets
  /\s*\[[^\]]*\]/g,
  // "Remastered YYYY" at end
  /\s*[-–(]?\s*remaster(?:ed)?\s*(?:\d{4})?\s*[)–]?\s*$/i,
  // "Live at / from / in ..."
  /\s*[-–(]?\s*live\s+(?:at|from|in)\s+[^)(\[]*$/i,
];

// ─── Patterns that mark a track as a VARIANT (remix/live/edit/etc.) ──────────
// Note: featured-artist tracks (feat. X) are NOT variants — they are originals.

const VARIANT_INDICATOR_PATTERNS: RegExp[] = [
  // " - Remix", " - Extended", " - Live", " - Acoustic" etc.
  /[-–]\s*(remix|extended\s*(?:mix|version)?|edit|radio\s*edit|club\s*mix|live|acoustic|demo|remaster(?:ed)?|instrumental|vip\s*(?:mix)?|reprise)\b/i,
  // (Remix), (Extended Mix), (Live), (Acoustic Version) etc. — but NOT (feat. X)
  /\(\s*(remix|extended\s*(?:mix|version)?|edit|radio\s*edit|club\s*mix|live|acoustic|demo|remaster(?:ed)?|instrumental|vip\s*(?:mix)?|reprise)\s*\)/i,
  // [Remastered], [Live Version], [Club Mix] etc. in square brackets
  /\[\s*(remix|extended|edit|live|acoustic|demo|remaster(?:ed)?|instrumental|vip|club\s*mix)\s*\]/i,
];

/**
 * Returns a canonical (normalized) version of a track title.
 * Strips everything including feat. annotations.
 * Used to detect whether two tracks are the "same song" in the library index.
 */
export function canonicalName(title: string): string {
  let name = title;
  for (const pat of CANONICAL_PATTERNS) {
    name = name.replace(pat, "");
  }
  return name.replace(/\s{2,}/g, " ").trim().toLowerCase();
}

/**
 * Returns true if the title is a remix / live / extended / remaster variant.
 * Featured-artist tracks are NOT considered variants.
 */
export function isVariant(title: string): boolean {
  return VARIANT_INDICATOR_PATTERNS.some((pat) => pat.test(title));
}
