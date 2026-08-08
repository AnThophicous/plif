import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Carry the licence into every published package.
 *
 * Apache-2.0 section 4 requires NOTICE to travel with anything redistributed,
 * and a tarball on npm is a redistribution. Keeping one copy at the repository
 * root and copying it at pack time is the only arrangement where the three
 * packages cannot drift apart or quietly ship without it.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.cwd();

const files = ['LICENSE', 'NOTICE'];
if (path.basename(target) === 'cli') files.push('README.md');

for (const file of files) {
  const from = path.join(root, file);
  if (!existsSync(from)) throw new Error(`prepack: ${file} is missing from the repository root`);
  copyFileSync(from, path.join(target, file));
}
