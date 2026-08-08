/**
 * Container names.
 *
 * Docker's adjective-noun scheme is not whimsy — it produces names a human can
 * hold in working memory, say out loud, and tell apart at a glance, which
 * `c7f3a91b` cannot. When an agent has six containers open, that matters.
 */

const ADJECTIVES = [
  'amber', 'brisk', 'calm', 'candid', 'clever', 'coral', 'crisp', 'dusk',
  'eager', 'fluent', 'frost', 'gentle', 'humble', 'indigo', 'keen', 'lucid',
  'mellow', 'nimble', 'olive', 'patient', 'quiet', 'rapid', 'sage', 'silent',
  'slate', 'solar', 'stark', 'swift', 'tidal', 'umber', 'vivid', 'warm',
];

const NOUNS = [
  'anchor', 'basin', 'beacon', 'canyon', 'cedar', 'cipher', 'delta', 'ember',
  'fjord', 'forge', 'harbor', 'kernel', 'lattice', 'meadow, ', 'mesa', 'orbit',
  'prism', 'quarry', 'ridge', 'saddle', 'signal', 'summit', 'thicket', 'trellis',
  'vertex', 'willow', 'zephyr',
].map((noun) => noun.trim().replace(/,$/, ''));

export function generateName(taken: ReadonlySet<string> = new Set()): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const name = `${adjective}-${noun}`;
    if (!taken.has(name)) return name;
  }
  // Exhausted the readable space; fall back to something guaranteed unique.
  return `container-${Date.now().toString(36)}`;
}

/**
 * Names appear in file paths, OS object names and log lines, so the character
 * set is deliberately narrow. Rejecting early beats sanitising silently.
 */
export function isValidName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(name);
}
