/**
 * A stable hash for turning identifiers into reproducible pseudo-randomness.
 *
 * FNV-1a, chosen because it is short enough to read, has no dependencies, and
 * produces the same number in every runtime the application runs in. That last
 * property is the whole point: it is used to give each synthetic member a fixed
 * temperament and a fixed survey-response draw, and those have to come out the
 * same on a laptop, in a test and on the deployed machine, or the figures move
 * for reasons that have nothing to do with the benefit.
 *
 * Not a cryptographic hash and not used as one.
 */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The same hash mapped onto the unit interval.
 *
 * Handy where a hash is standing in for a random draw, which is most places it
 * is used here.
 */
export function unitHash(s: string): number {
  return hashString(s) / 4294967296;
}
